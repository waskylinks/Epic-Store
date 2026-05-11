/**
 * backend/services/analytics/metaCapiService.js
 *
 * Phase 5 — Meta Conversions API (CAPI)
 *
 * Sends server-side events directly to Meta's Conversions API.
 * Works alongside (not instead of) the browser-side Meta Pixel.
 *
 * Why Meta CAPI matters:
 *   iOS 14+ App Tracking Transparency (ATT) severely limits browser pixel
 *   tracking for Meta ads. Users who deny tracking consent are invisible
 *   to the Meta Pixel. CAPI sends events server-side, bypassing ATT and
 *   recovering a significant portion of lost attribution.
 *
 *   Industry data: CAPI can recover 15-40% of iOS conversions that the
 *   browser pixel misses — directly impacting ROAS calculations and
 *   campaign optimization signals sent to Meta's ad algorithm.
 *
 * Deduplication with browser Pixel:
 *   Both the browser fbq('track', 'Purchase') event and this CAPI event
 *   must carry the same eventID (UUID from Phase 1 SDK). Meta deduplicates
 *   within a 48-hour window using this ID. Without matching eventIDs,
 *   purchases are double-counted — inflating ROAS and corrupting the
 *   ad algorithm's optimization signal.
 *
 * PII hashing requirement:
 *   Meta requires all personally identifiable information to be hashed
 *   with SHA-256 before sending. This is a legal requirement under Meta's
 *   data use policy and GDPR. The hash() function in this file handles
 *   normalization (lowercase, trim) before hashing.
 *
 * User data matching:
 *   Meta matches CAPI events to users using a combination of:
 *     em  (email)       — strongest signal, hash required
 *     ph  (phone)       — E.164 format, hash required
 *     fn  (first name)  — hash required
 *     ln  (last name)   — hash required
 *     fbp (_fbp cookie) — Meta browser ID, set by Pixel automatically
 *     fbc (_fbc cookie) — Meta click ID cookie (from fbclid param)
 *     external_id       — your internal user ID, hash required
 *
 *   More matching signals = higher match rate = better attribution.
 *   Always send as many as you have available.
 *
 * Environment variables required:
 *   META_PIXEL_ID        — Your Facebook Pixel ID
 *   META_ACCESS_TOKEN    — System user access token (never expires)
 *   META_CAPI_ENDPOINT   — https://graph.facebook.com/v18.0
 *   META_TEST_EVENT_CODE — Test event code (development only, remove in production)
 */

import crypto from 'crypto';
import axios  from 'axios';

// ─── PII HASHING ──────────────────────────────────────────────────────────────

/**
 * hash
 *
 * SHA-256 hashes a PII value after normalization.
 * Returns undefined (not null) for missing values so the field is
 * omitted from the payload entirely — Meta ignores undefined fields.
 *
 * Normalization rules per Meta documentation:
 *   - Lowercase
 *   - Trim leading/trailing whitespace
 *   - Phone: digits only, E.164 without the + prefix
 *
 * @param {string|null|undefined} value
 * @param {string} type - 'default' | 'phone' — controls normalization
 * @returns {string|undefined}
 */
const hash = (value, type = 'default') => {
  if (!value || typeof value !== 'string') return undefined;

  let normalized = value.trim().toLowerCase();

  if (type === 'phone') {
    // Strip all non-digit characters for phone number normalization
    normalized = normalized.replace(/\D/g, '');
  }

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
};

// ─── USER DATA BUILDER ────────────────────────────────────────────────────────

