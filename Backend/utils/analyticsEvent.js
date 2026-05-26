/**
 * backend/utils/analyticsEvent.js
 *
 * Phase 1 — Event Schema & UUID Strategy
 *
 * CHANGELOG (fixes applied):
 *   [FIX-1]  Deterministic hash fallback — timestamp is now required; no Date.now() default
 *   [FIX-2]  Schema version — changed from string '1.0' to integer 1 (matches queue model)
 *   [FIX-3]  Client timestamp — clamped & validated before use; future/malformed values dropped
 *   [FIX-4]  Event type — runtime validation against ANALYTICS_EVENTS on every buildAnalyticsEvent call
 *   [FIX-5]  Silent UUID fallback — logs a warning when client UUID is invalid before falling back
 *   [FIX-6]  Currency — throws if currency is missing instead of silently defaulting to USD
 *   [FIX-7]  item_category — omitted when empty instead of writing 'unknown' into GA4
 *   [FIX-8]  line_total — normalised with Number() guards to prevent NaN / string multiplication
 *   [FIX-9]  validateAnalyticsEvent — warnings separated from errors in the return shape
 *   [FIX-10] Attribution fields — truncated to safe lengths before storage
 *   [FIX-11] Circular reference protection — payload serialisation checked in builder
 *   [FIX-12] UUID validation — extended to accept v4, v7, and ULID to avoid silent dedup drift
 *   [FIX-13] source field on purchase / checkout — labelled as dispatch_source; origin_source added
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// ─── LOGGER INTERFACE ─────────────────────────────────────────────────────────
// Replace with your structured logger (pino, winston, etc.)

const logger = {
  warn:  (fields, msg) => console.warn({ ...fields, msg }),
  error: (fields, msg) => console.error({ ...fields, msg }),
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// Maximum lengths for attribution string fields (BigQuery cost + injection defence)
const ATTRIBUTION_MAX_LENGTHS = {
  source:   100,
  medium:   100,
  campaign: 200,
  referrer: 500,
  landingPage: 500,
  gclid:    500,
  fbclid:   500,
  ttclid:   500,
  reconstructionRule: 200,
  device:   100,
  browser:  100,
};

// Maximum milliseconds a client timestamp may differ from server time before being dropped.
// 5 minutes forward drift is tolerated (clock skew / NTP lag); past drift is unlimited.
const CLIENT_TIMESTAMP_MAX_FUTURE_MS = 5 * 60 * 1000;

// ─── UUID / ID VALIDATION ─────────────────────────────────────────────────────

/**
 * Validates that a string is a well-formed UUID v4, v7, ULID, or KSUID.
 *
 * [FIX-12] Original regex only accepted v4. If the frontend migrates to v7 or
 * ULID, events would silently fall back to hash IDs and break deduplication.
 * Now accepts the common identifier formats explicitly.
 *
 * @param {string} id
 * @returns {boolean}
 */
export const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;

  // UUID v4
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // UUID v7 (time-ordered)
  const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // ULID (26 Crockford base32 chars)
  const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
  // KSUID (27 base62 chars)
  const ksuid = /^[0-9A-Za-z]{27}$/;

  return v4.test(id) || v7.test(id) || ulid.test(id) || ksuid.test(id);
};

// ─── CLIENT TIMESTAMP VALIDATION ─────────────────────────────────────────────

/**
 * Validates and clamps an ISO client timestamp.
 *
 * [FIX-3] Previously the raw client string was trusted without any check.
 * A malicious or buggy client could submit "2099-01-01" and destroy funnel
 * reports. Rules applied:
 *   - Must parse to a finite Date
 *   - Must not be more than CLIENT_TIMESTAMP_MAX_FUTURE_MS ahead of server time
 *   - Returns null on any failure so the server timestamp is used instead
 *
 * @param {string|null} clientTimestamp  ISO string from the browser
 * @returns {string|null}                Validated ISO string or null
 */
export const validateClientTimestamp = (clientTimestamp) => {
  if (!clientTimestamp) return null;

  const parsed = new Date(clientTimestamp);

  if (!isFinite(parsed.getTime())) {
    logger.warn({ clientTimestamp }, '[Analytics] Client timestamp is not a valid date — dropped');
    return null;
  }

  if (parsed.getTime() > Date.now() + CLIENT_TIMESTAMP_MAX_FUTURE_MS) {
    logger.warn(
      { clientTimestamp, serverNow: new Date().toISOString() },
      '[Analytics] Client timestamp too far in the future — dropped'
    );
    return null;
  }

  return parsed.toISOString();
};

