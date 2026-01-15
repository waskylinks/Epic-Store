import express from "express";
import { validateBody } from "../middleware/validateBody.js";
import { verifyUserAuth } from "../middleware/user-auth.js";
import { 
  initializePaymentController,
  verifyPaymentController 
} from "../controller/payment.controller.js";
import { 
  initializePaymentSchema,
  verifyPaymentSchema 
} from "../Validation/payment.validation.js";
import { 
  paymentInitLimiter, 
  paymentVerifyLimiter 
} from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * @route POST /api/v1/payment/initialize
 * @desc Initialize payment - validate cart, calculate prices, create pending order
 * @access Private (authenticated users only)
 * @rateLimit 10 requests per 5 minutes per user
 * 
 * Request body:
 * {
 *   gateway: "paystack" | "flutterwave" | "stripe",
 *   currency: "NGN" | "USD" | "GBP" | "EUR" | "GHS" | "KES" | "ZAR",
 *   shippingInfo: { address, city, state, country, pinCode, phoneNo },
 *   cartItems: [{ product: "productId", quantity: 2 }]
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     reference: "ORD-123-ABC",
 *     orderId: "mongoId",
 *     amount: 286,
 *     currency: "NGN",
 *     gateway: "paystack",
 *     breakdown: { itemPrice, taxPrice, shippingPrice, totalPrice }
 *   }
 * }
 */
router.post(
  "/initialize",
  verifyUserAuth,
  paymentInitLimiter,
  validateBody(initializePaymentSchema),
  initializePaymentController
);

/**
 * @route POST /api/v1/payment/verify
 * @desc Verify payment and update pending order status
 * @access Private (authenticated users only)
 * @rateLimit 20 requests per 5 minutes per user
 * 
 * Request body:
 * {
 *   gateway: "paystack" | "flutterwave" | "stripe",
 *   reference: "ORD-123-ABC"
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   message: "Payment verified successfully",
 *   order: { ... }
 * }
 */
router.post(
  "/verify",
  verifyUserAuth,
  paymentVerifyLimiter,
  validateBody(verifyPaymentSchema),
  verifyPaymentController
);

export default router;