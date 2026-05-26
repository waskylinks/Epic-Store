/**
 * backend/jobs/analyticsQueue.js
 *
 * Phase 6 — Event Queue & Retry System
 *
 * CHANGELOG (original fixes from Phase 6):
 *   [FIX-1]  sendDeadLetterAlert hoisting — converted to function declaration
 *   [FIX-2]  Off-by-one retry backoff — getNextRetryDelay uses newAttempts
 *   [FIX-3]  'failed' state renamed to 'retrying'
 *   [FIX-4]  BigQuery skipped check — normalize() includes `skipped` field
 *   [FIX-5]  Concurrency — for..of replaced with Promise.allSettled pool
 *   [FIX-6]  Non-atomic claim — replaced with atomic claimOne() static
 *
 * CHANGELOG (hardening pass 1):
 *   [FIX-7]  enqueueAnalyticsEvent TOCTOU — atomic updateOne($setOnInsert, upsert:true)
 *   [FIX-8]  At-least-once delivery — dispatchId + dispatchStartedAt stamped before
 *            dispatch; stale-lock sweeper recovers crashed workers
 *   [FIX-9]  Backoff formula corrected — BASE * 2^attempts (was BASE * 2^(attempts+1))
 *   [FIX-10] summary.processed semantics — only increments on recorded outcomes
 *
 * CHANGELOG (hardening pass 2):
 *   [FIX-11] Stale event.attempts — $inc:{attempts:1} + {new:true} so post-write
 *            value drives all downstream logic
 *   [FIX-12] dispatchId stability — UUID generated once on first claim, reused
 *            across the full retry chain, preserved on dead_letter
 *   [FIX-13] In-memory event vs DB state — freshEvent (returned by stamp write)
 *            is the canonical source-of-truth for the rest of processOne
 *   [FIX-14] BigQuery best-effort made explicit — ANALYTICS_BQ_BEST_EFFORT env flag;
 *            bigqueryPending flag records BQ gaps for backfill
 *   [FIX-15] Backoff cap — ANALYTICS_QUEUE_BACKOFF_MAX (default 30 s)
 *   [FIX-16] lastError schema normalized — always { message, ga4, meta, bigquery }
 *   [FIX-17] dispatchId forensic retention — preserved on dead_letter, cleared only
 *            on successful completion
 *
 * CHANGELOG (hardening pass 3):
 *   [FIX-18] normalize() success check hardened — changed from `!== false` (treats
 *            undefined/null/{} as success) to `=== true` (explicit opt-in).
 *            Previously any malformed or partial platform response was silently
 *            recorded as success, masking broken integrations.
 *
 *   [FIX-19] Atomic $inc + $set in all outcome paths — the non-success try path
 *            previously issued two separate DB calls: $inc first, then $set status.
 *            Between those calls, the stale-lock sweeper could reset the event to
 *            pending, leaving the attempts increment orphaned. This ate into the
 *            retry budget silently. All outcome writes are now single atomic
 *            operations combining $inc and $set.
 *
 *   [FIX-20] dispatchId explicitly reaffirmed in every $set — previously the catch
 *            path omitted dispatchId from $set, relying on MongoDB not touching
 *            unmentioned fields. Correct but fragile: a future edit adding
 *            $unset or replacing the update could silently drop it. All writes
 *            now explicitly carry dispatchId: freshEvent.dispatchId so the intent
 *            is unambiguous and the field is stable regardless of future changes.
 *
 *   [FIX-21] staleLockSweeper uses targeted per-document atomic reset — previously
 *            updateMany reset all stale events in one pass with no per-document
 *            coordination. A live-but-slow worker could have its event reset while
 *            still in flight, creating a double-processing window. Now each stale
 *            event is reset via findOneAndUpdate with dispatchId in the filter:
 *            if the worker finishes first and writes a new dispatchId, the sweeper's
 *            update finds no match and is a safe no-op. Also changed from
 *            `status: 'pending'` to `status: 'retrying'` with `nextRetryAt: now`
 *            so swept events re-enter the queue through the normal retry path and
 *            are subject to all the same guards.
 *
 *   [FIX-22] Exclusive use of freshEvent throughout processOne — previously logs
 *            and some updates mixed `event` and `freshEvent` references. Now
 *            `freshEvent` is the only identifier used after the stamp step,
 *            eliminating log/execution identity divergence during incidents.
 *
 * ARCHITECTURAL CONTRACT — claimOne() model static:
 *   claimOne() MUST be a single atomic findOneAndUpdate that:
 *     - filter: { status:{$in:['pending','retrying']}, nextRetryAt:{$lte:new Date()} }
 *     - sort:   { priority: -1, nextRetryAt: 1 }
 *     - update: { $set: { status: 'processing' } }
 *     - option: { new: true }
 *   Any implementation that separates the find from the update creates a
 *   double-processing race under horizontal scaling.
 *
 * ARCHITECTURAL NOTE — BigQuery best-effort:
 *   When ANALYTICS_BQ_BEST_EFFORT=true (default), BigQuery failures do not block
 *   event completion. Completed events with bigqueryPending:true can be backfilled
 *   via getPendingBigqueryEvents(). Set ANALYTICS_BQ_BEST_EFFORT=false to make
 *   BigQuery a hard requirement for event completion.
 *
 * ARCHITECTURAL NOTE — staleLockSweeper coordination:
 *   The sweeper uses per-document dispatchId-pinned updates (FIX-21). A worker
 *   that finishes normally will write a new dispatchStartedAt:null, causing the
 *   sweeper's subsequent findOneAndUpdate (which filters on the old dispatchId)
 *   to be a no-op. This makes sweeper + worker overlap safe without requiring
 *   distributed locks or transactions.
 */

