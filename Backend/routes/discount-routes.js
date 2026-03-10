import express from "express";
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import {
  createDiscount,
  updateDiscount,
  deleteDiscount,
  getAllDiscounts,
  getDiscountById,
  createCompensationDiscount,
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

// ============================================
// ROUTE ORDER MATTERS
//
// Express matches routes top-to-bottom. All named routes
// (/stats, /audit, /has-new, etc.) MUST be registered before
// the /:id and /audit/:discountId param routes, otherwise Express
// will match "stats", "audit", "has-new" etc. as ID values and
// call the wrong controller.
//
// Order:
//   1. Public routes (no auth)
//   2. User routes  (verifyUserAuth only)
//   3. Admin named routes (verifyUserAuth + roleBaseAccess)
//   4. Admin param routes /:id  — always last
// ============================================

// ============================================
// 1. PUBLIC ROUTES
// ============================================

// Validate a discount code at checkout (auth optional — logged-in users
// get per-user eligibility checks; guests get basic validation only)
router.post("/validate", validateDiscountCode);

// Public promo listing — audience:'all' active discounts only
router.get("/promos", getActivePromos);

// ============================================
// 2. USER ROUTES (authenticated, any role)
// ============================================

// Personal + broadcast discounts for the logged-in user.
// Also stamps user.lastSeenDiscountsAt — clears the Navbar dot.
router.get("/my-discounts", verifyUserAuth, getMyDiscounts);

// Lightweight dot check — called by Navbar on mount.
// Returns { hasNew: true/false } based on audience:'all' discounts
// created after user.lastSeenDiscountsAt.
// No DB writes — read-only.
router.get("/has-new", verifyUserAuth, hasNewDiscounts);

// ============================================
// 3. ADMIN NAMED ROUTES
// All must appear before /:id and /audit/:discountId
// ============================================

// Discount stats (KPI cards + category breakdown)
router.get(
  "/stats",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getDiscountStats
);

// Create compensation discount (return / refund flow)
router.post(
  "/create-compensation",
  verifyUserAuth,
  roleBaseAccess("admin"),
  createCompensationDiscount
);

// Manual cleanup trigger (on-demand for admin UI)
router.post(
  "/cleanup",
  verifyUserAuth,
  roleBaseAccess("admin"),
  triggerCleanup
);

// ── Audit routes ─────────────────────────────────────────────────────────────
// /audit/purge-log must come before /audit/:discountId to prevent
// Express matching "purge-log" as a discountId param.

// All audit logs — paginated, filterable.
// Includes CRON system entries (performedBy.system === true).
router.get(
  "/audit",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getAuditLog
);

// Purge receipts from AuditPurgeLog — permanent, append-only.
// Also returns showBanner flag for the UI receipt notification.
// NO delete route is registered for AuditPurgeLog — ever.
router.get(
  "/audit/purge-log",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getPurgeLog
);

// Per-discount audit trail — last 20 entries.
// Used by the detail drawer in AdminDiscounts.jsx.
// Registered AFTER /audit and /audit/purge-log.
router.get(
  "/audit/:discountId",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getDiscountAuditLog
);

// ============================================
// 4. ADMIN PARAM ROUTES (/:id — always last)
// ============================================

// List all discounts — cursor-based pagination
router.get(
  "/",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getAllDiscounts
);

// Create a new discount code
router.post(
  "/",
  verifyUserAuth,
  roleBaseAccess("admin"),
  createDiscount
);

// Get single discount — includes usageHistory, relatedReturn, relatedOrder
router.get(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getDiscountById
);

// Update allowed fields only (description, status, validFrom,
// validUntil, usageLimit, conditions, notes)
router.put(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin"),
  updateDiscount
);

// Soft-delete (status → inactive).
// Blocked if discount is within its 30-day fraud-protection window.
// Blocked attempts are logged to DiscountAuditLog regardless.
router.delete(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin"),
  deleteDiscount
);

export default router;