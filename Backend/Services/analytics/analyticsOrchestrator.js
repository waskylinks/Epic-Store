/**
 * backend/services/analytics/analyticsOrchestrator.js
 *
 * Phase 9 — Analytics Orchestrator
 */

import {
  buildPurchaseEvent,
  buildCheckoutStepEvent,
  buildAnalyticsEvent,
  validateAnalyticsEvent,
  ANALYTICS_EVENTS,
} from '../../utils/analyticsEvent.js';
import { enqueueAnalyticsEvent } from '../../jobs/analyticsQueue.js';
import {
  sendGA4Purchase,
  sendGA4CheckoutStep,
  sendGA4Login,
  sendGA4SignUp,
  sendGA4AddToWishlist,
} from './ga4Service.js';
import {
  sendMetaPurchase,
  sendMetaInitiateCheckout,
  sendMetaCompleteRegistration,
  sendMetaAddToWishlist,
  sendMetaAddPaymentInfo,
} from './metaCapiService.js';

// ─── FAST PATH DISPATCHER ─────────────────────────────────────────────────────

/**
 * dispatchFastPath
 *
 * Fires an event immediately to GA4 and Meta CAPI without going through
 * the queue. Used for purchase events where sub-60s delivery matters.
 *
 * Receives the original Mongoose documents (order, user, product) and the
 * shared context object — NOT the serialized queuePayload. This ensures all
 * user fields including dateOfBirth, facebookId, shippingAddress, and phone
 * are available to the CAPI service functions.
 *          AddPaymentInfo for payment_selection only.
 *
 * @param {string} eventType
 * @param {Object} params
 */
const dispatchFastPath = async (eventType, { order, user, checkout, context, method, product, step }) => {
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

  // CHECKOUT_STEP fast path.
  // GA4 fires for every tracked step (order_confirmation, payment_selection,
  // payment_gateway). Meta AddPaymentInfo fires ONLY for payment_selection —
  // firing on payment_gateway too would double-count the funnel metric, since
  // the user navigates through both steps sequentially in the same checkout.
  // This mirrors the browser-side constraint in eventBridge.trackCheckoutStep().
  if (eventType === ANALYTICS_EVENTS.CHECKOUT_STEP) {
    const resolvedStep = step || context?.step;
    if (resolvedStep) {
      promises.push(
        sendGA4CheckoutStep(resolvedStep, checkout, context)
          .catch(e => console.error(`[Analytics FastPath] GA4 checkout_step (${resolvedStep}) failed:`, e.message))
      );
      if (resolvedStep === 'payment_selection') {
        promises.push(
          sendMetaAddPaymentInfo(checkout, user, context)
            .catch(e => console.error('[Analytics FastPath] Meta AddPaymentInfo failed:', e.message))
        );
      }
    }
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

  // ADD_TO_WISHLIST fast path.
  // Both GA4 and Meta are fired immediately — wishlist events are low priority
  // so they are fast-path only (queue: false in fireWishlistEvent). This keeps
  // the queue lean and avoids retry overhead for non-conversion events.
  if (eventType === ANALYTICS_EVENTS.ADD_TO_WISHLIST) {
    promises.push(
      sendGA4AddToWishlist(product, context)
        .catch(e => console.error('[Analytics FastPath] GA4 add_to_wishlist failed:', e.message))
    );
    promises.push(
      sendMetaAddToWishlist(product, user, context)
        .catch(e => console.error('[Analytics FastPath] Meta AddToWishlist failed:', e.message))
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
 * @param {Object} data        - Event data (order, user, checkout, product, req, etc.)
 * @param {Object} [options]   - Optional dispatch flags
 * @param {Object} [overrides] - Controller-built values that win over req
 * @returns {Promise<void>}
 */
export const fireAnalyticsEvent = async (eventType, data, options = {}, overrides = {}) => {
  const {
    fastPath = true,
    queue    = true,
  } = options;

  const { order, user, checkout, req, method, step, product } = data;

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
  } else if (
    (eventType === ANALYTICS_EVENTS.CHECKOUT_STEP || eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT) &&
    checkout
  ) {
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
    step:           step || data.step || null,
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

    user: user ? {
      _id:             user._id?.toString(),
      email:           user.email,
      phone:           user.phone || user.phoneNo || null,
      firstName:       user.firstName,
      lastName:        user.lastName,
      dateOfBirth:     user.dateOfBirth     || null,
      facebookId:      user.facebookId      || null,
      shippingAddress: user.shippingAddress || null,
    } : null,

    product: product ? {
      _id:      product._id?.toString(),
      name:     product.name,
      category: product.category || null,
      pricing:  product.pricing  || null,
      price:    product.price    || null,
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
    ANALYTICS_EVENTS.CHECKOUT_STEP,
    ANALYTICS_EVENTS.LOGIN,
    ANALYTICS_EVENTS.EMAIL_VERIFIED,
    ANALYTICS_EVENTS.ADD_TO_WISHLIST,
  ]);

  if (fastPath && HIGH_VALUE_EVENTS.has(eventType)) {
    // Pass original Mongoose documents directly — not queuePayload —
    // so all user/product fields are available without re-serialization loss
    dispatchFastPath(eventType, { order, user, checkout, context, method, product, step });
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

/**
 * fireWishlistEvent
 *
 *
 * Fast path only (queue: false) — wishlist events are engagement signals,
 * not conversion events. Skipping the queue keeps it lean and avoids retry
 * overhead for non-critical events. If the fast path fails it is logged but
 * never retried, which is correct — a missed wishlist event does not affect
 * revenue reporting or Meta ROAS calculations.
 *
 * Caller (wishlistController.addToWishlist) must pass the full User document
 * (not req.user lean JWT payload) so Meta CAPI receives dateOfBirth,
 * facebookId, and shippingAddress for maximum match quality.
 *
 * @param {Object} product - Full product document
 * @param {Object} user    - Full user document (fetched explicitly in controller)
 * @param {Object} req     - Express request
 */
export const fireWishlistEvent = (product, user, req) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.ADD_TO_WISHLIST,
    { product, user, req },
    { fastPath: true, queue: false }
  );

/**
 * fireCheckoutStepEvent
 *
 * Called from checkoutController.updateCheckoutStep for tracked steps:
 *   order_confirmation → GA4 checkout_step only (no standard Meta event)
 *   payment_selection  → GA4 add_payment_info + Meta AddPaymentInfo
 *   payment_gateway    → GA4 checkout_step only (Meta already fired on payment_selection)
 *
 * Both fast path and queue are enabled so events are delivered immediately
 * and retried if the fast path fails — payment funnel steps are high value.
 *
 * @param {string} step     - Checkout step name
 * @param {Object} checkout - Checkout document
 * @param {Object} user     - Authenticated user document (from req.user)
 * @param {Object} req      - Express request
 */
export const fireCheckoutStepEvent = (step, checkout, user, req) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.CHECKOUT_STEP,
    { step, checkout, user, req },
    { fastPath: true, queue: true }
  );