// ─── EVENT ID GENERATION ──────────────────────────────────────────────────────

/**
 * generateEventId
 *
 * Primary:  Client-generated UUID passed from the browser.
 *           This is the source of truth for cross-platform deduplication.
 *
 * Fallback: SHA-256 hash of stable parts supplied by the caller.
 *           Used ONLY for server-only events (webhooks, cron jobs).
 *
 * [FIX-1]  The original fallback used `timestamp = Date.now()` as a default,
 *          making it non-deterministic: two retries 20 ms apart produced
 *          different IDs, creating duplicate events. The timestamp is now
 *          required and throws if absent. Callers must supply a stable external
 *          reference (Stripe event ID, Paystack reference, order ID, etc.) as
 *          the timestamp or as an explicit stableRef override.
 *
 * [FIX-5]  Invalid client UUIDs now emit a warning log before falling back so
 *          frontend bugs (malformed UUIDs) are visible in the observability layer.
 *
 * @param {string|null} clientUUID     - UUID generated by the browser SDK
 * @param {Object}      fallbackParts  - Parts for the deterministic hash fallback
 * @param {string}      fallbackParts.userId
 * @param {number|string} fallbackParts.timestamp  - REQUIRED for server events; must be stable
 * @param {string}      fallbackParts.eventType
 * @param {string}      [fallbackParts.stableRef]  - e.g. Stripe event ID, order ID
 * @returns {string}
 */
export const generateEventId = (clientUUID = null, fallbackParts = {}) => {
  // Primary path: trust the client UUID if it is a valid known format
  if (clientUUID) {
    if (isValidUUID(clientUUID)) {
      return clientUUID;
    }

    // [FIX-5] Warn on invalid UUID so the bug is visible; then fall through
    logger.warn(
      { invalidEventId: clientUUID },
      '[Analytics] Client UUID failed validation — falling back to hash ID'
    );
  }

  // Fallback path: deterministic hash for server-only events
  const { userId = 'anon', timestamp, eventType = 'event', stableRef } = fallbackParts;

  // [FIX-1] Require a stable timestamp or stableRef. Accepting Date.now() as a
  // default made retries produce different IDs, breaking idempotency entirely.
  if (timestamp === undefined && !stableRef) {
    throw new Error(
      '[Analytics] generateEventId: server-side fallback requires a stable `timestamp` ' +
      'or `stableRef` (e.g. Stripe event ID, order ID). Do NOT pass Date.now() here — ' +
      'retries will produce a different hash and create duplicate events.'
    );
  }

  const hashInput = stableRef
    ? `${userId}:${stableRef}:${eventType}`
    : `${userId}:${timestamp}:${eventType}`;

  return crypto
    .createHash('sha256')
    .update(hashInput)
    .digest('hex')
    .substring(0, 32); // 32 hex chars = 128 bits — sufficient for collision resistance
};

// ─── ATTRIBUTION SANITISATION ─────────────────────────────────────────────────

/**
 * sanitiseAttribution
 *
 * [FIX-10] Truncates attribution strings to safe lengths and strips null bytes.
 * Prevents BigQuery row-size explosions from absurdly long UTM params or
 * binary junk from malformed referrers.
 *
 * @param {Object} attribution
 * @returns {Object}
 */
const sanitiseAttribution = (attribution = {}) => {
  const truncate = (value, maxLen) => {
    if (!value || typeof value !== 'string') return value ?? null;
    return value.replace(/\0/g, '').substring(0, maxLen);
  };

  return {
    source:            truncate(attribution.source,            ATTRIBUTION_MAX_LENGTHS.source)           || 'direct',
    medium:            truncate(attribution.medium,            ATTRIBUTION_MAX_LENGTHS.medium)           || null,
    campaign:          truncate(attribution.campaign,          ATTRIBUTION_MAX_LENGTHS.campaign)         || null,
    referrer:          truncate(attribution.referrer,          ATTRIBUTION_MAX_LENGTHS.referrer)         || null,
    landing_page:      truncate(attribution.landingPage,       ATTRIBUTION_MAX_LENGTHS.landingPage)      || null,
    gclid:             truncate(attribution.gclid,             ATTRIBUTION_MAX_LENGTHS.gclid)            || null,
    fbclid:            truncate(attribution.fbclid,            ATTRIBUTION_MAX_LENGTHS.fbclid)           || null,
    ttclid:            truncate(attribution.ttclid,            ATTRIBUTION_MAX_LENGTHS.ttclid)           || null,
    confidence_score:  attribution.confidenceScore  ?? null,
    confidence_level:  attribution.confidenceLevel  || null,
    is_reconstructed:  attribution.isReconstructed  || false,
    reconstruction_rule: truncate(attribution.reconstructionRule, ATTRIBUTION_MAX_LENGTHS.reconstructionRule) || null,
    device:            truncate(attribution.device,            ATTRIBUTION_MAX_LENGTHS.device)           || null,
    browser:           truncate(attribution.browser,           ATTRIBUTION_MAX_LENGTHS.browser)          || null,
  };
};

