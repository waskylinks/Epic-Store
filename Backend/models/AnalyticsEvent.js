/**
 * backend/models/AnalyticsEvent.js
 *
 * Phase 6 — Event Queue Document Model
 *
 * Every analytics event is persisted to MongoDB before being dispatched
 * to GA4, Meta CAPI, and BigQuery. This document is the queue entry —
 * it tracks the state of each event through its full lifecycle.
 *
 * State machine:
 *
 *   pending     → processing  : worker picks up the event
 *   processing  → completed   : all three platforms succeed
 *   processing  → failed      : one or more platforms return an error
 *   failed      → pending     : retry scheduled after exponential backoff
 *   failed      → dead_letter : max retries exceeded
 *
 * Design decisions:
 *
 *   1. eventId is unique and indexed — prevents the same event from being
 *      enqueued twice. The enqueueAnalyticsEvent function checks for
 *      an existing document before inserting.
 *
 *   2. Per-platform result tracking — each platform (ga4, meta, bigquery)
 *      has its own success/error/sentAt fields. A GA4 failure does not
 *      prevent Meta from being recorded as succeeded.
 *
 *   3. nextRetryAt is indexed alongside status and attempts — the worker
 *      query uses this compound index for efficient sweeping with no
 *      collection scan required for the attempts filter.
 *
 *   4. payload stores the full normalized analytics event — everything
 *      needed to dispatch to all three platforms without re-fetching
 *      from MongoDB or making additional DB queries.
 *
 *   5. TTL on completed documents — completed events are automatically
 *      deleted after 30 days to prevent unbounded collection growth.
 *      Dead-letter events are retained indefinitely for investigation.
 *
 *   6. resolvedOrderReference correction is available via both a pre('save')
 *      hook (for .save() call paths) and a static correctOrderReference()
 *      method (for findByIdAndUpdate call paths in the queue worker).
 *      The pre('save') hook never fires for findByIdAndUpdate — without the
 *      static method the correction silently never ran for any queue event.
 */

import mongoose from 'mongoose';

const platformResultSchema = new mongoose.Schema(
  {
    success: { type: Boolean, default: null },
    skipped: { type: Boolean, default: false },
    error:   { type: String,  default: null },
    sentAt:  { type: Date,    default: null },
  },
  { _id: false }
);

const analyticsEventSchema = new mongoose.Schema(
  {
    eventId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    eventType: {
      type:     String,
      required: true,
      enum: [
        'purchase',
        'begin_checkout',
        'checkout_step',
        'checkout_abandon',
        'add_to_cart',
        'remove_from_cart',
        'add_payment_info',
        'view_item',
        'view_item_list',
        'search',
        'add_to_wishlist',
        'login',
        'sign_up',
        'email_verified',
        'refund',
        'return_requested',
        'cart_recovery',
      ],
    },

    status: {
      type:    String,
      enum:    ['pending', 'processing', 'completed', 'failed', 'dead_letter'],
      default: 'pending',
      index:   true,
    },

    attempts: {
      type:    Number,
      default: 0,
      min:     0,
    },

    maxAttempts: {
      type:    Number,
      default: 3,
    },

    nextRetryAt: {
      type:    Date,
      default: () => new Date(),
      index:   true,
    },

    lastError: {
      type:    String,
      default: null,
    },

    completedAt: {
      type:    Date,
      default: null,
    },

    platforms: {
      ga4:      { type: platformResultSchema, default: () => ({}) },
      meta:     { type: platformResultSchema, default: () => ({}) },
      bigquery: { type: platformResultSchema, default: () => ({}) },
    },

    payload: {
      type:     mongoose.Schema.Types.Mixed,
      required: true,
    },

    priority: {
      type:    Number,
      default: 5,
      min:     1,
      max:     10,
    },
  },
  {
    timestamps: true,
  }
);

// ─── PRE-SAVE HOOK ────────────────────────────────────────────────────────────
// Fires only on .save() call paths. The queue worker uses findByIdAndUpdate
// exclusively, which bypasses this hook — use the static correctOrderReference()
// method for that path instead.

analyticsEventSchema.pre('save', function (next) {
  if (this.eventType !== 'purchase') return next();
  if (!this.payload) return next();

  const context = this.payload.context;
  const order   = this.payload.order;

  if (!context || !order) return next();

  // Already a valid ORD- reference — nothing to do
  if (
    typeof context.resolvedOrderReference === 'string' &&
    context.resolvedOrderReference.startsWith('ORD-')
  ) {
    return next();
  }

  // order.paymentInfo.reference may be a Stripe PaymentIntent ID (pi_3...)
  // or a Stripe token (EII1|...) — only trust it if it starts with ORD-.
  // Falls back to order._id which is always a clean MongoDB ObjectId string.
  let resolved = null;

  if (
    typeof order.paymentInfo?.reference === 'string' &&
    order.paymentInfo.reference.startsWith('ORD-')
  ) {
    resolved = order.paymentInfo.reference;
  } else if (typeof order._id === 'string') {
    resolved = order._id;
  }

  if (resolved) {
    console.warn(
      '[AnalyticsEvent] pre-save corrected resolvedOrderReference:',
      context.resolvedOrderReference ?? 'undefined', '→', resolved
    );
    this.payload.context.resolvedOrderReference = resolved;
    this.markModified('payload');
  }

  next();
});

