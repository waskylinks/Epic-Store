/**
 * backend/services/analytics/analyticsOrchestrator.js
 *
 * Phase 9 — Analytics Orchestrator (Production)
 */

import { buildPurchaseEvent, buildCheckoutStepEvent, buildAnalyticsEvent, validateAnalyticsEvent, ANALYTICS_EVENTS } from '../../utils/analyticsEvent.js';
import { enqueueAnalyticsEvent } from '../../jobs/analyticsQueue.js';
import { sendGA4Purchase, sendGA4CheckoutStep, sendGA4Login, sendGA4SignUp } from './ga4Service.js';
import { sendMetaPurchase, sendMetaInitiateCheckout, sendMetaCompleteRegistration } from './metaCapiService.js';
import redisClient from '../../config/redis.js';
import crypto from 'crypto';

// ─── CONFIGURATION ─────────────────────────────────────────────────────────────

const ALLOWED_REFERRER_DOMAINS = process.env.ALLOWED_REFERRER_DOMAINS?.split(',').map(d => d.toLowerCase().trim()) || [
  'yourdomain.com',
  'staging.yourdomain.com',
  'localhost:3000'
];

const IDEMPOTENCY_TTL = {
  GA4: 72 * 3600,
  META: 48 * 3600,
  DEFAULT: 24 * 3600
};

const FAST_PATH_TIMEOUT_MS = parseInt(process.env.ANALYTICS_FAST_PATH_TIMEOUT_MS || '5000');

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

const PROVIDER_DISPATCHERS = {
  [ANALYTICS_EVENTS.PURCHASE]: {
    GA4: async (payload, context, signal) => {
      return await sendGA4Purchase(payload.order, context, signal);
    },
    META: async (payload, context, signal) => {
      return await sendMetaPurchase(payload.order, payload.user, context, signal);
    }
  },
  
  [ANALYTICS_EVENTS.BEGIN_CHECKOUT]: {
    GA4: async (payload, context, signal) => {
      return await sendGA4CheckoutStep('begin_checkout', payload.checkout, context, signal);
    },
    META: async (payload, context, signal) => {
      return await sendMetaInitiateCheckout(payload.checkout, payload.user, context, signal);
    }
  },
  
  [ANALYTICS_EVENTS.LOGIN]: {
    GA4: async (payload, context, signal) => {
      return await sendGA4Login(payload.method || 'email', context, signal);
    }
  },
  
  [ANALYTICS_EVENTS.SIGN_UP]: {
    GA4: async (payload, context, signal) => {
      return await sendGA4SignUp(payload.method || 'email', context, signal);
    },
    META: async (payload, context, signal) => {
      return await sendMetaCompleteRegistration(payload.user, context, signal);
    }
  },
  
  [ANALYTICS_EVENTS.EMAIL_VERIFIED]: {
    GA4: async (payload, context, signal) => {
      return await sendGA4SignUp(payload.method || 'email', context, signal);
    },
    META: async (payload, context, signal) => {
      return await sendMetaCompleteRegistration(payload.user, context, signal);
    }
  },
  
  [ANALYTICS_EVENTS.CHECKOUT_STEP]: {
    GA4: async (payload, context, signal) => {
      return await sendGA4CheckoutStep(payload.step, payload.checkout, context, signal);
    }
  }
};

// ─── IDEMPOTENCY HELPERS ───────────────────────────────────────────────────────

export const checkAndRecordIdempotency = async (provider, eventId, eventType) => {
  if (!eventId || eventId === 'pending') {
    return true;
  }
  
  const key = `analytics:sent:${provider}:${eventId}:${eventType}`;
  const ttl = IDEMPOTENCY_TTL[provider] || IDEMPOTENCY_TTL.DEFAULT;
  
  try {
    const result = await redisClient.set(key, '1', {
      NX: true,
      EX: ttl
    });
    
    return result === 'OK';
  } catch (err) {
    console.error('[Idempotency] Redis check failed:', err.message);
    return true;
  }
};