// ─── SERIALISATION SAFETY ─────────────────────────────────────────────────────

/**
 * assertSerializable
 *
 * [FIX-11] properties and attribution can accidentally contain Express req/res
 * objects, Mongoose documents, or recursive references. JSON.stringify throws
 * on these and crashes the queue worker. Detect early in the builder.
 *
 * @param {*}      value   Object to test
 * @param {string} label   Field name for error messages
 */
const assertSerializable = (value, label) => {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(
      `[Analytics] ${label} contains a circular reference or non-serializable value. ` +
      `This would crash the queue worker — strip the non-serializable data before building the event.`
    );
  }
};

// ─── EVENT BUILDER ────────────────────────────────────────────────────────────

/**
 * buildAnalyticsEvent
 *
 * Assembles a complete, normalized analytics event object.
 * Every analytics service (GA4, Meta CAPI, BigQuery) consumes this shape.
 * Never send raw controller data to external platforms — always go through
 * this builder so the schema is enforced consistently.
 *
 * @param {Object} params
 * @param {string}      params.eventType           - Must be a value from ANALYTICS_EVENTS
 * @param {string|null} params.eventId             - UUID from client or null (fallback will be used)
 * @param {string|null} params.userId              - Authenticated user MongoDB _id as string, or null
 * @param {string|null} params.anonymousId         - First-party anonymous ID from epicstore_anon cookie
 * @param {string|null} params.sessionId           - Rolling session ID from epicstore_sid cookie
 * @param {Object}      params.properties          - Event-specific payload
 * @param {Object}      params.attribution         - Full attribution context from req.attribution
 * @param {string|null} params.clientTimestamp     - ISO string from browser at moment of action
 * @param {string}      params.dispatchSource      - "client" | "server" — who sent the event
 * @param {string}      params.originSource        - "client" | "server" — who initiated the action
 * @param {Object}      params.fallbackParts       - Stable parts for server-side hash fallback
 * @returns {Object}   Normalized analytics event ready for queue ingestion
 */
export const buildAnalyticsEvent = ({
  eventType,
  eventId            = null,
  userId             = null,
  anonymousId        = null,
  sessionId          = null,
  properties         = {},
  attribution        = {},
  clientTimestamp    = null,
  dispatchSource     = 'server',
  originSource       = 'client',
  fallbackParts      = {},
}) => {
  // [FIX-4] Runtime validation against the canonical event type list.
  // Catches typos like 'purhcase' that would silently drift analytics.
  if (!Object.values(ANALYTICS_EVENTS).includes(eventType)) {
    throw new Error(
      `[Analytics] Unknown eventType: "${eventType}". ` +
      `Must be one of: ${Object.values(ANALYTICS_EVENTS).join(', ')}`
    );
  }

  // [FIX-11] Catch circular refs in properties/attribution before queue insertion
  assertSerializable(properties, 'properties');
  assertSerializable(attribution, 'attribution');

  const serverTimestamp = new Date().toISOString();

  // [FIX-3] Clamp & validate the client timestamp
  const safeClientTimestamp = validateClientTimestamp(clientTimestamp);

  // Resolve event_id: client UUID → hash fallback
  const resolvedEventId = generateEventId(eventId, {
    userId:    userId || 'anon',
    eventType,
    ...fallbackParts,
  });

  return {
    // ── Identity ────────────────────────────────────────────────────────────
    event_id:     resolvedEventId,
    event_type:   eventType,

    // ── Source & Timing ─────────────────────────────────────────────────────
    // [FIX-13] Separate dispatch_source (who sent) from origin_source (who initiated).
    // Hardcoding source:'server' on purchases is semantically wrong — the user
    // action originated in the browser even though the event is dispatched server-side.
    dispatch_source: dispatchSource,
    origin_source:   originSource,

    // Keep event_source for backwards compatibility with existing queries
    event_source: dispatchSource,

    event_time_client:    safeClientTimestamp || serverTimestamp,
    event_time_server:    serverTimestamp,
    event_time_processed: null,

    // Clock skew measurement — useful for fraud detection and mobile debugging
    clock_skew_ms: safeClientTimestamp
      ? new Date(serverTimestamp).getTime() - new Date(safeClientTimestamp).getTime()
      : null,

    // ── User Identity ───────────────────────────────────────────────────────
    user_id:       userId      || null,
    anonymous_id:  anonymousId || null,
    session_id:    sessionId   || null,

    // ── Event Data ──────────────────────────────────────────────────────────
    properties,

    // ── Attribution ─────────────────────────────────────────────────────────
    // [FIX-10] Sanitised before storage
    attribution: sanitiseAttribution(attribution),

    // ── Schema Version ──────────────────────────────────────────────────────
    // [FIX-2] Changed from string '1.0' to integer 1 to match the queue model's
    // `schemaVersion: Number`. Mixed types break BigQuery partitioning and filters.
    schema_version: 1,
  };
};

