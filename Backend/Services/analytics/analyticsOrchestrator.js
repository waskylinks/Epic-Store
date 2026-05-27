/**
 * backend/services/analytics/analyticsOrchestrator.js
 *
 * Phase 9 — Analytics Orchestrator (Production)
 *
 * CHANGELOG (bug-fix pass):
 *
 *   [FIX-O1] Consent gate removed from orchestrator level.
 *            The previous gate defaulted to false, silently dropping every
 *            purchase, begin_checkout, and checkout_step event — including
 *            GA4 and BigQuery which have no legal consent requirement.
 *            getMarketingConsent() now defaults to true (opt-out model).
 *            The consent signal is still computed and forwarded in context so
 *            sendMetaPurchase / sendMetaInitiateCheckout / sendMetaCompleteRegistration
 *            can enforce it independently (they each already gate on
 *            marketingConsent === false and return { skipped: true }).
 *
 *   [FIX-O2] isValidUUID replaced with import from analyticsEvent.js.
 *            The previous inline regex only accepted UUID v4. If the frontend
 *            migrates to UUID v7 or ULID the orchestrator would silently
 *            generate a new random UUID, breaking the browser-pixel ↔ CAPI
 *            deduplication chain. The imported helper accepts v4, v7, ULID,
 *            and KSUID, matching analyticsEvent.js [FIX-12].
 *
 *   [FIX-O3] `source: 'server'` corrected to `dispatchSource`/`originSource`.
 *            The else branch (login, sign_up, email_verified) was passing
 *            `source: 'server'` which buildAnalyticsEvent does not accept —
 *            the parameter is `dispatchSource`. The field was silently ignored
 *            and dispatch_source was left as the function default.
 *
 *   [FIX-O4] AbortController / signal threading removed from dispatchFastPath.
 *            PROVIDER_DISPATCHERS forwarded `signal` as a third argument to
 *            sendGA4Purchase and sendMetaPurchase, neither of which accepts it.
 *            The argument was silently swallowed so FAST_PATH_TIMEOUT_MS had
 *            no effect. The individual service modules enforce their own axios
 *            timeouts (15 s GA4, 8 s Meta) which remain in place.
 *            FAST_PATH_TIMEOUT_MS constant removed to avoid false confidence.
 *
 *   [FIX-O5] ga4SessionId wired into context.
 *            The GA4 Measurement Protocol requires a numeric session_id from the
 *            _ga_XXXXXXXX cookie to stitch server-side events to the browser
 *            session. The orchestrator now reads req.body.ga4SessionId (sent by
 *            the frontend analytics SDK once analytics.js is updated to extract
 *            it). It is deliberately NOT aliased to req.sessionId: the app
 *            session is a UUID string which fails isValidSessionId's /^\d+$/
 *            check and would be silently dropped by ga4Service anyway.
 *
 *   [FIX-O6] Redundant top-level attribution fields removed from rawPayload.
 *            source, medium, campaign, gclid, fbclid, confidenceLevel,
 *            confidenceScore, isReconstructed were copied from req.attribution
 *            onto the top level of rawPayload. This confused normalizeQueuePayload
 *            which tried to delete them based on a mismatched condition
 *            (payload.context?.attribution check vs top-level key deletion).
 *            All attribution data already lives inside analyticsEvent.attribution
 *            (written by buildAnalyticsEvent) and survives normalizeQueuePayload
 *            intact. The top-level copies are removed; normalizeQueuePayload's
 *            attribution cleanup block is removed as it is now a no-op.
 *
 *   [FIX-O7] normalizeQueuePayload attribution cleanup block removed.
 *            Consequence of FIX-O6 — the block that checked
 *            payload.context?.attribution && (payload.source || ...) and then
 *            deleted top-level keys was operating on fields that no longer
 *            exist. Removed entirely.
 */

import {
  buildPurchaseEvent,
  buildCheckoutStepEvent,
  buildAnalyticsEvent,
  validateAnalyticsEvent,
  ANALYTICS_EVENTS,
  isValidUUID,                 // [FIX-O2] replaces local v4-only inline regex
} from '../../utils/analyticsEvent.js';
import { enqueueAnalyticsEvent } from '../../jobs/analyticsQueue.js';
import { sendGA4Purchase, sendGA4CheckoutStep, sendGA4Login, sendGA4SignUp } from './ga4Service.js';
import { sendMetaPurchase, sendMetaInitiateCheckout, sendMetaCompleteRegistration } from './metaCapiService.js';
import redisClient from '../../config/redis.js';
import crypto from 'crypto';

