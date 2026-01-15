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

/* ================= WEBHOOK RATE LIMITERS (NEW) ================= */

/**
 * Webhook rate limiter - prevents abuse of webhook endpoints
 * 100 requests per minute per gateway
 * This is lenient enough for legitimate webhook traffic but strict enough to prevent DoS
 */
const webhookLimiterBase = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  store: getRedisStore("ratelimit:webhook:"),
  keyGenerator: (req) => {
    // Rate limit per gateway provider (paystack, flutterwave, stripe)
    const path = req.path || req.originalUrl || '';
    if (path.includes('paystack')) return 'webhook:paystack';
    if (path.includes('flutterwave')) return 'webhook:flutterwave';
    if (path.includes('stripe')) return 'webhook:stripe';
    return extractIP(req); // Fallback to IP
  },
  message: {
    success: false,
    message: "Too many webhook requests, please try again later"
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Don't skip successful requests - we want to count all webhook attempts
  skipSuccessfulRequests: false,
  // Don't skip failed requests either
  skipFailedRequests: false
});
export const webhookLimiter = upgradeToRedisStore(webhookLimiterBase, "ratelimit:webhook:");

/**
 * Payment initialization rate limiter
 * Prevents rapid payment initialization abuse
 * 10 payment initializations per 5 minutes per user
 */
const paymentInitLimiterBase = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  store: getRedisStore("ratelimit:payment-init:"),
  keyGenerator: (req) => {
    // Rate limit per authenticated user
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

/**
 * Payment verification rate limiter
 * Prevents payment verification spam
 * 20 verification attempts per 5 minutes per user
 * (Higher than initialization because users might retry on network errors)
 */
const paymentVerifyLimiterBase = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  store: getRedisStore("ratelimit:payment-verify:"),
  keyGenerator: (req) => {
    // Rate limit per authenticated user
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