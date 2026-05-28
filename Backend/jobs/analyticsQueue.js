/**
 * backend/jobs/analyticsQueue.js
 *
 * Phase 6 — Event Queue & Retry System
 *
 * Dispatches analytics events to GA4, Meta CAPI, and BigQuery.
 * Runs every 60 seconds via cronRegistry.js.
 *
 * Architecture:
 *   1. enqueueAnalyticsEvent() — persists event to MongoDB with status: 'pending'.
 *      Idempotent: checks for existing eventId before inserting.
 *   2. processAnalyticsQueue() — picks up eligible events and dispatches in parallel
 *      via Promise.allSettled. Records per-platform results and schedules retries.
 *   3. Exponential backoff: attempt 1 → 2s, attempt 2 → 4s, attempt 3 → dead_letter.
 *   4. BigQuery is best-effort — its failure does not trigger GA4/Meta retries.
 *      Set platforms.allSucceeded on GA4 + Meta only.
 */

import AnalyticsEvent           from '../models/AnalyticsEvent.js';
import { sendGA4Purchase, sendGA4Login, sendGA4SignUp, sendGA4CheckoutStep, sendGA4Refund } from '../Services/analytics/ga4Service.js';
import { sendMetaPurchase, sendMetaInitiateCheckout, sendMetaCompleteRegistration }        from '../Services/analytics/metaCapiService.js';
import { streamEventToBigQuery }  from '../Services/analytics/bigQueryService.js';
import { sendCronAlert }         from '../utils/cronAlert.js';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const MAX_RETRIES  = parseInt(process.env.ANALYTICS_QUEUE_RETRY_MAX)    || 3;
const BASE_BACKOFF = parseInt(process.env.ANALYTICS_QUEUE_BACKOFF_BASE) || 1000;
const CONCURRENCY  = parseInt(process.env.ANALYTICS_QUEUE_CONCURRENCY)  || 5;

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

export const getNextRetryDelay = (attempts) =>
  BASE_BACKOFF * Math.pow(2, attempts + 1);

// ─── PLATFORM DISPATCHER ──────────────────────────────────────────────────────

const dispatchToPlatforms = async (event) => {
  const { eventType, payload } = event;
 
  // Payload shape from buildPurchaseEvent stores data under named keys.
  // Destructure defensively — callers that omit these keys get undefined
  // rather than a throw, which is handled by the null guards in each service.
  const order   = payload?.order   ?? null;
  const user    = payload?.user    ?? null;
  const context = payload?.context ?? payload ?? {};
 
  const ga4Promise = (async () => {
    switch (eventType) {
      case 'purchase':
        return sendGA4Purchase(order, context);
      case 'begin_checkout':
      case 'checkout_step':
        return sendGA4CheckoutStep(payload.step, payload.checkout, context);
      case 'login':
        return sendGA4Login(payload.method || 'email', context);
      case 'sign_up':
      case 'email_verified':
        return sendGA4SignUp(payload.method || 'email', context);
      case 'refund':
        return sendGA4Refund(order, payload.refundAmount, context);
      default:
        return { success: true, skipped: true, reason: 'no_ga4_mapping' };
    }
  })();
 
  const metaPromise = (async () => {
    switch (eventType) {
      case 'purchase':
        return sendMetaPurchase(order, user, context);
      case 'begin_checkout':
        return sendMetaInitiateCheckout(payload.checkout, user, context);
      case 'sign_up':
      case 'email_verified':
        return sendMetaCompleteRegistration(user, context);
      default:
        return { success: true, skipped: true, reason: 'no_meta_mapping' };
    }
  })();
 
  const bqPromise = streamEventToBigQuery(payload);
 
  const [ga4Result, metaResult, bqResult] = await Promise.allSettled([
    ga4Promise,
    metaPromise,
    bqPromise,
  ]);
 
  const normalize = (settled) => {
    if (settled.status === 'fulfilled') {
      return {
        success: settled.value?.success !== false,
        skipped: settled.value?.skipped === true,
        error:   null,
        sentAt:  new Date(),
      };
    }
    return {
      success: false,
      skipped: false,
      error:   settled.reason?.message || String(settled.reason),
      sentAt:  null,
    };
  };
 
  const platforms = {
    ga4:      normalize(ga4Result),
    meta:     normalize(metaResult),
    bigquery: normalize(bqResult),
  };
 
  // An event is considered fully succeeded only when GA4 and Meta both either
  // dispatched successfully or were intentionally skipped (no mapping for this
  // event type). A skipped platform is not a failure — it means this event type
  // has no handler on that platform. Previously, skipped events were silently
  // counted as successes via success: true, which was correct, but the skipped
  // flag was not propagated into the normalized result, making it invisible in
  // queue health metrics.
  const ga4Done  = platforms.ga4.success  && (platforms.ga4.skipped  || !platforms.ga4.error);
  const metaDone = platforms.meta.success && (platforms.meta.skipped || !platforms.meta.error);
  platforms.allSucceeded = ga4Done && metaDone;
 
  // Track whether the event was entirely skipped on both primary platforms
  // so queue health can distinguish zero-dispatch completions from real sends.
  platforms.allSkipped = platforms.ga4.skipped && platforms.meta.skipped;
 
  if (!platforms.bigquery.success && !platforms.bigquery.skipped) {
    console.warn('[AnalyticsQueue] BigQuery dispatch failed (non-fatal):', platforms.bigquery.error);
  }
 
  return platforms;
};

