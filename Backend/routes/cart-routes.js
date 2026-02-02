import express from 'express';
import {
  getCartDetails,
  validateCheckout,
  applyDiscountCode
} from '../controller/cart-controller.js';

const router = express.Router();

// ============================================
// CART ROUTES
// ============================================

/**
 * Get cart details with fresh product data
 * @route POST /api/v1/cart/details
 * @access Public
 */
router.post('/details', getCartDetails);

/**
 * Validate cart and calculate totals before checkout
 * @route POST /api/v1/cart/checkout/validate
 * @access Public
 */
router.post('/checkout/validate', validateCheckout);

/**
 * Apply discount code
 * @route POST /api/v1/cart/apply-discount
 * @access Public
 */
router.post('/apply-discount', applyDiscountCode);

export default router;