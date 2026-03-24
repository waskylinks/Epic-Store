import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getReturnOverview,
  getReturnsByProduct,
  getReturnsByCategory,
  getReturnPleaAnalytics,
  getReturnCreditAnalytics,
  getReturnLifecycleTiming,
  getRefundOverview,
  getRefundsByPaymentMethod,
  getRefundTimeline,
} from '../controller/return-refund-analytics-controller.js';

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin"), adminAnalyticsLimiter);

// ============================================
// RETURN ANALYTICS
// ============================================

/**
 * Get return analytics overview
 * @route GET /api/v1/analytics/returns/overview
 * @access Admin
 */
router.get("/returns/overview", getReturnOverview);

/**
 * Get return rate by product
 * @route GET /api/v1/analytics/returns/by-product
 * @access Admin
 */
router.get("/returns/by-product", getReturnsByProduct);

/**
 * Get return rate by category
 * @route GET /api/v1/analytics/returns/by-category
 * @access Admin
 */
router.get("/returns/by-category", getReturnsByCategory);

router.get('/returns/plea',      getReturnPleaAnalytics);

router.get('/returns/credit',    getReturnCreditAnalytics);

router.get('/returns/lifecycle', getReturnLifecycleTiming);

// ============================================
// REFUND ANALYTICS
// ============================================

/**
 * Get refund analytics overview
 * @route GET /api/v1/analytics/refunds/overview
 * @access Admin
 */
router.get("/refunds/overview", getRefundOverview);

/**
 * Get refund rate by payment method
 * @route GET /api/v1/analytics/refunds/by-payment-method
 * @access Admin
 */
router.get("/refunds/by-payment-method", getRefundsByPaymentMethod);

/**
 * Get refund timeline
 * @route GET /api/v1/analytics/refunds/timeline
 * @access Admin
 */
router.get("/refunds/timeline", getRefundTimeline);

export default router;