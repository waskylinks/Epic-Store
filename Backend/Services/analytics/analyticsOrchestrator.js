/**
 * backend/services/analytics/analyticsOrchestrator.js
 *
 * Phase 9 — Analytics Orchestrator
 *
 * FIXES APPLIED IN THIS VERSION:
 *
 *   [FIX 1] queuePayload.user now includes dateOfBirth, facebookId, and
 *           shippingAddress. Previously these were stripped during serialization
 *           so the queue replay path sent Meta CAPI events without dob, geo,
 *           and fb_login_id — lowering match quality on retried events vs the
 *           fast path which used the original Mongoose document directly.
 *
 *   All other fixes from the previous version are retained unchanged:
 *   [FIX 2] phone included in serialized user
 *   [FIX 3] fbc fallback does not pass raw fbclid as fbc
 *   [FIX 4] ANALYTICS_EVENTS.SIGN_UP removed from HIGH_VALUE_EVENTS
 *   [FIX 5] firePurchaseEvent accepts and merges purchaseEventOverrides
 *   [FIX 6] overrides spread last in context so controller values win
 *   [FIX 7] resolvedOrderReference IIFE precedence fix
 *   [FIX 8] dispatchFastPath receives original Mongoose documents
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
 * Receives the original Mongoose documents (order, user) and the shared
 * context object — NOT the serialized queuePayload. This ensures all user
 * fields including dateOfBirth, facebookId, shippingAddress, and phone
 * are available to the CAPI service functions.
 *
 * @param {string} eventType
 * @param {Object} params
 */
const dispatchFastPath = async (eventType, { order, user, checkout, context, method }) => {
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
      sendGA4CheckoutStep('shipping_info', checkout, context)
        .catch(e => console.error('[Analytics FastPath] GA4 checkout failed:', e.message))
    );
    promises.push(
      sendMetaInitiateCheckout(checkout, user, context)
        .catch(e => console.error('[Analytics FastPath] Meta InitiateCheckout failed:', e.message))
    );
  }

  if (eventType === ANALYTICS_EVENTS.LOGIN) {
    promises.push(
      sendGA4Login(method || 'email', context)
        .catch(e => console.error('[Analytics FastPath] GA4 login failed:', e.message))
    );
  }

  if (eventType === ANALYTICS_EVENTS.EMAIL_VERIFIED) {
    promises.push(
      sendGA4SignUp(method || 'email', context)
        .catch(e => console.error('[Analytics FastPath] GA4 sign_up failed:', e.message))
    );
    promises.push(
      sendMetaCompleteRegistration(user, context)
        .catch(e => console.error('[Analytics FastPath] Meta CompleteRegistration failed:', e.message))
    );
  }

  Promise.all(promises).catch(() => {});
};

// ─── MAIN ORCHESTRATOR ────────────────────────────────────────────────────────

/**
 * fireAnalyticsEvent
 *
 * Primary entry point for analytics events from controllers.
 *
 * @param {string} eventType   - One of ANALYTICS_EVENTS constants
 * @param {Object} data        - Event data (order, user, checkout, req, etc.)
 * @param {Object} [options]   - Optional dispatch flags
 * @param {Object} [overrides] - Controller-built values that win over req
 * @returns {Promise<void>}
 */
