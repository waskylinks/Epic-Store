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
 *
 * Fixes applied (vs previous version):
 *   1. queuePayload.user now includes phone — was being stripped before
 *      reaching sendMetaInitiateCheckout and sendMetaCompleteRegistration
 *      via the queue path.
 *   2. dispatchFastPath now receives the original Mongoose user document
 *      directly rather than the already-serialized queuePayload.user.
 *      This ensures the fast path also has phone available.
 *   3. fbc fallback in context no longer passes a raw fbclid as fbc.
 *      Raw fbclid belongs in attribution only — metaCapiService functions
 *      call formatFbc() themselves when they need it. Passing it here as
 *      context.fbc caused it to bypass formatFbc() and reach Meta unformatted,
 *      which causes a 400 Bad Request.
 *   4. ANALYTICS_EVENTS.SIGN_UP removed from HIGH_VALUE_EVENTS — that
 *      constant does not exist in the analytics.js constants file. Only
 *      EMAIL_VERIFIED exists and was already present. SIGN_UP was a dead
 *      entry that never matched, silently skipping fast-path dispatch.
 *   5. firePurchaseEvent now accepts and merges purchaseEventOverrides.
 *      verifyPaymentController builds resolvedFbc (correctly formatted),
 *      resolvedOrderReference (ORD-xxx), and analyticsEventId and passes
 *      them as a fourth argument. The previous three-parameter wrapper
 *      silently dropped that argument, meaning:
 *        - resolvedFbc never reached the context — raw req.body.fbc was
 *          used instead, bypassing formatFbc() and causing Meta 400 errors
 *        - resolvedOrderReference never reached customData.order_id in
 *          sendMetaPurchase — MongoDB ObjectId was used instead of ORD-xxx,
 *          breaking Meta's order reconciliation
 *        - analyticsEventId from purchaseEventOverrides was ignored —
 *          fireAnalyticsEvent fell back to req.body.analyticsEventId which
 *          is the same value, so this was harmless, but the intent was lost
 *      The fix threads overrides through fireAnalyticsEvent into context so
 *      all three values reach both the fast path and the queue path.
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
 * IMPORTANT: receives the original Mongoose documents (order, user) and the
 * shared context object — NOT the serialized queuePayload. This ensures phone
 * and other fields not included in the serialized user are available here.
 *
 * @param {string} eventType
 * @param {Object} params
 * @param {Object} params.order    - Original Mongoose order document
 * @param {Object} params.user     - Original Mongoose user document
 * @param {Object} params.checkout - Checkout document
 * @param {Object} params.context  - Shared analytics context
 * @param {string} params.method   - Auth method (login/signup events)
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
 *   fireAnalyticsEvent('purchase', { order, user, req }, {}, overrides);
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
 * @param {string} eventType   - One of ANALYTICS_EVENTS constants
 * @param {Object} data        - Event data (order, user, checkout, req, etc.)
 * @param {Object} [options]   - Optional dispatch flags
 * @param {boolean} [options.fastPath=true] - Fire immediate dispatch for high-value events
 * @param {boolean} [options.queue=true]    - Enqueue for reliable delivery
 * @param {Object} [overrides] - Values from the controller that take priority over
 *                               req.body equivalents. Supported keys:
 *                                 fbc                    — pre-formatted fbc string
 *                                 ga4ClientId            — GA4 client ID
 *                                 analyticsEventId       — browser pixel event UUID
 *                                 resolvedOrderReference — ORD-xxx reference
 *                               These are merged into context AFTER it is built
 *                               from req so they always win over raw req.body values.
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

  // FIX: Do NOT fall back to req.attribution.fbclid here as fbc.
  // A raw fbclid is not a valid fbc value — it must be formatted as
  // fb.1.{timestamp}.{fbclid} before being passed as fbc. The metaCapiService
  // functions (sendMetaAddToCart, sendMetaInitiateCheckout, etc.) each call
  // formatFbc(context.attribution.fbclid) themselves when context.fbc is absent.
  // Passing the raw fbclid here as context.fbc causes it to bypass formatFbc()
  // entirely and reach Meta unformatted, resulting in a 400 Bad Request.
  const fbc = req?.body?.fbc || req?.cookies?._fbc || null;

  // ── Resolve order reference ───────────────────────────────────────────────
  // IIFE is required — the previous ternary had an operator precedence bug
  // where the ternary bound to the right operand of || causing the entire
  // expression to short-circuit incorrectly.
  const resolvedOrderReference = (() => {
    // FIX: overrides.resolvedOrderReference wins first — it was built by
    // verifyPaymentController and is guaranteed to be ORD-xxx format.
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

  // ── Build normalized event (Phase 1) ─────────────────────────────────────
  // FIX: prefer overrides.analyticsEventId — it is the UUID the browser pixel
  // already used for trackPurchase(). Falling back to req.body.analyticsEventId
  // is equivalent here since verifyPaymentController reads from the same source,
  // but the override makes the intent explicit and survives future refactors.
  const resolvedAnalyticsEventId =
    overrides.analyticsEventId || analyticsEventId || null;

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
    // Still proceed — partial events are better than no events
  }

  // ── Build shared context ──────────────────────────────────────────────────
  // FIX: overrides are merged last so controller-supplied values always win
  // over values derived from req. Specifically:
  //
  //   overrides.fbc    — verifyPaymentController runs resolveFbc() which
  //                      applies formatFbc() to raw fbclid values. That
  //                      formatted value must reach Meta; using req.body.fbc
  //                      raw would bypass the formatter. Merging last
  //                      guarantees the pre-formatted value is used.
  //
  //   overrides.resolvedOrderReference — ORD-xxx format; used by
  //                      sendMetaPurchase as customData.order_id. Without
  //                      this, Meta receives a MongoDB ObjectId which cannot
  //                      be reconciled against CAPI events using ORD-xxx.
  //
  //   overrides.ga4ClientId — passed explicitly for completeness; in practice
  //                      the same as req.body.ga4ClientId for now.
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

    // FIX: spread overrides last so controller-built values take priority
    // over every field derived from req above. Only truthy override values
    // replace their counterparts — undefined/null overrides are ignored so
    // a controller that omits a key doesn't accidentally null out a valid
    // req-derived value.
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
    // FIX: phone is now included in the serialized user object.
    // Previously phone was stripped here, causing sendMetaInitiateCheckout
    // and sendMetaCompleteRegistration to receive a user with no phone
    // when replayed from the queue, silently dropping ph from user_data.
    user: user ? {
      _id:       user._id?.toString(),
      email:     user.email,
      phone:     user.phone || user.phoneNo || null,
      firstName: user.firstName,
      lastName:  user.lastName,
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

  // ── Fast path: immediate dispatch (best effort) ───────────────────────────
  // FIX: ANALYTICS_EVENTS.SIGN_UP removed — that constant does not exist in
  // analytics.js. Only EMAIL_VERIFIED exists. SIGN_UP was a dead entry that
  // never matched any eventType, silently skipping the fast path for sign-ups.
  // The existing EMAIL_VERIFIED entry already handles this correctly.
  const HIGH_VALUE_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    ANALYTICS_EVENTS.LOGIN,
    ANALYTICS_EVENTS.EMAIL_VERIFIED,
  ]);

  if (fastPath && HIGH_VALUE_EVENTS.has(eventType)) {
    // FIX: pass original documents and context directly — not queuePayload.
    // queuePayload.user is already serialized (plain object), which previously
    // meant the fast path also received a user with phone stripped. The fast
    // path now receives the original Mongoose user document so all fields
    // including phone are available to the CAPI service functions.
    dispatchFastPath(eventType, { order, user, checkout, context, method });
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
 * FIX: now accepts a fourth `overrides` argument and forwards it to
 * fireAnalyticsEvent. verifyPaymentController builds:
 *   - resolvedFbc              — formatFbc() already applied; must reach Meta
 *   - resolvedOrderReference   — ORD-xxx format for Meta order_id
 *   - analyticsEventId         — browser pixel UUID for deduplication
 *   - ga4ClientId              — GA4 client ID
 *
 * The previous three-parameter signature silently dropped all of these,
 * meaning the raw req.body.fbc (potentially an unformatted fbclid) reached
 * Meta CAPI and caused 400 Bad Request errors on purchase events for users
 * whose _fbc cookie was absent and whose fbclid fallback was unformatted.
 *
 * @param {Object} order     - Created order document
 * @param {Object} user      - Authenticated user document
 * @param {Object} req       - Express request (carries session, attribution, body)
 * @param {Object} overrides - Controller-built analytics values that win over req
 */
export const firePurchaseEvent = (order, user, req, overrides = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.PURCHASE, { order, user, req }, {}, overrides);

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