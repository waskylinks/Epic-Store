// backend/controllers/verifyPaymentController.js

import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js";
import { createReceiptIfNotExists } from "../Services/receipt.service.js";
import { deleteCachePattern } from '../utils/redis.js';
import {
  createPaymentSession,
  getPaymentSession,
  deletePaymentSession,
  createSessionAlias
} from "../Services/paymentSession.service.js";
import Order from '../models/order-model.js';
import User from '../models/userModel.js';
import Discount from '../models/discount-model.js';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
import { syncDiscountAfterOrderCreated, syncBaselineAfterNonDiscountedOrder } from '../Services/discount-analytics-service.js';
import Checkout from '../models/checkout-model.js';
import { calculateFraudRisk } from '../utils/fraudCheck.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';


import { buildPurchaseEvent } from '../utils/analyticsEvent.js';
import { enqueueAnalyticsEvent } from '../jobs/analyticsQueue.js';
import { stitchIdentityFromRequest } from '../middleware/identityMiddleware.js';

// ============================================
// CONSTANTS
// ============================================

const SESSION_EXPIRY_MS = 30 * 60 * 1000;

const AMOUNT_TOLERANCE = {
  USD: 0.02,
  NGN: 0.05,
  GHS: 0.05,
  DEFAULT: 0.05
};

