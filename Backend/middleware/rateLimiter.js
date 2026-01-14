import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import redisClient from '../utils/redis.js';

/* ================= HELPERS ================= */

// Safely extract email from request
const extractEmail = (req) => {
  let email = req.body?.email;
  if (typeof email === "object" && email?.email) email = email.email;
  if (!email || typeof email !== "string") return null;
  return email.toLowerCase();
};

// Extract IP address
const extractIP = (req) => {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || 'unknown';
};

// Standardized rate limit response
const formatRateLimitMessage = (customMessage) => ({
  success: false,
  message: customMessage,
});

/* ================= REDIS STORE FACTORY ================= */

// Lazily create a RedisStore after redisClient is connected
const createRedisStore = (prefix) => {
  if (!redisClient.isOpen) {
    throw new Error(`Redis is not connected yet. Cannot create rate limiter store for prefix "${prefix}"`);
  }

  return new RedisStore({
    prefix,
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
};

/* ================= RATE LIMITERS ================= */

// General API limiter (100 requests / 15 min)
export const apiLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  store: createRedisStore("ratelimit:api:"),
  message: formatRateLimitMessage(
    "Too many requests from this IP, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication limiter (5 failed attempts / 15 min)
export const authLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  store: createRedisStore("ratelimit:auth:"),
  message: formatRateLimitMessage(
    "Too many authentication attempts, please try again after 15 minutes"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Email sending limiter (3 requests / hour)
export const emailLimiter = () => rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: createRedisStore("ratelimit:email:"),
  message: formatRateLimitMessage(
    "Too many email requests, please try again after an hour"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset limiter (3 attempts / hour per email)
export const passwordResetLimiter = () => rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: createRedisStore("ratelimit:password-reset:"),
  keyGenerator: (req) => {
    const email = extractEmail(req);
    return email || extractIP(req); // RedisStore prefix already added
  },
  message: formatRateLimitMessage(
    "Too many password reset attempts for this email, please try again after an hour"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration limiter (3 registrations / hour per IP)
export const registrationLimiter = () => rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: createRedisStore("ratelimit:registration:"),
  message: formatRateLimitMessage(
    "Too many registration attempts from this IP, please try again after an hour"
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Email-based login limiter (5 attempts / 15 min per email)
export const emailLoginLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  store: createRedisStore("ratelimit:email-login:"),
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
