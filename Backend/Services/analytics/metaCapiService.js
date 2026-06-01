/**
 * backend/services/analytics/metaCapiService.js
 *
 * Phase 5 — Meta Conversions API (CAPI)
 *
 * FIXES APPLIED IN THIS VERSION:
 *
 *   [FIX 1] buildUserData now accepts dateOfBirth and fbLoginId.
 *           dateOfBirth is normalized to YYYYMMDD via formatDob() then hashed.
 *           fbLoginId (user.facebookId) is sent as plain fb_login_id — NOT hashed.
 *           Both improve Meta match quality for users with complete profiles.
 *
 *   [FIX 2] sendMetaAddToCart now pulls geographic data from user.shippingAddress
 *           and passes dateOfBirth and fbLoginId. Previously these were never
 *           forwarded for AddToCart events, leaving EMQ below purchase level.
 *
 *   [FIX 3] sendMetaInitiateCheckout now passes dateOfBirth, fbLoginId, and
 *           geographic data. Prefers checkout.shippingInfo if already filled
 *           (user completed shipping step before checkout was created),
 *           falls back to user.shippingAddress from saved profile.
 *
 *   [FIX 4] sendMetaPurchase now passes dateOfBirth and fbLoginId alongside
 *           the existing shipping geo data which was already correct.
 *
 *   [FIX 5] resolveFbc is the single canonical fbc resolution chain used by
 *           all senders. verifyPaymentController imports formatFbc from here
 *           rather than maintaining a local copy.
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
  if (fbclid.startsWith('fb.1.')) return fbclid;
  const timestampSeconds = Math.floor(Date.now() / 1000);
  return `fb.1.${timestampSeconds}.${fbclid}`;
};

/**
 * resolveFbc
 *
 * Resolves the correct fbc value from a context object using a defined
 * priority chain. Centralises the fallback logic so callers don't need
 * to reproduce it inline.
 *
 * Priority:
 *   1. context.fbc          — already-formatted value from _fbc cookie (most reliable)
 *   2. context.fbclid       — raw click ID on context, needs formatting
 *   3. attribution.fbclid   — raw click ID from Phase 3 attribution middleware
 *
 * Returns null if no fbclid signal is available — never fabricates a value.
 *
 * @param {Object} context - Analytics context
 * @returns {string|null}
 */