export const fireAnalyticsEvent = async (eventType, data, options = {}, overrides = {}) => {
  const {
    fastPath = true,
    queue    = true,
  } = options;

  const { order, user, checkout, req, method, step } = data;

  // ── Extract context from request ──────────────────────────────────────────
  const analyticsEventId = req?.body?.analyticsEventId || null;
  const ga4ClientId      = req?.body?.ga4ClientId      || null;
  const fbp              = req?.body?.fbp              || req?.cookies?._fbp || null;

  // Do NOT fall back to req.attribution.fbclid here as fbc.
  // A raw fbclid is not a valid fbc — metaCapiService functions call
  // formatFbc(context.attribution.fbclid) themselves when context.fbc is absent.
  const fbc = req?.body?.fbc || req?.cookies?._fbc || null;

  // ── Resolve order reference ───────────────────────────────────────────────
  const resolvedOrderReference = (() => {
    if (overrides.resolvedOrderReference?.startsWith('ORD-')) {
      return overrides.resolvedOrderReference;
    }
    if (req?.body?.resolvedOrderReference?.startsWith('ORD-')) {
      return req.body.resolvedOrderReference;
    }
    if (order?.paymentInfo?.reference?.startsWith('ORD-')) {
      return order.paymentInfo.reference;
    }
    return order?._id?.toString() || null;
  })();

  const resolvedAnalyticsEventId =
    overrides.analyticsEventId || analyticsEventId || null;

  // ── Build normalized event ────────────────────────────────────────────────
  let analyticsEvent;

  if (eventType === ANALYTICS_EVENTS.PURCHASE && order) {
    analyticsEvent = buildPurchaseEvent(order, req, resolvedAnalyticsEventId);
  } else if ((eventType === ANALYTICS_EVENTS.CHECKOUT_STEP || eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT) && checkout) {
    analyticsEvent = buildCheckoutStepEvent(
      step || (eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT ? 'shipping_info' : data.step),
      checkout,
      req,
      resolvedAnalyticsEventId
    );
  } else {
    analyticsEvent = buildAnalyticsEvent({
      eventType,
      eventId:         resolvedAnalyticsEventId,
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
    resolvedOrderReference,
    // Spread overrides last — controller-built values always win
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v != null)
    ),
  };

  // ── Build full queue payload ──────────────────────────────────────────────
  const attribution = req?.attribution || {};

  const queuePayload = {
    ...analyticsEvent,
    order: order ? {
      _id:           order._id?.toString(),
      totalPrice:    order.totalPrice,
      taxPrice:      order.taxPrice,
      shippingPrice: order.shippingPrice,
      orderItems:    order.orderItems,
      shippingInfo:  order.shippingInfo,
      discounts:     order.discounts,
      paymentInfo: {
        reference: order.paymentInfo?.reference,
        currency:  order.paymentInfo?.currency,
        method:    order.paymentInfo?.method,
        status:    order.paymentInfo?.status,
      },
      analytics: order.analytics,
    } : null,

    // [FIX 1] Full user serialization — includes dateOfBirth, facebookId,
    // and shippingAddress so the queue replay path sends the same matching
    // signals as the fast path which uses the original Mongoose document.
    // Previously these were stripped here, causing lower EMQ on retried events
    // vs successful first-attempt fast-path dispatches.
    user: user ? {
      _id:             user._id?.toString(),
      email:           user.email,
      phone:           user.phone || user.phoneNo || null,
      firstName:       user.firstName,
      lastName:        user.lastName,
      // [FIX 1] New fields for queue replay match quality parity
      dateOfBirth:     user.dateOfBirth     || null,
      facebookId:      user.facebookId      || null,
      shippingAddress: user.shippingAddress || null,
    } : null,

    checkout,
    context,
    step:            step || data.step || null,
    method:          method || null,
    source:          attribution.source          || null,
    medium:          attribution.medium          || null,
    campaign:        attribution.campaign        || null,
    gclid:           attribution.gclid           || null,
    fbclid:          attribution.fbclid          || null,
    confidenceLevel: attribution.confidenceLevel || null,
    confidenceScore: attribution.confidenceScore || null,
    isReconstructed: attribution.isReconstructed || false,
  };

  // ── Fast path: immediate dispatch ─────────────────────────────────────────
  const HIGH_VALUE_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    ANALYTICS_EVENTS.LOGIN,
    ANALYTICS_EVENTS.EMAIL_VERIFIED,
  ]);

  if (fastPath && HIGH_VALUE_EVENTS.has(eventType)) {
    // Pass original Mongoose documents directly — not queuePayload —
    // so all user fields are available without re-serialization loss
    dispatchFastPath(eventType, { order, user, checkout, context, method });
  }

  // ── Queue: reliable delivery with retry ───────────────────────────────────
  if (queue) {
    await enqueueAnalyticsEvent(eventType, queuePayload);
  }
};

// ─── CONVENIENCE WRAPPERS ─────────────────────────────────────────────────────

/**
 * firePurchaseEvent
 *
 * @param {Object} order     - Created order document
 * @param {Object} user      - Authenticated user document
 * @param {Object} req       - Express request
 * @param {Object} overrides - Controller-built analytics values that win over req
 */
export const firePurchaseEvent = (order, user, req, overrides = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.PURCHASE, { order, user, req }, {}, overrides);

/**
 * fireCheckoutStartEvent
 *
 * @param {Object} checkout - Created checkout document
 * @param {Object} user     - Authenticated user document
 * @param {Object} req      - Express request
 */
export const fireCheckoutStartEvent = (checkout, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.BEGIN_CHECKOUT, { checkout, user, req });

/**
 * fireLoginEvent
 *
 * @param {string} method - 'email' | 'google' | 'facebook'
 * @param {Object} user   - Authenticated user document
 * @param {Object} req    - Express request
 */
export const fireLoginEvent = (method, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.LOGIN, { method, user, req }, { fastPath: true, queue: false });

/**
 * fireSignUpEvent
 *
 * @param {string} method - 'email' | 'google' | 'facebook'
 * @param {Object} user   - Newly verified user document
 * @param {Object} req    - Express request
 */
export const fireSignUpEvent = (method, user, req) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.EMAIL_VERIFIED, { method, user, req }, { fastPath: true, queue: false });