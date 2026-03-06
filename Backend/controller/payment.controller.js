import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js";
import { createReceiptIfNotExists } from "../Services/receipt.service.js";
import { validateAndCalculateOrder } from "../Services/pricing.service.js";
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
import Checkout from '../models/checkout-model.js';
import mongoose from 'mongoose';
import { calculateFraudRisk } from '../utils/fraudCheck.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';

// ============================================
// CONSTANTS
// ============================================

const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// Amount tolerance per currency
const AMOUNT_TOLERANCE = {
  USD: 0.02,
  NGN: 0.05,
  GHS: 0.05,
  DEFAULT: 0.05
};

// ============================================
// HELPERS
// ============================================

/**
 * Generate a unique order reference.
 * Format: ORD-<timestamp>-<random hex>
 */
const generateOrderReference = () =>
  `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 14).toUpperCase()}`;

/**
 * Invalidate all payment-related caches after a successful transaction.
 * Failures are swallowed — cache invalidation must never affect primary flow.
 */
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

/**
 * Normalize gateway verification response into a unified shape.
 * Returns { verified, amount, currency, id, raw }
 *
 * For Flutterwave: accepts an optional transactionId (numeric) which bypasses
 * the unreliable tx_ref search endpoint and verifies directly by ID.
 */
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
    // If the frontend callback gave us the numeric transaction_id, use it directly.
    // This skips the GET /v3/transactions?tx_ref=... search which is unreliable
    // and frequently returns empty results even for successful payments.
    const lookupRef = transactionId ? String(transactionId) : reference;
    raw = await paymentService.verifyFlutterwaveTransaction(lookupRef);
    verified = raw.status === "successful";
  } else {
    throw new Error(`Unsupported gateway: ${gateway}`);
  }

  if (!verified) {
    throw new Error(`Gateway returned non-success status: "${raw?.status ?? 'unknown'}"`);
  }

  // Normalise amount and currency across gateways
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

/**
 * Build gateway-specific paymentMeta object.
 */
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
// ============================================

/**
 * Initialize Payment — generates reference, stores Redis session, returns gateway URL.
 * @route POST /api/v1/payment/initialize
 * @access Private
 */
