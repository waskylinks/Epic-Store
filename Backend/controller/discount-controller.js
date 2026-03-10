import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Discount from "../models/discount-model.js";
import User from "../models/userModel.js";
import DiscountAuditLog from "../models/DiscountAuditLog.js";
import AuditPurgeLog from "../models/AuditPurgeLog.js";
import crypto from "crypto";
import Order from "../models/order-model.js";

// ============================================
// AUDIT HELPER
// Builds a clean performedBy snapshot from req.user.
// Called by every controller that writes an audit entry.
// ============================================
const auditActor = (user) => ({
  _id:       user._id,
  firstName: user.firstName ?? null,
  lastName:  user.lastName  ?? null,
  email:     user.email     ?? null,
  system:    false,
});

// ============================================
// ADMIN: CREATE DISCOUNT
// ============================================

/**
 * @route POST /api/v1/discounts
 * @access Admin
 */
export const createDiscount = handleAsyncError(async (req, res, next) => {
  const {
    code, description, type, value, category,
    audience,
    validFrom, validUntil, usageLimit, conditions, notes,
    relatedOrder, relatedReturn,
  } = req.body;

  if (!code || !description || !type || !value || !category || !validUntil) {
    return next(new HandleError("Missing required fields", 400));
  }

  // audience:'all' discounts are not scoped to specific users.
  // audience:'specific' is the default for personalised codes.
  const resolvedAudience = audience === "all" ? "all" : "specific";

  const existingDiscount = await Discount.findOne({
    code: code.toUpperCase(),
  }).lean();
  if (existingDiscount) {
    return next(new HandleError("Discount code already exists", 400));
  }

  const discount = await Discount.create({
    code: code.toUpperCase(),
    description, type, value, category,
    audience: resolvedAudience,
    validFrom: validFrom || Date.now(),
    validUntil,
    usageLimit: usageLimit || {},
    conditions: conditions || {},
    notes, relatedOrder, relatedReturn,
    createdBy: req.user._id,
  });

  // ── Audit entry ──────────────────────────────────────────────────────────
  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "created",
    performedBy:  auditActor(req.user),
    meta: {
      audience:    resolvedAudience,
      type,
      value,
      category,
      validUntil,
      relatedReturn:  relatedReturn  ?? null,
      relatedOrder:   relatedOrder   ?? null,
    },
  });

  res.status(201).json({
    success: true,
    message: "Discount created successfully",
    discount,
  });
});

// ============================================
// ADMIN: UPDATE DISCOUNT
// ============================================

/**
 * @route PUT /api/v1/discounts/:id
 * @access Admin
 */
export const updateDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const allowedUpdates = [
    "description", "status", "validFrom", "validUntil",
    "usageLimit", "conditions", "notes",
  ];

  const updates = {};
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  // Fetch the document before update so we can record a before/after diff
  const before = await Discount.findById(id).lean();
  if (!before) return next(new HandleError("Discount not found", 404));

  const discount = await Discount.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  // ── Audit entry — record only changed fields ─────────────────────────────
  const changedFields = Object.keys(updates).filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(updates[field])
  );

  if (changedFields.length > 0) {
    const beforeSnapshot = {};
    const afterSnapshot  = {};
    changedFields.forEach((field) => {
      beforeSnapshot[field] = before[field];
      afterSnapshot[field]  = updates[field];
    });

    await DiscountAuditLog.log({
      discountId:   discount._id,
      discountCode: discount.code,
      action:       "updated",
      performedBy:  auditActor(req.user),
      meta: {
        changedFields,
        before: beforeSnapshot,
        after:  afterSnapshot,
      },
    });
  }

  res.status(200).json({
    success: true,
    message: "Discount updated successfully",
    discount,
  });
});

// ============================================
// ADMIN: DELETE DISCOUNT (soft)
//
// FRAUD PROTECTION GUARD:
//   Blocks soft-deletion if the discount has been used AND
//   is still within its 30-day post-use protection window.
//   Attempts are logged even when blocked — a pattern of repeated
//   blocked attempts against the same code is itself a signal.
// ============================================

/**
 * @route DELETE /api/v1/discounts/:id
 * @access Admin
 */
