/**
 * backend/services/analytics/ga4Service.js
 *
 * Phase 4 — GA4 Measurement Protocol
 *
 * Sends server-side events directly to Google Analytics 4 via the
 * Measurement Protocol API. This runs alongside (not instead of) the
 * browser-side gtag.js. Together they provide:
 *
 *   Browser gtag.js   → captures page views, add_to_cart, user interactions
 *   This service      → captures purchase, checkout steps, server-confirmed events
 *
 * Why server-side GA4 matters:
 *   Browser-only tracking misses 20-30% of conversions due to:
 *     - Ad blockers blocking gtag.js
 *     - Safari ITP and Firefox ETP blocking cookies
 *     - Users closing the tab before gtag fires the purchase event
 *     - Browser crashes at the payment confirmation step
 *
 * Deduplication:
 *   Both the browser gtag purchase event and this server-side event must
 *   carry the same event_id (UUID from Phase 1 SDK). GA4 deduplicates
 *   automatically when the same event_id arrives within 24 hours.
 *   Without matching event_ids, purchases are double-counted.
 *
 * client_id requirement:
 *   GA4 needs the client_id from the _ga cookie to associate server-side
 *   events with the correct browser session. Without it, server events
 *   appear as new users in GA4 reports, inflating user counts.
 *   The Phase 1 frontend SDK reads the _ga cookie and sends ga4ClientId
 *   in the request body.
 *
 * Endpoint strategy (per official Google documentation):
 *
 *   Development:
 *     1. Validate payload against the debug endpoint first.
 *        Debug endpoint returns validationMessages — logged to console.
 *        Events sent to /debug are NOT stored in GA4 reports.
 *     2. Always send to production endpoint regardless of validation result.
 *        This ensures events appear in GA4 Realtime reports in development.
 *        Check GA4 → Reports → Realtime (not DebugView) during local testing.
 *
 *   Production:
 *     Send to production endpoint only — no debug call overhead.
 *
 *   Why not DebugView?
 *     Per Google docs and Simo Ahava's research, Measurement Protocol events
 *     only appear in DebugView when the client_id has prior data collected.
 *     A server-generated or session-based client_id has no prior GA4 data,
 *     so DebugView shows nothing. Realtime reports always work.
 *
 * Environment variables required:
 *   GA4_MEASUREMENT_ID   — G-XXXXXXXXXX from GA4 Data Streams
 *   GA4_API_SECRET       — Measurement Protocol API secret
 *   GA4_ENDPOINT         — Production endpoint URL (optional, has default)
 *   GA4_DEBUG_ENDPOINT   — Debug endpoint URL (optional, has default)
 */

import axios from 'axios';

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

const PRODUCTION_ENDPOINT =
  process.env.GA4_ENDPOINT       || 'https://www.google-analytics.com/mp/collect';

const DEBUG_ENDPOINT =
  process.env.GA4_DEBUG_ENDPOINT || 'https://www.google-analytics.com/debug/mp/collect';

// ─── PAYLOAD BUILDER ─────────────────────────────────────────────────────────

/**
 * buildGA4Payload
 *
 * Assembles the GA4 Measurement Protocol request payload.
 * GA4 requires client_id on every request — without it the event is
 * silently dropped by the GA4 endpoint.
 *
 * @param {string}   clientId    - From _ga cookie (e.g. "1234567890.9876543210")
 * @param {string}   userId      - Authenticated user ID (optional)
 * @param {string}   sessionId   - Session ID for session-scoped metrics
 * @param {string}   eventName   - GA4 event name (snake_case)
 * @param {Object}   eventParams - Event-specific parameters
 * @returns {Object} GA4 Measurement Protocol payload
 */
