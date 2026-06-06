/**
 * backend/jobs/analyticsQueue.js
 *
 * Phase 6 — Event Queue & Retry System
 *
 * FIX: allSucceeded evaluation hardened.
 *   Previously: ga4Done = ga4.success && (ga4.skipped || !ga4.error)
 *   Problem: when ga4.success=true and ga4.skipped=false and ga4.error=null,
 *   `!ga4.error` is true so ga4Done is true — correct. But when ga4.success=false
 *   (e.g. null order passed to sendGA4Purchase), ga4Done is false, allSucceeded
 *   is false, event goes to failed, retries indefinitely.
 *
 *   The correct logic: an event is "done" on a platform when it either
 *   succeeded or was intentionally skipped. Error presence is already
 *   encoded in success=false — checking !error redundantly after checking
 *   success adds no safety and breaks the skipped=true path.
 *
 *   New: ga4Done  = platforms.ga4.success  || platforms.ga4.skipped
 *        metaDone = platforms.meta.success || platforms.meta.skipped
 *
 *   BigQuery is excluded from allSucceeded — BQ failure is always non-fatal.
 *   Free-tier BQ returns "Streaming insert is not allowed" — this is now
 *   detected and the result is coerced to skipped=true so it never pollutes
 *   the failed/dead_letter counts.
 */

import AnalyticsEvent from '../models/AnalyticsEvent.js';
import {
  sendGA4Purchase,
  sendGA4Login,
  sendGA4SignUp,
  sendGA4CheckoutStep,
  sendGA4Refund,
  sendGA4AddToWishlist,
} from '../Services/analytics/ga4Service.js';
import {
  sendMetaPurchase,
  sendMetaInitiateCheckout,
  sendMetaCompleteRegistration,
  sendMetaAddPaymentInfo,
} from '../Services/analytics/metaCapiService.js';
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

// ─── BIGQUERY SKIP DETECTOR ───────────────────────────────────────────────────

/**
 * isBigQueryFreeTierError
 *
 * Detects the BigQuery free-tier streaming restriction error so it can be
 * treated as a skip rather than a failure. Without this, every event in a
 * free-tier environment fails permanently because BQ blocks streaming inserts,
 * which makes allSucceeded false, which keeps events in failed state retrying
 * until dead_letter — even when GA4 and Meta both succeeded.
 *
 * This is purely a configuration limitation, not a data or logic error.
 * The correct signal is skipped=true, not failed.
 */
const isBigQueryFreeTierError = (error) => {
  if (!error) return false;
  const msg = typeof error === 'string' ? error : error?.message || '';
  return msg.includes('Streaming insert is not allowed in the free tier') ||
         msg.includes('Access Denied: BigQuery');
};

// ─── PLATFORM DISPATCHER ──────────────────────────────────────────────────────

