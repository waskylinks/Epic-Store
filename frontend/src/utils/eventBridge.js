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
 */

import {
  generateEventId,
  buildClientAnalyticsPayload,
  getAttributionContext,
  ANALYTICS_EVENTS,
} from './analytics.js';

// ─── BACKEND ENDPOINT ─────────────────────────────────────────────────────────

// vite.config.js proxies /api → localhost:8000, no base URL needed
const ANALYTICS_ENDPOINT = '/api/v1/analytics/event';

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

    fetch(ANALYTICS_ENDPOINT, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(payload),
      keepalive:   true,   // survives page navigation
      credentials: 'include',
    }).catch(() => {
      // Silently swallow — analytics must never block or surface errors
    });
  } catch {
    // Catch payload build errors silently
  }
};

// ─── PURCHASE EVENT ───────────────────────────────────────────────────────────

/**
 * trackPurchase
 *
 * Fires the browser-side Purchase pixel using the SAME eventId that was
 * sent to the server in createOrder → verifyPaymentController.
 *
 * WHY: Meta CAPI and GA4 Measurement Protocol fire server-side after payment
 * verification. The browser pixel also fires (here). Both carry the same
 * eventId so the ad platform deduplicates them — you see one conversion,
 * not two. Without this the browser pixel event inflates reported ROAS.
 *
 * CALL SITE: orderSlice.js createOrder.fulfilled — pass the eventId that
 * was generated in createOrder's thunk body.
 *
 * @param {{ orderId: string, revenue: number, currency?: string, items?: Array }} orderData
 * @param {string} eventId - The UUID generated in createOrder (MUST match server)
 */
export const trackPurchase = (orderData, eventId) => {
  const id = eventId || generateEventId();

  // Meta Pixel — eventID here matches CAPI eventId → "Deduped" in Events Manager
  fireFbq('track', 'Purchase', {
    value:        orderData.revenue || 0,
    currency:     orderData.currency || 'USD',
    content_ids:  (orderData.items || []).map(i => i.productId || i._id).filter(Boolean),
    content_type: 'product',
    order_id:     orderData.orderId,
  }, id);

  // GA4 — deduplication uses transaction_id, not event_id
  fireGtag('purchase', {
    transaction_id: orderData.orderId,
    value:          orderData.revenue || 0,
    currency:       orderData.currency || 'USD',
    items:          (orderData.items || []).map(item => ({
      item_id:   item.productId || item._id,
      item_name: item.name,
      price:     item.price,
      quantity:  item.quantity || 1,
    })),
  });

  // Also send to our own ingestion endpoint for BigQuery
  sendEvent(ANALYTICS_EVENTS.PURCHASE || 'purchase', {
    order_id:  orderData.orderId,
    revenue:   orderData.revenue,
    currency:  orderData.currency || 'USD',
    item_count: (orderData.items || []).length,
  }, id);
};

// ─── CHECKOUT FUNNEL EVENTS ───────────────────────────────────────────────────

/**
 * trackBeginCheckout
 *
 * Fires when the user first opens the checkout flow (cart → shipping step).
 * Generates a shared eventId used by both browser pixel and server.
 *
 * @param {Object} cartContext - { cartValue, itemCount, hasDiscount, items }
 * @param {string} [eventId]   - Pass the eventId from createCheckoutSession if available
 * @returns {string} eventId   - Returns the UUID so the caller can attach it to the session
 */