const SUPPORTED_CURRENCIES = ['USD', 'NGN', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'];

// ============================================
// SOURCE NORMALIZATION
// ============================================

const VALID_SOURCES = new Set([
  'direct', 'organic', 'paid', 'referral', 'email', 'social',
  'google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex',
  'facebook', 'instagram', 'meta', 'twitter', 'x', 'tiktok',
  'snapchat', 'pinterest', 'linkedin', 'youtube', 'reddit',
  'whatsapp', 'telegram', 'threads', 'discord',
  'google_ads', 'meta_ads', 'tiktok_ads', 'bing_ads', 'twitter_ads',
  'linkedin_ads', 'pinterest_ads', 'snapchat_ads', 'amazon_ads',
  'taboola', 'outbrain', 'criteo',
  'klaviyo', 'mailchimp', 'sendgrid', 'hubspot', 'newsletter',
  'affiliate', 'influencer', 'partner',
  'dark_social', 'returning_direct', 'likely_email_or_social',
  'likely_retargeting', 'likely_organic',
  'other',
]);

const normalizeSource = (source) => {
  if (!source) return 'direct';
  const lower = source.toLowerCase().trim();
  if (VALID_SOURCES.has(lower)) return lower;
  return 'other';
};

// ============================================
// HELPERS
// ============================================

const generateOrderReference = () =>
  `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 14).toUpperCase()}`;

const invalidatePaymentCaches = async () => {
  try {
    await Promise.all([
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('analytics_*'),
      deleteCachePattern('customer_*'),
      deleteCachePattern('fraud_analytics*'),
      deleteCachePattern('payment_*')
    ]);
  } catch {
    // intentionally swallowed
  }
};

const verifyWithGateway = async (paymentService, gateway, reference, transactionId = null) => {
  let raw = null;
  let verified = false;

  if (gateway === 'stripe') {
    raw = await paymentService.verifyStripeTransaction(reference);
    verified = raw.status === "succeeded";
  } else if (gateway === 'paystack') {
    raw = await paymentService.verifyPaystackTransaction(reference);
    verified = raw.status === "success";
  } else if (gateway === 'flutterwave') {
    const lookupRef = transactionId ? String(transactionId) : reference;
    raw = await paymentService.verifyFlutterwaveTransaction(lookupRef);
    verified = raw.status === "successful";
  } else {
    throw new Error(`Unsupported gateway: ${gateway}`);
  }

  if (!verified) {
    throw new Error(`Gateway returned non-success status: "${raw?.status ?? 'unknown'}"`);
  }

  let amount, currency;
  if (gateway === 'stripe') {
    amount = raw.amount / 100;
    currency = raw.currency.toUpperCase();
  } else if (gateway === 'paystack') {
    amount = raw.amount / 100;
    currency = raw.currency;
  } else if (gateway === 'flutterwave') {
    amount = parseFloat(raw.amount);
    currency = raw.currency;
  }

  return { verified, amount, currency, id: raw.id || raw.tx_id, raw };
};

const buildPaymentMeta = (gateway, raw) => {
  if (gateway === 'stripe') {
    const paymentMethod = raw.charges?.data[0]?.payment_method_details;
    return {
      channel: paymentMethod?.type || "card",
      customer: { email: raw.receipt_email },
      cardDetails: paymentMethod?.card
        ? {
            last4: paymentMethod.card.last4,
            brand: paymentMethod.card.brand,
            expMonth: paymentMethod.card.exp_month,
            expYear: paymentMethod.card.exp_year
          }
        : undefined,
      customMetadata: raw.metadata,
      raw
    };
  }

  if (gateway === 'paystack') {
    return {
      channel: raw.channel,
      ipAddress: raw.ip_address,
      customer: raw.customer,
      authorization: raw.authorization,
      cardDetails: {
        last4: raw.authorization?.last4,
        brand: raw.authorization?.brand,
        expMonth: raw.authorization?.exp_month,
        expYear: raw.authorization?.exp_year
      },
      customMetadata: raw.metadata,
      raw
    };
  }

  if (gateway === 'flutterwave') {
    return {
      channel: raw.payment_type,
      ipAddress: raw.ip,
      customer: raw.customer,
      cardDetails: raw.card
        ? {
            last4: raw.card.last_4digits,
            brand: raw.card.type,
            expMonth: raw.card.expiry?.split('/')[0],
            expYear: raw.card.expiry?.split('/')[1]
          }
        : undefined,
      customMetadata: raw.meta,
      raw
    };
  }

  return {};
};

// ============================================
// INITIALIZE PAYMENT
// @route POST /api/v1/payment/initialize
// @access Private
// ============================================
export const initializePaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const {
    gateway,
    currency,
    shippingInfo,
    cartItems,
    cartPricing,
    discountSnapshot = null,
  } = req.body;

  if (!gateway || !currency || !shippingInfo || !cartItems || cartItems.length === 0) {
    return next(new HandleError(
      "Missing required fields: gateway, currency, shippingInfo, cartItems", 400
    ));
  }

  if (!cartPricing || typeof cartPricing.totalPrice !== 'number' || cartPricing.totalPrice <= 0) {
    return next(new HandleError(
      "cartPricing is required and must contain a valid totalPrice. " +
      "Complete the cart/checkout step before initialising payment.", 400
    ));
  }

  const { itemPrice, taxPrice, shippingPrice, totalPrice } = cartPricing;
  if (
    typeof itemPrice     !== 'number' ||
    typeof taxPrice      !== 'number' ||
    typeof shippingPrice !== 'number' ||
    typeof totalPrice    !== 'number'
  ) {
    return next(new HandleError(
      "cartPricing must include numeric itemPrice, taxPrice, shippingPrice and totalPrice", 400
    ));
  }

  const normalizedCurrency = currency.toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
    return next(new HandleError(
      `Unsupported currency: ${currency}. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`, 400
    ));
  }

  const user = await User.findById(userId).select('email name country createdAt');
  if (!user) return next(new HandleError("User not found", 404));

  const Product = (await import('../models/product-model.js')).default;

  const productIds = cartItems.map(item => {
    if (!item.product) throw new HandleError('Invalid cart item: missing product ID', 400);
    if (!item.quantity || item.quantity < 1 || !Number.isInteger(Number(item.quantity))) {
      throw new HandleError(`Invalid quantity for product ${item.product}`, 400);
    }
    return item.product;
  });

  const products = await Product.find({ _id: { $in: productIds } })
    .select('_id name price pricing stock inventory category images status');

  if (products.length !== productIds.length) {
    const foundIds = products.map(p => p._id.toString());
    const missing  = productIds.filter(id => !foundIds.includes(id.toString()));
    return next(new HandleError(`Products not found: ${missing.join(', ')}`, 404));
  }

  const productMap = {};
  products.forEach(p => { productMap[p._id.toString()] = p; });

  const orderItems = [];
  for (const cartItem of cartItems) {
    const product  = productMap[cartItem.product.toString()];
    const quantity = Number(cartItem.quantity);

    if (product.status !== 'published') {
      return next(new HandleError(`Product "${product.name}" is no longer available`, 400));
    }

    const availableStock = product.inventory?.stock ?? product.stock ?? 0;
    if (availableStock < quantity) {
      return next(new HandleError(
        `Insufficient stock for "${product.name}". Available: ${availableStock}, Requested: ${quantity}`,
        400
      ));
    }

    let unitPrice = 0;
    if (product.pricing?.sale   > 0) unitPrice = product.pricing.sale;
    else if (product.pricing?.regular > 0) unitPrice = product.pricing.regular;
    else if (product.price      > 0) unitPrice = product.price;
    else return next(new HandleError(`Product "${product.name}" has no valid price`, 500));

    const eligibleCats     = discountSnapshot?.eligibleProductCategories ?? [];
    const isCategoryScoped = eligibleCats.length > 0;
    const discountAmt      = Number(discountSnapshot?.discountAmount ?? 0);
    const discountBase     = isCategoryScoped
      ? Number(discountSnapshot?.originalItemPrice ?? itemPrice)
      : itemPrice;
    const discountRate     = discountBase > 0 && discountAmt > 0
      ? discountAmt / discountBase
      : 0;

    const isEligible = discountRate > 0
      ? (isCategoryScoped ? eligibleCats.includes(product.category) : true)
      : false;

    const storedUnitPrice = isEligible
      ? Math.round(unitPrice * (1 - discountRate) * 100) / 100
      : unitPrice;

    orderItems.push({
      product:  product._id,
      name:     product.name,
      price:    storedUnitPrice,
      quantity,
      image:    product.images?.[0]?.url || product.images?.[0] || '',
      category: product.category,
    });
  }

  const attributionData = req.attribution || {
    source: 'direct', medium: null, campaign: null, referrer: null, landingPage: null
  };

  const userAgent = req.headers['user-agent'] || '';
  const deviceInfo = {
    device:  /mobile/i.test(userAgent) ? 'mobile' : /tablet|ipad/i.test(userAgent) ? 'tablet' : 'desktop',
    browser: /edg\//i.test(userAgent) ? 'Edge'
          : /chrome/i.test(userAgent) ? 'Chrome'
          : /firefox/i.test(userAgent) ? 'Firefox'
          : /safari/i.test(userAgent) ? 'Safari'
          : /opera|opr/i.test(userAgent) ? 'Opera'
          : 'unknown',
  };

  const reference = generateOrderReference();

  let discountInfo = null;
  if (discountSnapshot && discountSnapshot.code) {
    discountInfo = {
      code:              discountSnapshot.code,
      discountId:        discountSnapshot.discountId  || null,
      type:              discountSnapshot.type        || null,
      value:             discountSnapshot.value       || null,
      discountAmount:    Number(discountSnapshot.discountAmount)    || 0,
      originalItemPrice: Number(discountSnapshot.originalItemPrice) || itemPrice,
      description:       discountSnapshot.description || null,
      eligibleProductCategories: Array.isArray(discountSnapshot.eligibleProductCategories)
        ? discountSnapshot.eligibleProductCategories
        : [],
      remainingBalance: discountSnapshot.remainingBalance ?? null,
    };
  }

  try {
    await createPaymentSession({
      reference,
      userId:        userId.toString(),
      gateway,
      currency:      normalizedCurrency,
      shippingInfo,
      orderItems,
      itemPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      userEmail:     user.email,
      userName:      user.name,
      discount:      discountInfo,
      analytics: {
        source:      attributionData.source,
        medium:      attributionData.medium,
        campaign:    attributionData.campaign,
        referrer:    attributionData.referrer,
        landingPage: attributionData.landingPage,
        device:      deviceInfo.device,
        browser:     deviceInfo.browser
      },
      createdAt: Date.now()
    });
  } catch {
    return next(new HandleError("Failed to create payment session. Please try again.", 500));
  }

  let gatewayResponse;
  try {
    gatewayResponse = await PaymentFactory.initializePayment(gateway, {
      email:          user.email,
      amount:         totalPrice,
      currency:       normalizedCurrency,
      reference,
      userId:         userId.toString(),
      orderReference: reference,
      itemCount:      orderItems.length,
      callback_url:   `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}`,
      customer_name:  user.name,
      customer_phone: shippingInfo.phoneNo
    });
  } catch {
    await deletePaymentSession(reference).catch(() => {});
    return next(new HandleError(
      `Could not reach ${gateway} payment gateway. Please try again or use a different payment method.`,
      502
    ));
  }

  if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
    createSessionAlias(gatewayResponse.payment_intent_id, reference).catch(() => {});
  }

  const responseData = {
    reference,
    amount:   totalPrice,
    currency: normalizedCurrency,
    gateway,
    orderItems: orderItems.map(({ name, quantity, price }) => ({ name, quantity, price })),
    breakdown: {
      itemPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      ...(discountInfo && {
        discount: {
          code:              discountInfo.code,
          discountAmount:    discountInfo.discountAmount,
          originalItemPrice: discountInfo.originalItemPrice,
        }
      })
    }
  };

  if (gateway === 'paystack') {
    responseData.authorization_url = gatewayResponse.authorization_url;
    responseData.access_code       = gatewayResponse.access_code;
  } else if (gateway === 'flutterwave') {
    responseData.payment_link = gatewayResponse.payment_link;
  } else if (gateway === 'stripe') {
    responseData.client_secret      = gatewayResponse.client_secret;
    responseData.payment_intent_id  = gatewayResponse.payment_intent_id;
  }

  return res.status(200).json({
    success: true,
    message: "Payment initialized successfully",
    data:    responseData
  });
});

