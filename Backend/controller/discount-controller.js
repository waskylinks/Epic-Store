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

// ============================================
// HELPERS
// ============================================

/**
 * Builds a clean performedBy snapshot from req.user.
 * Called by every controller that writes an audit entry.
 */
const auditActor = (user) => ({
  _id:       user._id,
  firstName: user.firstName ?? null,
  lastName:  user.lastName  ?? null,
  email:     user.email     ?? null,
  system:    false,
});

/**
 * Escapes a string for safe use inside a MongoDB $regex query.
 * Prevents ReDoS attacks via user-controlled search parameters.
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns true only when s is a valid 24-hex-char MongoDB ObjectId string.
 */
const isValidObjectId = (s) => mongoose.Types.ObjectId.isValid(s);

/**
 * Validates an array of product category strings against the canonical list.
 * Returns { valid: true } or { valid: false, invalid: [...] }.
 *
 * NEW — used by createDiscount and createDiscountForUsers to guard
 * eligibleProductCategories before any DB write.
 */
const validateProductCategories = (cats) => {
  if (!Array.isArray(cats) || cats.length === 0) {
    return { valid: true, invalid: [] };
  }
  const invalid = cats.filter((c) => !PRODUCT_CATEGORIES.includes(c));
  return { valid: invalid.length === 0, invalid };
};

/**
 * Invalidates the stats cache so the next getDiscountStats call re-aggregates.
 * Called by any controller that mutates the discount collection.
 */
const invalidateStatsCache = async () => {
  try {
    await redis.del("discount:stats");
  } catch {
    // Redis failure must never block a discount write — swallow silently.
  }
};

// ============================================
// ADMIN: CREATE DISCOUNT
// ============================================

/**
 * @route POST /api/v1/discounts
 * @access Admin
 *
 * NEW field accepted in request body:
 *   eligibleProductCategories {String[]} — optional; restricts the discount
 *     to carts that contain at least one item from the listed product
 *     categories. Must be a subset of the canonical PRODUCT_CATEGORIES list.
 *     Omit (or pass []) for no category restriction.
 */
