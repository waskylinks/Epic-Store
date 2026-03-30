import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Discount, { PRODUCT_CATEGORIES } from "../models/discount-model.js";
import User from "../models/userModel.js";
import DiscountAuditLog from "../models/DiscountAuditLog.js";
import AuditPurgeLog from "../models/AuditPurgeLog.js";
import crypto from "crypto";
import Order from "../models/order-model.js";
import mongoose from "mongoose";
import redis from "../utils/redis.js";

// FIX #6/#7: syncDiscountAfterRedemption is NO LONGER imported here.
// It must only fire after a confirmed payment in the payment controller,
// not at /validate time. Calling it here caused usage to be recorded
// before payment was confirmed, and generated spurious analytics syncs
// on every UI-triggered validation call.

// ============================================
// HELPERS
// ============================================

const auditActor = (user) => ({
  _id:       user._id,
  firstName: user.firstName ?? null,
  lastName:  user.lastName  ?? null,
  email:     user.email     ?? null,
  system:    false,
});

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isValidObjectId = (s) => mongoose.Types.ObjectId.isValid(s);

const validateProductCategories = (cats) => {
  if (!Array.isArray(cats) || cats.length === 0) {
    return { valid: true, invalid: [] };
  }
  const invalid = cats.filter((c) => !PRODUCT_CATEGORIES.includes(c));
  return { valid: invalid.length === 0, invalid };
};

const invalidateStatsCache = async () => {
  try {
    await redis.del("discount:stats");
  } catch {
    // Redis failure must never block a discount write.
  }
};

// ============================================
// ADMIN: CREATE DISCOUNT
// ============================================

export const createDiscount = handleAsyncError(async (req, res, next) => {
  const {
    code, description, type, value, category,
    audience,
    validFrom, validUntil, usageLimit, conditions, notes,
    relatedOrder, relatedReturn,
    eligibleProductCategories,
  } = req.body;

  if (!code || !description || !type || !value || !category || !validUntil) {
    return next(new HandleError("Missing required fields", 400));
  }

  if (relatedOrder && !isValidObjectId(relatedOrder)) {
    return next(new HandleError("Invalid relatedOrder id", 400));
  }
  if (relatedReturn && !isValidObjectId(relatedReturn)) {
    return next(new HandleError("Invalid relatedReturn id", 400));
  }

  let resolvedEligibleProductCategories = [];
  if (eligibleProductCategories !== undefined && eligibleProductCategories !== null) {
    if (!Array.isArray(eligibleProductCategories)) {
      return next(
        new HandleError("eligibleProductCategories must be an array of strings", 400)
      );
    }
    const catCheck = validateProductCategories(eligibleProductCategories);
    if (!catCheck.valid) {
      return next(
        new HandleError(
          `Invalid product categories: ${catCheck.invalid.join(", ")}. ` +
          `Valid categories are: ${PRODUCT_CATEGORIES.join(", ")}`,
          400
        )
      );
    }
    resolvedEligibleProductCategories = eligibleProductCategories;
  }

  const resolvedAudience = audience === "all" ? "all" : "specific";

  const existingDiscount = await Discount.findOne({ code: code.toUpperCase() }).lean();
  if (existingDiscount) {
    return next(new HandleError("Discount code already exists", 400));
  }

  const mergedConditions = {
    ...(conditions || {}),
    eligibleProductCategories: resolvedEligibleProductCategories,
  };

  let discount;
  try {
    discount = await Discount.create({
      code: code.toUpperCase(),
      description, type, value, category,
      audience: resolvedAudience,
      validFrom: validFrom || Date.now(),
      validUntil,
      usageLimit: usageLimit || {},
      conditions: mergedConditions,
      notes, relatedOrder, relatedReturn,
      createdBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new HandleError("Discount code already exists", 400));
    }
    return next(err);
  }

  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "created",
    performedBy:  auditActor(req.user),
    meta: {
      audience:    resolvedAudience,
      type, value, category, validUntil,
      relatedReturn:  relatedReturn  ?? null,
      relatedOrder:   relatedOrder   ?? null,
      eligibleProductCategories: resolvedEligibleProductCategories,
    },
  });

  await invalidateStatsCache();

  res.status(201).json({
    success: true,
    message: "Discount created successfully",
    discount,
  });
});

