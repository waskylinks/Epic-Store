/**
 * frontend/src/utils/eventBridge.js
 *
 * Client-Side Event Bridge
 *
 * Provides a unified API for firing analytics events from React components.
 * Wraps the analytics.js SDK and adds Redux-aware context enrichment.
 *
 * WHY THIS EXISTS:
 *   The analytics.js SDK (Phase 1) is framework-agnostic — it builds event
 *   payloads but does not know about Redux state or the React component tree.
 *   This bridge connects the SDK to Redux (for user/session context) and
 *   sends events to the backend ingestion endpoint.
 *
 * DEDUPLICATION:
 *   Every event that has a server-side counterpart (purchase, begin_checkout,
 *   add_to_cart) generates a UUID via generateEventId(). The same UUID is:
 *     1. Passed to fbq() as eventID — Meta matches browser + CAPI events and
 *        shows "Deduped" in Events Manager, preventing double-counting.
 *     2. Sent to the backend as analyticsEventId — the server passes it to
 *        GA4 Measurement Protocol and Meta CAPI via analyticsOrchestrator.
 *   GA4 deduplication uses transaction_id (orderId), not event_id.
 *
 * PIXEL SAFETY:
 *   All fbq() and gtag() calls are guarded with typeof checks — safe in
 *   environments where the pixels haven't loaded (SSR, test, ad-blocked).
 *
 * PURCHASE EVENTS:
 *   trackPurchase() fires the browser pixel client-side for deduplication.
 *   The server-side conversion event is fired in verifyPaymentController.js.
 *   Both carry the same eventId so Meta deduplicates them automatically.
 *
 * ORDER ID CONSISTENCY:
 *   The browser pixel and the server CAPI event MUST carry the same order_id.
 *   The server always uses order.paymentInfo.reference (ORD-xxx format).
 *   The browser pixel must also use paymentInfo.reference — never order._id
 *   (MongoDB ObjectId) which Meta cannot recognise and replaces with its own
 *   internal EII1|... identifier in Events Manager.
 *
 * ITEM SHAPE CONTRACT:
 *   Different callers pass items with different shapes. Rather than scattering
 *   defensive fallbacks across every tracker, normalizeItemId() centralises
 *   the extraction logic. Update it here if a new item shape is introduced.
 *
 *   Known shapes:
 *     cartItems (Redux):    { product: string, quantity, name, price }
 *     orderItems (server):  { product: ObjectId|PopulatedObject, name, price, quantity }
 *     product detail page:  { productId, _id, name, price, category }
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
 * FIX (trackBeginCheckout empty content_ids): The original extractor used
 * `i.productId || i._id`, which never matched cartItems whose ID lives on
 * the `product` field. Every InitiateCheckout pixel fired with empty
 * content_ids. This function handles all known shapes explicitly.
 *
 * FIX (trackPurchase fragility): The order in which fields are checked now
 * handles both the pre-populate shape (product: ObjectId string) and the
 * post-populate shape (product: { _id }) correctly and intentionally, rather
 * than by accident of the backend bug remaining unfixed.
 *
 * @param {Object} item - Item from any known source shape
 * @returns {string|null}
 */
const normalizeItemId = (item) => {
  if (!item) return null;
  // Populated orderItem: { product: { _id: '...' } }
  if (item.product?._id) return item.product._id.toString();
  // Raw cartItem or unpopulated orderItem: { product: '...' }
  if (item.product)      return item.product.toString();
  // Product detail / search result shapes
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
 * FIX (keepalive payload size limit): fetch keepalive has a hard 64 KB limit
 * per origin in Chrome. Payloads exceeding the limit are silently dropped —
 * no error, no retry. We now measure the serialised payload and fall back to
 * a normal (non-keepalive) fetch for large payloads so events are never lost.
 * The fallback fires synchronously from user-action context so it will still
 * complete on most navigation events, but keepalive is preferred for safety.
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

    const body      = JSON.stringify(payload);
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
 * CRITICAL — order_id must be the ORD-xxx payment reference, not the
 * MongoDB _id. The server CAPI event always uses order.paymentInfo.reference
 * as order_id. If the browser pixel sends a different value (e.g. the MongoDB
 * ObjectId), Meta receives two events with the same event_id but different
 * order_ids. Meta deduplicates on event_id correctly but then cannot reconcile
 * the order_id mismatch — it replaces the unrecognised value with its own
 * internal EII1|... identifier in Events Manager.
 *
 * Callers must pass orderData.orderId as order.paymentInfo.reference,
 * which is the ORD-xxx string written by verifyPaymentController.
 *
 * @param {{ orderId: string, revenue: number, currency?: string, items?: Array }} orderData
 * @param {string} eventId - The UUID generated in verifyPayment thunk (MUST match server)
 */
export const trackPurchase = (orderData, eventId) => {
  const id = eventId || generateEventId();

  // Meta Pixel — eventID here matches CAPI eventId → "Deduped" in Events Manager.
  // order_id MUST match what the server sends in sendMetaPurchase — both must
  // be the ORD-xxx reference so Meta can reconcile the two events cleanly.
  fireFbq('track', 'Purchase', {
    value:        orderData.revenue || 0,
    currency:     orderData.currency || 'USD',
    // FIX: use normalizeItemId() to handle both pre- and post-populate shapes.
    content_ids:  (orderData.items || []).map(normalizeItemId).filter(Boolean),
    content_type: 'product',
    // FIX: order_id must be the ORD-xxx payment reference — not the MongoDB _id.
    // Callers pass order.paymentInfo.reference from paymentSlice.fulfilled.
    order_id:     orderData.orderId,
  }, id);

  // GA4 — deduplication uses transaction_id, not event_id.
  // transaction_id also uses the ORD-xxx reference to match the server event.
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

  // Backend ingestion for BigQuery
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
    // FIX (empty content_ids): cartItems from Redux have shape { product: string }.
    // The original extractor `i.productId || i._id` never matched this shape, so
    // content_ids was always []. normalizeItemId() handles all known item shapes.
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
    item_count:   cartContext.itemCount  || null,
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
 * FIX (duplicate AddPaymentInfo): The original code fired AddPaymentInfo for
 * both "payment_selection" AND "payment_gateway". The checkout flow navigates
 * through both steps sequentially, so Meta received two AddPaymentInfo events
 * per checkout with different UUIDs — they cannot be deduplicated, inflating
 * that funnel metric. AddPaymentInfo now fires only on "payment_selection"
 * (the first time the user reaches the payment section), not again on
 * "payment_gateway" (the confirmation/gateway redirect step).
 *
 * @param {string} step        - Checkout step name
 * @param {Object} cartContext - { cartValue, itemCount, hasDiscount }
 * @param {string} [eventId]   - Optional dedup UUID
 */
export const trackCheckoutStep = (step, cartContext = {}, eventId) => {
  const id = eventId || generateEventId();

  // FIX: Fire AddPaymentInfo only on the first payment step, not on every
  // payment-related step. "payment_gateway" is a subsequent navigation within
  // the same payment intent — firing a second AddPaymentInfo there causes
  // Meta to count two payment events per checkout, inflating the funnel metric.
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
    item_count:   cartContext.itemCount  || null,
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
 * Page views are intentionally not deduplicated — each page view is a distinct
 * event and there is no server-side counterpart to deduplicate against. A fresh
 * UUID per call is correct behaviour. The eventId parameter pattern is omitted
 * here by design, consistent with GA4's own page_view model.
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