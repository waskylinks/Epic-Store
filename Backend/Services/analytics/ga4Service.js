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
 *   For purchases, deduplication relies on transaction_id, not event_id.
 *   GA4 Measurement Protocol does NOT guarantee dedup via event_id.
 *   transaction_id must be consistent and unique per purchase.
 *
 * client_id requirement:
 *   GA4 needs the client_id from the _ga cookie to associate server-side
 *   events with the correct browser session. Without it, server events
 *   appear as new users in GA4 reports, inflating user counts.
 *   The Phase 1 frontend SDK reads the _ga cookie and sends ga4ClientId
 *   in the request body.
 *
 *   Fallback: when client_id is absent or invalid, a deterministic ID is
 *   derived from userId (when available) so repeated calls for the same
 *   user produce the same phantom client rather than an ever-growing pool
 *   of one-off anonymous users. Anonymous sessions fall back to a random
 *   UUID generated once per request.
 *
 * session_id requirement:
 *   The GA4 session_id is NOT the same as your application session ID.
 *   It lives in the _ga_XXXXXXXX cookie (where XXXXXXXX is your Measurement
 *   ID without the G- prefix). The frontend SDK must read this cookie and
 *   send ga4SessionId in the request body separately from ga4ClientId.
 *   Using your app's session ID here will create phantom sessions in GA4
 *   and break attribution stitching.
 *
 *   session_id must be a numeric string. Non-numeric values are rejected
 *   and the field is omitted rather than sending a value GA4 cannot parse.
 *
 * engagement_time_msec requirement:
 *   Per official GA4 Measurement Protocol documentation, engagement_time_msec
 *   and session_id must both be present in event params for user activity to
 *   appear in Realtime reports and contribute to engagement metrics.
 *   This service sends engagement_time_msec: 1 as the standard floor value
 *   for server-side events where actual engagement time is not measurable.
 *
 * Payload size:
 *   GA4 Measurement Protocol enforces a 130KB per-request limit and a 25-event
 *   per-request limit. This service sends one event per request. The items
 *   array is capped at MAX_ITEMS_PER_EVENT (20) to stay safely within limits.
 *   Parameters are truncated: string values to 100 chars, param keys to 40 chars.
 *
 * PII sanitization:
 *   Email addresses, phone numbers, and full names are stripped from all
 *   event parameters before sending. GA4 terms of service prohibit sending
 *   PII in event parameters. Use user_id (a hashed/opaque ID) for user linking.
 *
 * Debug Mode (per official Google documentation):
 *   Use the debug endpoint OR _debug=true query parameter, not both.
 *   We use the debug endpoint in non-production environments.
 *
 * Environment variables required:
 *   GA4_MEASUREMENT_ID   — G-XXXXXXXXXX from GA4 Data Streams
 *   GA4_API_SECRET       — Measurement Protocol API secret
 *   GA4_ENDPOINT         — Production endpoint URL (optional, has default)
 *   GA4_DEBUG_ENDPOINT   — Debug endpoint URL (optional, has default)
 *   GA4_MAX_RETRIES      — Number of retries for failed requests (default: 3)
 *   GA4_RETRY_DELAY_MS   — Base delay between retries (default: 1000)
 */

import crypto from 'crypto';
import http   from 'http';
import https  from 'https';
import axios  from 'axios';

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

const PRODUCTION_ENDPOINT =
  process.env.GA4_ENDPOINT || 'https://www.google-analytics.com/mp/collect';

const DEBUG_ENDPOINT =
  process.env.GA4_DEBUG_ENDPOINT || 'https://www.google-analytics.com/debug/mp/collect';

// ─── HTTP KEEP-ALIVE AGENTS ──────────────────────────────────────────────────

// Keep-alive agents reuse TCP/TLS connections across requests, eliminating
// per-request handshake overhead. At analytics event volume this materially
// reduces latency and avoids socket exhaustion under sustained load.
// Mirrors the pattern already used in metaCapiService.js.
const httpAgent  = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

// ─── RETRY CONFIGURATION ─────────────────────────────────────────────────────

const MAX_RETRIES        = parseInt(process.env.GA4_MAX_RETRIES    || '3',     10);
const RETRY_DELAY_MS     = parseInt(process.env.GA4_RETRY_DELAY_MS || '1000',  10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.GA4_TIMEOUT_MS     || '15000', 10);

// ─── PAYLOAD LIMITS ───────────────────────────────────────────────────────────