// ============================================
// ADMIN: UPDATE DISCOUNT
// ============================================

export const updateDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new HandleError("Invalid discount id", 400));
  }

  const allowedUpdates = [
    "description", "status", "validFrom", "validUntil",
    "usageLimit", "conditions", "notes",
    "eligibleProductCategories",
    "remainingBalance",
  ];

  const updates = {};
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  if (updates.remainingBalance !== undefined) {
    const rb = Number(updates.remainingBalance);
    if (isNaN(rb) || rb < 0) {
      return next(new HandleError("remainingBalance must be a non-negative number", 400));
    }
    const peek = await Discount.findById(id).select("value type usageLimit remainingBalance").lean();
    if (!peek) return next(new HandleError("Discount not found", 404));
    if (peek.type !== "fixed") {
      return next(new HandleError("remainingBalance can only be set on fixed-type discounts", 400));
    }
    if (rb > peek.value) {
      return next(new HandleError(`remainingBalance cannot exceed face value ($${peek.value})`, 400));
    }

    // FIX #8: block restoring a partially-used balance without an explicit
    // forceReset flag. Without this guard, an admin can inadvertently re-credit
    // a used balance (e.g. resetting from $20 → $50 when $30 was already spent).
    const amountUsed = peek.value - (peek.remainingBalance ?? peek.value);
    const wouldRestore = rb > (peek.remainingBalance ?? peek.value);
    if (wouldRestore && !req.body.forceReset) {
      return next(
        new HandleError(
          `This code has already used $${amountUsed.toFixed(2)} of its $${peek.value} balance. ` +
          `Setting remainingBalance to $${rb.toFixed(2)} would restore used balance. ` +
          `Pass forceReset: true to confirm this is intentional.`,
          400
        )
      );
    }

    updates.remainingBalance = rb;
  }

  if (updates.eligibleProductCategories !== undefined) {
    if (!Array.isArray(updates.eligibleProductCategories)) {
      return next(
        new HandleError("eligibleProductCategories must be an array of strings", 400)
      );
    }
    const catCheck = validateProductCategories(updates.eligibleProductCategories);
    if (!catCheck.valid) {
      return next(
        new HandleError(
          `Invalid product categories: ${catCheck.invalid.join(", ")}. ` +
          `Valid categories are: ${PRODUCT_CATEGORIES.join(", ")}`,
          400
        )
      );
    }

    if (updates.conditions !== undefined) {
      updates.conditions.eligibleProductCategories = updates.eligibleProductCategories;
    } else {
      updates["conditions.eligibleProductCategories"] = updates.eligibleProductCategories;
    }
    delete updates.eligibleProductCategories;
  }

  if (
    updates.conditions !== undefined &&
    updates.conditions.eligibleProductCategories !== undefined
  ) {
    const catCheck = validateProductCategories(updates.conditions.eligibleProductCategories);
    if (!catCheck.valid) {
      return next(
        new HandleError(
          `Invalid product categories in conditions: ${catCheck.invalid.join(", ")}. ` +
          `Valid categories are: ${PRODUCT_CATEGORIES.join(", ")}`,
          400
        )
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return next(new HandleError("No valid fields provided for update", 400));
  }

  if (updates.status === "active") {
    const now = new Date();
    let effectiveValidUntil;
    if (updates.validUntil) {
      effectiveValidUntil = new Date(updates.validUntil);
    } else {
      const peek = await Discount.findById(id).select("validUntil").lean();
      if (!peek) return next(new HandleError("Discount not found", 404));
      effectiveValidUntil = peek.validUntil;
    }
    if (effectiveValidUntil < now) {
      return next(
        new HandleError(
          "Cannot reactivate an expired discount. Extend validUntil first or include it in this request.",
          400
        )
      );
    }
  }

  const before = await Discount.findOneAndUpdate(
    { _id: id },
    { $set: updates },
    { new: false, runValidators: true }
  );

  if (!before) return next(new HandleError("Discount not found", 404));

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
      discountId:   before._id,
      discountCode: before.code,
      action:       "updated",
      performedBy:  auditActor(req.user),
      meta: {
        changedFields,
        before: beforeSnapshot,
        after:  afterSnapshot,
        ...(changedFields.includes("status") &&
          updates.status === "active" && { statusResurrected: true }),
        // FIX #8: flag forced balance restores in the audit trail
        ...(req.body.forceReset && changedFields.includes("remainingBalance") && {
          balanceForceReset: true,
          forceResetBy: req.user._id,
        }),
      },
    });
  }

  await invalidateStatsCache();

  const updated = await Discount.findById(before._id).lean();

  res.status(200).json({
    success: true,
    message: "Discount updated successfully",
    discount: updated,
  });
});

