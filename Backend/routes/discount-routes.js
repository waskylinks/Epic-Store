import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import {
  createDiscount,
  updateDiscount,
  deleteDiscount,
  getAllDiscounts,
  getDiscountById,
  createCompensationDiscount,
  createDiscountForUsers,
  validateDiscountCode,
  getActivePromos,
  getMyDiscounts,
  hasNewDiscounts,
  getDiscountStats,
  getAuditLog,
  getDiscountAuditLog,
  getPurgeLog,
  triggerCleanup,
} from "../controller/discount-controller.js";

const router = express.Router();

router.post("/validate", validateDiscountCode);

// Public promo listing — audience:'all' active discounts only
router.get("/promos", getActivePromos);

// ============================================
// USER ROUTES (authenticated, any role)
// ============================================

// Personal + broadcast discounts for the logged-in user.
// Also stamps user.lastSeenDiscountsAt — clears the Navbar dot.
router.get("/my-discounts", verifyUserAuth, getMyDiscounts);


router.get("/has-new", verifyUserAuth, hasNewDiscounts);

// ============================================
//  ADMIN NAMED ROUTES
// All must appear before /:id and /audit/:discountId
// ============================================

router.get(
  "/stats",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  getDiscountStats
);

router.post(
  "/create-compensation",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  createCompensationDiscount
);

router.post(
  "/create-for-user",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  createDiscountForUsers
);

router.post(
  "/cleanup",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  triggerCleanup
);

// ── Audit routes ─────────────────────────────────────────────────────────────

router.get(
  "/audit",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  getAuditLog
);

router.get(
  "/audit/purge-log",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  getPurgeLog
);

router.get(
  "/audit/:discountId",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  getDiscountAuditLog
);

// ============================================
// ADMIN PARAM ROUTES (/:id — always last)
// ============================================

// List all discounts — cursor-based pagination
router.get(
  "/",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  getAllDiscounts
);

router.post(
  "/",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  createDiscount
);

router.get(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  getDiscountById
);

router.put(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  updateDiscount
);

router.delete(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin", 'superAdmin'),
  deleteDiscount
);

export default router;