/**
 * backend/jobs/analyticsQueue.js
 *
 * Phase 6 — Event Queue & Retry System
 *
 * This is the queue worker that dispatches analytics events to GA4,
 * Meta CAPI, and BigQuery. It runs on a cron schedule (every 60 seconds)
 * via your existing cronRegistry.js infrastructure.
 *
 * Architecture:
 *
 *   1. enqueueAnalyticsEvent() — called by controllers (Phase 12).
 *      Persists the event to MongoDB with status: 'pending'.
 *      Idempotent: checks for existing eventId before inserting.
 *
 *   2. processAnalyticsQueue() — called by the cron worker every 60s.
 *      Picks up eligible events (pending + failed whose backoff has elapsed).
 *      Dispatches to GA4, Meta, BigQuery in parallel via Promise.allSettled.
 *      Records per-platform results and schedules retries on partial failure.
 *
 *   3. Exponential backoff:
 *      Attempt 1 fails → retry after BASE_BACKOFF × 2^1 ms  (default 2s)
 *      Attempt 2 fails → retry after BASE_BACKOFF × 2^2 ms  (default 4s)
 *      Attempt 3 fails → moves to dead_letter
 *
 *   4. Promise.allSettled — GA4 failure does NOT prevent Meta or BigQuery
 *      from receiving the event. Each platform result is tracked independently.
 *      Only if ALL platforms succeed does the event move to 'completed'.
 *      If any platform fails after max retries, the event moves to 'dead_letter'
 *      so it can be investigated without blocking the queue.
 *
 *   5. Dead-letter Cron alert — when events reach dead_letter status,
 *      a Cron alert fires via your existing cronAlert infrastructure.
 *      This ensures silent failures are never missed.
 *
 * Environment variables:
 *   ANALYTICS_QUEUE_RETRY_MAX    — max retry attempts (default: 3)
 *   ANALYTICS_QUEUE_BACKOFF_BASE — base ms for exponential backoff (default: 1000)
 *   ANALYTICS_QUEUE_CONCURRENCY  — events processed per sweep (default: 5)
 */

import AnalyticsEvent           from '../models/AnalyticsEvent.js';
import { sendGA4Purchase, sendGA4Login, sendGA4SignUp, sendGA4CheckoutStep, sendGA4Refund } from '../Services/analytics/ga4Service.js';
import { sendMetaPurchase, sendMetaInitiateCheckout, sendMetaCompleteRegistration }        from '../Services/analytics/metaCapiService.js';
import { streamEventToBigQuery }  from '../Services/analytics/bigQueryService.js';
import { sendCronAlert }         from '../utils/cronAlert.js';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const MAX_RETRIES    = parseInt(process.env.ANALYTICS_QUEUE_RETRY_MAX)    || 3;
const BASE_BACKOFF   = parseInt(process.env.ANALYTICS_QUEUE_BACKOFF_BASE) || 1000;
const CONCURRENCY    = parseInt(process.env.ANALYTICS_QUEUE_CONCURRENCY)  || 5;

// ─── PRIORITY MAP ─────────────────────────────────────────────────────────────
// Higher priority events are processed first within each sweep.
// purchase events must never wait behind view_item events.

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
 * getNextRetryDelay
 *
 * Returns the milliseconds to wait before the next retry attempt.
 * Exponential backoff prevents hammering a struggling downstream service.
 *
 * Attempt 0 → BASE_BACKOFF × 2^1 = 2s  (first retry)
 * Attempt 1 → BASE_BACKOFF × 2^2 = 4s  (second retry)
 * Attempt 2 → BASE_BACKOFF × 2^3 = 8s  (third retry, then dead_letter)
 *
 * @param {number} attempts - Current attempt count (before this failure)
 * @returns {number} milliseconds
 */
export const getNextRetryDelay = (attempts) =>
  BASE_BACKOFF * Math.pow(2, attempts + 1);

// ─── PLATFORM DISPATCHER ──────────────────────────────────────────────────────

/**
 * dispatchToPlatforms
 *
 * Dispatches a single analytics event to all three platforms in parallel.
 * Uses Promise.allSettled so a failure on one platform never blocks others.
 *
 * Returns a results object with per-platform outcome:
 * {
 *   ga4:      { success: true, sentAt: Date }
 *   meta:     { success: false, error: "..." }
 *   bigquery: { success: true, sentAt: Date }
 *   allSucceeded: false
 * }
 *
 * @param {Object} event - AnalyticsEvent document
 * @returns {Promise<Object>}
 */
const dispatchToPlatforms = async (event) => {
  const { eventType, payload } = event;
  const { order, user, context } = payload;

  // ── GA4 dispatch ─────────────────────────────────────────────────────────
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
        // Non-mapped event types are still streamed to BigQuery but not GA4
        return { success: true, skipped: true, reason: 'no_ga4_mapping' };
    }
  })();

  // ── Meta CAPI dispatch ────────────────────────────────────────────────────
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

  // ── BigQuery dispatch — all events ────────────────────────────────────────
  const bqPromise = streamEventToBigQuery(payload);

  // Run all three in parallel — allSettled never rejects
  const [ga4Result, metaResult, bqResult] = await Promise.allSettled([
    ga4Promise,
    metaPromise,
    bqPromise,
  ]);

  // Normalize results to { success, error, sentAt } shape
  const normalize = (settled) => {
    if (settled.status === 'fulfilled') {
      return {
        success: settled.value?.success !== false,
        error:   null,
        sentAt:  new Date(),
      };
    }
    return {
      success: false,
      error:   settled.reason?.message || String(settled.reason),
      sentAt:  null,
    };
  };

  const platforms = {
    ga4:      normalize(ga4Result),
    meta:     normalize(metaResult),
    bigquery: normalize(bqResult),
  };

  platforms.allSucceeded =
    platforms.ga4.success &&
    platforms.meta.success &&
    platforms.bigquery.success;

  return platforms;
};

