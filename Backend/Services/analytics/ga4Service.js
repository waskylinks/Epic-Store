/**
 * backend/services/analytics/ga4Service.js
 *
 * Phase 4 — GA4 Measurement Protocol
 
 */

import axios from 'axios';

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

const PRODUCTION_ENDPOINT =
  process.env.GA4_ENDPOINT       || 'https://www.google-analytics.com/mp/collect';

const DEBUG_ENDPOINT =
  process.env.GA4_DEBUG_ENDPOINT || 'https://www.google-analytics.com/debug/mp/collect';

// ─── PAYLOAD BUILDER ─────────────────────────────────────────────────────────

const buildGA4Payload = ({ clientId, userId, sessionId, eventName, eventParams }) => {
  const payload = {
    client_id: clientId || sessionId || `server_${Date.now()}`,
    ...(userId && { user_id: userId }),
    events: [
      {
        name:   eventName,
        params: {
          ...eventParams,
          ...(sessionId && { session_id: sessionId }),
          engagement_time_msec: 1,
          ...(process.env.NODE_ENV !== 'production' && { debug_mode: 1 }),
        },
      },
    ],
  };

  return payload;
};

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

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
        console.warn(
          `[GA4] Validation issues for "${eventName}" event:`,
          JSON.stringify(debugResponse.data.validationMessages, null, 2)
        );
      } else {
        console.debug(`[GA4] Payload validation passed for event: "${eventName}"`);
      }
    } catch (debugErr) {
      console.warn(
        `[GA4] Debug validation request failed (non-fatal): ${debugErr.message}`
      );
    }
  }

  const response = await axios.post(
    `${PRODUCTION_ENDPOINT}?${queryParams}`,
    payload,
    { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
  );

  return {
    success:            true,
    statusCode:         response.status,
    validationMessages: [],
    eventName,
    eventId:            eventId || null,
    sentAt:             new Date().toISOString(),
  };
};

// ─── PURCHASE EVENT ───────────────────────────────────────────────────────────

export const sendGA4Purchase = async (order, context = {}) => {
  const { clientId, userId, sessionId, eventId } = context;

  const items = (order.orderItems || []).map((item, index) => ({
    item_id:       (item.product?._id || item.product)?.toString() || `item_${index}`,
    item_name:     item.name     || 'Unknown Product',
    item_category: item.category || 'uncategorized',
    price:         Number(item.price)    || 0,
    quantity:      Number(item.quantity) || 1,
    index,
  }));

  const eventParams = {
    transaction_id: order.paymentInfo?.reference || order._id?.toString(),
    value:          Number(order.totalPrice)      || 0,
    currency:       order.paymentInfo?.currency   || 'USD',
    tax:            Number(order.taxPrice)        || 0,
    shipping:       Number(order.shippingPrice)   || 0,
    items,
    ...(order.discounts?.codes?.[0]?.code && {
      coupon: order.discounts.codes[0].code,
    }),
    attribution_confidence:    context.attribution?.confidenceLevel    || 'UNKNOWN',
    attribution_reconstructed: context.attribution?.isReconstructed    || false,
    attribution_source:        context.attribution?.source             || 'direct',
    is_first_purchase: order.analytics?.isFirstPurchase || false,
    purchase_number:   order.analytics?.purchaseNumber  || null,
    payment_method:    order.paymentInfo?.method         || 'unknown',
    item_count:        items.length,
  };

  return sendGA4Event('purchase', eventParams, { clientId, userId, sessionId, eventId });
};

// ─── CHECKOUT STEP EVENT ──────────────────────────────────────────────────────

export const sendGA4CheckoutStep = async (step, checkout, context = {}) => {
  const GA4_STEP_MAP = {
    shipping_info:      'begin_checkout',
    payment_selection:  'add_payment_info',
    cart:               'begin_checkout',
  };

  const eventName = GA4_STEP_MAP[step];
  
  if (!eventName) {
    return {
      success: true,
      skipped: true,
      reason: `no_ga4_mapping_for_step_${step}`
    };
  }

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

// ─── ADD TO WISHLIST EVENT ────────────────────────────────────────────────────

/**
 * sendGA4AddToWishlist
 * Sends a GA4 `add_to_wishlist` event when a user adds a product
 * to their wishlist. Maps to the GA4 recommended `add_to_wishlist` event:
 * https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events#add_to_wishlist
 *
 * value is the unit price of the single product (quantity is always 1 for
 * wishlist adds — users add products, not quantities, to wishlists).
 *
 * @param {Object} product  - Product document
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4AddToWishlist = async (product, context = {}) => {
  const price = product.pricing?.sale || product.pricing?.regular || product.price || 0;

  return sendGA4Event('add_to_wishlist', {
    currency: 'USD',
    value:    Number(price),
    items: [{
      item_id:       product._id?.toString(),
      item_name:     product.name,
      item_category: product.category || 'uncategorized',
      price:         Number(price),
      quantity:      1,
    }],
  }, context);
};

// ─── LOGIN EVENT ──────────────────────────────────────────────────────────────

export const sendGA4Login = async (method = 'email', context = {}) => {
  return sendGA4Event('login', { method }, context);
};

// ─── SIGN UP EVENT ────────────────────────────────────────────────────────────

export const sendGA4SignUp = async (method = 'email', context = {}) => {
  return sendGA4Event('sign_up', { method }, context);
};

// ─── REFUND EVENT ─────────────────────────────────────────────────────────────

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

export const checkGA4Config = () => {
  const required = ['GA4_MEASUREMENT_ID', 'GA4_API_SECRET'];
  const missing  = required.filter(key => !process.env[key]);

  return {
    configured:         missing.length === 0,
    missing,
    productionEndpoint: PRODUCTION_ENDPOINT,
    debugEndpoint:      DEBUG_ENDPOINT,
    dualSendInDev:      process.env.NODE_ENV !== 'production',
  };
};