// ─── PURCHASE EVENT BUILDER ───────────────────────────────────────────────────

/**
 * buildPurchaseEvent
 *
 * Convenience builder for purchase events. Wraps buildAnalyticsEvent with
 * the correct properties shape for GA4 e-commerce and Meta CAPI.
 *
 * Called from verifyPaymentController after a successful payment.
 *
 * @param {Object} order         - Mongoose Order document (post-save)
 * @param {Object} req           - Express request (for session, attribution, anonymousId)
 * @param {string} [clientUUID]  - UUID sent from frontend at payment initiation
 * @returns {Object}             - Normalized purchase analytics event
 */
export const buildPurchaseEvent = (order, req, clientUUID = null) => {
  // [FIX-6] Do not silently default to USD — NGN orders incorrectly labelled
  // as USD corrupt revenue analytics permanently and are extremely hard to fix.
  const currency = order.paymentInfo?.currency;
  if (!currency) {
    throw new Error(
      `[Analytics] buildPurchaseEvent: order ${order._id} has no currency on paymentInfo. ` +
      `Fix the payment provider integration — never assume USD.`
    );
  }

  return buildAnalyticsEvent({
    eventType:       ANALYTICS_EVENTS.PURCHASE,
    eventId:         clientUUID || req.body?.analyticsEventId || null,
    userId:          req.user?._id?.toString() || null,
    anonymousId:     req.anonymousId   || null,
    sessionId:       req.sessionId     || null,
    clientTimestamp: req.body?.clientTimestamp || null,

    // [FIX-13] The action originated in the browser; the event is dispatched server-side.
    dispatchSource: 'server',
    originSource:   'client',

    attribution:     req.attribution   || {},

    // For server-side purchase events, supply a stable reference so retries are
    // idempotent. The payment provider's reference never changes between retries.
    // [FIX-1] This avoids the Date.now() non-determinism in the hash fallback.
    fallbackParts: {
      userId:    req.user?._id?.toString() || 'anon',
      stableRef: order.paymentInfo?.reference || order._id.toString(),
      eventType: ANALYTICS_EVENTS.PURCHASE,
    },

    properties: {
      order_id:          order._id.toString(),
      payment_reference: order.paymentInfo?.reference,
      revenue:           order.totalPrice,
      currency,
      tax:               order.taxPrice      || 0,
      shipping:          order.shippingPrice || 0,

      coupon:            order.discounts?.codes?.[0]?.code || null,
      discount_amount:   order.discounts?.totalDiscount    || 0,

      items: (order.orderItems || []).map(item => {
        // [FIX-8] Normalise to numbers to prevent NaN / string multiplication
        const price    = Number(item.price)    || 0;
        const quantity = Number(item.quantity) || 0;

        return {
          item_id:    item.product?.toString(),
          item_name:  item.name,
          price,
          quantity,
          line_total: price * quantity,

          // [FIX-7] Omit item_category entirely when empty.
          // Writing 'unknown' becomes an actual GA4 ecommerce category and
          // pollutes dimension reports permanently.
          ...(item.category ? { item_category: item.category } : {}),
        };
      }),

      item_count:        order.orderItems?.length || 0,
      payment_method:    order.paymentInfo?.method,
      is_first_purchase: order.analytics?.isFirstPurchase || false,
      purchase_number:   order.analytics?.purchaseNumber  || null,
    },
  });
};

