import 'dotenv/config';
import { createClient } from 'redis';

/* ================= CONFIG ================= */

const PREFIX = 'epicstore:';

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

const REDIS_AVAILABLE = !!REDIS_HOST && Number.isInteger(REDIS_PORT) && REDIS_PORT > 0;

if (!REDIS_AVAILABLE) {
  console.warn('⚠️ Redis environment variables missing or invalid. Caching will be disabled.');
}

/* ================= CLIENT ================= */

const redis = REDIS_AVAILABLE
  ? createClient({
      username: 'default',
      password: REDIS_PASSWORD || undefined,
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        reconnectStrategy: retries => {
          console.warn(`🔄 Redis reconnect attempt #${retries}`);
          return Math.min(retries * 100, 3000);
        }
      }
    })
  : null;

/* ================= EVENTS ================= */

if (redis) {
  redis.on('connect',      () => console.log('✅ Redis connected'));
  redis.on('ready',        () => console.log('🚀 Redis ready'));
  redis.on('reconnecting', () => console.warn('🔄 Redis reconnecting...'));
  redis.on('end',          () => console.warn('⚠️ Redis connection closed'));
  redis.on('error',   err => console.error('❌ Redis error:', err));
}

/* ================= INITIALIZER ================= */

export const initializeRedis = async () => {
  if (!redis) {
    console.warn('⚠️ Redis client not created — skipping initialization');
    return;
  }

  if (redis.isOpen) {
    console.log('ℹ️ Redis already connected');
    return;
  }

  try {
    await redis.connect();

    if (process.env.NODE_ENV !== 'production') {
      await redis.set(`${PREFIX}healthcheck`, 'ok', { EX: 10 });
      const value = await redis.get(`${PREFIX}healthcheck`);
      await redis.del(`${PREFIX}healthcheck`);

      if (value !== 'ok') throw new Error('Redis health check failed');
      console.log('🎉 Redis health check passed');
    }
  } catch (error) {
    console.error('❌ Redis initialization failed:', error);
    console.warn('⚠️ Application will continue without Redis caching');
  }
};

/* ================= HELPERS ================= */

const isReady = () => redis !== null && redis.isOpen;

/* ================= CACHE HELPERS ================= */