const buildGA4Payload = ({ clientId, userId, sessionId, eventName, eventParams }) => {
  const payload = {
    // client_id ties this event to a browser session in GA4 reports.
    // Falls back to sessionId if ga4ClientId is unavailable.
    client_id: clientId || sessionId || `server_${Date.now()}`,

    // user_id enables cross-device user stitching in GA4 Explorer.
    // Must be the same ID used in browser gtag('set', { user_id: '...' })
    ...(userId && { user_id: userId }),

    events: [
      {
        name:   eventName,
        params: {
          ...eventParams,
          // session_id links this server event to the browser session timeline
          ...(sessionId && { session_id: sessionId }),
          // Required by GA4 to count as an engaged session
          engagement_time_msec: 1,
          // debug_mode: 1 causes events to appear in DebugView when the
          // client_id has prior GA4 data. Also causes the debug endpoint
          // to return richer validation messages. Safe to include in production.
          ...(process.env.NODE_ENV !== 'production' && { debug_mode: 1 }),
        },
      },
    ],
  };

  return payload;
};

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

/**
 * sendGA4Event
 *
 * Sends a single event to the GA4 Measurement Protocol endpoint.
 *
 * Development strategy (dual send):
 *   1. Validate against debug endpoint — logs any payload issues to console.
 *      This call is non-fatal: if the debug call fails, the production send
 *      still runs.
 *   2. Always send to production endpoint — events appear in Realtime reports.
 *
 * Production strategy (single send):
 *   Send to production endpoint only. No debug overhead.
 *
 * The queue worker (Phase 6) catches thrown errors and handles retry/dead-letter.
 * Controllers must never call this directly — always go through the queue.
 *
 * @param {string}   eventName   - GA4 event name
 * @param {Object}   eventParams - Event-specific parameters
 * @param {Object}   context     - Request context from the analytics event
 * @param {string}   context.clientId   - GA4 client_id from _ga cookie
 * @param {string}   context.userId     - Authenticated user ID
 * @param {string}   context.sessionId  - Session ID
 * @param {string}   context.eventId    - UUID for deduplication
 * @returns {Promise<Object>} Result object
 */
export const sendGA4Event = async (eventName, eventParams, context = {}) => {
  const { clientId, userId, sessionId, eventId } = context;

  if (!process.env.GA4_MEASUREMENT_ID || !process.env.GA4_API_SECRET) {
    throw new Error('GA4_MEASUREMENT_ID or GA4_API_SECRET not configured');
  }

  const queryParams = `measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`;

  const payload = buildGA4Payload({
    clientId,
    userId,
    sessionId,
    eventName,
    eventParams: {
      ...eventParams,
      // event_id is the deduplication key — must match the browser gtag event_id.
      // GA4 deduplicates same event_id within 24 hours.
      ...(eventId && { event_id: eventId }),
    },
  });

  // ── Development: validate then send to production ─────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    try {
      const debugResponse = await axios.post(
        `${DEBUG_ENDPOINT}?${queryParams}`,
        payload,
        { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
      );

      if (debugResponse.data?.validationMessages?.length > 0) {
        // Payload has issues — log them clearly so they can be fixed
        console.warn(
          `[GA4] Validation issues for "${eventName}" event:`,
          JSON.stringify(debugResponse.data.validationMessages, null, 2)
        );
      } else {
        console.debug(`[GA4] Payload validation passed for event: "${eventName}"`);
      }
    } catch (debugErr) {
      // Debug endpoint failure is non-fatal — production send still runs.
      // This can happen if the debug endpoint is temporarily unreachable.
      console.warn(
        `[GA4] Debug validation request failed (non-fatal): ${debugErr.message}`
      );
    }
  }

  // ── Always send to production endpoint (both dev and prod) ───────────────
  // Events sent here are processed and stored in GA4.
  // Check GA4 → Reports → Realtime to verify events in development.
  const response = await axios.post(
    `${PRODUCTION_ENDPOINT}?${queryParams}`,
    payload,
    { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
  );

  return {
    success:    true,
    statusCode: response.status,
    // GA4 production endpoint always returns 204 with no body — validationMessages
    // are only available from the debug endpoint (already logged above in dev).
    validationMessages: [],
    eventName,
    eventId:    eventId || null,
    sentAt:     new Date().toISOString(),
  };
};