export const resolveFbc = (context = {}) => {
  if (context.fbc)                 return context.fbc;
  if (context.fbclid)              return formatFbc(context.fbclid);
  if (context.attribution?.fbclid) return formatFbc(context.attribution.fbclid);
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
 * @param {string|null|undefined} value
 * @param {string} type - 'default' | 'phone'
 * @returns {string|undefined}
 */
const hash = (value, type = 'default') => {
  if (!value || typeof value !== 'string') return undefined;

  let normalized = value.trim().toLowerCase();

  if (type === 'phone') {
    normalized = normalized.replace(/\D/g, '');
  }

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
};

// ─── DOB FORMATTER ────────────────────────────────────────────────────────────

/**
 * formatDob
 *
 * Normalizes a date of birth value to YYYYMMDD string before hashing.
 * Meta requires the db field to be hashed YYYYMMDD format.
 * Accepts a Date object, ISO string, or any value parseable by new Date().
 *
 * @param {Date|string|null|undefined} dob
 * @returns {string|undefined} YYYYMMDD string or undefined if unparseable
 */
const formatDob = (dob) => {
  if (!dob) return undefined;
  try {
    const d = new Date(dob);
    if (isNaN(d.getTime())) return undefined;
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  } catch {
    return undefined;
  }
};

// ─── PHONE FIELD RESOLVER ─────────────────────────────────────────────────────

/**
 * resolvePhone
 *
 * Resolves the phone number from a user object regardless of which field
 * name was used. req.user may be a full Mongoose document, a lean object,
 * or a JWT payload — field names vary across auth paths.
 *
 * @param {Object} user
 * @returns {string|null}
 */
const resolvePhone = (user) =>
  user?.phone || user?.phoneNo || user?.shippingInfo?.phoneNo || null;

// ─── USER DATA BUILDER ────────────────────────────────────────────────────────

/**
 * buildUserData
 *
 * Constructs the Meta CAPI user_data object from available signals.
 *
 * [FIX 1] Now accepts dateOfBirth and fbLoginId:
 *   - dateOfBirth is normalized to YYYYMMDD via formatDob() then hashed as `db`
 *   - fbLoginId (user.facebookId) is sent as plain `fb_login_id` — NOT hashed
 *     Meta requires fb_login_id to be the raw Facebook user ID string
 *
 * Critical: fbp, fbc, fb_login_id are NEVER hashed.
 * All other PII fields MUST be hashed with SHA-256.
 *
 * @param {Object} userData
 * @returns {Object} Meta CAPI user_data object
 */
const buildUserData = (userData = {}) => {
  const {
    email, phone, firstName, lastName, userId,
    fbp, fbc, city, state, country, zipCode,
    clientIp, userAgent,
    dateOfBirth,
    fbLoginId,
  } = userData;

  const dobFormatted = formatDob(dateOfBirth);

  return {
    // Hashed PII — required fields for good match rate
    ...(email       && { em:          hash(email) }),
    ...(phone       && { ph:          hash(phone, 'phone') }),
    ...(firstName   && { fn:          hash(firstName) }),
    ...(lastName    && { ln:          hash(lastName) }),
    ...(userId      && { external_id: hash(userId) }),

    // [FIX 1] Date of birth — hashed YYYYMMDD format per Meta spec
    ...(dobFormatted && { db:         hash(dobFormatted) }),

    // Hashed geographic data — improves match rate
    ...(city        && { ct:          hash(city) }),
    ...(state       && { st:          hash(state) }),
    ...(country     && { country:     hash(country) }),
    ...(zipCode     && { zp:          hash(zipCode) }),

    // Un-hashed Meta cookies — MUST be sent as-is
    ...(fbp         && { fbp }),
    ...(fbc         && { fbc }),

    // [FIX 1] Facebook Login ID — NOT hashed, plain Facebook user ID string
    // Only present when user authenticated via Facebook OAuth
    ...(fbLoginId   && { fb_login_id: fbLoginId }),

    // Un-hashed technical signals
    ...(clientIp    && { client_ip_address: clientIp }),
    ...(userAgent   && { client_user_agent: userAgent }),
  };
};

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

/**
 * sendMetaEvent
 *
 * Sends a single event to the Meta Conversions API.
 * Throws on network failure, API error, or invalid credentials.
 *
 * @param {string} eventName     - Meta standard event name
 * @param {Object} userData      - PII data for user matching
 * @param {Object} customData    - Event-specific data
 * @param {Object} context       - Request context
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

  const eventTime = Math.floor(Date.now() / 1000);

  const payload = {
    data: [
      {
        event_name:       eventName,
        event_time:       eventTime,
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
    ...(process.env.META_TEST_EVENT_CODE && {
      test_event_code: process.env.META_TEST_EVENT_CODE,
    }),
  };

  const endpoint = process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0';
  const url = `${endpoint}/${process.env.META_PIXEL_ID}/events`;

  const response = await axios.post(url, payload, {
    params:  { access_token: process.env.META_ACCESS_TOKEN },
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
  });

  if (response.data?.error) {
    throw new Error(`Meta CAPI error: ${JSON.stringify(response.data.error)}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      `[Meta CAPI] "${eventName}" sent successfully.`,
      process.env.META_TEST_EVENT_CODE
        ? `Check Test Events tab (code: ${process.env.META_TEST_EVENT_CODE})`
        : 'No test_event_code — check production Events Manager.',
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
 * [FIX 4] Now passes dateOfBirth and fbLoginId alongside existing signals.
 * Purchase already had the best geo coverage (from shippingInfo) — these
 * additions close the remaining EMQ gap vs InitiateCheckout.
 *
 * @param {Object} order    - Mongoose Order document
 * @param {Object} user     - Mongoose User document or JWT payload
 * @param {Object} context  - Analytics context
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

  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:       user.email,
    phone:       resolvePhone(user) || order.shippingInfo?.phoneNo,
    firstName:   user.firstName,
    lastName:    user.lastName,
    userId:      user._id?.toString(),
    // [FIX 4] New fields
    dateOfBirth: user?.dateOfBirth || null,
    fbLoginId:   user?.facebookId  || null,
    fbp,
    fbc:         resolvedFbc,
    // Purchase always has shipping info — most accurate geo available
    city:        order.shippingInfo?.city,
    state:       order.shippingInfo?.state,
    country:     order.shippingInfo?.country,
    zipCode:     order.shippingInfo?.pinCode,
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
 * [FIX 3] Now passes dateOfBirth, fbLoginId, and geographic data.
 * Geographic priority: checkout.shippingInfo (if already filled by user)
 * falls back to user.shippingAddress from saved profile.
 *
 * @param {Object} checkout - Checkout document
 * @param {Object} user     - User document
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaInitiateCheckout = async (checkout, user, context = {}) => {
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:       user?.email,
    phone:       resolvePhone(user),
    firstName:   user?.firstName,
    lastName:    user?.lastName,
    userId:      user?._id?.toString(),
    // [FIX 3] New fields
    dateOfBirth: user?.dateOfBirth || null,
    fbLoginId:   user?.facebookId  || null,
    // Prefer checkout shippingInfo if already filled, fall back to saved profile
    city:    checkout.shippingInfo?.city    || user?.shippingAddress?.city    || null,
    state:   checkout.shippingInfo?.state   || user?.shippingAddress?.state   || null,
    country: checkout.shippingInfo?.country || user?.shippingAddress?.country || null,
    zipCode: checkout.shippingInfo?.pinCode || user?.shippingAddress?.pinCode || null,
    fbp:     context.fbp,
    fbc:     resolvedFbc,
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
 * [FIX 2] Now pulls geographic data from user.shippingAddress and passes
 * dateOfBirth and fbLoginId. The user argument must be the full User
 * document (not the lean JWT payload) — cartController fetches it explicitly.
 *
 * @param {Object} product  - Product document
 * @param {number} quantity - Quantity added
 * @param {Object} user     - Full User document (not lean JWT payload)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaAddToCart = async (product, quantity, user, context = {}) => {
  const price = product.pricing?.sale || product.pricing?.regular || product.price || 0;
  const resolvedFbc = resolveFbc(context);

  const userData = {
    email:       user?.email,
    phone:       resolvePhone(user),
    firstName:   user?.firstName,
    lastName:    user?.lastName,
    userId:      user?._id?.toString(),
    // [FIX 2] New fields — requires full user document in cartController
    dateOfBirth: user?.dateOfBirth || null,
    fbLoginId:   user?.facebookId  || null,
    city:        user?.shippingAddress?.city    || null,
    state:       user?.shippingAddress?.state   || null,
    country:     user?.shippingAddress?.country || null,
    zipCode:     user?.shippingAddress?.pinCode || null,
    fbp:         context.fbp,
    fbc:         resolvedFbc,
    clientIp:    context.clientIp,
    userAgent:   context.userAgent,
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
    pixelId:    process.env.META_PIXEL_ID
      ? `${process.env.META_PIXEL_ID.slice(0, 4)}****`
      : null,
    endpoint:   process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0',
  };
};