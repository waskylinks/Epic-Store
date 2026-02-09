import express from 'express';
import {
  getCartDetails,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  validateCheckout,
  applyDiscountCode
} from '../controller/cart-controller.js';

const router = express.Router();

// ============================================
// CART OPERATIONS (No Analytics)
// ============================================

/**
 * Get cart details with fresh product data
 * @route POST /api/v1/cart/details
 * @access Public
 */
router.post('/details', getCartDetails);

/**
 * Add item to cart
 * @route POST /api/v1/cart/add
 * @access Public
 */
router.post('/add', addToCart);

/**
 * Update cart item quantity
 * @route PUT /api/v1/cart/update
 * @access Public
 */
router.put('/update', updateCartItem);

/**
 * Remove item from cart
 * @route DELETE /api/v1/cart/remove/:productId
 * @access Public
 */
router.delete('/remove/:productId', removeFromCart);

/**
 * Clear entire cart
 * @route DELETE /api/v1/cart/clear
 * @access Public
 */
router.delete('/clear', clearCart);

// ============================================
// CHECKOUT FLOW
// ============================================

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