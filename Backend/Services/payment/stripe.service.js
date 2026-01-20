import axios from 'axios';
import crypto from 'crypto';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Initialize Stripe Payment Intent
 * @param {Object} params - Payment initialization parameters
 * @returns {Object} Stripe payment intent with client secret
 */
export async function initializeStripePayment({
  email,
  amount,
  currency = "USD",
  reference,
  userId,
  orderReference,
  itemCount,
  callback_url,
  customer_name
}) {
  const url = "https://api.stripe.com/v1/payment_intents";

  // Stripe expects amount in smallest currency unit (cents for USD, pence for GBP)
  const amountInMinorUnit = Math.round(amount * 100);

  try {
    // Create payment intent
    const { data } = await axios.post(
      url,
      new URLSearchParams({
        amount: amountInMinorUnit,
        currency: currency.toLowerCase(),
        'metadata[user_id]': userId,
        'metadata[order_reference]': orderReference,
        'metadata[item_count]': itemCount,
        'metadata[payment_source]': 'epicstore',
        'metadata[tx_ref]': reference,
        receipt_email: email,
        description: `Order ${orderReference} - ${itemCount} items`
      }),
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 10000
      }
    );

    return {
      success: true,
      client_secret: data.client_secret,
      payment_intent_id: data.id,
      reference: reference
    };

  } catch (err) {
    console.error("Stripe initialization error:", err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message || 
      err.message || 
      "Failed to initialize Stripe payment"
    );
  }
}

/**
 * Verify Stripe Payment Intent with retry logic
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @param {number} maxAttempts - Number of retries for verification
 * @returns {Object} Stripe payment intent data
 */