// ============================================
// ADMIN: DELETE DISCOUNT (soft)
// ============================================

export const deleteDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new HandleError("Invalid discount id", 400));
  }

  const discount = await Discount.findById(id);
  if (!discount) return next(new HandleError("Discount not found", 404));

  const now = new Date();

  if (
    discount.usageLimit.currentUses >= 1 &&
    discount.deletionEligibleAt &&
    discount.deletionEligibleAt > now
  ) {
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

  const previousStatus = discount.status;

  const result = await Discount.findOneAndUpdate(
    { _id: id, status: { $ne: "inactive" } },
    { $set: { status: "inactive" } },
    { new: false }
  );

  if (!result) {
    return res.status(200).json({
      success: true,
      message: "Discount was already inactive",
    });
  }

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

  await invalidateStatsCache();

  res.status(200).json({ success: true, message: "Discount deactivated successfully" });
});

// ============================================
// ADMIN: GET ALL DISCOUNTS (cursor-based pagination)
// ============================================

// FIX #9: added comment clarifying filter semantics — productCategory only
// matches codes that are *explicitly restricted* to that category.
// Unrestricted codes (eligibleProductCategories: []) that also apply to the
// category are excluded. The UI label should read "Restricted to category"
// rather than "Applies to category" to avoid operator confusion.
export const getAllDiscounts = handleAsyncError(async (req, res, next) => {
  const { status, category, type, search, cursor, productCategory } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const filter = {};
  if (status)   filter.status   = status;
  if (category) filter.category = category;
  if (type)     filter.type     = type;

  // NOTE (FIX #9): this filter returns only codes *restricted* to productCategory
  // (i.e. eligibleProductCategories contains that value). Unrestricted codes with
  // an empty eligibleProductCategories array that would also apply to the category
  // are intentionally excluded. The UI label should read "Restricted to category"
  // to make this semantics clear to admins.
  if (productCategory) {
    if (!PRODUCT_CATEGORIES.includes(productCategory)) {
      return next(
        new HandleError(
          `Invalid productCategory filter: "${productCategory}". ` +
          `Valid options are: ${PRODUCT_CATEGORIES.join(", ")}`,
          400
        )
      );
    }
    filter["conditions.eligibleProductCategories"] = productCategory;
  }

  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { code:        { $regex: safeSearch, $options: "i" } },
      { description: { $regex: safeSearch, $options: "i" } },
    ];
  }

  if (cursor) {
    try {
      const { id } = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      if (!isValidObjectId(id)) throw new Error("invalid id in cursor");
      filter._id = { $lt: new mongoose.Types.ObjectId(id) };
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
const USAGE_HISTORY_CAP = 100;

export const getDiscountById = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new HandleError("Invalid discount id", 400));
  }

  const discount = await Discount.findById(id)
    .populate("createdBy", "firstName lastName email")
    .populate("relatedOrder", "orderNumber totalPrice")
    .populate("relatedReturn", "returnInfo.rmaNumber returnInfo.status returnInfo.discountValue")
    .populate("usageHistory.user",  "firstName lastName email")
    .populate("usageHistory.order", "orderNumber");

  if (!discount) return next(new HandleError("Discount not found", 404));

  const total = discount.usageHistory.length;
  if (total > USAGE_HISTORY_CAP) {
    discount.usageHistory = discount.usageHistory.slice(-USAGE_HISTORY_CAP);
  }

  const discountObj = discount.toObject({ virtuals: true });
  discountObj.usageHistoryTotal  = total;
  discountObj.usageHistoryCapped = total > USAGE_HISTORY_CAP;

  res.status(200).json({ success: true, discount: discountObj });
});