// ============================================
// VERIFY PAYMENT
// @route POST /api/v1/payment/verify
// @access Private
// ============================================
export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const { gateway, reference, transactionId } = req.body;
  if (!gateway || !reference) {
    return next(new HandleError(
      "Both 'gateway' and 'reference' are required to verify a payment", 400
    ));
  }

  const session = await getPaymentSession(reference);

  if (!session) {
    const orphanOrder = await Order.findOne({
      $or: [
        { "paymentInfo.reference":             reference },
        { "paymentInfo.stripePaymentIntentId": reference }
      ],
      user: userId
    }).lean();

    if (orphanOrder) {
      return res.status(200).json({
        success:    true,
        message:    "Payment already verified — returning existing order",
        order:      orphanOrder,
        idempotent: true
      });
    }

    return next(new HandleError(
      "Your payment session has expired (30-minute limit). " +
      "No charge was made. Please start a new payment.",
      400
    ));
  }

  if (!session.orderItems || !session.shippingInfo || !session.totalPrice || !session.reference) {
    await deletePaymentSession(reference).catch(() => {});
    return next(new HandleError(
      "Payment session data is incomplete. Please start a new payment.", 400
    ));
  }

  if (session.createdAt && Date.now() - new Date(session.createdAt).getTime() > SESSION_EXPIRY_MS) {
    await deletePaymentSession(reference).catch(() => {});
    return next(new HandleError(
      "Payment session has expired (30-minute limit). Please start a new payment.", 400
    ));
  }

  const orderReference = session.reference;

  if (session.userId !== userId.toString()) {
    return next(new HandleError(
      "This payment session does not belong to your account", 403
    ));
  }

  if (session.gateway !== gateway) {
    return next(new HandleError(
      `Gateway mismatch: this payment was initialized with ${session.gateway}, not ${gateway}`, 400
    ));
  }

  const existingOrder = await Order.findOne({
    $or: [
      { "paymentInfo.reference":             orderReference },
      { "paymentInfo.stripePaymentIntentId": reference      },
      { "paymentInfo.reference":             reference       }
    ]
  }).lean();

  if (existingOrder) {
    await deletePaymentSession(reference).catch(() => {});
    if (reference !== orderReference) await deletePaymentSession(orderReference).catch(() => {});

    return res.status(200).json({
      success:    true,
      message:    "Payment already verified — returning existing order",
      order:      existingOrder,
      idempotent: true
    });
  }

  let paymentService;
  try {
    paymentService = PaymentFactory.getService(gateway);
  } catch {
    return next(new HandleError(`Unsupported payment gateway: ${gateway}`, 400));
  }

  let gatewayData;
  try {
    gatewayData = await verifyWithGateway(
      paymentService,
      gateway,
      reference,
      transactionId || null
    );
  } catch (err) {
    return next(new HandleError(
      `Payment verification failed with ${gateway}: ${err.message}`, 502
    ));
  }

  const {
    amount:   gatewayAmount,
    currency: gatewayCurrency,
    id:       providerTxId,
    raw:      gatewayResponse
  } = gatewayData;

  if (gatewayCurrency !== session.currency) {
    return next(new HandleError(
      `Currency mismatch: session expects ${session.currency} but gateway reported ${gatewayCurrency}`, 400
    ));
  }

  const tolerance  = AMOUNT_TOLERANCE[session.currency] ?? AMOUNT_TOLERANCE.DEFAULT;
  const amountDiff = Math.abs(session.totalPrice - gatewayAmount);
  if (amountDiff > tolerance) {
    return next(new HandleError(
      `Amount mismatch: expected ${session.totalPrice} ${session.currency}, ` +
      `gateway charged ${gatewayAmount} ${gatewayCurrency} (diff: ${amountDiff.toFixed(2)})`, 400
    ));
  }

  const user = await User.findById(userId).select('email name country createdAt orderHistory');
  if (!user) return next(new HandleError("User not found", 404));

  const userOrderCount  = await Order.countDocuments({ user: userId, 'paymentInfo.status': 'success' });
  const isFirstPurchase = userOrderCount === 0;
  const purchaseNumber  = userOrderCount + 1;

  const fraudCheck = calculateFraudRisk(
    { totalPrice: session.totalPrice, shippingInfo: session.shippingInfo, orderItems: session.orderItems },
    user,
    { gateway, gatewayResponse }
  );

  const fulfillmentSLA = calculateFulfillmentSLA(new Date(), 'Processing');

  // ============================================
  // PHASE 9: Extract analytics fields from body
  // ============================================
  const analyticsEventId  = req.body?.analyticsEventId  || null;
  const clientTimestamp   = req.body?.clientTimestamp    || null;
  const ga4ClientId       = req.body?.ga4ClientId        || null;
  const fbp               = req.body?.fbp                || req.cookies?._fbp  || null;
  const fbc               = req.body?.fbc                || req.cookies?._fbc  || null;
  // clientAttribution is the full attribution snapshot from the browser SDK.
  // Used as fallback when the backend attribution middleware couldn't capture
  // click IDs or UTMs directly (SPA — query string never hits Express).
  const clientAttribution = req.body?.clientAttribution  || null;

  const orderData = {
    user:          userId,
    shippingInfo:  session.shippingInfo,
    orderItems:    session.orderItems,
    itemPrice:     session.itemPrice,
    taxPrice:      session.taxPrice,
    shippingPrice: session.shippingPrice,
    totalPrice:    session.totalPrice,
    amountPaid:    gatewayAmount,
    ...(session.discount && {
      discounts: {
        codes: [{
          code:              session.discount.code,
          amount:            session.discount.discountAmount,
          type:              session.discount.type,
          originalItemPrice: session.discount.originalItemPrice ?? null,
        }],
        totalDiscount: session.discount.discountAmount,
      }
    }),
    paymentInfo: {
      reference:             orderReference,
      providerTxId,
      stripePaymentIntentId: gateway === 'stripe' ? gatewayResponse.id : undefined,
      status:                "success",
      method:                gateway,
      currency:              gatewayCurrency,
      amount:                gatewayAmount,
      paidAt:                new Date(),
    },
    paymentMeta:  buildPaymentMeta(gateway, gatewayResponse),
    orderStatus:  "Processing",
    analytics: {
      // Source — Phase 3 middleware wins if it resolved a non-direct source.
      // Falls back to clientAttribution UTMs (SPA path) then session cache.
      source: normalizeSource(
        req.attribution?.source && req.attribution.source !== 'direct'
          ? req.attribution.source
          : clientAttribution?.utm_source || session.analytics?.source || 'direct'
      ),
      medium:   req.attribution?.medium   || clientAttribution?.utm_medium   || session.analytics?.medium   || null,
      campaign: req.attribution?.campaign || clientAttribution?.utm_campaign || session.analytics?.campaign || null,
      referrer:    req.attribution?.referrer  || session.analytics?.referrer    || null,
      landingPage: clientAttribution?.landing_page || session.analytics?.landingPage || null,
      device:   session.analytics?.device  || req.attribution?.device  || 'desktop',
      browser:  session.analytics?.browser || req.attribution?.browser || 'unknown',
      customerSegment: null,
      isFirstPurchase,
      purchaseNumber,
      // Phase 2
      anonymousId: req.anonymousId || null,
      eventId:     analyticsEventId,
      sessionId:   req.sessionId   || null,
      // Click IDs — backend httpOnly cookie first (set when backend saw the
      // query string), clientAttribution fallback for SPA landing pages.
      gclid:   req.attribution?.gclid   || clientAttribution?.gclid   || null,
      fbclid:  req.attribution?.fbclid  || clientAttribution?.fbclid  || fbc  || null,
      ttclid:  req.attribution?.ttclid  || clientAttribution?.ttclid  || null,
      msclkid: req.attribution?.msclkid || clientAttribution?.msclkid || null,
      // Phase 3 confidence scoring
      confidenceScore:    req.attribution?.confidenceScore    ?? null,
      confidenceLevel:    req.attribution?.confidenceLevel    || null,
      isReconstructed:    req.attribution?.isReconstructed    || false,
      reconstructionRule: req.attribution?.reconstructionRule || null,
    },
    fraudCheck,
    fulfillmentSLA,
  };

  let order;
  try {
    order = await Order.create(orderData);
  } catch (err) {
    return next(new HandleError(
      `Your payment was successful but we encountered an error saving your order ` +
      `(${err.message}). Please do not pay again. Contact support with reference: ${orderReference}`,
      500
    ));
  }

  // ── Resolve RecoveryEmail outcome immediately after order creation ─────────
  try {
    const RecoveryEmail = (await import('../models/recovery-email-model.js')).default;

    const abandonedCheckout = await Checkout.findOne({
      user:                      userId,
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
    }).sort({ lastActivityAt: -1 });

    if (abandonedCheckout) {
      const recoveryEmailDoc = await RecoveryEmail.findOne({
        checkout: abandonedCheckout._id,
        outcome:  { $in: ['clicked', 'sent'] },
      });

      if (recoveryEmailDoc) {
        const { resolveRecoveryOutcome } = await import('../Services/recoveryEmailService.js');
        const outcomeToSet = recoveryEmailDoc.totalLinkClicks > 0 ? 'converted' : 'organic';
        await resolveRecoveryOutcome(recoveryEmailDoc.checkout, outcomeToSet);
        console.log(
          `[payment] RecoveryEmail ${recoveryEmailDoc._id} resolved to '${outcomeToSet}'`
        );
      }
    }
  } catch (err) {
    console.error('[payment] RecoveryEmail outcome resolution failed:', err.message);
  }

  try {
    await order.populate('orderItems.product', 'name images pricing');
  } catch {
    // Non-fatal
  }