/**
 * buildUserData
 *
 * Constructs the Meta CAPI user_data object from available signals.
 * Only includes fields that have values — empty fields reduce match quality.
 *
 * Match rate is directly correlated with conversion attribution accuracy.
 * A match rate below 40% indicates insufficient user data is being sent.
 *
 * @param {Object} userData
 * @param {string} userData.email      - User email address
 * @param {string} userData.phone      - User phone number (any format)
 * @param {string} userData.firstName  - User first name
 * @param {string} userData.lastName   - User last name
 * @param {string} userData.userId     - Internal MongoDB user ID
 * @param {string} userData.fbp        - _fbp cookie value
 * @param {string} userData.fbc        - _fbc cookie value or fbclid
 * @param {string} userData.city       - City (from shipping info)
 * @param {string} userData.state      - State/region
 * @param {string} userData.country    - Country code (2-letter ISO)
 * @param {string} userData.zipCode    - Postal/zip code
 * @param {string} userData.clientIp   - Client IP address
 * @param {string} userData.userAgent  - Browser user agent
 * @returns {Object} Meta CAPI user_data object
 */
const buildUserData = (userData = {}) => {
  const {
    email, phone, firstName, lastName, userId,
    fbp, fbc, city, state, country, zipCode,
    clientIp, userAgent,
  } = userData;

  return {
    // Hashed PII — required fields for good match rate
    ...(email     && { em:  hash(email) }),
    ...(phone     && { ph:  hash(phone, 'phone') }),
    ...(firstName && { fn:  hash(firstName) }),
    ...(lastName  && { ln:  hash(lastName) }),
    ...(userId    && { external_id: hash(userId) }),

    // Hashed geographic data — improves match rate
    ...(city      && { ct:  hash(city) }),
    ...(state     && { st:  hash(state) }),
    ...(country   && { country: hash(country) }),
    ...(zipCode   && { zp:  hash(zipCode) }),

    // Un-hashed Meta cookies — sent as-is (already set by Meta infrastructure)
    ...(fbp       && { fbp }),
    ...(fbc       && { fbc }),

    // Un-hashed technical signals
    ...(clientIp  && { client_ip_address: clientIp }),
    ...(userAgent && { client_user_agent: userAgent }),
  };
};

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

/**
 * sendMetaEvent
 *
 * Sends a single event to the Meta Conversions API.
 * Throws on network failure, API error, or invalid credentials.
 *
 * The queue worker (Phase 8) catches these throws and handles retry.
 * Controllers must never call this directly — always go through the queue.
 *
 * @param {string} eventName     - Meta standard event name (e.g. "Purchase")
 * @param {Object} userData      - PII data for user matching
 * @param {Object} customData    - Event-specific data (value, currency, etc.)
 * @param {Object} context       - Request context
 * @param {string} context.eventId        - UUID for deduplication with browser Pixel
 * @param {string} context.eventSourceUrl - URL where the event occurred
 * @param {string} context.actionSource   - "website" | "app" | "email"
 * @param {string} context.clientIp       - Client IP from req.ip
 * @param {string} context.userAgent      - User agent from req.headers
 * @returns {Promise<Object>}
 */
export const sendMetaEvent = async (eventName, userData, customData, context = {}) => {
  if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) {
    throw new Error('META_PIXEL_ID or META_ACCESS_TOKEN not configured');
  }

  const {
    eventId,
    eventSourceUrl,
    actionSource = 'website',
    clientIp,
    userAgent,
  } = context;

  const eventTime = Math.floor(Date.now() / 1000); // Unix timestamp (seconds)

  const payload = {
    data: [
      {
        event_name:       eventName,
        event_time:       eventTime,
        // eventID is the deduplication key — must match the browser fbq eventID
        // Meta deduplicates same eventID within 48 hours
        event_id:         eventId,
        event_source_url: eventSourceUrl || process.env.FRONTEND_URL,
        action_source:    actionSource,
        user_data: buildUserData({
          ...userData,
          clientIp,
          userAgent,
        }),
        custom_data: customData,
      },
    ],

    // Test event code — only present in development
    // Remove META_TEST_EVENT_CODE from production .env entirely
    ...(process.env.META_TEST_EVENT_CODE && {
      test_event_code: process.env.META_TEST_EVENT_CODE,
    }),
  };

  const url = `${process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0'}/${process.env.META_PIXEL_ID}/events`;

  const response = await axios.post(url, payload, {
    params:  { access_token: process.env.META_ACCESS_TOKEN },
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000, // Meta CAPI can be slower than GA4 — 8 second timeout
  });

  // Log any API-level errors returned in the response body
  if (response.data?.error) {
    throw new Error(`Meta CAPI error: ${JSON.stringify(response.data.error)}`);
  }

  return {
    success:       true,
    statusCode:    response.status,
    eventsReceived: response.data?.events_received || 0,
    fbtrace_id:    response.data?.fbtrace_id       || null,
    eventName,
    eventId:       eventId || null,
    sentAt:        new Date().toISOString(),
  };
};

