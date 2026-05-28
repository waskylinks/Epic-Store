/**

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
 *   3. nextRetryAt is indexed alongside status — the worker query
 *      { status: { $in: ['pending','failed'] }, nextRetryAt: { $lte: now } }
 *      uses this compound index for efficient sweeping.
 *
 *   4. payload stores the full normalized analytics event — everything
 *      needed to dispatch to all three platforms without re-fetching
 *      from MongoDB or making additional DB queries.
 *
 *   5. TTL on completed documents — completed events are automatically
 *      deleted after 30 days to prevent unbounded collection growth.
 *      Dead-letter events are retained indefinitely for investigation.
 */

import mongoose from 'mongoose';

const platformResultSchema = new mongoose.Schema(
  {
    success: { type: Boolean, default: null },
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

analyticsEventSchema.index(
  { status: 1, nextRetryAt: 1, priority: -1 },
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

analyticsEventSchema.statics.findEligible = function (limit = 5) {
  return this.find({
    status:      { $in: ['pending', 'failed'] },
    nextRetryAt: { $lte: new Date() },
    $expr:       { $lt: ['$attempts', '$maxAttempts'] },
  })
    .sort({ priority: -1, nextRetryAt: 1 })
    .limit(limit);
};

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