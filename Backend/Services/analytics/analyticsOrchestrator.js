/**
 * backend/services/analytics/analyticsOrchestrator.js
 *
 * Phase 9 — Analytics Orchestrator
 *
 * Single entry point for firing analytics events from controllers.
 * Rather than importing from four different services, controllers
 * import one function: fireAnalyticsEvent().
 *
 * This orchestrator:
 *   1. Builds the normalized event (Phase 1)
 *   2. Validates the event schema
 *   3. Enqueues for reliable dispatch (Phase 6)
 *   4. Returns immediately — never blocks the controller
 *
 * For high-value events (purchase, refund), it also fires an
 * immediate non-queued dispatch as a fast path — in case the
 * queue worker hasn't run yet and you need the event in GA4
 * within seconds rather than up to 60 seconds.
 *
 * Fast path vs Queue path:
 *   Fast path  — direct axios call, fires immediately, no retry on failure
 *   Queue path — MongoDB persistence, fires within 60s, retried on failure
 *
 * Both paths are used for purchase events so:
 *   - GA4 DebugView shows the event immediately (fast path)
 *   - The event is guaranteed to arrive even if the fast path fails (queue)
 *   - The event_id prevents double-counting in GA4/Meta (deduplication)
 */

import { buildPurchaseEvent, buildCheckoutStepEvent, buildAnalyticsEvent, validateAnalyticsEvent, ANALYTICS_EVENTS } from '../../utils/analyticsEvent.js';
import { enqueueAnalyticsEvent } from '../../jobs/analyticsQueue.js';
import { sendGA4Purchase, sendGA4CheckoutStep, sendGA4Login, sendGA4SignUp } from './ga4Service.js';
import { sendMetaPurchase, sendMetaInitiateCheckout, sendMetaCompleteRegistration } from './metaCapiService.js';

// ─── FAST PATH DISPATCHER ─────────────────────────────────────────────────────

/**
 * dispatchFastPath
 *
 * Fires an event immediately to GA4 and Meta CAPI without going through
 * the queue. Used for purchase events where sub-60s delivery matters.
 *
 * Failures are logged but never thrown — the queue handles reliability.
 * This is a best-effort immediate dispatch, not a replacement for the queue.
 *
 * @param {string} eventType
 * @param {Object} payload
 */
const dispatchFastPath = async (eventType, payload) => {
  const { order, user, context } = payload;

  const promises = [];

  if (eventType === ANALYTICS_EVENTS.PURCHASE) {
    promises.push(
      sendGA4Purchase(order, context)
        .then(r  => console.debug('[Analytics FastPath] GA4 purchase sent:', r?.eventId))
        .catch(e => console.error('[Analytics FastPath] GA4 purchase failed:', e.message))
    );
    promises.push(
      sendMetaPurchase(order, user, context)
        .then(r  => console.debug('[Analytics FastPath] Meta purchase sent, events_received:', r?.eventsReceived))
        .catch(e => console.error('[Analytics FastPath] Meta purchase failed:', e.message))
    );
  }

  if (eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT) {
    promises.push(
      sendGA4CheckoutStep('shipping_info', payload.checkout, context)
        .catch(e => console.error('[Analytics FastPath] GA4 checkout failed:', e.message))
    );
    promises.push(
      sendMetaInitiateCheckout(payload.checkout, user, context)
        .catch(e => console.error('[Analytics FastPath] Meta InitiateCheckout failed:', e.message))
    );
  }

  if (eventType === ANALYTICS_EVENTS.LOGIN) {
    promises.push(
      sendGA4Login(payload.method || 'email', context)
        .catch(e => console.error('[Analytics FastPath] GA4 login failed:', e.message))
    );
  }

  if (eventType === ANALYTICS_EVENTS.SIGN_UP || eventType === ANALYTICS_EVENTS.EMAIL_VERIFIED) {
    promises.push(
      sendGA4SignUp(payload.method || 'email', context)
        .catch(e => console.error('[Analytics FastPath] GA4 sign_up failed:', e.message))
    );
    promises.push(
      sendMetaCompleteRegistration(user, context)
        .catch(e => console.error('[Analytics FastPath] Meta CompleteRegistration failed:', e.message))
    );
  }

  // Fire all fast-path dispatches in parallel — do not await
  // This returns immediately so controllers are never blocked
  Promise.all(promises).catch(() => {});
};

// ─── MAIN ORCHESTRATOR ────────────────────────────────────────────────────────

/**
 * fireAnalyticsEvent
 *
 * Primary entry point for analytics events from controllers.
 * Handles event building, validation, fast-path dispatch, and queuing.
 *
 * Usage in controllers:
 *
 *   // Purchase event (from verifyPaymentController):
 *   fireAnalyticsEvent('purchase', { order, user, req });
 *
 *   // Checkout initiation (from checkoutController):
 *   fireAnalyticsEvent('begin_checkout', { checkout, user, req });
 *
 *   // Login event (from userController):
 *   fireAnalyticsEvent('login', { method: 'email', user, req });
 *
 * All calls are fire-and-forget — wrap in .catch() in controllers:
 *   fireAnalyticsEvent('purchase', {...}).catch(err =>
 *     console.error('[Analytics] Failed:', err.message)
 *   );
 *
 * @param {string} eventType  - One of ANALYTICS_EVENTS constants
 * @param {Object} data       - Event data (order, user, checkout, req, etc.)
 * @param {Object} [options]  - Optional overrides
 * @param {boolean} [options.fastPath=true] - Fire immediate dispatch for high-value events
 * @param {boolean} [options.queue=true]    - Enqueue for reliable delivery
 * @returns {Promise<void>}
 */
