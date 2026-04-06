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

import { startAbandonmentSweep, stopAbandonmentSweep } from './abandonmentSweep.js';
import { startDiscountCleanupJob }                     from './discount-cleanup.js';
import { startAuditCleanupJob }                        from './audit-log-cleanup.js';
import {
  startRecoveryEmailCron,
  stopRecoveryEmailCron,
} from './recoveryEmailCron.js';
import { cronConfig }    from '../config/cronConfig.js';
import CronJobStatus     from '../models/CronJobStatus.js';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE LABEL HELPER
//
// Converts a cron expression into a human-readable string.
// Keeps the registry entry accurate regardless of what RECOVERY_CRON_SCHEDULE
// (or any other env var) is set to — no more hardcoded "Every 30 minutes".
// ─────────────────────────────────────────────────────────────────────────────

function describeSchedule(expr) {
  if (!expr) return 'Unknown schedule';

  const map = {
    '* * * * *':      'Every 1 minute',
    '*/1 * * * *':    'Every 1 minute',
    '*/2 * * * *':    'Every 2 minutes',
    '*/5 * * * *':    'Every 5 minutes',
    '*/10 * * * *':   'Every 10 minutes',
    '*/15 * * * *':   'Every 15 minutes',
    '*/20 * * * *':   'Every 20 minutes',
    '*/30 * * * *':   'Every 30 minutes',
    '0,30 * * * *':   'Every 30 minutes',
    '0 * * * *':      'Every hour',
    '*/60 * * * *':   'Every hour',
    '0 */2 * * *':    'Every 2 hours',
    '0 */6 * * *':    'Every 6 hours',
    '0 */12 * * *':   'Every 12 hours',
    '0 0 * * *':      'Daily at midnight',
    '0 1 * * *':      'Daily at 1 AM',
    '0 2 * * *':      'Daily at 2 AM',
    '0 3 * * *':      'Daily at 3 AM',
    '0 4 * * *':      'Daily at 4 AM',
    '0 0 * * 0':      'Weekly on Sunday',
    '0 0 1 * *':      'Monthly on the 1st',
  };

  return map[expr] ?? `Schedule: ${expr}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB REGISTRY DEFINITION
//
// Each entry describes a cron job for registration logging and CronJobStatus
// seeding. The actual cron scheduling lives inside each job's start function.
//
// IMPORTANT: scheduleLabel is now derived dynamically via describeSchedule()
// so it always reflects the live cronConfig value — never a stale hardcoded
// string. This is what the cron health page reads from CronJobStatus.
// ─────────────────────────────────────────────────────────────────────────────

const JOB_REGISTRY = [
  {
    jobName:       'AbandonmentSweep',
    schedule:      process.env.NODE_ENV === 'production'
      ? cronConfig.abandonmentSweep.scheduleProduction
      : cronConfig.abandonmentSweep.scheduleDevelopment,
    get scheduleLabel() {
      return describeSchedule(this.schedule);
    },
    startFn:       startAbandonmentSweep,
    stopFn:        stopAbandonmentSweep ?? null,
    note:          'Must start before RecoveryEmailCron to clear stale pendingAck records',
  },
  {
    jobName:       'DiscountCleanup',
    schedule:      cronConfig.discountCleanup.cronExpression,
    get scheduleLabel() {
      return describeSchedule(this.schedule);
    },
    startFn:       startDiscountCleanupJob,
    stopFn:        null,
  },
  {
    jobName:       'AuditCleanup',
    schedule:      cronConfig.auditCleanup.cronExpression,
    get scheduleLabel() {
      return describeSchedule(this.schedule);
    },
    startFn:       startAuditCleanupJob,
    stopFn:        null,
  },
  {
    jobName:       'RecoveryEmailCron',
    schedule:      cronConfig.recoveryEmail.schedule,
    get scheduleLabel() {
      return describeSchedule(this.schedule);
    },
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
      // Seed CronJobStatus document before the job's first run.
      // Uses $set so schedule + scheduleLabel always reflect the live config
      // after a restart — even if the schedule changed since last boot.
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