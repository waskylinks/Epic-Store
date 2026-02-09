import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import {
  createCheckout,
  updateCheckoutStep
} from '../controller/checkout-controller.js';

const router = express.Router();

/**
 * Create/update checkout session
 * @route POST /api/v1/checkout/create
 * @access Private
 */
router.post('/create', verifyUserAuth, createCheckout);

/**
 * Update checkout step
 * @route PUT /api/v1/checkout/:id/step
 * @access Private
 */
router.put('/:id/step', verifyUserAuth, updateCheckoutStep);

export default router;