import axios from 'axios';
import crypto from 'crypto';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IS_PROD = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map Paystack refund status → our internal order refund status.
 *
 * Paystack refund lifecycle:
 *   pending → processing → processed (success) | failed | needs-attention
 *
 * Dev rule  : any non-failed response → 'completed'
 * Prod rule : map honestly — 'processed' = completed, rest stay processing
 */
const mapPaystackRefundStatus = (paystackStatus) => {
  if (!IS_PROD) {
    // In dev/test: as long as Paystack accepted the request without throwing,
    // mark completed so you can see the full flow end-to-end.
    const failStatuses = ['failed', 'needs-attention'];
    return failStatuses.includes(paystackStatus) ? 'failed' : 'completed';
  }

  // Production: honest mapping
  switch (paystackStatus) {
    case 'processed':
      return 'completed';
    case 'failed':
    case 'needs-attention':
      return 'failed';
    case 'pending':
    case 'processing':
    default:
      return 'processing'; // stay in processing, webhook will update
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZE
// ─────────────────────────────────────────────────────────────────────────────

export async function initializePaystackPayment({
  email,
  amount,
  currency,
  reference,
  userId,
  orderReference,
  itemCount,
  callback_url
}) {
  const url = 'https://api.paystack.co/transaction/initialize';
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
          user_id: userId,
          order_reference: orderReference,
          item_count: itemCount,
          payment_source: 'epicstore',
          initialized_at: new Date().toISOString(),
          custom_fields: [
            {
              display_name: 'Order Reference',
              variable_name: 'order_reference',
              value: orderReference,
            },
            {
              display_name: 'Items',
              variable_name: 'item_count',
              value: itemCount.toString(),
            },
          ],
        },
        channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (!data.status) {
      throw new Error(data.message || 'Paystack initialization failed');
    }

    return {
      success: true,
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
    };
  } catch (err) {
    console.error('Paystack initialization error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || err.message || 'Failed to initialize Paystack payment'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyPaystackTransaction(reference, maxAttempts = 3) {
  const url = `https://api.paystack.co/transaction/verify/${reference}`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        timeout: 8000,
      });

      if (data.status === true && data.data.status === 'success') {
        return data.data;
      }

      throw new Error(`Paystack status: ${data.data?.status || 'unknown'}`);
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

export async function verifyAndUpdateOrder({
  reference,
  orderId,
  expectedAmount,
  expectedCurrency,
  userId,
}) {
  const tx = await verifyPaystackTransaction(reference);
  const paystackAmount = tx.amount / 100;
  const currency = tx.currency;

  if (currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
    throw new Error(`Currency mismatch: expected ${expectedCurrency}, got ${currency}`);
  }

  if (Math.abs(Number(expectedAmount) - paystackAmount) > 0.01) {
    throw new Error(`Amount mismatch: expected ${expectedAmount}, gateway charged ${paystackAmount}`);
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
  order.paymentInfo.providerTxId = tx.id;
  order.paymentInfo.paidAt = new Date(tx.paid_at);
  order.amountPaid = paystackAmount;

  order.paymentMeta = {
    channel: tx.channel,
    ipAddress: tx.ip_address,
    customer: tx.customer,
    authorization: tx.authorization,
    cardDetails: {
      last4: tx.authorization?.last4,
      brand: tx.authorization?.brand,
      expMonth: tx.authorization?.exp_month,
      expYear: tx.authorization?.exp_year,
    },
    customMetadata: tx.metadata,
    raw: tx,
  };

  await order.save();
  return { success: true, order, alreadyProcessed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATED
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyAndCreateOrder({
  reference,
  shippingInfo,
  orderItems,
  itemPrice,
  taxPrice,
  shippingPrice,
  totalPrice,
  amountPaid,
  userId,
}) {
  console.warn('verifyAndCreateOrder is deprecated. Use initializePayment + verifyAndUpdateOrder instead.');

  const tx = await verifyPaystackTransaction(reference);
  const paystackAmount = tx.amount / 100;
  const currency = tx.currency;

  if (currency !== 'NGN') throw new Error('Invalid payment currency');
  if (Math.abs(Number(totalPrice) - paystackAmount) > 0.01) throw new Error('Amount mismatch');

  const existingOrder = await Order.findOne({ 'paymentInfo.reference': reference });
  if (existingOrder) return { created: false, order: existingOrder, reason: 'duplicate' };

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
      method: 'paystack',
      currency: tx.currency,
      amount: paystackAmount,
      paidAt: new Date(tx.paid_at),
    },
    paymentMeta: {
      channel: tx.channel,
      ipAddress: tx.ip_address,
      customer: tx.customer,
      authorization: tx.authorization,
      raw: tx,
    },
  });

  return { created: true, order: newOrder };
}

// ─────────────────────────────────────────────────────────────────────────────
// REFUND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process Paystack refund.
 *
 * Paystack refund API: POST https://api.paystack.co/refund
 * Required: transaction (the original transaction reference or id)
 * Optional: amount (in kobo/cents — omit for full refund), merchant_note
 *
 * Response statuses: pending → processing → processed | failed | needs-attention
 */
export async function refundPayment({ transactionReference, amount, reason, merchantNote }) {
  const url = 'https://api.paystack.co/refund';

  try {
    const refundData = {
      transaction: transactionReference,
      ...(amount && { amount: Math.round(amount * 100) }), // convert to kobo
      ...(merchantNote && { merchant_note: merchantNote }),
    };

    console.log(`[Paystack] Initiating refund | ref=${transactionReference} | amount=${amount ?? 'full'}`);

    const { data } = await axios.post(url, refundData, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    if (!data.status) throw new Error(data.message || 'Paystack refund failed');

    console.log(`[Paystack] Refund response | id=${data.data.id} | status=${data.data.status}`);

    return {
      success: true,
      refundId: data.data.id,
      // Map to our internal status based on environment
      status: mapPaystackRefundStatus(data.data.status),
      gatewayStatus: data.data.status, // raw status from Paystack
      amount: data.data.amount / 100,
      currency: data.data.currency,
      transaction: data.data.transaction,
      createdAt: data.data.created_at,
      raw: data.data,
    };
  } catch (err) {
    console.error('[Paystack] Refund error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || err.message || 'Failed to process Paystack refund'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET REFUND STATUS
// ─────────────────────────────────────────────────────────────────────────────

export async function getRefundStatus(refundId) {
  const url = `https://api.paystack.co/refund/${refundId}`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      timeout: 8000,
    });

    if (!data.status) throw new Error(data.message || 'Failed to get refund status');

    return {
      success: true,
      refundId: data.data.id,
      status: mapPaystackRefundStatus(data.data.status),
      gatewayStatus: data.data.status,
      amount: data.data.amount / 100,
      currency: data.data.currency,
      fullyDeducted: data.data.fully_deducted,
      deductedAmount: data.data.deducted_amount / 100,
      raw: data.data,
    };
  } catch (err) {
    console.error('[Paystack] Get refund status error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || err.message || 'Failed to get Paystack refund status'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle Paystack webhooks — both payment and refund events.
 *
 * Payment events : charge.success
 * Refund events  : refund.pending | refund.processing | refund.processed
 *                  refund.failed  | refund.needs-attention
 *
 * Refund webhook payload shape:
 * {
 *   event: "refund.processed",
 *   data: {
 *     id: <refund_id>,
 *     status: "processed",
 *     transaction: { reference: "ORD-xxx" },
 *     amount: <kobo>,
 *     currency: "NGN"
 *   }
 * }
 */
export async function handleWebhook(req, res) {
  try {
    const paystackSignature = req.headers['x-paystack-signature'];

    if (!paystackSignature) {
      console.warn('❌ Missing Paystack signature');
      return res.status(400).send('Missing signature');
    }

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest('hex');

    if (hash !== paystackSignature) {
      console.warn('❌ Invalid Paystack webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data: tx } = payload;

    console.log('📨 Paystack webhook event:', event);

    // ── Payment event ─────────────────────────────────────────────────────────
    if (event === 'charge.success') {
      return await handlePaystackChargeSuccess(tx, res);
    }

    // ── Refund events ─────────────────────────────────────────────────────────
    const refundEvents = [
      'refund.pending',
      'refund.processing',
      'refund.processed',
      'refund.failed',
      'refund.needs-attention',
    ];

    if (refundEvents.includes(event)) {
      return await handlePaystackRefundEvent(event, tx, res);
    }

    return res.status(200).json({ message: 'Event ignored' });
  } catch (err) {
    console.error('❌ Paystack webhook error:', err);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
}

// ── Internal: handle charge.success ──────────────────────────────────────────
async function handlePaystackChargeSuccess(tx, res) {
  const order = await Order.findOne({ 'paymentInfo.reference': tx.reference });

  if (!order) {
    console.warn('⚠️ Webhook: Order not found for reference:', tx.reference);
    return res.status(200).json({ message: 'Order not found, ignoring webhook' });
  }

  if (order.paymentInfo.status === 'success') {
    console.log('ℹ️ Webhook: Payment already processed');
    return res.status(200).json({ message: 'Already processed' });
  }

  order.paymentInfo.status = 'success';
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
      expYear: tx.authorization?.exp_year,
    },
    customMetadata: tx.metadata,
    raw: tx,
  };

  await order.save();
  console.log('✅ Paystack payment confirmed via webhook');

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
      paymentGateway: 'paystack',
    });
    console.log('✅ Receipt created via Paystack webhook');
  } catch (receiptErr) {
    console.error('⚠️ Receipt creation failed:', receiptErr);
  }

  return res.status(200).json({ message: 'Order confirmed' });
}

// ── Internal: handle refund webhook events ────────────────────────────────────
async function handlePaystackRefundEvent(event, tx, res) {
  // Paystack sends the original transaction reference inside tx.transaction.reference
  const orderRef = tx.transaction?.reference ?? tx.reference;

  if (!orderRef) {
    console.warn('⚠️ Paystack refund webhook: no transaction reference found');
    return res.status(200).json({ message: 'No reference found, ignoring' });
  }

  const order = await Order.findOne({ 'paymentInfo.reference': orderRef });

  if (!order) {
    console.warn('⚠️ Paystack refund webhook: order not found for ref:', orderRef);
    return res.status(200).json({ message: 'Order not found, ignoring' });
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    console.warn('⚠️ Paystack refund webhook: order has no refund request:', orderRef);
    return res.status(200).json({ message: 'No refund request on order, ignoring' });
  }

  // Only update if currently processing — don't overwrite a completed/failed status
  if (!['processing', 'approved'].includes(order.refundInfo.status)) {
    console.log(`ℹ️ Paystack refund webhook: refund already in terminal state (${order.refundInfo.status}), ignoring`);
    return res.status(200).json({ message: 'Already in terminal state' });
  }

  const gatewayStatus = tx.status; // raw Paystack status

  // Map event to our status
  let newStatus;
  if (event === 'refund.processed') {
    newStatus = 'completed';
  } else if (event === 'refund.failed' || event === 'refund.needs-attention') {
    newStatus = 'failed';
  } else {
    // refund.pending or refund.processing — stay in processing
    newStatus = 'processing';
  }

  console.log(`[Paystack] Refund webhook: ${event} | order=${order._id} | ${order.refundInfo.status} → ${newStatus}`);

  order.refundInfo.status = newStatus;
  order.refundInfo.gatewayStatus = gatewayStatus;

  if (newStatus === 'completed') {
    order.refundInfo.refundedAt = new Date();
    order.refundInfo.refundAmount = tx.amount / 100;

    if (typeof order.addRefundTimeline === 'function') {
      order.addRefundTimeline(
        'refund_completed',
        `Refund of $${(tx.amount / 100).toFixed(2)} confirmed by Paystack`,
        null,
        { gatewayStatus }
      );
    }

    if (typeof order.addRefundMessage === 'function') {
      order.addRefundMessage(
        null,
        'admin',
        `Your refund of $${(tx.amount / 100).toFixed(2)} has been confirmed by the payment processor and should appear within 3–10 business days.`
      );
    }
  } else if (newStatus === 'failed') {
    order.refundInfo.failureReason = `Paystack refund ${event.replace('refund.', '')}: ${gatewayStatus}`;

    if (typeof order.addRefundTimeline === 'function') {
      order.addRefundTimeline(
        'refund_failed',
        `Refund failed via Paystack: ${gatewayStatus}`,
        null,
        { event, gatewayStatus }
      );
    }
  }

  // Store the raw webhook payload for debugging
  order.refundInfo.gatewayResponse = tx;

  await order.save();
  console.log(`✅ Paystack refund webhook processed: order=${order._id} status=${newStatus}`);

  return res.status(200).json({ message: 'Refund webhook processed' });
}