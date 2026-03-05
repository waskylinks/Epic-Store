import axios from 'axios';
import crypto from 'crypto';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IS_PROD = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map Stripe refund status → our internal order refund status.
 *
 * Stripe refund lifecycle:
 *   pending → succeeded | failed | canceled | requires_action
 *
 * Dev rule  : any non-failed response → 'completed'
 *             (Stripe test mode refunds actually succeed so this is accurate)
 * Prod rule : map honestly
 */
const mapStripeRefundStatus = (stripeStatus) => {
  if (!IS_PROD) {
    const failStatuses = ['failed', 'canceled'];
    return failStatuses.includes(stripeStatus) ? 'failed' : 'completed';
  }

  switch (stripeStatus) {
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'pending':
    case 'requires_action':
    default:
      return 'processing';
  }
};

/**
 * Stripe only accepts these values for the reason field.
 * Anything else causes a 400 error.
 */
const VALID_STRIPE_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'];

const resolveStripeReason = (reason) => {
  if (VALID_STRIPE_REASONS.includes(reason)) return reason;
  return 'requested_by_customer'; // safe default for all refund requests
};

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZE
// ─────────────────────────────────────────────────────────────────────────────

export async function initializeStripePayment({
  email,
  amount,
  currency,
  reference,
  userId,
  orderReference,
  itemCount,
  callback_url,
  customer_name,
}) {
  const url = 'https://api.stripe.com/v1/payment_intents';
  const amountInMinorUnit = Math.round(amount * 100);

  try {
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
        description: `Order ${orderReference} - ${itemCount} items`,
      }),
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    );

    return {
      success: true,
      client_secret: data.client_secret,
      payment_intent_id: data.id,
      reference,
    };
  } catch (err) {
    console.error('Stripe initialization error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message || err.message || 'Failed to initialize Stripe payment'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyStripeTransaction(paymentIntentId, maxAttempts = 3) {
  const url = `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        timeout: 8000,
      });

      if (data.status === 'succeeded') {
        return data;
      }

      throw new Error(`Stripe status: ${data.status || 'unknown'}`);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(attempt * 500);
        continue;
      }
      throw lastErr;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY AND UPDATE ORDER
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyAndUpdateOrder({ reference, orderId, expectedAmount, expectedCurrency, userId }) {
  let paymentIntent;

  try {
    paymentIntent = await verifyStripeTransaction(reference);
  } catch (err) {
    throw new Error('Payment verification failed: ' + err.message);
  }

  const stripeAmount = paymentIntent.amount / 100;
  const currency = paymentIntent.currency.toUpperCase();

  if (currency !== expectedCurrency.toUpperCase()) {
    throw new Error(`Currency mismatch: expected ${expectedCurrency}, got ${currency}`);
  }

  if (Math.abs(Number(expectedAmount) - stripeAmount) > 0.01) {
    throw new Error(`Amount mismatch: expected ${expectedAmount}, gateway charged ${stripeAmount}`);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new Error('Order not found');

  if (order.user.toString() !== userId.toString()) {
    throw new Error('Unauthorized: Order does not belong to user');
  }

  if (order.paymentInfo.status === 'success') {
    return { success: true, order, alreadyProcessed: true };
  }

  order.paymentInfo.status = 'success';
  order.paymentInfo.providerTxId = paymentIntent.id;
  order.paymentInfo.paidAt = new Date(paymentIntent.created * 1000);
  order.amountPaid = stripeAmount;

  const paymentMethod = paymentIntent.charges?.data[0]?.payment_method_details;

  order.paymentMeta = {
    channel: paymentMethod?.type || 'card',
    customer: { email: paymentIntent.receipt_email },
    cardDetails: paymentMethod?.card
      ? {
          last4: paymentMethod.card.last4,
          brand: paymentMethod.card.brand,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
        }
      : undefined,
    customMetadata: paymentIntent.metadata,
    raw: paymentIntent,
  };

  await order.save();
  return { success: true, order, alreadyProcessed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// REFUND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process Stripe refund.
 *
 * Stripe refund API: POST https://api.stripe.com/v1/refunds
 * Required: payment_intent (the original payment intent ID)
 * Optional: amount (in cents — omit for full refund), reason, metadata
 *
 * IMPORTANT: reason must be one of: duplicate | fraudulent | requested_by_customer
 * Any other value causes a 400. We resolve to 'requested_by_customer' as the
 * safe default for all customer-initiated refund requests.
 *
 * Stripe test mode: refunds fully succeed and can be verified in dashboard.
 * Response statuses: pending → succeeded | failed | canceled | requires_action
 */
export async function refundPayment({ paymentIntentId, amount, reason, merchantNote }) {
  const url = 'https://api.stripe.com/v1/refunds';

  try {
    const refundParams = new URLSearchParams({
      payment_intent: paymentIntentId,
      reason: resolveStripeReason(reason),
    });

    // amount is optional — omit for full refund
    if (amount) {
      refundParams.append('amount', String(Math.round(amount * 100))); // convert to cents
    }

    if (merchantNote) {
      refundParams.append('metadata[merchant_note]', merchantNote);
    }

    console.log(`[Stripe] Initiating refund | payment_intent=${paymentIntentId} | amount=${amount ?? 'full'}`);

    const { data } = await axios.post(url, refundParams, {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    });

    console.log(`[Stripe] Refund response | id=${data.id} | status=${data.status}`);

    return {
      success: true,
      refundId: data.id,
      status: mapStripeRefundStatus(data.status),
      gatewayStatus: data.status,
      amount: data.amount / 100,
      currency: data.currency.toUpperCase(),
      paymentIntentId: data.payment_intent,
      reason: data.reason,
      receiptNumber: data.receipt_number,
      createdAt: new Date(data.created * 1000).toISOString(),
      raw: data,
    };
  } catch (err) {
    console.error('[Stripe] Refund error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message || err.message || 'Failed to process Stripe refund'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET REFUND STATUS
// ─────────────────────────────────────────────────────────────────────────────

export async function getRefundStatus(refundId) {
  const url = `https://api.stripe.com/v1/refunds/${refundId}`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      timeout: 8000,
    });

    return {
      success: true,
      refundId: data.id,
      status: mapStripeRefundStatus(data.status),
      gatewayStatus: data.status,
      amount: data.amount / 100,
      currency: data.currency.toUpperCase(),
      paymentIntentId: data.payment_intent,
      reason: data.reason,
      failureReason: data.failure_reason,
      createdAt: new Date(data.created * 1000).toISOString(),
      raw: data,
    };
  } catch (err) {
    console.error('[Stripe] Get refund status error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message || err.message || 'Failed to get Stripe refund status'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle Stripe webhooks — both payment and refund events.
 *
 * Payment events : payment_intent.succeeded
 * Refund events  : refund.created | refund.updated | refund.failed
 *
 * refund.created  fires immediately when refund is initiated (status: pending)
 * refund.updated  fires when status changes (pending → succeeded | failed)
 * refund.failed   fires on failure
 *
 * Refund webhook payload shape:
 * {
 *   type: "refund.updated",
 *   data: {
 *     object: {
 *       id: "re_xxx",
 *       status: "succeeded" | "failed" | "pending" | "canceled",
 *       amount: <cents>,
 *       currency: "usd",
 *       payment_intent: "pi_xxx",
 *       reason: "requested_by_customer",
 *       metadata: { merchant_note: "..." }
 *     }
 *   }
 * }
 */
export async function handleWebhook(req, res) {
  try {
    const stripeSignature = req.headers['stripe-signature'];

    if (!stripeSignature) {
      console.warn('❌ Missing Stripe signature');
      return res.status(400).send('Missing signature');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    const elements = stripeSignature.split(',');
    const timestamp = elements.find((el) => el.startsWith('t='))?.split('=')[1];
    const signatures = elements
      .filter((el) => el.startsWith('v1='))
      .map((el) => el.split('=')[1]);

    if (!timestamp || signatures.length === 0) {
      console.warn('❌ Invalid Stripe signature format');
      return res.status(400).send('Invalid signature');
    }

    const signedPayload = `${timestamp}.${req.body.toString()}`;
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const isValid = signatures.some((sig) => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(sig, 'hex'),
          Buffer.from(expectedSignature, 'hex')
        );
      } catch {
        return false;
      }
    });

    if (!isValid) {
      console.warn('❌ Invalid Stripe webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (timestampAge > 300) {
      console.warn('❌ Stripe webhook timestamp too old');
      return res.status(400).send('Timestamp too old');
    }

    const event = JSON.parse(req.body.toString());
    console.log('📨 Stripe webhook event:', event.type);

    // ── Payment event ─────────────────────────────────────────────────────────
    if (event.type === 'payment_intent.succeeded') {
      return await handleStripePaymentSucceeded(event.data.object, res);
    }

    // ── Refund events ─────────────────────────────────────────────────────────
    // refund.created  → status is 'pending', we stay in 'processing'
    // refund.updated  → status changed, this is the key event to act on
    // refund.failed   → explicit failure event
    if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
      return await handleStripeRefundEvent(event.type, event.data.object, res);
    }

    return res.status(200).json({ message: 'Event ignored' });
  } catch (err) {
    console.error('❌ Stripe webhook error:', err);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
}

// ── Internal: handle payment_intent.succeeded ─────────────────────────────────
async function handleStripePaymentSucceeded(paymentIntent, res) {
  const orderReference = paymentIntent.metadata?.tx_ref;

  if (!orderReference) {
    console.warn('⚠️ Webhook: No order reference in metadata');
    return res.status(200).json({ message: 'No order reference' });
  }

  const order = await Order.findOne({ 'paymentInfo.reference': orderReference });

  if (!order) {
    console.warn('⚠️ Webhook: Order not found for reference:', orderReference);
    return res.status(200).json({ message: 'Order not found, ignoring webhook' });
  }

  if (order.paymentInfo.status === 'success') {
    console.log('ℹ️ Webhook: Payment already processed');
    return res.status(200).json({ message: 'Already processed' });
  }

  order.paymentInfo.status = 'success';
  order.paymentInfo.providerTxId = paymentIntent.id;
  order.paymentInfo.paidAt = new Date(paymentIntent.created * 1000);
  order.amountPaid = paymentIntent.amount / 100;

  const paymentMethod = paymentIntent.charges?.data[0]?.payment_method_details;

  order.paymentMeta = {
    channel: paymentMethod?.type || 'card',
    customer: { email: paymentIntent.receipt_email },
    cardDetails: paymentMethod?.card
      ? {
          last4: paymentMethod.card.last4,
          brand: paymentMethod.card.brand,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
        }
      : undefined,
    customMetadata: paymentIntent.metadata,
    raw: paymentIntent,
  };

  await order.save();
  console.log('✅ Stripe payment confirmed via webhook');

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
      paymentGateway: 'stripe',
    });
    console.log('✅ Receipt created via Stripe webhook');
  } catch (receiptErr) {
    console.error('⚠️ Receipt creation failed:', receiptErr);
  }

  return res.status(200).json({ message: 'Order confirmed' });
}