// ─── ENQUEUE ──────────────────────────────────────────────────────────────────

/**
 * Persists an analytics event to the queue.
 * Idempotent: returns the existing document if eventId already exists.
 *
 * @param {string} eventType
 * @param {Object} payload - Full analytics payload including order, user, context
 * @returns {Promise<AnalyticsEvent>}
 */
export const enqueueAnalyticsEvent = async (eventType, payload) => {
  const eventId = payload.event_id || payload.eventId;

  if (!eventId) {
    throw new Error('[AnalyticsQueue] eventId is required — payload must include event_id');
  }

  const existing = await AnalyticsEvent.findOne({ eventId });
  if (existing) {
    console.debug(`[AnalyticsQueue] Event already enqueued: ${eventId} (status: ${existing.status})`);
    return existing;
  }

  return AnalyticsEvent.create({
    eventId,
    eventType,
    payload,
    status:      'pending',
    attempts:    0,
    maxAttempts: MAX_RETRIES,
    nextRetryAt: new Date(),
    priority:    EVENT_PRIORITY[eventType] ?? 5,
  });
};

// ─── QUEUE WORKER ─────────────────────────────────────────────────────────────
 
/**
 * Main worker — called by cronRegistry.js every 60 seconds.
 * Returns a summary: { processed, succeeded, failed, deadLettered, skipped }
 *
 * Events are processed concurrently up to CONCURRENCY limit via
 * Promise.allSettled — previously the for loop was serial despite the
 * CONCURRENCY constant implying parallel execution.
 *
 * Each event now does a single DB write after dispatch rather than two
 * (set-to-processing + update-with-result), reducing round-trips per event.
 */

