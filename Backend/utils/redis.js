// ============================================
// CORRECTED REDIS UTILITY
// Fix: Replace blocking KEYS with non-blocking SCAN
// ============================================

import 'dotenv/config';
import { createClient } from 'redis';

/* ================= CONFIG ================= */

const PREFIX = 'epicstore:';

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

if (!REDIS_HOST || !REDIS_PORT) {
  console.warn('⚠️ Redis environment variables missing. Caching will be disabled.');
}

/* ================= CLIENT ================= */

const redis = createClient({
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
});

/* ================= EVENTS ================= */

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('ready', () => console.log('🚀 Redis ready'));
redis.on('reconnecting', () => console.warn('🔄 Redis reconnecting...'));
redis.on('end', () => console.warn('⚠️ Redis connection closed'));
redis.on('error', err => console.error('❌ Redis error:', err));

/* ================= INITIALIZER ================= */

export const initializeRedis = async () => {
  if (redis.isOpen) {
    console.log('ℹ️ Redis already connected');
    return;
  }

  try {
    await redis.connect();

    if (process.env.NODE_ENV !== 'production') {
      // Health check (DEV ONLY)
      await redis.set(`${PREFIX}healthcheck`, 'ok', { EX: 10 });
      const value = await redis.get(`${PREFIX}healthcheck`);
      await redis.del(`${PREFIX}healthcheck`);

      if (value !== 'ok') {
        throw new Error('Redis health check failed');
      }

      console.log('🎉 Redis health check passed');
    }
  } catch (error) {
    console.error('❌ Redis initialization failed:', error);
    console.warn('⚠️ Application will continue without Redis caching');
  }
};

/* ================= CACHE HELPERS ================= */