export const createDiscount = handleAsyncError(async (req, res, next) => {
  const {
    code, description, type, value, category,
    audience,
    validFrom, validUntil, usageLimit, conditions, notes,
    relatedOrder, relatedReturn,
    eligibleProductCategories,   // NEW
  } = req.body;

  if (!code || !description || !type || !value || !category || !validUntil) {
    return next(new HandleError("Missing required fields", 400));
  }

  // Validate optional ObjectId fields before any DB call
  if (relatedOrder && !isValidObjectId(relatedOrder)) {
    return next(new HandleError("Invalid relatedOrder id", 400));
  }
  if (relatedReturn && !isValidObjectId(relatedReturn)) {
    return next(new HandleError("Invalid relatedReturn id", 400));
  }

  // NEW — validate product category restriction if supplied
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

  // Pre-flight uniqueness check — still useful as an early 400, but we no longer
  // rely on it as the sole guard (race condition handled by try/catch below).
  const existingDiscount = await Discount.findOne({
    code: code.toUpperCase(),
  }).lean();
  if (existingDiscount) {
    return next(new HandleError("Discount code already exists", 400));
  }

  // Merge incoming conditions with the new eligibleProductCategories so
  // other condition fields (e.g. minPurchaseAmount from `conditions`) are
  // preserved.  eligibleProductCategories is hoisted to the top level of
  // req.body to keep the API surface explicit and avoid deeply nested input.
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
      type,
      value,
      category,
      validUntil,
      relatedReturn:  relatedReturn  ?? null,
      relatedOrder:   relatedOrder   ?? null,
      // NEW — log which product categories are restricted (empty = unrestricted)
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

/**
 * @route PUT /api/v1/discounts/:id
 * @access Admin
 *
 * NEW: 'eligibleProductCategories' is now an allowed update field.
 * Pass [] to remove a product-category restriction.
 * Pass a valid subset of PRODUCT_CATEGORIES to set or change it.
 */
export const updateDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new HandleError("Invalid discount id", 400));
  }

  const allowedUpdates = [
    "description", "status", "validFrom", "validUntil",
    "usageLimit", "conditions", "notes",
    "eligibleProductCategories",   // NEW top-level alias
  ];

  const updates = {};
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  // NEW — eligibleProductCategories handling.
  //
  // Admins may supply it in two ways:
  //   A) Top-level key:  { eligibleProductCategories: [...] }
  //   B) Inside conditions object: { conditions: { eligibleProductCategories: [...] } }
  //
  // CRITICAL PATH-COLLISION FIX:
  //   MongoDB's $set operator rejects a document that contains BOTH a dotted path
  //   ('conditions.eligibleProductCategories') AND its parent object ('conditions')
  //   in the same operation:
  //     MongoServerError: Updating the path 'conditions' would create a conflict
  //     at 'conditions.eligibleProductCategories'
  //
  //   Resolution strategy:
  //   - If top-level alias is supplied AND conditions object is also supplied,
  //     merge eligibleProductCategories into the conditions object and use $set
  //     on 'conditions' only (no dotted-path key).
  //   - If only the top-level alias is supplied (no conditions object), use the
  //     dotted path 'conditions.eligibleProductCategories' for a surgical update.
  //   - If only conditions object is supplied, validate the nested value if present.
  //   Either way, delete the top-level 'eligibleProductCategories' key so it never
  //   reaches the $set call.

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
      // Both supplied — merge into the conditions object to avoid path collision.
      updates.conditions.eligibleProductCategories = updates.eligibleProductCategories;
    } else {
      // Only top-level alias supplied — use dotted path for surgical $set.
      updates["conditions.eligibleProductCategories"] = updates.eligibleProductCategories;
    }
    // Remove the top-level key regardless — it must never reach $set directly.
    delete updates.eligibleProductCategories;
  }

  // If conditions object is supplied (with or without the top-level alias),
  // validate eligibleProductCategories within it if present.
  if (
    updates.conditions !== undefined &&
    updates.conditions.eligibleProductCategories !== undefined
  ) {
    const catCheck = validateProductCategories(
      updates.conditions.eligibleProductCategories
    );
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

  // Guard against resurrecting a genuinely expired discount.
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

  // Atomic update — pre-image captured, no TOCTOU race.
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

/**
 * @route DELETE /api/v1/discounts/:id
 * @access Admin
 */
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

/**
 * @route GET /api/v1/discounts
 * @access Admin
 *
 * NEW query param:
 *   productCategory {String} — filter discounts that include a specific
 *     product category in their eligibleProductCategories restriction.
 */
export const getAllDiscounts = handleAsyncError(async (req, res, next) => {
  const { status, category, type, search, cursor, productCategory } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const filter = {};
  if (status)   filter.status   = status;
  if (category) filter.category = category;
  if (type)     filter.type     = type;

  // NEW — filter by product category restriction
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
      const { id } = JSON.parse(
        Buffer.from(cursor, "base64").toString("utf8")
      );
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

/**
 * @route GET /api/v1/discounts/:id
 * @access Admin
 */
export const getDiscountById = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new HandleError("Invalid discount id", 400));
  }

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

  const total = discount.usageHistory.length;
  if (total > USAGE_HISTORY_CAP) {
    discount.usageHistory = discount.usageHistory.slice(-USAGE_HISTORY_CAP);
  }

  const discountObj = discount.toObject({ virtuals: true });
  discountObj.usageHistoryTotal   = total;
  discountObj.usageHistoryCapped  = total > USAGE_HISTORY_CAP;

  res.status(200).json({ success: true, discount: discountObj });
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

  if (!isValidObjectId(userId)) {
    return next(new HandleError("Invalid userId", 400));
  }
  if (relatedOrder && !isValidObjectId(relatedOrder)) {
    return next(new HandleError("Invalid relatedOrder id", 400));
  }
  if (relatedReturn && !isValidObjectId(relatedReturn)) {
    return next(new HandleError("Invalid relatedReturn id", 400));
  }

  const parsedDays = parseInt(validDays, 10);
  if (isNaN(parsedDays) || parsedDays <= 0 || parsedDays > 365) {
    return next(
      new HandleError("validDays must be a positive integer between 1 and 365", 400)
    );
  }

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
      usageLimit: {
        totalUses:   1,
        usesPerUser: 1,
      },
      conditions: {
        eligibleUsers:              [userId],
        minPurchaseAmount:          0,
        // Compensation discounts are never category-restricted —
        // they compensate the user for a specific loss and should
        // be usable on any purchase.
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
      return next(
        new HandleError("Code generation collision — please retry", 409)
      );
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

/**
 * @route POST /api/v1/discounts/validate
 * @access Public
 *
 * NEW: items[] is now required for category-restricted discount codes.
 * Each item must have the shape: { category: String, price: Number, quantity: Number }
 *
 * For unrestricted codes, items[] remains optional (pass [] or omit entirely).
 */
export const validateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, cartTotal, items } = req.body;

  if (!code) return next(new HandleError("Discount code is required", 400));
  if (!cartTotal || cartTotal <= 0)
    return next(new HandleError("Invalid cart total", 400));

  // Normalise items to an array regardless of what the caller sends.
  // validateCart() and calculateDiscount() both default to [] when items is
  // absent, so this normalisation ensures consistent behaviour and prevents
  // a non-array from being forwarded to those methods.
  const normalizedItems = Array.isArray(items) ? items : [];

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError("Invalid or expired discount code", 400));

  const userId = req.user?._id;

  if (discount.audience === "specific" && !userId) {
    return next(
      new HandleError(
        "You must be logged in to use this discount code",
        401
      )
    );
  }

  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse)
      return next(new HandleError(canUse.reason, 400));
  }

  const validation = discount.validateCart(cartTotal, normalizedItems, userId);
  if (!validation.valid)
    return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(cartTotal, normalizedItems);

  // ── NEW: compute eligibleSubtotal / ineligibleSubtotal ───────────────────
  // Mirrors the same calculation in cart-controller applyDiscountCode.
  // When eligibleProductCategories is set, eligibleSubtotal is the sum of
  // only the qualifying items — the actual base the percentage was applied to.
  // For unrestricted codes it equals cartTotal (entire cart qualified).
  const eligibleCats = discount.conditions?.eligibleProductCategories ?? [];

  const eligibleSubtotal = eligibleCats.length > 0 && normalizedItems.length > 0
    ? Math.round(
        normalizedItems
          .filter(
            (item) =>
              item?.category &&
              eligibleCats.includes(item.category)
          )
          .reduce((sum, item) => {
            const price = Number(item.price) || 0;
            const qty   = Number(item.quantity) || 1;
            return sum + price * qty;
          }, 0)
        * 100
      ) / 100
    : Math.round(cartTotal * 100) / 100;

  const ineligibleSubtotal = Math.round((cartTotal - eligibleSubtotal) * 100) / 100;
  // ─────────────────────────────────────────────────────────────────────────

  const { isFirstUse } = await discount.recordUsage(
    userId ?? null,
    null,
    discountAmount
  );

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
      orderId:       null,
      discountAmount,
      cartTotal,
      isFirstUse,
      itemCategories: normalizedItems
        .map((i) => i?.category)
        .filter(Boolean)
        .filter((v, idx, arr) => arr.indexOf(v) === idx),
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
      eligibleProductCategories: eligibleCats,
      eligibleSubtotal,
      ineligibleSubtotal,
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
// ============================================

