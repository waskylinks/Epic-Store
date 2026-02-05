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
import {
  trackCartEvent,
  syncCartWithRequestBody,
  trackFunnelStep
} from '../middleware/cart-tracking-middleware.js';
import { trackAddToCart } from '../middleware/product-tracking-middleware.js';

const router = express.Router();

// ============================================
// CART CRUD OPERATIONS (with analytics tracking)
// ============================================

/**
 * Get cart details with fresh product data
 * Tracks: cart view event + syncs cart state
 * @route POST /api/v1/cart/details
 * @access Public
 */
router.post(
  '/details',
  syncCartWithRequestBody,
  trackCartEvent('view'),
  getCartDetails
);

/**
 * Add item to cart
 * Tracks: add to cart event + product analytics
 * @route POST /api/v1/cart/add
 * @access Public
 */
router.post(
  '/add',
  trackAddToCart,
  trackCartEvent('add'),
  addToCart
);

/**
 * Update cart item quantity
 * Tracks: update cart event
 * @route PUT /api/v1/cart/update
 * @access Public
 */
router.put(
  '/update',
  trackCartEvent('update'),
  updateCartItem
);

/**
 * Remove item from cart
 * Tracks: remove from cart event
 * @route DELETE /api/v1/cart/remove/:productId
 * @access Public
 */
router.delete(
  '/remove/:productId',
  trackCartEvent('remove'),
  removeFromCart
);

/**
 * Clear entire cart
 * Tracks: clear cart event
 * @route DELETE /api/v1/cart/clear
 * @access Public
 */
router.delete(
  '/clear',
  trackCartEvent('remove'),
  clearCart
);

// ============================================
// CHECKOUT FLOW (with funnel tracking)
// ============================================

/**
 * Validate cart and calculate totals before checkout
 * Tracks: checkout start funnel step
 * @route POST /api/v1/cart/checkout/validate
 * @access Public
 */
router.post(
  '/checkout/validate',
  syncCartWithRequestBody,
  trackFunnelStep('checkout_start'),
  validateCheckout
);

/**
 * Apply discount code
 * Tracks: discount application activity
 * @route POST /api/v1/cart/apply-discount
 * @access Public
 */
router.post(
  '/apply-discount',
  syncCartWithRequestBody,
  applyDiscountCode
);

// ============================================
// FUNNEL TRACKING ENDPOINTS
// ============================================

/**
 * Track shipping info step
 * @route POST /api/v1/cart/shipping-info
 * @access Public
 */
router.post(
  '/shipping-info',
  trackFunnelStep('shipping_info'),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Shipping info step tracked'
    });
  }
);

/**
 * Track payment info step
 * @route POST /api/v1/cart/payment-info
 * @access Public
 */
router.post(
  '/payment-info',
  trackFunnelStep('payment_info'),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Payment info step tracked'
    });
  }
);

/**
 * Track review order step
 * @route POST /api/v1/cart/review-order
 * @access Public
 */
router.post(
  '/review-order',
  trackFunnelStep('review_order'),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Review order step tracked'
    });
  }
);

/**
 * Track order completion (call this after successful order creation)
 * @route POST /api/v1/cart/order-complete
 * @access Public
 */
router.post(
  '/order-complete',
  trackCartEvent('checkout_complete'),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Order completion tracked'
    });
  }
);

export default router;