import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from "../middleware/rateLimiter.js";
import { 
    getAdminStats, 
    getAnalytics,
    getTopProductsEndpoint
} from "../controller/analytics-controller.js";

const router = express.Router();

// Admin analytics endpoints (with rate limiting)
router.get(
  "/admin/stats", 
  verifyUserAuth, 
  roleBaseAccess("admin"), 
  adminAnalyticsLimiter,
  getAdminStats
);

router.get(
  "/admin/analytics", 
  verifyUserAuth, 
  roleBaseAccess("admin"), 
  adminAnalyticsLimiter,
  getAnalytics
);

// Optional standalone top products endpoint with pagination
router.get(
  "/admin/top-products", 
  verifyUserAuth, 
  roleBaseAccess("admin"), 
  adminAnalyticsLimiter,
  getTopProductsEndpoint
);

export default router;