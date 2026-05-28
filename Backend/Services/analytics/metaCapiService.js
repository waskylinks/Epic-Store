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
 *   data use policy and GDPR. The hash() function handles normalization
 *   (lowercase, trim) before hashing.
 *
 * fbc / fbp parameter rules (per official Meta documentation):
 *   fbp — Meta browser ID set by the Pixel automatically. Format: fb.1.{timestamp}.{random}
 *         Send as-is from the _fbp cookie. NEVER hash.
 *   fbc — Meta click ID derived from fbclid URL param. Format: fb.1.{timestamp}.{fbclid}
 *         MUST follow this exact format. Passing a raw fbclid string causes a 400 error.
 *         Only set fbc when a real fbclid exists — never fabricate it.
 *         Send as-is. NEVER hash.
 *
 * fbc resolution — single source of truth:
 *   All fbc resolution (raw fbclid → formatted fbc) flows through formatFbc()
 *   exported from this file. verifyPaymentController and any other callers
 *   should import formatFbc from here rather than duplicating the implementation.
 *   This ensures the format fb.1.{seconds}.{fbclid} is applied consistently
 *   and future format changes only need to be made in one place.
 *
 * Development vs Production strategy:
 *   Development:
 *     - Include META_TEST_EVENT_CODE in payload so events appear in
 *       Meta Events Manager → Test Events tab instantly for validation.
 *     - Test events do NOT feed ad optimization or reporting.
 *     - Remove META_TEST_EVENT_CODE from production .env entirely.
 *
 *   Production:
 *     - No test_event_code — events feed real reporting and optimization.
 *     - Events appear in Events Manager → Overview within ~20 minutes.
 *
 * Environment variables required:
 *   META_PIXEL_ID        — Your Facebook Pixel ID (16-digit number)
 *   META_ACCESS_TOKEN    — System user access token (never expires)
 *   META_CAPI_ENDPOINT   — https://graph.facebook.com/v18.0 (optional, has default)
 *   META_TEST_EVENT_CODE — Test event code (development only, REMOVE in production .env)
 */

import crypto from 'crypto';
import axios  from 'axios';

// ─── FBC FORMATTER ────────────────────────────────────────────────────────────

/**
 * formatFbc
 *
 * Formats a raw fbclid value into the Meta-required fbc format.
 * Per Meta's official documentation, fbc MUST be: fb.1.{timestamp_seconds}.{fbclid}
 *
 * This is the single canonical implementation. All callers — including
 * verifyPaymentController.js — must import this rather than maintaining
 * a local copy. Duplicate implementations caused silent divergence risk:
 * any future format change would need to be made in multiple files.
 *
 * A raw fbclid string passed directly as fbc causes a 400 Bad Request.
 * The _fbc cookie (set by the Meta Pixel) already contains the formatted
 * value — use it directly when available. Only call this when you have
 * a raw fbclid that has not yet been formatted.
 *
 * @param {string} fbclid - Raw click ID from URL param or attribution
 * @returns {string|null} Formatted fbc string or null if fbclid is falsy
 */
export const formatFbc = (fbclid) => {
  if (!fbclid || typeof fbclid !== 'string') return null;
  // If it already looks like a properly formatted fbc, return as-is
  if (fbclid.startsWith('fb.1.')) return fbclid;
  // Format raw fbclid into fb.1.{timestamp_seconds}.{fbclid}
  const timestampSeconds = Math.floor(Date.now() / 1000);
  return `fb.1.${timestampSeconds}.${fbclid}`;
};

/**
 * resolveFbc
 *
 * Resolves the correct fbc value from a context object using a defined
 * priority chain. Centralises the fallback logic so callers don't need
 * to reproduce it inline — and so the chain is auditable in one place.
 *
 * Priority:
 *   1. context.fbc          — already-formatted value from _fbc cookie (most reliable)
 *   2. context.fbclid       — raw click ID on context, needs formatting
 *   3. attribution.fbclid   — raw click ID from Phase 3 attribution middleware
 *
 * Returns null if no fbclid signal is available — never fabricates a value.
 * A fabricated fbc causes a 400 from Meta and marks the event as failed.
 *
 * @param {Object} context - Analytics context
 * @returns {string|null}
 */
