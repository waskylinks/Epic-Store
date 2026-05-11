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

// ─── PER-PLATFORM RESULT SCHEMA ───────────────────────────────────────────────

const platformResultSchema = new mongoose.Schema(
  {
    success: { type: Boolean, default: null },
    error:   { type: String,  default: null },
    sentAt:  { type: Date,    default: null },
  },
  { _id: false }
);

// ─── MAIN SCHEMA ──────────────────────────────────────────────────────────────

const analyticsEventSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    // eventId is the UUID from Phase 1 — the deduplication key for GA4 and Meta.
    // Unique index prevents the same event from being enqueued twice.
    eventId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // Human-readable event type for filtering and observability
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
        'view_item',
        'add_to_wishlist',
        'login',
        'sign_up',
        'email_verified',
        'refund',
        'return_requested',
        'cart_recovery',
      ],
    },

    // ── State machine ─────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'completed', 'failed', 'dead_letter'],
      default: 'pending',
      index:   true,
    },

    // ── Retry tracking ────────────────────────────────────────────────────────
    attempts: {
      type:    Number,
      default: 0,
      min:     0,
    },

    maxAttempts: {
      type:    Number,
      default: 3,
    },

    // When the worker should next attempt this event
    // Set to new Date() on creation so it is immediately eligible
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

    // ── Per-platform results ──────────────────────────────────────────────────
    // Tracks success/failure independently per platform.
    // A partial success (GA4 ok, Meta failed) is recorded accurately.
    platforms: {
      ga4:      { type: platformResultSchema, default: () => ({}) },
      meta:     { type: platformResultSchema, default: () => ({}) },
      bigquery: { type: platformResultSchema, default: () => ({}) },
    },

    // ── Event payload ─────────────────────────────────────────────────────────
    // The full normalized analytics event from buildAnalyticsEvent() (Phase 1).
    // Also includes the raw order, user, and context objects needed by the
    // platform-specific senders (ga4Service, metaCapiService, bigQueryService).
    payload: {
      type:     mongoose.Schema.Types.Mixed,
      required: true,
    },

    // ── Priority ──────────────────────────────────────────────────────────────
    // Higher priority events are processed first.
    // purchase = 10 (highest), page_view = 1 (lowest)
    priority: {
      type:    Number,
      default: 5,
      min:     1,
      max:     10,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// ─── INDEXES ──────────────────────────────────────────────────────────────────

// Compound index for the worker sweep query:
// db.analyticsevents.find({ status: { $in: ['pending','failed'] }, nextRetryAt: { $lte: now } })
// Sorted by priority DESC so high-priority events are processed first
analyticsEventSchema.index(
  { status: 1, nextRetryAt: 1, priority: -1 },
  { name: 'worker_sweep_idx' }
);

// Index for observability queries by event type
analyticsEventSchema.index(
  { eventType: 1, status: 1, createdAt: -1 },
  { name: 'observability_idx' }
);

// TTL index: automatically delete completed events after 30 days
// Dead-letter events (status: 'dead_letter') do not have completedAt set
// so they are retained indefinitely for manual investigation
analyticsEventSchema.index(
  { completedAt: 1 },
  {
    name:               'ttl_completed_idx',
    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
    partialFilterExpression: { status: 'completed' },
  }
);

// ─── VIRTUAL: isRetryable ─────────────────────────────────────────────────────

analyticsEventSchema.virtual('isRetryable').get(function () {
  return this.status === 'failed' && this.attempts < this.maxAttempts;
});

// ─── STATIC METHODS ───────────────────────────────────────────────────────────

/**
 * AnalyticsEvent.findEligible
 *
 * Finds events that are ready to be processed by the queue worker.
 * Returns pending events and failed events whose nextRetryAt has passed.
 * Sorted by priority descending so purchase events (priority 10) are
 * processed before view_item events (priority 1).
 *
 * @param {number} limit - Max number of events to return per sweep
 * @returns {Promise<AnalyticsEvent[]>}
 */
analyticsEventSchema.statics.findEligible = function (limit = 5) {
  return this.find({
    status:      { $in: ['pending', 'failed'] },
    nextRetryAt: { $lte: new Date() },
    $expr:       { $lt: ['$attempts', '$maxAttempts'] },
  })
    .sort({ priority: -1, nextRetryAt: 1 })
    .limit(limit);
};

/**
 * AnalyticsEvent.getQueueHealth
 *
 * Returns a summary of the current queue state for observability.
 * Called by the observability controller (Phase 7) for the health dashboard.
 *
 * @returns {Promise<Object>}
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

  summary.total         = Object.values(summary).reduce((a, b) => a + b, 0);
  summary.healthyRatio  = summary.total > 0
    ? Math.round((summary.completed / summary.total) * 100)
    : 100;

  return summary;
};

export default mongoose.model('AnalyticsEvent', analyticsEventSchema);