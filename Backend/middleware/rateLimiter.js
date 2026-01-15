import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import redisClient from '../utils/redis.js';

/* ================= HELPERS ================= */

const extractEmail = (req) => {
  let email = req.body?.email;
  if (typeof email === "object" && email?.email) email = email.email;
  if (!email || typeof email !== "string") return null;
  return email.toLowerCase();
};

const extractIP = (req) => {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || 'unknown';
};

const formatRateLimitMessage = (customMessage) => ({
  success: false,
  message: customMessage,
});

/* ================= REDIS STORE WITH LAZY INITIALIZATION ================= */

let redisStoreCache = {};

const getRedisStore = (prefix) => {
  // Return cached store if exists
  if (redisStoreCache[prefix]) {
    return redisStoreCache[prefix];
  }

  // Create new store if Redis is ready
  if (redisClient.isOpen) {
    const store = new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    });
    redisStoreCache[prefix] = store;
    return store;
  }

  // Return undefined to use memory store
  return undefined;
};

// Middleware to upgrade to Redis store once available
const upgradeToRedisStore = (limiter, prefix) => {
  return (req, res, next) => {
    // If using memory store and Redis is now ready, try to upgrade
    if (!limiter.store && redisClient.isOpen && !redisStoreCache[prefix]) {
      try {
        limiter.store = getRedisStore(prefix);
        if (limiter.store) {
          console.log(`✅ Upgraded rate limiter "${prefix}" to Redis store`);
        }
      } catch (error) {
        console.error(`Failed to upgrade rate limiter "${prefix}":`, error.message);
      }
    }
    limiter(req, res, next);
  };
};

/* ================= RATE LIMITERS ================= */

// General API limiter (100 requests / 15 min)
const apiLimiterBase = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  store: getRedisStore("ratelimit:api:"),
  message: formatRateLimitMessage(
    "Too many requests from this IP, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});
export const apiLimiter = upgradeToRedisStore(apiLimiterBase, "ratelimit:api:");

// Authentication limiter (5 failed attempts / 15 min)
const authLimiterBase = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  store: getRedisStore("ratelimit:auth:"),
  message: formatRateLimitMessage(
    "Too many authentication attempts, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});
export const authLimiter = upgradeToRedisStore(authLimiterBase, "ratelimit:auth:");

// Email sending limiter (3 requests / hour)
const emailLimiterBase = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: getRedisStore("ratelimit:email:"),
  message: formatRateLimitMessage(
    "Too many email requests, please try again after an hour"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});
export const emailLimiter = upgradeToRedisStore(emailLimiterBase, "ratelimit:email:");

// Password reset limiter (3 attempts / hour per email)
const passwordResetLimiterBase = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: getRedisStore("ratelimit:password-reset:"),
  keyGenerator: (req) => {
    const email = extractEmail(req);
    return email || extractIP(req);
  },
  message: formatRateLimitMessage(
    "Too many password reset attempts for this email, please try again after an hour"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});
export const passwordResetLimiter = upgradeToRedisStore(passwordResetLimiterBase, "ratelimit:password-reset:");

// Registration limiter (3 registrations / hour per IP)
const registrationLimiterBase = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: getRedisStore("ratelimit:registration:"),
  message: formatRateLimitMessage(
    "Too many registration attempts from this IP, please try again after an hour"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});
export const registrationLimiter = upgradeToRedisStore(registrationLimiterBase, "ratelimit:registration:");

// Email-based login limiter (5 attempts / 15 min per email)
const emailLoginLimiterBase = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  store: getRedisStore("ratelimit:email-login:"),
  keyGenerator: (req) => {
    const email = extractEmail(req);
    return email || extractIP(req);
  },
  message: formatRateLimitMessage(
    "Too many login attempts for this email, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});
export const emailLoginLimiter = upgradeToRedisStore(emailLoginLimiterBase, "ratelimit:email-login:");