// ─── ENQUEUE ──────────────────────────────────────────────────────────────────

/**
 * enqueueAnalyticsEvent
 *
 * Persists an analytics event to the queue.
 * Idempotent: returns the existing document if eventId already exists.
 * This prevents duplicate events when controllers are called multiple times
 * (e.g. webhook retries, idempotent payment verification).
 *
 * Called by verifyPaymentController and other controllers (Phase 12).
 * Never called by the queue worker itself.
 *
 * @param {string} eventType  - One of ANALYTICS_EVENTS constants (Phase 1)
 * @param {Object} payload    - Full analytics payload including order, user, context
 * @returns {Promise<AnalyticsEvent>}
 */
export const enqueueAnalyticsEvent = async (eventType, payload) => {
  const eventId = payload.event_id || payload.eventId;

  if (!eventId) {
    throw new Error('[AnalyticsQueue] eventId is required — payload must include event_id');
  }

  // Idempotency check — return existing if already enqueued
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
    nextRetryAt: new Date(), // Eligible immediately
    priority:    EVENT_PRIORITY[eventType] ?? 5,
  });
};

// ─── QUEUE WORKER ─────────────────────────────────────────────────────────────

/**
 * processAnalyticsQueue
 *
 * The main worker function — called by cronRegistry.js every 60 seconds.
 * Picks up eligible events, dispatches them, and updates their status.
 *
 * Returns a summary object for cron health logging:
 * {
 *   processed: 3,
 *   succeeded: 2,
 *   failed:    0,
 *   deadLettered: 1,
 * }
 *
 * @returns {Promise<Object>} Summary of this sweep
 */
export const processAnalyticsQueue = async () => {
  const summary = { processed: 0, succeeded: 0, failed: 0, deadLettered: 0 };

  // Fetch eligible events (pending + overdue failed), sorted by priority
  const events = await AnalyticsEvent.findEligible(CONCURRENCY);

  if (events.length === 0) {
    return summary;
  }

  console.debug(`[AnalyticsQueue] Processing ${events.length} event(s)`);

  // Process events sequentially within a sweep to avoid overwhelming platforms
  // For higher throughput, change to Promise.all(events.map(processOne))
  for (const event of events) {
    summary.processed++;

    // Mark as processing to prevent concurrent workers picking up the same event
    await AnalyticsEvent.findByIdAndUpdate(event._id, {
      $set: { status: 'processing' },
    });

    try {
      const platforms    = await dispatchToPlatforms(event);
      const newAttempts  = event.attempts + 1;

      if (platforms.allSucceeded) {
        // ── All platforms succeeded ───────────────────────────────────────────
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:      'completed',
            attempts:    newAttempts,
            platforms,
            completedAt: new Date(),
            lastError:   null,
          },
        });
        summary.succeeded++;

      } else if (newAttempts >= MAX_RETRIES) {
        // ── Max retries reached → dead_letter ────────────────────────────────
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
        summary.deadLettered++;

        // Alert via Slack — dead-letter events need human investigation
        await sendDeadLetterAlert(event, platforms).catch(err =>
          console.error('[AnalyticsQueue] Dead-letter Slack alert failed:', err.message)
        );

      } else {
        // ── Partial failure → schedule retry ─────────────────────────────────
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
        summary.failed++;
      }

    } catch (unexpectedError) {
      // Unexpected error in the dispatch itself (not a platform error)
      const newAttempts = event.attempts + 1;

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
        summary.deadLettered++;
      } else {
        await AnalyticsEvent.findByIdAndUpdate(event._id, {
          $set: {
            status:      'failed',
            attempts:    newAttempts,
            nextRetryAt: new Date(Date.now() + getNextRetryDelay(event.attempts)),
            lastError:   unexpectedError.message,
          },
        });
        summary.failed++;
      }
    }
  }

  console.debug('[AnalyticsQueue] Sweep complete:', summary);
  return summary;
};

// ─── DEAD-LETTER ALERT ────────────────────────────────────────────────────────

/**
 * sendDeadLetterAlert
 *
 * Sends a Cron alert when an event reaches dead_letter status.
 * Uses your existing cronAlert infrastructure.
 *
 * @param {Object} event     - AnalyticsEvent document
 * @param {Object} platforms - Per-platform results from dispatchToPlatforms
 */
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
 * retryDeadLetterEvents
 *
 * Resets dead_letter events back to pending so they can be retried.
 * Call this manually after fixing a configuration issue
 * (e.g. wrong GA4 API secret, expired Meta token).
 *
 * Usage:
 *   import { retryDeadLetterEvents } from '../jobs/analyticsQueue.js';
 *   await retryDeadLetterEvents(); // retry all dead-letter events
 *   await retryDeadLetterEvents('purchase'); // retry only purchase dead-letters
 *
 * @param {string|null} eventType - Filter by event type, or null for all
 * @returns {Promise<number>} Count of events reset
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
    },
  });

  console.info(`[AnalyticsQueue] Reset ${result.modifiedCount} dead-letter event(s) to pending`);
  return result.modifiedCount;
};

/**
 * purgeCompletedEvents
 *
 * Manually purges completed events older than the given number of days.
 * The TTL index handles this automatically in production, but this
 * utility is useful for immediate cleanup in development.
 *
 * @param {number} olderThanDays - Purge completed events older than this
 * @returns {Promise<number>} Count of events deleted
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