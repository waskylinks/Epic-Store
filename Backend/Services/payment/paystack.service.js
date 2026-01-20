import axios from 'axios';
import crypto from 'crypto';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Initialize Paystack payment with metadata
 * @param {Object} params - Payment initialization parameters
 * @returns {Object} Paystack initialization response with authorization URL
 */
export async function initializePaystackPayment({
  email,
  amount, // Amount in currency base unit (e.g., naira, not kobo)
  currency = "NGN",
  reference,
  userId,
  orderReference,
  itemCount,
  callback_url
}) {
  const url = "https://api.paystack.co/transaction/initialize";

  // Convert amount to kobo/cents (Paystack expects smallest currency unit)
  const amountInMinorUnit = Math.round(amount * 100);

  try {
    const { data } = await axios.post(
      url,
      {
        email,
        amount: amountInMinorUnit,
        currency: currency.toUpperCase(),
        reference,
        callback_url,
        metadata: {
          // Custom metadata for tracking and debugging
          user_id: userId,
          order_reference: orderReference,
          item_count: itemCount,
          payment_source: "epicstore",
          initialized_at: new Date().toISOString(),
          // Can add more custom fields as needed
          custom_fields: [
            {
              display_name: "Order Reference",
              variable_name: "order_reference",
              value: orderReference
            },
            {
              display_name: "Items",
              variable_name: "item_count",
              value: itemCount.toString()
            }
          ]
        },
        channels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    if (!data.status) {
      throw new Error(data.message || "Paystack initialization failed");
    }

    return {
      success: true,
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference
    };

  } catch (err) {
    console.error("Paystack initialization error:", err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || 
      err.message || 
      "Failed to initialize Paystack payment"
    );
  }
}

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

  // 9. Store payment metadata (including our custom metadata)
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
    // Store custom metadata we sent during initialization
    customMetadata: tx.metadata,
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
    // 1-5: Your existing signature verification and order lookup code
    const paystackSignature = req.headers["x-paystack-signature"];
    
    if (!paystackSignature) {
      console.warn("❌ Missing Paystack signature");
      return res.status(400).send("Missing signature");
    }

    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest("hex");

    if (hash !== paystackSignature) {
      console.warn("❌ Invalid Paystack webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data: tx } = payload;

    console.log("📨 Paystack webhook event:", event);

    if (event !== "charge.success") {
      return res.status(200).json({ message: "Event ignored" });
    }

    const order = await Order.findOne({
      "paymentInfo.reference": tx.reference
    });

    if (!order) {
      console.warn("⚠️ Webhook: Order not found for reference:", tx.reference);
      return res.status(200).json({
        message: "Order not found, ignoring webhook"
      });
    }

    if (order.paymentInfo.status === "success") {
      console.log("ℹ️ Webhook: Already processed");
      return res.status(200).json({ message: "Already processed" });
    }

    // 6: Update order
    order.paymentInfo.status = "success";
    order.paymentInfo.providerTxId = tx.id;
    order.paymentInfo.paidAt = new Date(tx.paid_at);
    order.amountPaid = tx.amount / 100;

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
      customMetadata: tx.metadata,
      raw: tx
    };

    await order.save();
    console.log("✅ Order updated via webhook");

    // 7: CREATE RECEIPT 
    try {
      const { createReceiptIfNotExists } = await import('../receipt.service.js');
      
      await createReceiptIfNotExists({
        orderId: order._id,
        userId: order.user,
        reference: tx.reference, 
        orderItems: order.orderItems,
        itemPrice: order.itemPrice,
        taxPrice: order.taxPrice,
        shippingPrice: order.shippingPrice,
        totalPrice: order.totalPrice,
        shippingInfo: order.shippingInfo,
        currency: order.paymentInfo.currency,
        paymentGateway: 'paystack'
      });
      
      console.log("✅ Receipt created via Paystack webhook");
    } catch (receiptErr) {
      console.error("⚠️ Receipt creation failed:", receiptErr);
      // Don't fail the webhook for receipt errors
    }

    console.log("✅ Webhook: Order confirmed for reference:", tx.reference);
    return res.status(200).json({ message: "Order confirmed" });

  } catch (err) {
    console.error("❌ Paystack webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}