// ============================================
// PHASE 9: Analytics event enqueue
// ============================================
const purchaseEvent = buildPurchaseEvent(order, req, analyticsEventId);

enqueueAnalyticsEvent('purchase', {
  ...purchaseEvent,
  order,
  user:    req.user,
  context: {
    eventId:        purchaseEvent.event_id,
    userId:         req.user?._id?.toString(),
    clientId:       ga4ClientId || req.sessionId,
    sessionId:      req.sessionId,
    fbp,
    fbc:            fbc || req.attribution?.fbclid || clientAttribution?.fbclid || null,
    eventSourceUrl: req.headers?.referer || process.env.FRONTEND_URL,
    clientIp:       req.ip,
    userAgent:      req.headers?.['user-agent'],
    // Use the saved order's analytics subdocument — this has the correct
    // source/gclid resolved from clientAttribution fallback (SPA path).
    attribution: {
      source:             order.analytics.source,
      medium:             order.analytics.medium,
      campaign:           order.analytics.campaign,
      gclid:              order.analytics.gclid,
      fbclid:             order.analytics.fbclid,
      ttclid:             order.analytics.ttclid,
      msclkid:            order.analytics.msclkid,
      confidenceScore:    order.analytics.confidenceScore,
      confidenceLevel:    order.analytics.confidenceLevel,
      isReconstructed:    order.analytics.isReconstructed,
      reconstructionRule: order.analytics.reconstructionRule,
    },
  },
}).catch(err =>
  console.error('[Analytics] Purchase event enqueue failed (non-fatal):', err.message)
);


  stitchIdentityFromRequest(req).catch(err =>
    console.error('[Identity] Purchase stitch failed (non-fatal):', err.message)
  );
  // ============================================
  // END PHASE 9
  // ============================================

  res.status(200).json({
    success:    true,
    message:    "Payment verified and order created successfully",
    order,
    idempotent: false,
  });

  // ── Post-payment async tasks ──────────────────────────────────────────────
  setImmediate(async () => {

    try {
      const checkout = await Checkout.findOne({
        user:                     userId,
        'conversion.isConverted': false,
        status:                   { $in: ['pending', 'abandoned'] },
      }).sort({ lastActivityAt: -1 });

      if (checkout) {
        const wasAbandoned       = checkout.abandonment?.isAbandoned === true;
        const emailWasSent       = checkout.abandonment?.recoveryEmailSent === true;
        const linkWasEverClicked = !!checkout.abandonment?.recoveryLinkClickedAt;

        if (wasAbandoned && emailWasSent && !linkWasEverClicked) {
          checkout.abandonment.organicRecovery = true;
        }

        if (wasAbandoned && linkWasEverClicked) {
          checkout.computeRecoveryCartDiff(order.orderItems);
        }

        checkout.markAsConverted(order._id, orderReference);
        await checkout.save();

        console.log(
          `[payment] Checkout ${checkout._id} marked converted` +
          ` (wasAbandoned=${wasAbandoned})`
        );
      } else {
        console.warn(
          `[payment] No unconverted checkout found for user ${userId} ` +
          `after order ${order._id} — skipping conversion attribution.`
        );
      }
    } catch (err) {
      console.error('[payment] Checkout conversion attribution failed:', err.message, err.stack);
    }

    try {
      if (session.discount) {
        const discountLookup = session.discount.discountId
          ? Discount.findById(session.discount.discountId)
          : Discount.findOne({ code: session.discount.code?.toUpperCase() });

        const discount = await discountLookup;
        if (!discount) {
          console.error(JSON.stringify({
            level: 'ERROR', event: 'discount_record_usage_skipped',
            reason: 'discount_not_found', orderId: order._id,
            discountId: session.discount.discountId ?? null,
            code: session.discount.code ?? null,
          }));
        } else {
          await discount.recordUsage(userId, order._id, session.discount.discountAmount);
          syncDiscountAfterOrderCreated(order).catch(() => {});
        }
      } else {
        syncBaselineAfterNonDiscountedOrder().catch(() => {});
      }
    } catch (err) {
      console.error('[payment] Discount sync failed:', err.message);
    }

    syncCustomerAfterOrder(order._id).catch(() => {});

    createReceiptIfNotExists({
      orderId:        order._id,
      userId,
      reference:      orderReference,
      orderItems:     order.orderItems,
      itemPrice:      order.itemPrice,
      taxPrice:       order.taxPrice,
      shippingPrice:  order.shippingPrice,
      totalPrice:     order.totalPrice,
      shippingInfo:   order.shippingInfo,
      currency:       order.paymentInfo.currency,
      paymentGateway: gateway,
      ...(order.discounts?.codes?.[0] && {
        discount: {
          code:              order.discounts.codes[0].code,
          discountAmount:    order.discounts.codes[0].amount,
          type:              order.discounts.codes[0].type              ?? null,
          originalItemPrice: order.discounts.codes[0].originalItemPrice ?? null,
        }
      }),
    }).catch(() => {});

    Promise.all([
      deletePaymentSession(reference),
      reference !== orderReference ? deletePaymentSession(orderReference) : Promise.resolve(),
    ]).catch(() => {});

    invalidatePaymentCaches().catch(() => {});

    import('../Services/recoveryEmailService.js')
      .then(({ invalidateRecoveryCaches }) => invalidateRecoveryCaches())
      .catch(() => {});
  });

});