export const fireAnalyticsEvent = async (eventType, data, options = {}) => {
  const {
    fastPath = true,
    queue    = true,
  } = options;

  const { order, user, checkout, req, method, step } = data;

  // ── Extract context from request ──────────────────────────────────────────
  const analyticsEventId = req?.body?.analyticsEventId || null;
  const ga4ClientId      = req?.body?.ga4ClientId      || null;
  const fbp              = req?.body?.fbp              || req?.cookies?._fbp || null;
  const fbc              = req?.body?.fbc              || req?.cookies?._fbc || req?.attribution?.fbclid || null;

  // ── Build normalized event (Phase 1) ─────────────────────────────────────
  let analyticsEvent;

  if (eventType === ANALYTICS_EVENTS.PURCHASE && order) {
    analyticsEvent = buildPurchaseEvent(order, req, analyticsEventId);
  } else if ((eventType === ANALYTICS_EVENTS.CHECKOUT_STEP || eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT) && checkout) {
    analyticsEvent = buildCheckoutStepEvent(
      step || (eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT ? 'shipping_info' : data.step),
      checkout,
      req,
      analyticsEventId
    );
  } else {
    analyticsEvent = buildAnalyticsEvent({
      eventType,
      eventId:         analyticsEventId,
      userId:          user?._id?.toString() || req?.user?._id?.toString() || null,
      anonymousId:     req?.anonymousId || null,
      sessionId:       req?.sessionId   || null,
      attribution:     req?.attribution || {},
      clientTimestamp: req?.body?.clientTimestamp || null,
      source:          'server',
      properties:      { method: method || null },
    });
  }

  // ── Validate event schema ─────────────────────────────────────────────────
  const { valid, errors } = validateAnalyticsEvent(analyticsEvent);
  if (!valid) {
    console.error('[Analytics] Invalid event schema:', errors);
    // Still proceed — partial events are better than no events
  }

  // ── Build shared context ──────────────────────────────────────────────────
  const context = {
    eventId:        analyticsEvent.event_id,
    userId:         user?._id?.toString() || req?.user?._id?.toString() || null,
    clientId:       ga4ClientId || req?.sessionId,
    sessionId:      req?.sessionId || null,
    fbp,
    fbc,
    eventSourceUrl: req?.headers?.referer || process.env.FRONTEND_URL,
    clientIp:       req?.ip || null,
    userAgent:      req?.headers?.['user-agent'] || null,
    attribution:    req?.attribution || {},
    resolvedOrderReference: req?.body?.resolvedOrderReference || null, 
  };

  // ── Build full queue payload ──────────────────────────────────────────────
  // Merge attribution into root level for test compatibility and easier access
  const attribution = req?.attribution || {};
  
  const queuePayload = {
    ...analyticsEvent,
    order,
    user,
    checkout,
    context,
    step:   step || data.step || null,
    method: method || null,
    // Root-level attribution fields for easier access in tests and workers
    source: attribution.source || null,
    medium: attribution.medium || null,
    campaign: attribution.campaign || null,
    gclid: attribution.gclid || null,
    fbclid: attribution.fbclid || null,
    confidenceLevel: attribution.confidenceLevel || null,
    confidenceScore: attribution.confidenceScore || null,
    isReconstructed: attribution.isReconstructed || false,
  };

  // ── Fast path: immediate dispatch (best effort) ───────────────────────────
  // Only for high-value events — purchase, checkout, login, sign_up
  const HIGH_VALUE_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    ANALYTICS_EVENTS.LOGIN,
    ANALYTICS_EVENTS.SIGN_UP,
    ANALYTICS_EVENTS.EMAIL_VERIFIED,
  ]);

  if (fastPath && HIGH_VALUE_EVENTS.has(eventType)) {
    // Do not await — fire and forget
    dispatchFastPath(eventType, queuePayload);
  }

  // ── Queue: reliable delivery with retry ───────────────────────────────────
  if (queue) {
    await enqueueAnalyticsEvent(eventType, queuePayload);
  }
};

// ─── CONVENIENCE WRAPPERS ─────────────────────────────────────────────────────
// These thin wrappers make controller call sites cleaner and more readable.

/**
 * firePurchaseEvent
 * Call from verifyPaymentController after order creation.
 *
 * @param {Object} order - Created order document
 * @param {Object} user  - Authenticated user document
 * @param {Object} req   - Express request (carries session, attribution, body)
 */
export const firePurchaseEvent = (order, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.PURCHASE, { order, user, req });

/**
 * fireCheckoutStartEvent
 * Call from checkoutController when a session is created.
 *
 * @param {Object} checkout - Created checkout document
 * @param {Object} user     - Authenticated user document
 * @param {Object} req      - Express request
 */
export const fireCheckoutStartEvent = (checkout, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.BEGIN_CHECKOUT, { checkout, user, req });

/**
 * fireLoginEvent
 * Call from userController after successful login.
 *
 * @param {string} method - 'email' | 'google' | 'facebook'
 * @param {Object} user   - Authenticated user document
 * @param {Object} req    - Express request
 */
export const fireLoginEvent = (method, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.LOGIN, { method, user, req }, { fastPath: true, queue: false });

/**
 * fireSignUpEvent
 * Call from userController after email verification completes.
 *
 * @param {string} method - 'email' | 'google' | 'facebook'
 * @param {Object} user   - Newly verified user document
 * @param {Object} req    - Express request
 */
export const fireSignUpEvent = (method, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.EMAIL_VERIFIED, { method, user, req }, { fastPath: true, queue: false });