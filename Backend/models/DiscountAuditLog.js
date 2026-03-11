import mongoose from "mongoose";

// ============================================
// DISCOUNT AUDIT LOG MODEL
//
// Append-only audit trail for all discount lifecycle events.
//
// Design principles:
//   1. DENORMALISED — discountCode and performedBy are stored as
//      snapshots, not refs. If a discount is later hard-deleted by
//      the cleanup job, or an admin account is removed, the audit
//      record remains fully readable with no populate() needed.
//
//   2. IMMUTABLE by convention — no update routes are registered
//      for this collection. The only mutations are:
//        - INSERT  (controllers + CRON job)
//        - STATUS UPDATE (pending_deletion flag, CRON only)
//        - DELETE  (CRON only, after 365 + 30 day grace period)
//      No admin-facing delete or update route exists.
//
//   3. SYSTEM ENTRIES — CRON sweep actions are recorded with
//      performedBy.system = true so they are visually distinct
//      in the audit tab UI.
//
// Retention lifecycle (enforced by jobs/audit-log-cleanup.js):
//   Day 1–365   → status: 'active', untouched
//   Day 366     → CRON flags: status: 'pending_deletion',
//                 scheduledDeleteAt = now + 30 days
//   Day 396     → CRON auto-deletes. AuditPurgeLog receipt written first.
//                 Admin notified after the fact. Cannot intervene.
// ============================================

const performedBySchema = new mongoose.Schema(
  {
    // Populated for admin/user actions
    _id: { type: mongoose.Schema.Types.ObjectId, default: null },
    firstName: { type: String, default: null },
    lastName:  { type: String, default: null },
    email:     { type: String, default: null },

    // true for CRON sweep entries — personal fields above will be null
    system: { type: Boolean, default: false },
  },
  { _id: false }
);

const discountAuditLogSchema = new mongoose.Schema(
  {
    // ── Discount identity ──────────────────────────────────────────────
    // discountId is a soft ref — not enforced at DB level so that
    // audit records survive discount hard-deletion by the cleanup job.
    discountId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Denormalised — readable even after the Discount document is gone
    discountCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    // ── Action ────────────────────────────────────────────────────────
    action: {
      type: String,
      required: true,
      enum: [
        // Admin / controller actions
        "created",           // discount created (admin or compensation flow)
        "updated",           // allowed fields edited by admin
        "used",              // customer applied code at checkout
        "deactivated",       // soft-deleted by admin (status → inactive)
        "deactivation_blocked", // admin attempted delete within protection window

        // CRON system actions
        "sweep_run",            // daily CRON ran — may or may not have flagged records
        "sweep_auto_deleted",   // CRON executed auto-deletion of matured records
        "sweep_window_expired", // pending_deletion window lapsed without deletion (safety net reset)
      ],
    },

    // ── Who did it ────────────────────────────────────────────────────
    performedBy: {
      type: performedBySchema,
      required: true,
    },

    performedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // ── Action-specific payload ───────────────────────────────────────
    // Flexible Mixed field. Shape varies per action:
    //
    //  created:
    //    { audience, type, value, category, validUntil,
    //      relatedReturn?, relatedOrder?, compensationType? }
    //
    //  updated:
    //    { changedFields: ['validUntil', 'status'],
    //      before: { validUntil: '...', status: '...' },
    //      after:  { validUntil: '...', status: '...' } }
    //
    //  used:
    //    { userId, orderId?, discountAmount, cartTotal,
    //      firstUse: Boolean }
    //      firstUse = true when this use triggered lockedAt being set
    //
    //  deactivated:
    //    { previousStatus, deletedBy }
    //
    //  deactivation_blocked:
    //    { reason: 'within_protection_window',
    //      deletionEligibleAt, attemptedBy }
    //
    //  sweep_run:
    //    { flaggedCount: N }   (0 when nothing found — silent run)
    //
    //  sweep_auto_deleted:
    //    { deletedCount, batchReference,
    //      dateRangeFrom, dateRangeTo }
    //      batchReference links to AuditPurgeLog._id
    //
    //  sweep_window_expired:
    //    { resetCount }   (records reset to active after window lapsed)
    //
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ── Retention lifecycle ───────────────────────────────────────────
    status: {
      type: String,
      enum: ["active", "pending_deletion"],
      default: "active",
    },

    // Set by CRON Pass 1 when flagging (= performedAt + 365 + 30 days).
    // Null until the record is flagged.
    scheduledDeleteAt: {
      type: Date,
      default: null,
    },
  },
  {
    // No timestamps — performedAt IS the timestamp. Adding createdAt
    // would be redundant and wastes index space at audit-log scale.
    timestamps: false,

    // Strict mode on — no ad-hoc fields written to the collection.
    strict: true,
  }
);

// ============================================
// INDEXES
//
//  1. (performedAt ASC) — CRON range query for flagging:
//       { performedAt: { $lt: cutoff }, status: 'active' }
//
//  2. (status, scheduledDeleteAt) — CRON Pass 2 & Pass 3:
//       { status: 'pending_deletion', scheduledDeleteAt: { $lte: now } }
//
//  3. (discountId, performedAt DESC) — detail drawer query:
//       per-discount last-20 entries; partial on status:'active'
//       because the drawer only shows live records.
//
//  4. (_id DESC) — cursor-based pagination on the full audit tab.
//       _id is ObjectId so insertion order ≈ time order; no separate
//       createdAt index needed.
//
//  5. (action) — filter by action type in the audit tab UI.
//       Not compound — action cardinality is low (~9 values) so a
//       standalone index is small and covers any action filter combo.
//
//  6. (performedBy._id) — filter by admin in the audit tab UI.
//       Sparse because system entries have performedBy._id = null.
// ============================================

