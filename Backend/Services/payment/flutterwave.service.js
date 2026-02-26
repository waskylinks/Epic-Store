import axios from 'axios';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Initialize Flutterwave payment
 */
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
  customer_phone
}) {
  const url = "https://api.flutterwave.com/v3/payments";

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
          phonenumber: customer_phone || ""
        },
        customizations: {
          title: "EpicStore Payment",
          description: `Order ${orderReference}`,
          logo: `${process.env.FRONTEND_URL}/logo.png`
        },
        meta: {
          user_id: userId,
          order_reference: orderReference,
          item_count: itemCount,
          payment_source: "epicstore",
          initialized_at: new Date().toISOString()
        },
        payment_options: "card,banktransfer,ussd,mobilemoney"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    if (data.status !== "success") {
      throw new Error(data.message || "Flutterwave initialization failed");
    }

    return {
      success: true,
      payment_link: data.data.link,
      reference
    };

  } catch (err) {
    console.error("Flutterwave initialization error:", err.response?.data || err.message);
    throw new Error(
      err.response?.data?.message ||
      err.message ||
      "Failed to initialize Flutterwave payment"
    );
  }
}

/**
 * Get transaction by tx_ref.
 * Used to resolve an ORD-xxx string reference → numeric transaction_id
 * because Flutterwave's verify endpoint requires a numeric ID in the URL path.
 */
export async function getTransactionByReference(txRef) {
  try {
    const url = `https://api.flutterwave.com/v3/transactions?tx_ref=${txRef}`;

    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
      timeout: 8000
    });

    if (data.status === "success" && data.data && data.data.length > 0) {
      return data.data[0];
    }

    throw new Error("Transaction not found for tx_ref: " + txRef);
  } catch (err) {
    console.error("Get transaction by reference error:", err.response?.data || err.message);
    throw new Error("Failed to get transaction: " + err.message);
  }
}

/**
 * Verify Flutterwave transaction.
 *
 * FIX: Flutterwave's verify endpoint requires a numeric transaction_id:
 *   /v3/transactions/:id/verify
 * The controller passes reference which is an ORD-xxx string (tx_ref).
 * If non-numeric, resolve tx_ref → transaction_id via getTransactionByReference()
 * before hitting the verify endpoint.
 */
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
        timeout: 8000
      });

      if (data.status === "success" && data.data.status === "successful") {
        return data.data;
      }

      throw new Error(`Flutterwave status: ${data.data?.status || "unknown"}`);
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

/**
 * Verify payment and update pending order
 */
