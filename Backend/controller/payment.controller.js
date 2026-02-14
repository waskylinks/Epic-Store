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
import Product from '../models/product-model.js';
import Discount from '../models/discount-model.js';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
import Checkout from '../models/checkout-model.js';
import mongoose from 'mongoose';
// FIX PC1: Removed the two duplicate helper functions (calculateFraudRisk,
// calculateFulfillmentSLA) that were copy-pasted into both paymentController
// and orderController with diverged logic. The canonical implementations now
// live in utils/ and are imported by both controllers.
import { calculateFraudRisk } from '../utils/fraudCheck.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';

// ============================================
// SHARED CACHE INVALIDATION
// ============================================

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
    // Cache invalidation failure must not affect the primary response
  }
};

// ============================================
// INITIALIZE PAYMENT
// ============================================

/**
 * Initialize Payment — creates Redis session, returns gateway authorization URL
 * @route POST /api/v1/payment/initialize
 * @access Private
 */
export const initializePaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const { gateway, currency, shippingInfo, cartItems, discountCode } = req.body;

  if (!gateway || !currency || !shippingInfo || !cartItems || cartItems.length === 0) {
    return next(new HandleError("Missing required fields", 400));
  }

  // 1. Get user info
  const user = await User.findById(userId).select('email name country createdAt');
  if (!user) return next(new HandleError("User not found", 404));

  // 2. Validate and calculate order totals using database prices
  let validatedOrder;
  try {
    validatedOrder = await validateAndCalculateOrder(cartItems, currency);
  } catch (err) {
    return next(err);
  }

  // 3. Apply discount if provided
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
      return next(new HandleError('Failed to apply discount code', 500));
    }
  }

  // 4. Capture attribution data
  const attributionData = req.attributionData || {
    source: 'direct', medium: null, campaign: null, referrer: null, landingPage: null
  };
  const deviceInfo = req.deviceInfo || { device: 'desktop', browser: 'unknown' };

  // 5. Create payment session in Redis
  let reference;
  try {
    reference = await createPaymentSession({
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
    return next(new HandleError("Failed to initialize payment session", 500));
  }

  // 6. Initialize payment with gateway
  let gatewayResponse;
  try {
    const initParams = {
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
    };

    gatewayResponse = await PaymentFactory.initializePayment(gateway, initParams);
  } catch (err) {
    await deletePaymentSession(reference);
    return next(new HandleError(`Failed to initialize ${gateway} payment: ${err.message}`, 500));
  }

  // 7. For Stripe, create alias session with payment_intent_id
  if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
    createSessionAlias(gatewayResponse.payment_intent_id, reference).catch(() => {});
  }

  // 8. Return payment initialization data
  const responseData = {
    reference,
    amount: validatedOrder.totalPrice,
    currency: validatedOrder.currency,
    gateway,
    orderItems: validatedOrder.orderItems.map(item => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price
    })),
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
 * Verify Payment — confirms gateway charge, creates order atomically
 * @route POST /api/v1/payment/verify
 * @access Private
 */