export const getCache = async key => {
  try {
    if (!redis.isOpen) return null;

    const data = await redis.get(PREFIX + key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis GET error:', error);
    return null;
  }
};

export const setCache = async (key, value, ttl = 300) => {
  try {
    if (!redis.isOpen) return;

    await redis.set(PREFIX + key, JSON.stringify(value), { EX: ttl });
  } catch (error) {
    console.error('Redis SET error:', error);
  }
};

export const deleteCache = async key => {
  try {
    if (!redis.isOpen) return;

    await redis.del(PREFIX + key);
  } catch (error) {
    console.error('Redis DEL error:', error);
  }
};

/**
 * Delete cache keys matching a pattern
 * CRITICAL FIX: Uses SCAN instead of KEYS for non-blocking deletion
 * 
 * @param {string} pattern - Pattern to match (e.g., 'user:*', 'session:*')
 * @returns {Promise<number>} Number of keys deleted
 */
export const deleteCachePattern = async pattern => {
  try {
    if (!redis.isOpen) {
      console.warn('Redis not connected, skipping pattern delete');
      return 0;
    }

    const fullPattern = PREFIX + pattern;
    let cursor = '0';
    let deletedCount = 0;
    let iterationCount = 0;
    const maxIterations = 1000; // Safety limit

    do {
      iterationCount++;

      // SCAN is non-blocking and returns results in batches
      const result = await redis.scan(cursor, {
        MATCH: fullPattern,
        COUNT: 100 // Process 100 keys at a time
      });

      cursor = result.cursor;
      const keys = result.keys;

      if (keys.length > 0) {
        await redis.del(keys);
        deletedCount += keys.length;
      }

      // Safety: Prevent infinite loops
      if (iterationCount > maxIterations) {
        console.warn(`⚠️ SCAN exceeded ${maxIterations} iterations, stopping`);
        break;
      }
    } while (cursor !== '0');

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
 * Get multiple cache keys at once
 * @param {string[]} keys - Array of cache keys
 * @returns {Promise<Object>} Object mapping keys to values
 */
export const getCacheMultiple = async keys => {
  try {
    if (!redis.isOpen || !keys.length) return {};

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
 * Set multiple cache keys at once
 * @param {Object} keyValuePairs - Object with key-value pairs
 * @param {number} ttl - Time to live in seconds
 */
export const setCacheMultiple = async (keyValuePairs, ttl = 300) => {
  try {
    if (!redis.isOpen || !Object.keys(keyValuePairs).length) return;

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
 * Increment a counter in cache
 * @param {string} key - Cache key
 * @param {number} increment - Amount to increment (default 1)
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<number>} New value
 */
export const incrementCache = async (key, increment = 1, ttl = 3600) => {
  try {
    if (!redis.isOpen) return 0;

    const newValue = await redis.incrBy(PREFIX + key, increment);
    
    // Set expiry only if this is a new key
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
 * Check if cache key exists
 * @param {string} key - Cache key
 * @returns {Promise<boolean>}
 */
export const cacheExists = async key => {
  try {
    if (!redis.isOpen) return false;
    return (await redis.exists(PREFIX + key)) === 1;
  } catch (error) {
    console.error('Redis EXISTS error:', error);
    return false;
  }
};

/**
 * Get cache with fallback - if cache miss, fetch data and cache it
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch data on cache miss
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<any>} Cached or fetched data
 */
export const getCacheWithFallback = async (key, fetchFn, ttl = 300) => {
  try {
    // Try cache first
    const cached = await getCache(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch data
    const data = await fetchFn();
    
    // Cache the result
    await setCache(key, data, ttl);
    
    return data;
  } catch (error) {
    console.error('Cache with fallback error:', error);
    // On error, try to fetch data anyway
    return fetchFn();
  }
};

/**
 * Distributed lock using Redis
 * @param {string} lockKey - Lock identifier
 * @param {number} ttl - Lock duration in seconds
 * @returns {Promise<boolean>} True if lock acquired
 */
export const acquireLock = async (lockKey, ttl = 30) => {
  try {
    if (!redis.isOpen) return false;

    const result = await redis.set(PREFIX + 'lock:' + lockKey, '1', {
      NX: true, // Only set if doesn't exist
      EX: ttl
    });

    return result === 'OK';
  } catch (error) {
    console.error('Redis lock acquire error:', error);
    return false;
  }
};

/**
 * Release distributed lock
 * @param {string} lockKey - Lock identifier
 */
export const releaseLock = async lockKey => {
  try {
    if (!redis.isOpen) return;
    await redis.del(PREFIX + 'lock:' + lockKey);
  } catch (error) {
    console.error('Redis lock release error:', error);
  }
};

/**
 * Execute function with distributed lock
 * Prevents multiple processes from executing the same expensive operation
 * 
 * @param {string} lockKey - Lock identifier
 * @param {Function} fn - Async function to execute
 * @param {number} lockTTL - Lock duration in seconds
 * @returns {Promise<any>} Result of function or null if lock not acquired
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
 * Stale-While-Revalidate pattern
 * Returns cached data immediately if available, refreshes in background if stale
 * 
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch fresh data
 * @param {Object} options - { ttl: 300, staleAfter: 240 }
 * @returns {Promise<any>}
 */
export const getCacheWithSWR = async (key, fetchFn, options = {}) => {
  const { ttl = 300, staleAfter = 240 } = options;

  try {
    if (!redis.isOpen) {
      return fetchFn();
    }

    const cached = await redis.get(PREFIX + key);

    if (cached) {
      const data = JSON.parse(cached);
      const age = Date.now() - (data._cachedAt || 0);

      // If cache is getting stale, refresh in background
      if (age > staleAfter * 1000) {
        // Don't await - refresh asynchronously
        fetchFn()
          .then(fresh => {
            setCache(key, { ...fresh, _cachedAt: Date.now() }, ttl);
          })
          .catch(err => console.error('SWR refresh error:', err));
      }

      return data;
    }

    // No cache - fetch synchronously
    const data = await fetchFn();
    await setCache(key, { ...data, _cachedAt: Date.now() }, ttl);
    return data;
  } catch (error) {
    console.error('SWR cache error:', error);
    return fetchFn();
  }
};

/**
 * Get cache statistics
 * @returns {Promise<Object>} Redis stats
 */
export const getCacheStats = async () => {
  try {
    if (!redis.isOpen) {
      return { connected: false };
    }

    const info = await redis.info('stats');
    const keyspace = await redis.info('keyspace');
    
    return {
      connected: true,
      info,
      keyspace
    };
  } catch (error) {
    console.error('Redis stats error:', error);
    return { connected: false, error: error.message };
  }
};

/* ================= SHUTDOWN ================= */

export const shutdownRedis = async () => {
  try {
    if (redis.isOpen) {
      await redis.quit();
      console.log('🛑 Redis connection closed gracefully');
    }
  } catch (error) {
    console.error('Redis shutdown error:', error);
  }
};

export default redis;