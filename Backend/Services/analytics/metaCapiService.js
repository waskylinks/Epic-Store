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
 *   DEFAULT_CURRENCY     — Fallback currency code (e.g. "USD", "NGN")
 */

import crypto    from 'crypto';
import axios     from 'axios';
import http      from 'http';
import https     from 'https';
import countries from 'i18n-iso-countries';
import enLocale  from 'i18n-iso-countries/langs/en.json' assert { type: 'json' };

countries.registerLocale(enLocale);

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MAX_CONTENTS = 100;

const DEDUP_REQUIRED_EVENTS = new Set(['Purchase', 'InitiateCheckout', 'AddToCart']);

// ─── HTTP KEEP-ALIVE AGENTS ───────────────────────────────────────────────────

const httpAgent  = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

// ─── FBC FORMATTER ────────────────────────────────────────────────────────────

/**
 * formatFbc
 *
 * Formats a raw fbclid value into the Meta-required fbc format.
 * Per Meta's official documentation, fbc MUST be: fb.1.{timestamp}.{fbclid}
 *
 * A raw fbclid string passed directly as fbc causes a 400 Bad Request.
 * The _fbc cookie (set by the Meta Pixel) already contains the formatted
 * value — use it directly when available. Only call this when you have
 * a raw fbclid that has not yet been formatted.
 *
 * @param {string} fbclid - Raw click ID from URL param or attribution
 * @returns {string|null} Formatted fbc string or null if fbclid is falsy
 */
const formatFbc = (fbclid) => {
  if (!fbclid || typeof fbclid !== 'string') return null;
  if (fbclid.startsWith('fb.1.')) return fbclid;
  // Meta uses millisecond timestamps in _fbc cookies
  return `fb.1.${Date.now()}.${fbclid}`;
};

// ─── FBP VALIDATION ───────────────────────────────────────────────────────────

/**
 * isValidFbp
 *
 * Validates the _fbp cookie format before sending to Meta.
 * Malformed fbp values reduce Event Match Quality (EMQ) significantly.
 * Expected format: fb.1.{timestamp}.{random_number}
 *
 * @param {string} value
 * @returns {boolean}
 */
const isValidFbp = (value) => {
  if (!value || typeof value !== 'string') return false;
  return /^fb\.1\.\d+\.\d+$/.test(value);
};

// ─── COUNTRY NORMALIZER ───────────────────────────────────────────────────────

/**
 * Common non-standard aliases not resolved by i18n-iso-countries.
 * Keys are lowercase. Values are the canonical English name the library
 * understands, or a direct ISO alpha-2 code for single-letter exceptions.
 *
 * Add entries here for any abbreviation or colloquial name your
 * user base submits that the library cannot resolve on its own.
 */
const COUNTRY_ALIASES = {
  'uae':                      'United Arab Emirates',
  'usa':                      'United States',
  'uk':                       'United Kingdom',
  'great britain':            'United Kingdom',
  'south korea':              'Korea, Republic of',
  'north korea':              "Korea, Democratic People's Republic of",
  'russia':                   'Russian Federation',
  'iran':                     'Iran, Islamic Republic of',
  'tanzania':                 'Tanzania, United Republic of',
  'bolivia':                  'Bolivia, Plurinational State of',
  'venezuela':                'Venezuela, Bolivarian Republic of',
  'syria':                    'Syrian Arab Republic',
  'laos':                     "Lao People's Democratic Republic",
  'moldova':                  'Moldova, Republic of',
  'vietnam':                  'Viet Nam',
  'taiwan':                   'Taiwan, Province of China',
};

/**
 * normalizeCountry
 *
 * Normalizes any country name, alias, or code to an ISO 3166-1 alpha-2
 * lowercase string, as required by Meta CAPI before hashing.
 *
 * Resolution order:
 *   1. Null / non-string guard → undefined
 *   2. Already a valid ISO alpha-2 code → lowercase passthrough
 *   3. Alias map lookup → resolve to canonical name, then continue
 *   4. i18n-iso-countries full-name lookup (English locale)
 *   5. Unresolvable → undefined (field omitted from payload)
 *
 * Sending "Nigeria" or "USA" un-normalized directly to Meta destroys
 * the country match signal and reduces Event Match Quality (EMQ).
 *
 * @param {string} country - Any country name, alias, or ISO code variant
 * @returns {string|undefined} ISO alpha-2 lowercase code, or undefined if unknown
 */
