import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { getAdminStats, getAnalytics } from "../controller/analytics-controller.js";

const router = express.Router();

router.get("/admin/stats", verifyUserAuth, roleBaseAccess("admin"), getAdminStats);
router.get("/admin/analytics", verifyUserAuth, roleBaseAccess("admin"), getAnalytics);

export default router;