export const trackBeginCheckout = (cartContext = {}, eventId) => {
  const id = eventId || generateEventId();

  // Meta Pixel
  fireFbq('track', 'InitiateCheckout', {
    value:        cartContext.cartValue || 0,
    currency:     'USD',
    num_items:    cartContext.itemCount || 0,
    content_ids:  (cartContext.items || []).map(i => i.productId || i._id).filter(Boolean),
    content_type: 'product',
  }, id);

  // GA4
  fireGtag('begin_checkout', {
    currency: 'USD',
    value:    cartContext.cartValue || 0,
    items:    (cartContext.items || []).map(item => ({
      item_id:   item.productId || item._id,
      item_name: item.name,
      price:     item.price,
      quantity:  item.quantity || 1,
    })),
  });

  // Server ingestion
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
 * @param {string} step        - Checkout step name
 * @param {Object} cartContext - { cartValue, itemCount, hasDiscount }
 * @param {string} [eventId]   - Optional dedup UUID
 */
export const trackCheckoutStep = (step, cartContext = {}, eventId) => {
  const id = eventId || generateEventId();

  // Meta tracks payment info entry as a standard event
  if (step === 'payment_selection' || step === 'payment_gateway') {
    fireFbq('track', 'AddPaymentInfo', {
      value:    cartContext.cartValue || 0,
      currency: 'USD',
    }, id);
  }

  // GA4 checkout progress
  fireGtag('checkout_progress', {
    checkout_step: step,
    currency:      'USD',
    value:         cartContext.cartValue || 0,
  });

  // Server ingestion
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
 * Fire when a user views a product detail page.
 *
 * @param {{ productId: string, name: string, price: number, category?: string }} product
 */
export const trackProductView = (product) => {
  const id = generateEventId();

  fireFbq('track', 'ViewContent', {
    value:        product.price || 0,
    currency:     'USD',
    content_ids:  [product.productId || product._id].filter(Boolean),
    content_type: 'product',
    content_name: product.name,
  }, id);

  fireGtag('view_item', {
    currency: 'USD',
    value:    product.price || 0,
    items:    [{
      item_id:       product.productId || product._id,
      item_name:     product.name,
      item_category: product.category || '',
      price:         product.price || 0,
    }],
  });

  sendEvent(ANALYTICS_EVENTS.PRODUCT_VIEW, {
    product_id: product.productId || product._id,
    name:       product.name,
    price:      product.price,
    category:   product.category || null,
  }, id);
};

/**
 * trackAddToCart
 *
 * Fire when a user adds an item to their cart.
 *
 * @param {{ productId: string, name: string, price: number, quantity: number }} item
 */
export const trackAddToCart = (item) => {
  const id = generateEventId();

  fireFbq('track', 'AddToCart', {
    value:        (item.price || 0) * (item.quantity || 1),
    currency:     'USD',
    content_ids:  [item.productId || item._id].filter(Boolean),
    content_type: 'product',
    content_name: item.name,
  }, id);

  fireGtag('add_to_cart', {
    currency: 'USD',
    value:    (item.price || 0) * (item.quantity || 1),
    items:    [{
      item_id:   item.productId || item._id,
      item_name: item.name,
      price:     item.price,
      quantity:  item.quantity || 1,
    }],
  });

  sendEvent(ANALYTICS_EVENTS.ADD_TO_CART, {
    product_id: item.productId || item._id,
    name:       item.name,
    price:      item.price,
    quantity:   item.quantity || 1,
  }, id);
};

/**
 * trackRemoveFromCart
 *
 * Fire when a user removes an item from their cart.
 *
 * @param {{ productId: string, name: string, price: number }} item
 */
export const trackRemoveFromCart = (item) => {
  const id = generateEventId();

  fireGtag('remove_from_cart', {
    currency: 'USD',
    value:    item.price || 0,
    items:    [{
      item_id:   item.productId || item._id,
      item_name: item.name,
      price:     item.price,
    }],
  });

  // Meta has no standard RemoveFromCart event — use custom
  fireFbq('trackCustom', 'RemoveFromCart', {
    content_ids:  [item.productId || item._id].filter(Boolean),
    content_name: item.name,
    value:        item.price || 0,
    currency:     'USD',
  }, id);

  sendEvent(ANALYTICS_EVENTS.REMOVE_FROM_CART, {
    product_id: item.productId || item._id,
    name:       item.name,
    price:      item.price,
  }, id);
};

// ─── SEARCH EVENT ─────────────────────────────────────────────────────────────

/**
 * trackSearch
 *
 * Fire when a user submits a search query.
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
 * Fire on route changes for SPA page view tracking.
 * Called automatically by App.jsx via initAnalytics() on mount.
 *
 * @param {string} [path] - URL path (defaults to window.location.pathname)
 */
export const trackPageView = (path) => {
  // No eventId needed — page views are not deduplicated server-side
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