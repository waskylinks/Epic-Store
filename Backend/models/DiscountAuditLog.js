import mongoose from "mongoose";

// ============================================
// DISCOUNT AUDIT LOG MODEL
//
// Append-only audit trail for all discount lifecycle events.
//
// Changes from previous version:
//
//  FIX #18 — 'manual_cleanup' added to action enum.
//    The triggerCleanup controller now writes an audit entry before running
//    cleanup so there is always a record of who triggered a manual purge.
//    System CRON-triggered runs still use 'sweep_run'.
//
//  FIX #20 — ObjectId validation guard added to getPaginated().
//    Passing an invalid performedById string previously caused
//    new mongoose.Types.ObjectId() to throw a BSONError that
//    bypassed HandleError and returned an unhandled 500.
//    The guard now throws a clean validation error before that point.
//
// Retention lifecycle (enforced by jobs/audit-log-cleanup.js):
//   Day 1–365   → status: 'active', untouched
//   Day 366     → CRON flags: status: 'pending_deletion',
//                 scheduledDeleteAt = now + 30 days
//   Day 396     → CRON auto-deletes. AuditPurgeLog receipt written first.
// ============================================

const performedBySchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, default: null },
    firstName: { type: String, default: null },
    lastName:  { type: String, default: null },
    email:     { type: String, default: null },
    system: { type: Boolean, default: false },
  },
  { _id: false }
);

const discountAuditLogSchema = new mongoose.Schema(
  {
    // ── Discount identity ──────────────────────────────────────────────
    discountId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

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
        "created",
        "updated",
        "used",
        "deactivated",
        "deactivation_blocked",

        // FIX #18 — manual_cleanup: written by triggerCleanup controller
        // before running the cleanup so the triggering admin is recorded.
        // Distinct from sweep_run (CRON-initiated) so the two can be
        // filtered separately in the audit tab UI.
        "manual_cleanup",

        // CRON system actions
        "sweep_run",
        "sweep_auto_deleted",
        "sweep_window_expired",
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
    // Shape varies per action — see inline comments below.
    //
    //  created:
    //    { audience, type, value, category, validUntil,
    //      relatedReturn?, relatedOrder?, compensationType? }
    //
    //  updated:
    //    { changedFields, before, after, statusResurrected?: true }
    //
    //  used:
    //    { userId, orderId (always null at validate time — FIX #1),
    //      discountAmount, cartTotal, isFirstUse,
    //      lockedAt?, deletionEligibleAt? }
    //
    //  deactivated:
    //    { previousStatus, currentUses }
    //
    //  deactivation_blocked:
    //    { reason, deletionEligibleAt, currentUses, attemptedBy }
    //
    //  manual_cleanup:  (FIX #18)
    //    { triggeredBy, daysOld, triggeredAt }
    //
    //  sweep_run:
    //    { flaggedCount, retentionDays, graceDays, cutoffDate }
    //
    //  sweep_auto_deleted:
    //    { deletedCount, expectedCount, batchReference, purgeReceiptId,
    //      dateRangeFrom, dateRangeTo, discountCodesAffected,
    //      partialDeletionDetected }
    //
    //  sweep_window_expired:
    //    { resetCount, reason }
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

    scheduledDeleteAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: false,
    strict: true,
  }
);

// ============================================
// INDEXES
// ============================================

discountAuditLogSchema.index({ performedAt: 1 });
discountAuditLogSchema.index({ status: 1, scheduledDeleteAt: 1 });
discountAuditLogSchema.index(
  { discountId: 1, performedAt: -1 },
  { partialFilterExpression: { status: "active" } }
);
discountAuditLogSchema.index({ action: 1 });
discountAuditLogSchema.index(
  { "performedBy._id": 1 },
  { sparse: true }
);

// ============================================
// STATIC HELPERS
// ============================================

/**
 * Write a single audit entry.
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

  return this.create(entry);
};

/**
 * Write a CRON system entry not tied to a specific discount.
 * Used for sweep_run, sweep_auto_deleted, sweep_window_expired.
 */
discountAuditLogSchema.statics.logSystemEvent = async function (action, meta = {}) {
  return this.create({
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
 * FIX #20 — performedById is validated with isValid() before being cast to
 * ObjectId. Previously, an invalid string would cause new mongoose.Types.ObjectId()
 * to throw a BSONError that bypassed the controller's HandleError flow and
 * returned an unhandled 500.
 *
 * @param {Object} filters
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

  if (action)       filter.action = action;
  if (discountCode) filter.discountCode = { $regex: discountCode, $options: "i" };

  // FIX #20 — validate before casting; throw a descriptive error so the
  // controller can return a clean 400 rather than an unhandled BSONError 500.
  if (performedById) {
    if (!mongoose.Types.ObjectId.isValid(performedById)) {
      throw new Error("Invalid performedById: not a valid ObjectId");
    }
    filter["performedBy._id"] = new mongoose.Types.ObjectId(performedById);
  }

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