export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const { gateway, reference } = req.body;
  if (!gateway || !reference) {
    return next(new HandleError("Gateway and reference are required", 400));
  }

  // 1. Get payment session from Redis
  const session = await getPaymentSession(reference);

  if (!session) {
    return next(new HandleError(
      "Payment session not found or expired. Please restart the payment process.",
      404
    ));
  }

  if (!session.orderItems || !session.shippingInfo || !session.totalPrice) {
    await deletePaymentSession(reference);
    return next(new HandleError("Invalid payment session data", 400));
  }

  // Check session expiry (30 minutes)
  if (session.createdAt && Date.now() - session.createdAt > 30 * 60 * 1000) {
    await deletePaymentSession(reference);
    return next(new HandleError("Payment session expired. Please restart the payment process.", 400));
  }

  const orderReference = session.reference;

  // 2. Verify session ownership
  if (session.userId !== userId.toString()) {
    return next(new HandleError("Unauthorized: Payment session does not belong to user", 403));
  }

  // 3. Verify gateway matches
  if (session.gateway !== gateway) {
    return next(new HandleError(`Gateway mismatch: session is for ${session.gateway}, not ${gateway}`, 400));
  }

  // 4. Idempotency check — order may already exist from a prior verify call
  const existingOrder = await Order.findOne({
    $or: [
      { "paymentInfo.reference": orderReference },
      { "paymentInfo.stripePaymentIntentId": reference }
    ]
  });

  if (existingOrder) {
    await deletePaymentSession(reference);
    if (reference !== orderReference) await deletePaymentSession(orderReference);

    return res.status(200).json({
      success: true,
      message: "Payment already verified",
      order: existingOrder,
      idempotent: true
    });
  }

  // 5. Get payment service
  let paymentService;
  try {
    paymentService = PaymentFactory.getService(gateway);
  } catch (err) {
    return next(new HandleError(err.message, 400));
  }

  // 6. Verify payment with gateway
  let paymentVerified = false;
  let gatewayResponse = null;

  try {
    if (gateway === 'stripe') {
      gatewayResponse = await paymentService.verifyStripeTransaction(reference);
      paymentVerified = gatewayResponse.status === "succeeded";
    } else if (gateway === 'paystack') {
      gatewayResponse = await paymentService.verifyPaystackTransaction(reference);
      paymentVerified = gatewayResponse.status === "success";
    } else if (gateway === 'flutterwave') {
      gatewayResponse = await paymentService.verifyFlutterwaveTransaction(reference);
      paymentVerified = gatewayResponse.status === "successful";
    }

    if (!paymentVerified) {
      throw new Error(`Payment not successful. Status: ${gatewayResponse?.status}`);
    }
  } catch (err) {
    return next(new HandleError(`Payment verification failed: ${err.message}`, 500));
  }

  // 7. Validate amount and currency
  let gatewayAmount, gatewayCurrency;

  if (gateway === 'stripe') {
    gatewayAmount = gatewayResponse.amount / 100;
    gatewayCurrency = gatewayResponse.currency.toUpperCase();
  } else if (gateway === 'paystack') {
    gatewayAmount = gatewayResponse.amount / 100;
    gatewayCurrency = gatewayResponse.currency;
  } else if (gateway === 'flutterwave') {
    gatewayAmount = parseFloat(gatewayResponse.amount);
    gatewayCurrency = gatewayResponse.currency;
  }

  if (gatewayCurrency !== session.currency) {
    return next(new HandleError(
      `Currency mismatch: expected ${session.currency}, got ${gatewayCurrency}`,
      400
    ));
  }

  const tolerance = session.currency === 'USD' ? 0.02 : 0.05;
  if (Math.abs(session.totalPrice - gatewayAmount) > tolerance) {
    return next(new HandleError(
      `Amount mismatch: expected ${session.totalPrice}, gateway charged ${gatewayAmount}`,
      400
    ));
  }

  // 8. Get user for fraud check
  const user = await User.findById(userId).select('email name country createdAt orderHistory');
  if (!user) return next(new HandleError("User not found", 404));

  // 9. Calculate isFirstPurchase and purchaseNumber
  const userOrderCount = await Order.countDocuments({
    user: userId,
    'paymentInfo.status': 'success'
  });

  const isFirstPurchase = userOrderCount === 0;
  const purchaseNumber = userOrderCount + 1;

  // ═══════════════════════════════════════════════════════════════
  // ATOMIC TRANSACTION — all critical DB writes together
  // ═══════════════════════════════════════════════════════════════

  let order;
  const mongoSession = await mongoose.startSession();

  try {
    await mongoSession.startTransaction();

    // 10. Validate stock BEFORE creating order
    for (const item of session.orderItems) {
      const product = await Product.findById(item.product).session(mongoSession);
      if (!product) throw new Error(`Product ${item.product} not found`);

      const currentStock = product.inventory?.stock ?? product.stock ?? 0;
      if (currentStock < item.quantity) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${currentStock}, Requested: ${item.quantity}`
        );
      }
    }

    // 11. Fraud risk score — uses canonical shared utility (PC1)
    const fraudCheck = calculateFraudRisk({
      totalPrice: session.totalPrice,
      shippingInfo: session.shippingInfo,
      orderItems: session.orderItems,
      billingAddress: gatewayResponse.customer?.billing_address || null
    }, user);

    // 12. Initial SLA — uses canonical shared utility (PC1)
    const fulfillmentSLA = calculateFulfillmentSLA(new Date(), 'Processing');

    // 13. Build order data
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
        providerTxId: gatewayResponse.id || gatewayResponse.tx_id,
        stripePaymentIntentId: gateway === 'stripe' ? gatewayResponse.id : undefined,
        status: "success",
        method: gateway,
        currency: gatewayCurrency,
        amount: gatewayAmount,
        paidAt: new Date()
      },
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

    // Payment metadata per gateway
    if (gateway === 'stripe') {
      const paymentMethod = gatewayResponse.charges?.data[0]?.payment_method_details;
      orderData.paymentMeta = {
        channel: paymentMethod?.type || "card",
        customer: { email: gatewayResponse.receipt_email },
        cardDetails: paymentMethod?.card
          ? {
              last4: paymentMethod.card.last4,
              brand: paymentMethod.card.brand,
              expMonth: paymentMethod.card.exp_month,
              expYear: paymentMethod.card.exp_year
            }
          : undefined,
        customMetadata: gatewayResponse.metadata,
        raw: gatewayResponse
      };
    } else if (gateway === 'paystack') {
      orderData.paymentMeta = {
        channel: gatewayResponse.channel,
        ipAddress: gatewayResponse.ip_address,
        customer: gatewayResponse.customer,
        authorization: gatewayResponse.authorization,
        cardDetails: {
          last4: gatewayResponse.authorization?.last4,
          brand: gatewayResponse.authorization?.brand,
          expMonth: gatewayResponse.authorization?.exp_month,
          expYear: gatewayResponse.authorization?.exp_year
        },
        customMetadata: gatewayResponse.metadata,
        raw: gatewayResponse
      };
    } else if (gateway === 'flutterwave') {
      orderData.paymentMeta = {
        channel: gatewayResponse.payment_type,
        ipAddress: gatewayResponse.ip,
        customer: gatewayResponse.customer,
        cardDetails: gatewayResponse.card
          ? {
              last4: gatewayResponse.card.last_4digits,
              brand: gatewayResponse.card.type,
              expMonth: gatewayResponse.card.expiry?.split('/')[0],
              expYear: gatewayResponse.card.expiry?.split('/')[1]
            }
          : undefined,
        customMetadata: gatewayResponse.meta,
        raw: gatewayResponse
      };
    }

    // Create order within transaction
    const [createdOrder] = await Order.create([orderData], { session: mongoSession });
    order = createdOrder;

    // 14. Decrement product stock atomically
    for (const item of session.orderItems) {
      const product = await Product.findById(item.product).session(mongoSession);
      if (product) {
        const stockField =
          product.inventory?.stock !== undefined ? 'inventory.stock' : 'stock';
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { [stockField]: -item.quantity } },
          { session: mongoSession, new: true }
        );
      }
    }

    // 15. Mark checkout as converted (non-critical if missing)
    try {
      const checkout = await Checkout.findOne({ user: userId, status: 'pending' })
        .sort({ lastActivityAt: -1 })
        .session(mongoSession);

      if (checkout) {
        checkout.markAsConverted(order._id, orderReference);
        await checkout.save({ session: mongoSession });
      }
    } catch {
      // Checkout conversion failure must not abort the transaction
    }

    await mongoSession.commitTransaction();
  } catch (err) {
    await mongoSession.abortTransaction();
    return next(new HandleError(
      `Payment verified but order creation failed: ${err.message}. Please contact support with reference: ${orderReference}`,
      500
    ));
  } finally {
    mongoSession.endSession();
  }

  // ═══════════════════════════════════════════════════════════════
  // POST-TRANSACTION (non-critical, all fire-and-forget)
  // ═══════════════════════════════════════════════════════════════

  // 16. Record discount usage
  if (session.discount?.discountId) {
    Discount.findById(session.discount.discountId)
      .then(discount => {
        if (discount) {
          return discount.recordUsage(userId, order._id, session.discount.discountAmount);
        }
      })
      .catch(() => {});
  }

  // 17. Populate order items for response
  try {
    await order.populate('orderItems.product', 'name images pricing');
  } catch {
    // Populate failure must not block the response
  }

  // 18. Sync customer analytics (async, non-blocking)
  syncCustomerAfterOrder(order._id).catch(() => {});

  // 19. Create receipt (async, non-blocking)
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