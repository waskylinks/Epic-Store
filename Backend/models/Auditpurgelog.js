import mongoose from "mongoose";

// ============================================
// AUDIT PURGE LOG MODEL
//
// Permanent, append-only receipt collection.
// Records every auto-deletion run executed by the CRON job.
//
// Design principles:
//   1. PERMANENT — no delete route, no CRON, no cleanup ever touches
//      this collection. It outlives the records it describes.
//
//   2. WRITTEN FIRST — the CRON job writes this receipt BEFORE
//      executing any deletion. If the server crashes mid-delete,
//      the receipt exists and the partial deletion is detectable
//      by comparing receipt.recordCount against actual deleted count
//      in the sweep_auto_deleted audit entry.
//
//   3. SYSTEM-ONLY writes — no admin or user controller writes to
//      this collection. Only jobs/audit-log-cleanup.js creates entries.
//      The router only exposes a GET route.
//
//   4. SELF-CONTAINED — all fields are denormalised. No refs to
//      DiscountAuditLog (those records are deleted). No refs to
//      User (the purge is always system-initiated). The receipt
//      is fully readable with zero population.
//
// Relationship to DiscountAuditLog:
//   After a purge run, a 'sweep_auto_deleted' entry is written to
//   DiscountAuditLog with meta.batchReference = AuditPurgeLog._id.
//   This cross-reference is one-directional: DiscountAuditLog →
//   AuditPurgeLog. The purge log never references audit log entries
//   (they no longer exist after the run).
// ============================================

const auditPurgeLogSchema = new mongoose.Schema(
  {
    // ── Purge run identity ─────────────────────────────────────────────
    // UUID generated per purge run by the CRON job.
    // Cross-referenced in DiscountAuditLog sweep_auto_deleted entry
    // so admins can trace a UI notification back to the precise receipt.
    batchReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // ── Who / what executed the purge ─────────────────────────────────
    // Always system — no human initiates deletion.
    purgedBy: {
      type: new mongoose.Schema(
        {
          system:    { type: Boolean, default: true },
          // Reserved for future use if a superAdmin-initiated purge
          // flow is ever added. Null for all current automated runs.
          adminId:   { type: mongoose.Schema.Types.ObjectId, default: null },
          adminName: { type: String, default: null },
        },
        { _id: false }
      ),
      default: () => ({ system: true, adminId: null, adminName: null }),
    },

    purgedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // ── What was deleted ──────────────────────────────────────────────
    recordCount: {
      type: Number,
      required: true,
      min: [1, "A purge receipt must record at least one deleted entry"],
    },

    // Oldest performedAt among deleted records
    dateRangeFrom: {
      type: Date,
      required: true,
    },

    // Newest performedAt among deleted records
    dateRangeTo: {
      type: Date,
      required: true,
    },

    // Unique discount codes whose audit entries were included in this purge.
    // Denormalised string array — survives everything, no populate needed.
    // Filtered to exclude the 'SYSTEM' sentinel code so the list only
    // reflects real discount codes.
    discountCodesAffected: {
      type: [String],
      default: [],
    },

    // ── Integrity check ───────────────────────────────────────────────
    // Actual deleted count returned by the MongoDB deleteMany call.
    // Should equal recordCount. A mismatch indicates a partial deletion
    // (e.g. server crash mid-batch) and surfaces in the UI receipt.
    actualDeletedCount: {
      type: Number,
      default: null,
    },

    // Notes field reserved for anomaly annotations.
    // E.g. "Partial deletion detected — server restart mid-batch"
    notes: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    // createdAt serves as the canonical purge timestamp alongside purgedAt.
    // updatedAt is intentionally omitted — this schema is append-only and
    // should never be updated after creation.
    timestamps: { createdAt: true, updatedAt: false },

    strict: true,
  }
);

// ============================================
// INDEXES
//
//  1. purgedAt DESC — default sort for the purge history UI section.
//     Newest receipts shown first.
//
//  2. batchReference — unique enforced at schema level + index for
//     O(1) lookup when the UI fetches a specific receipt from a
//     sweep_auto_deleted audit entry cross-reference.
//
// No compound indexes needed — this collection grows at ~1 entry per
// year (one purge run annually). Query volume is negligible.
// ============================================

auditPurgeLogSchema.index({ purgedAt: -1 });
// batchReference unique index is created automatically by { unique: true }
// on the field definition above — no explicit index call needed.

// ============================================
// STATIC HELPERS
// ============================================

/**
 * Create a purge receipt. Called by the CRON job BEFORE executing
 * the actual deletion so the receipt exists even if deletion is partial.
 *
 * @param {Object} params
 * @param {string}   params.batchReference   — UUID for this purge run
 * @param {number}   params.recordCount       — records about to be deleted
 * @param {Date}     params.dateRangeFrom     — oldest performedAt in batch
 * @param {Date}     params.dateRangeTo       — newest performedAt in batch
 * @param {string[]} params.discountCodesAffected
 * @returns {Promise<Document>}
 */
auditPurgeLogSchema.statics.createReceipt = async function ({
  batchReference,
  recordCount,
  dateRangeFrom,
  dateRangeTo,
  discountCodesAffected = [],
}) {
  return this.create({
    batchReference,
    purgedBy:    { system: true },
    purgedAt:    new Date(),
    recordCount,
    dateRangeFrom,
    dateRangeTo,
    // Filter out the SYSTEM sentinel so the code list is clean
    discountCodesAffected: discountCodesAffected.filter((c) => c !== "SYSTEM"),
  });
};

/**
 * Update a receipt with the actual deleted count after deletion completes.
 * Allows the UI to surface partial-deletion anomalies.
 *
 * @param {string} batchReference
 * @param {number} actualDeletedCount
 * @param {string} [notes]             — anomaly description if mismatch
 */
auditPurgeLogSchema.statics.finalise = async function (
  batchReference,
  actualDeletedCount,
  notes = null
) {
  return this.findOneAndUpdate(
    { batchReference },
    { $set: { actualDeletedCount, notes } },
    { new: true }
  );
};

/**
 * Return all purge receipts sorted newest first.
 * Used by GET /audit/purge-log in the admin UI.
 *
 * @returns {Promise<Array>}
 */
auditPurgeLogSchema.statics.getAll = async function () {
  return this.find({}).sort({ purgedAt: -1 }).lean();
};

/**
 * Return the most recent purge receipt.
 * Used by the admin UI to decide whether to show the receipt banner.
 * Banner is shown when the most recent purge occurred within the last 7 days.
 *
 * @returns {Promise<Document|null>}
 */
auditPurgeLogSchema.statics.getLatest = async function () {
  return this.findOne({}).sort({ purgedAt: -1 }).lean();
};

export default mongoose.model("AuditPurgeLog", auditPurgeLogSchema);