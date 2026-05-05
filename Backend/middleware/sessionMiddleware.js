/**
 * backend/middleware/sessionMiddleware.js
 *
 * Phase 2 — Session Integrity Layer
 *
 * Responsibilities:
 *   1. Set a first-party httpOnly session cookie (epicstore_sid) on every
 *      request that does not already have one.
 *   2. Roll the cookie TTL on every request so the session stays alive
 *      as long as the user is active (inactivity-based expiry).
 *   3. Enrich req.sessionMeta from Redis (page views, session start time)
 *      as a non-blocking cache layer — never as a hard dependency.
 *   4. Expose req.sessionId so every downstream middleware and controller
 *      can attach it to analytics events without reading cookies manually.
 *
 * Design rules (from implementation guide):
 *
 *   CLIENT = source of session identity
 *   REDIS  = enhancer, not authority
 *
 *   If Redis is unavailable, the middleware catches the error silently,
 *   sets req.sessionMeta to a safe default, and calls next(). Sessions
 *   continue working — they just lose the page-view count enrichment.
 *   This keeps Redis as an optional performance layer, not a single
 *   point of failure in the request path.
 *
 *   Why httpOnly cookie instead of sessionStorage?
 *     sessionStorage is tab-scoped and destroyed by OAuth redirects.
 *     An httpOnly server-set cookie survives redirects, tab opens, and
 *     browser restores. The server controls the TTL — it cannot be
 *     tampered with by client-side JavaScript.
 *
 *   Why rolling TTL?
 *     A fixed TTL would log out an actively browsing user after a set
 *     time regardless of activity. Rolling TTL (refreshed on every
 *     request) expires the session only after SESSION_ROLLING_TTL
 *     seconds of true inactivity — matching user mental models.
 *
 * Mount order in app.js:
 *   app.use(cookieParser())        ← must come first
 *   app.use(sessionMiddleware)     ← Phase 2
 *   app.use(identityMiddleware)    ← Phase 2
 *   app.use(trackAttribution)      ← existing
 */

import { v4 as uuidv4 } from 'uuid';
import { getCache, setCache } from '../utils/redis.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SESSION_COOKIE  = 'epicstore_sid';
const TTL_SECONDS     = parseInt(process.env.SESSION_ROLLING_TTL) || 1800; // 30 min default
const REDIS_KEY_PREFIX = 'session_meta:';

// ─── COOKIE OPTIONS ───────────────────────────────────────────────────────────

/**
 * buildCookieOptions
 *
 * Centralised cookie config so secure/sameSite settings are consistent
 * between the initial set and every subsequent refresh.
 *
 * sameSite: 'lax' — allows the cookie to be sent on top-level navigations
 * (e.g. OAuth redirect returns) but blocks it on cross-site sub-requests.
 * This is the correct setting for a session cookie used with credentials: true.
 *
 * secure: true in production only — allows local HTTP dev without HTTPS.
 *
 * @returns {Object}
 */
const buildCookieOptions = () => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   TTL_SECONDS * 1000, // maxAge is in milliseconds for Express
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

/**
 * sessionMiddleware
 *
 * Express middleware. Attaches req.sessionId and req.sessionMeta to every
 * request. Sets or refreshes the epicstore_sid cookie.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
export const sessionMiddleware = async (req, res, next) => {
  let sessionId = req.cookies?.[SESSION_COOKIE];
  let isNewSession = false;

  // ── Create session if none exists ──────────────────────────────────────────
  if (!sessionId) {
    sessionId    = uuidv4();
    isNewSession = true;
  }

  // ── Roll the cookie TTL on every request ───────────────────────────────────
  // Setting the cookie again with maxAge resets the expiry clock.
  // This implements the rolling inactivity window.
  res.cookie(SESSION_COOKIE, sessionId, buildCookieOptions());

  // ── Attach session ID to request ───────────────────────────────────────────
  // Downstream middleware and controllers read req.sessionId.
  // Do not read from req.cookies[SESSION_COOKIE] directly in controllers —
  // always use req.sessionId so the middleware is the single source of truth.
  req.sessionId = sessionId;

  // ── Redis enrichment (non-blocking) ───────────────────────────────────────
  // Redis stores lightweight session metadata: page view count, session start
  // time. This data enriches analytics events but is never required for the
  // request to succeed. All Redis calls are wrapped in try/catch.
  try {
    const redisKey = `${REDIS_KEY_PREFIX}${sessionId}`;

    let meta = await getCache(redisKey);

    if (!meta || isNewSession) {
      // New session — initialise metadata
      meta = {
        pageViews: 0,
        startedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
    } else {
      // Existing session — increment page view count and update lastSeenAt
      meta.pageViews  = (meta.pageViews || 0) + 1;
      meta.lastSeenAt = new Date().toISOString();
    }

    // Persist back to Redis with rolling TTL
    await setCache(redisKey, meta, TTL_SECONDS);

    req.sessionMeta = meta;

  } catch (redisError) {
    // Redis unavailable — use safe default so the request is never blocked
    // Log the error for observability but do not throw
    console.error(
      '[sessionMiddleware] Redis enrichment failed (non-fatal):',
      redisError.message
    );
    req.sessionMeta = {
      pageViews:  0,
      startedAt:  new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
  }

  next();
};

// ─── SESSION UTILITIES ────────────────────────────────────────────────────────

/**
 * getSessionMeta
 *
 * Retrieves session metadata from Redis for a given session ID.
 * Used by the analytics observability controller to build session-grain
 * data for the BigQuery sessions table.
 *
 * Returns null if Redis is unavailable or the session has expired.
 *
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export const getSessionMeta = async (sessionId) => {
  if (!sessionId) return null;
  try {
    return await getCache(`${REDIS_KEY_PREFIX}${sessionId}`);
  } catch {
    return null;
  }
};

/**
 * invalidateSession
 *
 * Removes session metadata from Redis and clears the session cookie.
 * Called on logout to prevent stale session data accumulating in Redis.
 *
 * @param {string}                     sessionId
 * @param {import('express').Response} res
 */
export const invalidateSession = async (sessionId, res) => {
  // Clear the cookie
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  // Remove from Redis (non-blocking)
  if (sessionId) {
    try {
      const { deleteCache } = await import('../utils/redis.js');
      await deleteCache(`${REDIS_KEY_PREFIX}${sessionId}`);
    } catch (err) {
      console.error('[sessionMiddleware] Failed to invalidate session in Redis:', err.message);
    }
  }
};