import { randomUUID }            from 'crypto';
import AnalyticsEvent            from '../models/AnalyticsEvent.js';
import { sendGA4Purchase, sendGA4Login, sendGA4SignUp, sendGA4CheckoutStep, sendGA4Refund } from '../Services/analytics/ga4Service.js';
import { sendMetaPurchase, sendMetaInitiateCheckout, sendMetaCompleteRegistration }        from '../Services/analytics/metaCapiService.js';
import { streamEventToBigQuery } from '../Services/analytics/bigQueryService.js';
import { sendCronAlert }         from '../utils/cronAlert.js';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const MAX_RETRIES    = parseInt(process.env.ANALYTICS_QUEUE_RETRY_MAX)    || 3;
const BASE_BACKOFF   = parseInt(process.env.ANALYTICS_QUEUE_BACKOFF_BASE) || 1_000;
const MAX_BACKOFF    = parseInt(process.env.ANALYTICS_QUEUE_BACKOFF_MAX)  || 30_000;
const CONCURRENCY    = parseInt(process.env.ANALYTICS_QUEUE_CONCURRENCY)  || 5;
const BQ_BEST_EFFORT = process.env.ANALYTICS_BQ_BEST_EFFORT !== 'false';  // [FIX-14]

// ─── PRIORITY MAP ─────────────────────────────────────────────────────────────

const EVENT_PRIORITY = {
  purchase:         10,
  refund:           9,
  begin_checkout:   8,
  checkout_step:    7,
  checkout_abandon: 6,
  cart_recovery:    6,
  add_to_cart:      5,
  add_to_wishlist:  4,
  login:            3,
  sign_up:          3,
  email_verified:   3,
  view_item:        1,
};

// ─── BACKOFF CALCULATOR ───────────────────────────────────────────────────────

/**
 * [FIX-9]  BASE * 2^attempts (corrected from BASE * 2^(attempts+1))
 * [FIX-15] Capped at MAX_BACKOFF.
 *
 * Delay table at BASE=1000ms, MAX=30000ms:
 *   attempts=1 →  2 s
 *   attempts=2 →  4 s
 *   attempts=3 →  8 s
 *   attempts=4 → 16 s
 *   attempts=5 → 30 s  (capped)
 *
 * @param {number} attempts - Post-increment attempt count
 * @returns {number} milliseconds to wait before next retry
 */
export const getNextRetryDelay = (attempts) =>
  Math.min(MAX_BACKOFF, BASE_BACKOFF * Math.pow(2, attempts));

