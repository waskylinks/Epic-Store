/**
 * Phase 6 — Event Queue Document Model
 *
 * Every analytics event is persisted to MongoDB before being dispatched
 * to GA4, Meta CAPI, and BigQuery. This document is the queue entry —
 * it tracks the state of each event through its full lifecycle.
 *
 * State machine:
 *
 *   pending     → processing  : worker atomically claims the event
 *   processing  → completed   : all three platforms succeed
 *   processing  → pending     : worker crashed / timeout recovery sweep
 *   processing  → dead_letter : all attempts exhausted
 *   pending     → dead_letter : attempts exhausted without success
 *
 * Startup requirement (call once at boot before accepting traffic):
 *
 *   await mongoose.model('AnalyticsEvent').init();
 *
 * This ensures all indexes — especially the unique eventId index — are
 * present before inserts begin, and surfaces any index build errors early.
 */

import mongoose from 'mongoose';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PAYLOAD_BYTES     = 1 * 1024 * 1024; // 1 MB
const TTL_COMPLETED_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ─── LOGGER INTERFACE ─────────────────────────────────────────────────────────
// Replace with your structured logger (pino, winston, etc.)

const logger = {
  warn:  (fields, msg) => console.warn({ ...fields, msg }),
  error: (fields, msg) => console.error({ ...fields, msg }),
};

// ─── SUB-SCHEMAS ──────────────────────────────────────────────────────────────

/**
 * Per-platform dispatch result.
 * idempotencyKey must be stable across retries so upstream deduplication works:
 *   GA4      → transaction_id
 *   Meta     → event_id
 *   BigQuery → insertId
 */
const platformResultSchema = new mongoose.Schema(
  {
    success:        { type: Boolean, default: null },
    error:          { type: String,  default: null },
    sentAt:         { type: Date,    default: null },
    idempotencyKey: { type: String,  default: null },
  },
  { _id: false }
);

/**
 * Individual retry error record — appended on each failure so the full
 * history is available for debugging retry storms and transient vs permanent
 * failures.
 */
const retryErrorSchema = new mongoose.Schema(
  {
    at:       { type: Date,   required: true },
    platform: { type: String, default: null  }, // null = pre-dispatch error
    message:  { type: String, required: true },
    code:     { type: String, default: null  },
  },
  { _id: false }
);

/**
 * Typed payload sub-schema.
 * strict: false allows each eventType to carry additional fields without
 * failing validation, while still giving us typed fast paths for the
 * fields every event shares.
 */
const payloadSchema = new mongoose.Schema(
  {
    event:   { type: String },
    user:    { type: Object },
    context: { type: Object },
    order:   { type: Object },
  },
  { _id: false, strict: false }
);

// ─── MAIN SCHEMA ──────────────────────────────────────────────────────────────

const analyticsEventSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────────

    /**
     * Stable unique identifier supplied by the caller (e.g. UUID v4).
     * Unique index prevents double-enqueue. E11000 must be caught
     * explicitly and treated as a no-op in enqueueAnalyticsEvent().
     */
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

    schemaVersion: {
      type:    Number,
      default: 1,
    },

    // ── State machine ─────────────────────────────────────────────────────────

    /**
     * Valid transitions:
     *   pending     → processing   (atomic claim via claimOne())
     *   processing  → completed    (all platforms OK)
     *   processing  → pending      (retry: attempts < maxAttempts, set nextRetryAt)
     *   processing  → dead_letter  (attempts >= maxAttempts)
     *   processing  → pending      (recovery sweep: processingStartedAt too old)
     *
     * Retry scheduling is expressed entirely through
     * status=pending + nextRetryAt + attempts — there is no separate "failed" state.
     */
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'completed', 'dead_letter'],
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

    /**
     * Set atomically inside claimOne(). recoverStuck() uses it to detect
     * orphaned documents when a worker crashes mid-dispatch.
     */
    processingStartedAt: {
      type:    Date,
      default: null,
    },

    /**
     * processingStartedAt + PROCESSING_TIMEOUT_MS.
     * Stored explicitly so the recovery sweep can use an indexed range query.
     */
    processingTimeoutAt: {
      type:    Date,
      default: null,
      index:   true,
    },

    /**
     * Earliest time this event should next be dispatched.
     * Workers ignore events where nextRetryAt > now.
     */
    nextRetryAt: {
      type:    Date,
      default: () => new Date(),
      index:   true,
    },

    completedAt: {
      type:    Date,
      default: null,
    },

    // ── Retry history ─────────────────────────────────────────────────────────

    errors: {
      type:    [retryErrorSchema],
      default: [],
    },

    // ── Platform results ──────────────────────────────────────────────────────

    /**
     * Per-platform success/error/sentAt/idempotencyKey.
     * A failure on one platform does not prevent another from succeeding.
     * idempotencyKey must be set before the first dispatch attempt and
     * must not change on retries.
     */
    platforms: {
      ga4:      { type: platformResultSchema, default: () => ({}) },
      meta:     { type: platformResultSchema, default: () => ({}) },
      bigquery: { type: platformResultSchema, default: () => ({}) },
    },

    // ── Payload ───────────────────────────────────────────────────────────────

    payload: {
      type:     payloadSchema,
      required: true,
    },

    // ── Scheduling ────────────────────────────────────────────────────────────

    priority: {
      type:    Number,
      default: 5,
      min:     1,
      max:     10,
    },

    // ── Observability ─────────────────────────────────────────────────────────

    source:        { type: String, default: null },
    correlationId: { type: String, default: null },
    traceId:       { type: String, default: null },
    environment:   { type: String, default: () => process.env.NODE_ENV ?? 'production' },
  },
  {
    timestamps: true,
  }
);

// ─── PRE-VALIDATE HOOKS ───────────────────────────────────────────────────────

// Reject payloads that exceed the 1 MB soft cap well before MongoDB's 16 MB hard limit.
analyticsEventSchema.pre('validate', function (next) {
  if (!this.payload) return next();

  let json;
  try {
    json = JSON.stringify(this.payload);
  } catch {
    return next(new Error('[AnalyticsEvent] Payload is not serializable (circular reference?)'));
  }

  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_PAYLOAD_BYTES) {
    return next(new Error(
      `[AnalyticsEvent] Payload too large: ${bytes} bytes (max ${MAX_PAYLOAD_BYTES})`
    ));
  }
  next();
});

// Clamp nextRetryAt to now on new documents to prevent a zero-epoch date
// from causing a worker hot-loop.
analyticsEventSchema.pre('validate', function (next) {
  const floor = new Date(Date.now() - 1000);
  if (this.nextRetryAt && this.nextRetryAt < floor && this.isNew) {
    logger.warn(
      { eventId: this.eventId, nextRetryAt: this.nextRetryAt },
      '[AnalyticsEvent] nextRetryAt was in the past on new document — clamped to now'
    );
    this.nextRetryAt = new Date();
  }
  next();
});

// purchase events must carry a valid resolvedOrderReference.
// Callers are responsible for normalising the value before enqueueing.
analyticsEventSchema.pre('validate', function (next) {
  if (this.eventType !== 'purchase') return next();
  if (!this.payload) return next();

  const ref = this.payload?.context?.resolvedOrderReference;
  if (typeof ref !== 'string' || !ref.startsWith('ORD-')) {
    return next(new Error(
      `[AnalyticsEvent] purchase event missing valid resolvedOrderReference ` +
      `(got: ${String(ref)}). Normalise before enqueueing.`
    ));
  }
  next();
});

// ─── INDEXES ──────────────────────────────────────────────────────────────────

// Primary worker sweep — matches the claimOne() filter and sort exactly.
analyticsEventSchema.index(
  { status: 1, nextRetryAt: 1, priority: -1 },
  { name: 'worker_sweep_idx' }
);

// Recovery sweep — used by recoverStuck() to find timed-out processing events.
analyticsEventSchema.index(
  { status: 1, processingTimeoutAt: 1 },
  {
    name:                    'recovery_sweep_idx',
    partialFilterExpression: { status: 'processing' },
  }
);

analyticsEventSchema.index(
  { eventType: 1, status: 1, createdAt: -1 },
  { name: 'observability_idx' }
);

