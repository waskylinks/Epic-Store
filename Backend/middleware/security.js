import helmet from "helmet";
import hpp from "hpp";
import cors from "cors";
import rateLimit from "express-rate-limit";

/**
 * =========================
 * STARTUP GUARDS
 * =========================
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
 * FIX #1: Wildcard origin ("*") is incompatible with credentials: true.
 * Replaced with an explicit allowlist built from environment variables.
 * FRONTEND_URL can be a comma-separated list for multi-origin setups
 * (e.g. "https://www.example.com,https://app.example.com").
 * If the env var is missing we fall back to an empty list (deny all),
 * which is the safe default and will surface clearly in development.
 */
const buildAllowedOrigins = () => {
  const raw = process.env.FRONTEND_URL || "";
  if (!raw) {
    console.warn(
      "[CORS] FRONTEND_URL is not set. All cross-origin requests will be rejected. " +
      "Set FRONTEND_URL to a comma-separated list of allowed origins."
    );
    return [];
  }
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
};

export const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = buildAllowedOrigins();

    // Allow server-to-server / same-origin requests (origin is undefined)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error(`CORS: Origin '${origin}' is not allowed.`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
};

/**
 * =========================
 * RATE LIMITING (CREATED ONCE)
 * =========================
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
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
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
}