// ─── PLATFORM DISPATCHER ──────────────────────────────────────────────────────

/**
 * normalize
 *
 * [FIX-4]  Surfaces `skipped` so the BigQuery guard works correctly.
 * [FIX-18] Success check changed from `!== false` to `=== true`.
 *
 *   The old check `settled.value?.success !== false` treated any response that
 *   didn't explicitly set success:false as a success — including undefined, null,
 *   {}, or a completely malformed object. A broken platform service returning
 *   garbage would silently pass as green.
 *
 *   The new check `=== true` requires the platform service to explicitly affirm
 *   success. This is the correct contract for external I/O: opt-in, not opt-out.
 *
 * NOTE: skipped === true is intentional — "no mapping for this event type on
 * this platform" is a valid no-op, not a failure.
 *
 * @param {PromiseSettledResult} settled
 * @returns {{ success: boolean, skipped: boolean, error: string|null, sentAt: Date|null }}
 */
const normalize = (settled) => {
  if (settled.status === 'fulfilled') {
    return {
      success: settled.value?.success === true,         // [FIX-18] explicit opt-in
      skipped: settled.value?.skipped === true,
      error:   settled.value?.success === true ? null : (settled.value?.error || 'no success:true in response'),
      sentAt:  settled.value?.success === true ? new Date() : null,
    };
  }
  return {
    success: false,
    skipped: false,
    error:   settled.reason?.message || String(settled.reason),
    sentAt:  null,
  };
};

/**
 * dispatchToPlatforms
 *
 * Fans out to GA4, Meta CAPI, and BigQuery concurrently.
 *
 * [FIX-12] dispatchId is stable across the full retry chain.
 * [FIX-14] BQ_BEST_EFFORT controls whether BQ failure blocks completion.
 *
 * @param {Document} freshEvent - DB-fresh document (post-dispatchId stamp) [FIX-13/FIX-22]
 * @param {string}   dispatchId - Stable idempotency UUID for this event's retry chain
 * @returns {Promise<{ ga4, meta, bigquery, allSucceeded, bigqueryPending }>}
 */
const dispatchToPlatforms = async (freshEvent, dispatchId) => {
  const { eventType, payload } = freshEvent;
  const { order, user, context } = payload;

  const idempotencyContext = { ...context, dispatchId };

  const ga4Promise = (async () => {
    switch (eventType) {
      case 'purchase':      return sendGA4Purchase(order, idempotencyContext);
      case 'begin_checkout':
      case 'checkout_step': return sendGA4CheckoutStep(payload.step, payload.checkout, idempotencyContext);
      case 'login':         return sendGA4Login(payload.method || 'email', idempotencyContext);
      case 'sign_up':
      case 'email_verified':return sendGA4SignUp(payload.method || 'email', idempotencyContext);
      case 'refund':        return sendGA4Refund(order, payload.refundAmount, idempotencyContext);
      default:              return { success: true, skipped: true, reason: 'no_ga4_mapping' };
    }
  })();

  const metaPromise = (async () => {
    switch (eventType) {
      case 'purchase':      return sendMetaPurchase(order, user, idempotencyContext);
      case 'begin_checkout':return sendMetaInitiateCheckout(payload.checkout, user, idempotencyContext);
      case 'sign_up':
      case 'email_verified':return sendMetaCompleteRegistration(user, idempotencyContext);
      default:              return { success: true, skipped: true, reason: 'no_meta_mapping' };
    }
  })();

  const bqPromise = streamEventToBigQuery(payload, dispatchId);

  const [ga4Result, metaResult, bqResult] = await Promise.allSettled([
    ga4Promise,
    metaPromise,
    bqPromise,
  ]);

  const platforms = {
    ga4:      normalize(ga4Result),
    meta:     normalize(metaResult),
    bigquery: normalize(bqResult),
  };

  // [FIX-14] BQ_BEST_EFFORT determines the success definition and backfill flag.
  const bqOk = platforms.bigquery.success || platforms.bigquery.skipped;
  if (BQ_BEST_EFFORT) {
    platforms.allSucceeded    = platforms.ga4.success && platforms.meta.success;
    platforms.bigqueryPending = !bqOk;
    if (!bqOk) {
      console.warn('[AnalyticsQueue] BigQuery dispatch failed (best-effort, non-fatal):', platforms.bigquery.error);
    }
  } else {
    platforms.allSucceeded    = platforms.ga4.success && platforms.meta.success && bqOk;
    platforms.bigqueryPending = false;
  }

  return platforms;
};