export async function verifyAndUpdateOrder({
  reference,
  orderId,
  expectedAmount,
  expectedCurrency,
  userId
}) {
  let tx;
  let order;

  try {
    console.log(`🔍 Verifying Flutterwave transaction: ${reference}`);
    tx = await verifyFlutterwaveTransaction(reference);
    console.log(`✅ Transaction verified. tx_ref: ${tx.tx_ref}, amount: ${tx.amount}`);
  } catch (err) {
    console.error("Flutterwave verification failed:", err);
    throw new Error("Transaction verification failed: " + err.message);
  }

  try {
    order = await Order.findOne({ "paymentInfo.reference": tx.tx_ref, user: userId });
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

  if (order.paymentInfo.status === "success") {
    return { success: true, order, alreadyProcessed: true };
  }

  order.paymentInfo.status = "success";
  order.paymentInfo.providerTxId = tx.id;
  order.paymentInfo.paidAt = new Date(tx.created_at);
  order.amountPaid = flutterwaveAmount;

  order.paymentMeta = {
    channel: tx.payment_type,
    ipAddress: tx.ip,
    customer: tx.customer,
    cardDetails: tx.card ? {
      last4: tx.card.last_4digits,
      brand: tx.card.type,
      expMonth: tx.card.expiry?.split('/')[0],
      expYear: tx.card.expiry?.split('/')[1]
    } : undefined,
    customMetadata: tx.meta,
    raw: tx
  };

  await order.save();
  return { success: true, order, alreadyProcessed: false };
}

/**
 * Handle Flutterwave webhook
 */
export async function handleWebhook(req, res) {
  try {
    const flutterwaveSignature = req.headers["verif-hash"];

    if (!flutterwaveSignature) {
      console.warn("Missing Flutterwave signature");
      return res.status(400).send("Missing signature");
    }

    if (flutterwaveSignature !== process.env.FLUTTERWAVE_SECRET_HASH) {
      console.warn("Invalid Flutterwave webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data: tx } = payload;

    console.log("Flutterwave webhook event:", event);

    if (event !== "charge.completed") {
      return res.status(200).json({ message: "Event ignored" });
    }

    if (tx.status !== "successful") {
      console.warn("Webhook: Transaction not successful:", tx.status);
      return res.status(200).json({ message: "Transaction not successful" });
    }

    const order = await Order.findOne({ "paymentInfo.reference": tx.tx_ref });

    if (!order) {
      console.warn("Webhook: Order not found for reference:", tx.tx_ref);
      return res.status(200).json({ message: "Order not found, ignoring webhook" });
    }

    if (order.paymentInfo.status === "success") {
      return res.status(200).json({ message: "Already processed" });
    }

    order.paymentInfo.status = "success";
    order.paymentInfo.providerTxId = tx.id;
    order.paymentInfo.paidAt = new Date(tx.created_at);
    order.amountPaid = parseFloat(tx.amount);

    order.paymentMeta = {
      channel: tx.payment_type,
      ipAddress: tx.ip,
      customer: tx.customer,
      cardDetails: tx.card ? {
        last4: tx.card.last_4digits,
        brand: tx.card.type,
        expMonth: tx.card.expiry?.split('/')[0],
        expYear: tx.card.expiry?.split('/')[1]
      } : undefined,
      customMetadata: tx.meta,
      raw: tx
    };

    await order.save();
    console.log("✅ Order updated via webhook");

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
        paymentGateway: 'flutterwave'
      });
      console.log("✅ Receipt created via webhook");
    } catch (receiptErr) {
      console.error("⚠️ Receipt creation failed:", receiptErr);
    }

    console.log("Webhook: Order confirmed for reference:", tx.tx_ref);
    return res.status(200).json({ message: "Order confirmed" });

  } catch (err) {
    console.error("Flutterwave webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}

/**
 * Process Flutterwave refund
 */
export async function refundPayment({ transactionId, amount, reason, merchantNote }) {
  const url = `https://api.flutterwave.com/v3/transactions/${transactionId}/refund`;

  try {
    const refundData = {
      ...(amount && { amount }),
      ...(reason && { comments: reason })
    };

    const { data } = await axios.post(url, refundData, {
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    });

    if (data.status !== "success") throw new Error(data.message || "Flutterwave refund failed");

    return {
      success: true,
      refundId: data.data.id,
      status: data.data.status,
      amount: parseFloat(data.data.amount_refunded || data.data.amount),
      currency: data.data.settlement_currency,
      transactionId: data.data.tx_id,
      accountId: data.data.account_id,
      createdAt: data.data.created_at,
      raw: data.data
    };

  } catch (err) {
    console.error("Flutterwave refund error:", err.response?.data || err.message);
    throw new Error(err.response?.data?.message || err.message || "Failed to process Flutterwave refund");
  }
}

/**
 * Check Flutterwave refund status
 */
export async function getRefundStatus(transactionId) {
  const url = `https://api.flutterwave.com/v3/transactions/${transactionId}/refund`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
      timeout: 8000
    });

    if (data.status !== "success") throw new Error(data.message || "Failed to get refund status");

    return {
      success: true,
      refundId: data.data[0]?.id,
      status: data.data[0]?.status,
      amount: parseFloat(data.data[0]?.amount_refunded),
      currency: data.data[0]?.settlement_currency,
      createdAt: data.data[0]?.created_at,
      raw: data.data
    };

  } catch (err) {
    console.error("Get refund status error:", err.response?.data || err.message);
    throw new Error(err.response?.data?.message || err.message || "Failed to get refund status");
  }
}