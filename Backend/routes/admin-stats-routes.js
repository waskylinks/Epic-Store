import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import { 
    getAdminStats, 
    getAnalytics,
    getTopProductsEndpoint,
    getInventoryStats
} from "../controller/admin-stats-controller.js";

const router = express.Router();

// All routes require admin authentication and rate limiting
router.use(verifyUserAuth, roleBaseAccess("admin"), adminAnalyticsLimiter);

/**
 * Get basic admin statistics
 * @route GET /api/v1/admin/stats
 * @access Admin
 */
router.get("/stats", getAdminStats);

/**
 * Get analytics with trends (legacy endpoint)
 * @route GET /api/v1/admin/analytics
 * @access Admin
 * @deprecated Use /api/v1/analytics/dashboard instead
 */
router.get("/analytics", getAnalytics);

/**
 * Get detailed inventory statistics
 * @route GET /api/v1/admin/inventory-stats
 * @access Admin
 */
router.get("/inventory-stats", getInventoryStats);

/**
 * Get top products with pagination
 * @route GET /api/v1/admin/top-products
 * @access Admin
 */
router.get("/top-products", getTopProductsEndpoint);

export default router;