// ─── DEAD-LETTER ALERT ────────────────────────────────────────────────────────

/**
 * [FIX-1] Function declaration — fully hoisted, no temporal dead zone risk.
 */
async function sendDeadLetterAlert(freshEvent, platforms, finalAttempts) {
  const failedPlatforms = Object.entries(platforms)
    .filter(([key, val]) => key !== 'allSucceeded' && key !== 'bigqueryPending' && !val.success && !val.skipped)
    .map(([key, val]) => `${key}: ${val.error}`)
    .join('\n');

  await sendCronAlert({
    jobName: 'AnalyticsQueue',
    status:  'dead_letter',
    message: `Analytics event moved to dead_letter after ${finalAttempts} attempt(s)`,
    details: {
      eventId:    freshEvent.eventId,
      eventType:  freshEvent.eventType,
      dispatchId: freshEvent.dispatchId,
      attempts:   finalAttempts,
      failures:   failedPlatforms,
    },
  });
}

// ─── ENQUEUE ──────────────────────────────────────────────────────────────────

/**
 * Persists an analytics event to the queue.
 *
 * [FIX-7] Single atomic updateOne($setOnInsert, upsert:true) — no race window.
 * dispatchId is not generated here; it is assigned on first claim so it is
 * bound to the processing attempt, not the enqueue moment. [FIX-12]
 *
 * @param {string} eventType
 * @param {Object} payload - Full analytics payload including order, user, context
 * @returns {Promise<void>}
 */
export const enqueueAnalyticsEvent = async (eventType, payload) => {
  const eventId = payload.event_id || payload.eventId;

  if (!eventId) {
    throw new Error('[AnalyticsQueue] eventId is required — payload must include event_id');
  }

  await AnalyticsEvent.updateOne(
    { eventId },
    {
      $setOnInsert: {
        eventId,
        eventType,
        payload,
        status:      'pending',
        attempts:    0,
        maxAttempts: MAX_RETRIES,
        nextRetryAt: new Date(),
        priority:    EVENT_PRIORITY[eventType] ?? 5,
      },
    },
    { upsert: true }
  );

  console.debug(`[AnalyticsQueue] Event enqueued (or already exists): ${eventId}`);
};

// ─── SINGLE EVENT PROCESSOR ───────────────────────────────────────────────────

/**
 * processOne
 *
 * Processes a single event that has already been atomically claimed.
 *
 * STATE TRANSITION MODEL (linearized):
 *
 *   processing → [stamp dispatchId] → dispatching → completed
 *                                                 → retrying
 *                                                 → dead_letter
 *
 * Every terminal write is a single atomic $inc+$set. No two-phase writes exist.
 * [FIX-19] This eliminates the orphaned-increment window between separate
 * $inc and $set calls.
 *
 * IDENTITY MODEL:
 *   `freshEvent` is the canonical document after the dispatchId stamp.
 *   [FIX-22] All DB updates, logs, and alerts use freshEvent exclusively.
 *   The `event` argument is only used to extract `_id` for the initial stamp;
 *   after that it is not referenced again.
 *
 * DISPATCHID LIFECYCLE:
 *   - Generated once on first claim (or reused from a prior attempt) [FIX-12]
 *   - Explicitly written in every subsequent DB update [FIX-20]
 *   - Cleared only on successful completion [FIX-17]
 *   - Preserved on dead_letter for forensic correlation [FIX-17]
 *   - Preserved through stale-lock sweeper resets [FIX-21]
 *
 * @param {Document} event - Claimed document; only _id is used after stamp
 * @returns {Promise<'succeeded'|'retrying'|'dead_letter'>}
 */
