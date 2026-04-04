import express        from 'express';
import CronJobStatus  from '../models/CronJobStatus.js';
import { runCleanup } from '../jobs/discount-cleanup.js';
import { runAuditCleanup } from '../jobs/audit-log-cleanup.js';
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";

const router = express.Router();

// Apply admin auth to all cron routes
router.use(verifyUserAuth, roleBaseAccess('admin', 'superAdmin'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/cron/health
//
// Returns health status for all registered cron jobs.
// Response shape:
// {
//   jobs: [
//     {
//       jobName, status, schedule, scheduleLabel,
//       lastRunAt, lastSuccessAt, lastFailureAt, lastDurationMs,
//       lastRunId, lastError, lastResult, updatedAt
//     }
//   ]
// }
// ─────────────────────────────────────────────────────────────────────────────

router.get('/health', async (req, res) => {
  try {
    const jobs = await CronJobStatus.getAll();
    res.json({ success: true, jobs });
  } catch (err) {
    console.error('[CronHealth] GET /health error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch cron health data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/admin/cron/trigger/:jobName
//
// Manually triggers a single job run for jobs that support it.
// Currently supports: DiscountCleanup, AuditCleanup
// RecoveryEmailCron and AbandonmentSweep are excluded from manual trigger
// since they have stateful side effects that require careful gating.
//
// Response shape:
// { success: true, result: { ...jobReturnValue } }
// ─────────────────────────────────────────────────────────────────────────────

const MANUAL_TRIGGER_JOBS = {
  DiscountCleanup: runCleanup,
  AuditCleanup:    runAuditCleanup,
};

router.post('/trigger/:jobName', async (req, res) => {
  const { jobName } = req.params;

  const jobFn = MANUAL_TRIGGER_JOBS[jobName];

  if (!jobFn) {
    return res.status(400).json({
      success: false,
      message: `Manual trigger not supported for job: ${jobName}. Supported: ${Object.keys(MANUAL_TRIGGER_JOBS).join(', ')}`,
    });
  }

  try {
    console.log(`[CronHealth] Manual trigger: ${jobName} by admin ${req.user?._id}`);
    const result = await jobFn();
    res.json({ success: true, jobName, result });
  } catch (err) {
    console.error(`[CronHealth] Manual trigger failed for ${jobName}:`, err.message);
    res.status(500).json({
      success: false,
      message: `Job ${jobName} failed: ${err.message}`,
    });
  }
});

export default router;