// ─── PURCHASE EVENT ───────────────────────────────────────────────────────────

/**
 * sendMetaPurchase
 *
 * Sends a Meta CAPI `Purchase` event for a completed order.
 * This is the most critical CAPI event — it feeds Meta's conversion
 * attribution and campaign optimization algorithm (ROAS calculation).
 *
 * Maps to Meta's standard Purchase event:
 * https://developers.facebook.com/docs/meta-pixel/reference#standard-events
 *
 * @param {Object} order    - Mongoose Order document (post-save)
 * @param {Object} user     - Mongoose User document
 * @param {Object} context  - Analytics context from the event payload
 * @returns {Promise<Object>}
 */
export const sendMetaPurchase = async (order, user, context = {}) => {
  const {
    eventId,
    fbp,
    fbc,
    eventSourceUrl,
    clientIp,
    userAgent,
    attribution,
  } = context;

  // Build user data from authenticated user + shipping info + Meta cookies
  const userData = {
    email:     user.email,
    phone:     order.shippingInfo?.phoneNo,
    firstName: user.firstName,
    lastName:  user.lastName,
    userId:    user._id?.toString(),
    fbp,
    // fbc comes from _fbc cookie (set by Pixel on fbclid landing)
    // or fallback to fbclid stored in attribution (from Phase 3)
    fbc:       fbc || attribution?.fbclid,
    // Geographic data from shipping info improves match rate
    city:      order.shippingInfo?.city,
    state:     order.shippingInfo?.state,
    country:   order.shippingInfo?.country,
    zipCode:   order.shippingInfo?.pinCode,
    clientIp,
    userAgent,
  };

  // content_ids and contents are required for Meta catalogue matching
  const contentIds = (order.orderItems || []).map(item =>
    item.product?.toString() || 'unknown'
  );

  const contents = (order.orderItems || []).map(item => ({
    id:         item.product?.toString() || 'unknown',
    quantity:   Number(item.quantity)   || 1,
    item_price: Number(item.price)      || 0,
  }));

  const customData = {
    // Required Meta purchase parameters
    value:        Number(order.totalPrice) || 0,
    currency:     order.paymentInfo?.currency || 'USD',
    content_ids:  contentIds,
    contents,
    content_type: 'product',
    num_items:    order.orderItems?.length || 0,

    // Order reference for cross-platform reconciliation
    order_id:     order.paymentInfo?.reference || order._id?.toString(),

    // Discount information
    ...(order.discounts?.codes?.[0]?.code && {
      coupon_code: order.discounts.codes[0].code,
    }),

    // Attribution quality metadata
    attribution_confidence: attribution?.confidenceLevel || 'UNKNOWN',
  };

  return sendMetaEvent('Purchase', userData, customData, {
    eventId,
    eventSourceUrl,
    actionSource: 'website',
    clientIp,
    userAgent,
  });
};

// ─── INITIATE CHECKOUT EVENT ──────────────────────────────────────────────────

