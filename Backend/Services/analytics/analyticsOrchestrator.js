/**
 * backend/services/analytics/analyticsOrchestrator.js
 *
 * Phase 9 — Analytics Orchestrator
 *
 * QUEUE STRATEGY AFTER DEDUP FIX:
 *
 *   purchase        → fastPath: true,  queue: false
 *     Fast path is awaited in verifyPaymentController. If it fails, the
 *     controller has error context. Queue retry would send a duplicate CAPI
 *     Purchase to Meta that deduplicates but still fires unnecessarily and
 *     was the source of the cron infinite-loop symptom.
 *
 *   begin_checkout  → fastPath: true,  queue: false
 *     checkoutController.createCheckout already calls enqueueAnalyticsEvent
 *     directly with the same eventId. If fireCheckoutStartEvent also queues,
 *     two queue entries race for the same eventId — the dedup catches the
 *     second but the first processes and the fast path also fires, producing
 *     two Meta InitiateCheckout calls per checkout creation. Disabling queue
 *     here makes the direct enqueueAnalyticsEvent call in the controller the
 *     single queue entry, and the fast path the single immediate dispatch.
 *
 *   checkout_step   → fastPath: true,  queue: true
 *     Payment funnel steps are high value and benefit from retry. The queue
 *     entry and the fast path share the same eventId so Meta deduplicates
 *     the browser pixel, fast path CAPI, and queue CAPI into one event.
 *
 *   login           → fastPath: true,  queue: false
 *   sign_up         → fastPath: true,  queue: false
 *   add_to_wishlist → fastPath: true,  queue: false
 *     Engagement signals — fast path only, no retry needed.
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
 * the queue. Receives original Mongoose documents so all user fields
 * (dateOfBirth, facebookId, shippingAddress, phone) are available to
 * CAPI service functions without re-serialization loss.
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
        .then(() => console.debug('[Analytics FastPath] GA4 begin_checkout sent'))
        .catch(e => console.error('[Analytics FastPath] GA4 begin_checkout failed:', e.message))
    );
    promises.push(
      sendMetaInitiateCheckout(checkout, user, context)
        .then(r  => console.debug('[Analytics FastPath] Meta InitiateCheckout sent, events_received:', r?.eventsReceived))
        .catch(e => console.error('[Analytics FastPath] Meta InitiateCheckout failed:', e.message))
    );
  }

  // CHECKOUT_STEP fast path.
  // GA4 fires for every tracked step (order_confirmation, payment_selection,
  // payment_gateway). Meta AddPaymentInfo fires ONLY for payment_selection.
  // Firing on payment_gateway too would double-count the funnel metric since
  // the user navigates through both steps sequentially in the same checkout.
  if (eventType === ANALYTICS_EVENTS.CHECKOUT_STEP) {
    const resolvedStep = step || context?.step;
    if (resolvedStep) {
      promises.push(
        sendGA4CheckoutStep(resolvedStep, checkout, context)
          .then(() => console.debug(`[Analytics FastPath] GA4 checkout_step (${resolvedStep}) sent`))
          .catch(e => console.error(`[Analytics FastPath] GA4 checkout_step (${resolvedStep}) failed:`, e.message))
      );
      if (resolvedStep === 'payment_selection') {
        promises.push(
          sendMetaAddPaymentInfo(checkout, user, context)
            .then(r  => console.debug('[Analytics FastPath] Meta AddPaymentInfo sent, events_received:', r?.eventsReceived))
            .catch(e => console.error('[Analytics FastPath] Meta AddPaymentInfo failed:', e.message))
        );
      }
    }
  }

  if (eventType === ANALYTICS_EVENTS.LOGIN) {
    promises.push(
      sendGA4Login(method || 'email', context)
        .then(() => console.debug('[Analytics FastPath] GA4 login sent'))
        .catch(e => console.error('[Analytics FastPath] GA4 login failed:', e.message))
    );
  }

  if (eventType === ANALYTICS_EVENTS.EMAIL_VERIFIED) {
    promises.push(
      sendGA4SignUp(method || 'email', context)
        .then(() => console.debug('[Analytics FastPath] GA4 sign_up sent'))
        .catch(e => console.error('[Analytics FastPath] GA4 sign_up failed:', e.message))
    );
    promises.push(
      sendMetaCompleteRegistration(user, context)
        .then(r  => console.debug('[Analytics FastPath] Meta CompleteRegistration sent, events_received:', r?.eventsReceived))
        .catch(e => console.error('[Analytics FastPath] Meta CompleteRegistration failed:', e.message))
    );
  }

  // ADD_TO_WISHLIST fast path — both GA4 and Meta fired immediately.
  // Fast path only (queue: false in fireWishlistEvent) — wishlist events are
  // engagement signals, not conversion events. Full logging added so errors
  // are surfaced instead of swallowed.
  if (eventType === ANALYTICS_EVENTS.ADD_TO_WISHLIST) {
    if (!product) {
      console.error('[Analytics FastPath] ADD_TO_WISHLIST: product is null/undefined — skipping dispatch');
    } else {
      promises.push(
        sendGA4AddToWishlist(product, context)
          .then(() => console.debug('[Analytics FastPath] GA4 add_to_wishlist sent'))
          .catch(e => console.error('[Analytics FastPath] GA4 add_to_wishlist failed:', e.message))
      );
      promises.push(
        sendMetaAddToWishlist(product, user, context)
          .then(r  => console.debug('[Analytics FastPath] Meta AddToWishlist sent, events_received:', r?.eventsReceived))
          .catch(e => console.error('[Analytics FastPath] Meta AddToWishlist failed:', e.message))
      );
    }
  }

  // Fire all promises — individual catches above prevent any single failure
  // from blocking others. The outer catch here is a final safety net.
  Promise.all(promises).catch(() => {});
};

// ─── MAIN ORCHESTRATOR ────────────────────────────────────────────────────────

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
  const fbc              = req?.body?.fbc              || req?.cookies?._fbc || null;

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
 * queue: false — fast path is awaited in verifyPaymentController.
 * A queued retry sends a duplicate CAPI Purchase that Meta deduplicates
 * but causes the cron worker to fire an unnecessary second Meta call
 * and pollutes the test Events Manager view.
 */
