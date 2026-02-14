import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getFulfillmentAnalytics,
  getSLABreachAnalytics,
  getShippingCarrierPerformance,
  getShipmentTrackingAnalytics,
  getFraudAnalytics,
  getHighRiskOrders,
  getCancellationAnalytics
} from "../controller/operational-analytics-controller.js"; // FIX: Corrected import path

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin"), adminAnalyticsLimiter);

// ============================================
// FULFILLMENT ANALYTICS
// ============================================

/**
 * Get fulfillment performance overview
 * @route GET /api/v1/analytics/operations/fulfillment
 * @access Admin
 */
router.get("/fulfillment", getFulfillmentAnalytics);

/**
 * Get SLA breach analytics
 * @route GET /api/v1/analytics/operations/sla-breaches
 * @access Admin
 */
router.get("/sla-breaches", getSLABreachAnalytics);

// ============================================
// SHIPPING ANALYTICS
// ============================================

/**
 * Get shipping carrier performance
 * @route GET /api/v1/analytics/operations/shipping-carriers
 * @access Admin
 */
router.get("/shipping-carriers", getShippingCarrierPerformance);

/**
 * Get shipment tracking analytics
 * @route GET /api/v1/analytics/operations/shipment-tracking
 * @access Admin
 */
router.get("/shipment-tracking", getShipmentTrackingAnalytics);

// ============================================
// FRAUD ANALYTICS
// ============================================

/**
 * Get fraud detection analytics
 * @route GET /api/v1/analytics/operations/fraud
 * @access Admin
 */
router.get("/fraud", getFraudAnalytics);

/**
 * Get high-risk orders
 * @route GET /api/v1/analytics/operations/high-risk-orders
 * @access Admin
 */
router.get("/high-risk-orders", getHighRiskOrders);

// ============================================
// CANCELLATION ANALYTICS
// ============================================

/**
 * Get order cancellation analytics
 * @route GET /api/v1/analytics/operations/cancellations
 * @access Admin
 */
router.get("/cancellations", getCancellationAnalytics);

export default router;