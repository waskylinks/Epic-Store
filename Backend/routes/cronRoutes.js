

import express             from 'express';
import CronJobStatus       from '../models/CronJobStatus.js';
import { runCleanup }      from '../jobs/discount-cleanup.js';
import { runAuditCleanup } from '../jobs/audit-log-cleanup.js';
import { runCheckoutRetention } from '../jobs/checkoutRetentionJob.js';
import { runRecoveryEmailRetention } from '../jobs/recoveryEmailRetentionJob.js';
import { processAnalyticsQueue } from '../jobs/analyticsQueue.js';
import { runCronJob }      from '../utils/runCronJob.js';
import {
  getCronJobHistory,
  getCronBanner,
}                          from '../controller/cronLog-controller.js';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';

const router = express.Router();

// Apply admin auth to every route in this router
router.use(verifyUserAuth, roleBaseAccess('admin', 'superAdmin'));

// ── Health & Status ──────────────────────────────────────────────────────
// GET /api/v1/admin/cron/health
router.get('/health', async (req, res) => {
  try {
    const jobs = await CronJobStatus.getAll();
    res.json({ success: true, jobs });
  } catch (err) {
    console.error('[CronHealth] Failed to fetch job statuses:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch cron health' });
  }
});

// ── Logs & Banner ────────────────────────────────────────────────────────
// GET /api/v1/admin/cron/logs/:jobName
router.get('/logs/:jobName', getCronJobHistory);

// GET /api/v1/admin/cron/banner
router.get('/banner', getCronBanner);

// ── Manual Trigger ───────────────────────────────────────────────────────
const MANUAL_TRIGGER_JOBS = {
  DiscountCleanup:        runCleanup,
  AuditCleanup:           runAuditCleanup,
  CheckoutRetention:      runCheckoutRetention,
  RecoveryEmailRetention: runRecoveryEmailRetention,
  AnalyticsQueue:         processAnalyticsQueue,
};

router.post('/trigger/:jobName', async (req, res) => {
  const { jobName } = req.params;

  // Validate jobName against the allowlist before touching any job function.
  // This prevents an attacker with admin credentials from probing arbitrary
  // job names or causing unexpected side effects.
  if (!Object.prototype.hasOwnProperty.call(MANUAL_TRIGGER_JOBS, jobName)) {
    return res.status(400).json({
      success: false,
      message: `Manual trigger not supported for job: ${jobName}. Supported: ${Object.keys(MANUAL_TRIGGER_JOBS).join(', ')}`,
    });
  }

  const jobFn = MANUAL_TRIGGER_JOBS[jobName];

  try {
    console.log(
      `[CronTrigger] Manual trigger: ${jobName}` +
      ` | admin=${req.user?._id}` +
      ` | ip=${req.ip}`
    );

    // Run through the full runCronJob wrapper so health + log persistence,
    // overlap protection, and alert dispatch all apply identically to a
    // scheduled run. triggeredBy: 'manual' stamps the CronJobLog entry.
    const wrappedFn = runCronJob({
      jobName,
      jobFn,
      alertOnFail: true,
      triggeredBy: 'manual',
    });

    await wrappedFn();

    // Fetch the freshly-written CronJobStatus to return the result to the UI
    const status = await CronJobStatus.findOne({ jobName }).lean();

    res.json({
      success: true,
      jobName,
      result:  status?.lastResult ?? {},
    });
  } catch (err) {
    console.error(`[CronTrigger] Manual trigger failed for ${jobName}:`, err.message);
    res.status(500).json({
      success: false,
      message: `Job ${jobName} failed: ${err.message}`,
    });
  }
});

export default router;