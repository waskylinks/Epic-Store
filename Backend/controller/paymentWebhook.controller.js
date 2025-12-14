import handleAsyncError from "../middleware/handleAsyncError.js";
import Order from "../models/order-model.js";
import { verifyAndCreateOrder } from "../Services/payment/paystack.service.js";
import crypto from "crypto";
import HandleError from "../utils/handleError.js";

/**
 * Unified Payment Webhook Handler
 * Currently handles Paystack only. Extendable for other providers.
 */
export const paymentWebhookController = handleAsyncError(async (req, res, next) => {
  const provider = req.query.provider || "paystack";
  console.log("Webhook received for provider:", provider);

  switch (provider) {
    case "paystack":
      await handlePaystackWebhook(req, res);
      break;
    default:
      console.warn("Unsupported payment provider:", provider);
      return next(new HandleError("Unsupported payment provider", 400));
  }
});

/**
 * Handle Paystack webhook events with signature verification
 */
async function handlePaystackWebhook(req, res) {
  try {
    // 1️⃣ Verify Paystack signature
    const paystackSignature = req.headers["x-paystack-signature"];
    if (!paystackSignature) {
      console.warn("Missing Paystack signature");
      return res.status(400).send("Missing signature");
    }

    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_TEST_SECRET_KEY)
      .update(req.body) // raw body as buffer/string
      .digest("hex");

    if (hash !== paystackSignature) {
      console.warn("Invalid Paystack webhook signature");
      return res.status(400).send("Invalid signature");
    }

    // 2️⃣ Parse event and data
    const { event, data } = JSON.parse(req.body.toString());
    console.log("Paystack webhook event:", event);
    console.log("Paystack webhook data reference:", data?.reference);

    if (!data || !data.reference) {
      console.warn("Invalid webhook payload:", req.body.toString());
      return res.status(400).send("Invalid webhook payload");
    }

    // 3️⃣ Process successful charges only
    if (event === "charge.success") {
      const reference = data.reference;

      // Check for existing order (idempotency)
      const existingOrder = await Order.findOne({ "paymentInfo.reference": reference });
      if (existingOrder) {
        console.log("Order already exists:", reference);
        return res.status(200).send("Order already processed");
      }

      // Create order via service
      await verifyAndCreateOrder({
        reference: data.reference,
        shippingInfo: data.metadata?.shippingInfo || {},
        orderItems: data.metadata?.orderItems || [],
        itemPrice: data.metadata?.itemPrice || 0,
        taxPrice: data.metadata?.taxPrice || 0,
        shippingPrice: data.metadata?.shippingPrice || 0,
        totalPrice: data.amount / 100,
        amountPaid: data.amount / 100,
        userId: data.metadata?.userId || null
      });

      console.log("Order created successfully for reference:", reference);
      return res.status(200).send("Order created successfully");
    }

    console.log("Webhook event ignored:", event);
    return res.status(200).send("Event ignored");

  } catch (err) {
    console.error("Paystack webhook error:", err);
    return res.status(500).send("Webhook handling failed");
  }
}
