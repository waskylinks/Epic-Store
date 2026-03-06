import axios from 'axios';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IS_PROD = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map Flutterwave refund status → our internal order refund status.
 *
 * Flutterwave refund lifecycle: pending → completed | failed
 *
 * Dev rule  : any non-failed response → 'completed'
 * Prod rule : map honestly
 */
const mapFlutterwaveRefundStatus = (flwStatus) => {
  if (!IS_PROD) {
    return flwStatus === 'failed' ? 'failed' : 'completed';
  }

  switch (flwStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'pending':
    default:
      return 'processing';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZE
// ─────────────────────────────────────────────────────────────────────────────

export async function initializeFlutterwavePayment({
  email,
  amount,
  currency,
  reference,
  userId,
  orderReference,
  itemCount,
  callback_url,
  customer_name,
  customer_phone,
}) {
  const url = 'https://api.flutterwave.com/v3/payments';

  try {
    const { data } = await axios.post(
      url,
      {
        tx_ref: reference,
        amount,
        currency: currency.toUpperCase(),
        redirect_url: callback_url,
        customer: {
          email,
          name: customer_name || email.split('@')[0],
          phonenumber: customer_phone || '',
        },
        customizations: {
          title: 'EpicStore Payment',
          description: `Order ${orderReference}`,
          logo: `${process.env.FRONTEND_URL}/logo.png`,
        },
        meta: {
          user_id: userId,
          order_reference: orderReference,
          item_count: itemCount,
          payment_source: 'epicstore',
          initialized_at: new Date().toISOString(),
        },
        payment_options: 'card,banktransfer,ussd,mobilemoney',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (data.status !== 'success') {
      throw new Error(data.message || 'Flutterwave initialization failed');
    }

    return {
      success: true,
      payment_link: data.data.link,
      reference,
    };
  } catch (err) {
    console.error('Flutterwave initialization error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || err.message || 'Failed to initialize Flutterwave payment'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a Flutterwave transaction.
 *
 * Resolution priority:
 *  1. transactionId (numeric) provided → GET /v3/transactions/:id/verify  (fastest)
 *  2. reference is already numeric     → same endpoint
 *  3. reference is a tx_ref string     → GET /v3/transactions/verify_by_reference?tx_ref=...
 */
export async function verifyFlutterwaveTransaction(reference, maxAttempts = 3, transactionId = null) {
  let url;

  if (transactionId) {
    url = `https://api.flutterwave.com/v3/transactions/${String(transactionId)}/verify`;
    console.log(`✅ Using provided transaction_id directly: ${transactionId}`);
  } else if (!isNaN(Number(reference))) {
    url = `https://api.flutterwave.com/v3/transactions/${String(reference)}/verify`;
    console.log(`✅ Reference is numeric, using as transaction_id: ${reference}`);
  } else {
    console.log(`🔍 [flw] Verifying by tx_ref via verify_by_reference: ${reference}`);
    url = `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`;
  }

  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
        timeout: 8000,
      });

      if (data.status === 'success' && data.data) {
        const tx = data.data;
        if (tx.status === 'successful') {
          console.log(`✅ [flw] Transaction verified on attempt ${attempt}`);
          return tx;
        }
        throw new Error(`Flutterwave status: ${tx.status || 'unknown'}`);
      }

      throw new Error(data.message || 'Unexpected response from Flutterwave');
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

export async function verifyAndUpdateOrder({ reference, transactionId, orderId, expectedAmount, expectedCurrency, userId }) {
  let tx;
  let order;

  try {
    console.log(`🔍 Verifying Flutterwave transaction: ${reference}${transactionId ? ` (transaction_id: ${transactionId})` : ''}`);
    tx = await verifyFlutterwaveTransaction(reference, 3, transactionId || null);
    console.log(`✅ Transaction verified. tx_ref: ${tx.tx_ref}, amount: ${tx.amount}`);
  } catch (err) {
    console.error('Flutterwave verification failed:', err);
    throw new Error('Transaction verification failed: ' + err.message);
  }

  try {
    order = await Order.findOne({ 'paymentInfo.reference': tx.tx_ref, user: userId });
    if (!order) throw new Error(`Order not found for tx_ref: ${tx.tx_ref}`);
    console.log(`✅ Order found: ${order._id} for tx_ref: ${tx.tx_ref}`);
  } catch (err) {
    throw new Error(`Order lookup failed: ${err.message}`);
  }

  const flutterwaveAmount = parseFloat(tx.amount);
  const currency = tx.currency;

  if (currency.toUpperCase() !== order.paymentInfo.currency.toUpperCase()) {
    throw new Error(`Currency mismatch: expected ${order.paymentInfo.currency}, got ${currency}`);
  }

  if (Math.abs(order.totalPrice - flutterwaveAmount) > 0.01) {
    throw new Error(`Amount mismatch: expected ${order.totalPrice}, gateway charged ${flutterwaveAmount}`);
  }

  if (order.paymentInfo.status === 'success') {
    return { success: true, order, alreadyProcessed: true };
  }

  order.paymentInfo.status = 'success';
  order.paymentInfo.providerTxId = tx.id;
  order.paymentInfo.paidAt = new Date(tx.created_at);
  order.amountPaid = flutterwaveAmount;

  order.paymentMeta = {
    channel: tx.payment_type,
    ipAddress: tx.ip,
    customer: tx.customer,
    cardDetails: tx.card
      ? {
          last4: tx.card.last_4digits,
          brand: tx.card.type,
          expMonth: tx.card.expiry?.split('/')[0],
          expYear: tx.card.expiry?.split('/')[1],
        }
      : undefined,
    customMetadata: tx.meta,
    raw: tx,
  };

  await order.save();
  return { success: true, order, alreadyProcessed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// REFUND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initiate a Flutterwave refund.
 *
 * CORRECT endpoint : POST /v3/transactions/{id}/refund
 *   {id}  = numeric Flutterwave transaction ID  (order.paymentInfo.providerTxId)
 *   body  = { amount }  — partial refund if less than original; omit for full refund
 *
 * PREVIOUS BUG: used POST /refunds (missing /v3/, wrong structure) → 404 "Cannot POST /refunds"
 *
 * Comparison with other gateways (same controller pattern):
 *   Paystack    : POST /refund           { transaction: ref, amount }
 *   Stripe      : POST /refunds          { payment_intent, amount }
 *   Flutterwave : POST /v3/transactions/{id}/refund  { amount }  ← this function
 *
 * @param {string|number} chargeId    - order.paymentInfo.providerTxId (numeric Flutterwave tx ID)
 * @param {number}        amount      - Amount to refund in the original transaction currency
 * @param {string}        reason      - Reason string (internal record only)
 * @param {string}        merchantNote - Admin note (internal record only)
 */
export async function refundPayment({ chargeId, amount, reason, merchantNote }) {
  // chargeId = order.paymentInfo.providerTxId — the numeric Flutterwave transaction ID
  const url = `https://api.flutterwave.com/v3/transactions/${chargeId}/refund`;

  try {
    const refundBody = {
      amount: Number(amount),
    };

    console.log(`[Flutterwave] Initiating refund | transaction_id=${chargeId} | amount=${amount}`);

    const { data } = await axios.post(url, refundBody, {
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    if (data.status !== 'success' || !data.data) {
      throw new Error(data.message || 'Flutterwave refund failed — no data in response');
    }

    const refund = data.data;
    console.log(`[Flutterwave] Refund response | id=${refund.id} | status=${refund.status}`);

    return {
      success: true,
      refundId: refund.id,
      status: mapFlutterwaveRefundStatus(refund.status),
      gatewayStatus: refund.status,
      amount: parseFloat(refund.amount_refunded ?? refund.amount ?? amount),
      chargeId: refund.transaction_id ?? chargeId,
      createdAt: refund.created_at,
      raw: refund,
    };
  } catch (err) {
    console.error('[Flutterwave] Refund error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || err.message || 'Failed to process Flutterwave refund'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET REFUND STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch refund status for a transaction.
 *
 * Flutterwave endpoint: GET /v3/transactions/{id}/refunds
 *   Returns an array of refunds for that transaction; we take the latest one.
 *
 * @param {string|number} refundId  - The numeric Flutterwave transaction ID
 *                                    (same chargeId used in refundPayment)
 */
export async function getRefundStatus(refundId) {
  const url = `https://api.flutterwave.com/v3/transactions/${refundId}/refunds`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
      timeout: 8000,
    });

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error(data.message || 'No refund found for this transaction');
    }

    // Take the most recent refund entry
    const refund = data.data[data.data.length - 1];

    return {
      success: true,
      refundId: refund.id,
      status: mapFlutterwaveRefundStatus(refund.status),
      gatewayStatus: refund.status,
      amount: parseFloat(refund.amount_refunded ?? refund.amount),
      chargeId: refund.transaction_id ?? refundId,
      createdAt: refund.created_at,
      raw: refund,
    };
  } catch (err) {
    console.error('[Flutterwave] Get refund status error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message || err.message || 'Failed to get Flutterwave refund status'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────

export async function handleWebhook(req, res) {
  try {
    const flutterwaveSignature = req.headers['verif-hash'];

    if (!flutterwaveSignature) {
      console.warn('Missing Flutterwave signature');
      return res.status(400).send('Missing signature');
    }

    if (flutterwaveSignature !== process.env.FLUTTERWAVE_SECRET_HASH) {
      console.warn('Invalid Flutterwave webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data: tx } = payload;

    console.log('📨 Flutterwave webhook event:', event);

    if (event === 'charge.completed') {
      return await handleFlutterwaveChargeCompleted(tx, res);
    }

    if (event === 'refund.completed' || event === 'refund.failed') {
      return await handleFlutterwaveRefundEvent(event, tx, res);
    }

    return res.status(200).json({ message: 'Event ignored' });
  } catch (err) {
    console.error('Flutterwave webhook error:', err);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
}

async function handleFlutterwaveChargeCompleted(tx, res) {
  if (tx.status !== 'successful') {
    console.warn('Webhook: Transaction not successful:', tx.status);
    return res.status(200).json({ message: 'Transaction not successful' });
  }

  const order = await Order.findOne({ 'paymentInfo.reference': tx.tx_ref });

  if (!order) {
    console.warn('Webhook: Order not found for reference:', tx.tx_ref);
    return res.status(200).json({ message: 'Order not found, ignoring webhook' });
  }

  if (order.paymentInfo.status === 'success') {
    return res.status(200).json({ message: 'Already processed' });
  }

  order.paymentInfo.status = 'success';
  order.paymentInfo.providerTxId = tx.id;
  order.paymentInfo.paidAt = new Date(tx.created_at);
  order.amountPaid = parseFloat(tx.amount);

  order.paymentMeta = {
    channel: tx.payment_type,
    ipAddress: tx.ip,
    customer: tx.customer,
    cardDetails: tx.card
      ? {
          last4: tx.card.last_4digits,
          brand: tx.card.type,
          expMonth: tx.card.expiry?.split('/')[0],
          expYear: tx.card.expiry?.split('/')[1],
        }
      : undefined,
    customMetadata: tx.meta,
    raw: tx,
  };

  await order.save();
  console.log('✅ Flutterwave payment confirmed via webhook');

  try {
    const { createReceiptIfNotExists } = await import('../receipt.service.js');
    await createReceiptIfNotExists({
      orderId: order._id,
      userId: order.user,
      reference: order.paymentInfo.reference,
      orderItems: order.orderItems,
      itemPrice: order.itemPrice,
      taxPrice: order.taxPrice,
      shippingPrice: order.shippingPrice,
      totalPrice: order.totalPrice,
      shippingInfo: order.shippingInfo,
      currency: order.paymentInfo.currency,
      paymentGateway: 'flutterwave',
    });
    console.log('✅ Receipt created via Flutterwave webhook');
  } catch (receiptErr) {
    console.error('⚠️ Receipt creation failed:', receiptErr);
  }

  return res.status(200).json({ message: 'Order confirmed' });
}

async function handleFlutterwaveRefundEvent(event, tx, res) {
  const orderRef = tx.tx_ref;

  if (!orderRef) {
    console.warn('⚠️ Flutterwave refund webhook: no tx_ref found in payload');
    return res.status(200).json({ message: 'No tx_ref found, ignoring' });
  }

  const order = await Order.findOne({ 'paymentInfo.reference': orderRef });

  if (!order) {
    console.warn('⚠️ Flutterwave refund webhook: order not found for ref:', orderRef);
    return res.status(200).json({ message: 'Order not found, ignoring' });
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    console.warn('⚠️ Flutterwave refund webhook: order has no refund request:', orderRef);
    return res.status(200).json({ message: 'No refund request on order, ignoring' });
  }

  if (!['processing', 'approved'].includes(order.refundInfo.status)) {
    console.log(`ℹ️ Flutterwave refund webhook: already in terminal state (${order.refundInfo.status}), ignoring`);
    return res.status(200).json({ message: 'Already in terminal state' });
  }

  const newStatus = event === 'refund.completed' ? 'completed' : 'failed';
  const refundAmount = parseFloat(tx.amount_refunded ?? tx.amount ?? 0);

  console.log(`[Flutterwave] Refund webhook: ${event} | order=${order._id} | ${order.refundInfo.status} → ${newStatus}`);

  order.refundInfo.status = newStatus;
  order.refundInfo.gatewayStatus = tx.status;
  order.refundInfo.gatewayResponse = tx;

  if (newStatus === 'completed') {
    order.refundInfo.refundedAt = new Date();
    order.refundInfo.refundAmount = refundAmount;

    if (typeof order.addRefundTimeline === 'function') {
      order.addRefundTimeline(
        'refund_completed',
        `Refund of $${refundAmount.toFixed(2)} confirmed by Flutterwave`,
        null,
        { gatewayStatus: tx.status }
      );
    }

    if (typeof order.addRefundMessage === 'function') {
      order.addRefundMessage(
        null,
        'admin',
        `Your refund of $${refundAmount.toFixed(2)} has been confirmed by the payment processor and should appear within 3–15 business days.`
      );
    }
  } else {
    order.refundInfo.failureReason = `Flutterwave refund failed: ${tx.status ?? 'unknown'}`;

    if (typeof order.addRefundTimeline === 'function') {
      order.addRefundTimeline(
        'refund_failed',
        `Refund failed via Flutterwave: ${tx.status ?? 'unknown'}`,
        null,
        { event, gatewayStatus: tx.status }
      );
    }
  }

  await order.save();
  console.log(`✅ Flutterwave refund webhook processed: order=${order._id} status=${newStatus}`);

  return res.status(200).json({ message: 'Refund webhook processed' });
}