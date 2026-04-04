/**
 * models/CronJobStatus.js
 *
 * Persistent health tracking for each registered cron job.
 * One document per job (upserted by runCronJob.js on every run).
 *
 * This collection is what powers the AdminCronHealth frontend page
 * and the dashboard summary strip. It is written to by the backend
 * and read by GET /api/v1/admin/cron/health.
 *
 * Design notes:
 *   - NEVER deleted. Documents are upserted, not recreated.
 *   - lastResult stores a lightweight summary only (numbers/strings/booleans).
 *   - lastError is capped at 2000 chars to avoid bloating the document.
 */

import mongoose from 'mongoose';

const cronJobStatusSchema = new mongoose.Schema(
  {
    // ── Identity ────────────────────────────────────────────────────────────
    jobName: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
      index:    true,
    },

    // ── Status ───────────────────────────────────────────────────────────────
    // 'ok'      — last run succeeded
    // 'failed'  — last run threw an unhandled error
    // 'unknown' — registered but never run (e.g. after fresh deployment)
    status: {
      type:    String,
      enum:    ['ok', 'failed', 'unknown'],
      default: 'unknown',
    },

    // ── Run timing ───────────────────────────────────────────────────────────
    lastRunAt:      { type: Date, default: null },
    lastFinishedAt: { type: Date, default: null },
    lastSuccessAt:  { type: Date, default: null },
    lastFailureAt:  { type: Date, default: null },
    lastDurationMs: { type: Number, default: null },
    lastRunId:      { type: String, default: null },

    // ── Last result summary ──────────────────────────────────────────────────
    // Shallow copy of numeric/string/boolean keys from the job's return value.
    // Example: { flagged: 4, deleted: 12, safetyReset: 0, elapsedMs: 1240 }
    lastResult: {
      type:    mongoose.Schema.Types.Mixed,
      default: null,
    },

    // ── Error ────────────────────────────────────────────────────────────────
    lastError: {
      type:    String,
      default: null,
      set:     (v) => (v ? v.slice(0, 2000) : null),
    },

    // ── Schedule metadata (set by cronRegistry at registration time) ─────────
    schedule:      { type: String, default: null },
    scheduleLabel: { type: String, default: null }, // e.g. 'Daily at 2 AM'
  },
  {
    timestamps: true, // createdAt = first registration, updatedAt = last upsert
    strict:     true,
  }
);

// ─── INDEXES ─────────────────────────────────────────────────────────────────

cronJobStatusSchema.index({ status: 1 });
cronJobStatusSchema.index({ lastRunAt: -1 });

// ─── STATICS ─────────────────────────────────────────────────────────────────

/**
 * getAll
 * Returns all job health records sorted by jobName.
 * Used by GET /api/v1/admin/cron/health.
 */
cronJobStatusSchema.statics.getAll = async function () {
  return this.find({}).sort({ jobName: 1 }).lean();
};

/**
 * registerJob
 * Called by cronRegistry on startup to ensure a document exists for each job
 * before the first run. Sets schedule metadata but never overwrites runtime fields.
 *
 * @param {string} jobName
 * @param {string} schedule       - cron expression
 * @param {string} scheduleLabel  - human-readable label
 */
cronJobStatusSchema.statics.registerJob = async function (jobName, schedule, scheduleLabel) {
  await this.findOneAndUpdate(
    { jobName },
    {
      $setOnInsert: {
        jobName,
        status: 'unknown',
      },
      $set: {
        schedule,
        scheduleLabel,
      },
    },
    { upsert: true, new: true }
  );
};

export default mongoose.model('CronJobStatus', cronJobStatusSchema);