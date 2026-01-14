import axios from 'axios';
import crypto from 'crypto';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Verify Paystack transaction with retry logic
 * @param {string} reference - Paystack transaction reference
 * @param {number} maxAttempts - Number of retries for verification
 * @returns {Object} Paystack transaction data
 */
export async function verifyPaystackTransaction(reference, maxAttempts = 3) {
  const url = `https://api.paystack.co/transaction/verify/${reference}`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        timeout: 8000
      });

      if (data.status === true && data.data.status === "success") {
        return data.data;
      }

      throw new Error(`Paystack status: ${data.data?.status || "unknown"}`);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(attempt * 500); // exponential backoff
        continue;
      }
      throw lastErr;
    }
  }
}

/**
 * Verify payment and update pending order (NEW SECURE METHOD)
 * @param {Object} params - Verification parameters
 * @returns {Object} Updated order and success status
 */
export async function verifyAndUpdateOrder({
  reference,
  orderId,
  expectedAmount,
  expectedCurrency,
  userId
}) {
  // 1. Verify transaction with Paystack
  const tx = await verifyPaystackTransaction(reference);

  // 2. Convert Paystack amount (kobo → naira)
  const paystackAmount = tx.amount / 100;
  const currency = tx.currency;

  // 3. Validate currency matches expected
  if (currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
    throw new Error(
      `Currency mismatch: expected ${expectedCurrency}, got ${currency}`
    );
  }

  // 4. Validate amount matches pending order (critical security check)
  if (Math.abs(Number(expectedAmount) - paystackAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, gateway charged ${paystackAmount}`
    );
  }

  // 5. Find and update the pending order
  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error("Order not found");
  }

  // 6. Verify order belongs to user (security check)
  if (order.user.toString() !== userId.toString()) {
    throw new Error("Unauthorized: Order does not belong to user");
  }

  // 7. Check if already processed (idempotency)
  if (order.paymentInfo.status === "success") {
    return { 
      success: true, 
      order, 
      alreadyProcessed: true 
    };
  }

  // 8. Update order with payment confirmation
  order.paymentInfo.status = "success";
  order.paymentInfo.providerTxId = tx.id;
  order.paymentInfo.paidAt = new Date(tx.paid_at);
  order.amountPaid = paystackAmount;

  // 9. Store payment metadata
  order.paymentMeta = {
    channel: tx.channel,
    ipAddress: tx.ip_address,
    customer: tx.customer,
    authorization: tx.authorization,
    cardDetails: {
      last4: tx.authorization?.last4,
      brand: tx.authorization?.brand,
      expMonth: tx.authorization?.exp_month,
      expYear: tx.authorization?.exp_year
    },
    raw: tx
  };

  await order.save();

  return { 
    success: true, 
    order,
    alreadyProcessed: false 
  };
}

/**
 * DEPRECATED: Old method for backward compatibility
 * Use verifyAndUpdateOrder instead
 */
export async function verifyAndCreateOrder({
  reference,
  shippingInfo,
  orderItems,
  itemPrice,
  taxPrice,
  shippingPrice,
  totalPrice,
  amountPaid,
  userId
}) {
  console.warn(
    'verifyAndCreateOrder is deprecated. Use initializePayment + verifyAndUpdateOrder instead.'
  );

  const tx = await verifyPaystackTransaction(reference);

  const paystackAmount = tx.amount / 100;
  const currency = tx.currency;

  if (currency !== "NGN") throw new Error("Invalid payment currency");
  if (Math.abs(Number(totalPrice) - paystackAmount) > 0.01) {
    throw new Error("Amount mismatch");
  }

  // Idempotency check
  const existingOrder = await Order.findOne({ 
    "paymentInfo.reference": reference 
  });
  
  if (existingOrder) {
    return { created: false, order: existingOrder, reason: "duplicate" };
  }

  const newOrder = await Order.create({
    user: userId,
    shippingInfo,
    orderItems,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    amountPaid: paystackAmount,
    paymentInfo: {
      reference: tx.reference,
      providerTxId: tx.id,
      status: tx.status,
      method: "paystack",
      currency: tx.currency,
      amount: paystackAmount,
      paidAt: new Date(tx.paid_at)
    },
    paymentMeta: {
      channel: tx.channel,
      ipAddress: tx.ip_address,
      customer: tx.customer,
      authorization: tx.authorization,
      raw: tx
    }
  });

  return { created: true, order: newOrder };
}

/**
 * Handle Paystack webhook with signature verification
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export async function handleWebhook(req, res) {
  try {
    // 1. Verify webhook signature
    const paystackSignature = req.headers["x-paystack-signature"];
    
    if (!paystackSignature) {
      console.warn("Missing Paystack signature");
      return res.status(400).send("Missing signature");
    }

    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(req.body) // req.body is raw buffer from express.raw()
      .digest("hex");

    if (hash !== paystackSignature) {
      console.warn("Invalid Paystack webhook signature");
      return res.status(400).send("Invalid signature");
    }

    // 2. Parse webhook event
    const payload = JSON.parse(req.body.toString());
    const { event, data: tx } = payload;

    console.log("Paystack webhook event:", event);

    // 3. Only process charge.success events
    if (event !== "charge.success") {
      return res.status(200).json({ message: "Event ignored" });
    }

    // 4. Find order by reference
    const order = await Order.findOne({
      "paymentInfo.reference": tx.reference
    });

    if (!order) {
      console.warn("Webhook: Order not found for reference:", tx.reference);
      return res.status(200).json({
        message: "Order not found, ignoring webhook"
      });
    }

    // 5. Check if already processed (idempotency)
    if (order.paymentInfo.status === "success") {
      return res.status(200).json({ message: "Already processed" });
    }

    // 6. Update order payment status
    order.paymentInfo.status = "success";
    order.paymentInfo.providerTxId = tx.id;
    order.paymentInfo.paidAt = new Date(tx.paid_at);
    order.amountPaid = tx.amount / 100;

    // Update payment metadata
    order.paymentMeta = {
      channel: tx.channel,
      ipAddress: tx.ip_address,
      customer: tx.customer,
      authorization: tx.authorization,
      cardDetails: {
        last4: tx.authorization?.last4,
        brand: tx.authorization?.brand,
        expMonth: tx.authorization?.exp_month,
        expYear: tx.authorization?.exp_year
      },
      raw: tx
    };

    await order.save();

    console.log("Webhook: Order confirmed for reference:", tx.reference);
    return res.status(200).json({ message: "Order confirmed" });

  } catch (err) {
    console.error("Paystack webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}