import axios from 'axios';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Initialize Flutterwave payment
 */
export async function initializeFlutterwavePayment({
  email,
  amount,
  currency = "NGN",
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
        amount: amount,
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
      reference: reference
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
 * Get transaction by tx_ref
 * ✅ FIXED: Use this to find transaction_id from tx_ref
 */
export async function getTransactionByReference(txRef) {
  try {
    const url = `https://api.flutterwave.com/v3/transactions?tx_ref=${txRef}`;
    
    const { data } = await axios.get(url, {
      headers: { 
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` 
      },
      timeout: 8000
    });

    if (data.status === "success" && data.data && data.data.length > 0) {
      return data.data[0]; // Return first matching transaction
    }

    throw new Error("Transaction not found for tx_ref: " + txRef);
  } catch (err) {
    console.error("Get transaction by reference error:", err.response?.data || err.message);
    throw new Error("Failed to get transaction: " + err.message);
  }
}

/**
 * Verify Flutterwave transaction by transaction ID
 */
export async function verifyFlutterwaveTransaction(transactionId, maxAttempts = 3) {
  const url = `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const { data } = await axios.get(url, {
        headers: { 
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` 
        },
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
 * ✅ FIXED: For Flutterwave flow - verify transaction, get tx_ref, find order, update
 */
export async function verifyAndUpdateOrder({
  reference,
  orderId, // May be undefined for Flutterwave
  expectedAmount, // May be undefined for Flutterwave
  expectedCurrency,
  userId
}) {
  let tx;
  let order;
  
  try {
    // Step 1: Verify transaction with Flutterwave using transaction_id
    console.log(`🔍 Verifying Flutterwave transaction ID: ${reference}`);
    tx = await verifyFlutterwaveTransaction(reference);
    console.log(`✅ Transaction verified. tx_ref: ${tx.tx_ref}, amount: ${tx.amount}`);
  } catch (err) {
    console.error("Flutterwave verification failed:", err);
    throw new Error("Transaction verification failed: " + err.message);
  }

  // Step 2: Find the order using tx_ref from Flutterwave response
  try {
    order = await Order.findOne({
      "paymentInfo.reference": tx.tx_ref,
      user: userId
    });

    if (!order) {
      throw new Error(`Order not found for tx_ref: ${tx.tx_ref}`);
    }

    console.log(`✅ Order found: ${order._id} for tx_ref: ${tx.tx_ref}`);
  } catch (err) {
    throw new Error(`Order lookup failed: ${err.message}`);
  }

  // Step 3: Validate amount and currency using order data
  const flutterwaveAmount = parseFloat(tx.amount);
  const currency = tx.currency;
  const orderAmount = order.totalPrice;
  const orderCurrency = order.paymentInfo.currency;

  if (currency.toUpperCase() !== orderCurrency.toUpperCase()) {
    throw new Error(
      `Currency mismatch: expected ${orderCurrency}, got ${currency}`
    );
  }

  if (Math.abs(orderAmount - flutterwaveAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${orderAmount}, gateway charged ${flutterwaveAmount}`
    );
  }

  // Step 4: Check idempotency
  if (order.paymentInfo.status === "success") {
    return { 
      success: true, 
      order, 
      alreadyProcessed: true 
    };
  }

  // Step 5: Update order
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

  return { 
    success: true, 
    order,
    alreadyProcessed: false 
  };
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

    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
    
    if (flutterwaveSignature !== secretHash) {
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

    const order = await Order.findOne({
      "paymentInfo.reference": tx.tx_ref
    });

    if (!order) {
      console.warn("Webhook: Order not found for reference:", tx.tx_ref);
      return res.status(200).json({
        message: "Order not found, ignoring webhook"
      });
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

    console.log("Webhook: Order confirmed for reference:", tx.tx_ref);
    return res.status(200).json({ message: "Order confirmed" });

  } catch (err) {
    console.error("Flutterwave webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}