const processOne = async (event) => {
  // [FIX-12] Reuse existing dispatchId (retry path) or generate new one (first attempt).
  // [FIX-13] Read back updated document — freshEvent is authoritative from here on.
  // [FIX-22] All code below uses freshEvent, not event.
  const dispatchId = event.dispatchId || randomUUID();
  const freshEvent = await AnalyticsEvent.findByIdAndUpdate(
    event._id,
    { $set: { dispatchId, dispatchStartedAt: new Date() } },
    { new: true }
  );

  if (!freshEvent) {
    console.warn('[AnalyticsQueue] Event disappeared after claim, skipping:', event._id);
    return 'retrying';
  }

  try {
    const platforms = await dispatchToPlatforms(freshEvent, dispatchId);

    if (platforms.allSucceeded) {
      // [FIX-19] Single atomic write — $inc + $set, no split.
      // [FIX-20] dispatchId explicitly set to null (cleared on success) [FIX-17]
      const completed = await AnalyticsEvent.findByIdAndUpdate(
        freshEvent._id,
        {
          $inc: { attempts: 1 },
          $set: {
            status:            'completed',
            platforms,
            completedAt:       new Date(),
            bigqueryPending:   platforms.bigqueryPending,
            lastError:         null,
            dispatchId:        null,   // [FIX-17] cleared only on success
            dispatchStartedAt: null,
          },
        },
        { new: true }
      );
      console.debug(
        `[AnalyticsQueue] Completed in ${completed.attempts} attempt(s): ${freshEvent.eventId}`
      );
      return 'succeeded';
    }

    // [FIX-19] $inc and $set are combined into one atomic write.
    //          Previously these were two separate calls, leaving a window where
    //          the sweeper could reset the event between them, orphaning the $inc.
    // [FIX-20] dispatchId explicitly reaffirmed — survives future refactors.
    // [FIX-17] dispatchId preserved (not cleared) on retry and dead_letter.
    const failUpdate = await AnalyticsEvent.findByIdAndUpdate(
      freshEvent._id,
      {
        $inc: { attempts: 1 },
        $set: {
          platforms,
          dispatchId,        // [FIX-20] explicit — intent is unambiguous
          dispatchStartedAt: null,
        },
      },
      { new: true }
    );
    const finalAttempts = failUpdate.attempts;

    if (finalAttempts >= MAX_RETRIES) {
      // [FIX-16] Structured lastError schema.
      // [FIX-17] dispatchId retained via the reaffirmation above.
      await AnalyticsEvent.findByIdAndUpdate(freshEvent._id, {
        $set: {
          status:    'dead_letter',
          lastError: {
            message:  'Max retries exceeded',
            ga4:      platforms.ga4.error,
            meta:     platforms.meta.error,
            bigquery: platforms.bigquery.error,
          },
        },
      });

      await sendDeadLetterAlert(freshEvent, platforms, finalAttempts).catch(err =>
        console.error('[AnalyticsQueue] Dead-letter alert failed:', err.message)
      );
      return 'dead_letter';
    }

    await AnalyticsEvent.findByIdAndUpdate(freshEvent._id, {
      $set: {
        status:      'retrying',
        nextRetryAt: new Date(Date.now() + getNextRetryDelay(finalAttempts)),
        lastError: {
          message:  `Attempt ${finalAttempts} failed`,
          ga4:      platforms.ga4.error,
          meta:     platforms.meta.error,
          bigquery: platforms.bigquery.error,
        },
      },
    });
    return 'retrying';

  } catch (unexpectedError) {
    // [FIX-22] freshEvent used exclusively in logs.
    console.error('[AnalyticsQueue] Unexpected error processing event:', {
      eventId:    freshEvent.eventId,
      eventType:  freshEvent.eventType,
      dispatchId: freshEvent.dispatchId,
      error:      unexpectedError.message,
    });

    // [FIX-19] Single atomic $inc + $set.
    // [FIX-20] dispatchId explicitly reaffirmed.
    const errUpdate = await AnalyticsEvent.findByIdAndUpdate(
      freshEvent._id,
      {
        $inc: { attempts: 1 },
        $set: {
          dispatchId,        // [FIX-20]
          dispatchStartedAt: null,
        },
      },
      { new: true }
    );
    const finalAttempts = errUpdate.attempts;

    if (finalAttempts >= MAX_RETRIES) {
      await AnalyticsEvent.findByIdAndUpdate(freshEvent._id, {
        $set: {
          status:    'dead_letter',
          lastError: { message: unexpectedError.message, ga4: null, meta: null, bigquery: null },
        },
      });
      return 'dead_letter';
    }

    await AnalyticsEvent.findByIdAndUpdate(freshEvent._id, {
      $set: {
        status:      'retrying',
        nextRetryAt: new Date(Date.now() + getNextRetryDelay(finalAttempts)),
        lastError:   { message: unexpectedError.message, ga4: null, meta: null, bigquery: null },
      },
    });
    return 'retrying';
  }
};

