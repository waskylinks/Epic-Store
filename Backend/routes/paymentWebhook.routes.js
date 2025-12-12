import express from "express";
import { paymentWebhookController } from "../controller/paymentWebhook.controller";


const router = express.Router();

// POST /api/v1/payment/webhook?provider=paystack
router.post("/", paymentWebhookController);

export default router;