import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getDashboardOverview,
  getDashboardKPIs,
  getRevenueTrends,
  getTopPerformers,
  getDashboardAlerts
} from "../controller/analytics-dashboard-controller.js"; 

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin", "superAdmin"), adminAnalyticsLimiter);

// ============================================
// DASHBOARD ROUTES
// ============================================

/**
 * Get comprehensive dashboard overview
 * @route GET /api/v1/analytics/dashboard
 * @access Admin
 */
router.get("/", getDashboardOverview);

/**
 * Get key performance indicators
 * @route GET /api/v1/analytics/dashboard/kpis
 * @access Admin
 */
router.get("/kpis", getDashboardKPIs);

/**
 * Get revenue trends over time
 * @route GET /api/v1/analytics/dashboard/revenue-trends
 * @access Admin
 */
router.get("/revenue-trends", getRevenueTrends);

/**
 * Get top performers (products, customers, categories)
 * @route GET /api/v1/analytics/dashboard/top-performers
 * @access Admin
 */
router.get("/top-performers", getTopPerformers);

/**
 * Get dashboard alerts and notifications
 * @route GET /api/v1/analytics/dashboard/alerts
 * @access Admin
 */
router.get("/alerts", getDashboardAlerts);

export default router;