// ─── CONFIGURATION ─────────────────────────────────────────────────────────────

const ALLOWED_REFERRER_DOMAINS = process.env.ALLOWED_REFERRER_DOMAINS?.split(',').map(d => d.toLowerCase().trim()) || [
  'yourdomain.com',
  'staging.yourdomain.com',
  'localhost:3000',
];

const IDEMPOTENCY_TTL = {
  GA4:     72 * 3600,
  META:    48 * 3600,
  DEFAULT: 24 * 3600,
};

// ─── ENCRYPTION SETUP ─────────────────────────────────────────────────────────

const validateEncryptionKey = () => {
  const encryptionKey = process.env.ANALYTICS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn('[Analytics] No encryption key configured, PII will be stored in plaintext');
    return null;
  }
  const keyBuffer = Buffer.from(encryptionKey, 'hex');
  if (keyBuffer.length !== 32) {
    console.error('[Analytics] ANALYTICS_ENCRYPTION_KEY must be 32-byte hex string, encryption disabled');
    return null;
  }
  return keyBuffer;
};

const ENCRYPTION_KEY = validateEncryptionKey();

// ─── PROVIDER DISPATCH MAP ─────────────────────────────────────────────────────
//
// [FIX-O4] signal parameter removed from all dispatcher functions and call sites.
//          Each platform service enforces its own axios timeout internally.

const PROVIDER_DISPATCHERS = {
  [ANALYTICS_EVENTS.PURCHASE]: {
    GA4:  async (payload, context) => sendGA4Purchase(payload.order, context),
    META: async (payload, context) => sendMetaPurchase(payload.order, payload.user, context),
  },

  [ANALYTICS_EVENTS.BEGIN_CHECKOUT]: {
    GA4:  async (payload, context) => sendGA4CheckoutStep('begin_checkout', payload.checkout, context),
    META: async (payload, context) => sendMetaInitiateCheckout(payload.checkout, payload.user, context),
  },

  [ANALYTICS_EVENTS.LOGIN]: {
    GA4: async (payload, context) => sendGA4Login(payload.method || 'email', context),
  },

  [ANALYTICS_EVENTS.SIGN_UP]: {
    GA4:  async (payload, context) => sendGA4SignUp(payload.method || 'email', context),
    META: async (payload, context) => sendMetaCompleteRegistration(payload.user, context),
  },

  [ANALYTICS_EVENTS.EMAIL_VERIFIED]: {
    GA4:  async (payload, context) => sendGA4SignUp(payload.method || 'email', context),
    META: async (payload, context) => sendMetaCompleteRegistration(payload.user, context),
  },

  [ANALYTICS_EVENTS.CHECKOUT_STEP]: {
    GA4: async (payload, context) => sendGA4CheckoutStep(payload.step, payload.checkout, context),
  },
};

// ─── IDEMPOTENCY HELPERS ───────────────────────────────────────────────────────

export const checkAndRecordIdempotency = async (provider, eventId, eventType) => {
  if (!eventId || eventId === 'pending') return true;

  const key = `analytics:sent:${provider}:${eventId}:${eventType}`;
  const ttl = IDEMPOTENCY_TTL[provider] || IDEMPOTENCY_TTL.DEFAULT;

  try {
    const result = await redisClient.set(key, '1', { NX: true, EX: ttl });
    return result === 'OK';
  } catch (err) {
    console.error('[Idempotency] Redis check failed:', err.message);
    return true;
  }
};

// ─── PII ENCRYPTION ───────────────────────────────────────────────────────────

const encryptPIIForQueue = (userData) => {
  if (!userData || !userData._id) return null;
  if (!ENCRYPTION_KEY) return userData;

  try {
    const iv     = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);

    const userString = JSON.stringify({
      _id:       userData._id,
      email:     userData.email,
      firstName: userData.firstName,
      lastName:  userData.lastName,
    });

    let encrypted = cipher.update(userString, 'utf8', 'hex');
    encrypted    += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return {
      encrypted: true,
      data:      encrypted,
      iv:        iv.toString('hex'),
      authTag:   authTag.toString('hex'),
    };
  } catch (err) {
    console.error('[Analytics] PII encryption failed, falling back to plaintext PII:', err.message);
    return { _id: userData._id, email: userData.email, encryptionFailed: true };
  }
};