const normalizeCountry = (country) => {
  if (!country || typeof country !== 'string') return undefined;

  const trimmed    = country.trim();
  const lowerInput = trimmed.toLowerCase();

  // Already ISO alpha-2 — pass through normalized to lowercase
  if (/^[a-zA-Z]{2}$/.test(trimmed)) {
    const name = countries.getName(lowerInput, 'en');
    return name ? lowerInput : undefined;
  }

  // Resolve alias to canonical English name before library lookup
  const aliased    = COUNTRY_ALIASES[lowerInput];
  const lookupName = aliased || trimmed;

  const code = countries.getAlpha2Code(lookupName, 'en');

  if (!code) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Meta CAPI] Unknown country value — omitting from payload: "${country}"`);
    }
    return undefined;
  }

  return code.toLowerCase();
};

// ─── SAFE NUMBER ──────────────────────────────────────────────────────────────

/**
 * safeNumber
 *
 * Converts a value to a finite number, returning 0 as fallback.
 * Prevents NaN values in value/price fields — Meta sometimes silently
 * rejects or mishandles NaN in custom_data.
 *
 * @param {*} v
 * @returns {number}
 */
const safeNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ─── CURRENCY RESOLVER ────────────────────────────────────────────────────────

/**
 * resolveCurrency
 *
 * Resolves currency with a consistent priority chain.
 * Priority: explicit context currency → product/order currency → env default → 'USD'
 *
 * @param {...string} candidates - Currency values in priority order
 * @returns {string} Uppercase ISO 4217 currency code
 */
const resolveCurrency = (...candidates) => {
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.trim().length === 3) {
      return c.trim().toUpperCase();
    }
  }
  return process.env.DEFAULT_CURRENCY || 'USD';
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
 *   - Country: normalized to ISO alpha-2 before hashing (see normalizeCountry)
 *
 * @param {string|null|undefined} value
 * @param {string} type - 'default' | 'phone' | 'country'
 * @returns {string|undefined}
 */
const hash = (value, type = 'default') => {
  if (!value || typeof value !== 'string') return undefined;

  let normalized;

  if (type === 'country') {
    normalized = normalizeCountry(value);
    if (!normalized) return undefined;
  } else {
    normalized = value.trim().toLowerCase();
  }

  if (type === 'phone') {
    normalized = normalized.replace(/\D/g, '');
    if (normalized.length < 7) return undefined;
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
 * Match rate is directly correlated with conversion attribution accuracy.
 * A match rate below 40% indicates insufficient user data is being sent.
 *
 * @param {Object} userData
 * @param {string} userData.email      - User email address
 * @param {string} userData.phone      - User phone number (any format)
 * @param {string} userData.firstName  - User first name
 * @param {string} userData.lastName   - User last name
 * @param {string} userData.userId     - Internal user ID
 * @param {string} userData.fbp        - _fbp cookie value (NOT hashed, validated)
 * @param {string} userData.fbc        - Already-formatted fbc value (NOT hashed)
 * @param {string} userData.city       - City (from shipping info)
 * @param {string} userData.state      - State/region
 * @param {string} userData.country    - Country code or name (normalized before hash)
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

  const validatedFbp = isValidFbp(fbp) ? fbp : undefined;

  return {
    // Hashed PII
    ...(email     && { em:          hash(email) }),
    ...(phone     && { ph:          hash(phone, 'phone') }),
    ...(firstName && { fn:          hash(firstName) }),
    ...(lastName  && { ln:          hash(lastName) }),
    ...(userId    && { external_id: hash(userId) }),

    // Hashed geographic data
    ...(city    && { ct:      hash(city) }),
    ...(state   && { st:      hash(state) }),
    ...(country && { country: hash(country, 'country') }),
    // Spaces stripped before hashing (UK/Canada postal codes contain spaces)
    ...(zipCode && { zp:      hash(zipCode.replace(/\s+/g, '').toLowerCase()) }),

    // Un-hashed Meta cookies — MUST be sent as-is, hashing breaks matching
    ...(validatedFbp && { fbp: validatedFbp }),
    ...(fbc          && { fbc }),

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
 * Thrown errors carry a `retryable` boolean for queue worker classification.
 *
 * The queue worker (Phase 6) catches these throws and handles retry.
 * Controllers must never call this directly — always go through the queue.
 *
 * @param {string}  eventName                  - Meta standard event name (e.g. "Purchase")
 * @param {Object}  userData                   - PII data for user matching
 * @param {Object}  customData                 - Event-specific data (value, currency, etc.)
 * @param {Object}  context                    - Request context
 * @param {string}  context.eventId            - UUID for deduplication with browser Pixel
 * @param {string}  context.eventSourceUrl     - URL where the event occurred
 * @param {string}  context.actionSource       - "website" | "app" | "email"
 * @param {string}  context.clientIp           - Client IP from req.ip
 * @param {string}  context.userAgent          - User agent from req.headers
 * @param {boolean} context.marketingConsent   - GDPR/DMA consent gate
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
    marketingConsent,
  } = context;

  // Consent gate — do not send PII to Meta without marketing consent.
  // Required under GDPR, DMA (EU), UK GDPR, CPRA.
  // Returns (not throws) so queue workers don't retry consent skips.
  if (marketingConsent === false) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[Meta CAPI] "${eventName}" skipped — no marketing consent.`);
    }
    return { success: false, skipped: true, reason: 'no_consent', eventName };
  }

  // Hard fail on missing eventId for deduplication-critical events.
  // Without a matching eventId, Meta cannot deduplicate against the browser
  // Pixel event — resulting in double-counted conversions and corrupted ROAS.
  if (DEDUP_REQUIRED_EVENTS.has(eventName) && !eventId) {
    const err = new Error(`Meta CAPI ${eventName} missing required eventId for deduplication`);
    err.retryable = false;
    throw err;
  }

  const eventTime  = Math.floor(Date.now() / 1000);
  const resolvedUrl = eventSourceUrl || process.env.FRONTEND_URL || null;

  const payload = {
    data: [
      {
        event_name:    eventName,
        event_time:    eventTime,
        // event_id is the deduplication key — must match the browser fbq eventID.
        // Meta deduplicates same event_id within 48 hours.
        ...(eventId    && { event_id:         eventId }),
        ...(resolvedUrl && { event_source_url: resolvedUrl }),
        action_source: actionSource,
        user_data:     buildUserData({ ...userData, clientIp, userAgent }),
        custom_data:   customData,
      },
    ],
  };

  // test_event_code is only injected outside production, even if the env var
  // is accidentally set — prevents live conversions routing to the Test Events
  // tab and disappearing from Ads Manager optimization.
  if (process.env.NODE_ENV !== 'production' && process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const endpoint = process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0';
  const url      = `${endpoint}/${process.env.META_PIXEL_ID}/events`;

  let response;
  try {
    response = await axios.post(url, payload, {
      params:     { access_token: process.env.META_ACCESS_TOKEN },
      headers:    { 'Content-Type': 'application/json' },
      timeout:    8000,
      httpAgent,
      httpsAgent,
    });
  } catch (err) {
    const status  = err.response?.status;
    err.retryable = (
      status >= 500       ||
      status === 429      ||
      err.code === 'ECONNABORTED' ||
      err.code === 'ECONNRESET'   ||
      err.code === 'ETIMEDOUT'
    );
    if (status === 400 || status === 401 || status === 403) {
      err.retryable = false;
    }
    throw err;
  }

  if (response.data?.error) {
    const err     = new Error(`Meta CAPI error: ${JSON.stringify(response.data.error)}`);
    err.retryable = false;
    throw err;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      `[Meta CAPI] "${eventName}" sent successfully.`,
      process.env.META_TEST_EVENT_CODE
        ? `Check Test Events tab in Events Manager (code: ${process.env.META_TEST_EVENT_CODE})`
        : 'No test_event_code set — check production Events Manager Overview.',
      {
        eventsReceived: response.data?.events_received,
        fbtrace_id:     response.data?.fbtrace_id,
        messages:       response.data?.messages,
      }
    );
  }

  return {
    success:        true,
    statusCode:     response.status,
    eventsReceived: response.data?.events_received || 0,
    fbtrace_id:     response.data?.fbtrace_id      || null,
    messages:       response.data?.messages        || [],
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
 * fbc handling:
 *   Priority 1: context.fbc — the _fbc cookie value set by Meta Pixel.
 *               Already formatted as fb.1.{timestamp}.{fbclid}. Use as-is.
 *   Priority 2: context.attribution.fbclid — raw click ID from Phase 3.
 *               Must be formatted into fb.1.{timestamp}.{fbclid} via formatFbc().
 *               Passing raw fbclid as fbc causes a 400 Bad Request.
 *   If neither is present: omit fbc entirely — never fabricate it.
 *
 * @param {Object} order    - Mongoose Order document (post-save)
 * @param {Object} user     - Mongoose User document
 * @param {Object} context  - Analytics context from the event payload
 * @returns {Promise<Object>}
 */
export const sendMetaPurchase = async (order, user, context = {}) => {
  const { eventId, fbp, fbc, eventSourceUrl, clientIp, userAgent, attribution } = context;

  const resolvedFbc = fbc || formatFbc(attribution?.fbclid) || null;

  const userData = {
    email:     user.email,
    phone:     order.shippingInfo?.phoneNo,
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

  // Filter out items with unresolvable IDs — invalid IDs break Dynamic Ads catalog matching
  const validItems = (order.orderItems || []).filter(item => {
    const id = (item.product?._id || item.product)?.toString();
    return id && id !== 'unknown';
  });

  const contentIds = validItems.map(item => (item.product?._id || item.product).toString());

  const contents = validItems.slice(0, MAX_CONTENTS).map(item => ({
    id:         (item.product?._id || item.product).toString(),
    quantity:   safeNumber(item.quantity) || 1,
    item_price: safeNumber(item.price),
    title:      item.name || 'Product',
  }));

  const customData = {
    value:        safeNumber(order.totalPrice),
    currency:     resolveCurrency(order.paymentInfo?.currency, context.currency),
    content_ids:  contentIds,
    contents,
    content_type: 'product',
    num_items:    order.orderItems?.length || 0,
    order_id:     context.resolvedOrderReference,

    ...(order.discounts?.codes?.[0]?.code && {
      coupon_code: order.discounts.codes[0].code,
    }),

    attribution_confidence: attribution?.confidenceLevel || 'UNKNOWN',
  };

  return sendMetaEvent('Purchase', userData, customData, {
    eventId,
    eventSourceUrl,
    actionSource:     'website',
    clientIp,
    userAgent,
    marketingConsent: context.marketingConsent,
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
  const resolvedFbc = context.fbc || formatFbc(context.attribution?.fbclid) || null;

  const userData = {
    email:     user?.email,
    firstName: user?.firstName,
    lastName:  user?.lastName,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const contentIds = (checkout.items || [])
    .map(item => item.product?.toString())
    .filter(id => id && id !== 'unknown');

  const customData = {
    value:        safeNumber(checkout.pricing?.totalPrice),
    currency:     resolveCurrency(checkout.pricing?.currency, context.currency),
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
 * @param {Object} product  - Product document
 * @param {number} quantity - Quantity added
 * @param {Object} user     - User document (may be null for anonymous)
 * @param {Object} context  - Analytics context
 * @returns {Promise<Object>}
 */
export const sendMetaAddToCart = async (product, quantity, user, context = {}) => {
  const price       = safeNumber(product.pricing?.sale || product.pricing?.regular || product.price);
  const resolvedFbc = context.fbc || formatFbc(context.attribution?.fbclid) || null;

  const userData = {
    email:     user?.email,
    firstName: user?.firstName,
    lastName:  user?.lastName,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const customData = {
    value:        safeNumber(price) * safeNumber(quantity),
    currency:     resolveCurrency(product.currency, context.currency),
    content_ids:  [product._id?.toString()].filter(Boolean),
    content_name: product.name,
    content_type: 'product',
    contents: [{
      id:         product._id?.toString(),
      quantity:   safeNumber(quantity),
      item_price: price,
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
  const price       = safeNumber(product.pricing?.sale || product.pricing?.regular || product.price);
  const resolvedFbc = context.fbc || formatFbc(context.attribution?.fbclid) || null;

  const userData = {
    email:     user?.email,
    userId:    user?._id?.toString(),
    fbp:       context.fbp,
    fbc:       resolvedFbc,
    clientIp:  context.clientIp,
    userAgent: context.userAgent,
  };

  const customData = {
    value:            price,
    currency:         resolveCurrency(product.currency, context.currency),
    content_ids:      [product._id?.toString()].filter(Boolean),
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
  const resolvedFbc = context.fbc || formatFbc(context.attribution?.fbclid) || null;

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
    currency: resolveCurrency(context.currency),
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
 * Warns if META_TEST_EVENT_CODE is set in production — this causes all live
 * conversion events to route to the Test Events tab only, making them invisible
 * to Ads Manager optimization and attribution reporting.
 *
 * @returns {{ configured: boolean, missing: string[], testMode: boolean, productionWarnings: string[] }}
 */
export const checkMetaConfig = () => {
  const required = ['META_PIXEL_ID', 'META_ACCESS_TOKEN'];
  const missing  = required.filter(key => !process.env[key]);

  const productionWarnings = [];
  if (process.env.NODE_ENV === 'production' && process.env.META_TEST_EVENT_CODE) {
    productionWarnings.push(
      'META_TEST_EVENT_CODE is set in production — all conversion events will route to ' +
      'Test Events tab and will NOT feed Ads Manager optimization or attribution. Remove it immediately.'
    );
  }

  if (productionWarnings.length > 0) {
    console.warn('[Meta CAPI] Production configuration warnings:', productionWarnings);
  }

  return {
    configured:         missing.length === 0,
    missing,
    testMode:           !!process.env.META_TEST_EVENT_CODE,
    pixelId:            process.env.META_PIXEL_ID
                          ? `${process.env.META_PIXEL_ID.slice(0, 4)}****`
                          : null,
    endpoint:           process.env.META_CAPI_ENDPOINT || 'https://graph.facebook.com/v18.0',
    productionWarnings,
  };
};