import axios from 'axios';
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
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}` },
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
 * Idempotent order creation
 * @param {Object} orderData - Order details
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
  const tx = await verifyPaystackTransaction(reference);

  const paystackAmount = tx.amount / 100; // convert kobo → NGN
  const currency = tx.currency;

  if (currency !== "NGN") throw new Error("Invalid payment currency");
  if (Math.abs(Number(totalPrice) - paystackAmount) > 0.01) throw new Error("Amount mismatch");

  // Idempotency check
  const existingOrder = await Order.findOne({ "paymentInfo.reference": reference });
  if (existingOrder) return { created: false, order: existingOrder, reason: "duplicate" };

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
      currency: tx.currency,
      ipAddress: tx.ip_address,
      customer: tx.customer,
      authorization: tx.authorization,
      raw: tx
    }
  });

  return { created: true, order: newOrder };
}

/**
 * Handle Paystack webhook
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export async function handleWebhook(req, res) {
  try {
    const event = req.body;

    // TODO: Verify signature if using Paystack webhook secret
    // const paystackSignature = req.headers['x-paystack-signature'];

    if (event.event === 'charge.success') {
      const reference = event.data.reference;

      // Idempotency check
      const existingOrder = await Order.findOne({ 'paymentInfo.reference': reference });
      if (existingOrder) return res.status(200).json({ message: 'Order already processed' });

      const tx = event.data;
      const paystackAmount = tx.amount / 100;

      const newOrder = await Order.create({
        user: tx.customer.id, // adjust if needed
        shippingInfo: tx.metadata?.shippingInfo || {},
        orderItems: tx.metadata?.orderItems || [],
        itemPrice: tx.metadata?.itemPrice || 0,
        taxPrice: tx.metadata?.taxPrice || 0,
        shippingPrice: tx.metadata?.shippingPrice || 0,
        totalPrice: tx.metadata?.totalPrice || paystackAmount,
        amountPaid: paystackAmount,
        paymentInfo: {
          reference: tx.reference,
          providerTxId: tx.id,
          status: tx.status,
          method: "paystack",
          currency: tx.currency,
          amount: paystackAmount,
          paidAt: new Date(tx.paidAt)
        },
        paymentMeta: tx
      });

      return res.status(201).json({ message: 'Order created via webhook', order: newOrder });
    }

    return res.status(200).json({ message: 'Event ignored' });
  } catch (err) {
    console.error('Paystack webhook error:', err);
    return res.status(500).json({ message: 'Webhook processing failed', error: err.message });
  }
}
