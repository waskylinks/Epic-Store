import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import {
  getDiscountAnalyticsOverview,
  getROIByCategory,
  getROIByType,
  getTopPerformers,
  getRedemptionTrends,
  getDiscountAnalyticsDetail,
  getDiscountSegmentBreakdown,
  getDiscountRedemptionTrend,
  getAllDiscountAnalytics,
  syncSingleDiscountAnalytics,
  syncAllDiscounts,
  getStaleSyncReport,
} from "../controller/discount-analytics-controller.js";

const router = express.Router();

// ============================================
// ROUTE ORDER MATTERS
//
// All named routes (/overview, /roi-by-category, /sync-all, /stale, etc.)
// MUST be registered before the /:discountId param routes, otherwise
// Express matches those literal strings as discountId values.
//
// Order:
//   1. Named aggregate routes  (no params)
//   2. Named sync / utility routes
//   3. Param routes /:discountId — always last
//
// All routes are admin-only. No public or user-scoped endpoints —
// discount analytics is an internal performance tool.
// ============================================

// Apply auth + admin guard to every route in this router
router.use(verifyUserAuth, roleBaseAccess("admin", "superAdmin"));

// ============================================
// 1. AGGREGATE / OVERVIEW ROUTES
// ============================================

// Store-wide KPI panel — overall, byCategory, byType, top/underperformers
router.get("/overview", getDiscountAnalyticsOverview);

// ROI aggregated per discount category (promo / return / loyalty / etc.)
router.get("/roi-by-category", getROIByCategory);

// ROI aggregated per discount type (percentage vs fixed)
router.get("/roi-by-type", getROIByType);

// Top-performing codes leaderboard — sortable by roi / revenue / redemptions
// Query: ?limit=10&category=promo&sortBy=roi
router.get("/top-performers", getTopPerformers);

// Store-wide daily redemption trend — aggregated across all codes
// Query: ?timeframe=month&category=promo&type=percentage
router.get("/trends", getRedemptionTrends);

// Paginated list of all DiscountAnalytics documents
// Query: ?limit=20&cursor=...&category=...&type=...&sortBy=revenue&minRedemptions=1
router.get("/", getAllDiscountAnalytics);

// ============================================
// 2. SYNC / UTILITY ROUTES
// All must appear before /:discountId
// ============================================

// Stale sync report — list of docs that need re-syncing
// Query: ?thresholdHours=24
router.get("/stale", getStaleSyncReport);

// Bulk sync — fire-and-forget, returns 202 immediately
router.post("/sync-all", syncAllDiscounts);

// ============================================
// 3. PARAM ROUTES — always last
// ============================================

// Full analytics detail for one discount code
router.get("/:discountId", getDiscountAnalyticsDetail);

// RFM segment + value tier breakdown for one code
router.get("/:discountId/segments", getDiscountSegmentBreakdown);

// Daily redemption trend for one code
// Query: ?timeframe=month
router.get("/:discountId/trend", getDiscountRedemptionTrend);

// Manual re-sync for one code — invalidates overview cache on completion
router.post("/:discountId/sync", syncSingleDiscountAnalytics);

export default router;