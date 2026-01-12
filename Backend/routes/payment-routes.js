// routes/payment.routes.js
import express from "express";
import { validateBody } from "../middleware/validateBody.js";
import { verifyUserAuth } from "../middleware/user-auth.js";
import { verifyPaymentController } from "../controller/payment.controller.js";
import { verifyPaymentSchema } from "../Validation/payment.validation.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js";

const router = express.Router();

/**
 * @route POST /api/v1/payment/verify
 * @desc Verify payment from any supported gateway and create order
 * @access Private (authenticated users only)
 */
router.post(
  "/verify",
  verifyUserAuth,
  validateBody(verifyPaymentSchema),
  verifyPaymentController
);

/**
 * @route POST /api/v1/payment/webhook/paystack
 * @desc Handle Paystack webhook
 * @access Public (Paystack servers)
 */
router.post(
  "/webhook/paystack",
  express.raw({ type: "application/json" }), // only parse JSON payloads as raw buffer
  async (req, res) => {
    console.log(">>> Paystack webhook route reached");

    try {
      const service = PaymentFactory.getWebhookService("paystack");
      if (!service) {
        return res.status(400).json({ message: "Webhook service unavailable" });
      }

      // Ensure handleWebhook receives raw body for signature verification
      await service.handleWebhook(req, res);
    } catch (err) {
      console.error("Paystack webhook error:", err);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  }
);


export default router;
