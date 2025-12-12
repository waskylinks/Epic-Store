// routes/payment.routes.js
import express from "express";
import { validateBody } from "../middleware/validateBody.js";
import { verifyUserAuth } from "../middleware/user-auth.js";
import { verifyPaymentController } from "../controller/payment.controller.js";
import { verifyPaymentSchema } from "../Validation/payment.validation.js";

const router = express.Router();

/**
 * @route POST /api/v1/payment/verify
 * @desc Verify payment from any supported gateway and create order
 * @access Private (authenticated users only)
 */
router.post(
  "/verify",
  verifyUserAuth,                  // Step 1: Ensure user is authenticated
  validateBody(verifyPaymentSchema), // Step 2: Validate request payload
  verifyPaymentController           // Step 3: Verify payment & create order
);

export default router;