/**
 * @route GET /api/v1/discounts/my-discounts
 * @access Private
 */
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
        "code description type value category audience validUntil " +
        "conditions.minPurchaseAmount conditions.maxDiscountAmount " +
        "conditions.firstOrderOnly conditions.eligibleProductCategories " +
        "usageLimit.currentUses usageLimit.totalUses"
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
        "conditions.eligibleProductCategories " +
        "usageLimit.currentUses usageLimit.totalUses"
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

/**
 * @route GET /api/v1/discounts/has-new
 * @access Private
 */
export const hasNewDiscounts = handleAsyncError(async (req, res, next) => {
  const user = req.user;
  const now  = new Date();
 
  // FIX 2: fall back to user.createdAt instead of {} so a brand-new user
  // doesn't see a dot for every discount that predates their account.
  const since = user.lastSeenDiscountsAt ?? user.createdAt ?? now;
  const sinceFilter = { createdAt: { $gt: since } };
 
  const [newestBroadcast, newestPersonal] = await Promise.all([
    Discount.findOne({
      audience:   "all",
      status:     "active",
      validFrom:  { $lte: now },   // FIX 1: must already be active
      validUntil: { $gte: now },
      ...sinceFilter,
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
 
    Discount.findOne({
      audience:                   "specific",
      status:                     "active",
      validFrom:                  { $lte: now },   // FIX 1: must already be active
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
const STATS_CACHE_TTL = 60; // seconds

/**
 * @route GET /api/v1/discounts/stats
 * @access Admin
 */
export const getDiscountStats = handleAsyncError(async (req, res, next) => {
  try {
    const cached = await redis.get(STATS_CACHE_KEY);
    if (cached) {
      return res.status(200).json({ success: true, ...JSON.parse(cached), fromCache: true });
    }
  } catch {
    // Redis unavailable — fall through to DB aggregation.
  }

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
          _id:       null,
          total:     { $sum: 1 },
          active:    { $sum: { $cond: [{ $eq: ["$status", "active"]   }, 1, 0] } },
          inactive:  { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
          expired:   { $sum: { $cond: [{ $eq: ["$status", "expired"]  }, 1, 0] } },
          totalUses: { $sum: "$usageLimit.currentUses" },
        },
      },
    ]),
  ]);

  const payload = {
    stats,
    overall: overall[0] || { total: 0, active: 0, inactive: 0, expired: 0, totalUses: 0 },
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

/**
 * @route POST /api/v1/discounts/cleanup
 * @access Admin
 */
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

  const [expired, deleted] = await Promise.all([
    Discount.bulkExpireStale(),
    Discount.deleteOldExpired(daysOld),
  ]);

  await invalidateStatsCache();

  res.status(200).json({
    success: true,
    message: "Cleanup complete",
    expired,
    deleted,
  });
});

// ============================================
// ADMIN: GET FULL AUDIT LOG (paginated)
// ============================================

/**
 * @route GET /api/v1/discounts/audit
 * @access Admin
 */
export const getAuditLog = handleAsyncError(async (req, res, next) => {
  const {
    action, discountCode, performedById,
    dateFrom, dateTo, cursor,
  } = req.query;

  if (performedById && !isValidObjectId(performedById)) {
    return next(new HandleError("Invalid performedById", 400));
  }

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
// ============================================

/**
 * @route GET /api/v1/discounts/audit/:discountId
 * @access Admin
 */
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

/**
 * @route POST /api/v1/discounts/create-for-user
 * @access Admin
 *
 * NEW field accepted in request body:
 *   eligibleProductCategories {String[]} — optional; restricts the discount
 *     to carts that contain at least one item from the listed product
 *     categories. Must be a subset of PRODUCT_CATEGORIES.
 *     Omit (or pass []) for no category restriction.
 */
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
    eligibleProductCategories,   // NEW
  } = req.body;

  // ── Step 1: Basic field validation ────────────────────────────────────────

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
    return next(
      new HandleError(
        "Missing required fields: description, type, value, category",
        400
      )
    );
  }

  if (!["percentage", "fixed"].includes(type)) {
    return next(new HandleError("type must be 'percentage' or 'fixed'", 400));
  }

  const numericValue = Number(value);
  if (isNaN(numericValue) || numericValue <= 0) {
    return next(new HandleError("value must be a positive number", 400));
  }
  if (type === "percentage" && numericValue > 100) {
    return next(
      new HandleError("Percentage discount value cannot exceed 100", 400)
    );
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

  // ── Step 2: usesPerUser validation ────────────────────────────────────────
  const parsedUsesPerUser = parseInt(usesPerUser, 10);
  if (isNaN(parsedUsesPerUser) || parsedUsesPerUser < 1) {
    return next(
      new HandleError("usesPerUser must be a positive integer", 400)
    );
  }

  // ── Step 3: totalUses validation ──────────────────────────────────────────
  let parsedTotalUses = null;
  if (totalUses !== undefined && totalUses !== null) {
    parsedTotalUses = parseInt(totalUses, 10);
    if (isNaN(parsedTotalUses) || parsedTotalUses < 1) {
      return next(
        new HandleError("totalUses must be a positive integer when provided", 400)
      );
    }
  }

  // ── Step 4: validUntil / validDays resolution ─────────────────────────────
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
      return next(
        new HandleError(
          "validDays must be a positive integer between 1 and 365",
          400
        )
      );
    }
    resolvedValidUntil = new Date();
    resolvedValidUntil.setDate(resolvedValidUntil.getDate() + parsedDays);
  } else {
    return next(
      new HandleError(
        "Either validUntil or validDays is required",
        400
      )
    );
  }

  // ── Step 4b: eligibleProductCategories validation (NEW) ───────────────────
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

  // ── Step 5: ObjectId format validation on raw userIds ─────────────────────
  if (hasUserIds) {
    const invalidIds = userIds.filter((id) => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return next(
        new HandleError(
          `Invalid ObjectId format in userIds: ${invalidIds.join(", ")}`,
          400
        )
      );
    }
  }

  // ── Step 6: Email → ObjectId resolution ───────────────────────────────────
  let emailIds = [];

  if (hasEmails) {
    const foundByEmail = await User.find({ email: { $in: emails } })
      .select("_id email")
      .lean();

    const resolvedEmailMap = new Map(
      foundByEmail.map((u) => [u.email.toLowerCase(), u._id])
    );

    const unresolvedEmails = emails.filter(
      (e) => !resolvedEmailMap.has(e.toLowerCase())
    );
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

  // ── Step 7: Merge + deduplicate ───────────────────────────────────────────
  const rawIdStrings   = hasUserIds ? userIds.map((id) => id.toString()) : [];
  const emailIdStrings = emailIds.map((id) => id.toString());

  const uniqueIdStrings = [...new Set([...rawIdStrings, ...emailIdStrings])];
  const mergedIds = uniqueIdStrings.map(
    (s) => new mongoose.Types.ObjectId(s)
  );

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

  // ── Step 8: DB existence validation for all merged ids ───────────────────
  const foundUsers = await User.find({ _id: { $in: mergedIds } })
    .select("_id")
    .lean();

  if (foundUsers.length !== mergedIds.length) {
    const foundSet   = new Set(foundUsers.map((u) => u._id.toString()));
    const missingIds = mergedIds
      .filter((id) => !foundSet.has(id.toString()))
      .map((id) => id.toString());

    return next(
      new HandleError(
        `The following userIds do not exist: ${missingIds.join(", ")}`,
        400
      )
    );
  }

  // ── Step 9: Code resolution ───────────────────────────────────────────────
  let resolvedCode;

  if (code) {
    resolvedCode = code.toUpperCase();
    const existing = await Discount.findOne({ code: resolvedCode }).lean();
    if (existing) {
      return next(new HandleError("Discount code already exists", 400));
    }
  } else {
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    resolvedCode = `${category.toUpperCase()}-VIP-${suffix}`;
  }

  // ── Step 10: Create the discount ─────────────────────────────────────────
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
      usageLimit: {
        totalUses:   parsedTotalUses,
        usesPerUser: parsedUsesPerUser,
      },
      conditions: {
        eligibleUsers:             mergedIds,
        minPurchaseAmount:         Number(minPurchaseAmount) || 0,
        firstOrderOnly:            Boolean(firstOrderOnly),
        excludeSaleItems:          Boolean(excludeSaleItems),
        eligibleProductCategories: resolvedEligibleProductCategories,  // NEW
      },
      notes,
      createdBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new HandleError("Discount code already exists", 400));
    }
    return next(err);
  }

  // ── Step 11: Audit entry ──────────────────────────────────────────────────
  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "created",
    performedBy:  auditActor(req.user),
    meta: {
      audience:                  "specific",
      vipDiscount:               true,
      type,
      value:                     numericValue,
      category,
      validUntil:                resolvedValidUntil,
      eligibleUsers:             mergedIds,
      eligibleCount:             mergedIds.length,
      usesPerUser:               parsedUsesPerUser,
      totalUses:                 parsedTotalUses,
      autoGeneratedCode:         !code,
      // NEW — log category restriction in audit trail
      eligibleProductCategories: resolvedEligibleProductCategories,
    },
  });

  // ── Step 12: Cache invalidation ───────────────────────────────────────────
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

/**
 * @route GET /api/v1/discounts/audit/purge-log
 * @access Admin
 */
export const getPurgeLog = handleAsyncError(async (req, res, next) => {
  const [purgeLog, latestPurge] = await Promise.all([
    AuditPurgeLog.getAll(),
    AuditPurgeLog.getLatest(),
  ]);

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