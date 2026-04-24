/**
 * models/CronJobLog.js
 *
 * Append-only run history for every registered cron job.
 * One document per job execution — written by runCronJob.js after each run.
 *
 * Design principles:
 *   1. APPEND-ONLY — no update or delete routes are ever exposed. Documents
 *      are created once and read forever (until the TTL index removes them).
 *
 *   2. TTL-managed — documents older than 90 days are automatically removed
 *      by MongoDB's TTL index on `startedAt`. This is operational log data,
 *      not compliance data. 90 days gives ample window for trend review and
 *      banner display without unbounded collection growth.
 *
 *   3. LIGHTWEIGHT — `counts` stores only scalar values (numbers, strings,
 *      booleans) extracted by summariseResult() in runCronJob.js. No arrays
 *      or nested objects are stored here.
 *
 *   4. BANNER-SAFE — getLastRunSince() is the hot path called on every
 *      checkout analytics page load. It uses the compound index
 *      { jobName, startedAt } and returns a minimal projection to keep
 *      the query as cheap as possible.
 *
 * Indexes:
 *   - { jobName: 1, startedAt: -1 }  — primary query path for history + banner
 *   - { startedAt: 1 }               — TTL index (expireAfterSeconds = 90 days)
 *   - { status: 1 }                  — health summary filter
 */

import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const TTL_SECONDS  = 90 * 24 * 60 * 60; // 90 days
const MAX_CURSOR   = 100;               // hard cap on paginated history limit
const ERROR_MAX_LEN = 2000;            // mirror CronJobStatus cap

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const cronJobLogSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────────────────
    jobName: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
    },

    runId: {
      type:     String,
      required: true,
      trim:     true,
    },

    // ── Outcome ───────────────────────────────────────────────────────────────
    // 'ok'      — job completed without throwing
    // 'failed'  — job threw an unhandled error
    // 'partial' — job completed but reported a count mismatch or threshold breach
    status: {
      type:    String,
      enum:    ['ok', 'failed', 'partial'],
      default: 'ok',
    },

    // ── Timing ───────────────────────────────────────────────────────────────
    startedAt:  { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, default: null },

    // ── Job-specific result summary ───────────────────────────────────────────
    // Only scalar values (number / string / boolean) are stored.
    // Shape varies by job:
    //   AbandonmentSweep:    { marked, errors, batches, reAbandoned }
    //   CheckoutRetention:   { pruned, archived, hardDeleted, errors }
    //   AuditCleanup:        { flagged, deleted, safetyReset }
    //   DiscountCleanup:     { expired, deleted }
    //   RecoveryEmailCron:   { evaluated, sent, skipped, failed, expiredMarked }
    counts: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ── Error detail ─────────────────────────────────────────────────────────
    // Capped at ERROR_MAX_LEN to prevent document bloat.
    error: {
      type:    String,
      default: null,
      set:     (v) => (v ? String(v).slice(0, ERROR_MAX_LEN) : null),
    },

    // ── Trigger source ────────────────────────────────────────────────────────
    // 'cron'   — fired by node-cron scheduler
    // 'manual' — fired via POST /api/v1/admin/cron/trigger/:jobName
    triggeredBy: {
      type:    String,
      enum:    ['cron', 'manual'],
      default: 'cron',
    },
  },
  {
    // createdAt mirrors startedAt for convenience in lean queries.
    // updatedAt is intentionally omitted — this schema is append-only.
    timestamps: { createdAt: true, updatedAt: false },
    strict:     true,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

// Primary query path: history + banner. Covers:
//   db.cronJobLogs.find({ jobName }).sort({ startedAt: -1 }).limit(N)
//   db.cronJobLogs.find({ jobName, startedAt: { $gte: cutoff } }).sort({ startedAt: -1 })
cronJobLogSchema.index(
  { jobName: 1, startedAt: -1 },
  { name: 'job_history_idx' }
);

// Compound cursor index for keyset pagination.
// Handles the edge case of two runs starting at the same millisecond.
cronJobLogSchema.index(
  { jobName: 1, startedAt: -1, _id: -1 },
  { name: 'job_history_cursor_idx' }
);

// TTL — MongoDB auto-removes documents 90 days after startedAt.
// expireAfterSeconds: 0 means "expire at the date stored in the field"
// but we use a fixed offset instead by setting the field to startedAt
// and letting TTL_SECONDS drive deletion.
cronJobLogSchema.index(
  { startedAt: 1 },
  { expireAfterSeconds: TTL_SECONDS, name: 'ttl_90d_idx' }
);

// Health summary filter — used by getHealthSummary().
cronJobLogSchema.index({ status: 1 }, { name: 'status_idx' });

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getRecentByJob
 *
 * Cursor-paginated run history for a specific job.
 * Used by GET /api/v1/admin/cron/logs/:jobName.
 *
 * Cursor encodes { startedAt, id } so we can order by time and break ties
 * on _id — prevents skipping documents when two runs share a startedAt ms.
 *
 * @param {string}  jobName
 * @param {number}  limit   — capped internally at MAX_CURSOR (100)
 * @param {string}  [cursor] — base64-encoded { startedAt, id }
 * @returns {Promise<{ logs: Array, hasNextPage: boolean, nextCursor: string|null }>}
 */
cronJobLogSchema.statics.getRecentByJob = async function (jobName, limit = 20, cursor = null) {
  if (!jobName || typeof jobName !== 'string') {
    throw new Error('jobName is required and must be a string');
  }

  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), MAX_CURSOR);

  const filter = { jobName };

  if (cursor) {
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch {
      throw new Error('Invalid cursor: malformed base64 or JSON');
    }

    if (!decoded.startedAt || !decoded.id) {
      throw new Error('Invalid cursor: missing startedAt or id');
    }

    // Keyset: documents with startedAt < cursor, OR same startedAt with _id < cursor._id
    filter.$or = [
      { startedAt: { $lt: new Date(decoded.startedAt) } },
      {
        startedAt: new Date(decoded.startedAt),
        _id:       { $lt: new mongoose.Types.ObjectId(decoded.id) },
      },
    ];
  }

  // Fetch one extra to determine hasNextPage without a separate COUNT query
  const logs = await this.find(filter)
    .sort({ startedAt: -1, _id: -1 })
    .limit(safeLimit + 1)
    .select('jobName runId status startedAt finishedAt durationMs counts error triggeredBy')
    .lean();

  const hasNextPage = logs.length > safeLimit;
  if (hasNextPage) logs.pop();

  let nextCursor = null;
  if (hasNextPage && logs.length > 0) {
    const last = logs[logs.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ startedAt: last.startedAt.toISOString(), id: last._id.toString() })
    ).toString('base64');
  }

  return { logs, hasNextPage, nextCursor };
};

