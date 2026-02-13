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
  if (redisStoreCache[prefix]) {
    return redisStoreCache[prefix];
  }

  if (redisClient.isOpen) {
    const store = new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    });
    redisStoreCache[prefix] = store;
    return store;
  }

  return undefined;
};

const upgradeToRedisStore = (limiter, prefix) => {
  return (req, res, next) => {
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

/* ================= EXISTING RATE LIMITERS ================= */

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

/* ================= WEBHOOK RATE LIMITERS ================= */

const webhookLimiterBase = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  store: getRedisStore("ratelimit:webhook:"),
  keyGenerator: (req) => {
    const path = req.path || req.originalUrl || '';
    if (path.includes('paystack')) return 'webhook:paystack';
    if (path.includes('flutterwave')) return 'webhook:flutterwave';
    if (path.includes('stripe')) return 'webhook:stripe';
    return extractIP(req);
  },
  message: {
    success: false,
    message: "Too many webhook requests, please try again later"
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});
export const webhookLimiter = upgradeToRedisStore(webhookLimiterBase, "ratelimit:webhook:");

const paymentInitLimiterBase = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  store: getRedisStore("ratelimit:payment-init:"),
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString();
    return userId || extractIP(req);
  },
  message: formatRateLimitMessage(
    "Too many payment initialization attempts, please try again in 5 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});
export const paymentInitLimiter = upgradeToRedisStore(paymentInitLimiterBase, "ratelimit:payment-init:");

const paymentVerifyLimiterBase = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  store: getRedisStore("ratelimit:payment-verify:"),
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString();
    return userId || extractIP(req);
  },
  message: formatRateLimitMessage(
    "Too many payment verification attempts, please try again in 5 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});
export const paymentVerifyLimiter = upgradeToRedisStore(paymentVerifyLimiterBase, "ratelimit:payment-verify:");

/* ================= PUBLIC PRODUCT API RATE LIMITERS ================= */

/**
 * Public product browsing limiter
 * For trending, new arrivals, featured, bestsellers endpoints
 * 150 requests / 15 min (more lenient for browsing)
 */
const publicProductLimiterBase = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  store: getRedisStore("ratelimit:public-products:"),
  message: formatRateLimitMessage(
    "Too many product browsing requests, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again in a few minutes.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});
export const publicProductLimiter = upgradeToRedisStore(publicProductLimiterBase, "ratelimit:public-products:");

/* ================= ADMIN ANALYTICS RATE LIMITER (FIXED) ================= */

/**
 * Admin analytics rate limiter
 * 
 * PROBLEM SOLVED:
 * - Dashboard loads 16 API calls per timeframe
 * - Switching day→month = 32 calls in 2 seconds
 * - Old limit (50/15min) hit after 3 timeframe changes
 * 
 * FIX:
 * - Increased to 200 requests / 15 min per admin
 * - Allows ~12 timeframe changes per 15 minutes
 * - Redis cache (300s) prevents duplicate DB hits
 * - Rate limit protects against true abuse, not normal dashboard use
 */
const adminAnalyticsLimiterBase = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // FIXED: Increased from 50 to accommodate dashboard's 16 calls per load
  store: getRedisStore("ratelimit:admin-analytics:"),
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString();
    return userId ? `admin:${userId}` : extractIP(req);
  },
  message: formatRateLimitMessage(
    "Too many analytics requests, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // IMPROVEMENT: Better error response with retry info
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    res.status(429).json({
      success: false,
      message: 'Too many analytics requests. Please wait a moment before switching timeframes again.',
      retryAfter,
      limit: req.rateLimit.limit,
      current: req.rateLimit.current
    });
  }
});
export const adminAnalyticsLimiter = upgradeToRedisStore(adminAnalyticsLimiterBase, "ratelimit:admin-analytics:");