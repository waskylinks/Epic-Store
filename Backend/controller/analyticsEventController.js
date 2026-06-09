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
 * ATTRIBUTION NOTE:
 *   This route is listed in BYPASS_PATHS in attributionMiddleware.js, so
 *   req.attribution is the null-fallback object (source: 'direct',
 *   landingPage: req.originalUrl). It is NOT meaningful here — the POST
 *   request itself carries no UTM query params and req.originalUrl is
 *   "/api/v1/analytics/event". clientAttribution, captured at page-load
 *   time by the browser SDK, is the correct attribution source.
 *
 * @route POST /api/v1/analytics/event
 * @access Private (any authenticated user)
 */
export const ingestAnalyticsEvent = handleAsyncError(async (req, res, next) => {
  const {
    eventType,
    analyticsEventId,
    clientTimestamp,
    properties        = {},
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
    attribution: clientAttribution,
  });

  // ── Resolve attribution ───────────────────────────────────────────────────
  // clientAttribution was captured at page-load time by the browser SDK and
  // carries the real first-touch signals (UTMs, landing page, click IDs).
  //
  // req.attribution on this endpoint is computed from the POST request itself:
  //   - No UTM query params (they're in the POST body, not the URL)
  //   - req.originalUrl = "/api/v1/analytics/event"
  //   - referrer = the SPA page the user was on, not the original landing page
  //
  // Because this route is in BYPASS_PATHS, req.attribution is the null-fallback
  // object and must not be used as the attribution source here.
  //
  // Device/browser: prefer client-reported values (accurate for SPA navigation);
  // fall back to server UA detection for the rare case clientAttribution is empty.
  //
  // Confidence fields are server-computed signals that are only meaningful on
  // requests that carry real UTM/click-ID cookies (payment, order endpoints).
  // They are intentionally null here — the queue worker and BigQuery readers
  // treat null confidence as an unscored client event.
  const resolvedAttribution = {
    source:             clientAttribution?.utm_source   || 'direct',
    medium:             clientAttribution?.utm_medium   || null,
    campaign:           clientAttribution?.utm_campaign || null,
    referrer:           clientAttribution?.referrer     || null,
    landing_page:       clientAttribution?.landing_page || null,
    gclid:              clientAttribution?.gclid        || null,
    fbclid:             clientAttribution?.fbclid       || null,
    ttclid:             clientAttribution?.ttclid       || null,
    msclkid:            clientAttribution?.msclkid      || null,
    device:             clientAttribution?.device       || req.attribution?.device  || 'desktop',
    browser:            clientAttribution?.browser      || req.attribution?.browser || 'unknown',
    confidenceScore:    null,
    confidenceLevel:    'LOW',
    isReconstructed:    false,
    reconstructionRule: null,
  };

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

    // Top-level attribution is read by transformToEventRow() and
    // transformToAttributionSnapshotRow() in bigQueryService.js.
    attribution: resolvedAttribution,

    context: {
      fbp:            fbp || null,
      fbc:            resolvedFbc,
      ga4ClientId:    ga4ClientId || null,
      clientIp:       req.ip,
      userAgent:      req.headers['user-agent'] || null,
      eventSourceUrl: req.headers.referer || process.env.FRONTEND_URL || null,
      attribution:    resolvedAttribution,
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