export const deleteDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const discount = await Discount.findById(id);
  if (!discount) return next(new HandleError("Discount not found", 404));

  const now = new Date();

  // ── Fraud protection check ───────────────────────────────────────────────
  if (
    discount.usageLimit.currentUses >= 1 &&
    discount.deletionEligibleAt &&
    discount.deletionEligibleAt > now
  ) {
    // Log the blocked attempt — admin should be aware this is recorded
    await DiscountAuditLog.log({
      discountId:   discount._id,
      discountCode: discount.code,
      action:       "deactivation_blocked",
      performedBy:  auditActor(req.user),
      meta: {
        reason:              "within_protection_window",
        deletionEligibleAt:  discount.deletionEligibleAt,
        currentUses:         discount.usageLimit.currentUses,
        attemptedBy:         req.user._id,
      },
    });

    return next(
      new HandleError(
        `This discount cannot be deactivated until ${discount.deletionEligibleAt.toDateString()} ` +
        `because it has been used. This protects the audit trail for 30 days after first use.`,
        403
      )
    );
  }

  // ── Proceed with soft delete ─────────────────────────────────────────────
  const previousStatus = discount.status;

  await Discount.findByIdAndUpdate(
    id,
    { $set: { status: "inactive" } },
    { new: true }
  );

  // ── Audit entry ──────────────────────────────────────────────────────────
  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "deactivated",
    performedBy:  auditActor(req.user),
    meta: {
      previousStatus,
      currentUses: discount.usageLimit.currentUses,
    },
  });

  res.status(200).json({ success: true, message: "Discount deactivated successfully" });
});

// ============================================
// ADMIN: GET ALL DISCOUNTS (cursor-based pagination)
// ============================================

/**
 * @route GET /api/v1/discounts
 * @access Admin
 */
export const getAllDiscounts = handleAsyncError(async (req, res, next) => {
  const { status, category, type, search, cursor } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const filter = {};
  if (status)   filter.status   = status;
  if (category) filter.category = category;
  if (type)     filter.type     = type;
  if (search) {
    filter.$or = [
      { code:        { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  if (cursor) {
    try {
      const { id } = JSON.parse(
        Buffer.from(cursor, "base64").toString("utf8")
      );
      filter._id = { $lt: id };
    } catch {
      return next(new HandleError("Invalid pagination cursor", 400));
    }
  }

  const discounts = await Discount.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("createdBy", "firstName lastName email")
    .populate("relatedOrder", "orderNumber")
    .lean();

  const hasNextPage = discounts.length > limit;
  if (hasNextPage) discounts.pop();

  let nextCursor = null;
  if (hasNextPage && discounts.length > 0) {
    const last = discounts[discounts.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ id: last._id, createdAt: last.createdAt })
    ).toString("base64");
  }

  res.status(200).json({
    success: true,
    discounts,
    pagination: { limit, hasNextPage, nextCursor },
  });
});

// ============================================
// ADMIN: GET SINGLE DISCOUNT
// ============================================

/**
 * @route GET /api/v1/discounts/:id
 * @access Admin
 */
export const getDiscountById = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const discount = await Discount.findById(id)
    .populate("createdBy", "firstName lastName email")
    .populate("relatedOrder", "orderNumber totalPrice")
    .populate(
      "relatedReturn",
      "returnInfo.rmaNumber returnInfo.status returnInfo.discountValue"
    )
    .populate("usageHistory.user",  "firstName lastName email")
    .populate("usageHistory.order", "orderNumber");

  if (!discount) return next(new HandleError("Discount not found", 404));

  res.status(200).json({ success: true, discount });
});

// ============================================
// ADMIN: CREATE COMPENSATION DISCOUNT
// ============================================

/**
 * @route POST /api/v1/discounts/create-compensation
 * @access Admin
 */
