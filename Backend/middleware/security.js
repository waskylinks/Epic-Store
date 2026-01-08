import helmet from "helmet";
import hpp from "hpp";
import cors from "cors";
import rateLimit from "express-rate-limit";

/**
 * =========================
 * STARTUP GUARDS
 * =========================
 * These checks prevent middleware from mutating read-only req properties.
 */
export function startupGuards(app) {
  if (!app || typeof app.use !== "function") {
    throw new Error("Express app instance required for security middleware.");
  }
}

/**
 * =========================
 * CORS CONFIGURATION
 * =========================
 */
export const corsOptions = {
  origin: process.env.FRONTEND_URL || "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
};

/**
 * =========================
 * RATE LIMITING
 * =========================
 * Protects against brute-force and API abuse
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});

/**
 * =========================
 * HELMET SECURITY HEADERS
 * =========================
 */
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  hidePoweredBy: true,
});

/**
 * =========================
 * PREVENT PARAMETER POLLUTION
 * =========================
 */
export const hppProtection = hpp();

/**
 * =========================
 * ADDITIONAL CUSTOM HEADERS
 * =========================
 */
export function additionalSecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block"); // fallback
  next();
}

/**
 * =========================
 * INPUT SANITIZATION PLACEHOLDER
 * =========================
 * Instead of mutating req.query/body globally, validate & sanitize per-route
 * using express-validator or manual checks in controllers.
 */
export function validateQueryMiddleware(validators = []) {
  return async (req, res, next) => {
    try {
      for (const validatorFn of validators) {
        await validatorFn(req);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * =========================
 * USAGE:
 * =========================
 * import express from "express";
 * import {
 *   startupGuards,
 *   corsOptions,
 *   helmetConfig,
 *   hppProtection,
 *   apiLimiter,
 *   additionalSecurityHeaders
 * } from "./middleware/security.js";
 * 
 * const app = express();
 * startupGuards(app);
 * app.use(cors(corsOptions));
 * app.use(helmetConfig);
 * app.use(hppProtection);
 * app.use(apiLimiter);
 * app.use(additionalSecurityHeaders);
 */
