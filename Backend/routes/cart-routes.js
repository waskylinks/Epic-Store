import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import {
  calculateCart,
  validateCart,
  validateCartItems,
  checkProductAvailability,
  mergeGuestCart,
  applyDiscountCode,
  saveForLater
} from '../controller/cart-controller.js';

const router = express.Router();

// ============================================
// PUBLIC CART ROUTES (No auth required)
// ============================================

/**
 * Calculate cart pricing from backend
 * @route POST /api/v1/cart/calculate
 * @access Public
 */
router.post('/calculate', calculateCart);

/**
 * Validate entire cart before checkout
 * @route POST /api/v1/cart/validate
 * @access Public
 */
router.post('/validate', validateCart);

/**
 * Batch validate cart items
 * @route POST /api/v1/cart/validate-items
 * @access Public
 */
router.post('/validate-items', validateCartItems);

/**
 * Apply discount code
 * @route POST /api/v1/cart/apply-discount
 * @access Public
 */
router.post('/apply-discount', applyDiscountCode);

// ============================================
// PRODUCT ROUTES (Placed here to match frontend)
// ============================================

/**
 * Check product stock availability
 * @route GET /api/v1/products/:id/availability
 * @access Public
 */
router.get('/products/:id/availability', checkProductAvailability);

// ============================================
// AUTHENTICATED CART ROUTES
// ============================================

/**
 * Merge guest cart with user cart on login
 * @route POST /api/v1/cart/merge
 * @access Private
 */
router.post('/merge', verifyUserAuth, mergeGuestCart);

/**
 * Save item for later
 * @route POST /api/v1/cart/save-for-later
 * @access Private
 */
router.post('/save-for-later', verifyUserAuth, saveForLater);

export default router;