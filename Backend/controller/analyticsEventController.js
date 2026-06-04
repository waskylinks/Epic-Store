import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { enqueueAnalyticsEvent } from '../jobs/analyticsQueue.js';
import { isValidUUID } from '../utils/analyticsEvent.js';
import { resolveFbc } from '../Services/analytics/metaCapiService.js';

// ─── ALLOWED EVENT TYPES ──────────────────────────────────────────────────────
// Must match the eventType enum in AnalyticsEvent.js. page_view and
// product_view are client-only events not in the queue schema — they are
// accepted here but routed to a no-op path so the frontend never gets a 400.

const QUEUEABLE_EVENT_TYPES = new Set([
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
]);

// Client-only events that are acknowledged but not enqueued.
// Keeping them out of the queue prevents validation errors from
// eventType enum mismatches for events that have no server-side
// platform dispatch path (GA4 Measurement Protocol not needed for page views).
const CLIENT_ONLY_EVENT_TYPES = new Set([
  'page_view',
  'product_view',
]);

// ─── INGEST CONTROLLER ────────────────────────────────────────────────────────

/**
 * ingestAnalyticsEvent
 *
 * Receives client-side analytics events from eventBridge.js sendEvent()
 * and enqueues them for dispatch to GA4, Meta CAPI, and BigQuery.
 *
 * Auth: verifyUserAuth only — any authenticated user can POST here.
 * No roleBaseAccess guard — this endpoint is called during normal
 * shopping flows (add_to_cart, checkout_step, purchase, etc.).
 *
 * @route POST /api/v1/analytics/event
 * @access Private (any authenticated user)
 */
export const ingestAnalyticsEvent = handleAsyncError(async (req, res, next) => {
  const {
    eventType,
    analyticsEventId,
    clientTimestamp,
    properties      = {},
    clientAttribution = {},
    ga4ClientId,
    fbp,
    fbc,
    fbclid,
  } = req.body;

  // ── Validate eventType ───────────────────────────────────────────────────
  if (!eventType || typeof eventType !== 'string') {
    return next(new HandleError('eventType is required', 400));
  }

  // Client-only events — acknowledge without enqueueing
  if (CLIENT_ONLY_EVENT_TYPES.has(eventType)) {
    return res.status(202).json({ success: true, queued: false, reason: 'client_only' });
  }

  if (!QUEUEABLE_EVENT_TYPES.has(eventType)) {
    return next(new HandleError(`Unknown eventType: ${eventType}`, 400));
  }

  // ── Resolve event ID ─────────────────────────────────────────────────────
  // Trust the client UUID when valid — it ties this queue entry to the
  // browser pixel and server CAPI event for deduplication.
  const resolvedEventId = isValidUUID(analyticsEventId)
    ? analyticsEventId
    : `server-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // ── Resolve fbc ──────────────────────────────────────────────────────────
  const resolvedFbc = resolveFbc({
    fbc,
    fbclid: fbclid || clientAttribution?.fbclid || null,
    attribution: req.attribution || clientAttribution,
  });

  // ── Build queue payload ──────────────────────────────────────────────────
  const payload = {
    event_id:   resolvedEventId,
    event_type: eventType,

    event_source:         'client',
    event_time_client:    clientTimestamp || new Date().toISOString(),
    event_time_server:    new Date().toISOString(),
    event_time_processed: null,

    user_id:      req.user?._id?.toString() || null,
    anonymous_id: req.anonymousId || null,
    session_id:   req.sessionId   || null,

    properties,

    context: {
      fbp:            fbp  || null,
      fbc:            resolvedFbc,
      ga4ClientId:    ga4ClientId || null,
      clientIp:       req.ip,
      userAgent:      req.headers['user-agent'] || null,
      eventSourceUrl: req.headers.referer || process.env.FRONTEND_URL || null,
      attribution:    req.attribution || clientAttribution,
    },

    schema_version: '1.0',
  };

  try {
    await enqueueAnalyticsEvent(eventType, payload);
  } catch (err) {
    // Non-fatal — log and acknowledge. Never block the user's flow
    // because an analytics queue write failed.
    console.error('[ingestAnalyticsEvent] Enqueue failed (non-fatal):', err.message);
    return res.status(202).json({ success: true, queued: false, reason: 'enqueue_error' });
  }

  res.status(202).json({ success: true, queued: true, eventId: resolvedEventId });
});