// ─── INDEXES ──────────────────────────────────────────────────────────────────

// worker_sweep_idx now includes attempts so the { status, nextRetryAt, attempts }
// filter in findEligible is fully covered without a collection scan.
// Previously attempts was filtered via $expr: { $lt: ['$attempts', '$maxAttempts'] }
// which required scanning all pending/failed documents after the index lookup.
analyticsEventSchema.index(
  { status: 1, nextRetryAt: 1, attempts: 1, priority: -1 },
  { name: 'worker_sweep_idx' }
);

analyticsEventSchema.index(
  { eventType: 1, status: 1, createdAt: -1 },
  { name: 'observability_idx' }
);

analyticsEventSchema.index(
  { completedAt: 1 },
  {
    name:               'ttl_completed_idx',
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { status: 'completed' },
  }
);

// ─── VIRTUAL: isRetryable ─────────────────────────────────────────────────────

analyticsEventSchema.virtual('isRetryable').get(function () {
  return this.status === 'failed' && this.attempts < this.maxAttempts;
});

// ─── STATIC METHODS ───────────────────────────────────────────────────────────

/**
 * findEligible
 *
 * Fetches events ready for dispatch. The attempts filter uses a plain $lt
 * against the caller-supplied maxAttempts value rather than $expr so the
 * full query is covered by worker_sweep_idx without a collection scan.
 *
 * @param {number} limit       - Max events to return (default: 5)
 * @param {number} maxAttempts - Exclude events at or above this attempt count
 */
analyticsEventSchema.statics.findEligible = function (limit = 5, maxAttempts = 3) {
  return this.find({
    status:      { $in: ['pending', 'failed'] },
    nextRetryAt: { $lte: new Date() },
    attempts:    { $lt: maxAttempts },
  })
    .sort({ priority: -1, nextRetryAt: 1 })
    .limit(limit);
};

/**
 * correctOrderReference
 *
 * Mirrors the pre('save') resolvedOrderReference correction for use in
 * code paths that call findByIdAndUpdate (i.e. the queue worker), which
 * never triggers the pre('save') hook.
 *
 * Operates on a plain document object — the queue worker reads lean-ish
 * documents and updates them via findByIdAndUpdate, so no Mongoose document
 * instance is available to call .save() on.
 *
 * Returns the corrected reference string if a correction was made, or null
 * if the reference is already valid or no correction is possible.
 *
 * Usage in analyticsQueue.js (inside the task map, before dispatchToPlatforms):
 *
 *   const correctedRef = AnalyticsEvent.correctOrderReference(event);
 *   if (correctedRef) {
 *     await AnalyticsEvent.findByIdAndUpdate(event._id, {
 *       $set: { 'payload.context.resolvedOrderReference': correctedRef },
 *     });
 *     event.payload.context.resolvedOrderReference = correctedRef;
 *   }
 *
 * @param {Object} event - AnalyticsEvent document (plain object or Mongoose doc)
 * @returns {string|null}
 */
analyticsEventSchema.statics.correctOrderReference = function (event) {
  if (event.eventType !== 'purchase' || !event.payload) return null;

  const context = event.payload.context;
  const order   = event.payload.order;

  if (!context || !order) return null;

  // Already a valid ORD- reference — nothing to do
  if (
    typeof context.resolvedOrderReference === 'string' &&
    context.resolvedOrderReference.startsWith('ORD-')
  ) {
    return null;
  }

  let resolved = null;

  if (
    typeof order.paymentInfo?.reference === 'string' &&
    order.paymentInfo.reference.startsWith('ORD-')
  ) {
    resolved = order.paymentInfo.reference;
  } else if (typeof order._id === 'string') {
    resolved = order._id;
  }

  if (resolved) {
    console.warn(
      '[AnalyticsEvent] correctOrderReference:',
      context.resolvedOrderReference ?? 'undefined', '→', resolved
    );
    return resolved;
  }

  return null;
};

/**
 * getQueueHealth
 *
 * Returns a summary of document counts by status plus a healthyRatio.
 */
analyticsEventSchema.statics.getQueueHealth = async function () {
  const counts = await this.aggregate([
    {
      $group: {
        _id:   '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = {
    pending:     0,
    processing:  0,
    completed:   0,
    failed:      0,
    dead_letter: 0,
  };

  counts.forEach(({ _id, count }) => {
    if (_id in summary) summary[_id] = count;
  });

  summary.total        = Object.values(summary).reduce((a, b) => a + b, 0);
  summary.healthyRatio = summary.total > 0
    ? Math.round((summary.completed / summary.total) * 100)
    : 100;

  return summary;
};

export default mongoose.model('AnalyticsEvent', analyticsEventSchema);