export const getCache = async key => {
  try {
    if (!isReady()) return null;
    const data = await redis.get(PREFIX + key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis GET error:', error);
    return null;
  }
};

export const setCache = async (key, value, ttl = 300) => {
  try {
    if (!isReady()) return;
    await redis.set(PREFIX + key, JSON.stringify(value), { EX: ttl });
  } catch (error) {
    console.error('Redis SET error:', error);
  }
};

export const deleteCache = async key => {
  try {
    if (!isReady()) return;
    await redis.del(PREFIX + key);
  } catch (error) {
    console.error('Redis DEL error:', error);
  }
};

/**
 * Delete all cache keys matching a glob pattern.
 * Uses SCAN (non-blocking) instead of KEYS (blocks the Redis event loop).
 *
 * BUG 1 (previous): cursor was initialised as string "0" and compared with !== "0".
 * node-redis v4 SCAN returns cursor as a NUMBER so the loop never terminated.
 * FIXED: cursor is a number, comparison is !== 0.
 *
 * BUG 2 (actual cause of the TypeError in logs): node-redis v4's RESP encoder
 * requires every command argument to be a string or Buffer. The cursor was being
 * passed as a raw number (0) directly to redis.scan(), which the encoder rejected
 * with: "arguments[1] must be of type string | Buffer, got number instead."
 * FIXED: cursor is explicitly cast to String before every redis.scan() call.
 *
 * @param {string} pattern - Glob pattern, e.g. 'sitemap*', 'product_*_seo'
 * @returns {Promise<number>} Number of keys deleted
 */
export const deleteCachePattern = async pattern => {
  try {
    if (!isReady()) {
      console.warn('Redis not connected, skipping pattern delete');
      return 0;
    }

    const fullPattern = PREFIX + pattern;
    let cursor = 0;
    let deletedCount = 0;
    let iterationCount = 0;
    const maxIterations = 1000;

    do {
      iterationCount++;

      // FIX: Pass cursor as String — node-redis v4 RESP encoder rejects raw numbers.
      // Without String() the encoder throws:
      //   TypeError: "arguments[1]" must be of type "string | Buffer", got number
      const result = await redis.scan(String(cursor), {
        MATCH: fullPattern,
        COUNT: 100
      });

      // result.cursor is returned as a number by node-redis v4
      cursor = result.cursor;
      const keys = result.keys;

      if (keys.length > 0) {
        await redis.del(keys);
        deletedCount += keys.length;
      }

      if (iterationCount > maxIterations) {
        console.warn(`⚠️ SCAN exceeded ${maxIterations} iterations, stopping`);
        break;
      }
    } while (cursor !== 0); // number comparison — result.cursor is always a number

    if (deletedCount > 0) {
      console.log(`🗑️ Deleted ${deletedCount} keys matching pattern: ${pattern}`);
    }

    return deletedCount;
  } catch (error) {
    console.error('Redis pattern delete error:', error);
    return 0;
  }
};

/**
 * Get multiple cache keys at once.
 * @param {string[]} keys
 * @returns {Promise<Object>} Map of key → parsed value (or null on miss)
 */
export const getCacheMultiple = async keys => {
  try {
    if (!isReady() || !keys.length) return {};

    const prefixedKeys = keys.map(k => PREFIX + k);
    const values = await redis.mGet(prefixedKeys);

    const result = {};
    keys.forEach((key, index) => {
      result[key] = values[index] ? JSON.parse(values[index]) : null;
    });

    return result;
  } catch (error) {
    console.error('Redis MGET error:', error);
    return {};
  }
};

/**
 * Set multiple cache keys atomically via pipeline.
 * @param {Object} keyValuePairs
 * @param {number} ttl
 */
export const setCacheMultiple = async (keyValuePairs, ttl = 300) => {
  try {
    if (!isReady() || !Object.keys(keyValuePairs).length) return;

    const pipeline = redis.multi();
    for (const [key, value] of Object.entries(keyValuePairs)) {
      pipeline.set(PREFIX + key, JSON.stringify(value), { EX: ttl });
    }
    await pipeline.exec();
  } catch (error) {
    console.error('Redis MSET error:', error);
  }
};

/**
 * Atomically increment a counter. Sets TTL only on first creation.
 * @param {string} key
 * @param {number} increment
 * @param {number} ttl
 * @returns {Promise<number>} New counter value
 */
export const incrementCache = async (key, increment = 1, ttl = 3600) => {
  try {
    if (!isReady()) return 0;

    const newValue = await redis.incrBy(PREFIX + key, increment);
    if (newValue === increment) {
      await redis.expire(PREFIX + key, ttl);
    }
    return newValue;
  } catch (error) {
    console.error('Redis INCR error:', error);
    return 0;
  }
};

/**
 * Check whether a cache key exists.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export const cacheExists = async key => {
  try {
    if (!isReady()) return false;
    return (await redis.exists(PREFIX + key)) === 1;
  } catch (error) {
    console.error('Redis EXISTS error:', error);
    return false;
  }
};

/**
 * Cache-aside helper: return cached value or fetch, cache, and return.
 * @param {string} key
 * @param {Function} fetchFn - async () => value
 * @param {number} ttl
 * @returns {Promise<any>}
 */
export const getCacheWithFallback = async (key, fetchFn, ttl = 300) => {
  try {
    const cached = await getCache(key);
    if (cached !== null) return cached;

    const data = await fetchFn();
    await setCache(key, data, ttl);
    return data;
  } catch (error) {
    console.error('Cache with fallback error:', error);
    return fetchFn();
  }
};

/**
 * Distributed lock: acquire a named lock for up to `ttl` seconds.
 * @param {string} lockKey
 * @param {number} ttl  Lock duration in seconds
 * @returns {Promise<boolean>} true if lock was acquired
 */
export const acquireLock = async (lockKey, ttl = 30) => {
  try {
    if (!isReady()) return false;
    const result = await redis.set(PREFIX + 'lock:' + lockKey, '1', { NX: true, EX: ttl });
    return result === 'OK';
  } catch (error) {
    console.error('Redis lock acquire error:', error);
    return false;
  }
};

/**
 * Release a distributed lock.
 * @param {string} lockKey
 */
export const releaseLock = async lockKey => {
  try {
    if (!isReady()) return;
    await redis.del(PREFIX + 'lock:' + lockKey);
  } catch (error) {
    console.error('Redis lock release error:', error);
  }
};

/**
 * Run `fn` under a distributed lock. Returns null if the lock could not be
 * acquired (another process already holds it).
 *
 * @param {string} lockKey
 * @param {Function} fn - async function to execute while holding the lock
 * @param {number} lockTTL - maximum lock duration in seconds
 * @returns {Promise<any|null>} Result of fn, or null if lock not acquired
 */
export const executeWithLock = async (lockKey, fn, lockTTL = 30) => {
  const acquired = await acquireLock(lockKey, lockTTL);
  if (!acquired) {
    console.log(`Lock not acquired for: ${lockKey}`);
    return null;
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lockKey);
  }
};

/**
 * Stale-While-Revalidate for JSON objects.
 * Returns cached data immediately; if the entry is older than `staleAfter`
 * seconds, a background refresh is triggered without blocking the caller.
 * Age is tracked in a separate Redis key to avoid polluting the data object
 * and to support arrays (spreading an array into an object breaks .map() etc.)
 *
 * @param {string} key
 * @param {Function} fetchFn - async () => value (object or array)
 * @param {Object} options - { ttl: 300, staleAfter: 240 }
 * @returns {Promise<any>}
 */
