

import express            from 'express';
import { getCronJobHistory, getCronBanner } from '../controllers/cronLog-controller.js';
import { verifyUserAuth, roleBaseAccess }   from '../middleware/user-auth.js';

const router = express.Router();
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