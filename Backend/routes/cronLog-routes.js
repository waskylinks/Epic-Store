/**
 * routes/cronLogRoutes.js
 *
 * Read-only routes for cron run history and the checkout analytics banner.
 *
 * Mounting in the main router:
 *   import cronLogRoutes from './routes/cronLogRoutes.js';
 *   app.use('/api/v1/admin/cron', cronLogRoutes);
 *
 * Note: this file is intentionally separate from the existing cronRoutes.js
 * (which handles /health and /trigger) so that the two concerns — operational
 * job control vs. log history — can evolve independently. They share the same
 * mount point prefix, so the auth middleware in the existing router already
 * covers these routes if they are merged there; otherwise the auth middleware
 * is applied here directly.
 *
 * Security:
 *   - Both routes require a valid session token (verifyUserAuth).
 *   - Both routes are restricted to admin and superAdmin roles (roleBaseAccess).
 *   - No write operations are exposed — GET only.
 *   - jobName path parameter is validated inside the controller against an
 *     allowlist; the router does not need to duplicate that check.
 */

import express            from 'express';
import { getCronJobHistory, getCronBanner } from '../controllers/cronLog-controller.js';
import { verifyUserAuth, roleBaseAccess }   from '../middleware/user-auth.js';

const router = express.Router();

// Apply admin auth to all routes in this router
router.use(verifyUserAuth, roleBaseAccess('admin', 'superAdmin'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/cron/logs/:jobName
//
// Cursor-paginated run history for a specific registered cron job.
//
// Path params:
//   jobName {string} — must be a member of VALID_JOB_NAMES (validated in controller)
//
// Query params:
//   limit  {number}  — results per page, 1–100, default 20
//   cursor {string}  — opaque pagination cursor from previous response
//
// Response:
//   { success, jobName, logs[], hasNextPage, nextCursor }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/logs/:jobName', getCronJobHistory);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/cron/banner
//
// Lightweight endpoint returning recent run data for checkout-analytics-
// relevant jobs. Called on every checkout analytics page mount.
// Response is Redis-cached at 60s TTL.
//
// Response:
//   { success, jobs: [{ jobName, status, startedAt, counts, error, triggeredBy }] }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/banner', getCronBanner);

export default router;