export const initializePaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const { gateway, currency, shippingInfo, cartItems, discountCode } = req.body;

  if (!gateway || !currency || !shippingInfo || !cartItems || cartItems.length === 0) {
    return next(new HandleError("Missing required fields: gateway, currency, shippingInfo, cartItems", 400));
  }

  // 1. Load user
  const user = await User.findById(userId).select('email name country createdAt');
  if (!user) return next(new HandleError("User not found", 404));

  // 2. Validate cart and calculate server-side totals
  let validatedOrder;
  try {
    validatedOrder = await validateAndCalculateOrder(cartItems, currency);
  } catch (err) {
    return next(err);
  }

  // 3. Apply discount code if provided
  let discountInfo = null;
  if (discountCode) {
    try {
      const discount = await Discount.findActiveByCode(discountCode);
      if (!discount) return next(new HandleError('Invalid or expired discount code', 400));

      const canUse = await discount.canUserUse(userId);
      if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));

      const validation = discount.validateCart(validatedOrder.itemPrice, cartItems, userId);
      if (!validation.valid) return next(new HandleError(validation.reason, 400));

      const discountAmount = discount.calculateDiscount(validatedOrder.itemPrice, cartItems);
      const discountedItemPrice = Math.max(0, validatedOrder.itemPrice - discountAmount);
      const taxPrice = Math.round(discountedItemPrice * 0.18 * 100) / 100;
      const shippingPrice = discountedItemPrice >= 500 ? 0 : 50;

      discountInfo = {
        code: discount.code,
        discountId: discount._id,
        type: discount.type,
        value: discount.value,
        discountAmount: Math.round(discountAmount * 100) / 100,
        description: discount.description
      };

      validatedOrder.itemPrice = Math.round(discountedItemPrice * 100) / 100;
      validatedOrder.taxPrice = taxPrice;
      validatedOrder.shippingPrice = shippingPrice;
      validatedOrder.totalPrice = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;
    } catch (err) {
      if (err instanceof HandleError) return next(err);
      return next(new HandleError('Failed to apply discount code. Please try again.', 500));
    }
  }

  // 4. Capture attribution and device info
  const attributionData = req.attributionData || {
    source: 'direct', medium: null, campaign: null, referrer: null, landingPage: null
  };
  const deviceInfo = req.deviceInfo || { device: 'desktop', browser: 'unknown' };

  // 5. Generate reference before creating session
  const reference = generateOrderReference();

  try {
    await createPaymentSession({
      reference,
      userId: userId.toString(),
      gateway,
      currency: validatedOrder.currency,
      shippingInfo,
      orderItems: validatedOrder.orderItems,
      itemPrice: validatedOrder.itemPrice,
      taxPrice: validatedOrder.taxPrice,
      shippingPrice: validatedOrder.shippingPrice,
      totalPrice: validatedOrder.totalPrice,
      userEmail: user.email,
      userName: user.name,
      validation: validatedOrder.validation,
      discount: discountInfo,
      analytics: {
        source: attributionData.source,
        medium: attributionData.medium,
        campaign: attributionData.campaign,
        referrer: attributionData.referrer,
        landingPage: attributionData.landingPage,
        device: deviceInfo.device,
        browser: deviceInfo.browser
      },
      createdAt: Date.now()
    });
  } catch {
    return next(new HandleError("Failed to create payment session. Please try again.", 500));
  }

  // 6. Initialize payment with the chosen gateway
  let gatewayResponse;
  try {
    gatewayResponse = await PaymentFactory.initializePayment(gateway, {
      email: user.email,
      amount: validatedOrder.totalPrice,
      currency: validatedOrder.currency,
      reference,
      userId: userId.toString(),
      orderReference: reference,
      itemCount: validatedOrder.orderItems.length,
      callback_url: `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}`,
      customer_name: user.name,
      customer_phone: shippingInfo.phoneNo
    });
  } catch (err) {
    await deletePaymentSession(reference).catch(() => {});
    return next(new HandleError(
      `Could not reach ${gateway} payment gateway. Please try again or use a different payment method.`,
      502
    ));
  }

  // 7. For Stripe: alias payment_intent_id → reference
  if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
    createSessionAlias(gatewayResponse.payment_intent_id, reference).catch(() => {});
  }

  // 8. Build and return response
  const responseData = {
    reference,
    amount: validatedOrder.totalPrice,
    currency: validatedOrder.currency,
    gateway,
    orderItems: validatedOrder.orderItems.map(({ name, quantity, price }) => ({ name, quantity, price })),
    breakdown: {
      itemPrice: validatedOrder.itemPrice,
      taxPrice: validatedOrder.taxPrice,
      shippingPrice: validatedOrder.shippingPrice,
      totalPrice: validatedOrder.totalPrice,
      ...(discountInfo && { discount: { code: discountInfo.code, amount: discountInfo.discountAmount } })
    }
  };

  if (gateway === 'paystack') {
    responseData.authorization_url = gatewayResponse.authorization_url;
    responseData.access_code = gatewayResponse.access_code;
  } else if (gateway === 'flutterwave') {
    responseData.payment_link = gatewayResponse.payment_link;
  } else if (gateway === 'stripe') {
    responseData.client_secret = gatewayResponse.client_secret;
    responseData.payment_intent_id = gatewayResponse.payment_intent_id;
  }

  return res.status(200).json({
    success: true,
    message: "Payment initialized successfully",
    data: responseData
  });
});

// ============================================
// VERIFY PAYMENT
// ============================================

/**
 * Verify Payment — confirms gateway charge, creates order.
 *
 * FIX: Removed MongoDB transaction entirely. The previous implementation used
 * mongoose.startSession() + startTransaction() which caused infinite hangs when:
 *   1. MongoDB connection was in a recovering state (seen in logs)
 *   2. The stock validation loop inside the transaction timed out waiting for locks
 *
 * Since stock deduction is handled by the admin fulfillment flow (not at payment
 * time), there is no multi-document write that requires atomicity here.
 * Order.create() is a single atomic document write — it either succeeds or fails,
 * no transaction needed.
 *
 * @route POST /api/v1/payment/verify
 * @access Private
 */