// ── Internal: handle refund webhook events ────────────────────────────────────
async function handleStripeRefundEvent(eventType, refund, res) {
  // Stripe refund object contains payment_intent ID
  // We need to find our order by the payment intent ID stored in paymentInfo
  const paymentIntentId = refund.payment_intent;

  if (!paymentIntentId) {
    console.warn('⚠️ Stripe refund webhook: no payment_intent on refund object');
    return res.status(200).json({ message: 'No payment_intent, ignoring' });
  }

  // Find order by stripePaymentIntentId or providerTxId
  const order = await Order.findOne({
    $or: [
      { 'paymentInfo.stripePaymentIntentId': paymentIntentId },
      { 'paymentInfo.providerTxId': paymentIntentId },
    ],
  });

  if (!order) {
    console.warn('⚠️ Stripe refund webhook: order not found for payment_intent:', paymentIntentId);
    return res.status(200).json({ message: 'Order not found, ignoring' });
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    console.warn('⚠️ Stripe refund webhook: order has no refund request');
    return res.status(200).json({ message: 'No refund request on order, ignoring' });
  }

  if (!['processing', 'approved'].includes(order.refundInfo.status)) {
    console.log(`ℹ️ Stripe refund webhook: already in terminal state (${order.refundInfo.status}), ignoring`);
    return res.status(200).json({ message: 'Already in terminal state' });
  }

  const gatewayStatus = refund.status; // pending | succeeded | failed | canceled
  const newStatus = mapStripeRefundStatus(gatewayStatus);

  // refund.created with status=pending — stay in processing, nothing to update yet
  if (eventType === 'refund.created' && newStatus === 'processing') {
    console.log(`[Stripe] Refund created (pending) for order=${order._id}, staying in processing`);
    return res.status(200).json({ message: 'Refund created, awaiting completion' });
  }

  console.log(`[Stripe] Refund webhook: ${eventType} | order=${order._id} | ${order.refundInfo.status} → ${newStatus}`);

  order.refundInfo.status = newStatus;
  order.refundInfo.gatewayStatus = gatewayStatus;
  order.refundInfo.gatewayResponse = refund;

  const refundAmount = refund.amount / 100;

  if (newStatus === 'completed') {
    order.refundInfo.refundedAt = new Date(refund.created * 1000);
    order.refundInfo.refundAmount = refundAmount;

    if (typeof order.addRefundTimeline === 'function') {
      order.addRefundTimeline(
        'refund_completed',
        `Refund of $${refundAmount.toFixed(2)} confirmed by Stripe (ref: ${refund.id})`,
        null,
        { gatewayStatus, stripeRefundId: refund.id }
      );
    }

    if (typeof order.addRefundMessage === 'function') {
      order.addRefundMessage(
        null,
        'admin',
        `Your refund of $${refundAmount.toFixed(2)} has been confirmed by Stripe and should appear within 5–10 business days.`
      );
    }
  } else if (newStatus === 'failed') {
    order.refundInfo.failureReason =
      refund.failure_reason || `Stripe refund ${gatewayStatus}: ${eventType}`;

    if (typeof order.addRefundTimeline === 'function') {
      order.addRefundTimeline(
        'refund_failed',
        `Refund failed via Stripe: ${refund.failure_reason || gatewayStatus}`,
        null,
        { eventType, gatewayStatus, stripeRefundId: refund.id }
      );
    }
  }

  await order.save();
  console.log(`✅ Stripe refund webhook processed: order=${order._id} status=${newStatus}`);

  return res.status(200).json({ message: 'Refund webhook processed' });
}