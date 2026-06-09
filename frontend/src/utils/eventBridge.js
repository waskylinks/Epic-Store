/**
 * frontend/src/utils/eventBridge.js
 *
 * Client-Side Event Bridge
 *
 * FIXES APPLIED IN THIS VERSION:
 *
 *   [FIX] trackCheckoutStep signature updated. The third parameter is now an
 *         optional `eventId` that callers can pass to share the same UUID with
 *         the server CAPI event. Previously the function always generated its
 *         own UUID internally, so the browser AddPaymentInfo pixel and the
 *         server CAPI AddPaymentInfo event always had different event_ids —
 *         Meta could not deduplicate them and counted two AddPaymentInfo events
 *         per checkout. The fix enables deduplication when the same UUID
 *         is sent to the backend (via req.body.analyticsEventId in
 *         checkoutSlice.updateCheckoutStep) and passed here.
 *
 *         All other functions are unchanged.
 */

import {
  generateEventId,
  buildClientAnalyticsPayload,
  getAttributionContext,
  refreshSession,
  ANALYTICS_EVENTS,
} from './analytics.js';

// ─── BACKEND ENDPOINT ─────────────────────────────────────────────────────────

const ANALYTICS_ENDPOINT = '/api/v1/analytics/event';

// Maximum safe keepalive payload size (bytes). Chrome enforces 64 KB per origin;
// we use a conservative 48 KB threshold to leave headroom for headers.
const KEEPALIVE_SIZE_LIMIT = 48 * 1024;

// ─── ITEM ID NORMALIZER ───────────────────────────────────────────────────────

/**
 * normalizeItemId
 *
 * Extracts the product ID string from an item regardless of its shape.
 * Centralises the defensive fallback chain so it only exists in one place.
 *
 * Handles:
 *   - cartItems from Redux state:           { product: string }
 *   - orderItems before backend populate:   { product: ObjectId string }
 *   - orderItems after backend populate:    { product: { _id: string } }
 *   - product detail / search result shape: { productId, _id }
 *
 * @param {Object} item - Item from any known source shape
 * @returns {string|null}
 */
const normalizeItemId = (item) => {
  if (!item) return null;
  if (item.product?._id) return item.product._id.toString();
  if (item.product)      return item.product.toString();
  if (item.productId)    return item.productId.toString();
  if (item._id)          return item._id.toString();
  return null;
};

// ─── PIXEL HELPERS ────────────────────────────────────────────────────────────

/**
 * fireFbq
 * Safe wrapper for Meta Pixel — no-ops silently if fbq is not loaded.
 *
 * @param {string} trackType  - 'track' | 'trackCustom'
 * @param {string} eventName  - Standard or custom event name
 * @param {Object} params     - Event parameters
 * @param {string} eventId    - Deduplication UUID (must match server CAPI call)
 */
const fireFbq = (trackType, eventName, params = {}, eventId) => {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq(trackType, eventName, params, { eventID: eventId });
    }
  } catch {
    // Never surface pixel errors to users
  }
};

/**
 * fireGtag
 * Safe wrapper for Google gtag — no-ops silently if gtag is not loaded.
 *
 * @param {string} eventName - GA4 event name
 * @param {Object} params    - Event parameters
 */
const fireGtag = (eventName, params = {}) => {
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
  } catch {
    // Never surface pixel errors to users
  }
};

// ─── CORE SENDER ──────────────────────────────────────────────────────────────

/**
 * sendEvent
 *
 * Sends a client-side analytics event to the backend ingestion endpoint.
 * Fire-and-forget — never throws, never blocks the caller.
 *
 * @param {string} eventType   - Event type from ANALYTICS_EVENTS
 * @param {Object} properties  - Event-specific properties
 * @param {string} [eventId]   - Optional dedup UUID (generated if not provided)
 * @param {Object} [overrides] - Optional payload overrides
 */
const sendEvent = (eventType, properties = {}, eventId, overrides = {}) => {
  try {
    const id          = eventId || generateEventId();
    const attribution = getAttributionContext();
    const payload     = buildClientAnalyticsPayload({
      eventType,
      properties,
      attribution,
      analyticsEventId: id,
      ...overrides,
    });

    const body         = JSON.stringify(payload);
    const useKeepalive = new Blob([body]).size <= KEEPALIVE_SIZE_LIMIT;

    fetch(ANALYTICS_ENDPOINT, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body,
      keepalive:   useKeepalive,
      credentials: 'include',
    }).catch(() => {});
  } catch {
    // Catch payload build errors silently
  }
};

