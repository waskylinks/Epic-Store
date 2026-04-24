/**
 * jobs/cronRegistry.js
 *
 * Single registration point for all cron jobs.
 * Replaces the four individual startX() calls scattered through server.js.
 *
 * Responsibilities:
 *   - Enforces startup ordering (abandonmentSweep before recoveryEmailCron)
 *   - Registers each job's schedule metadata in CronJobStatus at boot
 *   - Emits a consolidated registration log on startup
 *   - Exports startAllCronJobs() and stopAllCronJobs() for server.js
 *
 * EDIT SUMMARY (vs previous version):
 *   - Added CheckoutRetention import and JOB_REGISTRY entry.
 *     Positioned after AuditCleanup in the registry so all daily maintenance
 *     jobs are grouped before the monthly retention job. Ordering is not
 *     functionally significant here (retention runs monthly on the 1st at 4 AM,
 *     well after all daily jobs complete), but grouping aids readability.
 *
 * Integration in server.js:
 *   REMOVE:
 *     import { startDiscountCleanupJob }  from './jobs/discount-cleanup.js';
 *     import { startAuditCleanupJob }     from './jobs/audit-log-cleanup.js';
 *     import { startAbandonmentSweep }    from './jobs/abandonmentSweep.js';
 *     import { startRecoveryEmailCron, stopRecoveryEmailCron } from './jobs/recoveryEmailCron.js';
 *     ...
 *     startAbandonmentSweep();
 *     startDiscountCleanupJob();
 *     startAuditCleanupJob();
 *     startRecoveryEmailCron();
 *
 *   ADD:
 *     import { startAllCronJobs, stopAllCronJobs } from './jobs/cronRegistry.js';
 *     ...
 *     await startAllCronJobs();
 *     ...
 *     // In SIGTERM / unhandledRejection handlers:
 *     stopAllCronJobs();
 */

import { startAbandonmentSweep, stopAbandonmentSweep }       from './abandonmentSweep.js';
import { startDiscountCleanupJob }                            from './discount-cleanup.js';
import { startAuditCleanupJob }                               from './audit-log-cleanup.js';
import { startRecoveryEmailCron, stopRecoveryEmailCron }      from './recoveryEmailCron.js';
import {
  startCheckoutRetentionJob,
  stopCheckoutRetentionJob,
}                                                             from './checkoutRetentionJob.js';
import { cronConfig }    from '../config/cronConfig.js';
import CronJobStatus     from '../models/CronJobStatus.js';

// ─────────────────────────────────────────────────────────────────────────────
// JOB REGISTRY DEFINITION
//
// Each entry describes a cron job for registration logging and CronJobStatus
// seeding. The actual cron scheduling lives inside each job's start function.
// ─────────────────────────────────────────────────────────────────────────────

const JOB_REGISTRY = [
  {
    jobName:       'AbandonmentSweep',
    scheduleLabel: process.env.NODE_ENV === 'production' ? 'Every 30 minutes' : 'Every 5 minutes',
    schedule:      process.env.NODE_ENV === 'production'
      ? cronConfig.abandonmentSweep.scheduleProduction
      : cronConfig.abandonmentSweep.scheduleDevelopment,
    startFn:       startAbandonmentSweep,
    stopFn:        stopAbandonmentSweep ?? null,
    note:          'Must start before RecoveryEmailCron to clear stale pendingAck records',
  },
  {
    jobName:       'DiscountCleanup',
    scheduleLabel: 'Daily at 2 AM',
    schedule:      cronConfig.discountCleanup.cronExpression,
    startFn:       startDiscountCleanupJob,
    stopFn:        null,
  },
  {
    jobName:       'AuditCleanup',
    scheduleLabel: 'Daily at 3 AM',
    schedule:      cronConfig.auditCleanup.cronExpression,
    startFn:       startAuditCleanupJob,
    stopFn:        null,
  },
  {
    // Monthly three-pass data lifecycle job.
    // Runs at 4 AM on the 1st of every month — after all daily jobs, before
    // business hours in any timezone when UTC is the server clock.
    // Safe to trigger manually via POST /api/v1/admin/cron/trigger/CheckoutRetention.
    jobName:       'CheckoutRetention',
    scheduleLabel: 'Monthly — 4 AM on the 1st',
    schedule:      cronConfig.checkoutRetention.cronExpression,
    startFn:       startCheckoutRetentionJob,
    stopFn:        stopCheckoutRetentionJob,
    note:          'Warm prune (90d) → cold archive (365d) → hard delete (7yr, production only)',
  },
  {
    jobName:       'RecoveryEmailCron',
    scheduleLabel: `Every 30 minutes (configurable via RECOVERY_CRON_SCHEDULE)`,
    schedule:      cronConfig.recoveryEmail.schedule,
    startFn:       startRecoveryEmailCron,
    stopFn:        stopRecoveryEmailCron,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// START ALL
// ─────────────────────────────────────────────────────────────────────────────

export async function startAllCronJobs() {
  console.log('\n🕒 Registering scheduled jobs…');

  for (const job of JOB_REGISTRY) {
    try {
      // Seed CronJobStatus document before the job's first run
      await CronJobStatus.registerJob(job.jobName, job.schedule, job.scheduleLabel);

      // Start the job
      job.startFn();

      console.log(
        `   ✓ ${job.jobName.padEnd(22)} — ${job.scheduleLabel}` +
        (job.note ? `\n     ↳ ${job.note}` : '')
      );
    } catch (err) {
      console.error(`   ✗ ${job.jobName} — failed to start: ${err.message}`);
    }
  }

  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// STOP ALL
// ─────────────────────────────────────────────────────────────────────────────

export function stopAllCronJobs() {
  console.log('🛑 Stopping scheduled jobs…');

  for (const job of JOB_REGISTRY) {
    if (typeof job.stopFn === 'function') {
      try {
        job.stopFn();
        console.log(`   ✓ ${job.jobName} stopped`);
      } catch (err) {
        console.error(`   ✗ ${job.jobName} — error during stop: ${err.message}`);
      }
    }
  }
}