// GA4 MP hard limits — stay safely below to handle edge cases
const MAX_ITEMS_PER_EVENT  = 20;   // GA4 hard limit is ~200 but large arrays blow payload size
const MAX_PARAM_KEY_LEN    = 40;   // GA4 hard limit
const MAX_PARAM_VALUE_LEN  = 100;  // GA4 hard limit for string values
const MAX_PAYLOAD_BYTES    = 120 * 1024; // 120KB — GA4 hard limit is 130KB, leave headroom

// ─── VALID GA4 EVENT NAMES ────────────────────────────────────────────────────

// Allowlist of event names this service is permitted to send.
// Prevents arbitrary strings from being forwarded to GA4 — either from
// misconfigured callers or (in agent contexts) injected event names.
// Add new custom events here as the platform grows.
const VALID_EVENT_NAMES = new Set([
  // Standard e-commerce
  'purchase',
  'refund',
  'add_to_cart',
  'remove_from_cart',
  'view_item',
  'view_item_list',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  // Standard engagement
  'login',
  'sign_up',
  'search',
  'select_content',
  'share',
  // Custom — add as needed
  'test_connection',
]);

// ─── RESERVED PARAMETERS ─────────────────────────────────────────────────────

// GA4 silently drops events containing these reserved parameter names.
// Source: https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference#reserved_parameter_names
//
// NOTE: engagement_time_msec and session_id are NOT reserved — they are
// required common event parameters that must be sent inside event params.
// See: https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference
const RESERVED_PARAM_NAMES = new Set([
  'page_title',
  'page_location',
  'page_referrer',
  'firebase_screen',
  'firebase_screen_class',
  'firebase_previous_screen',
  'firebase_previous_class',
  'ga_session_id',
  'ga_session_number',
  'session_engaged',
]);

// Standard GA4 e-commerce fields that must NOT be filtered
const ECOMMERCE_FIELDS = new Set([
  'items',
  'value',
  'currency',
  'transaction_id',
  'tax',
  'shipping',
  'coupon',
  'affiliation',
]);

// ─── PII PATTERNS ─────────────────────────────────────────────────────────────

// Patterns used to detect and strip PII from string parameter values.
// GA4 ToS prohibits sending PII in event parameters.
// The phone pattern is deliberately tighter than a naive match to avoid
// redacting order references, tracking IDs, and transaction codes that
// contain digit runs. It requires 9-15 digits and rejects strings
// immediately surrounded by uppercase letters or underscores.
const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,   // email addresses
  /(?<![A-Z0-9_-])\b(\+?[\d\s\-().]{9,15})\b(?![A-Z0-9_-])/g,  // phone numbers (tighter — avoids order/transaction refs)
];

// Parameter keys that should never appear in GA4 event params
const PII_PARAM_KEYS = new Set([
  'email', 'phone', 'phoneNo', 'phone_number',
  'firstName', 'first_name', 'lastName', 'last_name',
  'fullName', 'full_name', 'name',
  'address', 'street', 'password', 'ssn', 'dob', 'date_of_birth',
  'card_number', 'cvv', 'credit_card',
]);

// ─── PII SANITIZER ────────────────────────────────────────────────────────────

/**
 * sanitizeStringValue
 *
 * Strips PII patterns from a string value before it enters a GA4 param.
 * Replaces detected PII with a placeholder rather than the raw value.
 *
 * @param {string} value
 * @returns {string}
 */
const sanitizeStringValue = (value) => {
  if (typeof value !== 'string') return value;
  let sanitized = value;
  for (const pattern of PII_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[redacted]');
  }
  return sanitized;
};

/**
 * sanitizeParams
 *
 * Recursively removes PII keys and sanitizes PII patterns from all string
 * values in an event params object. Runs before validateEventParams so
 * reserved-param filtering sees already-clean data.
 *
 * @param {Object} params
 * @returns {Object}
 */