/**
 * sendMetaInitiateCheckout
 *
 * Sends a Meta CAPI `InitiateCheckout` event when a checkout session starts.
 * Used by Meta's campaign optimization to identify high-intent users.
 *
 * @param {Object} checkout - Checkout document
 * @param {Object} user     - User document (may be null for guest)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaInitiateCheckout = async (checkout, user, context = {}) => {
  const userData = {
    email:     user?.email,
    firstName: user?.firstName,
    lastName:  user?.lastName,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       context.fbc || context.attribution?.fbclid,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const contentIds = (checkout.items || []).map(item =>
    item.product?.toString() || 'unknown'
  );

  const customData = {
    value:       Number(checkout.pricing?.totalPrice) || 0,
    currency:    checkout.pricing?.currency || 'USD',
    content_ids: contentIds,
    content_type: 'product',
    num_items:   checkout.items?.length || 0,
  };

  return sendMetaEvent('InitiateCheckout', userData, customData, context);
};

// ─── ADD TO CART EVENT ────────────────────────────────────────────────────────

/**
 * sendMetaAddToCart
 *
 * Sends a Meta CAPI `AddToCart` event.
 * Feeds Meta's retargeting audiences (abandoned cart campaigns).
 *
 * @param {Object} product  - Product document
 * @param {number} quantity - Quantity added
 * @param {Object} user     - User document (may be null for anonymous)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaAddToCart = async (product, quantity, user, context = {}) => {
  const price = product.pricing?.sale || product.pricing?.regular || product.price || 0;

  const userData = {
    email:     user?.email,
    firstName: user?.firstName,
    lastName:  user?.lastName,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       context.fbc || context.attribution?.fbclid,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const customData = {
    value:        Number(price) * Number(quantity),
    currency:     'USD',
    content_ids:  [product._id?.toString()],
    content_name: product.name,
    content_type: 'product',
    contents: [{
      id:         product._id?.toString(),
      quantity:   Number(quantity),
      item_price: Number(price),
    }],
  };

  return sendMetaEvent('AddToCart', userData, customData, context);
};

// ─── VIEW CONTENT EVENT ───────────────────────────────────────────────────────

/**
 * sendMetaViewContent
 *
 * Sends a Meta CAPI `ViewContent` event for product page views.
 * Feeds Meta's interest-based retargeting and lookalike audiences.
 *
 * @param {Object} product  - Product document
 * @param {Object} user     - User document (may be null for anonymous)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaViewContent = async (product, user, context = {}) => {
  const price = product.pricing?.sale || product.pricing?.regular || product.price || 0;

  const userData = {
    email:     user?.email,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       context.fbc || context.attribution?.fbclid,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const customData = {
    value:        Number(price),
    currency:     'USD',
    content_ids:  [product._id?.toString()],
    content_name: product.name,
    content_type: 'product',
    content_category: product.category || 'uncategorized',
  };

  return sendMetaEvent('ViewContent', userData, customData, context);
};

// ─── COMPLETE REGISTRATION EVENT ──────────────────────────────────────────────

/**
 * sendMetaCompleteRegistration
 *
 * Sends a Meta CAPI `CompleteRegistration` event after email verification.
 * Used for measuring acquisition cost per registered user.
 *
 * @param {Object} user     - Newly registered and verified user
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaCompleteRegistration = async (user, context = {}) => {
  const userData = {
    email:     user.email,
    firstName: user.firstName,
    lastName:  user.lastName,
    userId:    user._id?.toString(),
    fbp:       context.fbp,
    fbc:       context.fbc || context.attribution?.fbclid,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  return sendMetaEvent('CompleteRegistration', userData, {
    status: true,
    currency: 'USD',
    value: 0,
  }, context);
};

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

/**
 * checkMetaConfig
 *
 * Validates that Meta CAPI environment variables are configured.
 * Called by server.js on startup and by the observability controller.
 *
 * @returns {{ configured: boolean, missing: string[], testMode: boolean }}
 */
export const checkMetaConfig = () => {
  const required = ['META_PIXEL_ID', 'META_ACCESS_TOKEN'];
  const missing  = required.filter(key => !process.env[key]);

  return {
    configured: missing.length === 0,
    missing,
    testMode:   !!process.env.META_TEST_EVENT_CODE,
    pixelId:    process.env.META_PIXEL_ID ? `${process.env.META_PIXEL_ID.slice(0, 4)}****` : null,
    endpoint:   process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0',
  };
};