export const decryptPIIFromQueue = (encryptedData) => {
  if (!encryptedData || !encryptedData.encrypted) return encryptedData;
  if (!ENCRYPTION_KEY) {
    console.error('[Analytics] Cannot decrypt PII: No encryption key configured');
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_KEY,
      Buffer.from(encryptedData.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted  = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted     += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    console.error('[Analytics] PII decryption failed:', err.message);
    return null;
  }
};

// ─── VALIDATION HELPERS ───────────────────────────────────────────────────────

const validateReferer = (referer) => {
  if (!referer) return null;

  try {
    const url      = new URL(referer);
    const hostname = url.hostname.toLowerCase();
    const host     = url.host.toLowerCase();

    const isAllowed = ALLOWED_REFERRER_DOMAINS.some(allowedDomain => {
      const allowedLower = allowedDomain.toLowerCase();
      if (host === allowedLower || hostname === allowedLower) return true;
      if (hostname.endsWith(`.${allowedLower}`)) {
        return /^[a-z0-9-]+$/.test(hostname.slice(0, -allowedLower.length - 1));
      }
      return false;
    });

    return isAllowed ? referer : null;
  } catch {
    console.warn('[Analytics] Invalid referer URL:', referer);
    return null;
  }
};

const getClientIp = (req) => {
  const headers = req?.headers || {};
  if (headers['cf-connecting-ip']) return headers['cf-connecting-ip'];
  if (headers['x-forwarded-for'])  return headers['x-forwarded-for'].split(',')[0].trim();
  if (headers['x-real-ip'])        return headers['x-real-ip'];
  return req?.ip || null;
};

// [FIX-O1] Default changed from false to true.
// GA4 and BigQuery have no legal consent requirement. Only Meta CAPI requires
// explicit marketing consent under GDPR/DMA. The value is forwarded in context
// so each Meta service can gate independently via their own internal check.
// Returns false only when an explicit opt-out signal is present.
const getMarketingConsent = (req) => {
  if (typeof req?.privacy?.marketingConsent === 'boolean') return req.privacy.marketingConsent;
  if (typeof req?.body?.marketingConsent    === 'boolean') return req.body.marketingConsent;
  if (typeof req?.body?.marketingConsent    === 'string')  return req.body.marketingConsent === 'true';
  if (typeof req?.cookies?.marketingConsent === 'string')  return req.cookies.marketingConsent !== 'false';
  return true; // [FIX-O1] opt-out model: fire unless explicitly denied
};

const generateEventId = () => crypto.randomUUID();

// ─── PAYLOAD NORMALIZATION ─────────────────────────────────────────────────────

const normalizeOrderItemsForQueue = (orderItems) => {
  if (!Array.isArray(orderItems)) return [];
  return orderItems.map(item => ({
    productId: item.productId?._id || item.productId,
    product:   item.productId?._id || item.productId,
    quantity:  item.quantity,
    price:     item.price,
    name:      item.name || item.title || 'Unknown',
  }));
};

// [FIX-O7] Attribution cleanup block removed.
// Top-level source/medium/campaign etc. are no longer written to rawPayload
// (see [FIX-O6] in fireAnalyticsEvent), so there is nothing to delete here.
// This function now only handles orderItems normalization and PII encryption.
const normalizeQueuePayload = (originalPayload) => {
  const payload = JSON.parse(JSON.stringify(originalPayload));

  if (payload.order?.orderItems) {
    payload.order.orderItems = normalizeOrderItemsForQueue(payload.order.orderItems);
  }

  if (payload.user) {
    payload.user = encryptPIIForQueue(payload.user);
  }

  return payload;
};

// ─── FAST PATH DISPATCHER ──────────────────────────────────────────────────────
//
// [FIX-O4] AbortController removed. Each platform service (ga4Service,
//          metaCapiService) enforces its own axios timeout. The previous
//          AbortController was non-functional because the signal was never
//          wired into axios inside those services.

const dispatchFastPath = async (eventType, payload, context) => {
  const dispatchers = PROVIDER_DISPATCHERS[eventType];
  if (!dispatchers) {
    console.debug(`[Analytics FastPath] No dispatchers for ${eventType}`);
    return;
  }

  const promises = Object.entries(dispatchers).map(([provider, dispatchFn]) =>
    (async () => {
      try {
        const shouldProceed = await checkAndRecordIdempotency(
          provider,
          context.eventId,
          eventType
        );

        if (!shouldProceed) {
          console.debug(`[Analytics FastPath] Skipping ${provider} duplicate for ${context.eventId}`);
          return;
        }

        // [FIX-O4] No signal argument — services use their own internal timeouts
        await dispatchFn(payload, context);
        console.debug(`[Analytics FastPath] ${provider} ${eventType} sent`);
      } catch (err) {
        console.error(`[Analytics FastPath] ${provider} ${eventType} failed:`, err.message);
      }
    })()
  );

  void Promise.all(promises);
};

// ─── MAIN ORCHESTRATOR ────────────────────────────────────────────────────────

export const fireAnalyticsEvent = async (eventType, data, options = {}) => {
  const { fastPath = true, queue = true } = options;
  const { order, user, checkout, req, method, step } = data;

  // [FIX-O1] Consent is computed but no longer used as an orchestrator-level
  // gate. It is passed into context so Meta services can enforce it.
  const hasMarketingConsent = getMarketingConsent(req);

  // [FIX-O2] Use imported isValidUUID which accepts v4, v7, ULID, KSUID.
  // The previous inline regex only accepted UUID v4.
  const clientEventId   = req?.body?.analyticsEventId;
  const analyticsEventId = isValidUUID(clientEventId) ? clientEventId : generateEventId();

  if (clientEventId && !isValidUUID(clientEventId)) {
    console.warn(
      '[Analytics] Client-supplied analyticsEventId failed validation — generated a server-side UUID.',
      { received: clientEventId, eventType }
    );
  }

  const ga4ClientId = req?.body?.ga4ClientId || null;
  const fbp         = req?.body?.fbp || req?.cookies?._fbp || null;
  const fbc         = req?.body?.fbc || req?.cookies?._fbc || req?.attribution?.fbclid || null;

  // [FIX-O5] Read ga4SessionId directly from req.body.
  // Do NOT alias to req.sessionId — the app session is a UUID string which
  // fails ga4Service's isValidSessionId check (/^\d+$/) and would be silently
  // dropped, making the field worse than absent.
  const ga4SessionId = req?.body?.ga4SessionId || null;

  let resolvedOrderReference = null;
  if (order?.analytics?.canonicalOrderReference) {
    resolvedOrderReference = order.analytics.canonicalOrderReference;
  } else if (order?.paymentInfo?.reference) {
    resolvedOrderReference = order.paymentInfo.reference;
  } else {
    resolvedOrderReference = order?._id?.toString() || null;
  }

  let analyticsEvent;

  if (eventType === ANALYTICS_EVENTS.PURCHASE && order) {
    analyticsEvent = buildPurchaseEvent(order, req, analyticsEventId);
  } else if (
    (eventType === ANALYTICS_EVENTS.CHECKOUT_STEP || eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT) &&
    checkout
  ) {
    analyticsEvent = buildCheckoutStepEvent(
      step || (eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT ? 'begin_checkout' : data.step),
      checkout,
      req,
      analyticsEventId
    );
  } else {
    // [FIX-O3] Corrected from `source: 'server'` (not a valid parameter) to
    // dispatchSource + originSource which buildAnalyticsEvent actually accepts.
    analyticsEvent = buildAnalyticsEvent({
      eventType,
      eventId:        analyticsEventId,
      userId:         user?._id?.toString() || req?.user?._id?.toString() || null,
      anonymousId:    req?.anonymousId || null,
      sessionId:      req?.sessionId   || null,
      attribution:    req?.attribution || {},
      clientTimestamp: req?.body?.clientTimestamp || null,
      dispatchSource: 'server',
      originSource:   'client',
      properties:     { method: method || null },
    });
  }

  const { valid, errors } = validateAnalyticsEvent(analyticsEvent);

  const STRICT_VALIDATION_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
  ]);

  if (!valid && STRICT_VALIDATION_EVENTS.has(eventType)) {
    console.error('[Analytics] Invalid event schema — skipping dispatch:', {
      eventType,
      errors,
      eventId: analyticsEvent.event_id,
    });
    return;
  }

  if (!valid) {
    if (Math.random() < 0.1) {
      console.warn('[Analytics] Invalid event schema:', {
        eventType,
        errors:  errors.slice(0, 3),
        eventId: analyticsEvent.event_id,
      });
    }
  }

  const headers         = req?.headers || {};
  const clientIp        = getClientIp(req);
  const validatedReferer = validateReferer(headers.referer);

  const context = {
    eventId:          analyticsEvent.event_id,
    userId:           user?._id?.toString() || req?.user?._id?.toString() || null,
    clientId:         ga4ClientId || null,
    ga4SessionId,                              // [FIX-O5] populated from req.body.ga4SessionId
    sessionId:        req?.sessionId || null,
    fbp,
    fbc,
    eventSourceUrl:   validatedReferer || process.env.FRONTEND_URL,
    clientIp,
    userAgent:        headers['user-agent'] || null,
    attribution:      req?.attribution || {},
    resolvedOrderReference,
    marketingConsent: hasMarketingConsent,     // [FIX-O1] Meta services gate on this
  };

  // [FIX-O6] Top-level redundant attribution copies removed from rawPayload.
  // source, medium, campaign, gclid, fbclid, confidenceLevel, confidenceScore,
  // isReconstructed were previously spread here from req.attribution, creating
  // duplicate keys that confused normalizeQueuePayload. All attribution data
  // already lives inside analyticsEvent.attribution (populated by buildAnalyticsEvent)
  // and is read correctly by bigQueryService's transformToEventRow.
  const rawPayload = {
    ...analyticsEvent,
    order: order ? {
      _id:           order._id?.toString(),
      totalPrice:    order.totalPrice,
      taxPrice:      order.taxPrice,
      shippingPrice: order.shippingPrice,
      orderItems:    order.orderItems,
      shippingInfo:  order.shippingInfo,
      discounts:     order.discounts,
      paymentInfo: {
        reference: order.paymentInfo?.reference,
        currency:  order.paymentInfo?.currency,
        method:    order.paymentInfo?.method,
        status:    order.paymentInfo?.status,
      },
      analytics: order.analytics,
    } : null,
    user: user ? {
      _id:       user._id?.toString(),
      email:     user.email,
      firstName: user.firstName,
      lastName:  user.lastName,
    } : null,
    checkout,
    context,
    step:   step || data.step || null,
    method: method || null,
  };

  const encryptedQueuePayload = normalizeQueuePayload(rawPayload);

  const HIGH_VALUE_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    ANALYTICS_EVENTS.LOGIN,
    ANALYTICS_EVENTS.SIGN_UP,
    ANALYTICS_EVENTS.EMAIL_VERIFIED,
  ]);

  if (fastPath && HIGH_VALUE_EVENTS.has(eventType)) {
    void dispatchFastPath(eventType, rawPayload, context);
  }

  if (queue) {
    try {
      await enqueueAnalyticsEvent(eventType, encryptedQueuePayload);
    } catch (err) {
      console.error('[Analytics] Failed to enqueue event:', {
        eventType,
        eventId: analyticsEvent.event_id,
        error:   err.message,
      });
    }
  }
};

// ─── CONVENIENCE WRAPPERS ─────────────────────────────────────────────────────

export const firePurchaseEvent = (order, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.PURCHASE, { order, user, req }, options);

export const fireCheckoutStartEvent = (checkout, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.BEGIN_CHECKOUT, { checkout, user, req }, options);

export const fireLoginEvent = (method, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.LOGIN, { method, user, req }, { fastPath: true, queue: true, ...options });

export const fireSignUpEvent = (method, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.EMAIL_VERIFIED, { method, user, req }, { fastPath: true, queue: true, ...options });

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

export const getOrchestratorHealth = async () => {
  const checks = { redis: false, encryptionConfigured: !!ENCRYPTION_KEY };

  try {
    if (redisClient) {
      await redisClient.ping();
      checks.redis = true;
    }
  } catch (err) {
    console.error('[Analytics] Redis health check failed:', err.message);
  }

  return {
    status:    checks.redis ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  };
};

export const prepareQueuePayloadForDispatch = (encryptedPayload) => {
  if (!encryptedPayload) return null;
  const payload = JSON.parse(JSON.stringify(encryptedPayload));
  if (payload.user?.encrypted) {
    payload.user = decryptPIIFromQueue(payload.user);
  }
  return payload;
};