const sanitizeParams = (params) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;

  const clean = {};
  for (const [key, value] of Object.entries(params)) {
    if (PII_PARAM_KEYS.has(key)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[GA4] PII parameter key "${key}" stripped from event params.`);
      }
      continue;
    }
    if (typeof value === 'string') {
      clean[key] = sanitizeStringValue(value);
    } else if (Array.isArray(value)) {
      clean[key] = value.map(item =>
        typeof item === 'object' && item !== null
          ? sanitizeParams(item)
          : typeof item === 'string'
          ? sanitizeStringValue(item)
          : item
      );
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeParams(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
};

// ─── VALIDATION FUNCTIONS ────────────────────────────────────────────────────

/**
 * isValidClientId
 *
 * Validates that client_id matches the GA4 _ga cookie stripped format.
 * Expected: two numeric components separated by a dot ("1234567890.9876543210").
 *
 * The _ga cookie value is "GA1.1.XXXXXXXXXX.YYYYYYYYYY" — the frontend SDK
 * must strip the "GA1.1." prefix before sending ga4ClientId in the request body.
 *
 * @param {string|null|undefined} clientId
 * @returns {boolean}
 */
const isValidClientId = (clientId) => {
  if (!clientId || typeof clientId !== 'string') return false;
  return /^\d+\.\d+$/.test(clientId);
};

/**
 * isValidSessionId
 *
 * Validates that the GA4 session_id is a numeric string.
 * GA4 requires session_id to be numeric — non-numeric values cause the
 * session stitching to fail silently, creating phantom sessions.
 *
 * The session ID comes from the _ga_XXXXXXXX cookie (not the app session).
 * It follows the "s" prefix in the cookie value, e.g. s1746773758 → "1746773758".
 *
 * @param {string|number|null|undefined} sessionId
 * @returns {boolean}
 */
const isValidSessionId = (sessionId) => {
  if (sessionId === null || sessionId === undefined) return false;
  const str = String(sessionId);
  return /^\d+$/.test(str) && str !== '0';
};

/**
 * truncateParamKey
 *
 * Truncates a parameter key to GA4's 40-character limit.
 *
 * @param {string} key
 * @returns {string}
 */
const truncateParamKey = (key) =>
  typeof key === 'string' && key.length > MAX_PARAM_KEY_LEN
    ? key.slice(0, MAX_PARAM_KEY_LEN)
    : key;

/**
 * truncateParamValue
 *
 * Truncates a string parameter value to GA4's 100-character limit.
 * Non-string values are passed through unchanged.
 *
 * @param {*} value
 * @returns {*}
 */
const truncateParamValue = (value) =>
  typeof value === 'string' && value.length > MAX_PARAM_VALUE_LEN
    ? value.slice(0, MAX_PARAM_VALUE_LEN)
    : value;

/**
 * validateEventName
 *
 * Validates the event name against the VALID_EVENT_NAMES allowlist.
 * Rejects names that contain non-alphanumeric/underscore characters
 * (GA4 event name spec) even if somehow on the allowlist.
 *
 * @param {string} eventName
 * @throws {Error} If event name is invalid or not on the allowlist
 */
const validateEventName = (eventName) => {
  if (!eventName || typeof eventName !== 'string') {
    throw new Error('GA4 event name must be a non-empty string.');
  }
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(eventName)) {
    throw new Error(
      `GA4 event name "${eventName}" is invalid. Must be lowercase, ` +
      `start with a letter, contain only letters/digits/underscores, max 40 chars.`
    );
  }
  if (!VALID_EVENT_NAMES.has(eventName)) {
    throw new Error(
      `GA4 event name "${eventName}" is not on the allowlist. ` +
      `Add it to VALID_EVENT_NAMES if intentional.`
    );
  }
};

/**
 * validateEventParams
 *
 * Filters reserved parameter names, enforces key/value length limits,
 * and coerces item price/quantity to numbers.
 *
 * @param {string} eventName
 * @param {Object} params
 * @returns {Object}
 */
const validateEventParams = (eventName, params) => {
  if (!params || typeof params !== 'object') return {};

  const filteredParams = {};
  const warnings = [];

  for (const [rawKey, value] of Object.entries(params)) {
    const key = truncateParamKey(rawKey);

    if (rawKey !== key) {
      warnings.push(`Parameter key "${rawKey}" truncated to "${key}" (GA4 40-char limit)`);
    }

    if (RESERVED_PARAM_NAMES.has(key) && !ECOMMERCE_FIELDS.has(key)) {
      warnings.push(`Reserved parameter "${key}" removed — GA4 silently drops events containing it`);
      continue;
    }

    if (key === 'items' && Array.isArray(value)) {
      const truncated = value.slice(0, MAX_ITEMS_PER_EVENT);
      if (value.length > MAX_ITEMS_PER_EVENT) {
        warnings.push(
          `items array truncated from ${value.length} to ${MAX_ITEMS_PER_EVENT} (payload size guard)`
        );
      }
      filteredParams.items = truncated.map((item) => {
        const validatedItem = { ...item };
        if (validatedItem.price    !== undefined) validatedItem.price    = Number(validatedItem.price);
        if (validatedItem.quantity !== undefined) validatedItem.quantity = Number(validatedItem.quantity);
        // Truncate string fields within items too
        for (const [k, v] of Object.entries(validatedItem)) {
          if (typeof v === 'string') validatedItem[k] = truncateParamValue(v);
        }
        return validatedItem;
      });
      continue;
    }

    filteredParams[key] = truncateParamValue(value);
  }

  if (warnings.length > 0) {
    console.warn(`[GA4] Validation warnings for "${eventName}":`, warnings);
  }

  return filteredParams;
};

/**
 * validateCurrencyValuePair
 *
 * Ensures that if 'value' is present, 'currency' is also specified.
 *
 * @param {Object} params
 * @throws {Error}
 */
const validateCurrencyValuePair = (params) => {
  if (params.value !== undefined && params.value !== null && !params.currency) {
    throw new Error(
      `GA4 validation failed: 'currency' is required when 'value' (${params.value}) is present`
    );
  }
};

// ─── PAYLOAD BUILDER ─────────────────────────────────────────────────────────

/**
 * sanitizePayload
 *
 * Removes undefined/null values, handles Date objects, and protects against
 * circular references by tracking visited objects.
 *
 * @param {Object} obj
 * @param {WeakSet} [seen] - Tracks visited objects to break circular refs
 * @returns {Object}
 */
const sanitizePayload = (obj, seen = new WeakSet()) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object')           return obj;
  if (obj instanceof Date)               return obj.toISOString();

  // Circular reference guard — omit the field entirely rather than injecting
  // a '[circular]' string that would corrupt analytics array values downstream.
  if (seen.has(obj)) {
    console.warn('[GA4] Circular reference detected in payload — field omitted.');
    return undefined;
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    const result = obj
      .filter(item => item !== undefined && item !== null)
      .map(item =>
        typeof item === 'object' ? sanitizePayload(item, seen) : item
      );
    seen.delete(obj);
    return result;
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    sanitized[key] = typeof value === 'object'
      ? sanitizePayload(value, seen)
      : value;
  }
  seen.delete(obj);
  return sanitized;
};

/**
 * assertPayloadSize
 *
 * Throws if the serialized payload exceeds the GA4 size limit.
 * Called immediately before the HTTP request so oversized payloads
 * are caught server-side rather than silently rejected by GA4.
 *
 * @param {Object} payload
 * @param {string} eventName
 * @throws {Error}
 */
const assertPayloadSize = (payload, eventName) => {
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `GA4 payload for "${eventName}" is ${bytes} bytes — exceeds ${MAX_PAYLOAD_BYTES} byte limit. ` +
      `Reduce items array length or truncate large string parameters.`
    );
  }
};

/**
 * buildGA4Payload
 *
 * Assembles the GA4 Measurement Protocol request payload.
 *
 * Correctness guarantees in this version:
 *   1. client_id: warn + deterministic fallback (userId-derived when available,
 *      random UUID for anonymous). Avoids ever-growing phantom user pool.
 *   2. session_id: validated as numeric before inclusion. Non-numeric values
 *      (e.g. app session UUIDs passed by mistake) are dropped with a warning
 *      rather than being sent and silently breaking session stitching.
 *   3. engagement_time_msec: 1 always injected — required for Realtime reports.
 *   4. PII sanitization runs before reserved-param filtering.
 *   5. Payload size checked after construction.
 *
 * @param {string}   clientId    - GA4 client_id ("XXXXXXXXXX.YYYYYYYYYY")
 * @param {string}   userId      - Authenticated user ID (optional)
 * @param {string}   sessionId   - GA4 session ID from _ga_XXXXXXXX cookie (optional)
 * @param {string}   eventName   - GA4 event name (snake_case, allowlisted)
 * @param {Object}   eventParams - Event-specific parameters
 * @returns {Object} GA4 Measurement Protocol payload
 */
const buildGA4Payload = ({ clientId, userId, sessionId, eventName, eventParams }) => {
  // ── client_id resolution ─────────────────────────────────────────────────
  let resolvedClientId = clientId;

  if (!isValidClientId(clientId)) {
    console.warn(
      `[GA4] Missing or invalid client_id for event "${eventName}". ` +
      `Expected "XXXXXXXXXX.YYYYYYYYYY". Received: "${clientId}". ` +
      `Ensure the frontend SDK sends ga4ClientId. Using deterministic fallback.`
    );

    if (userId) {
      // Deterministic: same userId always produces the same phantom client_id.
      // Prevents one anonymous user record per missing-cookie request.
      const hash = crypto.createHash('sha256').update(`ga4-fallback:${userId}`).digest('hex');
      // Format as two numeric-looking segments to satisfy GA4's format requirement
      resolvedClientId = `${parseInt(hash.slice(0, 8), 16)}.${parseInt(hash.slice(8, 16), 16)}`;
    } else {
      // Truly anonymous — random but at least valid format
      resolvedClientId = `${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
    }
  }

  // ── session_id validation ─────────────────────────────────────────────────
  let resolvedSessionId;
  if (sessionId !== undefined && sessionId !== null) {
    if (isValidSessionId(sessionId)) {
      resolvedSessionId = String(sessionId);
    } else {
      console.warn(
        `[GA4] Invalid session_id "${sessionId}" for event "${eventName}" — must be numeric. ` +
        `Ensure the frontend SDK reads the _ga_XXXXXXXX cookie, not the app session ID. ` +
        `session_id omitted; event will not stitch to browser session.`
      );
      // resolvedSessionId remains undefined — omitted from params below
    }
  }

  // ── PII sanitization → reserved-param filtering → size limits ────────────
  const sanitizedParams = sanitizeParams(eventParams);
  const validatedParams  = validateEventParams(eventName, sanitizedParams);
  validateCurrencyValuePair(validatedParams);

  const event = {
    name: eventName,
    params: {
      engagement_time_msec: 1,
      ...(resolvedSessionId && { session_id: resolvedSessionId }),
      ...validatedParams,
    },
  };

  const payload = {
    client_id: resolvedClientId,
    ...(userId && { user_id: String(userId) }),
    events: [event],
  };

  return sanitizePayload(payload);
};