// ─── PURCHASE EVENT ───────────────────────────────────────────────────────────

/**
 * trackPurchase
 *
 * Fires the browser-side Purchase pixel using the SAME eventId that was
 * sent to the server in verifyPaymentController.
 *
 * @param {{ orderId: string, revenue: number, currency?: string, items?: Array }} orderData
 * @param {string} eventId - The UUID generated in verifyPayment thunk (MUST match server)
 */
export const trackPurchase = (orderData, eventId) => {
  const id = eventId || generateEventId();

  fireFbq('track', 'Purchase', {
    value:        orderData.revenue || 0,
    currency:     orderData.currency || 'USD',
    content_ids:  (orderData.items || []).map(normalizeItemId).filter(Boolean),
    content_type: 'product',
    order_id:     orderData.orderId,
  }, id);

  fireGtag('purchase', {
    transaction_id: orderData.orderId,
    value:          orderData.revenue || 0,
    currency:       orderData.currency || 'USD',
    items:          (orderData.items || []).map((item, index) => ({
      item_id:   normalizeItemId(item) || `item_${index}`,
      item_name: item.name || 'Product',
      price:     item.price || 0,
      quantity:  item.quantity || 1,
    })),
  });

  refreshSession();

  sendEvent(ANALYTICS_EVENTS.PURCHASE || 'purchase', {
    order_id:   orderData.orderId,
    revenue:    orderData.revenue,
    currency:   orderData.currency || 'USD',
    item_count: (orderData.items || []).length,
  }, id);
};

// ─── CHECKOUT FUNNEL EVENTS ───────────────────────────────────────────────────

/**
 * trackBeginCheckout
 *
 * Fires when the user first opens the checkout flow (cart → shipping step).
 *
 * @param {Object} cartContext - { cartValue, itemCount, hasDiscount, items }
 * @param {string} [eventId]   - Pass the eventId from createCheckoutSession if available
 * @returns {string} eventId
 */
export const trackBeginCheckout = (cartContext = {}, eventId) => {
  const id = eventId || generateEventId();

  fireFbq('track', 'InitiateCheckout', {
    value:        cartContext.cartValue || 0,
    currency:     'USD',
    num_items:    cartContext.itemCount || 0,
    content_ids:  (cartContext.items || []).map(normalizeItemId).filter(Boolean),
    content_type: 'product',
  }, id);

  fireGtag('begin_checkout', {
    currency: 'USD',
    value:    cartContext.cartValue || 0,
    items:    (cartContext.items || []).map((item, index) => ({
      item_id:   normalizeItemId(item) || `item_${index}`,
      item_name: item.name,
      price:     item.price,
      quantity:  item.quantity || 1,
    })),
  });

  refreshSession();

  sendEvent(ANALYTICS_EVENTS.CHECKOUT_STEP || 'checkout_step', {
    step:         'cart',
    cart_value:   cartContext.cartValue  || null,
    item_count:   cartContext.itemCount  ?? null,
    has_discount: cartContext.hasDiscount ?? false,
  }, id);

  return id;
};

/**
 * trackCheckoutStep
 *
 * Fire when a user enters a checkout step.
 * Steps: "shipping_info" | "payment_selection" | "payment_gateway"
 *

 *
 * [RETAINED] AddPaymentInfo fires only on payment_selection, not on
 * payment_gateway, to prevent double-counting the funnel metric.
 *
 * @param {string} step        - Checkout step name
 * @param {Object} cartContext - { cartValue, itemCount, hasDiscount }
 * @param {string} [eventId]   - Optional shared UUID from updateCheckoutStep thunk
 */
export const trackCheckoutStep = (step, cartContext = {}, eventId) => {
  const id = eventId || generateEventId();

  // [RETAINED] Fire AddPaymentInfo only on the first payment step, not on
  // every payment-related step. "payment_gateway" is a subsequent navigation
  // within the same payment intent — firing a second AddPaymentInfo there
  // causes Meta to count two payment events per checkout, inflating the
  // funnel metric.
  if (step === 'payment_selection') {
    fireFbq('track', 'AddPaymentInfo', {
      value:    cartContext.cartValue || 0,
      currency: 'USD',
    }, id);
  }

  fireGtag('checkout_progress', {
    checkout_step: step,
    currency:      'USD',
    value:         cartContext.cartValue || 0,
  });

  sendEvent(ANALYTICS_EVENTS.CHECKOUT_STEP || 'checkout_step', {
    step,
    cart_value:   cartContext.cartValue  || null,
    item_count:   cartContext.itemCount  ?? null,
    has_discount: cartContext.hasDiscount ?? false,
  }, id);
};

