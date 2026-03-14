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
import Checkout from '../models/checkout-model.js';
import { calculateFraudRisk } from '../utils/fraudCheck.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';

// ============================================
// CONSTANTS
// ============================================

const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

const AMOUNT_TOLERANCE = {
  USD: 0.02,
  NGN: 0.05,
  GHS: 0.05,
  DEFAULT: 0.05
};

// Supported currencies — must match cart controller and pricing service
const SUPPORTED_CURRENCIES = ['USD', 'NGN', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'];

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
// ============================================

/**
 * Initialize Payment
 *
 * FIX: The previous version called validateAndCalculateOrder() independently
 * inside the payment controller, creating a second pricing path that did not
 * reliably receive and apply the discount code, causing the gateway to be
 * initialised at the full undiscounted price even when the cart displayed the
 * correct discounted total.
 *
 * The fix implements a single source of truth:
 *   1. The cart controller (applyDiscountCode / validateCheckout) is the ONLY
 *      place that calculates prices.  Its results are stored in Redux state
 *      and forwarded to this endpoint as `cartPricing`.
 *   2. This controller TRUSTS those pre-computed figures instead of
 *      re-deriving them.  It only performs a lightweight sanity check on each
 *      product (existence, status, stock) and re-reads the unit price from the
 *      DB to build the `orderItems` array — it does NOT recompute totals.
 *   3. The discount snapshot (code, amount, type, originalItemPrice) is also
 *      forwarded from the frontend cart state so it can be stored in the Redis
 *      session and later written to the Order document without re-validating.
 *
 * Required request body fields:
 *   gateway, currency, shippingInfo, cartItems,
 *   cartPricing  { itemPrice, taxPrice, shippingPrice, totalPrice },
 *   discountSnapshot (optional) {
 *     code, discountId, type, value,
 *     discountAmount, originalItemPrice, description
 *   }
 *
 * @route POST /api/v1/payment/initialize
 * @access Private
 */
export const initializePaymentController = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const {
    gateway,
    currency,
    shippingInfo,
    cartItems,
    // FIX: pre-computed totals from the cart controller — the single source
    // of truth for all pricing including any applied discount.
    cartPricing,
    // FIX: discount snapshot forwarded from cart Redux state so the session
    // and order document can record what was applied without re-validating.
    discountSnapshot = null,
  } = req.body;

  // ── 1. Basic field validation ────────────────────────────────────────────
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

  // Validate the forwarded pricing object has all required fields
  const { itemPrice, taxPrice, shippingPrice, totalPrice } = cartPricing;
  if (
    typeof itemPrice    !== 'number' ||
    typeof taxPrice     !== 'number' ||
    typeof shippingPrice !== 'number' ||
    typeof totalPrice   !== 'number'
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

  // ── 2. Load user ─────────────────────────────────────────────────────────
  const user = await User.findById(userId).select('email name country createdAt');
  if (!user) return next(new HandleError("User not found", 404));

  // ── 3. Lightweight product validation ────────────────────────────────────
  // FIX: We no longer re-calculate prices here. We verify each product still
  // exists, is published, and has sufficient stock — then build orderItems
  // using DB unit prices so the stored items are always accurate. Totals come
  // exclusively from cartPricing (the cart controller's output).
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

    // Read unit price from DB for the order item record — but do NOT
    // accumulate these into a new total. The cart controller's totalPrice
    // is the authoritative charge amount.
    let unitPrice = 0;
    if (product.pricing?.sale   > 0) unitPrice = product.pricing.sale;
    else if (product.pricing?.regular > 0) unitPrice = product.pricing.regular;
    else if (product.price      > 0) unitPrice = product.price;
    else return next(new HandleError(`Product "${product.name}" has no valid price`, 500));

    orderItems.push({
      product:  product._id,
      name:     product.name,
      price:    unitPrice,
      quantity,
      image:    product.images?.[0]?.url || product.images?.[0] || '',
      category: product.category,
    });
  }

  // ── 4. Attribution / device ───────────────────────────────────────────────
  const attributionData = req.attributionData || {
    source: 'direct', medium: null, campaign: null, referrer: null, landingPage: null
  };
  const deviceInfo = req.deviceInfo || { device: 'desktop', browser: 'unknown' };

  // ── 5. Generate reference ────────────────────────────────────────────────
  const reference = generateOrderReference();

  // ── 6. Build discount info for session storage ───────────────────────────
  // FIX: instead of re-running discount validation/calculation we simply
  // carry forward the snapshot the cart controller already computed. This is
  // the key change: the payment layer records what happened, it does not redo it.
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
    };
  }

  // ── 7. Persist Redis session ─────────────────────────────────────────────
  try {
    await createPaymentSession({
      reference,
      userId:        userId.toString(),
      gateway,
      currency:      normalizedCurrency,
      shippingInfo,
      orderItems,
      // FIX: store cart-computed totals directly — not recalculated values.
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

  // ── 8. Initialise gateway ─────────────────────────────────────────────────
  let gatewayResponse;
  try {
    gatewayResponse = await PaymentFactory.initializePayment(gateway, {
      email:          user.email,
      // FIX: charge the cart-computed totalPrice — the single source of truth.
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

  // ── 9. Stripe alias ───────────────────────────────────────────────────────
  if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
    createSessionAlias(gatewayResponse.payment_intent_id, reference).catch(() => {});
  }

  // ── 10. Build response ────────────────────────────────────────────────────
  const responseData = {
    reference,
    // FIX: respond with the cart-computed totalPrice — same value sent to gateway.
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
// ============================================

/**
 * Verify Payment — confirms gateway charge, creates order.
 * No pricing changes — session is the source of truth here.
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

  // 1. Load session
  const session = await getPaymentSession(reference);
  if (!session) {
    return next(new HandleError(
      "Payment session not found or expired. Please start a new payment.", 404
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

  // 2. Ownership check
  if (session.userId !== userId.toString()) {
    return next(new HandleError("This payment session does not belong to your account", 403));
  }

  // 3. Gateway match
  if (session.gateway !== gateway) {
    return next(new HandleError(
      `Gateway mismatch: this payment was initialized with ${session.gateway}, not ${gateway}`, 400
    ));
  }

  // 4. Idempotency
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

  // 5. Resolve payment service
  let paymentService;
  try {
    paymentService = PaymentFactory.getService(gateway);
  } catch {
    return next(new HandleError(`Unsupported payment gateway: ${gateway}`, 400));
  }

  // 6. Verify with gateway
  let gatewayData;
  try {
    gatewayData = await verifyWithGateway(paymentService, gateway, reference, transactionId || null);
  } catch (err) {
    return next(new HandleError(
      `Payment verification failed with ${gateway}: ${err.message}`, 502
    ));
  }

  const {
    amount: gatewayAmount,
    currency: gatewayCurrency,
    id: providerTxId,
    raw: gatewayResponse
  } = gatewayData;

  // 7. Currency match
  if (gatewayCurrency !== session.currency) {
    return next(new HandleError(
      `Currency mismatch: session expects ${session.currency} but gateway reported ${gatewayCurrency}`, 400
    ));
  }

  // 8. Amount tolerance check
  // FIX: session.totalPrice is now always the cart-computed discounted total,
  // so this check correctly validates the discounted amount was charged.
  const tolerance = AMOUNT_TOLERANCE[session.currency] ?? AMOUNT_TOLERANCE.DEFAULT;
  const amountDiff = Math.abs(session.totalPrice - gatewayAmount);
  if (amountDiff > tolerance) {
    return next(new HandleError(
      `Amount mismatch: expected ${session.totalPrice} ${session.currency}, ` +
      `gateway charged ${gatewayAmount} ${gatewayCurrency} (diff: ${amountDiff.toFixed(2)})`, 400
    ));
  }

  // 9. Load user
  const user = await User.findById(userId).select('email name country createdAt orderHistory');
  if (!user) return next(new HandleError("User not found", 404));

  // 10. Analytics counts
  const userOrderCount  = await Order.countDocuments({ user: userId, 'paymentInfo.status': 'success' });
  const isFirstPurchase = userOrderCount === 0;
  const purchaseNumber  = userOrderCount + 1;

  // 11. Fraud check
  const fraudCheck = calculateFraudRisk(
    { totalPrice: session.totalPrice, shippingInfo: session.shippingInfo, orderItems: session.orderItems },
    user,
    { gateway, gatewayResponse }
  );

  // 12. Fulfillment SLA
  const fulfillmentSLA = calculateFulfillmentSLA(new Date(), 'Processing');

  // 13. Build order — sourced entirely from session (which carries the
  //     cart-computed, discount-aware totals locked at initialisation time).
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
        totalDiscount: session.discount.discountAmount
      }
    }),
    paymentInfo: {
      reference:               orderReference,
      providerTxId,
      stripePaymentIntentId:   gateway === 'stripe' ? gatewayResponse.id : undefined,
      status:                  "success",
      method:                  gateway,
      currency:                gatewayCurrency,
      amount:                  gatewayAmount,
      paidAt:                  new Date()
    },
    paymentMeta:  buildPaymentMeta(gateway, gatewayResponse),
    orderStatus:  "Processing",
    analytics: {
      source:          session.analytics?.source     || 'direct',
      medium:          session.analytics?.medium     || null,
      campaign:        session.analytics?.campaign   || null,
      referrer:        session.analytics?.referrer   || null,
      landingPage:     session.analytics?.landingPage || null,
      device:          session.analytics?.device     || 'desktop',
      browser:         session.analytics?.browser    || 'unknown',
      customerSegment: null,
      isFirstPurchase,
      purchaseNumber
    },
    fraudCheck,
    fulfillmentSLA
  };

  // 14. Create order
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

  // 15. Checkout funnel conversion (fire-and-forget)
  Checkout.findOne({ user: userId, status: 'pending' })
    .sort({ lastActivityAt: -1 })
    .then(checkout => checkout && checkout.markAsConverted(order._id, orderReference) && checkout.save())
    .catch(() => {});

  // 16. Record discount usage (fire-and-forget)
  // FIX: previously this guard only checked discountId, which was always null
  // because the cart controller never returned discount._id in its response.
  // The broken chain: cart controller omits _id → cartSlice stores no discountId
  // → discountSnapshot.discountId = null → session.discount.discountId = null
  // → this guard fails → recordUsage() never called → admin page shows 0 uses.
  //
  // Now fixed in cart.controller.js (returns discount.id) and cartSlice.js
  // (stores discountId). This block also falls back to a code-based lookup to
  // handle any sessions created before those fixes were deployed.
  if (session.discount) {
    const discountLookup = session.discount.discountId
      ? Discount.findById(session.discount.discountId)
      : Discount.findOne({ code: session.discount.code?.toUpperCase() });

    discountLookup
      .then(discount => discount?.recordUsage(userId, order._id, session.discount.discountAmount))
      .catch(() => {});
  }

  // 17. Populate product details (non-fatal)
  try {
    await order.populate('orderItems.product', 'name images pricing');
  } catch { /* non-fatal */ }

  // 18-21. Async tasks
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
    paymentGateway: gateway
  }).catch(() => {});

  Promise.all([
    deletePaymentSession(reference),
    reference !== orderReference ? deletePaymentSession(orderReference) : Promise.resolve()
  ]).catch(() => {});

  invalidatePaymentCaches().catch(() => {});

  return res.status(200).json({
    success:    true,
    message:    "Payment verified and order created successfully",
    order,
    idempotent: false
  });
});