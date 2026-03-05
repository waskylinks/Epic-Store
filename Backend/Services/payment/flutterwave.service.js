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
 * Flutterwave refund lifecycle:
 *   new → pending → succeeded | failed
 *
 * Dev rule  : any non-failed response → 'completed'
 * Prod rule : map honestly
 */
const mapFlutterwaveRefundStatus = (flwStatus) => {
  if (!IS_PROD) {
    const failStatuses = ['failed'];
    return failStatuses.includes(flwStatus) ? 'failed' : 'completed';
  }

  switch (flwStatus) {
    case 'succeeded':
    case 'completed': // some versions return 'completed'
      return 'completed';
    case 'failed':
      return 'failed';
    case 'new':
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
// GET TRANSACTION BY REFERENCE
// ─────────────────────────────────────────────────────────────────────────────

export async function getTransactionByReference(txRef) {
  try {
    const url = `https://api.flutterwave.com/v3/transactions?tx_ref=${txRef}`;
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
      timeout: 8000,
    });

    if (data.status === 'success' && data.data && data.data.length > 0) {
      return data.data[0];
    }

    throw new Error('Transaction not found for tx_ref: ' + txRef);
  } catch (err) {
    console.error('Get transaction by reference error:', err.response?.data || err.message);
    throw new Error('Failed to get transaction: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyFlutterwaveTransaction(reference, maxAttempts = 3) {
  let transactionId = reference;

  if (isNaN(Number(reference))) {
    console.log(`🔍 Resolving tx_ref to transaction_id: ${reference}`);
    const tx = await getTransactionByReference(reference);
    transactionId = tx.id;
    console.log(`✅ Resolved transaction_id: ${transactionId}`);
  }

  const url = `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
        timeout: 8000,
      });

      if (data.status === 'success' && data.data.status === 'successful') {
        return data.data;
      }

      throw new Error(`Flutterwave status: ${data.data?.status || 'unknown'}`);
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
  let tx;
  let order;

  try {
    console.log(`🔍 Verifying Flutterwave transaction: ${reference}`);
    tx = await verifyFlutterwaveTransaction(reference);
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
 * Process Flutterwave refund.
 *
 * Flutterwave refund API (v4): POST https://api.flutterwave.com/refunds
 * Required: charge_id (the charge ID from the original transaction), amount, reason
 *
 * NOTE: The old v3 endpoint POST /v3/transactions/:id/refund is deprecated.
 * The current endpoint uses charge_id not transactionId in the URL path.
 *
 * Response shape:
 * {
 *   message: "Refund Initiated",
 *   data: {
 *     id: "rfd_eHwAkSdZ48",
 *     amount_refunded: 2000,
 *     reason: "duplicate",
 *     status: "completed" | "pending" | "failed",
 *     charge_id: "chg_Jwb2Y7ZbJQ",
 *     created_datetime: "..."
 *   }
 * }
 *
 * chargeId: the charge_id from the original transaction object (tx.id from verify response)
 */
export async function refundPayment({ chargeId, amount, reason, merchantNote }) {
  // Flutterwave v4 refund endpoint
  const url = 'https://api.flutterwave.com/refunds';

  try {
    const refundData = {
      charge_id: chargeId,
      amount: Number(amount),
      reason: reason || merchantNote || 'Customer refund request',
    };

    console.log(`[Flutterwave] Initiating refund | charge_id=${chargeId} | amount=${amount}`);

    const { data } = await axios.post(url, refundData, {
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    // Flutterwave returns { message: "Refund Initiated", data: {...} }
    // It does NOT have a top-level status field like v3 did
    if (!data.data) {
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
      chargeId: refund.charge_id,
      createdAt: refund.created_datetime,
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
 * Fetch Flutterwave refund status by refund ID.
 * GET https://api.flutterwave.com/refunds/:id
 */
export async function getRefundStatus(refundId) {
  const url = `https://api.flutterwave.com/refunds/${refundId}`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
      timeout: 8000,
    });

    if (!data.data) {
      throw new Error(data.message || 'Failed to get refund status');
    }

    const refund = data.data;

    return {
      success: true,
      refundId: refund.id,
      status: mapFlutterwaveRefundStatus(refund.status),
      gatewayStatus: refund.status,
      amount: parseFloat(refund.amount_refunded ?? refund.amount),
      chargeId: refund.charge_id,
      createdAt: refund.created_datetime,
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

/**
 * Handle Flutterwave webhooks — both payment and refund events.
 *
 * Payment events : charge.completed
 * Refund events  : refund.completed | refund.failed
 *
 * Refund webhook payload shape:
 * {
 *   event: "refund.completed",
 *   data: {
 *     id: "rfd_xxx",
 *     status: "succeeded",
 *     amount_refunded: 2000,
 *     charge_id: "chg_xxx",
 *     tx_ref: "ORD-xxx",       // original transaction tx_ref
 *     created_datetime: "..."
 *   }
 * }
 */
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

    // ── Payment event ─────────────────────────────────────────────────────────
    if (event === 'charge.completed') {
      return await handleFlutterwaveChargeCompleted(tx, res);
    }

    // ── Refund events ─────────────────────────────────────────────────────────
    if (event === 'refund.completed' || event === 'refund.failed') {
      return await handleFlutterwaveRefundEvent(event, tx, res);
    }

    return res.status(200).json({ message: 'Event ignored' });
  } catch (err) {
    console.error('Flutterwave webhook error:', err);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
}

// ── Internal: handle charge.completed ────────────────────────────────────────
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

// ── Internal: handle refund webhook events ────────────────────────────────────
async function handleFlutterwaveRefundEvent(event, tx, res) {
  // Flutterwave refund webhook includes tx_ref of the original transaction
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