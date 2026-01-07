import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Authentication routes rate limiter (stricter)
 * 5 requests per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message:
      "Too many authentication attempts, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

/**
 * Email sending rate limiter (prevent spam)
 * 3 emails per hour per IP
 */
export const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    message: "Too many email requests, please try again after an hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Password reset rate limiter
 * 3 attempts per hour per email (fallback to IP)
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,

  keyGenerator: (req) => {
    if (req.body?.email) {
      return `password-reset:${req.body.email.toLowerCase()}`;
    }
    return ipKeyGenerator(req);
  },

  message: {
    success: false,
    message:
      "Too many password reset attempts for this email, please try again after an hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Registration rate limiter
 * 3 registrations per hour per IP
 */
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    message:
      "Too many registration attempts from this IP, please try again after an hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
