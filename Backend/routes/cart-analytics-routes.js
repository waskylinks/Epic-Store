import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getCartAbandonmentStats,
  getAbandonedCartsList,
  getRecoveryOpportunities,
  getConversionFunnel,
  getCartValueAnalytics,
  getCartAttributionAnalytics,
  getCartTimeline,
  markRecoveryEmailSent
} from "../controller/cart-analytics-controller.js";

const router = express.Router();

// ============================================
// CART ANALYTICS ROUTES (Admin Only)
// ============================================

/**
 * Get cart abandonment statistics
 * @route GET /api/v1/analytics/cart/abandonment
 * @access Admin
 */
router.get(
  "/abandonment",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getCartAbandonmentStats
);

/**
 * Get list of abandoned carts with recovery priority
 * @route GET /api/v1/analytics/cart/abandoned-list
 * @access Admin
 */
router.get(
  "/abandoned-list",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getAbandonedCartsList
);

/**
 * Get top cart recovery opportunities
 * @route GET /api/v1/analytics/cart/recovery-opportunities
 * @access Admin
 */
router.get(
  "/recovery-opportunities",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getRecoveryOpportunities
);

/**
 * Get conversion funnel analytics
 * @route GET /api/v1/analytics/cart/funnel
 * @access Admin
 */
router.get(
  "/funnel",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getConversionFunnel
);

/**
 * Get cart value analytics
 * @route GET /api/v1/analytics/cart/value
 * @access Admin
 */
router.get(
  "/value",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getCartValueAnalytics
);

/**
 * Get cart attribution analytics (device, source, browser)
 * @route GET /api/v1/analytics/cart/attribution
 * @access Admin
 */
router.get(
  "/attribution",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getCartAttributionAnalytics
);

/**
 * Get cart timeline analytics
 * @route GET /api/v1/analytics/cart/timeline
 * @access Admin
 */
router.get(
  "/timeline",
  verifyUserAuth,
  roleBaseAccess("admin"),
  adminAnalyticsLimiter,
  getCartTimeline
);

/**
 * Mark cart as having recovery email sent
 * @route POST /api/v1/analytics/cart/:cartId/mark-recovery-sent
 * @access Admin
 */
router.post(
  "/:cartId/mark-recovery-sent",
  verifyUserAuth,
  roleBaseAccess("admin"),
  markRecoveryEmailSent
);

export default router;