// ─── PRODUCT EVENTS ───────────────────────────────────────────────────────────

/**
 * trackProductView
 *
 * @param {{ productId: string, name: string, price: number, category?: string }} product
 */
export const trackProductView = (product) => {
  const id = generateEventId();

  fireFbq('track', 'ViewContent', {
    value:        product.price || 0,
    currency:     'USD',
    content_ids:  [normalizeItemId(product)].filter(Boolean),
    content_type: 'product',
    content_name: product.name,
  }, id);

  fireGtag('view_item', {
    currency: 'USD',
    value:    product.price || 0,
    items:    [{
      item_id:       normalizeItemId(product),
      item_name:     product.name,
      item_category: product.category || '',
      price:         product.price || 0,
    }],
  });

  sendEvent(ANALYTICS_EVENTS.PRODUCT_VIEW, {
    product_id: normalizeItemId(product),
    name:       product.name,
    price:      product.price,
    category:   product.category || null,
  }, id);
};

/**
 * trackAddToCart
 *
 * @param {{ productId: string, name: string, price: number, quantity: number }} item
 */
export const trackAddToCart = (item) => {
  const id = generateEventId();

  fireFbq('track', 'AddToCart', {
    value:        (item.price || 0) * (item.quantity || 1),
    currency:     'USD',
    content_ids:  [normalizeItemId(item)].filter(Boolean),
    content_type: 'product',
    content_name: item.name,
  }, id);

  fireGtag('add_to_cart', {
    currency: 'USD',
    value:    (item.price || 0) * (item.quantity || 1),
    items:    [{
      item_id:   normalizeItemId(item),
      item_name: item.name,
      price:     item.price,
      quantity:  item.quantity || 1,
    }],
  });

  sendEvent(ANALYTICS_EVENTS.ADD_TO_CART, {
    product_id: normalizeItemId(item),
    name:       item.name,
    price:      item.price,
    quantity:   item.quantity || 1,
  }, id);
};

/**
 * trackRemoveFromCart
 *
 * @param {{ productId: string, name: string, price: number }} item
 */
export const trackRemoveFromCart = (item) => {
  const id = generateEventId();

  fireGtag('remove_from_cart', {
    currency: 'USD',
    value:    item.price || 0,
    items:    [{
      item_id:   normalizeItemId(item),
      item_name: item.name,
      price:     item.price,
    }],
  });

  fireFbq('trackCustom', 'RemoveFromCart', {
    content_ids:  [normalizeItemId(item)].filter(Boolean),
    content_name: item.name,
    value:        item.price || 0,
    currency:     'USD',
  }, id);

  sendEvent(ANALYTICS_EVENTS.REMOVE_FROM_CART, {
    product_id: normalizeItemId(item),
    name:       item.name,
    price:      item.price,
  }, id);
};

// ─── SEARCH EVENT ─────────────────────────────────────────────────────────────

/**
 * trackSearch
 *
 * @param {string} query       - Search term
 * @param {number} resultCount - Number of results returned
 */
export const trackSearch = (query, resultCount = 0) => {
  const id = generateEventId();

  fireFbq('track', 'Search', {
    search_string: query,
  }, id);

  fireGtag('search', {
    search_term: query,
  });

  sendEvent(ANALYTICS_EVENTS.SEARCH || 'search', {
    search_term:  query,
    result_count: resultCount,
  }, id);
};

// ─── PAGE VIEW ────────────────────────────────────────────────────────────────

/**
 * trackPageView
 *
 * @param {string} [path] - URL path (defaults to window.location.pathname)
 */
export const trackPageView = (path) => {
  refreshSession();

  fireGtag('page_view', {
    page_path:  path || window.location.pathname,
    page_title: document.title,
  });

  sendEvent('page_view', {
    page_path:  path || window.location.pathname,
    page_title: document.title,
    referrer:   document.referrer || null,
  }, generateEventId());
};