import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { 
    getAdminStats, 
    getAnalytics,
    getTopProductsEndpoint  // NEW: Optional standalone endpoint
} from "../controller/analytics-controller.js";

const router = express.Router();


router.get("/admin/stats", verifyUserAuth, roleBaseAccess("admin"), getAdminStats);
router.get("/admin/analytics", verifyUserAuth, roleBaseAccess("admin"), getAnalytics);

//  Optional standalone top products endpoint with pagination
// Example: /api/v1/admin/top-products?limit=10&page=2
router.get("/admin/top-products", verifyUserAuth, roleBaseAccess("admin"), getTopProductsEndpoint);

export default router;