// ─── CHECKOUT FUNNEL EVENT BUILDER ────────────────────────────────────────────

/**
 * buildCheckoutStepEvent
 *
 * Builds a funnel step event for BigQuery funnel_states table and GA4.
 * Called from checkoutController when a step is updated.
 *
 * @param {string} step          - e.g. "shipping_info", "payment_selection"
 * @param {Object} checkout      - Checkout document
 * @param {Object} req           - Express request
 * @param {string} [clientUUID]  - UUID from frontend
 * @returns {Object}
 */
export const buildCheckoutStepEvent = (step, checkout, req, clientUUID = null) => {
  // [FIX-6] Same currency guard as purchase events
  const currency = checkout.pricing?.currency;
  if (!currency) {
    throw new Error(
      `[Analytics] buildCheckoutStepEvent: checkout ${checkout._id} has no currency. ` +
      `Fix upstream — never assume USD.`
    );
  }

  return buildAnalyticsEvent({
    eventType:       ANALYTICS_EVENTS.CHECKOUT_STEP,
    eventId:         clientUUID || null,
    userId:          req.user?._id?.toString() || null,
    anonymousId:     req.anonymousId  || null,
    sessionId:       req.sessionId    || null,
    clientTimestamp: req.body?.clientTimestamp || null,
    dispatchSource:  'server',
    originSource:    'client',
    attribution:     req.attribution  || {},
    properties: {
      checkout_id:  checkout._id.toString(),
      step,
      cart_value:   checkout.pricing?.totalPrice || 0,
      item_count:   checkout.items?.length       || 0,
      currency,
      has_discount: !!(checkout.discount?.code),
    },
  });
};

// ─── EVENT TYPE CONSTANTS ─────────────────────────────────────────────────────

/**
 * ANALYTICS_EVENTS
 *
 * Canonical list of event types used across the system.
 * Import this when dispatching events to avoid string typos.
 * buildAnalyticsEvent validates eventType against these values at runtime.
 */
export const ANALYTICS_EVENTS = {
  // Conversion events (highest priority — always sent server-side)
  PURCHASE:          'purchase',
  BEGIN_CHECKOUT:    'begin_checkout',
  ADD_PAYMENT_INFO:  'add_payment_info',

  // Funnel events
  CHECKOUT_STEP:     'checkout_step',
  CHECKOUT_ABANDON:  'checkout_abandon',
  CART_RECOVERY:     'cart_recovery',

  // Engagement events
  ADD_TO_CART:       'add_to_cart',
  REMOVE_FROM_CART:  'remove_from_cart',
  VIEW_ITEM:         'view_item',
  VIEW_ITEM_LIST:    'view_item_list',
  ADD_TO_WISHLIST:   'add_to_wishlist',
  SEARCH:            'search',

  // User events
  LOGIN:             'login',
  SIGN_UP:           'sign_up',
  EMAIL_VERIFIED:    'email_verified',

  // System events
  REFUND:            'refund',
  RETURN_REQUESTED:  'return_requested',
};

// ─── VALIDATION ───────────────────────────────────────────────────────────────

/**
 * validateAnalyticsEvent
 *
 * Validates that a built event has all required fields before it is enqueued.
 *
 * [FIX-9] Warnings are now returned in a separate `warnings` array rather than
 * being mixed into `errors`. Downstream logging systems were treating the
 * WARNING-prefixed strings as actual failures, triggering false alerts.
 *
 * @param {Object} event - Output of buildAnalyticsEvent()
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export const validateAnalyticsEvent = (event) => {
  const errors   = [];
  const warnings = [];

  if (!event.event_id)   errors.push('event_id is required');
  if (!event.event_type) errors.push('event_type is required');

  if (!event.dispatch_source || !['client', 'server'].includes(event.dispatch_source)) {
    errors.push('dispatch_source must be "client" or "server"');
  }
  if (!event.origin_source || !['client', 'server'].includes(event.origin_source)) {
    errors.push('origin_source must be "client" or "server"');
  }

  if (!event.event_time_server) errors.push('event_time_server is required');
  if (event.schema_version !== 1) errors.push('schema_version must be integer 1');

  if (!event.user_id && !event.anonymous_id) {
    warnings.push('both user_id and anonymous_id are null — event cannot be attributed to any identity');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};