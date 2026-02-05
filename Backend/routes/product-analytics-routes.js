import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getProductPerformanceOverview,
  getProductConversionMetrics,
  getInventoryTurnover,
  getLowStockAlerts,
  getProductProfitMargins,
  getProductsBoughtTogether,
  getCategoryPerformance
} from "../controller/product-analytics-controller.js";

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin"), adminAnalyticsLimiter);

// ============================================
// PRODUCT PERFORMANCE
// ============================================

/**
 * Get product performance overview
 * @route GET /api/v1/analytics/products/overview
 * @access Admin
 */
router.get("/overview", getProductPerformanceOverview);

/**
 * Get product conversion metrics
 * @route GET /api/v1/analytics/products/conversion
 * @access Admin
 */
router.get("/conversion", getProductConversionMetrics);

// ============================================
// INVENTORY ANALYTICS
// ============================================

/**
 * Get inventory turnover analytics
 * @route GET /api/v1/analytics/products/inventory-turnover
 * @access Admin
 */
router.get("/inventory-turnover", getInventoryTurnover);

/**
 * Get low stock alerts
 * @route GET /api/v1/analytics/products/low-stock-alerts
 * @access Admin
 */
router.get("/low-stock-alerts", getLowStockAlerts);

// ============================================
// PROFIT ANALYTICS
// ============================================

/**
 * Get product profit margins
 * @route GET /api/v1/analytics/products/profit-margins
 * @access Admin
 */
router.get("/profit-margins", getProductProfitMargins);

// ============================================
// PRODUCT RELATIONSHIPS
// ============================================

/**
 * Get products frequently bought together
 * @route GET /api/v1/analytics/products/bought-together
 * @access Admin
 */
router.get("/bought-together", getProductsBoughtTogether);

// ============================================
// CATEGORY PERFORMANCE
// ============================================

/**
 * Get category performance analytics
 * @route GET /api/v1/analytics/products/category-performance
 * @access Admin
 */
router.get("/category-performance", getCategoryPerformance);

export default router;