export const processAnalyticsQueue = async () => {
  const summary = { processed: 0, succeeded: 0, failed: 0, deadLettered: 0, skipped: 0 };
 
  const events = await AnalyticsEvent.findEligible(CONCURRENCY);
  if (events.length === 0) return summary;
 
  console.debug(`[AnalyticsQueue] Processing ${events.length} event(s)`);
 
  // Mark all fetched events as 'processing' in a single batched write
  // before dispatching — prevents a second cron sweep from picking up
  // the same events while this sweep is in flight.
  const eventIds = events.map(e => e._id);
  await AnalyticsEvent.updateMany(
    { _id: { $in: eventIds } },
    { $set: { status: 'processing' } }
  );
 
  // Process events concurrently rather than serially. Each task resolves to
  // a summary increment so we can tally results after allSettled.
  const tasks = events.map(async (event) => {
    const newAttempts = event.attempts + 1;
 
    try {
      const platforms = await dispatchToPlatforms(event);
 
      if (platforms.allSucceeded) {
        // Single write — replaces the two-write pattern (set processing, then result).
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:      'completed',
            attempts:    newAttempts,
            platforms,
            completedAt: new Date(),
            lastError:   null,
          },
        });
 
        return platforms.allSkipped ? 'skipped' : 'succeeded';
 
      } else if (newAttempts >= MAX_RETRIES) {
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:    'dead_letter',
            attempts:  newAttempts,
            platforms,
            lastError: JSON.stringify({
              ga4:      platforms.ga4.error,
              meta:     platforms.meta.error,
              bigquery: platforms.bigquery.error,
            }),
          },
        });
 
        // Pass newAttempts explicitly so the alert reflects the correct final
        // attempt count, not event.attempts which is the pre-update value.
        await sendDeadLetterAlert(event, platforms, newAttempts).catch(err =>
          console.error('[AnalyticsQueue] Dead-letter Slack alert failed:', err.message)
        );
 
        return 'deadLettered';
 
      } else {
        const delay = getNextRetryDelay(event.attempts);
 
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:      'failed',
            attempts:    newAttempts,
            platforms,
            nextRetryAt: new Date(Date.now() + delay),
            lastError: JSON.stringify({
              ga4:      platforms.ga4.error,
              meta:     platforms.meta.error,
              bigquery: platforms.bigquery.error,
            }),
          },
        });
 
        return 'failed';
      }
 
    } catch (unexpectedError) {
      console.error('[AnalyticsQueue] Unexpected error processing event:', {
        eventId:   event.eventId,
        eventType: event.eventType,
        error:     unexpectedError.message,
      });
 
      if (newAttempts >= MAX_RETRIES) {
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:    'dead_letter',
            attempts:  newAttempts,
            lastError: unexpectedError.message,
          },
        });
        return 'deadLettered';
      } else {
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:      'failed',
            attempts:    newAttempts,
            nextRetryAt: new Date(Date.now() + getNextRetryDelay(event.attempts)),
            lastError:   unexpectedError.message,
          },
        });
        return 'failed';
      }
    }
  });
 
  const results = await Promise.allSettled(tasks);
 
  for (const result of results) {
    summary.processed++;
    if (result.status === 'fulfilled') {
      const bucket = result.value; // 'succeeded' | 'skipped' | 'failed' | 'deadLettered'
      if (bucket in summary) summary[bucket]++;
    } else {
      // The task itself threw — shouldn't happen since each task catches
      // internally, but guard against it to avoid an under-counted summary.
      summary.failed++;
      console.error('[AnalyticsQueue] Task promise rejected unexpectedly:', result.reason);
    }
  }
 
  console.debug('[AnalyticsQueue] Sweep complete:', summary);
  return summary;
};
 

// ─── DEAD-LETTER ALERT ────────────────────────────────────────────────────────

const sendDeadLetterAlert = async (event, platforms) => {
  const failedPlatforms = Object.entries(platforms)
    .filter(([key, val]) => key !== 'allSucceeded' && !val.success)
    .map(([key, val]) => `${key}: ${val.error}`)
    .join('\n');

  await sendCronAlert({
    jobName: 'AnalyticsQueue',
    status:  'dead_letter',
    message: `Analytics event moved to dead_letter after ${MAX_RETRIES} attempts`,
    details: {
      eventId:   event.eventId,
      eventType: event.eventType,
      attempts:  event.attempts + 1,
      failures:  failedPlatforms,
    },
  });
};

// ─── QUEUE MANAGEMENT UTILITIES ───────────────────────────────────────────────

/**
 * Resets dead_letter events back to pending for manual retry.
 * Call after fixing a configuration issue (wrong API key, expired token, etc.)
 *
 * @param {string|null} eventType - Filter by type, or null for all
 * @returns {Promise<number>}
 */
export const retryDeadLetterEvents = async (eventType = null) => {
  const filter = { status: 'dead_letter' };
  if (eventType) filter.eventType = eventType;

  const result = await AnalyticsEvent.updateMany(filter, {
    $set: { status: 'pending', attempts: 0, nextRetryAt: new Date(), lastError: null },
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