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

export const deleteCachePattern = async pattern => {
  try {
    if (!redis.isOpen) return;

    const keys = await redis.keys(PREFIX + pattern);
    if (keys.length) await redis.del(keys);
  } catch (error) {
    console.error('Redis pattern delete error:', error);
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
