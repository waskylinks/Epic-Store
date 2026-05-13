/**
 * backend/routes/analyticsObservabilityRoutes.js
 *
 * Phase 8 — Observability Routes
 *
 * All routes are admin-only — protected by your existing isAuthenticatedUser
 * and authorizeRoles('admin') middleware.
 *
 * Mount in app.js:
 *   import analyticsObservabilityRoutes from './routes/analyticsObservabilityRoutes.js';
 *   app.use('/api/v1/admin/analytics', analyticsObservabilityRoutes);
 *
 * ─── MOUNT ORDER IN app.js ────────────────────────────────────────────────────
 *
 * Add alongside your existing admin routes:
 *
 *   app.use('/api/v1/admin', adminStatsRoutes);          // existing
 *   app.use('/api/v1/admin/analytics', analyticsObservabilityRoutes); // ADD
 *
 * ─── ENDPOINTS ───────────────────────────────────────────────────────────────
 *
 *   GET /api/v1/admin/analytics/health
 *     Attribution health metrics for last 30 days.
 *     Returns: utm_capture_rate, click_id_capture_rate, confidence_distribution,
 *              reconstruction_rate, identity_match_rate, unattributed_rate
 *
 *   GET /api/v1/admin/analytics/drift
 *     Attribution drift report comparing last 7 days vs last 30 days.
 *     Returns: source-by-source drift analysis, alerts for >20pp shifts
 *
 *   GET /api/v1/admin/analytics/queue-health
 *     Event queue status: pending, failed, dead_letter counts.
 *     Returns: queue summary, per-platform failure counts, recent dead-letters
 *
 *   GET /api/v1/admin/analytics/trace/:userId
 *     Full event trace for a specific user.
 *     Returns: all orders with attribution, queue events, anonymous IDs
 */

import express from 'express';
import {
  getAttributionHealth,
  getAttributionDrift,
  getQueueHealth,
  getUserEventTrace,
} from '../controllers/analyticsObservabilityController.js';
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();


router.use(verifyUserAuth, roleBaseAccess("admin", "superAdmin"), adminAnalyticsLimiter);

router.get('/health',          getAttributionHealth);
router.get('/drift',           getAttributionDrift);
router.get('/queue-health',    getQueueHealth);
router.get('/trace/:userId',   getUserEventTrace);

export default router;