// CRON flagging query
discountAuditLogSchema.index({ performedAt: 1 });

// CRON deletion + Pass 3 safety-net query
discountAuditLogSchema.index({ status: 1, scheduledDeleteAt: 1 });

// Per-discount drawer (last 20 entries) — partial keeps it lean
discountAuditLogSchema.index(
  { discountId: 1, performedAt: -1 },
  { partialFilterExpression: { status: "active" } }
);



// Action filter in audit tab UI
discountAuditLogSchema.index({ action: 1 });

// Admin filter — sparse because system entries have null _id
discountAuditLogSchema.index(
  { "performedBy._id": 1 },
  { sparse: true }
);

// ============================================
// STATIC HELPERS
// ============================================

/**
 * Write a single audit entry.
 * Centralises entry creation so controllers never build the object manually.
 *
 * @param {Object} params
 * @param {ObjectId}  params.discountId
 * @param {string}    params.discountCode
 * @param {string}    params.action        — must match enum
 * @param {Object}    params.performedBy   — req.user snapshot OR { system: true }
 * @param {Object}    [params.meta]        — action-specific payload
 * @returns {Promise<Document>}
 */
discountAuditLogSchema.statics.log = async function ({
  discountId,
  discountCode,
  action,
  performedBy,
  meta = {},
}) {
  const entry = {
    discountId,
    discountCode,
    action,
    performedBy: performedBy.system
      ? { system: true }
      : {
          _id:       performedBy._id,
          firstName: performedBy.firstName ?? null,
          lastName:  performedBy.lastName  ?? null,
          email:     performedBy.email     ?? null,
          system:    false,
        },
    performedAt: new Date(),
    meta,
  };

  // insertOne is used directly to bypass Mongoose middleware overhead
  // on a high-frequency write path.
  return this.create(entry);
};

/**
 * Write a CRON system entry that is not tied to a specific discount.
 * Used for sweep_run, sweep_auto_deleted, sweep_window_expired.
 *
 * For sweep-level entries discountId and discountCode are set to
 * sentinel values so the schema required constraint is satisfied
 * without polluting real discount audit trails.
 *
 * @param {string} action   — 'sweep_run' | 'sweep_auto_deleted' | 'sweep_window_expired'
 * @param {Object} meta
 */
discountAuditLogSchema.statics.logSystemEvent = async function (action, meta = {}) {
  return this.create({
    // Sentinel ObjectId — all zeros — signals a system-level entry
    discountId:   new mongoose.Types.ObjectId("000000000000000000000000"),
    discountCode: "SYSTEM",
    action,
    performedBy:  { system: true },
    performedAt:  new Date(),
    meta,
  });
};

/**
 * Fetch the last N audit entries for a specific discount.
 * Used by the detail drawer in AdminDiscounts.jsx.
 *
 * @param {ObjectId|string} discountId
 * @param {number}          [limit=20]
 * @returns {Promise<Array>}
 */
discountAuditLogSchema.statics.getForDiscount = async function (
  discountId,
  limit = 20
) {
  return this.find({ discountId, status: "active" })
    .sort({ performedAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Cursor-based paginated query for the full audit tab.
 *
 * @param {Object} filters
 * @param {string}   [filters.action]
 * @param {string}   [filters.discountCode]
 * @param {string}   [filters.performedById]
 * @param {Date}     [filters.dateFrom]
 * @param {Date}     [filters.dateTo]
 * @param {string}   [filters.cursor]          — base64-encoded { id }
 * @param {number}   [filters.limit=20]
 * @returns {Promise<{ logs: Array, hasNextPage: boolean, nextCursor: string|null }>}
 */
discountAuditLogSchema.statics.getPaginated = async function ({
  action,
  discountCode,
  performedById,
  dateFrom,
  dateTo,
  cursor,
  limit = 20,
} = {}) {
  const safeLimit = Math.min(parseInt(limit) || 20, 100);
  const filter = { status: "active" };

  if (action)        filter.action = action;
  if (discountCode)  filter.discountCode = { $regex: discountCode, $options: "i" };
  if (performedById) filter["performedBy._id"] = new mongoose.Types.ObjectId(performedById);
  if (dateFrom || dateTo) {
    filter.performedAt = {};
    if (dateFrom) filter.performedAt.$gte = new Date(dateFrom);
    if (dateTo)   filter.performedAt.$lte = new Date(dateTo);
  }

  if (cursor) {
    const { id } = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    filter._id = { $lt: new mongoose.Types.ObjectId(id) };
  }

  const logs = await this.find(filter)
    .sort({ _id: -1 })
    .limit(safeLimit + 1)
    .lean();

  const hasNextPage = logs.length > safeLimit;
  if (hasNextPage) logs.pop();

  let nextCursor = null;
  if (hasNextPage && logs.length > 0) {
    const last = logs[logs.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ id: last._id })).toString("base64");
  }

  return { logs, hasNextPage, nextCursor };
};

export default mongoose.model("DiscountAuditLog", discountAuditLogSchema);