/**
 * getLastRunSince
 *
 * Lightweight banner query: returns the most recent run for each requested
 * jobName where startedAt >= sinceMs. Uses a minimal projection so Mongoose
 * only reads the fields the banner actually needs.
 *
 * Called on every checkout analytics page load — must be fast.
 * The { jobName, startedAt } index makes each per-job find O(log n).
 *
 * @param {string[]} jobNames  — e.g. ['CheckoutRetention']
 * @param {number}   sinceMs   — epoch ms cutoff (e.g. Date.now() - 72h)
 * @returns {Promise<Array<{ jobName, status, startedAt, counts, error }>>}
 */
cronJobLogSchema.statics.getLastRunSince = async function (jobNames, sinceMs) {
  if (!Array.isArray(jobNames) || jobNames.length === 0) return [];
  if (typeof sinceMs !== 'number' || sinceMs <= 0) return [];

  const cutoff = new Date(sinceMs);

  // One findOne per job — cheap with the compound index, avoids a $group stage.
  const results = await Promise.all(
    jobNames.map((name) =>
      this.findOne(
        { jobName: name, startedAt: { $gte: cutoff } },
        { jobName: 1, status: 1, startedAt: 1, counts: 1, error: 1, triggeredBy: 1 }
      )
        .sort({ startedAt: -1 })
        .lean()
    )
  );

  // Filter out nulls (jobs that haven't run since the cutoff)
  return results.filter(Boolean);
};

/**
 * getHealthSummary
 *
 * Aggregate counts by status across all jobs in the last 24 hours.
 * Used by the dashboard health strip.
 *
 * @returns {Promise<{ ok: number, failed: number, partial: number, total: number }>}
 */
cronJobLogSchema.statics.getHealthSummary = async function () {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await this.aggregate([
    { $match: { startedAt: { $gte: cutoff } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const summary = { ok: 0, failed: 0, partial: 0, total: 0 };
  for (const row of rows) {
    if (row._id in summary) summary[row._id] = row.count;
    summary.total += row.count;
  }

  return summary;
};

export default mongoose.model('CronJobLog', cronJobLogSchema);