export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const { gateway, reference, transactionId } = req.body;
  if (!gateway || !reference) {
    return next(new HandleError("Both 'gateway' and 'reference' are required to verify a payment", 400));
  }

  // 1. Load payment session from Redis
  const session = await getPaymentSession(reference);

  if (!session) {
    return next(new HandleError(
      "Payment session not found or expired. Please start a new payment.",
      404
    ));
  }

  // Guard against a corrupted session missing critical fields
  if (!session.orderItems || !session.shippingInfo || !session.totalPrice || !session.reference) {
    await deletePaymentSession(reference).catch(() => {});
    return next(new HandleError(
      "Payment session data is incomplete. Please start a new payment.",
      400
    ));
  }

  // Check session has not passed the 30-minute expiry window
  if (session.createdAt && Date.now() - new Date(session.createdAt).getTime() > SESSION_EXPIRY_MS) {
    await deletePaymentSession(reference).catch(() => {});
    return next(new HandleError(
      "Payment session has expired (30-minute limit). Please start a new payment.",
      400
    ));
  }

  // The order reference is the ORD-xxx identifier stored in the session.
  // `reference` in the request body may be a Stripe payment_intent_id,
  // so we must always use session.reference for the order record.
  const orderReference = session.reference;

  // 2. Verify the session belongs to the authenticated user
  if (session.userId !== userId.toString()) {
    return next(new HandleError("This payment session does not belong to your account", 403));
  }

  // 3. Verify the gateway in the request matches the session
  if (session.gateway !== gateway) {
    return next(new HandleError(
      `Gateway mismatch: this payment was initialized with ${session.gateway}, not ${gateway}`,
      400
    ));
  }

  // 4. Idempotency — if an order already exists for this reference, return it immediately
  const existingOrder = await Order.findOne({
    $or: [
      { "paymentInfo.reference": orderReference },
      { "paymentInfo.stripePaymentIntentId": reference }
    ]
  });

  if (existingOrder) {
    await deletePaymentSession(reference).catch(() => {});
    if (reference !== orderReference) await deletePaymentSession(orderReference).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Payment already verified — returning existing order",
      order: existingOrder,
      idempotent: true
    });
  }

  // 5. Resolve the payment service for this gateway
  let paymentService;
  try {
    paymentService = PaymentFactory.getService(gateway);
  } catch (err) {
    return next(new HandleError(`Unsupported payment gateway: ${gateway}`, 400));
  }

  // 6. Verify the charge with the gateway
  // For Flutterwave: pass transactionId (numeric, from frontend callback) so the
  // service can call GET /v3/transactions/:id/verify directly, bypassing the
  // unreliable tx_ref search endpoint.
  let gatewayData;
  try {
    gatewayData = await verifyWithGateway(paymentService, gateway, reference, transactionId || null);
  } catch (err) {
    return next(new HandleError(
      `Payment verification failed with ${gateway}: ${err.message}`,
      502
    ));
  }

  const { amount: gatewayAmount, currency: gatewayCurrency, id: providerTxId, raw: gatewayResponse } = gatewayData;

  // 7. Validate currency matches the session
  if (gatewayCurrency !== session.currency) {
    return next(new HandleError(
      `Currency mismatch: session expects ${session.currency} but gateway reported ${gatewayCurrency}`,
      400
    ));
  }

  // 8. Validate amount is within tolerance (guards against partial payments / tampering)
  const tolerance = AMOUNT_TOLERANCE[session.currency] ?? AMOUNT_TOLERANCE.DEFAULT;
  const amountDiff = Math.abs(session.totalPrice - gatewayAmount);
  if (amountDiff > tolerance) {
    return next(new HandleError(
      `Amount mismatch: expected ${session.totalPrice} ${session.currency}, ` +
      `gateway charged ${gatewayAmount} ${gatewayCurrency} (diff: ${amountDiff.toFixed(2)})`,
      400
    ));
  }

  // 9. Load user for fraud check
  const user = await User.findById(userId).select('email name country createdAt orderHistory');
  if (!user) return next(new HandleError("User not found", 404));

  // 10. Count prior successful orders for analytics
  const userOrderCount = await Order.countDocuments({
    user: userId,
    'paymentInfo.status': 'success'
  });
  const isFirstPurchase = userOrderCount === 0;
  const purchaseNumber = userOrderCount + 1;

  // 11. Fraud risk assessment
  const fraudCheck = calculateFraudRisk(
    {
      totalPrice: session.totalPrice,
      shippingInfo: session.shippingInfo,
      orderItems: session.orderItems,
    },
    user,
    { gateway, gatewayResponse }
  );

  // 12. Initial fulfillment SLA
  const fulfillmentSLA = calculateFulfillmentSLA(new Date(), 'Processing');

  // 13. Build order document
  const orderData = {
    user: userId,
    shippingInfo: session.shippingInfo,
    orderItems: session.orderItems,
    itemPrice: session.itemPrice,
    taxPrice: session.taxPrice,
    shippingPrice: session.shippingPrice,
    totalPrice: session.totalPrice,
    amountPaid: gatewayAmount,
    ...(session.discount && {
      discounts: {
        codes: [{
          code: session.discount.code,
          amount: session.discount.discountAmount,
          type: session.discount.type
        }],
        totalDiscount: session.discount.discountAmount
      }
    }),
    paymentInfo: {
      reference: orderReference,
      providerTxId,
      stripePaymentIntentId: gateway === 'stripe' ? gatewayResponse.id : undefined,
      status: "success",
      method: gateway,
      currency: gatewayCurrency,
      amount: gatewayAmount,
      paidAt: new Date()
    },
    paymentMeta: buildPaymentMeta(gateway, gatewayResponse),
    orderStatus: "Processing",
    analytics: {
      source: session.analytics?.source || 'direct',
      medium: session.analytics?.medium || null,
      campaign: session.analytics?.campaign || null,
      referrer: session.analytics?.referrer || null,
      landingPage: session.analytics?.landingPage || null,
      device: session.analytics?.device || 'desktop',
      browser: session.analytics?.browser || 'unknown',
      customerSegment: null,
      isFirstPurchase,
      purchaseNumber
    },
    fraudCheck,
    fulfillmentSLA
  };

  // 14. Create order — single document write, no transaction needed
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

  // 15. Mark the checkout funnel entry as converted (fire-and-forget, non-fatal)
  Checkout.findOne({ user: userId, status: 'pending' })
    .sort({ lastActivityAt: -1 })
    .then(checkout => {
      if (checkout) {
        checkout.markAsConverted(order._id, orderReference);
        return checkout.save();
      }
    })
    .catch(() => {});

  // ═══════════════════════════════════════════════════════════════════
  // POST-ORDER — all fire-and-forget, failures are swallowed
  // ═══════════════════════════════════════════════════════════════════

  // 16. Record discount usage
  if (session.discount?.discountId) {
    Discount.findById(session.discount.discountId)
      .then(discount => discount?.recordUsage(userId, order._id, session.discount.discountAmount))
      .catch(() => {});
  }

  // 17. Populate product details for the response payload
  try {
    await order.populate('orderItems.product', 'name images pricing');
  } catch {
    // Non-fatal — order is created, response just won't include product details
  }

  // 18. Async: sync customer analytics
  syncCustomerAfterOrder(order._id).catch(() => {});

  // 19. Async: generate receipt
  createReceiptIfNotExists({
    orderId: order._id,
    userId,
    reference: orderReference,
    orderItems: order.orderItems,
    itemPrice: order.itemPrice,
    taxPrice: order.taxPrice,
    shippingPrice: order.shippingPrice,
    totalPrice: order.totalPrice,
    shippingInfo: order.shippingInfo,
    currency: order.paymentInfo.currency,
    paymentGateway: gateway
  }).catch(() => {});

  // 20. Clean up Redis sessions
  Promise.all([
    deletePaymentSession(reference),
    reference !== orderReference ? deletePaymentSession(orderReference) : Promise.resolve()
  ]).catch(() => {});

  // 21. Invalidate caches
  invalidatePaymentCaches().catch(() => {});

  return res.status(200).json({
    success: true,
    message: "Payment verified and order created successfully",
    order,
    idempotent: false
  });
});