// ─── RETRY LOGIC ─────────────────────────────────────────────────────────────

/**
 * sleep
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * sendWithRetry
 *
 * Sends a request to GA4 with exponential backoff retry logic.
 * Only retries on network errors and 5xx server errors.
 * Does NOT retry on 4xx client errors.
 *
 * Retry deduplication note:
 *   Retries can cause duplicate events for non-purchase events.
 *   For purchases, transaction_id handles GA4-side deduplication.
 *   For all other events, the orchestrator's Redis idempotency layer
 *   (analytics:sent:{provider}:{eventType}:{eventId}) prevents duplicate
 *   dispatch across fast-path and queue-path — which is the primary
 *   duplication risk. Within a single sendWithRetry call, duplicates
 *   from network retries are accepted as an acceptable trade-off
 *   (the alternative is lost events).
 *
 * @param {string} url
 * @param {Object} payload
 * @param {string} eventName - For logging only
 * @param {number} attempt
 * @returns {Promise<Object>}
 */
const sendWithRetry = async (url, payload, eventName, attempt = 0) => {
  try {
    return await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout:    REQUEST_TIMEOUT_MS,
      httpAgent,
      httpsAgent,
    });
  } catch (error) {
    const status         = error.response?.status;
    const isNetworkError = !error.response;
    const isServerError  = status >= 500 && status < 600;
    const shouldRetry    = (isNetworkError || isServerError) && attempt < MAX_RETRIES;

    if (shouldRetry) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[GA4] "${eventName}" failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
        `retrying in ${delay}ms: ${error.message}`
      );
      await sleep(delay);
      return sendWithRetry(url, payload, eventName, attempt + 1);
    }

    if (error.response) {
      console.error(`[GA4] "${eventName}" failed with status ${status}:`, error.response.data);
    } else if (error.request) {
      console.error(`[GA4] "${eventName}" — no response received: ${error.message}`);
    } else {
      console.error(`[GA4] "${eventName}" — request setup error: ${error.message}`);
    }

    throw error;
  }
};

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