// ============================================
// ADMIN: CREATE COMPENSATION DISCOUNT
// ============================================

// FIX #10: added comment noting the theoretical duplicate window that exists
// if the first discount was hard-deleted by the cleanup job before the duplicate
// check runs. The findOne({ relatedReturn }) guard disappears in that case.
// This is unlikely (cleanup only targets codes older than 90 days) but worth noting.
export const createCompensationDiscount = handleAsyncError(async (req, res, next) => {
  const {
    userId, amount, reason, category,
    validDays = 30, relatedOrder, relatedReturn,
  } = req.body;

  if (!userId || !category) {
    return next(new HandleError("Missing required fields: userId, category", 400));
  }

  if (!isValidObjectId(userId)) return next(new HandleError("Invalid userId", 400));
  if (relatedOrder && !isValidObjectId(relatedOrder)) {
    return next(new HandleError("Invalid relatedOrder id", 400));
  }
  if (relatedReturn && !isValidObjectId(relatedReturn)) {
    return next(new HandleError("Invalid relatedReturn id", 400));
  }

  const parsedDays = parseInt(validDays, 10);
  if (isNaN(parsedDays) || parsedDays <= 0 || parsedDays > 365) {
    return next(new HandleError("validDays must be a positive integer between 1 and 365", 400));
  }

  if (relatedReturn) {
    // FIX #10: this duplicate guard works correctly in the normal case.
    // THEORETICAL GAP: if the first discount was hard-deleted by the cleanup job
    // (deleteOldExpired) before this check runs, the guard disappears and a second
    // discount could be created for the same return. In practice this is extremely
    // unlikely because: (a) cleanup only targets codes older than 90 days, and
    // (b) compensation codes have a 30-day deletion protection window. No code fix
    // is warranted, but the dependency should be documented here for future maintainers.
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

  let finalAmount;

  if (relatedReturn) {
    const order = await Order.findById(relatedReturn)
      .select("returnInfo.status returnInfo.discountValue")
      .lean();

    if (!order) return next(new HandleError("Related return order not found", 404));

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
      finalAmount === undefined || finalAmount === null ||
      isNaN(Number(finalAmount)) || Number(finalAmount) <= 0
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
  validUntil.setDate(validUntil.getDate() + parsedDays);

  let discount;
  try {
    discount = await Discount.create({
      code,
      description:
        reason ||
        `Compensation discount for ${user.firstName}${relatedReturn ? " (return)" : ""}`,
      type:     "fixed",
      value:    finalAmount,
      category,
      audience: "specific",
      validUntil,
      usageLimit: { totalUses: 1, usesPerUser: 1 },
      conditions: {
        eligibleUsers:             [userId],
        minPurchaseAmount:         0,
        eligibleProductCategories: [],
      },
      notes: relatedReturn
        ? `Auto-generated from return ${relatedReturn}`
        : `Manual compensation — ${category}`,
      relatedOrder,
      relatedReturn,
      createdBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new HandleError("Code generation collision — please retry", 409));
    }
    return next(err);
  }

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

  await invalidateStatsCache();

  return res.status(201).json({
    success: true,
    message: "Compensation discount created successfully",
    discount,
  });
});

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE
// ============================================

// FIX #6: recordUsage() is NO LONGER called here. Usage is recorded only
// after a confirmed payment in verifyPaymentController. Calling it at
// /validate time caused discounts to be consumed on cart abandonment or
// payment failure with no reversal mechanism.
//
// FIX #7: syncDiscountAfterRedemption is also removed from this endpoint.
// Because validate could be called by the UI on input-blur without the user
// completing checkout, syncing here inflated redemption counts and generated
// premature analytics records.
export const validateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, cartTotal, items } = req.body;

  if (!code) return next(new HandleError("Discount code is required", 400));
  if (!cartTotal || cartTotal <= 0)
    return next(new HandleError("Invalid cart total", 400));

  const normalizedItems = Array.isArray(items) ? items : [];

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError("Invalid or expired discount code", 400));

  const userId = req.user?._id;

  if (discount.audience === "specific" && !userId) {
    return next(
      new HandleError("You must be logged in to use this discount code", 401)
    );
  }

  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));
  }

  const validation = discount.validateCart(cartTotal, normalizedItems, userId);
  if (!validation.valid) return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(cartTotal, normalizedItems);

  const eligibleCats = discount.conditions?.eligibleProductCategories ?? [];

  const eligibleSubtotal =
    eligibleCats.length > 0 && normalizedItems.length > 0
      ? Math.round(
          normalizedItems
            .filter((item) => item?.category && eligibleCats.includes(item.category))
            .reduce((sum, item) => {
              const price = Number(item.price) || 0;
              const qty   = Number(item.quantity) || 1;
              return sum + price * qty;
            }, 0) * 100
        ) / 100
      : Math.round(cartTotal * 100) / 100;

  const ineligibleSubtotal = Math.round((cartTotal - eligibleSubtotal) * 100) / 100;

  // FIX #6/#7: recordUsage() and syncDiscountAfterRedemption() removed.
  // No side-effects at validation time — this is now a pure read + compute.
  // Usage is recorded in verifyPaymentController after payment succeeds.

  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "validated",
    performedBy:  userId
      ? {
          _id:       userId,
          firstName: req.user?.firstName ?? null,
          lastName:  req.user?.lastName  ?? null,
          email:     req.user?.email     ?? null,
          system:    false,
        }
      : { system: true },
    meta: {
      userId:        userId ?? null,
      discountAmount,
      cartTotal,
      itemCategories: normalizedItems
        .map((i) => i?.category)
        .filter(Boolean)
        .filter((v, idx, arr) => arr.indexOf(v) === idx),
    },
  });

  res.status(200).json({
    success: true,
    valid:   true,
    discount: {
      code:                      discount.code,
      type:                      discount.type,
      value:                     discount.value,
      discountAmount,
      description:               discount.description,
      eligibleProductCategories: eligibleCats,
      eligibleSubtotal,
      ineligibleSubtotal,
      remainingBalance: eligibleCats.length === 0
        ? discount.remainingBalance
        : null,
      isPartialAllowed: discount.isPartialAllowed,
    },
  });
});