export const resolveFbc = (context = {}) => {
  if (context.fbc)                    return context.fbc;
  if (context.fbclid)                 return formatFbc(context.fbclid);
  if (context.attribution?.fbclid)    return formatFbc(context.attribution.fbclid);
  return null;
};

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
 * Critical: fbp and fbc are NEVER hashed — they are sent as-is.
 * All other PII fields MUST be hashed with SHA-256.
 *
 * Phone field resolution:
 *   The User model stores phone as `phone` but auth middleware may expose
 *   the JWT payload with different field names. `resolvePhone` checks the
 *   known field variants in priority order so the hash is computed regardless
 *   of which auth path produced the user object — silently missing phone
 *   reduces Meta match rate.
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
 * @param {string} userData.fbp        - _fbp cookie value (NOT hashed)
 * @param {string} userData.fbc        - Already-formatted fbc value (NOT hashed)
 * @param {string} userData.city       - City (from shipping info)
 * @param {string} userData.state      - State/region
 * @param {string} userData.country    - Country code (2-letter ISO)
 * @param {string} userData.zipCode    - Postal/zip code
 * @param {string} userData.clientIp   - Client IP address (NOT hashed)
 * @param {string} userData.userAgent  - Browser user agent (NOT hashed)
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
    ...(city      && { ct:      hash(city) }),
    ...(state     && { st:      hash(state) }),
    ...(country   && { country: hash(country) }),
    ...(zipCode   && { zp:      hash(zipCode) }),

    // Un-hashed Meta cookies — MUST be sent as-is, hashing breaks matching
    ...(fbp       && { fbp }),
    ...(fbc       && { fbc }),

    // Un-hashed technical signals — hashing breaks these
    ...(clientIp  && { client_ip_address: clientIp }),
    ...(userAgent && { client_user_agent: userAgent }),
  };
};

// ─── PHONE FIELD RESOLVER ─────────────────────────────────────────────────────

/**
 * resolvePhone
 *
 * Resolves the phone number from a user object regardless of which field
 * name was used. req.user may be a full Mongoose document, a lean object,
 * or a JWT payload — field names vary across auth paths.
 *
 * Checked in priority order: phone → phoneNo → shippingInfo.phoneNo
 *
 * @param {Object} user
 * @returns {string|null}
 */
const resolvePhone = (user) =>
  user?.phone || user?.phoneNo || user?.shippingInfo?.phoneNo || null;

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

/**
 * sendMetaEvent
 *
 * Sends a single event to the Meta Conversions API.
 * Throws on network failure, API error, or invalid credentials.
 *
 * Development: includes test_event_code so events appear in Test Events tab.
 * Production: no test_event_code — events feed real reporting.
 *
 * The queue worker (Phase 6) catches these throws and handles retry.
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
        // event_id is the deduplication key — must match the browser fbq eventID.
        // Meta deduplicates same event_id within 48 hours.
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

    // Development: test_event_code routes events to Test Events tab in Events Manager.
    // This lets you validate payloads in real time without polluting production data.
    // Production: META_TEST_EVENT_CODE must NOT be set — test events don't feed
    // ad optimization or reporting, causing zero attributed conversions in Ads Manager.
    ...(process.env.META_TEST_EVENT_CODE && {
      test_event_code: process.env.META_TEST_EVENT_CODE,
    }),
  };

  const endpoint = process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0';
  const url = `${endpoint}/${process.env.META_PIXEL_ID}/events`;

  const response = await axios.post(url, payload, {
    params:  { access_token: process.env.META_ACCESS_TOKEN },
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000, // Meta CAPI can be slower than GA4 — 8 second timeout
  });

  // Log API-level errors returned in the response body
  if (response.data?.error) {
    throw new Error(`Meta CAPI error: ${JSON.stringify(response.data.error)}`);
  }

  // In development, log confirmation so you know the Test Events tab should show it
  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      `[Meta CAPI] "${eventName}" sent successfully.`,
      process.env.META_TEST_EVENT_CODE
        ? `Check Test Events tab in Events Manager (code: ${process.env.META_TEST_EVENT_CODE})`
        : 'No test_event_code set — check production Events Manager Overview.',
      { eventsReceived: response.data?.events_received, fbtrace_id: response.data?.fbtrace_id }
    );
  }

  return {
    success:        true,
    statusCode:     response.status,
    eventsReceived: response.data?.events_received || 0,
    fbtrace_id:     response.data?.fbtrace_id      || null,
    eventName,
    eventId:        eventId || null,
    sentAt:         new Date().toISOString(),
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
 * fbc resolution is delegated to resolveFbc() which applies a defined
 * priority chain in one place rather than inline fallback chains that
 * are hard to audit and can produce incorrectly-formatted values.
 *
 * @param {Object} order    - Mongoose Order document (post-save)
 * @param {Object} user     - Mongoose User document or JWT payload
 * @param {Object} context  - Analytics context from the event payload
 * @returns {Promise<Object>}
 */
