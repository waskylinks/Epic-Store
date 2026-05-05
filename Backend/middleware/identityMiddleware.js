/**
 * backend/middleware/identityMiddleware.js
 *
 * Phase 2 — Anonymous ID & Identity Stitching
 *
 * Responsibilities:
 *   1. Set a long-lived first-party httpOnly anonymous ID cookie
 *      (epicstore_anon) on every request that does not already have one.
 *   2. Expose req.anonymousId so every downstream middleware and controller
 *      can attach it to analytics events without reading cookies manually.
 *   3. Provide a stitchIdentity() utility that controllers call after
 *      successful authentication to link the anonymous ID to the userId
 *      in CustomerAnalytics — enabling pre-auth → post-auth attribution
 *      in BigQuery.
 *
 * Design rules (from implementation guide):
 *
 *   Anonymous ID lifecycle:
 *     - Created on first request (before the user registers or logs in)
 *     - Persists for ANONYMOUS_ID_COOKIE_TTL days (default 365)
 *     - Survives across sessions, tab opens, and browser restores
 *     - Never regenerated unless the cookie is deleted by the user
 *     - Stored as an httpOnly cookie — not accessible to JavaScript,
 *       which prevents ad blockers from blocking it via script injection
 *
 *   Identity stitching:
 *     - On login or email verification, the anonymousId is added to
 *       CustomerAnalytics.anonymousIds (an array of all IDs ever used
 *       by this user — handles device switching)
 *     - The stitch is non-blocking: failure never delays the auth response
 *     - BigQuery JOINs events on anonymousId to reconstruct the full
 *       pre-auth journey for each user
 *
 *   Why not store anonymousId in localStorage?
 *     The frontend SDK does store a client-side session ID in localStorage
 *     for cross-tab session management. But the anonymousId is stored in
 *     an httpOnly server-set cookie because:
 *       1. It survives longer (365 days vs localStorage which can be cleared)
 *       2. It is automatically sent on every request without frontend code
 *       3. It cannot be blocked by script-level ad blockers
 *       4. Server-side events (webhooks, cron) also have access to it
 *
 * Mount order in app.js:
 *   app.use(cookieParser())        ← must come first
 *   app.use(sessionMiddleware)     ← Phase 2 — sets req.sessionId
 *   app.use(identityMiddleware)    ← Phase 2 — sets req.anonymousId
 *   app.use(trackAttribution)      ← existing — sets req.attribution
 */

import { v4 as uuidv4 } from 'uuid';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const ANON_COOKIE     = 'epicstore_anon';
const TTL_DAYS        = parseInt(process.env.ANONYMOUS_ID_COOKIE_TTL) || 365;
const TTL_MS          = TTL_DAYS * 24 * 60 * 60 * 1000;

// ─── COOKIE OPTIONS ───────────────────────────────────────────────────────────

const buildCookieOptions = () => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   TTL_MS,
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

/**
 * identityMiddleware
 *
 * Express middleware. Attaches req.anonymousId to every request.
 * Sets the epicstore_anon cookie if not already present.
 *
 * Unlike sessionMiddleware, the anonymous ID cookie is NOT rolled on every
 * request — it has a fixed expiry from the time of first creation. This
 * means the cookie expires 365 days after first visit, not 365 days after
 * the last request. This is intentional: we want the anonymous ID to be
 * stable and long-lived, not extended indefinitely by continued activity.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
export const identityMiddleware = (req, res, next) => {
  let anonymousId = req.cookies?.[ANON_COOKIE];

  if (!anonymousId) {
    // No anonymous ID exists — create one and set the cookie
    anonymousId = uuidv4();
    res.cookie(ANON_COOKIE, anonymousId, buildCookieOptions());
  }

  // Attach to request — downstream controllers read req.anonymousId
  req.anonymousId = anonymousId;

  next();
};

// ─── IDENTITY STITCHING ───────────────────────────────────────────────────────

/**
 * stitchIdentity
 *
 * Links an anonymous ID to an authenticated user in CustomerAnalytics.
 * Call this after successful authentication (login, verifyEmail, OAuth callback).
 *
 * Uses $addToSet to prevent duplicate anonymous IDs in the array.
 * A single user may have multiple anonymous IDs over time if they:
 *   - Use different devices
 *   - Clear their cookies
 *   - Use private browsing on a different device
 *
 * All of their anonymous IDs are preserved in the array so BigQuery can
 * JOIN on any of them to reconstruct the full pre-auth journey.
 *
 * This function is deliberately non-blocking:
 *   - It returns a Promise but controllers should not await it in the
 *     response path — use .catch() logging only
 *   - Failure is logged but never propagated to the user
 *   - The auth response is sent immediately regardless of stitch outcome
 *
 * Usage in login/verifyEmail controller:
 *   stitchIdentity(user._id, req.anonymousId).catch(err =>
 *     console.error('[Identity] Stitch failed:', err.message)
 *   );
 *
 * @param {string} userId        - Authenticated user MongoDB _id as string
 * @param {string} anonymousId   - Anonymous ID from req.anonymousId
 * @returns {Promise<void>}
 */
export const stitchIdentity = async (userId, anonymousId) => {
  if (!userId || !anonymousId) return;

  // Dynamic import to avoid circular dependency issues
  // CustomerAnalytics imports User which imports this middleware indirectly
  const { default: CustomerAnalytics } = await import('../models/customer-analytics-model.js');

  await CustomerAnalytics.findOneAndUpdate(
    { user: userId },
    {
      $addToSet: { anonymousIds: anonymousId },
      $set:      { lastStitchedAt: new Date() },
    },
    {
      // Do not create a new document — only stitch if CustomerAnalytics exists
      // CustomerAnalytics is created by verifyEmail/register handlers
      upsert: false,
      new:    false,
    }
  );
};

/**
 * stitchIdentityFromRequest
 *
 * Convenience wrapper that reads userId and anonymousId from the request.
 * Call this directly in controllers after successful authentication:
 *
 *   stitchIdentityFromRequest(req).catch(err =>
 *     console.error('[Identity] Stitch failed:', err.message)
 *   );
 *
 * @param {import('express').Request} req
 * @returns {Promise<void>}
 */
export const stitchIdentityFromRequest = async (req) => {
  const userId      = req.user?._id?.toString();
  const anonymousId = req.anonymousId;
  return stitchIdentity(userId, anonymousId);
};