export const createCompensationDiscount = handleAsyncError(async (req, res, next) => {
  const {
    userId,
    amount,
    reason,
    category,
    validDays = 30,
    relatedOrder,
    relatedReturn,
  } = req.body;

  if (!userId || !category) {
    return next(
      new HandleError("Missing required fields: userId, category", 400)
    );
  }

  // FIX 1 — relatedReturn uniqueness guard
  if (relatedReturn) {
    const existing = await Discount.findOne({ relatedReturn }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A discount code already exists for this return: ${existing.code}`,
        existingCode:       existing.code,
        existingDiscountId: existing._id,
      });
    }
  }

  const user = await User.findById(userId).lean();
  if (!user) return next(new HandleError("User not found", 404));

  // FIX 2 + FIX 3 — re-read amount from the return document
  let finalAmount;

  if (relatedReturn) {
    const order = await Order.findById(relatedReturn)
      .select("returnInfo.status returnInfo.discountValue")
      .lean();

    if (!order) {
      return next(new HandleError("Related return order not found", 404));
    }

    const allowedStatuses = ["awaiting_discount", "completed"];
    if (!allowedStatuses.includes(order.returnInfo?.status)) {
      return next(
        new HandleError(
          `Cannot generate discount: return status is '${order.returnInfo?.status}'. ` +
          `Expected 'awaiting_discount'.`,
          400
        )
      );
    }

    finalAmount = order.returnInfo?.discountValue;

    if (
      finalAmount === undefined ||
      finalAmount === null ||
      isNaN(Number(finalAmount)) ||
      Number(finalAmount) <= 0
    ) {
      return next(
        new HandleError(
          "Return has no valid discount value. Ensure items have been reviewed " +
          "and approved before generating a discount.",
          400
        )
      );
    }

    finalAmount = Number(finalAmount);
  } else {
    if (amount === undefined || amount === null) {
      return next(new HandleError("Missing required field: amount", 400));
    }
    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      return next(new HandleError("Amount must be a positive number", 400));
    }
    finalAmount = Number(amount);
  }

  const uniqueSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  const code = `${category.toUpperCase()}-${user.firstName.toUpperCase()}-${uniqueSuffix}`;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + parseInt(validDays));

  const discount = await Discount.create({
    code,
    description:
      reason ||
      `Compensation discount for ${user.firstName}${relatedReturn ? " (return)" : ""}`,
    type:     "fixed",
    value:    finalAmount,
    category,
    audience: "specific",   // compensation codes are always personalised
    validUntil,
    usageLimit: {
      totalUses:   1,
      usesPerUser: 1,
    },
    conditions: {
      eligibleUsers:      [userId],
      minPurchaseAmount:  0,
    },
    notes: relatedReturn
      ? `Auto-generated from return ${relatedReturn}`
      : `Manual compensation — ${category}`,
    relatedOrder,
    relatedReturn,
    createdBy: req.user._id,
  });

  // ── Audit entry ──────────────────────────────────────────────────────────
  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "created",
    performedBy:  auditActor(req.user),
    meta: {
      audience:         "specific",
      compensationType: category,
      relatedReturn:    relatedReturn ?? null,
      relatedOrder:     relatedOrder  ?? null,
      value:            finalAmount,
      eligibleUser:     userId,
    },
  });

  return res.status(201).json({
    success: true,
    message: "Compensation discount created successfully",
    discount,
  });
});

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE
//
// On successful validation, recordUsage() is called which:
//   - Pushes usage to usageHistory
//   - Increments currentUses
//   - Sets lockedAt + deletionEligibleAt on first use (0 → 1)
// The audit entry includes isFirstUse so the trail reflects
// exactly when the fraud-protection window opened.
// ============================================

/**
 * @route POST /api/v1/discounts/validate
 * @access Public
 */
export const validateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, cartTotal, items, orderId } = req.body;

  if (!code) return next(new HandleError("Discount code is required", 400));
  if (!cartTotal || cartTotal <= 0)
    return next(new HandleError("Invalid cart total", 400));

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError("Invalid or expired discount code", 400));

  const userId = req.user?._id;

  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse)
      return next(new HandleError(canUse.reason, 400));
  }

  const validation = discount.validateCart(cartTotal, items, userId);
  if (!validation.valid)
    return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(cartTotal, items);

  // recordUsage sets lockedAt + deletionEligibleAt on first use
  const { isFirstUse } = await discount.recordUsage(
    userId,
    orderId ?? null,
    discountAmount
  );

  // ── Audit entry ──────────────────────────────────────────────────────────
  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "used",
    performedBy:  userId
      ? { _id: userId, firstName: req.user?.firstName ?? null,
          lastName: req.user?.lastName ?? null,
          email: req.user?.email ?? null, system: false }
      : { system: true },
    meta: {
      userId:        userId  ?? null,
      orderId:       orderId ?? null,
      discountAmount,
      cartTotal,
      isFirstUse,
      // Surface the protection window opening so it's visible in the audit trail
      ...(isFirstUse && {
        lockedAt:            discount.lockedAt,
        deletionEligibleAt:  discount.deletionEligibleAt,
      }),
    },
  });

  res.status(200).json({
    success: true,
    valid: true,
    discount: {
      code:           discount.code,
      type:           discount.type,
      value:          discount.value,
      discountAmount,
      description:    discount.description,
    },
  });
});

// ============================================
// PUBLIC: GET ACTIVE PROMOS
// ============================================

/**
 * @route GET /api/v1/discounts/promos
 * @access Public
 */
export const getActivePromos = handleAsyncError(async (req, res, next) => {
  const promos = await Discount.getActivePromos();
  res.status(200).json({ success: true, promos });
});

// ============================================
// USER: GET MY DISCOUNTS
//
// Returns the combined set of:
//   1. audience:'all' active discounts (broadcast promos)
//   2. audience:'specific' discounts where eligibleUsers includes this user
//
// After the query resolves, stamps user.lastSeenDiscountsAt = now.
// This single write is what clears the Navbar notification dot —
// the moment the user opens this page, the dot disappears.
//
// Uses validateBeforeSave: false to avoid triggering unrelated
// validators (e.g. password, emailVerified) on the user document.
// ============================================

/**
 * @route GET /api/v1/discounts/my-discounts
 * @access Private
 */
export const getMyDiscounts = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const now = new Date();

  // Parallel fetch — both queries hit separate indexes:
  //   audience:'all'   → (audience, status, validUntil) partial index
  //   eligibleUsers    → (conditions.eligibleUsers, status) sparse index
  const [broadcastDiscounts, personalDiscounts] = await Promise.all([
    Discount.find({
      audience:  "all",
      status:    "active",
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    })
      .select(
        "code description type value category audience validUntil " +
        "conditions.minPurchaseAmount conditions.maxDiscountAmount " +
        "conditions.firstOrderOnly usageLimit.currentUses usageLimit.totalUses"
      )
      .lean(),

    Discount.find({
      audience:                   "specific",
      status:                     "active",
      validFrom:                  { $lte: now },
      validUntil:                 { $gte: now },
      "conditions.eligibleUsers": userId,
    })
      .select(
        "code description type value category audience validUntil " +
        "conditions.minPurchaseAmount conditions.firstOrderOnly " +
        "usageLimit.currentUses usageLimit.totalUses"
      )
      .lean(),
  ]);

  // Stamp lastSeenDiscountsAt — clears the Navbar notification dot.
  // validateBeforeSave:false bypasses password/email validators.
  await User.findByIdAndUpdate(
    userId,
    { $set: { lastSeenDiscountsAt: now } },
    { new: false, runValidators: false }
  );

  const discounts = [...broadcastDiscounts, ...personalDiscounts];

  res.status(200).json({ success: true, discounts });
});

// ============================================
// USER: HAS NEW DISCOUNTS (Navbar dot)
//
// Lightweight read-only check. No DB writes.
// Returns { hasNew: true } if there is an audience:'all' discount
// created after the user last viewed their discounts page.
//
// Dot scope: audience:'all' broadcasts only.
// Personal compensation codes are transactional — the user already
// knows about them from the return/refund notification flow.
// ============================================

/**
 * @route GET /api/v1/discounts/has-new
 * @access Private (authenticated user)
 */
export const hasNewDiscounts = handleAsyncError(async (req, res, next) => {
  const user = req.user;
  const now  = new Date();

  // Find the most recently created active broadcast discount
  const newest = await Discount.findOne({
    audience:  "all",
    status:    "active",
    validUntil: { $gte: now },
  })
    .sort({ createdAt: -1 })
    .select("createdAt")
    .lean();

  if (!newest) {
    return res.status(200).json({ hasNew: false });
  }

  // Dot appears if:
  //   - User has never opened the discounts page (lastSeenDiscountsAt is null)
  //   - OR the newest broadcast was created after they last looked
  const hasNew =
    !user.lastSeenDiscountsAt ||
    newest.createdAt > user.lastSeenDiscountsAt;

  res.status(200).json({ hasNew });
});

// ============================================
// ADMIN: GET DISCOUNT STATS
// ============================================

/**
 * @route GET /api/v1/discounts/stats
 * @access Admin
 */
export const getDiscountStats = handleAsyncError(async (req, res, next) => {
  const [stats, overall] = await Promise.all([
    Discount.aggregate([
      {
        $group: {
          _id: "$category",
          totalDiscounts: { $sum: 1 },
          activeDiscounts: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          totalUses: { $sum: "$usageLimit.currentUses" },
          totalDiscountValue: {
            $sum: {
              $reduce: {
                input:        "$usageHistory",
                initialValue: 0,
                in: { $add: ["$$value", "$$this.discountAmount"] },
              },
            },
          },
        },
      },
      { $sort: { totalUses: -1 } },
    ]),
    Discount.aggregate([
      {
        $group: {
          _id:      null,
          total:    { $sum: 1 },
          active:   { $sum: { $cond: [{ $eq: ["$status", "active"]   }, 1, 0] } },
          expired:  { $sum: { $cond: [{ $eq: ["$status", "expired"]  }, 1, 0] } },
          totalUses:{ $sum: "$usageLimit.currentUses" },
        },
      },
    ]),
  ]);

  res.status(200).json({
    success: true,
    stats,
    overall: overall[0] || { total: 0, active: 0, expired: 0, totalUses: 0 },
  });
});

// ============================================
// ADMIN: TRIGGER MANUAL CLEANUP
// ============================================

/**
 * @route POST /api/v1/discounts/cleanup
 * @access Admin
 */
export const triggerCleanup = handleAsyncError(async (req, res, next) => {
  const { daysOld = 90 } = req.body;

  const [expired, deleted] = await Promise.all([
    Discount.bulkExpireStale(),
    Discount.deleteOldExpired(daysOld),
  ]);

  res.status(200).json({
    success: true,
    message: "Cleanup complete",
    expired,
    deleted,
  });
});

// ============================================
// ADMIN: GET FULL AUDIT LOG (paginated)
//
// Cursor-based pagination — same pattern as getAllDiscounts.
// All actions including CRON system entries are visible.
// System entries are identified by performedBy.system === true.
// ============================================

/**
 * @route GET /api/v1/discounts/audit
 * @access Admin
 *
 * Query params:
 *   action, discountCode, performedById — filters
 *   dateFrom, dateTo                    — date range
 *   limit                               — page size (default 20, max 100)
 *   cursor                              — pagination token
 */
export const getAuditLog = handleAsyncError(async (req, res, next) => {
  const {
    action, discountCode, performedById,
    dateFrom, dateTo, cursor,
  } = req.query;

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const { logs, hasNextPage, nextCursor } =
    await DiscountAuditLog.getPaginated({
      action,
      discountCode,
      performedById,
      dateFrom,
      dateTo,
      cursor,
      limit,
    });

  res.status(200).json({
    success: true,
    auditLogs: logs,
    pagination: { limit, hasNextPage, nextCursor },
  });
});

// ============================================
// ADMIN: GET AUDIT LOG FOR SINGLE DISCOUNT
// Used by the detail drawer — fixed limit of 20, no pagination.
// ============================================

/**
 * @route GET /api/v1/discounts/audit/:discountId
 * @access Admin
 */
export const getDiscountAuditLog = handleAsyncError(async (req, res, next) => {
  const { discountId } = req.params;

  const logs = await DiscountAuditLog.getForDiscount(discountId, 20);

  res.status(200).json({ success: true, auditLogs: logs });
});

// ============================================
// ADMIN: GET PURGE LOG
// Returns all AuditPurgeLog receipts newest first.
// Read-only. No delete route registered for this collection.
// ============================================

/**
 * @route GET /api/v1/discounts/audit/purge-log
 * @access Admin
 */
export const getPurgeLog = handleAsyncError(async (req, res, next) => {
  const [purgeLog, latestPurge] = await Promise.all([
    AuditPurgeLog.getAll(),
    AuditPurgeLog.getLatest(),
  ]);

  // showBanner: true when the most recent purge happened within 7 days.
  // Used by the UI to decide whether to render the receipt notification banner.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const showBanner =
    latestPurge !== null &&
    new Date(latestPurge.purgedAt) > sevenDaysAgo;

  res.status(200).json({
    success: true,
    purgeLog,
    latestPurge,
    showBanner,
  });
});