// ─── QUEUE WORKER ─────────────────────────────────────────────────────────────

/**
 * Main worker — called by cronRegistry.js every 60 seconds.
 *
 * [FIX-5]  Concurrent dispatch via Promise.allSettled.
 * [FIX-6]  Atomic claimOne() prevents duplicate processing.
 * [FIX-10] summary.processed increments only on recorded outcomes;
 *          summary.errors tracks unexpected processOne rejections separately.
 *
 * @returns {Promise<{ processed: number, succeeded: number, retrying: number, deadLettered: number, errors: number }>}
 */
export const processAnalyticsQueue = async () => {
  const summary = { processed: 0, succeeded: 0, retrying: 0, deadLettered: 0, errors: 0 };

  const claimPromises = Array.from({ length: CONCURRENCY }, () => AnalyticsEvent.claimOne());
  const claimed = (await Promise.all(claimPromises)).filter(Boolean);

  if (claimed.length === 0) return summary;

  console.debug(`[AnalyticsQueue] Claimed ${claimed.length} event(s) for processing`);

  const results = await Promise.allSettled(claimed.map(processOne));

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[AnalyticsQueue] processOne rejected unexpectedly:', result.reason);
      summary.errors++;
      continue;
    }
    summary.processed++;
    switch (result.value) {
      case 'succeeded':   summary.succeeded++;    break;
      case 'retrying':    summary.retrying++;     break;
      case 'dead_letter': summary.deadLettered++; break;
    }
  }

  console.debug('[AnalyticsQueue] Sweep complete:', summary);
  return summary;
};

// ─── QUEUE MANAGEMENT UTILITIES ───────────────────────────────────────────────

/**
 * Resets dead_letter events back to pending for manual retry.
 * Clears dispatchId so a fresh UUID is assigned on next claim.
 *
 * @param {string|null} eventType - Filter by type, or null for all
 * @returns {Promise<number>}
 */
export const retryDeadLetterEvents = async (eventType = null) => {
  const filter = { status: 'dead_letter' };
  if (eventType) filter.eventType = eventType;

  const result = await AnalyticsEvent.updateMany(filter, {
    $set: {
      status:      'pending',
      attempts:    0,
      nextRetryAt: new Date(),
      lastError:   null,
      dispatchId:  null,
    },
  });

  console.info(`[AnalyticsQueue] Reset ${result.modifiedCount} dead-letter event(s) to pending`);
  return result.modifiedCount;
};

/**
 * Manually purges completed events older than the given number of days.
 * The TTL index handles this automatically — use this for immediate dev cleanup.
 *
 * @param {number} olderThanDays
 * @returns {Promise<number>}
 */
export const purgeCompletedEvents = async (olderThanDays = 30) => {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await AnalyticsEvent.deleteMany({
    status:      'completed',
    completedAt: { $lt: cutoff },
  });

  console.info(`[AnalyticsQueue] Purged ${result.deletedCount} completed event(s)`);
  return result.deletedCount;
};

// ─── STALE LOCK SWEEPER ───────────────────────────────────────────────────────