// ─── PURCHASE EVENT ───────────────────────────────────────────────────────────

/**
 * sendGA4Purchase
 *
 * Sends a GA4 `purchase` event for a completed order.
 * This is the highest-value event — it feeds GA4 revenue reporting,
 * ROAS calculations, and conversion attribution.
 *
 * Maps to GA4's recommended purchase event schema:
 * https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events#purchase
 *
 * @param {Object} order    - Mongoose Order document (post-save)
 * @param {Object} context  - Analytics context from the event payload
 * @returns {Promise<Object>}
 */
export const sendGA4Purchase = async (order, context = {}) => {
  const {
    clientId,
    userId,
    sessionId,
    eventId,
  } = context;

  // Map order items to GA4 e-commerce items array
  const items = (order.orderItems || []).map((item, index) => ({
    item_id:       item.product?.toString() || `item_${index}`,
    item_name:     item.name                || 'Unknown Product',
    item_category: item.category            || 'uncategorized',
    price:         Number(item.price)       || 0,
    quantity:      Number(item.quantity)    || 1,
    // index position in the cart — used for cart position analysis
    index,
  }));

  const eventParams = {
    // Required GA4 purchase parameters
    transaction_id: order.paymentInfo?.reference || order._id?.toString(),
    value:          Number(order.totalPrice)      || 0,
    currency:       order.paymentInfo?.currency   || 'USD',
    tax:            Number(order.taxPrice)        || 0,
    shipping:       Number(order.shippingPrice)   || 0,
    items,

    // Coupon — present when a discount code was applied
    ...(order.discounts?.codes?.[0]?.code && {
      coupon: order.discounts.codes[0].code,
    }),

    // Attribution quality — custom dimensions for filtering in GA4 reports.
    // Reads from context.attribution which is now sourced from order.analytics
    // (the correctly resolved attribution with clientAttribution fallback applied).
    attribution_confidence:    context.attribution?.confidenceLevel    || 'UNKNOWN',
    attribution_reconstructed: context.attribution?.isReconstructed    || false,
    attribution_source:        context.attribution?.source             || 'direct',

    // Purchase metadata
    is_first_purchase: order.analytics?.isFirstPurchase || false,
    purchase_number:   order.analytics?.purchaseNumber  || null,
    payment_method:    order.paymentInfo?.method         || 'unknown',
    item_count:        items.length,
  };

  return sendGA4Event('purchase', eventParams, {
    clientId,
    userId,
    sessionId,
    eventId,
  });
};

// ─── CHECKOUT STEP EVENT ──────────────────────────────────────────────────────

