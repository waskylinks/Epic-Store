/**
 * routes/cronRoutes.js  (previously the admin cron router)
 *
 * Unified admin cron router — health, trigger, history, and banner.
 *
 * EDIT SUMMARY (vs previous version):
 *   1. Imported getCronJobHistory and getCronBanner from cronLogController.js
 *   2. Mounted GET /logs/:jobName  → getCronJobHistory
 *   3. Mounted GET /banner         → getCronBanner
 *   4. Added CheckoutRetention to MANUAL_TRIGGER_JOBS, mapped to
 *      runCheckoutRetention from checkoutRetentionJob.js.
 *      The retention job is safe for manual trigger because it gates on
 *      document age (server-side cutoff dates), not on timing-sensitive
 *      state like the recovery email cooldown windows.
 *   5. Manual trigger now passes triggeredBy: 'manual' into runCronJob()
 *      so CronJobLog records the correct source and the banner can surface
 *      it to the admin ("Triggered manually by admin").
 *
 * Mount point: app.use('/api/v1/admin/cron', cronRouter)
 *
 * All routes are protected by verifyUserAuth + roleBaseAccess at the top
 * of this router — no per-route auth decoration needed.
 */

import express             from 'express';
import CronJobStatus       from '../models/CronJobStatus.js';
import { runCleanup }      from '../jobs/discount-cleanup.js';
import { runAuditCleanup } from '../jobs/audit-log-cleanup.js';
import { runCheckoutRetention } from '../jobs/checkoutRetentionJob.js';
import { runCronJob }      from '../utils/runCronJob.js';
import {
  getCronJobHistory,
  getCronBanner,
}                          from '../controller/cronLog-controller.js';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import { runRecoveryEmailRetention } from '../jobs/recoveryEmailRetentionJob.js';

const router = express.Router();

// Apply admin auth to every route in this router
router.use(verifyUserAuth, roleBaseAccess('admin', 'superAdmin'));

const MANUAL_TRIGGER_JOBS = {
  DiscountCleanup:        runCleanup,
  AuditCleanup:           runAuditCleanup,
  CheckoutRetention:      runCheckoutRetention,
  RecoveryEmailRetention: runRecoveryEmailRetention,
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