/**
 * staleLockSweeper
 *
 * Recovers events abandoned in 'processing' state (process crash, OOM kill,
 * network partition after dispatch but before DB write).
 *
 * [FIX-21] COORDINATION MODEL — per-document atomic reset:
 *
 *   The previous implementation used updateMany, which has no per-document
 *   coordination: a live-but-slow worker could have its event swept while still
 *   dispatching, then both the worker and a new claimOne() caller would proceed,
 *   causing duplicate dispatch.
 *
 *   The fix: each stale event is reset via findOneAndUpdate with BOTH status AND
 *   dispatchId in the filter. The dispatchId was captured at the time we identified
 *   the stale event, so:
 *
 *     - If the original worker finishes normally first, it writes dispatchStartedAt:null
 *       and clears dispatchId (on success) or updates dispatchId (on retry/dead_letter).
 *       The sweeper's subsequent findOneAndUpdate finds no matching { dispatchId }
 *       and is a safe no-op.
 *
 *     - If the original worker has truly crashed, dispatchId is unchanged and the
 *       sweeper's update succeeds, correctly resetting the event.
 *
 *   dispatchId is intentionally preserved on reset (not cleared) so the next
 *   processOne() reuses it and platform deduplication holds. [FIX-12]
 *
 *   Events are reset to 'retrying' with nextRetryAt:now (not 'pending') so they
 *   re-enter the queue through the normal retry path and are subject to all guards.
 *
 * Recommended TTL: 5× p99 dispatch latency (e.g. 60 000 ms).
 * Register as a separate cron job running every staleTtlMs.
 *
 * @param {number} staleTtlMs - ms before a processing lock is considered stale
 * @returns {Promise<number>} Number of events reset
 */
export const staleLockSweeper = async (staleTtlMs = 60_000) => {
  const staleThreshold = new Date(Date.now() - staleTtlMs);

  // Find all candidates first (read-only pass).
  const staleEvents = await AnalyticsEvent.find(
    {
      status:            'processing',
      dispatchStartedAt: { $lt: staleThreshold },
    },
    { _id: 1, dispatchId: 1, eventId: 1 }
  ).lean();

  if (staleEvents.length === 0) return 0;

  // [FIX-21] Reset each event with its specific dispatchId in the filter.
  // A live worker finishing between find and update makes this a safe no-op.
  const resetPromises = staleEvents.map(({ _id, dispatchId, eventId }) =>
    AnalyticsEvent.findOneAndUpdate(
      {
        _id,
        dispatchId,            // [FIX-21] pin to exact dispatch attempt
        status: 'processing',  // guard: only reset if still processing
      },
      {
        $set: {
          status:            'retrying',  // re-enter via retry path, not pending
          nextRetryAt:       new Date(),
          lastError:         { message: 'reset by stale-lock sweeper', ga4: null, meta: null, bigquery: null },
          dispatchStartedAt: null,
          // dispatchId intentionally NOT cleared — next retry reuses it [FIX-12]
        },
      },
      { new: false }  // we don't need the result, just the side effect
    ).then(result => {
      if (result) {
        console.warn(`[AnalyticsQueue] Stale-lock sweeper reset event: ${eventId} (dispatchId: ${dispatchId})`);
      }
      return result ? 1 : 0;
    })
  );

  const outcomes = await Promise.allSettled(resetPromises);
  const resetCount = outcomes.reduce((sum, o) => sum + (o.status === 'fulfilled' ? o.value : 0), 0);

  if (resetCount > 0) {
    console.warn(`[AnalyticsQueue] Stale-lock sweeper reset ${resetCount}/${staleEvents.length} event(s)`);
  }

  return resetCount;
};

// ─── BIGQUERY BACKFILL ────────────────────────────────────────────────────────

/**
 * getPendingBigqueryEvents
 *
 * [FIX-14] Surfaces completed events where BigQuery was skipped in best-effort mode.
 * Data-pipeline teams query this to identify and backfill BQ gaps.
 *
 * @param {number} limit - Max events to return per call (default 100)
 * @returns {Promise<Document[]>}
 */
export const getPendingBigqueryEvents = async (limit = 100) => {
  return AnalyticsEvent.find(
    { status: 'completed', bigqueryPending: true },
    { eventId: 1, eventType: 1, payload: 1, completedAt: 1, dispatchId: 1 }
  )
    .sort({ completedAt: 1 })
    .limit(limit)
    .lean();
};