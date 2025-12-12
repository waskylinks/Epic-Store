import handleAsyncError from "../middleware/handleAsyncError.js";
import Order from "../models/order-model.js";
import { verifyAndCreateOrder } from "../Services/payment/paystack.service.js"; // Paystack service
import HandleError from "../utils/handleError.js";

/**
 * Unified Payment Webhook Handler
 * Currently handles Paystack only. Extendable for Stripe/Flutterwave.
 */
export const paymentWebhookController = handleAsyncError(async (req, res, next) => {
    // ------------------------
    // Identify provider
    // ------------------------
    // Option 1: Use query param: /api/v1/payment/webhook?provider=paystack
    const provider = req.query.provider || "paystack";

    switch (provider) {
        case "paystack":
            await handlePaystackWebhook(req, res);
            break;

        // case "stripe":
        //     await handleStripeWebhook(req, res);
        //     break;

        // case "flutterwave":
        //     await handleFlutterwaveWebhook(req, res);
        //     break;

        default:
            return next(new HandleError("Unsupported payment provider", 400));
    }
});

/**
 * Handle Paystack webhook events
 */
async function handlePaystackWebhook(req, res) {
    try {
        // 1. Verify signature (optional but recommended)
        const paystackSignature = req.headers["x-paystack-signature"];
        const PAYSTACK_SECRET = process.env.PAYSTACK_TEST_SECRET_KEY;

        // You can use crypto to validate the signature
        // const crypto = require("crypto");
        // const hash = crypto.createHmac("sha512", PAYSTACK_SECRET)
        //                    .update(JSON.stringify(req.body))
        //                    .digest("hex");
        // if (hash !== paystackSignature) return res.status(401).send("Invalid signature");

        // 2. Parse webhook payload
        const event = req.body.event;
        const data = req.body.data;

        if (!data || !data.reference) {
            return res.status(400).send("Invalid webhook payload");
        }

        // Only act on successful charges
        if (event === "charge.success") {
            const reference = data.reference;

            // Idempotent order creation
            const existingOrder = await Order.findOne({ "paymentInfo.reference": reference });
            if (existingOrder) {
                return res.status(200).send("Order already processed");
            }

            // Map Paystack data to your existing verifyAndCreateOrder structure
            await verifyAndCreateOrder({
                reference: data.reference,
                shippingInfo: data.metadata?.shippingInfo || {}, // optional metadata from frontend
                orderItems: data.metadata?.orderItems || [],     // optional metadata
                itemPrice: data.metadata?.itemPrice || 0,
                taxPrice: data.metadata?.taxPrice || 0,
                shippingPrice: data.metadata?.shippingPrice || 0,
                totalPrice: data.amount / 100,
                amountPaid: data.amount / 100,
                userId: data.metadata?.userId || null // frontend can pass userId
            });

            return res.status(200).send("Order created successfully");
        }

        // Other Paystack events can be handled here (e.g., charge.failed)
        return res.status(200).send("Event ignored");

    } catch (err) {
        console.error("Paystack webhook error:", err);
        return res.status(500).send("Webhook handling failed");
    }
}
