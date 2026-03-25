import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getCustomerOverview,
  getCustomersBySegment,
  getSegmentDistribution,
  getHighValueCustomers,
  getCLVDistribution,
  getVIPCustomers,
  getAtRiskCustomers,
  getCustomersNeedingAttention,
  getCustomerCohorts,
  getRepeatPurchaseAnalytics,
  getPurchaseFrequencyAnalytics,
  getAcquisitionSourceAnalytics,
  getCustomerDetails,
  syncSingleCustomer,
  syncAllCustomers,
  addCustomerNote,
  toggleVIPStatus,
  flagCustomerForReview
} from "../controller/customer-analytics-controller.js";

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin", "superAdmin"), adminAnalyticsLimiter);

// ============================================
// OVERVIEW & SUMMARY
// ============================================

/**
 * Get customer analytics overview
 * @route GET /api/v1/analytics/customers/overview
 * @access Admin
 */
router.get("/overview", getCustomerOverview);

// ============================================
// SEGMENT ANALYTICS
// ============================================

/**
 * Get all segment distribution
 * @route GET /api/v1/analytics/customers/segments
 * @access Admin
 */
router.get("/segments", getSegmentDistribution);

/**
 * Get customers by specific segment
 * @route GET /api/v1/analytics/customers/segments/:segment
 * @access Admin
 */
router.get("/segments/:segment", getCustomersBySegment);

// ============================================
// CLV ANALYTICS
// ============================================

/**
 * Get high-value customers
 * @route GET /api/v1/analytics/customers/high-value
 * @access Admin
 */
router.get("/high-value", getHighValueCustomers);

/**
 * Get CLV distribution
 * @route GET /api/v1/analytics/customers/clv-distribution
 * @access Admin
 */
router.get("/clv-distribution", getCLVDistribution);

// ============================================
// VIP CUSTOMERS
// ============================================

/**
 * Get VIP customers
 * @route GET /api/v1/analytics/customers/vip
 * @access Admin
 */
router.get("/vip", getVIPCustomers);

// ============================================
// CHURN RISK
// ============================================

/**
 * Get at-risk customers
 * @route GET /api/v1/analytics/customers/at-risk
 * @access Admin
 */
router.get("/at-risk", getAtRiskCustomers);

/**
 * Get customers needing attention
 * @route GET /api/v1/analytics/customers/needs-attention
 * @access Admin
 */
router.get("/needs-attention", getCustomersNeedingAttention);

// ============================================
// COHORT & BEHAVIOR ANALYTICS
// ============================================

/**
 * Get customer cohorts
 * @route GET /api/v1/analytics/customers/cohorts
 * @access Admin
 */
router.get("/cohorts", getCustomerCohorts);

/**
 * Get repeat purchase analytics
 * @route GET /api/v1/analytics/customers/repeat-purchase
 * @access Admin
 */
router.get("/repeat-purchase", getRepeatPurchaseAnalytics);

/**
 * Get purchase frequency analytics
 * @route GET /api/v1/analytics/customers/purchase-frequency
 * @access Admin
 */
router.get("/purchase-frequency", getPurchaseFrequencyAnalytics);

// ============================================
// ACQUISITION ANALYTICS
// ============================================

/**
 * Get acquisition source analytics
 * @route GET /api/v1/analytics/customers/acquisition-sources
 * @access Admin
 */
router.get("/acquisition-sources", getAcquisitionSourceAnalytics);

// ============================================
// BULK OPERATIONS
// FIX: Moved BEFORE :userId routes to prevent route conflict
// Static routes must come before dynamic parameter routes
// ============================================

/**
 * Sync all customer analytics
 * @route POST /api/v1/analytics/customers/sync-all
 * @access Admin
 */
router.post("/sync-all", syncAllCustomers);

// ============================================
// INDIVIDUAL CUSTOMER
// Dynamic routes (:userId) come AFTER all static routes
// ============================================

/**
 * Get detailed analytics for a customer
 * @route GET /api/v1/analytics/customers/:userId
 * @access Admin
 */
router.get("/:userId", getCustomerDetails);

/**
 * Sync analytics for a specific customer
 * @route POST /api/v1/analytics/customers/:userId/sync
 * @access Admin
 */
router.post("/:userId/sync", syncSingleCustomer);

/**
 * Add note to customer
 * @route POST /api/v1/analytics/customers/:userId/notes
 * @access Admin
 */
router.post("/:userId/notes", addCustomerNote);

/**
 * Toggle VIP status
 * @route PUT /api/v1/analytics/customers/:userId/vip
 * @access Admin
 */
router.put("/:userId/vip", toggleVIPStatus);

/**
 * Flag customer for review
 * @route PUT /api/v1/analytics/customers/:userId/flag
 * @access Admin
 */
router.put("/:userId/flag", flagCustomerForReview);

export default router;