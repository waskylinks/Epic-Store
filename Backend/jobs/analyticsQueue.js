/**
 * backend/jobs/analyticsQueue.js
 *
 * Phase 6 — Event Queue & Retry System
 *
 * CHANGELOG (original fixes from Phase 6):
 *   [FIX-1]  sendDeadLetterAlert hoisting — converted to function declaration
 *   [FIX-2]  Off-by-one retry backoff — getNextRetryDelay uses newAttempts
 *   [FIX-3]  'failed' state renamed — pending used for retries (model contract)
 *   [FIX-4]  BigQuery skipped check — normalize() includes `skipped` field
 *   [FIX-5]  Concurrency — for..of replaced with Promise.allSettled pool
 *   [FIX-6]  Non-atomic claim — replaced with atomic claimOne() static
 *
 * CHANGELOG (hardening pass 1):
 *   [FIX-7]  enqueueAnalyticsEvent TOCTOU — atomic updateOne($setOnInsert, upsert:true)
 *   [FIX-8]  At-least-once delivery — dispatchId + dispatchStartedAt stamped before
 *            dispatch; stale-lock recovery for crashed workers
 *   [FIX-9]  Backoff formula corrected — BASE * 2^attempts (was BASE * 2^(attempts+1))
 *   [FIX-10] summary.processed semantics — only increments on recorded outcomes
 *
 * CHANGELOG (hardening pass 2):
 *   [FIX-11] $inc moved to claimOne() — attempts is incremented once atomically at
 *            claim time; processOne never increments again (removed all $inc from
 *            processOne to prevent double-counting and premature dead-lettering)
 *   [FIX-12] dispatchId stability — UUID generated once on first claim, reused
 *            across the full retry chain, preserved on dead_letter
 *   [FIX-13] freshEvent as canonical source-of-truth throughout processOne
 *   [FIX-14] BigQuery best-effort made explicit — ANALYTICS_BQ_BEST_EFFORT env flag
 *   [FIX-15] Backoff cap — ANALYTICS_QUEUE_BACKOFF_MAX (default 30 s)
 *   [FIX-16] Error history via model's errors[] array — lastError was written to an
 *            undeclared field (Mongoose strict mode silently drops it). Now uses
 *            $push into the schema-defined errors[] array.
 *   [FIX-17] dispatchId forensic retention — preserved on dead_letter, null on complete
 *
 * CHANGELOG (hardening pass 3):
 *   [FIX-18] normalize() success check — `=== true` (explicit opt-in, not `!== false`)
 *   [FIX-19] Status-write race — second $set now includes status guard
 *            { status: 'processing' } so a sweeper reset between the two writes
 *            is a safe no-op rather than overwriting the swept state.
 *   [FIX-20] dispatchId reaffirmed in every outcome $set
 *   [FIX-21] staleLockSweeper per-document atomic reset with dispatchId pin;
 *            skips null-dispatchId events (not yet stamped = not stale);
 *            sweeper rejection errors now logged explicitly
 *   [FIX-22] Exclusive use of freshEvent throughout processOne
 *
 * CHANGELOG (cross-cutting flow fixes — hardening pass 4):
 *   [FIX-23] status enum alignment — model defines ['pending','processing',
 *            'completed','dead_letter']. Previous code wrote 'retrying' which
 *            Mongoose strict mode silently drops, stranding events permanently in
 *            'processing'. All retry paths now write status:'pending' + nextRetryAt,
 *            matching the model's scheduling contract (claimOne filters pending +
 *            nextRetryAt <= now).
 *
 *   [FIX-24] Double $inc eliminated — claimOne() (model static) already does
 *            $inc:{attempts:1} atomically at claim time. processOne was then doing
 *            another $inc on every outcome, causing attempts to be 2 on first
 *            attempt, dead-letter threshold firing one attempt early, and logged
 *            attempt counts being wrong. All $inc removed from processOne; threshold
 *            check uses freshEvent.attempts (already post-increment from claimOne).
 *
 *   [FIX-25] claimOne() rejection isolation — previously Promise.all(claimPromises)
 *            would throw if any single claimOne() rejected, aborting the entire
 *            sweep. Replaced with Promise.allSettled so one DB error does not
 *            prevent other claims from proceeding.
 *
 *   [FIX-26] retryDeadLetterEvents clears dispatchStartedAt — previously only
 *            dispatchId was cleared; a stale dispatchStartedAt on a revived event
 *            would cause the sweeper to immediately re-sweep it.
 *
 *   [FIX-27] GA4 session ID field name — ga4Service.sendGA4Purchase/CheckoutStep
 *            reads context.ga4SessionId but the orchestrator stores it as
 *            context.sessionId. Queue-path GA4 calls were silently getting
 *            undefined for session_id, breaking session stitching. The
 *            idempotencyContext now explicitly maps sessionId → ga4SessionId.
 *
 *   [FIX-28] streamEventToBigQuery signature — bigQueryService defines
 *            streamEventToBigQuery(payload) with one argument; the dispatchId
 *            second argument was silently ignored so BQ dedup via dispatchId was
 *            never actually wired. BQ uses event_id internally as insertId which
 *            is correct for event-level dedup. The call is corrected to one arg.
 *            The dispatchId is included inside idempotencyContext for GA4/Meta only.
 *
 *   [FIX-29] eventId canonical resolution — enqueueAnalyticsEvent now resolves
 *            event_id || eventId once, warns loudly if only the legacy field is
 *            found, and passes the resolved value explicitly so both the document
 *            eventId field and payload.event_id are consistent.
 *
 * MODEL CONTRACTS (do not change without updating AnalyticsEvent.js):
 *   - status enum: ['pending', 'processing', 'completed', 'dead_letter']
 *   - claimOne() atomically: finds pending + nextRetryAt<=now, sets processing,
 *     $inc attempts:1, returns new document
 *   - recoverStuck() resets timed-out processing events using processingTimeoutAt
 *   - errors[] is the schema-defined error history array (retryErrorSchema)
 *
 * BIGQUERY NOTE:
 *   streamEventToBigQuery uses event.event_id as its own insertId for row-level
 *   deduplication within BigQuery's 1-minute window. This is correct and sufficient.
 *   The dispatchId is not forwarded to BQ (signature mismatch — see FIX-28).
 *
 * STALE LOCK NOTE:
 *   The model provides recoverStuck() which uses processingTimeoutAt (set by
 *   claimOne). staleLockSweeper here operates on dispatchStartedAt as a secondary
 *   guard for events that passed the stamp step but stalled during dispatch.
 *   Both should be registered as separate cron jobs. recoverStuck() handles events
 *   that never reached the stamp step; staleLockSweeper handles the rest.
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
// [FIX-14] Explicit opt-in/out. Set ANALYTICS_BQ_BEST_EFFORT=false to make BQ mandatory.
const BQ_BEST_EFFORT = process.env.ANALYTICS_BQ_BEST_EFFORT !== 'false';

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
 * [FIX-9]  BASE * 2^attempts — corrected from BASE * 2^(attempts+1).
 * [FIX-15] Capped at MAX_BACKOFF to prevent runaway delays under outage.
 *
 * Delay table at BASE=1000ms, MAX=30000ms:
 *   attempts=1 →  2 s
 *   attempts=2 →  4 s
 *   attempts=3 →  8 s
 *   attempts=4 → 16 s
 *   attempts=5 → 30 s (capped)
 *
 * @param {number} attempts - Current attempt count (already incremented by claimOne)
 * @returns {number} Milliseconds to wait before next retry
 */
