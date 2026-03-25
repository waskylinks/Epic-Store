import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import {
  getChannelPerformance,
  getCampaignPerformance,
  getDevicePerformance,
  getBrowserPerformance,
  getReferrerPerformance,
  getAttributionModels,
  getLandingPagePerformance
} from "../controller/attribution-analytics-controller.js";

const router = express.Router();

// All routes require admin authentication
router.use(verifyUserAuth, roleBaseAccess("admin", "superAdmin"), adminAnalyticsLimiter);

// ============================================
// CHANNEL & CAMPAIGN ANALYTICS
// ============================================

/**
 * Get marketing channel performance
 * @route GET /api/v1/analytics/attribution/channels
 * @access Admin
 */
router.get("/channels", getChannelPerformance);

/**
 * Get campaign performance analytics
 * @route GET /api/v1/analytics/attribution/campaigns
 * @access Admin
 */
router.get("/campaigns", getCampaignPerformance);

// ============================================
// DEVICE & BROWSER ANALYTICS
// ============================================

/**
 * Get device performance analytics
 * @route GET /api/v1/analytics/attribution/devices
 * @access Admin
 */
router.get("/devices", getDevicePerformance);

/**
 * Get browser performance analytics
 * @route GET /api/v1/analytics/attribution/browsers
 * @access Admin
 */
router.get("/browsers", getBrowserPerformance);

// ============================================
// REFERRER & LANDING PAGE ANALYTICS
// ============================================

/**
 * Get referrer performance analytics
 * @route GET /api/v1/analytics/attribution/referrers
 * @access Admin
 */
router.get("/referrers", getReferrerPerformance);

/**
 * Get landing page performance
 * @route GET /api/v1/analytics/attribution/landing-pages
 * @access Admin
 */
router.get("/landing-pages", getLandingPagePerformance);

// ============================================
// ATTRIBUTION MODELS
// ============================================

/**
 * Get attribution model comparison (first-touch vs last-touch)
 * @route GET /api/v1/analytics/attribution/models
 * @access Admin
 */
router.get("/models", getAttributionModels);

export default router;