// ============================================
// PUBLIC: GET ACTIVE PROMOS
// ============================================

export const getActivePromos = handleAsyncError(async (req, res, next) => {
  const promos = await Discount.getActivePromos();
  res.status(200).json({ success: true, promos });
});

// ============================================
// USER: GET MY DISCOUNTS
// ============================================

export const getMyDiscounts = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const now = new Date();

  const [broadcastDiscounts, personalDiscounts] = await Promise.all([
    Discount.find({
      audience:   "all",
      status:     "active",
      validFrom:  { $lte: now },
      validUntil: { $gte: now },
    })
      .select(
        "code description type value category audience status validUntil " +
        "conditions.minPurchaseAmount conditions.maxDiscountAmount " +
        "conditions.firstOrderOnly conditions.eligibleProductCategories " +
        "usageLimit.currentUses usageLimit.totalUses remainingBalance"
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
        "code description type value category audience status validUntil " +
        "conditions.minPurchaseAmount conditions.firstOrderOnly " +
        "conditions.eligibleProductCategories " +
        "usageLimit.currentUses usageLimit.totalUses remainingBalance"
      )
      .lean(),
  ]);

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
// ============================================

export const hasNewDiscounts = handleAsyncError(async (req, res, next) => {
  const user = req.user;
  const now  = new Date();

  const since = user.lastSeenDiscountsAt ?? user.createdAt ?? now;
  const sinceFilter = { createdAt: { $gt: since } };

  const [newestBroadcast, newestPersonal] = await Promise.all([
    Discount.findOne({
      audience:   "all",
      status:     "active",
      validFrom:  { $lte: now },
      validUntil: { $gte: now },
      ...sinceFilter,
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),

    Discount.findOne({
      audience:                   "specific",
      status:                     "active",
      validFrom:                  { $lte: now },
      validUntil:                 { $gte: now },
      "conditions.eligibleUsers": user._id,
      ...sinceFilter,
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
  ]);

  const hasNew = !!(newestBroadcast || newestPersonal);

  res.status(200).json({ hasNew });
});

// ============================================
// ADMIN: GET DISCOUNT STATS
// ============================================
const STATS_CACHE_KEY = "discount:stats";
const STATS_CACHE_TTL = 60;

export const getDiscountStats = handleAsyncError(async (req, res, next) => {
  try {
    const cached = await redis.get(STATS_CACHE_KEY);
    if (cached) {
      return res.status(200).json({ success: true, ...JSON.parse(cached), fromCache: true });
    }
  } catch {
    // Redis unavailable — fall through to DB aggregation.
  }

  const now = new Date();

  const [stats, overall] = await Promise.all([
    Discount.aggregate([
      {
        $group: {
          _id: "$category",
          totalDiscounts: { $sum: 1 },
          activeDiscounts: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$status", "active"] }, { $gte: ["$validUntil", now] }] },
                1, 0,
              ],
            },
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
          _id: null,
          total:     { $sum: 1 },
          active: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$status", "active"] }, { $gte: ["$validUntil", now] }] },
                1, 0,
              ],
            },
          },
          inactive:    { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
          expired: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$status", "expired"] },
                    { $and: [{ $eq: ["$status", "active"] }, { $lt: ["$validUntil", now] }] },
                  ],
                },
                1, 0,
              ],
            },
          },
          totalUses:   { $sum: "$usageLimit.currentUses" },
          vip:         { $sum: { $cond: [{ $eq: ["$audience", "specific"] }, 1, 0] } },
          blackfriday: { $sum: { $cond: [{ $eq: ["$category", "blackfriday"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const payload = {
    stats,
    overall: overall[0] || {
      total: 0, active: 0, inactive: 0, expired: 0,
      totalUses: 0, vip: 0, blackfriday: 0,
    },
  };

  try {
    await redis.set(STATS_CACHE_KEY, JSON.stringify(payload), { EX: STATS_CACHE_TTL });
  } catch {
    // Redis unavailable — response still sent, just not cached.
  }

  res.status(200).json({ success: true, ...payload });
});

// ============================================
// ADMIN: TRIGGER MANUAL CLEANUP
// ============================================

export const triggerCleanup = handleAsyncError(async (req, res, next) => {
  const { daysOld = 90 } = req.body;

  await DiscountAuditLog.log({
    discountId:   new mongoose.Types.ObjectId("000000000000000000000000"),
    discountCode: "SYSTEM",
    action:       "manual_cleanup",
    performedBy:  auditActor(req.user),
    meta: {
      triggeredBy: req.user._id,
      daysOld,
      triggeredAt: new Date().toISOString(),
    },
  });

  const [expiredCount, deleteResult] = await Promise.all([
    Discount.bulkExpireStale(),
    Discount.deleteOldExpired(daysOld),
  ]);

  await invalidateStatsCache();

  res.status(200).json({
    success: true,
    message: "Cleanup complete",
    expired: expiredCount,
    deleted: deleteResult.totalDeleted,
  });
});

// ============================================
// ADMIN: GET FULL AUDIT LOG (paginated)
// ============================================

export const getAuditLog = handleAsyncError(async (req, res, next) => {
  const {
    action, discountCode, performedById,
    dateFrom, dateTo, cursor,
  } = req.query;

  if (performedById && !isValidObjectId(performedById)) {
    return next(new HandleError("Invalid performedById", 400));
  }

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const { logs, hasNextPage, nextCursor } = await DiscountAuditLog.getPaginated({
    action, discountCode, performedById, dateFrom, dateTo, cursor, limit,
  });

  res.status(200).json({
    success: true,
    auditLogs: logs,
    pagination: { limit, hasNextPage, nextCursor },
  });
});

// ============================================
// ADMIN: GET AUDIT LOG FOR SINGLE DISCOUNT
// ============================================

export const getDiscountAuditLog = handleAsyncError(async (req, res, next) => {
  const { discountId } = req.params;

  if (!isValidObjectId(discountId)) {
    return next(new HandleError("Invalid discountId", 400));
  }

  const logs = await DiscountAuditLog.getForDiscount(discountId, 20);

  res.status(200).json({ success: true, auditLogs: logs });
});

// ============================================
// ADMIN: CREATE VIP / TARGETED USER DISCOUNT
// ============================================

const MAX_ELIGIBLE_USERS = 500;

export const createDiscountForUsers = handleAsyncError(async (req, res, next) => {
  const {
    userIds      = [],
    emails       = [],
    code,
    description,
    type,
    value,
    category,
    validUntil,
    validDays,
    validFrom,
    usesPerUser  = 1,
    totalUses,
    minPurchaseAmount    = 0,
    firstOrderOnly       = false,
    excludeSaleItems     = false,
    notes,
    audience,
    eligibleProductCategories,
  } = req.body;

  if (audience === "all") {
    return next(
      new HandleError(
        "audience:'all' is not permitted on this route. " +
        "Use POST /api/v1/discounts for broadcast promotions.",
        400
      )
    );
  }

  if (!description || !type || value === undefined || value === null || !category) {
    return next(new HandleError("Missing required fields: description, type, value, category", 400));
  }

  if (!["percentage", "fixed"].includes(type)) {
    return next(new HandleError("type must be 'percentage' or 'fixed'", 400));
  }

  const numericValue = Number(value);
  if (isNaN(numericValue) || numericValue <= 0) {
    return next(new HandleError("value must be a positive number", 400));
  }
  if (type === "percentage" && numericValue > 100) {
    return next(new HandleError("Percentage discount value cannot exceed 100", 400));
  }

  const hasUserIds = Array.isArray(userIds) && userIds.length > 0;
  const hasEmails  = Array.isArray(emails)  && emails.length  > 0;
  if (!hasUserIds && !hasEmails) {
    return next(
      new HandleError(
        "At least one target user is required. Provide userIds, emails, or both.",
        400
      )
    );
  }

  const parsedUsesPerUser = parseInt(usesPerUser, 10);
  if (isNaN(parsedUsesPerUser) || parsedUsesPerUser < 1) {
    return next(new HandleError("usesPerUser must be a positive integer", 400));
  }

  let parsedTotalUses = null;
  if (totalUses !== undefined && totalUses !== null) {
    parsedTotalUses = parseInt(totalUses, 10);
    if (isNaN(parsedTotalUses) || parsedTotalUses < 1) {
      return next(new HandleError("totalUses must be a positive integer when provided", 400));
    }
  }

  let resolvedValidUntil;
  if (validUntil) {
    resolvedValidUntil = new Date(validUntil);
    if (isNaN(resolvedValidUntil.getTime())) {
      return next(new HandleError("validUntil is not a valid date", 400));
    }
    if (resolvedValidUntil <= new Date()) {
      return next(new HandleError("validUntil must be a future date", 400));
    }
  } else if (validDays !== undefined) {
    const parsedDays = parseInt(validDays, 10);
    if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > 365) {
      return next(new HandleError("validDays must be a positive integer between 1 and 365", 400));
    }
    resolvedValidUntil = new Date();
    resolvedValidUntil.setDate(resolvedValidUntil.getDate() + parsedDays);
  } else {
    return next(new HandleError("Either validUntil or validDays is required", 400));
  }

  let resolvedEligibleProductCategories = [];
  if (eligibleProductCategories !== undefined && eligibleProductCategories !== null) {
    if (!Array.isArray(eligibleProductCategories)) {
      return next(new HandleError("eligibleProductCategories must be an array of strings", 400));
    }
    const catCheck = validateProductCategories(eligibleProductCategories);
    if (!catCheck.valid) {
      return next(
        new HandleError(
          `Invalid product categories: ${catCheck.invalid.join(", ")}. ` +
          `Valid categories are: ${PRODUCT_CATEGORIES.join(", ")}`,
          400
        )
      );
    }
    resolvedEligibleProductCategories = eligibleProductCategories;
  }

  if (hasUserIds) {
    const invalidIds = userIds.filter((id) => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return next(
        new HandleError(`Invalid ObjectId format in userIds: ${invalidIds.join(", ")}`, 400)
      );
    }
  }

  let emailIds = [];
  if (hasEmails) {
    const foundByEmail = await User.find({ email: { $in: emails } }).select("_id email").lean();
    const resolvedEmailMap = new Map(foundByEmail.map((u) => [u.email.toLowerCase(), u._id]));
    const unresolvedEmails = emails.filter((e) => !resolvedEmailMap.has(e.toLowerCase()));
    if (unresolvedEmails.length > 0) {
      return next(
        new HandleError(
          `The following emails do not match any user account: ${unresolvedEmails.join(", ")}`,
          400
        )
      );
    }
    emailIds = foundByEmail.map((u) => u._id);
  }

  const rawIdStrings   = hasUserIds ? userIds.map((id) => id.toString()) : [];
  const emailIdStrings = emailIds.map((id) => id.toString());
  const uniqueIdStrings = [...new Set([...rawIdStrings, ...emailIdStrings])];
  const mergedIds = uniqueIdStrings.map((s) => new mongoose.Types.ObjectId(s));

  if (mergedIds.length === 0) {
    return next(new HandleError("No valid target users after deduplication", 400));
  }
  if (mergedIds.length > MAX_ELIGIBLE_USERS) {
    return next(
      new HandleError(
        `Maximum ${MAX_ELIGIBLE_USERS} eligible users per discount code. ` +
        `${mergedIds.length} provided after deduplication.`,
        400
      )
    );
  }

  const foundUsers = await User.find({ _id: { $in: mergedIds } }).select("_id").lean();
  if (foundUsers.length !== mergedIds.length) {
    const foundSet   = new Set(foundUsers.map((u) => u._id.toString()));
    const missingIds = mergedIds
      .filter((id) => !foundSet.has(id.toString()))
      .map((id) => id.toString());
    return next(
      new HandleError(`The following userIds do not exist: ${missingIds.join(", ")}`, 400)
    );
  }

  let resolvedCode;
  if (code) {
    resolvedCode = code.toUpperCase();
    const existing = await Discount.findOne({ code: resolvedCode }).lean();
    if (existing) return next(new HandleError("Discount code already exists", 400));
  } else {
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    resolvedCode = `${category.toUpperCase()}-VIP-${suffix}`;
  }

  let discount;
  try {
    discount = await Discount.create({
      code:        resolvedCode,
      description,
      type,
      value:       numericValue,
      category,
      audience:    "specific",
      validFrom:   validFrom ? new Date(validFrom) : new Date(),
      validUntil:  resolvedValidUntil,
      usageLimit: { totalUses: parsedTotalUses, usesPerUser: parsedUsesPerUser },
      conditions: {
        eligibleUsers:             mergedIds,
        minPurchaseAmount:         Number(minPurchaseAmount) || 0,
        firstOrderOnly:            Boolean(firstOrderOnly),
        excludeSaleItems:          Boolean(excludeSaleItems),
        eligibleProductCategories: resolvedEligibleProductCategories,
      },
      notes,
      createdBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) return next(new HandleError("Discount code already exists", 400));
    return next(err);
  }

  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "created",
    performedBy:  auditActor(req.user),
    meta: {
      audience:                  "specific",
      vipDiscount:               true,
      type, value: numericValue, category,
      validUntil:                resolvedValidUntil,
      eligibleUsers:             mergedIds,
      eligibleCount:             mergedIds.length,
      usesPerUser:               parsedUsesPerUser,
      totalUses:                 parsedTotalUses,
      autoGeneratedCode:         !code,
      eligibleProductCategories: resolvedEligibleProductCategories,
    },
  });

  await invalidateStatsCache();

  return res.status(201).json({
    success:           true,
    message:           "VIP discount created successfully",
    discount,
    eligibleUserCount: mergedIds.length,
  });
});

// ============================================
// ADMIN: GET PURGE LOG
// ============================================

export const getPurgeLog = handleAsyncError(async (req, res, next) => {
  const [purgeLog, latestPurge] = await Promise.all([
    AuditPurgeLog.getAll(),
    AuditPurgeLog.getLatest(),
  ]);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const showBanner =
    latestPurge !== null && new Date(latestPurge.purgedAt) > sevenDaysAgo;

  res.status(200).json({ success: true, purgeLog, latestPurge, showBanner });
});