export const sendMetaPurchase = async (order, user, context = {}) => {
  const {
    eventId,
    fbp,
    eventSourceUrl,
    clientIp,
    userAgent,
    attribution,
  } = context;

  // All fbc resolution goes through resolveFbc() — single auditable chain.
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:     user.email,
    // resolvePhone handles the field name variance between Mongoose documents,
    // lean objects, and JWT payloads — silent null previously reduced match rate.
    phone:     resolvePhone(user) || order.shippingInfo?.phoneNo,
    firstName: user.firstName,
    lastName:  user.lastName,
    userId:    user._id?.toString(),
    fbp,
    fbc:       resolvedFbc,
    city:      order.shippingInfo?.city,
    state:     order.shippingInfo?.state,
    country:   order.shippingInfo?.country,
    zipCode:   order.shippingInfo?.pinCode,
    clientIp,
    userAgent,
  };

  const contentIds = (order.orderItems || []).map(item => {
    const p = item.product;
    return (p?._id || p)?.toString() || 'unknown';
  });

  const contents = (order.orderItems || []).map(item => {
    const p = item.product;
    return {
      id:         (p?._id || p)?.toString() || 'unknown',
      quantity:   Number(item.quantity) || 1,
      item_price: Number(item.price)    || 0,
      title:      item.name             || 'Product',
    };
  });

  const customData = {
    value:        Number(order.totalPrice) || 0,
    currency:     order.paymentInfo?.currency || 'USD',
    content_ids:  contentIds,
    contents,
    content_type: 'product',
    num_items:    order.orderItems?.length || 0,

    // resolvedOrderReference is primary — explicitly stamped in verifyPaymentController
    // and survives serialization through both the fast path and queue path reliably.
    // Falls back to order.paymentInfo.reference if resolvedOrderReference is absent,
    // then to order._id as a last resort.
    order_id: context?.resolvedOrderReference?.startsWith('ORD-')
      ? context.resolvedOrderReference
      : order.paymentInfo?.reference?.startsWith('ORD-')
        ? order.paymentInfo.reference
        : order._id?.toString(),

    ...(order.discounts?.codes?.[0]?.code && {
      coupon_code: order.discounts.codes[0].code,
    }),

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
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:     user?.email,
    phone:     resolvePhone(user),
    firstName: user?.firstName,
    lastName:  user?.lastName,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const contentIds = (checkout.items || []).map(item =>
    item.product?.toString() || 'unknown'
  );

  const customData = {
    value:        Number(checkout.pricing?.totalPrice) || 0,
    currency:     checkout.pricing?.currency || 'USD',
    content_ids:  contentIds,
    content_type: 'product',
    num_items:    checkout.items?.length || 0,
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
 * Called from cartController as:
 *   sendMetaAddToCart(product, quantity, req.user, analyticsContext)
 *
 * req.user may be a Mongoose document, a lean object, or a JWT payload —
 * phone field name varies across these. resolvePhone() handles all variants.
 *
 * @param {Object} product  - Product document
 * @param {number} quantity - Quantity added
 * @param {Object} user     - User document or JWT payload (may be null for anonymous)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaAddToCart = async (product, quantity, user, context = {}) => {
  const price = product.pricing?.sale || product.pricing?.regular || product.price || 0;
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:     user?.email,
    // resolvePhone covers phone, phoneNo, and shippingInfo.phoneNo variants —
    // a silent null here reduces Meta match rate for retargeting audiences.
    phone:     resolvePhone(user),
    firstName: user?.firstName,
    lastName:  user?.lastName,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
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
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:     user?.email,
    phone:     resolvePhone(user),
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const customData = {
    value:            Number(price),
    currency:         'USD',
    content_ids:      [product._id?.toString()],
    content_name:     product.name,
    content_type:     'product',
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
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:     user.email,
    firstName: user.firstName,
    lastName:  user.lastName,
    userId:    user._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  return sendMetaEvent('CompleteRegistration', userData, {
    status:   true,
    currency: 'USD',
    value:    0,
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
    // testMode: true in development (META_TEST_EVENT_CODE set).
    // Events in test mode appear in Events Manager → Test Events tab only.
    // They do NOT feed ad optimization — remove test_event_code for production.
    testMode:   !!process.env.META_TEST_EVENT_CODE,
    pixelId:    process.env.META_PIXEL_ID
      ? `${process.env.META_PIXEL_ID.slice(0, 4)}****`
      : null,
    endpoint:   process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0',
  };
};