// ─── PII ENCRYPTION ───────────────────────────────────────────────────────────

const encryptPIIForQueue = (userData) => {
  if (!userData || !userData._id) return null;
  
  if (!ENCRYPTION_KEY) {
    return userData;
  }
  
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    const userString = JSON.stringify({
      _id: userData._id,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName
    });
    
    let encrypted = cipher.update(userString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: true,
      data: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (err) {
    console.error('[Analytics] PII encryption failed, falling back to plaintext PII:', err.message);
    // Preserve email for Meta EMQ matching
    return {
      _id: userData._id,
      email: userData.email,
      encryptionFailed: true
    };
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
    
    let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
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
    const url = new URL(referer);
    const hostname = url.hostname.toLowerCase();
    const host = url.host.toLowerCase();
    
    const isAllowed = ALLOWED_REFERRER_DOMAINS.some(allowedDomain => {
      const allowedLower = allowedDomain.toLowerCase();
      
      // Check exact match (handles localhost:3000)
      if (host === allowedLower) return true;
      if (hostname === allowedLower) return true;
      
      if (hostname.endsWith(`.${allowedLower}`)) {
        const prefix = hostname.slice(0, -allowedLower.length - 1);
        return /^[a-z0-9-]+$/.test(prefix);
      }
      
      return false;
    });
    
    return isAllowed ? referer : null;
  } catch (err) {
    console.warn('[Analytics] Invalid referer URL:', referer);
    return null;
  }
};

const getClientIp = (req) => {
  const headers = req?.headers || {};
  
  const cfConnectingIp = headers['cf-connecting-ip'];
  if (cfConnectingIp) return cfConnectingIp;
  
  const xff = headers['x-forwarded-for'];
  if (xff) {
    const ips = xff.split(',');
    return ips[0].trim();
  }
  
  const xri = headers['x-real-ip'];
  if (xri) return xri;
  
  return req?.ip || null;
};

const getMarketingConsent = (req) => {
  if (typeof req?.privacy?.marketingConsent === 'boolean') {
    return req.privacy.marketingConsent;
  }

  if (typeof req?.body?.marketingConsent === 'boolean') {
    return req.body.marketingConsent;
  }

  if (typeof req?.body?.marketingConsent === 'string') {
    return req.body.marketingConsent === 'true';
  }

  if (typeof req?.cookies?.marketingConsent === 'string') {
    return req.cookies.marketingConsent === 'true';
  }

  return false;
};

const generateEventId = () => {
  return crypto.randomUUID();
};

// ─── PAYLOAD NORMALIZATION ─────────────────────────────────────────────────────

const normalizeOrderItemsForQueue = (orderItems) => {
  if (!orderItems || !Array.isArray(orderItems)) return [];
  
  return orderItems.map(item => ({
    productId: item.productId?._id || item.productId,
    product: item.productId?._id || item.productId,
    quantity: item.quantity,
    price: item.price,
    name: item.name || item.title || 'Unknown'
  }));
};

const normalizeQueuePayload = (originalPayload) => {
  const payload = JSON.parse(JSON.stringify(originalPayload));
  
  if (payload.order?.orderItems) {
    payload.order.orderItems = normalizeOrderItemsForQueue(payload.order.orderItems);
  }
  
  if (payload.user) {
    payload.user = encryptPIIForQueue(payload.user);
  }
  
  if (payload.context?.attribution && (payload.source || payload.medium)) {
    delete payload.source;
    delete payload.medium;
    delete payload.campaign;
    delete payload.gclid;
    delete payload.fbclid;
    delete payload.confidenceLevel;
    delete payload.confidenceScore;
    delete payload.isReconstructed;
  }
  
  return payload;
};

// ─── FAST PATH DISPATCHER ──────────────────────────────────────────────────────

const dispatchFastPath = async (eventType, payload, context) => {
  const dispatchers = PROVIDER_DISPATCHERS[eventType];
  if (!dispatchers) {
    console.debug(`[Analytics FastPath] No dispatchers for ${eventType}`);
    return;
  }
  
  const promises = [];
  
  for (const [provider, dispatchFn] of Object.entries(dispatchers)) {
    const promise = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FAST_PATH_TIMEOUT_MS);
      
      try {
        const shouldProceed = await checkAndRecordIdempotency(
          provider,
          context.eventId,
          eventType
        );
        
        if (!shouldProceed) {
          console.debug(`[Analytics FastPath] Skipping ${provider} duplicate`);
          return;
        }
        
        const result = await dispatchFn(payload, context, controller.signal);
        
        clearTimeout(timeoutId);
        console.debug(`[Analytics FastPath] ${provider} ${eventType} sent`);
      } catch (err) {
        clearTimeout(timeoutId);
        
        if (err.name === 'AbortError') {
          console.error(`[Analytics FastPath] ${provider} ${eventType} cancelled due to timeout`);
        } else {
          console.error(`[Analytics FastPath] ${provider} ${eventType} failed:`, err.message);
        }
      }
    })();
    
    promises.push(promise);
  }
  
  void Promise.all(promises);
};

