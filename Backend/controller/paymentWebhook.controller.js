import handleAsyncError from "../middleware/handleAsyncError.js";
import Order from "../models/order-model.js";
import { verifyAndCreateOrder } from "../Services/payment/paystack.service.js"; // Paystack service
import HandleError from "../utils/handleError.js";

/**
 * Unified Payment Webhook Handler
 * Currently handles Paystack only. Extendable for Stripe/Flutterwave.
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
 * Handle Paystack webhook events
 */
async function handlePaystackWebhook(req, res) {
    try {
        const event = req.body.event;
        const data = req.body.data;

        console.log("Paystack webhook event:", event);
        console.log("Paystack webhook data:", data?.reference);

        if (!data || !data.reference) {
            console.warn("Invalid webhook payload:", req.body);
            return res.status(400).send("Invalid webhook payload");
        }

        if (event === "charge.success") {
            const reference = data.reference;
            console.log("Processing successful charge for reference:", reference);

            // Idempotent order creation
            const existingOrder = await Order.findOne({ "paymentInfo.reference": reference });
            if (existingOrder) {
                console.log("Order already exists:", reference);
                return res.status(200).send("Order already processed");
            }

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