// TTL — completed documents are automatically deleted after 30 days.
// Documents with completedAt: null are ignored by the TTL monitor.
analyticsEventSchema.index(
  { completedAt: 1 },
  {
    name:               'ttl_completed_idx',
    expireAfterSeconds: TTL_COMPLETED_SECONDS,
  }
);

// ─── VIRTUAL: isRetryable ─────────────────────────────────────────────────────

analyticsEventSchema.virtual('isRetryable').get(function () {
  return (
    this.status === 'pending' &&
    this.attempts < this.maxAttempts
  );
});

// ─── STATIC: claimOne ────────────────────────────────────────────────────────

/**
 * Atomically claim a single eligible event for processing.
 *
 * Uses findOneAndUpdate so the claim and status transition happen in one
 * server-side operation, making it safe under horizontal scaling.
 *
 * @param {number} [processingTimeoutMs]
 * @returns {Promise<Document|null>}
 */
analyticsEventSchema.statics.claimOne = async function (
  processingTimeoutMs = PROCESSING_TIMEOUT_MS
) {
  const now     = new Date();
  const timeout = new Date(now.getTime() + processingTimeoutMs);

  return this.findOneAndUpdate(
    {
      status:      'pending',
      nextRetryAt: { $lte: now },
    },
    {
      $set: {
        status:              'processing',
        processingStartedAt: now,
        processingTimeoutAt: timeout,
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      sort:                  { priority: -1, nextRetryAt: 1 },
      new:                   true,
      includeResultMetadata: false,
    }
  );
};

// ─── STATIC: recoverStuck ────────────────────────────────────────────────────

/**
 * Sweep for orphaned "processing" events — those whose processingTimeoutAt
 * has passed without a status transition (worker crash, OOM, deploy, etc.).
 *
 * Run on a schedule separate from the dispatch worker (e.g. every 5 minutes).
 * Events below maxAttempts are reset to "pending"; those at or above are
 * moved to "dead_letter".
 *
 * @returns {Promise<{recovered: number, deadLettered: number}>}
 */
analyticsEventSchema.statics.recoverStuck = async function () {
  const now = new Date();

  const baseFilter = {
    status:              'processing',
    processingTimeoutAt: { $lte: now },
  };

  const errorEntry = {
    $each:  [{ at: now, message: 'Recovered from stuck processing state (worker timeout)' }],
    $slice: -20,
  };

  const deadErrorEntry = {
    $each:  [{ at: now, message: 'Dead-lettered during recovery: max attempts exceeded' }],
    $slice: -20,
  };

  const [recovered, deadLettered] = await Promise.all([
    this.updateMany(
      { ...baseFilter, $expr: { $lt: ['$attempts', '$maxAttempts'] } },
      {
        $set: {
          status:              'pending',
          processingStartedAt: null,
          processingTimeoutAt: null,
          nextRetryAt:         now,
        },
        $push: { errors: errorEntry },
      }
    ),

    this.updateMany(
      { ...baseFilter, $expr: { $gte: ['$attempts', '$maxAttempts'] } },
      {
        $set: {
          status:              'dead_letter',
          processingStartedAt: null,
          processingTimeoutAt: null,
        },
        $push: { errors: deadErrorEntry },
      }
    ),
  ]);

  const result = {
    recovered:   recovered.modifiedCount,
    deadLettered: deadLettered.modifiedCount,
  };

  logger.warn(result, '[AnalyticsEvent] recoverStuck completed');

  return result;
};

// ─── STATIC: getQueueHealth ──────────────────────────────────────────────────

/**
 * Returns operational queue health metrics.
 *
 * Avoids a completed/total ratio — completed documents are TTL-evicted and
 * the denominator becomes misleading over time. Metrics focus on the live
 * queue instead.
 *
 * @returns {Promise<Object>}
 */
analyticsEventSchema.statics.getQueueHealth = async function () {
  const [statusCounts, oldestPending, processingCount] = await Promise.all([
    this.aggregate([
      { $match: { status: { $in: ['pending', 'processing', 'dead_letter'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    this.findOne({ status: 'pending' })
      .sort({ nextRetryAt: 1 })
      .select('nextRetryAt createdAt')
      .lean(),

    this.countDocuments({
      status:              'processing',
      processingTimeoutAt: { $lte: new Date() },
    }),
  ]);

  const summary = { pending: 0, processing: 0, dead_letter: 0 };
  statusCounts.forEach(({ _id, count }) => {
    if (_id in summary) summary[_id] = count;
  });

  const oldestPendingAgeMs = oldestPending
    ? Date.now() - new Date(oldestPending.createdAt).getTime()
    : 0;

  return {
    ...summary,
    stuckProcessingCount: processingCount,
    oldestPendingAgeMs,
    oldestPendingAgeMins: Math.round(oldestPendingAgeMs / 60_000),
    alerts: {
      deadLetterBacklog: summary.dead_letter > 50,
      queueLag:          oldestPendingAgeMs > 10 * 60 * 1000,
      stuckWorkers:      processingCount > 0,
    },
  };
};

// ─── EXPORT ───────────────────────────────────────────────────────────────────

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

export default AnalyticsEvent;

/**
 * ── ENQUEUE ───────────────────────────────────────────────────────────────────
 *
 *   async function enqueueAnalyticsEvent(eventData) {
 *     try {
 *       await AnalyticsEvent.create(eventData);
 *     } catch (err) {
 *       if (err.code === 11000) return; // already enqueued — safe to ignore
 *       throw err;
 *     }
 *   }
 *
 * ── WORKER ────────────────────────────────────────────────────────────────────
 *
 *   const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 hours
 *
 *   async function dispatchLoop() {
 *     const event = await AnalyticsEvent.claimOne();
 *     if (!event) return; // queue empty
 *
 *     const now = new Date();
 *
 *     try {
 *       // Only dispatch to platforms that have not already succeeded.
 *       // This prevents duplicate conversions on retry after a partial failure.
 *       if (!event.platforms.ga4.success)      await sendGA4(event);
 *       if (!event.platforms.meta.success)     await sendMeta(event);
 *       if (!event.platforms.bigquery.success) await sendBigQuery(event);
 *
 *       // Conditional update — only succeeds if this worker still owns the doc.
 *       // Guards against a recovery sweep resetting the doc between dispatch
 *       // finishing and the completion write landing.
 *       await AnalyticsEvent.updateOne(
 *         { _id: event._id, status: 'processing', processingStartedAt: event.processingStartedAt },
 *         { $set: { status: 'completed', completedAt: now, processingStartedAt: null, processingTimeoutAt: null } }
 *       );
 *     } catch (err) {
 *       const base      = 30_000 * Math.pow(2, event.attempts - 1);
 *       const jitter    = Math.floor(Math.random() * 5_000);
 *       const backoffMs = Math.min(base + jitter, MAX_BACKOFF_MS);
 *
 *       const nextStatus = event.attempts >= event.maxAttempts ? 'dead_letter' : 'pending';
 *
 *       await AnalyticsEvent.updateOne(
 *         { _id: event._id, status: 'processing', processingStartedAt: event.processingStartedAt },
 *         {
 *           $set: {
 *             status:              nextStatus,
 *             nextRetryAt:         nextStatus === 'pending' ? new Date(Date.now() + backoffMs) : undefined,
 *             processingStartedAt: null,
 *             processingTimeoutAt: null,
 *           },
 *           $push: {
 *             errors: {
 *               $each:  [{ at: now, message: err.message }],
 *               $slice: -20,
 *             },
 *           },
 *         }
 *       );
 *     }
 *   }
 *
 * ── RECOVERY SWEEP ────────────────────────────────────────────────────────────
 *
 *   setInterval(() => AnalyticsEvent.recoverStuck(), 5 * 60 * 1000);
 *
 * ── IDEMPOTENCY KEYS — set before first dispatch, never change on retry ───────
 *
 *   event.platforms.ga4.idempotencyKey      = order.id;      // transaction_id
 *   event.platforms.meta.idempotencyKey     = event.eventId; // event_id
 *   event.platforms.bigquery.idempotencyKey = event.eventId; // insertId
 */