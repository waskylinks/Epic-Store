import axios from 'axios';
import crypto from 'crypto';
import Order from '../../models/order-model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Initialize Flutterwave payment
 * @param {Object} params - Payment initialization parameters
 * @returns {Object} Flutterwave initialization response with payment link
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
        amount: amount, // Flutterwave expects amount in major currency unit
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
 * Verify Flutterwave transaction with retry logic
 * @param {string} transactionId - Flutterwave transaction ID
 * @param {number} maxAttempts - Number of retries for verification
 * @returns {Object} Flutterwave transaction data
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
  // 1. Verify transaction with Flutterwave using transaction ID
  // Note: For Flutterwave, we need to use the transaction ID, not tx_ref
  // We'll get the transaction ID from the callback or search by tx_ref
  
  let tx;
  try {
    // Try to verify by transaction ID (if available in reference)
    tx = await verifyFlutterwaveTransaction(reference);
  } catch (err) {
    // If that fails, we might need to search by tx_ref
    // Flutterwave doesn't have a direct verify by tx_ref endpoint
    // So we'll need the transaction ID from the frontend
    throw new Error("Transaction verification failed: " + err.message);
  }

  // 2. Get amount and currency from Flutterwave response
  const flutterwaveAmount = parseFloat(tx.amount);
  const currency = tx.currency;

  // 3. Validate currency matches expected
  if (currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
    throw new Error(
      `Currency mismatch: expected ${expectedCurrency}, got ${currency}`
    );
  }

  // 4. Validate amount matches pending order (critical security check)
  if (Math.abs(Number(expectedAmount) - flutterwaveAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, gateway charged ${flutterwaveAmount}`
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
  order.paymentInfo.providerTxId = tx.id;
  order.paymentInfo.paidAt = new Date(tx.created_at);
  order.amountPaid = flutterwaveAmount;

  // 9. Store payment metadata
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
 * Handle Flutterwave webhook with signature verification
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export async function handleWebhook(req, res) {
  try {
    // 1. Verify webhook signature
    const flutterwaveSignature = req.headers["verif-hash"];
    
    if (!flutterwaveSignature) {
      console.warn("Missing Flutterwave signature");
      return res.status(400).send("Missing signature");
    }

    // Flutterwave uses a simple hash comparison
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
    
    if (flutterwaveSignature !== secretHash) {
      console.warn("Invalid Flutterwave webhook signature");
      return res.status(400).send("Invalid signature");
    }

    // 2. Parse webhook event
    const payload = JSON.parse(req.body.toString());
    const { event, data: tx } = payload;

    console.log("Flutterwave webhook event:", event);

    // 3. Only process charge.completed events
    if (event !== "charge.completed") {
      return res.status(200).json({ message: "Event ignored" });
    }

    // 4. Additional verification: Verify transaction status
    if (tx.status !== "successful") {
      console.warn("Webhook: Transaction not successful:", tx.status);
      return res.status(200).json({ message: "Transaction not successful" });
    }

    // 5. Find order by reference (tx_ref in Flutterwave)
    const order = await Order.findOne({
      "paymentInfo.reference": tx.tx_ref
    });

    if (!order) {
      console.warn("Webhook: Order not found for reference:", tx.tx_ref);
      return res.status(200).json({
        message: "Order not found, ignoring webhook"
      });
    }

    // 6. Check if already processed (idempotency)
    if (order.paymentInfo.status === "success") {
      return res.status(200).json({ message: "Already processed" });
    }

    // 7. Update order payment status
    order.paymentInfo.status = "success";
    order.paymentInfo.providerTxId = tx.id;
    order.paymentInfo.paidAt = new Date(tx.created_at);
    order.amountPaid = parseFloat(tx.amount);

    // Update payment metadata
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

/**
 * Get transaction by tx_ref (helper function)
 * Flutterwave doesn't have a direct verify by tx_ref endpoint,
 * so this searches transactions by reference
 */
export async function getTransactionByReference(txRef) {
  try {
    // Note: This requires searching through transactions
    // In production, you'd store the transaction ID when initializing
    const url = `https://api.flutterwave.com/v3/transactions?tx_ref=${txRef}`;
    
    const { data } = await axios.get(url, {
      headers: { 
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` 
      }
    });

    if (data.status === "success" && data.data.length > 0) {
      return data.data[0]; // Return first matching transaction
    }

    throw new Error("Transaction not found");
  } catch (err) {
    throw new Error("Failed to get transaction: " + err.message);
  }
}