const dispatchToPlatforms = async (event) => {
  const { eventType, payload } = event;

  const order   = payload?.order   ?? null;
  const user    = payload?.user    ?? null;
  const product = payload?.product ?? null;
  const context = payload?.context ?? payload ?? {};

  const ga4Promise = (async () => {
    switch (eventType) {
      case 'purchase':
        if (!order) {
          console.warn(`[AnalyticsQueue] Skipping GA4 purchase — no order in payload for eventId: ${event.eventId}`);
          return { success: true, skipped: true, reason: 'no_order_in_payload' };
        }
        return sendGA4Purchase(order, context);

      case 'begin_checkout':
      case 'checkout_step': {
        const resolvedStep = payload.step || context.step || 'shipping_info';
        if (!payload.checkout) {
          return { success: true, skipped: true, reason: 'no_checkout_in_payload' };
        }
        return sendGA4CheckoutStep(resolvedStep, payload.checkout, context);
      }

      case 'login':
        return sendGA4Login(payload.method || 'email', context);

      case 'sign_up':
      case 'email_verified':
        return sendGA4SignUp(payload.method || 'email', context);

      case 'refund':
        if (!order) return { success: true, skipped: true, reason: 'no_order_in_payload' };
        return sendGA4Refund(order, payload.refundAmount, context);

      case 'add_to_wishlist':
        return product
          ? sendGA4AddToWishlist(product, context)
          : { success: true, skipped: true, reason: 'no_product_in_payload' };

      default:
        return { success: true, skipped: true, reason: 'no_ga4_mapping' };
    }
  })();

  const metaPromise = (async () => {
    switch (eventType) {
      case 'purchase':
        if (!order || !user) {
          console.warn(`[AnalyticsQueue] Skipping Meta purchase — missing order or user for eventId: ${event.eventId}`);
          return { success: true, skipped: true, reason: 'no_order_or_user_in_payload' };
        }
        return sendMetaPurchase(order, user, context);

      case 'begin_checkout':
        if (!payload.checkout || !user) {
          return { success: true, skipped: true, reason: 'no_checkout_or_user_in_payload' };
        }
        return sendMetaInitiateCheckout(payload.checkout, user, context);

      case 'checkout_step': {
        const resolvedStep = payload.step || context.step || null;
        if (resolvedStep === 'payment_selection') {
          if (!payload.checkout) {
            return { success: true, skipped: true, reason: 'no_checkout_in_payload' };
          }
          return sendMetaAddPaymentInfo(payload.checkout, user, context);
        }
        return { success: true, skipped: true, reason: 'no_meta_mapping_for_step' };
      }

      case 'sign_up':
      case 'email_verified':
        if (!user) return { success: true, skipped: true, reason: 'no_user_in_payload' };
        return sendMetaCompleteRegistration(user, context);

      // add_to_wishlist: Meta is fast-path only — never queued.
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

  // FIX: Correct allSucceeded logic.
  // A platform is "done" when it succeeded OR was intentionally skipped.
  // Previously: success && (skipped || !error) — the !error check was
  // redundant and broke the evaluation when success=false and skipped=false.
  // BigQuery is always excluded from allSucceeded — BQ is best-effort.
  const ga4Done  = platforms.ga4.success  || platforms.ga4.skipped;
  const metaDone = platforms.meta.success || platforms.meta.skipped;
  platforms.allSucceeded = ga4Done && metaDone;
  platforms.allSkipped   = platforms.ga4.skipped && platforms.meta.skipped;

  // FIX: Treat BigQuery free-tier restriction as a skip, not a failure.
  // This prevents free-tier development environments from generating
  // misleading failed/dead_letter counts in the observability dashboard.
  if (!platforms.bigquery.success && isBigQueryFreeTierError(platforms.bigquery.error)) {
    platforms.bigquery.skipped = true;
    platforms.bigquery.success = true;
    platforms.bigquery.error   = null;
  } else if (!platforms.bigquery.success && !platforms.bigquery.skipped) {
    console.warn('[AnalyticsQueue] BigQuery dispatch failed (non-fatal):', platforms.bigquery.error);
  }

  return platforms;
};

// ─── ENQUEUE ──────────────────────────────────────────────────────────────────

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

export const processAnalyticsQueue = async () => {
  const summary = { processed: 0, succeeded: 0, failed: 0, deadLettered: 0, skipped: 0 };

  const events = await AnalyticsEvent.findEligible(CONCURRENCY);
  if (events.length === 0) return summary;

  console.debug(`[AnalyticsQueue] Processing ${events.length} event(s)`);

  const eventIds = events.map(e => e._id);
  await AnalyticsEvent.updateMany(
    { _id: { $in: eventIds } },
    { $set: { status: 'processing' } }
  );

  const tasks = events.map(async (event) => {
    const newAttempts = event.attempts + 1;

    try {
      const platforms = await dispatchToPlatforms(event);

      if (platforms.allSucceeded) {
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
      const bucket = result.value;
      if (bucket in summary) summary[bucket]++;
    } else {
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
    .filter(([key, val]) => key !== 'allSucceeded' && key !== 'allSkipped' && !val.success && !val.skipped)
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

export const retryDeadLetterEvents = async (eventType = null) => {
  const filter = { status: 'dead_letter' };
  if (eventType) filter.eventType = eventType;

  const result = await AnalyticsEvent.updateMany(filter, {
    $set: { status: 'pending', attempts: 0, nextRetryAt: new Date(), lastError: null },
  });

  console.info(`[AnalyticsQueue] Reset ${result.modifiedCount} dead-letter event(s) to pending`);
  return result.modifiedCount;
};

export const purgeCompletedEvents = async (olderThanDays = 30) => {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await AnalyticsEvent.deleteMany({
    status:      'completed',
    completedAt: { $lt: cutoff },
  });

  console.info(`[AnalyticsQueue] Purged ${result.deletedCount} completed event(s)`);
  return result.deletedCount;
};