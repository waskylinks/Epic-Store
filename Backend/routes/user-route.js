import express from "express";
import { deleteUser, getAdminStats, getSingleUser, getUserDetails, getUsersList, loginUser, logout, registerUser, requestPasswordReset, resetPassword, UpdatePassword, updateProfile, updateUserRole } from "../controller/user-controller.js";
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { getAnalytics, getRevenueChartData } from "../controller/analytics-controller.js";

const router = express.Router();

router.route("/register").post(registerUser);

router.route("/login").post(loginUser);

router.route("/logout").post(logout);

router.route("/password/forgot").post(requestPasswordReset);

router.route("/reset/:token").post(resetPassword);

router.route("/profile").get(verifyUserAuth, getUserDetails);

router.route("/password/update").put(verifyUserAuth, UpdatePassword);

router.route("/profile/update").put(verifyUserAuth, updateProfile);

router.route("/admin/users").get(verifyUserAuth, roleBaseAccess('admin'), getUsersList);

router.route("/admin/user/:id").get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser);

router.route("/admin/stats").get(verifyUserAuth, roleBaseAccess('admin'), getAdminStats);

router.route("/admin/user/:id").get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser).put(verifyUserAuth, roleBaseAccess('admin'), updateUserRole);

router.route("/admin/user/:id").get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser).delete(verifyUserAuth, roleBaseAccess('admin'), deleteUser);

// Admin dashboard basic stats
router.route("/admin/stats")
  .get(verifyUserAuth, roleBaseAccess("admin"), getAdminStats);

// Advanced analytics with trends
// ?timeframe=week | month | year
router.route("/admin/analytics")
  .get(verifyUserAuth, roleBaseAccess("admin"), getAnalytics);

// Revenue chart data
// ?timeframe=week | month | year
router.route("/admin/analytics/revenue")
  .get(verifyUserAuth, roleBaseAccess("admin"), getRevenueChartData);


export default router;