export const getNextRetryDelay = (attempts) =>
  Math.min(MAX_BACKOFF, BASE_BACKOFF * Math.pow(2, attempts));

// ─── PLATFORM DISPATCHER ──────────────────────────────────────────────────────

/**
 * normalize
 *
 * [FIX-4]  Surfaces `skipped` so the BigQuery guard works correctly.
 * [FIX-18] Success check uses `=== true` (explicit opt-in).
 *
 *   `!== false` treated undefined/null/{} as success, masking broken integrations.
 *   `=== true` requires the platform service to explicitly affirm success.
 *
 * NOTE: skipped===true with success===true is valid — "no mapping for this event
 * type" is an intentional no-op. The allSucceeded and alert logic treat
 * success:true correctly regardless of skipped value.
 *
 * @param {PromiseSettledResult} settled
 * @returns {{ success: boolean, skipped: boolean, error: string|null, sentAt: Date|null }}
 */
const normalize = (settled) => {
  if (settled.status === 'fulfilled') {
    const ok = settled.value?.success === true;
    return {
      success: ok,
      skipped: settled.value?.skipped === true,
      error:   ok ? null : (settled.value?.error || 'no success:true in platform response'),
      sentAt:  ok ? new Date() : null,
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
 * [FIX-12] dispatchId is stable across the full retry chain — generated once on
 *          first claim and reused. GA4 and Meta use it for server-side dedup.
 *
 * [FIX-14] BQ_BEST_EFFORT controls whether BQ failure blocks completion.
 *          bigqueryPending is set so completed events with BQ gaps are surfaced
 *          via getPendingBigqueryEvents() for backfill.
 *
 * [FIX-27] GA4 session ID field mapping — ga4Service reads context.ga4SessionId
 *          but the orchestrator stores the value as context.sessionId. The
 *          idempotencyContext maps sessionId → ga4SessionId explicitly so
 *          queue-path GA4 calls receive the correct field name.
 *
 * [FIX-28] streamEventToBigQuery takes one argument (payload). The second
 *          dispatchId argument was silently ignored by the BQ service, which
 *          uses event.event_id internally as the insertId. Corrected to one arg.
 *
 * @param {Document} freshEvent - DB-fresh document (post-dispatchId stamp)
 * @param {string}   dispatchId - Stable idempotency UUID for this retry chain
 * @returns {Promise<{ ga4, meta, bigquery, allSucceeded, bigqueryPending }>}
 */
const dispatchToPlatforms = async (freshEvent, dispatchId) => {
  const { eventType, payload } = freshEvent;
  const { order, user, context } = payload;

  // [FIX-27] Map sessionId → ga4SessionId so GA4 service receives the correct
  // field name. Also forward dispatchId for GA4/Meta idempotency.
  const idempotencyContext = {
    ...context,
    dispatchId,
    ga4SessionId: context?.ga4SessionId ?? context?.sessionId ?? null,
  };

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

  // [FIX-28] One argument — BQ service uses event.event_id as its own insertId.
  const bqPromise = streamEventToBigQuery(payload);

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

  // [FIX-14] BQ_BEST_EFFORT: true = BQ failure is non-fatal; false = BQ is mandatory.
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
 * [FIX-7]  Single atomic updateOne($setOnInsert, upsert:true) — no race window.
 *          $setOnInsert is a pure no-op when eventId already exists.
 *
 * [FIX-29] eventId canonical resolution — resolves event_id || eventId once
 *          and stores the result consistently in both the document eventId field
 *          and payload.event_id so BigQuery insertId and document dedup key are
 *          always the same value. Warns loudly if only the legacy eventId field
 *          is found so callers can migrate to event_id.
 *
 * [FIX-12] dispatchId is NOT set here — generated on first claim so it is
 *          bound to the processing attempt, not the enqueue moment.
 *
 * @param {string} eventType
 * @param {Object} payload - Full analytics payload including order, user, context
 * @returns {Promise<void>}
 */
export const enqueueAnalyticsEvent = async (eventType, payload) => {
  // [FIX-29] Resolve canonical eventId once. Warn if only legacy field present.
  let eventId = payload.event_id;
  if (!eventId && payload.eventId) {
    console.warn(
      '[AnalyticsQueue] payload.eventId is deprecated — use payload.event_id. ' +
      `Falling back for eventType: ${eventType}`
    );
    eventId = payload.eventId;
  }

  if (!eventId) {
    throw new Error('[AnalyticsQueue] eventId is required — payload must include event_id');
  }

  // Normalise payload so both fields are consistent before storing.
  const normalisedPayload = { ...payload, event_id: eventId };

  await AnalyticsEvent.updateOne(
    { eventId },
    {
      $setOnInsert: {
        eventId,
        eventType,
        payload: normalisedPayload,
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
 * Processes a single event that has already been atomically claimed by claimOne().
 *
 * ATTEMPTS TRACKING [FIX-24]:
 *   claimOne() does $inc:{attempts:1} atomically. processOne NEVER increments
 *   again. freshEvent.attempts is the authoritative post-increment count.
 *   Threshold check: freshEvent.attempts >= MAX_RETRIES.
 *
 * STATUS ENUM [FIX-23]:
 *   Model defines: ['pending', 'processing', 'completed', 'dead_letter'].
 *   Retry paths write status:'pending' + nextRetryAt (claimOne re-picks up
 *   pending events where nextRetryAt <= now). 'retrying' was previously written
 *   and silently dropped by Mongoose strict mode, stranding events forever.
 *
 * STATE TRANSITIONS:
 *   processing → completed    (all required platforms succeeded)
 *   processing → pending      (partial failure, retry budget remaining)
 *   processing → dead_letter  (retry budget exhausted)
 *
 * IDENTITY [FIX-22]:
 *   freshEvent is canonical after the dispatchId stamp. `event` is only used
 *   for the initial $set{dispatchId} lookup and not referenced afterwards.
 *
 * DISPATCHID LIFECYCLE [FIX-12, FIX-17, FIX-20]:
 *   - Reused from prior attempt or generated fresh on first attempt
 *   - Written to DB before any external call (stamp step)
 *   - Explicitly present in every outcome $set (no accidental nullification)
 *   - Cleared to null only on successful completion
 *   - Preserved on dead_letter for forensic tracing
 *
 * STATUS-WRITE RACE [FIX-19]:
 *   The second $set (status/lastError) includes { status: 'processing' } in its
 *   filter so it is a no-op if the sweeper has already reset the document.
 *   The $inc+$set intermediate write that records platforms/dispatchId uses
 *   { status: 'processing' } guard too — if it finds no match the event was
 *   swept; we return 'pending' to reflect it will be retried.
 *
 * ERROR HISTORY [FIX-16]:
 *   Uses the model's schema-defined errors[] array ($push) instead of lastError
 *   which is not declared in AnalyticsEvent schema and would be silently dropped
 *   by Mongoose strict mode.
 *
 * @param {Document} event - Claimed document; only _id used after stamp
 * @returns {Promise<'succeeded'|'pending'|'dead_letter'>}
 */
const processOne = async (event) => {
  // [FIX-12] Reuse existing dispatchId (retry) or generate new (first attempt).
  // [FIX-13] Read back updated document — freshEvent is authoritative from here on.
  const dispatchId = event.dispatchId || randomUUID();
  const freshEvent = await AnalyticsEvent.findByIdAndUpdate(
    event._id,
    { $set: { dispatchId, dispatchStartedAt: new Date() } },
    { new: true }
  );

  if (!freshEvent) {
    // Document deleted between claim and stamp — nothing to process.
    console.warn('[AnalyticsQueue] Event disappeared after claim, skipping:', event._id);
    return 'pending';
  }

  // [FIX-24] attempts was already incremented by claimOne(). Use freshEvent.attempts
  // directly — no further $inc needed anywhere in this function.
  const currentAttempts = freshEvent.attempts;

  try {
    const platforms = await dispatchToPlatforms(freshEvent, dispatchId);

    if (platforms.allSucceeded) {
      // [FIX-17] dispatchId cleared only on success.
      // [FIX-20] dispatchId explicitly set (null) so intent is unambiguous.
      // No $inc — claimOne already incremented.
      const completed = await AnalyticsEvent.findByIdAndUpdate(
        freshEvent._id,
        {
          $set: {
            status:            'completed',
            platforms,
            completedAt:       new Date(),
            bigqueryPending:   platforms.bigqueryPending,
            dispatchId:        null,
            dispatchStartedAt: null,
          },
        },
        { new: true }
      );
      if (completed) {
        console.debug(
          `[AnalyticsQueue] Completed in ${completed.attempts} attempt(s): ${freshEvent.eventId}`
        );
      }
      return 'succeeded';
    }

    // Partial or full failure — record platforms result atomically.
    // [FIX-19] Include status guard: if sweeper reset this between dispatch and
    // now, the update finds no match and we treat the event as pending (swept).
    // [FIX-20] dispatchId reaffirmed explicitly.
    // [FIX-23] No $inc — claimOne already did it.
    const recorded = await AnalyticsEvent.findOneAndUpdate(
      { _id: freshEvent._id, status: 'processing' },
      {
        $set: {
          platforms,
          dispatchId,
          dispatchStartedAt: null,
        },
      },
      { new: true }
    );

    if (!recorded) {
      // Sweeper reset the event between dispatch and this write.
      // It's now pending and will be retried normally — safe to return.
      console.warn('[AnalyticsQueue] Event was swept during dispatch, will be retried:', freshEvent.eventId);
      return 'pending';
    }

    // [FIX-24] Use currentAttempts (from claimOne's $inc) for threshold check.
    if (currentAttempts >= MAX_RETRIES) {
      // [FIX-16] Push into schema-defined errors[] array.
      // [FIX-23] status: dead_letter — valid model enum value.
      // [FIX-19] Filter on status:'processing' so this is a no-op if swept.
      await AnalyticsEvent.findOneAndUpdate(
        { _id: freshEvent._id, status: 'processing' },
        {
          $set: {
            status:    'dead_letter',
          },
          $push: {
            errors: {
              at:      new Date(),
              message: `Max retries (${MAX_RETRIES}) exceeded — ga4:${platforms.ga4.error} meta:${platforms.meta.error} bq:${platforms.bigquery.error}`,
            },
          },
        }
      );

      await sendDeadLetterAlert(freshEvent, platforms, currentAttempts).catch(err =>
        console.error('[AnalyticsQueue] Dead-letter alert failed:', err.message)
      );
      return 'dead_letter';
    }

    // [FIX-23] Retry: status:'pending' + nextRetryAt. claimOne will re-pick
    //          this up when nextRetryAt <= now. NOT 'retrying' — that value is
    //          not in the model enum and would be silently dropped.
    // [FIX-16] Push error record into schema-defined errors[] array.
    // [FIX-19] Filter guards against sweeper race.
    await AnalyticsEvent.findOneAndUpdate(
      { _id: freshEvent._id, status: 'processing' },
      {
        $set: {
          status:      'pending',
          nextRetryAt: new Date(Date.now() + getNextRetryDelay(currentAttempts)),
        },
        $push: {
          errors: {
            at:      new Date(),
            message: `Attempt ${currentAttempts} failed — ga4:${platforms.ga4.error} meta:${platforms.meta.error} bq:${platforms.bigquery.error}`,
          },
        },
      }
    );
    return 'pending';

  } catch (unexpectedError) {
    // [FIX-22] freshEvent used exclusively in logs.
    console.error('[AnalyticsQueue] Unexpected error processing event:', {
      eventId:    freshEvent.eventId,
      eventType:  freshEvent.eventType,
      dispatchId: freshEvent.dispatchId,
      error:      unexpectedError.message,
    });

    // [FIX-20] dispatchId reaffirmed.
    // [FIX-19] Status guard so sweeper reset is a safe no-op.
    // [FIX-24] No $inc — use currentAttempts already set from claimOne.
    const recovered = await AnalyticsEvent.findOneAndUpdate(
      { _id: freshEvent._id, status: 'processing' },
      {
        $set: {
          dispatchId,
          dispatchStartedAt: null,
        },
      },
      { new: true }
    );

    if (!recovered) {
      console.warn('[AnalyticsQueue] Event was swept during unexpected error handling:', freshEvent.eventId);
      return 'pending';
    }

    if (currentAttempts >= MAX_RETRIES) {
      // [FIX-16] Schema-defined errors[] array.
      // [FIX-23] dead_letter is a valid enum value.
      await AnalyticsEvent.findOneAndUpdate(
        { _id: freshEvent._id, status: 'processing' },
        {
          $set: { status: 'dead_letter' },
          $push: {
            errors: {
              at:      new Date(),
              message: unexpectedError.message,
            },
          },
        }
      );
      return 'dead_letter';
    }

    // [FIX-23] pending + nextRetryAt for retry scheduling.
    await AnalyticsEvent.findOneAndUpdate(
      { _id: freshEvent._id, status: 'processing' },
      {
        $set: {
          status:      'pending',
          nextRetryAt: new Date(Date.now() + getNextRetryDelay(currentAttempts)),
        },
        $push: {
          errors: {
            at:      new Date(),
            message: unexpectedError.message,
          },
        },
      }
    );
    return 'pending';
  }
};

// ─── QUEUE WORKER ─────────────────────────────────────────────────────────────

/**
 * Main worker — called by cronRegistry.js every 60 seconds.
 *
 * [FIX-5]  Concurrent dispatch via Promise.allSettled.
 * [FIX-6]  Atomic claimOne() prevents duplicate processing.
 * [FIX-10] summary.processed increments only on recorded outcomes.
 *
 * [FIX-25] Claim isolation — Promise.allSettled for claims so a single DB error
 *          on one claimOne() does not abort the entire sweep. Fulfilled nulls
 *          (empty queue) are filtered; rejected claims are counted as errors.
 *
 * @returns {Promise<{ processed: number, succeeded: number, pending: number, deadLettered: number, errors: number, claimErrors: number }>}
 */
export const processAnalyticsQueue = async () => {
  const summary = {
    processed:   0,
    succeeded:   0,
    pending:     0,     // events rescheduled for retry (was 'retrying')
    deadLettered: 0,
    errors:      0,     // unexpected processOne rejections
    claimErrors: 0,     // claimOne() DB errors [FIX-25]
  };

  // [FIX-25] allSettled isolates individual claimOne failures.
  const claimResults = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () => AnalyticsEvent.claimOne())
  );

  const claimed = [];
  for (const result of claimResults) {
    if (result.status === 'rejected') {
      console.error('[AnalyticsQueue] claimOne() failed:', result.reason);
      summary.claimErrors++;
    } else if (result.value) {
      claimed.push(result.value);
    }
    // null result = queue empty for this slot — normal, not an error
  }

  if (claimed.length === 0) return summary;

  console.debug(`[AnalyticsQueue] Claimed ${claimed.length} event(s) for processing`);

  const results = await Promise.allSettled(claimed.map(processOne));

  for (const result of results) {
    if (result.status === 'rejected') {
      // processOne has its own try/catch — rejection here is truly unexpected.
      console.error('[AnalyticsQueue] processOne rejected unexpectedly:', result.reason);
      summary.errors++;
      continue;
    }
    // [FIX-10] Increment only on a recorded outcome.
    summary.processed++;
    switch (result.value) {
      case 'succeeded':   summary.succeeded++;    break;
      case 'pending':     summary.pending++;       break;
      case 'dead_letter': summary.deadLettered++;  break;
    }
  }

  console.debug('[AnalyticsQueue] Sweep complete:', summary);
  return summary;
};

// ─── QUEUE MANAGEMENT UTILITIES ───────────────────────────────────────────────

/**
 * retryDeadLetterEvents
 *
 * Resets dead_letter events back to pending for manual retry.
 * Call after fixing a configuration issue (wrong API key, expired token, etc.).
 *
 * [FIX-26] Clears both dispatchId AND dispatchStartedAt so the stale-lock
 *          sweeper does not immediately re-sweep revived events due to a stale
 *          dispatchStartedAt from the prior failed attempt chain.
 *
 * attempts is reset to 0 so the event gets its full retry budget again.
 *
 * @param {string|null} eventType - Filter by type, or null for all
 * @returns {Promise<number>}
 */
export const retryDeadLetterEvents = async (eventType = null) => {
  const filter = { status: 'dead_letter' };
  if (eventType) filter.eventType = eventType;

  const result = await AnalyticsEvent.updateMany(filter, {
    $set: {
      status:            'pending',
      attempts:          0,
      nextRetryAt:       new Date(),
      dispatchId:        null,
      dispatchStartedAt: null,   // [FIX-26] prevent immediate re-sweep
    },
  });

  console.info(`[AnalyticsQueue] Reset ${result.modifiedCount} dead-letter event(s) to pending`);
  return result.modifiedCount;
};

/**
 * purgeCompletedEvents
 *
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
 * Secondary recovery for events that passed the dispatchId stamp step but
 * stalled during the external dispatch phase (process crash, OOM, network
 * partition after stamp but before final DB write).
 *
 * The model's recoverStuck() static handles events that never reached the
 * stamp step (processingTimeoutAt guard). Both should run as separate crons.
 *
 * [FIX-21] PER-DOCUMENT ATOMIC RESET WITH DISPATCHID PIN:
 *   Each stale event is reset via findOneAndUpdate with BOTH _id AND dispatchId
 *   in the filter. If the original worker finishes first and writes
 *   dispatchStartedAt:null (clearing the lock), the sweeper's filter no longer
 *   matches and the update is a safe no-op.
 *
 *   dispatchId is preserved on reset (not cleared) so the next processOne()
 *   call reuses it and GA4/Meta dedup holds across the sweep-and-retry. [FIX-12]
 *
 * [FIX-21] NULL DISPATCHID GUARD:
 *   Events with dispatchId:null have not been stamped yet (stamp write may still
 *   be in flight, or the event was just claimed). These are NOT stale in the
 *   meaningful dispatch sense — only the model's recoverStuck() should handle
 *   them via processingTimeoutAt. Null-dispatchId candidates are skipped.
 *
 * [FIX-21] REJECTION LOGGING:
 *   Previously, per-document reset rejections were silently counted as 0.
 *   Now each rejection is logged individually for observability.
 *
 * [FIX-23] Reset to status:'pending' + nextRetryAt so claimOne() picks them
 *          up normally. 'retrying' is not a valid model enum value.
 *
 * Recommended TTL: 5× p99 dispatch latency (e.g. 60 000 ms).
 * Register as a separate cron job.
 *
 * @param {number} staleTtlMs - ms before a dispatch lock is considered stale
 * @returns {Promise<number>} Number of events reset
 */
export const staleLockSweeper = async (staleTtlMs = 60_000) => {
  const staleThreshold = new Date(Date.now() - staleTtlMs);

  // Read-only pass — find stale candidates.
  const staleEvents = await AnalyticsEvent.find(
    {
      status:            'processing',
      dispatchStartedAt: { $lt: staleThreshold },
      dispatchId:        { $ne: null },   // [FIX-21] skip unstamped events
    },
    { _id: 1, dispatchId: 1, eventId: 1 }
  ).lean();

  if (staleEvents.length === 0) return 0;

  let resetCount   = 0;
  let failureCount = 0;

  const resetPromises = staleEvents.map(({ _id, dispatchId, eventId }) =>
    AnalyticsEvent.findOneAndUpdate(
      {
        _id,
        dispatchId,           // [FIX-21] pin to exact dispatch attempt
        status: 'processing', // guard: only reset if still processing
      },
      {
        $set: {
          status:            'pending',     // [FIX-23] valid enum; claimOne re-picks up
          nextRetryAt:       new Date(),    // eligible for immediate re-claim
          dispatchStartedAt: null,
          // dispatchId intentionally preserved — next processOne reuses it [FIX-12]
        },
        $push: {
          errors: {            // [FIX-16] schema-defined errors[] array
            at:      new Date(),
            message: `Reset by stale-lock sweeper after ${staleTtlMs}ms (dispatchId: ${dispatchId})`,
          },
        },
      },
      { new: false }
    ).then(result => {
      if (result) {
        console.warn(
          `[AnalyticsQueue] Stale-lock sweeper reset event: ${eventId} (dispatchId: ${dispatchId})`
        );
        return 1;
      }
      return 0; // Worker finished normally first — expected, not an error
    }).catch(err => {
      // [FIX-21] Log individual rejections explicitly (was silently swallowed).
      console.error(
        `[AnalyticsQueue] Stale-lock sweeper failed for event ${eventId}:`,
        err.message
      );
      failureCount++;
      return 0;
    })
  );

  const counts = await Promise.all(resetPromises);
  resetCount = counts.reduce((sum, n) => sum + n, 0);

  if (resetCount > 0 || failureCount > 0) {
    console.warn(
      `[AnalyticsQueue] Stale-lock sweeper: reset=${resetCount}, ` +
      `no-op=${staleEvents.length - resetCount - failureCount}, failures=${failureCount}`
    );
  }

  return resetCount;
};

// ─── BIGQUERY BACKFILL ────────────────────────────────────────────────────────

/**
 * getPendingBigqueryEvents
 *
 * [FIX-14] Surfaces completed events where BigQuery was skipped in best-effort mode.
 * Data-pipeline teams call this to find events needing BQ backfill, then pass
 * each event.payload directly to streamEventToBigQuery(payload).
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