export const firePurchaseEvent = (order, user, req, overrides = {}) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.PURCHASE,
    { order, user, req },
    { fastPath: true, queue: false },
    overrides
  );

/**
 * fireCheckoutStartEvent
 *
 * queue: false — checkoutController.createCheckout already calls
 * enqueueAnalyticsEvent directly with the same eventId from req.body.
 * If this wrapper also queues, two entries with the same eventId race:
 * the dedup catches the second, but the first processes and the fast path
 * also fires, producing two Meta InitiateCheckout CAPI calls per checkout.
 * The controller's direct enqueue is the single queue entry; this fast
 * path is the single immediate dispatch.
 */
export const fireCheckoutStartEvent = (checkout, user, req) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    { checkout, user, req },
    { fastPath: true, queue: false }
  );

/**
 * fireLoginEvent
 *
 * queue: false — login events are low-stakes engagement signals.
 * Fast path only; missed events are not retried.
 */
export const fireLoginEvent = (method, user, req) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.LOGIN,
    { method, user, req },
    { fastPath: true, queue: false }
  );

/**
 * fireSignUpEvent
 *
 * queue: false — CompleteRegistration is a one-time event per user.
 * Fast path only; a retry would fire a duplicate CompleteRegistration.
 */
export const fireSignUpEvent = (method, user, req) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.EMAIL_VERIFIED,
    { method, user, req },
    { fastPath: true, queue: false }
  );

/**
 * fireWishlistEvent
 *
 * queue: false — wishlist events are engagement signals, not conversion
 * events. Fast path only; missed events are not retried. Full logging
 * added to dispatchFastPath so errors are surfaced instead of swallowed.
 *
 * Caller must pass the full User document (not req.user lean JWT payload)
 * so Meta CAPI receives dateOfBirth, facebookId, and shippingAddress.
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
 * queue: true — payment funnel steps are high value and benefit from
 * retry. The queue entry, fast path CAPI, and browser pixel all share
 * the same eventId so Meta deduplicates them into one event.
 *
 * Steps fired:
 *   order_confirmation → GA4 checkout_step only (no standard Meta event)
 *   payment_selection  → GA4 add_payment_info + Meta AddPaymentInfo
 *   payment_gateway    → GA4 checkout_step only (Meta fired on payment_selection)
 */
export const fireCheckoutStepEvent = (step, checkout, user, req) =>
  fireAnalyticsEvent(
    ANALYTICS_EVENTS.CHECKOUT_STEP,
    { step, checkout, user, req },
    { fastPath: true, queue: true }
  );