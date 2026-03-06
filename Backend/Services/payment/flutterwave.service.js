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
    case 'completed':
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
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a Flutterwave transaction.
 *
 * Resolution priority (per official Flutterwave docs):
 *
 *  1. transactionId (numeric) provided by the frontend callback
 *     → GET /v3/transactions/:id/verify
 *       This is the primary recommended approach in the docs. The numeric id
 *       comes from data.id in the charge response and webhook payload.
 *
 *  2. reference is already a numeric string
 *     → GET /v3/transactions/:id/verify  (same fast path as above)
 *       Handles the case where the controller passes lookupRef = String(transactionId)
 *
 *  3. Only a tx_ref string is available (no transactionId at all)
 *     → GET /v3/transactions/verify_by_reference?tx_ref=...
 *       This is the OFFICIAL Flutterwave endpoint for verifying by merchant reference.
 *       Replaces the old manual polling loop that queried GET /v3/transactions?tx_ref=
 *       — an undocumented search endpoint that returns empty arrays while the
 *       transaction is still being indexed, causing the 5-attempt timeout failure.
 *
 * FIX: Added `transactionId = null` as the 3rd parameter. Previously this arg
 * was passed by verifyAndUpdateOrder() but silently dropped because the function
 * signature only declared 2 params, forcing every webhook/fallback call through
 * the broken polling loop.
 */
export async function verifyFlutterwaveTransaction(reference, maxAttempts = 3, transactionId = null) {
  let url;

  if (transactionId) {
    // Path 1: numeric id from frontend callback — fastest and most reliable per docs
    url = `https://api.flutterwave.com/v3/transactions/${String(transactionId)}/verify`;
    console.log(`✅ [flw] Verifying by transaction_id: ${transactionId}`);
  } else if (!isNaN(Number(reference))) {
    // Path 2: reference is already numeric (controller passed String(transactionId) as lookupRef)
    url = `https://api.flutterwave.com/v3/transactions/${reference}/verify`;
    console.log(`✅ [flw] Reference is numeric, verifying by id: ${reference}`);
  } else {
    // Path 3: only tx_ref available — use the official dedicated endpoint (single call, no loop)
    // Docs: GET https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref={tx_ref}
    url = `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`;
    console.log(`🔍 [flw] Verifying by tx_ref via verify_by_reference: ${reference}`);
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

      if (data.status === 'success' && data.data?.status === 'successful') {
        console.log(`✅ [flw] Transaction verified on attempt ${attempt}`);
        return data.data;
      }

      throw new Error(`Flutterwave status: ${data.data?.status || data.message || 'unknown'}`);
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
    // transactionId is now correctly received as the 3rd param and used directly
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
 */
export async function refundPayment({ chargeId, amount, reason, merchantNote }) {
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
 *     tx_ref: "ORD-xxx",
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

// ── Internal: handle charge.completed ────────────────────────────────────────

/**
 * Per Flutterwave docs best practice:
 * "Before giving value to a customer based on a webhook notification, always
 *  re-query our API to verify the transaction details."
 *
 * We now re-verify via the API using tx.id (numeric, from the webhook payload)
 * before trusting any data or updating the order. The original code trusted the
 * raw webhook payload directly — this fixes that.
 */
async function handleFlutterwaveChargeCompleted(tx, res) {
  if (tx.status !== 'successful') {
    console.warn('Webhook: Transaction not successful:', tx.status);
    return res.status(200).json({ message: 'Transaction not successful' });
  }

  // Re-verify via the API before trusting the webhook payload (docs requirement)
  let verified;
  try {
    verified = await verifyFlutterwaveTransaction(tx.tx_ref, 3, tx.id);
  } catch (err) {
    console.error('Webhook: Re-verification failed:', err.message);
    // Return 200 so Flutterwave doesn't keep retrying — log for manual review
    return res.status(200).json({ message: 'Re-verification failed, ignoring webhook' });
  }

  const order = await Order.findOne({ 'paymentInfo.reference': verified.tx_ref });

  if (!order) {
    console.warn('Webhook: Order not found for reference:', verified.tx_ref);
    return res.status(200).json({ message: 'Order not found, ignoring webhook' });
  }

  // Idempotency — already processed
  if (order.paymentInfo.status === 'success') {
    return res.status(200).json({ message: 'Already processed' });
  }

  order.paymentInfo.status = 'success';
  order.paymentInfo.providerTxId = verified.id;
  order.paymentInfo.paidAt = new Date(verified.created_at);
  order.amountPaid = parseFloat(verified.amount);

  order.paymentMeta = {
    channel: verified.payment_type,
    ipAddress: verified.ip,
    customer: verified.customer,
    cardDetails: verified.card
      ? {
          last4: verified.card.last_4digits,
          brand: verified.card.type,
          expMonth: verified.card.expiry?.split('/')[0],
          expYear: verified.card.expiry?.split('/')[1],
        }
      : undefined,
    customMetadata: verified.meta,
    raw: verified,
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