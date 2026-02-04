import express from 'express';
import {
  getCartDetails,
  validateCheckout,
  applyDiscountCode
} from '../controller/cart-controller.js';
import {
  trackCartEvent,
  syncCartWithRequestBody,
  trackFunnelStep
} from '../middleware/cart-tracking-middleware.js';

const router = express.Router();

// ============================================
// CART ROUTES (with analytics tracking)
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
// ADDITIONAL CART TRACKING ENDPOINTS
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