// ─── MAIN ORCHESTRATOR ────────────────────────────────────────────────────────

export const fireAnalyticsEvent = async (eventType, data, options = {}) => {
  const {
    fastPath = true,
    queue = true
  } = options;
  
  const { order, user, checkout, req, method, step } = data;
  
  const hasMarketingConsent = getMarketingConsent(req);
  const MARKETING_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    ANALYTICS_EVENTS.CHECKOUT_STEP
  ]);
  
  if (MARKETING_EVENTS.has(eventType) && !hasMarketingConsent) {
    console.info('[Analytics] Skipping marketing event due to missing consent:', eventType);
    return;
  }
  
  // Validate client-provided event ID format
  const clientEventId = req?.body?.analyticsEventId;
  const isValidUUID = clientEventId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientEventId);
  const analyticsEventId = isValidUUID ? clientEventId : generateEventId();
  
  const ga4ClientId = req?.body?.ga4ClientId || null;
  const fbp = req?.body?.fbp || req?.cookies?._fbp || null;
  const fbc = req?.body?.fbc || req?.cookies?._fbc || req?.attribution?.fbclid || null;
  
  let resolvedOrderReference = null;
  if (order?.analytics?.canonicalOrderReference) {
    resolvedOrderReference = order.analytics.canonicalOrderReference;
  } else if (order?.paymentInfo?.reference?.startsWith('ORD-')) {
    resolvedOrderReference = order.paymentInfo.reference;
  } else if (order?.paymentInfo?.reference) {
    resolvedOrderReference = order.paymentInfo.reference;
  } else {
    resolvedOrderReference = order?._id?.toString() || null;
  }
  
  let analyticsEvent;
  
  if (eventType === ANALYTICS_EVENTS.PURCHASE && order) {
    analyticsEvent = buildPurchaseEvent(order, req, analyticsEventId);
  } else if ((eventType === ANALYTICS_EVENTS.CHECKOUT_STEP || eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT) && checkout) {
    analyticsEvent = buildCheckoutStepEvent(
      step || (eventType === ANALYTICS_EVENTS.BEGIN_CHECKOUT ? 'begin_checkout' : data.step),
      checkout,
      req,
      analyticsEventId
    );
  } else {
    analyticsEvent = buildAnalyticsEvent({
      eventType,
      eventId: analyticsEventId,
      userId: user?._id?.toString() || req?.user?._id?.toString() || null,
      anonymousId: req?.anonymousId || null,
      sessionId: req?.sessionId || null,
      attribution: req?.attribution || {},
      clientTimestamp: req?.body?.clientTimestamp || null,
      source: 'server',
      properties: { method: method || null }
    });
  }
  
  const { valid, errors } = validateAnalyticsEvent(analyticsEvent);
  
  const STRICT_VALIDATION_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT
  ]);
  
  if (!valid && STRICT_VALIDATION_EVENTS.has(eventType)) {
    console.error('[Analytics] Invalid event schema - skipping dispatch:', {
      eventType,
      errors,
      eventId: analyticsEvent.event_id
    });
    return;
  }
  
  if (!valid) {
    const shouldLog = Math.random() < 0.1;
    if (shouldLog) {
      console.warn('[Analytics] Invalid event schema:', {
        eventType,
        errors: errors.slice(0, 3),
        eventId: analyticsEvent.event_id
      });
    }
  }
  
  const headers = req?.headers || {};
  const clientIp = getClientIp(req);
  const validatedReferer = validateReferer(headers.referer);
  
  const context = {
    eventId: analyticsEvent.event_id,
    userId: user?._id?.toString() || req?.user?._id?.toString() || null,
    clientId: ga4ClientId || req?.sessionId,
    sessionId: req?.sessionId || null,
    fbp,
    fbc,
    eventSourceUrl: validatedReferer || process.env.FRONTEND_URL,
    clientIp,
    userAgent: headers['user-agent'] || null,
    attribution: req?.attribution || {},
    resolvedOrderReference,
    marketingConsent: hasMarketingConsent
  };
  
  const attribution = req?.attribution || {};
  
  const rawPayload = {
    ...analyticsEvent,
    order: order ? {
      _id: order._id?.toString(),
      totalPrice: order.totalPrice,
      taxPrice: order.taxPrice,
      shippingPrice: order.shippingPrice,
      orderItems: order.orderItems,
      shippingInfo: order.shippingInfo,
      discounts: order.discounts,
      paymentInfo: {
        reference: order.paymentInfo?.reference,
        currency: order.paymentInfo?.currency,
        method: order.paymentInfo?.method,
        status: order.paymentInfo?.status
      },
      analytics: order.analytics
    } : null,
    user: user ? {
      _id: user._id?.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    } : null,
    checkout,
    context,
    step: step || data.step || null,
    method: method || null,
    source: attribution.source || null,
    medium: attribution.medium || null,
    campaign: attribution.campaign || null,
    gclid: attribution.gclid || null,
    fbclid: attribution.fbclid || null,
    confidenceLevel: attribution.confidenceLevel || null,
    confidenceScore: attribution.confidenceScore || null,
    isReconstructed: attribution.isReconstructed || false
  };
  
  const encryptedQueuePayload = normalizeQueuePayload(rawPayload);
  
  const HIGH_VALUE_EVENTS = new Set([
    ANALYTICS_EVENTS.PURCHASE,
    ANALYTICS_EVENTS.BEGIN_CHECKOUT,
    ANALYTICS_EVENTS.LOGIN,
    ANALYTICS_EVENTS.SIGN_UP,
    ANALYTICS_EVENTS.EMAIL_VERIFIED
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
        error: err.message
      });
      // Don't rethrow - analytics should not block business transactions
    }
  }
};

// ─── CONVENIENCE WRAPPERS ─────────────────────────────────────────────────────

export const firePurchaseEvent = (order, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.PURCHASE, { order, user, req }, options);

export const fireCheckoutStartEvent = (checkout, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.BEGIN_CHECKOUT, { checkout, user, req }, options);

export const fireLoginEvent = (method, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.LOGIN, { method, user, req }, { 
    fastPath: true, 
    queue: true,
    ...options 
  });

export const fireSignUpEvent = (method, user, req, options = {}) =>
  fireAnalyticsEvent(ANALYTICS_EVENTS.EMAIL_VERIFIED, { method, user, req }, { 
    fastPath: true, 
    queue: true,
    ...options 
  });

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

export const getOrchestratorHealth = async () => {
  const checks = {
    redis: false,
    encryptionConfigured: !!ENCRYPTION_KEY
  };
  
  try {
    if (redisClient) {
      await redisClient.ping();
      checks.redis = true;
    }
  } catch (err) {
    console.error('[Analytics] Redis health check failed:', err.message);
  }
  
  return {
    status: checks.redis ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks
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