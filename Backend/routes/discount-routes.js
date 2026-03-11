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

// ============================================
// ROUTE ORDER MATTERS
//
// Express matches routes top-to-bottom. All named routes
// (/stats, /audit, /has-new, /create-for-user, etc.) MUST be
// registered before the /:id and /audit/:discountId param routes,
// otherwise Express will match those literal strings as ID values
// and call the wrong controller.
//
// Order:
//   1. Public routes (no auth)
//   2. User routes  (verifyUserAuth only)
//   3. Admin named routes (verifyUserAuth + roleBaseAccess) — always before /:id
//   4. Admin param routes /:id — always last
// ============================================

// ============================================
// 1. PUBLIC ROUTES
// ============================================

// Validate a discount code at checkout (auth optional — logged-in users
// get per-user eligibility checks; guests get basic validation only).
// Note: audience:'specific' codes require authentication (enforced in controller).
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
// Returns { hasNew: true/false } based on new audience:'all' or personal
// discounts created after user.lastSeenDiscountsAt.
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

// Create compensation discount (return / refund flow).
// Fixed type, single user, tied to a return or order context.
router.post(
  "/create-compensation",
  verifyUserAuth,
  roleBaseAccess("admin"),
  createCompensationDiscount
);

// Create a VIP / targeted user discount.
// Supports multiple users (by userId and/or email), both percentage and fixed
// types, and flexible usage limits. No return/order linkage required.
// audience is hardcoded to 'specific' — not configurable on this route.
router.post(
  "/create-for-user",
  verifyUserAuth,
  roleBaseAccess("admin"),
  createDiscountForUsers
);

// Manual cleanup trigger (on-demand for admin UI).
// Writes a manual_cleanup audit entry before running so the triggering
// admin is always recorded.
router.post(
  "/cleanup",
  verifyUserAuth,
  roleBaseAccess("admin"),
  triggerCleanup
);

// ── Audit routes ─────────────────────────────────────────────────────────────
// /audit/purge-log MUST come before /audit/:discountId to prevent
// Express matching "purge-log" as a discountId param value.

// All audit logs — paginated, filterable by action / discountCode /
// performedById / dateFrom / dateTo.
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

// Create a new broadcast or general discount code.
// For user-scoped discounts prefer /create-for-user (validated eligibleUsers)
// or /create-compensation (return/refund flow).
router.post(
  "/",
  verifyUserAuth,
  roleBaseAccess("admin"),
  createDiscount
);

// Get single discount — includes usageHistory (capped to last 100),
// relatedReturn, relatedOrder, createdBy.
router.get(
  "/:id",
  verifyUserAuth,
  roleBaseAccess("admin"),
  getDiscountById
);

// Update allowed fields only (description, status, validFrom,
// validUntil, usageLimit, conditions, notes).
// Status resurrection to 'active' is guarded — validUntil must be future.
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