export const getCacheWithSWR = async (key, fetchFn, options = {}) => {
  const { ttl = 300, staleAfter = 240 } = options;

  try {
    if (!isReady()) return fetchFn();

    const cached = await redis.get(PREFIX + key);

    if (cached) {
      const data = JSON.parse(cached);

      const ageKey = `${PREFIX + key}:age`;
      const cachedAt = await redis.get(ageKey);
      const age = cachedAt ? Date.now() - parseInt(cachedAt) : Infinity;

      if (age > staleAfter * 1000) {
        fetchFn()
          .then(fresh => {
            setCache(key, fresh, ttl);
            redis.set(ageKey, String(Date.now()), { EX: ttl });
          })
          .catch(err => console.error('SWR refresh error:', err));
      }

      return data;
    }

    const data = await fetchFn();
    await setCache(key, data, ttl);
    await redis.set(`${PREFIX + key}:age`, String(Date.now()), { EX: ttl });
    return data;
  } catch (error) {
    console.error('SWR cache error:', error);
    return fetchFn();
  }
};

/* ================= RAW STRING CACHE (XML / HTML / text) ================= */

/**
 * Store a raw string (XML, HTML, etc.) without JSON serialization.
 * @param {string} key
 * @param {string} value
 * @param {number} ttl
 */
export const setCacheRaw = async (key, value, ttl = 300) => {
  try {
    if (!isReady()) {
      console.warn('Redis not connected, skipping raw cache set');
      return;
    }
    await redis.set(PREFIX + key, value, { EX: ttl });
  } catch (error) {
    console.error('Redis SET (raw) error:', error);
  }
};

/**
 * Retrieve a raw string from cache without JSON parsing.
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export const getCacheRaw = async key => {
  try {
    if (!isReady()) return null;
    return await redis.get(PREFIX + key);
  } catch (error) {
    console.error('Redis GET (raw) error:', error);
    return null;
  }
};

/**
 * Cache-aside for raw strings: return cached value or fetch, cache, and return.
 * @param {string} key
 * @param {Function} fetchFn - async () => string
 * @param {number} ttl
 * @returns {Promise<string>}
 */
export const getCacheRawWithFallback = async (key, fetchFn, ttl = 300) => {
  try {
    const cached = await getCacheRaw(key);
    if (cached !== null) return cached;

    const data = await fetchFn();
    await setCacheRaw(key, data, ttl);
    return data;
  } catch (error) {
    console.error('Cache with fallback (raw) error:', error);
    return fetchFn();
  }
};

/**
 * Stale-While-Revalidate for raw strings (XML, HTML, etc.).
 * Returns cached string immediately; triggers a background refresh if stale.
 * Age is tracked via a separate `:age` key.
 *
 * @param {string} key
 * @param {Function} fetchFn - async () => string
 * @param {Object} options - { ttl: 300, staleAfter: 240 }
 * @returns {Promise<string>}
 */
export const getCacheRawWithSWR = async (key, fetchFn, options = {}) => {
  const { ttl = 300, staleAfter = 240 } = options;

  try {
    if (!isReady()) return fetchFn();

    const cached = await redis.get(PREFIX + key);

    if (cached) {
      const ageKey = `${PREFIX + key}:age`;
      const cachedAt = await redis.get(ageKey);
      const age = cachedAt ? Date.now() - parseInt(cachedAt) : Infinity;

      if (age > staleAfter * 1000) {
        fetchFn()
          .then(fresh => {
            setCacheRaw(key, fresh, ttl);
            redis.set(ageKey, String(Date.now()), { EX: ttl });
          })
          .catch(err => console.error('SWR raw refresh error:', err));
      }

      return cached;
    }

    const data = await fetchFn();
    await setCacheRaw(key, data, ttl);
    await redis.set(`${PREFIX + key}:age`, String(Date.now()), { EX: ttl });
    return data;
  } catch (error) {
    console.error('SWR raw cache error:', error);
    return fetchFn();
  }
};

/* ================= STATS ================= */

/**
 * Return Redis server statistics.
 * @returns {Promise<Object>}
 */
export const getCacheStats = async () => {
  try {
    if (!isReady()) return { connected: false };

    const info     = await redis.info('stats');
    const keyspace = await redis.info('keyspace');
    return { connected: true, info, keyspace };
  } catch (error) {
    console.error('Redis stats error:', error);
    return { connected: false, error: error.message };
  }
};

/* ================= SHUTDOWN ================= */

export const shutdownRedis = async () => {
  try {
    if (redis && redis.isOpen) {
      await redis.quit();
      console.log('🛑 Redis connection closed gracefully');
    }
  } catch (error) {
    console.error('Redis shutdown error:', error);
  }
};

export default redis;