import Redis from "ioredis";

// Namespace for your app to avoid key collisions
const PREFIX = "epicstore:";

// Create Redis client
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 5,       // Retry failed commands
  enableOfflineQueue: true,      // Queue commands while disconnected
  reconnectOnError: (err) => true, // Always try reconnect
});

// Connection logging
redis.on("connect", () => console.info("Redis connected!"));
redis.on("ready", () => console.info("Redis ready to accept commands"));
redis.on("error", (err) => console.error("Redis error:", err));
redis.on("close", () => console.warn("Redis connection closed"));
redis.on("reconnecting", () => console.info("Redis reconnecting..."));
redis.on("ready", async () => {
  const info = await redis.info("memory");
  console.info("Redis memory:", info);
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
    await redis.set(PREFIX + key, JSON.stringify(value), "EX", ttl);
  } catch (error) {
    console.error("Redis SET error:", error);
    // Continue without caching
  }
};

// -----------------------------
// Helper: delete a single cache key
// -----------------------------
export const deleteCache = async (key) => {
  await redis.del(PREFIX + key);
};

// -----------------------------
// Helper: delete keys by pattern (invalidate multiple related caches)
// -----------------------------
export const deleteCachePattern = async (pattern) => {
  const keys = await redis.keys(PREFIX + pattern);
  if (keys.length) await redis.del(keys);
};

export default redis;