export async function verifyStripeTransaction(paymentIntentId, maxAttempts = 3) {
  const url = `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const { data } = await axios.get(url, {
        headers: { 
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` 
        },
        timeout: 8000
      });

      if (data.status === "succeeded") {
        return data;
      }

      throw new Error(`Stripe status: ${data.status || "unknown"}`);
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
 * Verify payment and update pending order
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
  // 1. For Stripe, reference could be payment_intent_id
  // We need to verify using the payment intent ID
  let paymentIntent;
  
  try {
    paymentIntent = await verifyStripeTransaction(reference);
  } catch (err) {
    throw new Error("Payment verification failed: " + err.message);
  }

  // 2. Convert Stripe amount (cents → dollars/pounds/euros)
  const stripeAmount = paymentIntent.amount / 100;
  const currency = paymentIntent.currency.toUpperCase();

  // 3. Validate currency matches expected
  if (currency !== expectedCurrency.toUpperCase()) {
    throw new Error(
      `Currency mismatch: expected ${expectedCurrency}, got ${currency}`
    );
  }

  // 4. Validate amount matches pending order (critical security check)
  if (Math.abs(Number(expectedAmount) - stripeAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, gateway charged ${stripeAmount}`
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
  order.paymentInfo.providerTxId = paymentIntent.id;
  order.paymentInfo.paidAt = new Date(paymentIntent.created * 1000); // Stripe uses Unix timestamp
  order.amountPaid = stripeAmount;

  // 9. Store payment metadata
  const paymentMethod = paymentIntent.charges?.data[0]?.payment_method_details;
  
  order.paymentMeta = {
    channel: paymentMethod?.type || "card",
    customer: {
      email: paymentIntent.receipt_email
    },
    cardDetails: paymentMethod?.card ? {
      last4: paymentMethod.card.last4,
      brand: paymentMethod.card.brand,
      expMonth: paymentMethod.card.exp_month,
      expYear: paymentMethod.card.exp_year
    } : undefined,
    customMetadata: paymentIntent.metadata,
    raw: paymentIntent
  };

  await order.save();

  return { 
    success: true, 
    order,
    alreadyProcessed: false 
  };
}

/**
 * Handle Stripe webhook with signature verification
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */

export async function handleWebhook(req, res) {
  try {
    // 1-4: Signature verification (your existing code)
    const stripeSignature = req.headers["stripe-signature"];
    
    if (!stripeSignature) {
      console.warn("❌ Missing Stripe signature");
      return res.status(400).send("Missing signature");
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    const elements = stripeSignature.split(',');
    const timestamp = elements.find(el => el.startsWith('t='))?.split('=')[1];
    const signatures = elements
      .filter(el => el.startsWith('v1='))
      .map(el => el.split('=')[1]);

    if (!timestamp || signatures.length === 0) {
      console.warn("❌ Invalid Stripe signature format");
      return res.status(400).send("Invalid signature");
    }

    const signedPayload = `${timestamp}.${req.body.toString()}`;
    
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(signedPayload)
      .digest("hex");

    const isValid = signatures.some(sig => 
      crypto.timingSafeEqual(
        Buffer.from(sig, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      )
    );

    if (!isValid) {
      console.warn("❌ Invalid Stripe webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (timestampAge > 300) {
      console.warn("❌ Stripe webhook timestamp too old");
      return res.status(400).send("Timestamp too old");
    }

    // 5-7: Parse and process event
    const event = JSON.parse(req.body.toString());

    console.log("📨 Stripe webhook event:", event.type);

    if (event.type !== "payment_intent.succeeded") {
      return res.status(200).json({ message: "Event ignored" });
    }

    const paymentIntent = event.data.object;

    const orderReference = paymentIntent.metadata?.tx_ref;
    
    if (!orderReference) {
      console.warn("⚠️ Webhook: No order reference in metadata");
      return res.status(200).json({ message: "No order reference" });
    }

    const order = await Order.findOne({
      "paymentInfo.reference": orderReference
    });

    if (!order) {
      console.warn("⚠️ Webhook: Order not found for reference:", orderReference);
      return res.status(200).json({
        message: "Order not found, ignoring webhook"
      });
    }

    if (order.paymentInfo.status === "success") {
      console.log("ℹ️ Webhook: Already processed");
      return res.status(200).json({ message: "Already processed" });
    }

    // 8: Update order
    order.paymentInfo.status = "success";
    order.paymentInfo.providerTxId = paymentIntent.id;
    order.paymentInfo.paidAt = new Date(paymentIntent.created * 1000);
    order.amountPaid = paymentIntent.amount / 100;

    const paymentMethod = paymentIntent.charges?.data[0]?.payment_method_details;
    
    order.paymentMeta = {
      channel: paymentMethod?.type || "card",
      customer: {
        email: paymentIntent.receipt_email
      },
      cardDetails: paymentMethod?.card ? {
        last4: paymentMethod.card.last4,
        brand: paymentMethod.card.brand,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year
      } : undefined,
      customMetadata: paymentIntent.metadata,
      raw: paymentIntent
    };

    await order.save();
    console.log("✅ Order updated via webhook");

    // 9: ✅ CREATE RECEIPT (correct location)
    try {
      const { createReceiptIfNotExists } = await import('../receipt.service.js');
      
      await createReceiptIfNotExists({
        orderId: order._id,
        userId: order.user,
        reference: orderReference, 
        orderItems: order.orderItems,
        itemPrice: order.itemPrice,
        taxPrice: order.taxPrice,
        shippingPrice: order.shippingPrice,
        totalPrice: order.totalPrice,
        shippingInfo: order.shippingInfo,
        currency: order.paymentInfo.currency,
        paymentGateway: 'stripe'
      });
      
      console.log("✅ Receipt created via Stripe webhook");
    } catch (receiptErr) {
      console.error("⚠️ Receipt creation failed:", receiptErr);
      // Don't fail the webhook for receipt errors
    }

    console.log("✅ Webhook: Order confirmed for reference:", orderReference);
    return res.status(200).json({ message: "Order confirmed" });

  } catch (err) {
    console.error("❌ Stripe webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}