/**
 * sendGA4Event
 *
 * Sends a single event to the GA4 Measurement Protocol endpoint.
 *
 * @param {string}   eventName              - GA4 event name (must be in VALID_EVENT_NAMES)
 * @param {Object}   eventParams            - Event-specific parameters
 * @param {Object}   context                - Request context
 * @param {string}   context.clientId       - GA4 client_id from _ga cookie
 * @param {string}   context.userId         - Authenticated user ID
 * @param {string}   context.ga4SessionId   - GA4 session ID from _ga_XXXXXXXX cookie
 * @returns {Promise<Object>}
 */
export const sendGA4Event = async (eventName, eventParams, context = {}) => {
  const { clientId, userId, ga4SessionId } = context;

  if (!process.env.GA4_MEASUREMENT_ID || !process.env.GA4_API_SECRET) {
    throw new Error('GA4_MEASUREMENT_ID or GA4_API_SECRET not configured');
  }

  // Validate event name before doing any other work
  validateEventName(eventName);

  const isDebugMode = process.env.NODE_ENV !== 'production' && process.env.GA4_DEBUG !== 'false';

  const queryParams = new URLSearchParams({
    measurement_id: process.env.GA4_MEASUREMENT_ID,
    api_secret:     process.env.GA4_API_SECRET,
  });

  const endpoint = isDebugMode ? DEBUG_ENDPOINT : PRODUCTION_ENDPOINT;
  const url      = `${endpoint}?${queryParams.toString()}`;

  const payload = buildGA4Payload({
    clientId,
    userId,
    sessionId: ga4SessionId,
    eventName,
    eventParams,
  });

  // Enforce payload size limit before sending
  assertPayloadSize(payload, eventName);

  if (process.env.NODE_ENV !== 'production' && process.env.GA4_LOG_PAYLOADS === 'true') {
    console.debug(
      `[GA4] Sending "${eventName}" to ${isDebugMode ? 'debug' : 'production'} endpoint:`,
      JSON.stringify(payload, null, 2)
    );
  }

  try {
    const response = await sendWithRetry(url, payload, eventName);

    const isDebugResponse = isDebugMode && response.status === 200;
    if (isDebugResponse && response.data?.validationMessages?.length > 0) {
      console.warn(
        `[GA4] Validation issues for "${eventName}":`,
        JSON.stringify(response.data.validationMessages, null, 2)
      );
    }

    return {
      success:            true,
      statusCode:         response.status,
      validationMessages: response.data?.validationMessages || [],
      eventName,
      sentAt:             new Date().toISOString(),
      debugMode:          isDebugMode,
    };
  } catch (error) {
    const enhancedError         = new Error(`GA4 send failed for "${eventName}": ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.eventName     = eventName;
    enhancedError.context       = {
      clientId: clientId?.substring(0, 10) + '...',
      userId,
      ga4SessionId,
    };
    throw enhancedError;
  }
};

// ─── PURCHASE EVENT ───────────────────────────────────────────────────────────

/**
 * sendGA4Purchase
 *
 * Sends a GA4 `purchase` event for a completed order.
 *
 * CRITICAL: transaction_id is the primary deduplication mechanism.
 * Must be paymentInfo.reference — not order._id. A fallback to _id produces
 * inconsistent IDs between fast-path and queue-path, causing duplicate purchases.
 *
 * @param {Object} order    - Mongoose Order document (post-save)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 * @throws {Error} If transaction_id or currency is missing
 */
export const sendGA4Purchase = async (order, context = {}) => {
  const { clientId, userId, ga4SessionId } = context;

  const transactionId = order.paymentInfo?.reference;
  if (!transactionId) {
    throw new Error(
      'GA4 purchase event requires paymentInfo.reference as transaction_id. ' +
      'Falling back to order._id is not safe — produces inconsistent ' +
      'transaction_ids across fast-path and queue-path dispatches.'
    );
  }

  const currency = order.paymentInfo?.currency || order.currency;
  if (!currency) {
    throw new Error(
      'GA4 purchase event requires currency. ' +
      'No currency found in order.paymentInfo.currency or order.currency.'
    );
  }

  const items = (order.orderItems || []).slice(0, MAX_ITEMS_PER_EVENT).map((item, index) => {
    const product   = item.product || {};
    const productId = (product._id || item.productId || item.product)?.toString();

    return {
      item_id:        productId || `item_${index}`,
      item_name:      item.name || product.name || 'Unknown Product',
      item_category:  item.category   || product.category   || 'uncategorized',
      item_category2: item.subcategory || product.subcategory,
      item_brand:     item.brand   || product.brand,
      item_variant:   item.variant || product.variant,
      price:          Number(item.price) || Number(product.price) || 0,
      quantity:       Number(item.quantity) || 1,
      ...(item.discount && { discount: Number(item.discount) }),
      ...(item.coupon   && { coupon: item.coupon }),
      affiliation: order.affiliation || 'E-commerce Store',
    };
  });

  const couponCode =
    order.discounts?.codes?.[0]?.code ||
    order.couponCode ||
    order.promoCode  ||
    null;

  const eventParams = {
    transaction_id: transactionId,
    value:          Number(order.totalPrice)    || 0,
    currency,
    tax:            Number(order.taxPrice)      || 0,
    shipping:       Number(order.shippingPrice) || 0,
    items,
    affiliation:    order.affiliation || 'E-commerce Store',
    ...(couponCode && { coupon: couponCode }),
    ...(order.shippingMethod && { shipping_tier: order.shippingMethod }),

    attribution_confidence:    context.attribution?.confidenceLevel || 'UNKNOWN',
    attribution_reconstructed: context.attribution?.isReconstructed || false,
    attribution_source:        context.attribution?.source   || 'direct',
    attribution_medium:        context.attribution?.medium   || 'none',
    attribution_campaign:      context.attribution?.campaign || 'direct',

    is_first_purchase:   order.analytics?.isFirstPurchase || false,
    purchase_number:     order.analytics?.purchaseNumber  || null,
    payment_method:      order.paymentInfo?.method || 'unknown',
    payment_method_type: order.paymentInfo?.type   || 'standard',
    item_count:          order.orderItems?.length  || 0,
  };

  return sendGA4Event('purchase', eventParams, { clientId, userId, ga4SessionId });
};

// ─── CHECKOUT STEP EVENT ──────────────────────────────────────────────────────

/**
 * sendGA4CheckoutStep
 *
 * Sends a GA4 event for a checkout funnel step.
 *
 * Step → GA4 event mapping:
 *   start_checkout    → begin_checkout     (user lands on checkout)
 *   shipping_info     → add_shipping_info  (shipping details submitted ≠ checkout started)
 *   add_shipping_info → add_shipping_info
 *   payment_selection → add_payment_info
 *   add_payment_info  → add_payment_info
 *
 * @param {string} step      - Step name from Checkout.currentStep
 * @param {Object} checkout  - Checkout document
 * @param {Object} context   - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4CheckoutStep = async (step, checkout, context = {}) => {
  const GA4_STEP_MAP = {
    start_checkout:    'begin_checkout',
    add_shipping_info: 'add_shipping_info',
    shipping_info:     'add_shipping_info',
    payment_selection: 'add_payment_info',
    add_payment_info:  'add_payment_info',
  };

  const eventName = GA4_STEP_MAP[step];

  if (!eventName) {
    console.warn(
      `[GA4] Unknown checkout step "${step}" - skipping. ` +
      `Expected one of: ${Object.keys(GA4_STEP_MAP).join(', ')}`
    );
    return { success: false, skipped: true, reason: `Unknown step: ${step}` };
  }

  const currency = checkout.pricing?.currency || checkout.currency;

  const items = (checkout.items || []).slice(0, MAX_ITEMS_PER_EVENT).map((item, index) => {
    const product = item.product || {};
    return {
      item_id:       product._id?.toString() || item.productId?.toString() || `item_${index}`,
      item_name:     item.name || product.name || 'Unknown Product',
      item_category: item.category || product.category || 'uncategorized',
      price:         Number(item.price)    || 0,
      quantity:      Number(item.quantity) || 1,
      ...(item.variant && { item_variant: item.variant }),
    };
  });

  const eventParams = {
    value: checkout.pricing?.totalPrice || 0,
    items,
    ...(checkout.discount?.code && { coupon: checkout.discount.code }),
    ...(currency && { currency }),
  };

  return sendGA4Event(eventName, eventParams, context);
};

// ─── ADD TO CART EVENT ────────────────────────────────────────────────────────

/**
 * sendGA4AddToCart
 *
 * Sends a GA4 `add_to_cart` event.
 *
 * @param {Object} product  - Product document
 * @param {number} quantity - Quantity added
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4AddToCart = async (product, quantity, context = {}) => {
  const price           = product.pricing?.sale || product.pricing?.regular || product.price || 0;
  const numericPrice    = Number(price);
  const numericQuantity = Number(quantity);
  const currency        = product.pricing?.currency || product.currency;

  const eventParams = {
    value: numericPrice * numericQuantity,
    items: [{
      item_id:        product._id?.toString(),
      item_name:      product.name,
      item_category:  product.category    || 'uncategorized',
      item_category2: product.subcategory,
      item_brand:     product.brand,
      item_variant:   product.variant,
      price:          numericPrice,
      quantity:       numericQuantity,
    }],
    ...(currency && { currency }),
  };

  return sendGA4Event('add_to_cart', eventParams, context);
};

// ─── LOGIN EVENT ──────────────────────────────────────────────────────────────

/**
 * sendGA4Login
 *
 * Sends a GA4 `login` event after successful authentication.
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
 *
 * @param {Object} order        - Original order document
 * @param {number} refundAmount - Amount refunded
 * @param {Object} context      - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4Refund = async (order, refundAmount, context = {}) => {
  const transactionId = order.paymentInfo?.reference;
  if (!transactionId) {
    throw new Error('GA4 refund event requires paymentInfo.reference as transaction_id.');
  }

  const currency = order.paymentInfo?.currency || order.currency;
  if (!currency) {
    throw new Error(
      'GA4 refund event requires currency. ' +
      'No currency found in order.paymentInfo.currency or order.currency.'
    );
  }

  const items = (order.orderItems || []).slice(0, MAX_ITEMS_PER_EVENT).map((item, index) => ({
    item_id:   item.product?.toString() || `item_${index}`,
    item_name: item.name || 'Unknown Product',
    price:     Number(item.price)    || 0,
    quantity:  Number(item.quantity) || 1,
  }));

  return sendGA4Event('refund', {
    transaction_id: transactionId,
    value:          Number(refundAmount) || 0,
    currency,
    items,
    ...(context.reason && { refund_reason: context.reason }),
  }, context);
};

// ─── VIEW ITEM EVENT ──────────────────────────────────────────────────────────

/**
 * sendGA4ViewItem
 *
 * Sends a GA4 `view_item` event when a user views a product detail page.
 *
 * @param {Object} product  - Product document
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4ViewItem = async (product, context = {}) => {
  const price    = product.pricing?.sale || product.pricing?.regular || product.price || 0;
  const currency = product.pricing?.currency || product.currency;

  const eventParams = {
    value: Number(price),
    items: [{
      item_id:        product._id?.toString(),
      item_name:      product.name,
      item_category:  product.category    || 'uncategorized',
      item_category2: product.subcategory,
      item_brand:     product.brand,
      item_variant:   product.variant,
      price:          Number(price),
    }],
    ...(currency && { currency }),
  };

  return sendGA4Event('view_item', eventParams, context);
};

// ─── BEGIN CHECKOUT EVENT ─────────────────────────────────────────────────────

/**
 * sendGA4BeginCheckout
 *
 * Sends a GA4 `begin_checkout` event when a user starts the checkout process.
 *
 * @param {Object} cart     - Cart document
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendGA4BeginCheckout = async (cart, context = {}) => {
  const currency   = cart.currency;
  const totalValue = cart.pricing?.subtotal || cart.total || 0;

  const items = (cart.items || []).slice(0, MAX_ITEMS_PER_EVENT).map((item, index) => ({
    item_id:   item.product?._id?.toString() || `item_${index}`,
    item_name: item.name || 'Unknown Product',
    price:     Number(item.price)    || 0,
    quantity:  Number(item.quantity) || 1,
  }));

  const eventParams = {
    value: Number(totalValue),
    items,
    ...(cart.discount?.code && { coupon: cart.discount.code }),
    ...(currency && { currency }),
  };

  return sendGA4Event('begin_checkout', eventParams, context);
};

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

/**
 * checkGA4Config
 *
 * Validates that GA4 environment variables are configured correctly.
 * Called by server.js on startup and by the observability controller.
 *
 * @returns {Object}
 */
export const checkGA4Config = () => {
  const required = ['GA4_MEASUREMENT_ID', 'GA4_API_SECRET'];
  const missing  = required.filter(key => !process.env[key]);

  return {
    configured:         missing.length === 0,
    missing,
    productionEndpoint: PRODUCTION_ENDPOINT,
    debugEndpoint:      DEBUG_ENDPOINT,
    debugModeEnabled:   process.env.NODE_ENV !== 'production',
    retryConfig: {
      maxRetries:   MAX_RETRIES,
      retryDelayMs: RETRY_DELAY_MS,
      timeoutMs:    REQUEST_TIMEOUT_MS,
    },
    testEndpoint: async () => {
      if (!process.env.GA4_MEASUREMENT_ID || !process.env.GA4_API_SECRET) {
        return { error: 'GA4 not configured' };
      }
      const params = new URLSearchParams({
        measurement_id: process.env.GA4_MEASUREMENT_ID,
        api_secret:     process.env.GA4_API_SECRET,
      });
      const testUrl     = `${DEBUG_ENDPOINT}?${params.toString()}`;
      const testPayload = {
        client_id: '1234567890.1234567890',
        events: [{
          name: 'test_connection',
          params: { engagement_time_msec: 1, debug: true },
        }],
      };
      try {
        const response = await axios.post(testUrl, testPayload, { timeout: 5000 });
        return { success: response.status === 200, status: response.status };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

export default {
  sendGA4Event,
  sendGA4Purchase,
  sendGA4CheckoutStep,
  sendGA4AddToCart,
  sendGA4Login,
  sendGA4SignUp,
  sendGA4Refund,
  sendGA4ViewItem,
  sendGA4BeginCheckout,
  checkGA4Config,
};