/**
 * sendGA4CheckoutStep
 *
 * Sends a GA4 event for a checkout funnel step.
 * Maps to GA4's begin_checkout and add_payment_info events,
 * plus a custom checkout_step event for intermediate steps.
 *
 * GA4 checkout funnel events:
 *   begin_checkout      → step: 'shipping_info'
 *   add_payment_info    → step: 'payment_selection'
 *   custom checkout_step → all other steps
 *
 * @param {string} step      - Step name from Checkout.currentStep
 * @param {Object} checkout  - Checkout document
 * @param {Object} context   - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4CheckoutStep = async (step, checkout, context = {}) => {
  // Map checkout steps to GA4 standard event names where possible
  const GA4_STEP_MAP = {
    shipping_info:      'begin_checkout',
    payment_selection:  'add_payment_info',
  };

  const eventName = GA4_STEP_MAP[step] || 'checkout_step';

  const items = (checkout.items || []).map((item, index) => ({
    item_id:  item.product?.toString() || `item_${index}`,
    price:    Number(item.price)       || 0,
    quantity: Number(item.quantity)    || 1,
    index,
  }));

  const eventParams = {
    currency:   checkout.pricing?.currency   || 'USD',
    value:      checkout.pricing?.totalPrice || 0,
    items,
    checkout_step: step,
    ...(checkout.discount?.code && { coupon: checkout.discount.code }),
  };

  return sendGA4Event(eventName, eventParams, context);
};

// ─── ADD TO CART EVENT ────────────────────────────────────────────────────────

/**
 * sendGA4AddToCart
 *
 * Sends a GA4 `add_to_cart` event.
 * Called from the cart controller after a successful cart add.
 *
 * @param {Object} product  - Product document
 * @param {number} quantity - Quantity added
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4AddToCart = async (product, quantity, context = {}) => {
  const price = product.pricing?.sale || product.pricing?.regular || product.price || 0;

  return sendGA4Event('add_to_cart', {
    currency: 'USD',
    value:    Number(price) * Number(quantity),
    items: [{
      item_id:       product._id?.toString(),
      item_name:     product.name,
      item_category: product.category || 'uncategorized',
      price:         Number(price),
      quantity:      Number(quantity),
    }],
  }, context);
};

// ─── LOGIN EVENT ──────────────────────────────────────────────────────────────

/**
 * sendGA4Login
 *
 * Sends a GA4 `login` event after successful authentication.
 * Used for measuring login rates and correlating with purchase behaviour.
 *
 * @param {string} method   - "email" | "google" | "facebook"
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4Login = async (method = 'email', context = {}) => {
  return sendGA4Event('login', { method }, context);
};

// ─── SIGN UP EVENT ────────────────────────────────────────────────────────────

/**
 * sendGA4SignUp
 *
 * Sends a GA4 `sign_up` event after successful registration.
 *
 * @param {string} method   - "email" | "google" | "facebook"
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4SignUp = async (method = 'email', context = {}) => {
  return sendGA4Event('sign_up', { method }, context);
};

// ─── REFUND EVENT ─────────────────────────────────────────────────────────────

/**
 * sendGA4Refund
 *
 * Sends a GA4 `refund` event when a refund is processed.
 * GA4 uses this to adjust revenue metrics — without it, refunded orders
 * continue to inflate conversion value in reports.
 *
 * @param {Object} order        - Original order document
 * @param {number} refundAmount - Amount refunded
 * @param {Object} context      - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4Refund = async (order, refundAmount, context = {}) => {
  return sendGA4Event('refund', {
    transaction_id: order.paymentInfo?.reference || order._id?.toString(),
    value:          Number(refundAmount) || 0,
    currency:       order.paymentInfo?.currency || 'USD',
    items: (order.orderItems || []).map((item, index) => ({
      item_id:   item.product?.toString() || `item_${index}`,
      item_name: item.name,
      price:     Number(item.price),
      quantity:  Number(item.quantity),
    })),
  }, context);
};

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

/**
 * checkGA4Config
 *
 * Validates that GA4 environment variables are configured correctly.
 * Called by server.js on startup and by the observability controller.
 *
 * @returns {{ configured: boolean, missing: string[], productionEndpoint: string, debugEndpoint: string, dualSendInDev: boolean }}
 */
export const checkGA4Config = () => {
  const required = ['GA4_MEASUREMENT_ID', 'GA4_API_SECRET'];
  const missing  = required.filter(key => !process.env[key]);

  return {
    configured:         missing.length === 0,
    missing,
    productionEndpoint: PRODUCTION_ENDPOINT,
    debugEndpoint:      DEBUG_ENDPOINT,
    // In development: validates against debug endpoint then sends to production.
    // In production: sends to production endpoint only (no debug overhead).
    // Check GA4 → Reports → Realtime in both environments — not DebugView.
    dualSendInDev:      process.env.NODE_ENV !== 'production',
  };
};