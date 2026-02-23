import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import {
  createCheckout,
  updateCheckoutStep,
  getActiveCheckout,
  abandonCheckout,
  redeemRecoveryToken,
} from '../controller/checkout-controller.js';

const router = express.Router();

/**
 * Redeem a cart recovery token
 * @route GET /api/v1/checkout/recover
 * @access Public — no auth required, token in query string
 *
 * IMPORTANT: This route MUST be declared before /:id routes
 * to prevent Express matching 'recover' as an :id param.
 *
 * The frontend recovery link looks like:
 *   https://yourstore.com/checkout/recover?token=<jwt>
 * The frontend hits this endpoint, gets the restored cart
 * data back, and redirects the user into the checkout flow.
 */
router.get('/recover', redeemRecoveryToken);

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

/**
 * Get active checkout
 * @route GET /api/v1/checkout/active
 * @access Private
 */
router.get('/active', verifyUserAuth, getActiveCheckout);

/**
 * Manually abandon checkout
 * @route PUT /api/v1/checkout/:id/abandon
 * @access Private
 */
router.put('/:id/abandon', verifyUserAuth, abandonCheckout);

export default router;