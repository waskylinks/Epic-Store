/**
 * utils/runCronJob.js
 *
 * Unified cron job wrapper.
 *
 * Replaces the individual isRunning flags, try/catch blocks, and ad-hoc
 * logging in each job file with a single consistent execution layer.
 *
 * Provides per-job:
 *   - Overlap protection (isRunning map, keyed by jobName)
 *   - Unique run ID generation
 *   - Start / end / duration logging in a consistent format
 *   - Failure detection and automatic cronAlert dispatch
 *   - Job health persistence to MongoDB (CronJobStatus model)
 *   - Returns a wrapped async function to pass directly to cron.schedule()
 *
 * Usage:
 *   cron.schedule(SCHEDULE, runCronJob({
 *     jobName:     'RecoveryEmailCron',
 *     alertOnFail: true,
 *     jobFn:       async () => { ... },
 *   }));
 */

import { sendCronAlert }     from './cronAlert.js';
import CronJobStatus         from '../models/CronJobStatus.js';

// Module-scoped running-state map — one boolean per jobName
const runningJobs = new Map();

/**
 * runCronJob
 *
 * @param {Object}   opts
 * @param {string}   opts.jobName        - Unique job identifier (matches Slack config keys)
 * @param {Function} opts.jobFn          - Async function containing job logic
 * @param {boolean}  [opts.alertOnFail]  - Send alert on failure (default: true)
 * @param {boolean}  [opts.alertOnSuccess] - Send alert on success (default: false)
 * @param {boolean}  [opts.persistHealth] - Write to CronJobStatus collection (default: true)
 * @returns {Function} Wrapped async function suitable for cron.schedule()
 */
export function runCronJob({
  jobName,
  jobFn,
  alertOnFail    = true,
  alertOnSuccess = false,
  persistHealth  = true,
}) {
  return async function wrappedJob() {
    // ── Overlap guard ──────────────────────────────────────────────────────
    if (runningJobs.get(jobName)) {
      console.warn(`[${jobName}] Previous run still in progress — skipping tick`);
      return;
    }

    runningJobs.set(jobName, true);

    const runId     = generateRunId(jobName);
    const startedAt = new Date();
    let   result    = null;
    let   jobError  = null;

    console.log(`\n[${jobName}] ▶ Run started | id=${runId} | ${startedAt.toISOString()}`);

    try {
      result = await jobFn();
    } catch (err) {
      jobError = err;
    } finally {
      runningJobs.set(jobName, false);
    }

    const finishedAt  = new Date();
    const durationMs  = finishedAt.getTime() - startedAt.getTime();
    const succeeded   = jobError === null;
    const status      = succeeded ? 'ok' : 'failed';

    // ── Logging ────────────────────────────────────────────────────────────
    if (succeeded) {
      console.log(
        `[${jobName}] ✓ Run complete | id=${runId}` +
        ` | duration=${durationMs}ms` +
        (result ? ` | result=${JSON.stringify(summariseResult(result))}` : '')
      );
    } else {
      console.error(
        `[${jobName}] ✗ Run failed | id=${runId}` +
        ` | duration=${durationMs}ms` +
        ` | error=${jobError.message}`
      );
      console.error(jobError.stack);
    }

    // ── Health persistence ─────────────────────────────────────────────────
    if (persistHealth) {
      await persistJobHealth({
        jobName,
        runId,
        status,
        startedAt,
        finishedAt,
        durationMs,
        lastError:  jobError?.message ?? null,
        result,
      });
    }

    // ── Alerts ─────────────────────────────────────────────────────────────
    if (!succeeded && alertOnFail) {
      await sendCronAlert({
        jobName,
        runId,
        status:    'failed',
        severity:  'critical',
        error:     jobError.message,
        durationMs,
        counts:    result ? summariseResult(result) : {},
      });
    }

    if (succeeded && alertOnSuccess) {
      await sendCronAlert({
        jobName,
        runId,
        status:    'ok',
        severity:  'info',
        durationMs,
        counts:    result ? summariseResult(result) : {},
      });
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

async function persistJobHealth({
  jobName, runId, status, startedAt, finishedAt, durationMs, lastError, result,
}) {
  try {
    await CronJobStatus.findOneAndUpdate(
      { jobName },
      {
        $set: {
          lastRunAt:      startedAt,
          lastFinishedAt: finishedAt,
          lastDurationMs: durationMs,
          lastRunId:      runId,
          status,
          lastError:      lastError ?? null,
          ...(status === 'ok'     && { lastSuccessAt: finishedAt }),
          ...(status === 'failed' && { lastFailureAt: finishedAt }),
          lastResult: result ? summariseResult(result) : null,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Never throw from health persistence — it must not affect the job itself
    console.error(`[${jobName}] Failed to persist health status:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function generateRunId(jobName) {
  const prefix = jobName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .slice(0, 12);
  return `${prefix}_${Date.now()}`;
}

/**
 * Extracts a safe summary of a job result for logging and storage.
 * Strips large arrays/objects to keep the stored document small.
 */
function summariseResult(result) {
  if (!result || typeof result !== 'object') return {};
  const safe = {};
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
      safe[key] = val;
    }
  }
  return safe;
}