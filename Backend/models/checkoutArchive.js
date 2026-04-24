/**
 * models/CheckoutArchive.js
 *
 * Cold-tier archive for checkout documents older than 365 days.
 * Collection name: checkouts_archive
 *
 * Design principles:
 *   1. COMPLIANCE FLOOR — documents live here for up to 7 years before the
 *      hard-delete pass in checkoutRetentionJob.js removes them. This satisfies
 *      GDPR Article 17 right-to-erasure timelines and typical financial audit
 *      requirements.
 *
 *   2. DENORMALISED, MINIMAL FOOTPRINT — only the fields required for compliance
 *      reporting and lookup are stored. Full item arrays, shipping details,
 *      recovery interaction logs, and cart snapshots are intentionally excluded.
 *      The hot collection's deleteMany removes the originals; this document is
 *      the permanent receipt, not a full backup.
 *
 *   3. READ-ONLY IN APPLICATION LAYER — no controller or service ever writes
 *      to this collection except checkoutRetentionJob.js. No update route is
 *      ever exposed. The only admin-visible operation is a future read-only
 *      lookup endpoint (not in scope for this iteration).
 *
 *   4. NO AGGREGATION INDEXES — this collection is lookup-only. The hot
 *      collection carries all aggregation indexes. Only userId and createdAt
 *      indexes are present here to support GDPR erasure requests and TTL.
 *
 * Hard-delete TTL:
 *   MongoDB TTL index on archivedAt is NOT used here because 7-year retention
 *   requires an annual cron pass (the compliance purge in checkoutRetentionJob.js)
 *   rather than passive TTL deletion. TTL is unreliable over multi-year windows
 *   and provides no audit trail. The retention job writes a CronJobLog entry
 *   for every hard-delete pass.
 */

import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const checkoutArchiveSchema = new mongoose.Schema(
  {
    // ── Origin identity ───────────────────────────────────────────────────────
    // _id is preserved from the source checkout document so any external
    // reference (e.g. order receipt) can still be resolved.
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // Denormalised user reference — kept as ObjectId + email for GDPR lookup.
    // If the user account is later deleted, the email is the fallback identifier.
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    email: {
      type:     String,
      required: true,
      trim:     true,
      lowercase: true,
    },

    // ── Outcome ───────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'completed', 'abandoned', 'expired'],
    },

    // ── Financial summary ─────────────────────────────────────────────────────
    // Only the scalar totals are archived — individual item prices are not.
    // This is sufficient for financial audit without storing full PII-adjacent
    // item lists.
    totalPrice:     { type: Number, default: 0 },
    currency:       { type: String, default: 'USD' },
    discountCode:   { type: String, default: null },
    discountAmount: { type: Number, default: 0 },

    // ── Conversion outcome ────────────────────────────────────────────────────
    isConverted:      { type: Boolean, default: false },
    convertedAt:      { type: Date,    default: null },
    orderId:          { type: mongoose.Schema.Types.ObjectId, default: null },
    paymentReference: { type: String,  default: null },

    // ── Abandonment outcome ───────────────────────────────────────────────────
    // Boolean flags only — no arrays, no interaction logs.
    wasAbandoned:     { type: Boolean, default: false },
    wasRecovered:     { type: Boolean, default: false },
    reAbandoned:      { type: Boolean, default: false },
    organicRecovery:  { type: Boolean, default: false },

    // ── Attribution ───────────────────────────────────────────────────────────
    // Source is the only analytics field worth retaining for long-term channel
    // attribution analysis.
    analyticsSource: {
      type: String,
      enum: ['organic', 'paid', 'referral', 'email', 'social', 'direct', null],
      default: null,
    },

    // ── Original timestamps ───────────────────────────────────────────────────
    checkoutCreatedAt: { type: Date, required: true },
    checkoutUpdatedAt: { type: Date, default: null  },

    // ── Archive metadata ──────────────────────────────────────────────────────
    // Written by the retention job at archive time.
    archivedAt: {
      type:     Date,
      required: true,
      default:  Date.now,
    },

    // Which retention job run archived this document.
    archiveRunId: {
      type:    String,
      default: null,
    },
  },
  {
    // Disable automatic _id generation — we supply it from the source document.
    _id:        false,
    // No updatedAt — this document is written once and never modified.
    timestamps: false,
    // Collection name is explicit so it never accidentally uses the default.
    collection: 'checkouts_archive',
    strict:     true,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

// GDPR erasure lookup — find all archived checkouts for a given user.
checkoutArchiveSchema.index(
  { userId: 1, archivedAt: -1 },
  { name: 'user_archive_idx' }
);

// Compliance date-range scan — used by the hard-delete pass in the retention job.
// Scoped to non-converted checkouts first so converted (financial) records
// are processed separately with stricter guards.
checkoutArchiveSchema.index(
  { archivedAt: 1, isConverted: 1 },
  { name: 'archive_date_converted_idx' }
);

// Thin index for the source checkout _id — allows O(1) existence check
// before insertMany to prevent duplicate archives on partial-run restart.
checkoutArchiveSchema.index(
  { _id: 1 },
  { unique: true, name: 'source_id_unique_idx' }
);

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * archiveCheckouts
 *
 * Inserts an array of pre-formatted archive documents in one ordered batch.
 * Uses ordered: false so a duplicate _id (from a previous partial run) does
 * not abort the entire batch — the duplicate is silently skipped via the
 * unique index, and the rest of the batch proceeds.
 *
 * NEVER call this with raw checkout documents — always pass documents that
 * have already been projected through the retention job's mapToArchive()
 * helper to guarantee the minimal-footprint invariant.
 *
 * @param {Object[]} docs  — pre-projected archive documents
 * @returns {Promise<{ inserted: number, duplicates: number }>}
 */
checkoutArchiveSchema.statics.archiveCheckouts = async function (docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return { inserted: 0, duplicates: 0 };
  }

  try {
    const result = await this.insertMany(docs, {
      ordered:             false,
      // Don't throw on duplicate key errors — count them instead.
      throwOnValidationError: false,
    });
    return { inserted: result.length, duplicates: docs.length - result.length };
  } catch (err) {
    // insertMany with ordered:false throws a BulkWriteError that contains
    // both successful inserts and errors. Extract what succeeded.
    if (err.name === 'MongoBulkWriteError' || err.code === 11000) {
      const inserted   = err.result?.nInserted ?? 0;
      const duplicates = docs.length - inserted - (err.result?.nErrors ?? 0);
      return {
        inserted,
        duplicates: Math.max(0, duplicates),
        writeErrors: err.writeErrors?.length ?? 0,
      };
    }
    throw err;
  }
};

/**
 * countEligibleForHardDelete
 *
 * Returns the count of archive documents older than `cutoffDate`.
 * Used by the retention job to log how many documents will be purged
 * before issuing the deleteMany.
 *
 * @param {Date} cutoffDate
 * @returns {Promise<number>}
 */
checkoutArchiveSchema.statics.countEligibleForHardDelete = async function (cutoffDate) {
  if (!(cutoffDate instanceof Date)) throw new Error('cutoffDate must be a Date');
  return this.countDocuments({ archivedAt: { $lt: cutoffDate } });
};

export default mongoose.model('CheckoutArchive', checkoutArchiveSchema);