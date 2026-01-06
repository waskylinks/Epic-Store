import 'dotenv/config';
import { createClient } from 'redis';

// Namespace for your app to avoid key collisions
const PREFIX = "epicstore:";

// Validate and parse Redis configuration
const REDIS_HOST = process.env.REDIS_HOST || 'redis-13909.c246.us-east-1-4.ec2.cloud.redislabs.com';
const REDIS_PORT = parseInt(process.env.REDIS_PORT) || 13909;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

// Debug log to verify environment variables
console.log('Redis Config:', {
  host: REDIS_HOST,
  port: REDIS_PORT,
  hasPassword: !!REDIS_PASSWORD,
  // Optionally show first few chars of password to verify it's loaded
  passwordPreview: REDIS_PASSWORD ? `${REDIS_PASSWORD.substring(0, 3)}...` : 'MISSING'
});

const redis = createClient({
  username: 'default',
  password: REDIS_PASSWORD,
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT
  }
});

// Connection logging
redis.on('error', (err) => console.error('Redis Client Error:', err));
redis.on('connect', () => console.log('✅ Connected to Redis'));
redis.on('ready', () => console.log('✅ Redis is ready'));
redis.on('close', () => console.warn('⚠️ Redis connection closed'));
redis.on('reconnecting', () => console.info('🔄 Redis reconnecting...'));

// Log memory info when ready
redis.on('ready', async () => {
  try {
    const info = await redis.info('memory');
    console.info('📊 Redis memory info retrieved');
  } catch (error) {
    console.error('Error fetching Redis memory info:', error);
  }
});

// -----------------------------
// Helper: get cached JSON
// -----------------------------
export const getCache = async (key) => {
  try {
    const data = await redis.get(PREFIX + key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Redis GET error:", error);
    return null; // Fallback to database
  }
};

// -----------------------------
// Helper: set cached JSON with TTL (seconds)
// -----------------------------
export const setCache = async (key, value, ttl = 300) => {
  try {
    await redis.set(PREFIX + key, JSON.stringify(value), {
      EX: ttl
    });
  } catch (error) {
    console.error("Redis SET error:", error);
    // Continue without caching
  }
};

// -----------------------------
// Helper: delete a single cache key
// -----------------------------
export const deleteCache = async (key) => {
  try {
    await redis.del(PREFIX + key);
  } catch (error) {
    console.error("Redis DEL error:", error);
  }
};

// -----------------------------
// Helper: delete keys by pattern (invalidate multiple related caches)
// -----------------------------
export const deleteCachePattern = async (pattern) => {
  try {
    const keys = await redis.keys(PREFIX + pattern);
    if (keys.length) await redis.del(keys);
  } catch (error) {
    console.error("Redis pattern delete error:", error);
  }
};

// -----------------------------
// Test function (run once on startup)
// -----------------------------
(async () => {
  try {
    await redis.connect();
    
    // Test SET
    await redis.set('test:key', 'Hello Redis!');
    console.log('✅ SET test:key = "Hello Redis!"');
    
    // Test GET
    const value = await redis.get('test:key');
    console.log('✅ GET test:key =', value);
    
    // Test DELETE
    await redis.del('test:key');
    console.log('✅ DEL test:key');
    
    console.log('🎉 All Redis tests passed!');
  } catch (error) {
    console.error('❌ Redis test failed:', error);
    // Don't exit - allow app to continue without Redis
    console.warn('⚠️ Application will continue without Redis caching');
  }
})();

export default redis;