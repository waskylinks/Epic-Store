import axios from 'axios';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Verify Paystack transaction with retry logic.
 */
export async function verifyPaystackTransaction(reference, maxAttempts = 3) {
  const PAYSTACK_SECRET = process.env.PAYSTACK_TEST_SECRET_KEY;
  if (!PAYSTACK_SECRET) throw new Error("PAYSTACK_TEST_SECRET_KEY missing");

  const url = `https://api.paystack.co/transaction/verify/${reference}`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
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
 * Idempotent create order flow aligned with order-model.js schema.
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

  if (currency !== "NGN") {
    throw new Error("Invalid payment currency");
  }

  if (Math.abs(Number(totalPrice) - paystackAmount) > 0.01) {
    throw new Error("Amount mismatch between server and Paystack");
  }

  const existingOrder = await Order.findOne({ "paymentInfo.reference": reference });
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
      currency: tx.currency,
      ipAddress: tx.ip_address,
      customer: tx.customer,
      authorization: tx.authorization,
      raw: tx
    }
  });

  return { created: true, order: newOrder };
}
