import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Discount from "../models/discount-model.js";
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
 * FIX #9
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns true only when s is a valid 24-hex-char MongoDB ObjectId string.
 * FIX #8, #20
 */
const isValidObjectId = (s) => mongoose.Types.ObjectId.isValid(s);

/**
 * Invalidates the stats cache so the next getDiscountStats call re-aggregates.
 * Called by any controller that mutates the discount collection.
 * FIX #13 (cache-invalidation side)
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

  // FIX #8 — validate optional ObjectId fields before any DB call
  if (relatedOrder && !isValidObjectId(relatedOrder)) {
    return next(new HandleError("Invalid relatedOrder id", 400));
  }
  if (relatedReturn && !isValidObjectId(relatedReturn)) {
    return next(new HandleError("Invalid relatedReturn id", 400));
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

  let discount;
  try {
    // FIX #6 — wrap create() so a concurrent duplicate-key race returns a clean 400
    // rather than an unhandled MongoServerError 11000 bubbling to the global handler.
    discount = await Discount.create({
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
    },
  });

  // FIX #13 — invalidate stats cache after mutation
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
 */
export const updateDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new HandleError("Invalid discount id", 400));
  }

  const allowedUpdates = [
    "description", "status", "validFrom", "validUntil",
    "usageLimit", "conditions", "notes",
  ];

  const updates = {};
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  if (Object.keys(updates).length === 0) {
    return next(new HandleError("No valid fields provided for update", 400));
  }

  // FIX #19 — guard against resurrecting a genuinely expired discount.
  // If the update sets status:'active', the resulting validUntil must be in the future.
  // We honour a simultaneous validUntil extension in the same request.
  if (updates.status === "active") {
    const now = new Date();
    // Use the NEW validUntil if supplied in this request, otherwise we need the
    // existing value — fetch it cheaply before the atomic update below.
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

  // FIX #3 — use findOneAndUpdate with { new: false } so the pre-update snapshot
  // and the write happen in a single atomic operation, eliminating the TOCTOU
  // race between a separate findById() and a subsequent findByIdAndUpdate().
  const before = await Discount.findOneAndUpdate(
    { _id: id },
    { $set: updates },
    { new: false, runValidators: true }
  );

  if (!before) return next(new HandleError("Discount not found", 404));

  // Compute diff from the atomically-captured before snapshot.
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
        // FIX #19 — flag status resurrection explicitly so it stands out in the audit tab
        ...(changedFields.includes("status") &&
          updates.status === "active" && { statusResurrected: true }),
      },
    });
  }

  // FIX #13 — invalidate stats cache after mutation
  await invalidateStatsCache();

  // Re-fetch the updated document to return to the caller.
  const updated = await Discount.findById(before._id).lean();

  res.status(200).json({
    success: true,
    message: "Discount updated successfully",
    discount: updated,
  });
});

// ============================================
// ADMIN: DELETE DISCOUNT (soft)
//
// FRAUD PROTECTION GUARD:
//   Blocks soft-deletion if the discount has been used AND
//   is still within its 30-day post-use protection window.
//   Attempts are logged even when blocked.
//
// TOCTOU FIX (#2):
//   Uses a conditional findOneAndUpdate so the fraud-guard read
//   and the status write are performed as close to atomically as
//   possible without a multi-document transaction.  If the document
//   was already inactive by the time the update runs, findOneAndUpdate
//   returns null, which we detect and handle gracefully.
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

  // We need the full discount to evaluate the fraud guard BEFORE writing.
  const discount = await Discount.findById(id);
  if (!discount) return next(new HandleError("Discount not found", 404));

  const now = new Date();

  // ── Fraud protection check ───────────────────────────────────────────────
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

  // FIX #2 — atomic conditional update: only succeeds if status is not already 'inactive'.
  // Eliminates the TOCTOU window between the findById above and the update.
  // If another request already deactivated this discount, result will be null.
  const previousStatus = discount.status;

  const result = await Discount.findOneAndUpdate(
    { _id: id, status: { $ne: "inactive" } },
    { $set: { status: "inactive" } },
    { new: false }
  );

  // FIX #10 — if result is null the discount was already inactive; return a
  // clear idempotent response and skip the audit entry (nothing actually changed).
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

  // FIX #13 — invalidate stats cache after mutation
  await invalidateStatsCache();

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
    // FIX #9 — escape user input before inserting into a MongoDB $regex to prevent ReDoS.
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
//
// FIX #11 — usageHistory is an unbounded embedded array. Populating
// every entry for a high-use broadcast code could load tens of thousands
// of User and Order documents in a single request, exhausting memory.
//
// Mitigation: we cap the usageHistory slice returned in the response to
// the most recent USAGE_HISTORY_CAP entries. The full count is always
// returned as usageHistoryTotal so the UI can show "showing last N of M".
//
// A future migration to a dedicated DiscountUsage collection will remove
// this cap entirely and enable cursor-based pagination on usage history.
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

  // FIX #11 — cap usageHistory before serialising to prevent unbounded payloads.
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

  // FIX #8 — validate all ObjectId inputs before any DB call to prevent CastError 500s.
  if (!isValidObjectId(userId)) {
    return next(new HandleError("Invalid userId", 400));
  }
  if (relatedOrder && !isValidObjectId(relatedOrder)) {
    return next(new HandleError("Invalid relatedOrder id", 400));
  }
  if (relatedReturn && !isValidObjectId(relatedReturn)) {
    return next(new HandleError("Invalid relatedReturn id", 400));
  }

  // FIX #17 — validate validDays before using it in date arithmetic.
  // parseInt("abc") === NaN; setDate(NaN) produces an invalid Date that silently
  // passes Mongoose schema validation and corrupts the document.
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
  // FIX #17 — use validated parsedDays instead of re-parsing validDays
  validUntil.setDate(validUntil.getDate() + parsedDays);

  let discount;
  try {
    // FIX #6 — wrap create() for the same 11000 race-condition guard as createDiscount
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
  } catch (err) {
    // Code collision is extremely unlikely given randomBytes but handle defensively.
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

  // FIX #13 — invalidate stats cache after mutation
  await invalidateStatsCache();

  return res.status(201).json({
    success: true,
    message: "Compensation discount created successfully",
    discount,
  });
});

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE
//
// FIX #1 — orderId is intentionally NOT forwarded to recordUsage().
//
//   The validate endpoint is called during checkout BEFORE the order document
//   exists. Passing orderId here would either be null (wasted field) or, worse,
//   an arbitrary string from the client that hasn't been verified as a real order.
//
//   recordUsage() is called with orderId = null. The usageHistory entry's .order
//   field will remain null. The frontend checkout completion handler is responsible
//   for linking the order to the usage record after the order is confirmed.
//
//   Consequence: lockedAt / deletionEligibleAt are set on first validate, not on
//   first confirmed order. This is conservative (protects more) and documented here.
//
// FIX #7 — audience:'specific' discounts require authentication.
//   Unauthenticated guests can validate audience:'all' broadcast promos (no per-user
//   eligibility to check), but any personalised compensation code is blocked for guests.
// ============================================

/**
 * @route POST /api/v1/discounts/validate
 * @access Public
 */
export const validateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, cartTotal, items } = req.body;

  // FIX #1 — never accept orderId at validate time; see header comment above.
  // (orderId from req.body is deliberately ignored)

  if (!code) return next(new HandleError("Discount code is required", 400));
  if (!cartTotal || cartTotal <= 0)
    return next(new HandleError("Invalid cart total", 400));

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError("Invalid or expired discount code", 400));

  const userId = req.user?._id;

  // FIX #7 — block unauthenticated requests from using specific-audience codes.
  // Guests have no identity so eligibility cannot be verified. Without this guard
  // any guest who knows a personalised compensation code can apply it.
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

  const validation = discount.validateCart(cartTotal, items, userId);
  if (!validation.valid)
    return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(cartTotal, items);

  // FIX #1 — always pass null as orderId; the order doesn't exist yet at this point.
  const { isFirstUse } = await discount.recordUsage(
    userId ?? null,
    null,          // orderId — intentionally null at validate time (see header comment)
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
      orderId:       null,   // FIX #1 — always null at validate time
      discountAmount,
      cartTotal,
      isFirstUse,
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
// FIX #16 — dot scope was limited to audience:'all' broadcasts but the
// lastSeenDiscountsAt stamp (written in getMyDiscounts) covers both broadcast
// AND personal discounts. This meant a personal compensation code never
// triggered the dot — the notification was silently lost.
//
// Fix: check both broadcast AND personal discounts for items created after
// lastSeenDiscountsAt. The dot now fires for both, consistent with the stamp.
// ============================================

/**
 * @route GET /api/v1/discounts/has-new
 * @access Private
 */
export const hasNewDiscounts = handleAsyncError(async (req, res, next) => {
  const user = req.user;
  const now  = new Date();

  // Build the "since" filter — null lastSeenDiscountsAt means the user has never
  // opened the discounts page, so every existing active discount counts as new.
  const sinceFilter = user.lastSeenDiscountsAt
    ? { createdAt: { $gt: user.lastSeenDiscountsAt } }
    : {};

  // FIX #16 — check both broadcast and personal in parallel.
  const [newestBroadcast, newestPersonal] = await Promise.all([
    Discount.findOne({
      audience:   "all",
      status:     "active",
      validUntil: { $gte: now },
      ...sinceFilter,
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),

    Discount.findOne({
      audience:                   "specific",
      status:                     "active",
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
//
// FIX #13 — both aggregate pipelines do full-collection scans and were
// previously re-run on every request. The results are now cached in Redis
// for STATS_CACHE_TTL seconds. Any controller that mutates the discount
// collection calls invalidateStatsCache() to ensure the next request
// reflects the change.
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
          _id:      null,
          total:    { $sum: 1 },
          active:   { $sum: { $cond: [{ $eq: ["$status", "active"]   }, 1, 0] } },
          inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
          expired:  { $sum: { $cond: [{ $eq: ["$status", "expired"]  }, 1, 0] } },
          totalUses:{ $sum: "$usageLimit.currentUses" },
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
//
// FIX #18 — manual cleanup previously wrote nothing to the audit trail.
// An admin triggering cleanup to remove a recently-expired discount left
// no evidence of who ran it or when. We now write a 'manual_cleanup' entry
// to DiscountAuditLog before the cleanup runs so the intent is always logged
// even if the cleanup itself throws partway through.
// ============================================

/**
 * @route POST /api/v1/discounts/cleanup
 * @access Admin
 */
export const triggerCleanup = handleAsyncError(async (req, res, next) => {
  const { daysOld = 90 } = req.body;

  // FIX #18 — write audit trail BEFORE running cleanup so the intent is recorded
  // even if the cleanup partially fails (mirrors the AuditPurgeLog write-first pattern).
  await DiscountAuditLog.log({
    // Sentinel discount id — this entry is not tied to a specific discount.
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

  // FIX #13 — cleanup changes the collection; invalidate stats cache.
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

  // FIX #20 — validate performedById before forwarding to getPaginated.
  // getPaginated wraps it in new mongoose.Types.ObjectId() which throws a BSONError
  // (unhandled 500) on invalid input. Validate here so we return a clean 400.
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

  // FIX #20 — same ObjectId validation guard as getAuditLog
  if (!isValidObjectId(discountId)) {
    return next(new HandleError("Invalid discountId", 400));
  }

  const logs = await DiscountAuditLog.getForDiscount(discountId, 20);

  res.status(200).json({ success: true, auditLogs: logs });
});

// ============================================
// ADMIN: CREATE VIP / TARGETED USER DISCOUNT
//
// Creates a personalised discount scoped to one or more specific users.
// Users can be identified by userId, email, or a mix of both in the same
// request. All inputs are resolved to ObjectIds before any document is
// written — emails are never persisted anywhere (audit log included).
//
// Distinct from createCompensationDiscount in three ways:
//   1. Supports multiple target users (1 code → N users)
//   2. Supports both 'percentage' and 'fixed' types
//   3. Has no dependency on a return or order — pure business decision
//
// Code generation:
//   - Custom code accepted if provided (uniqueness enforced)
//   - Auto-generated pattern: {CATEGORY}-VIP-{8-HEX} when omitted
//     Keeps VIP codes visually distinct from compensation codes in logs.
//
// PII boundary:
//   Emails are used only to resolve userIds during this request.
//   Only ObjectIds are stored in conditions.eligibleUsers and in the
//   audit log meta. This satisfies right-to-erasure requirements — once
//   a user is deleted their ObjectId in the audit log is an opaque
//   reference with no personal data attached.
// ============================================

const MAX_ELIGIBLE_USERS = 500;

/**
 * @route POST /api/v1/discounts/create-for-user
 * @access Admin
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
    minPurchaseAmount = 0,
    firstOrderOnly    = false,
    excludeSaleItems  = false,
    notes,
    audience,
  } = req.body;

  // ── Step 1: Basic field validation ────────────────────────────────────────

  // audience:'all' is never valid here — this route exists specifically to
  // scope discounts to identified individuals. Reject explicitly so the caller
  // gets a clear message rather than a silent override.
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

  // Type must be one of the two model values — catch early for a cleaner 400.
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

  // At least one user must be targeted.
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
  // validUntil takes precedence if both are supplied.
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

  // ── Step 5: ObjectId format validation on raw userIds ─────────────────────
  // Collect ALL invalid ids before returning so the admin can fix everything
  // in one go rather than playing whack-a-mole with sequential 400s.
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
  // Emails are used here and discarded — they never reach the DB document
  // or the audit log. Only the resolved ObjectIds are carried forward.
  let emailIds = [];

  if (hasEmails) {
    const foundByEmail = await User.find({ email: { $in: emails } })
      .select("_id email")
      .lean();

    const resolvedEmailMap = new Map(
      foundByEmail.map((u) => [u.email.toLowerCase(), u._id])
    );

    // Hard error on any unresolved email — silent omissions are worse than a
    // clear failure. The admin can correct their list and resubmit.
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
  // Both raw userIds (strings) and emailIds (ObjectId objects) are normalised
  // to strings for the Set dedup, then re-cast to ObjectId for DB use.
  const rawIdStrings = hasUserIds ? userIds.map((id) => id.toString()) : [];
  const emailIdStrings = emailIds.map((id) => id.toString());

  const uniqueIdStrings = [...new Set([...rawIdStrings, ...emailIdStrings])];
  const mergedIds = uniqueIdStrings.map(
    (s) => new mongoose.Types.ObjectId(s)
  );

  // Redundant guard — both source arrays were non-empty and validated, but
  // defend against an impossible-but-catastrophic empty-eligibleUsers create.
  if (mergedIds.length === 0) {
    return next(new HandleError("No valid target users after deduplication", 400));
  }

  // Cap to prevent document bloat. 500 ObjectIds ≈ 6KB added to the discount
  // document. Beyond this, a separate campaign/segment system is more appropriate.
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
  // Email-sourced ids were confirmed in step 6. This catches raw userIds that
  // passed ObjectId format validation but don't exist in the database.
  const foundUsers = await User.find({ _id: { $in: mergedIds } })
    .select("_id")
    .lean();

  if (foundUsers.length !== mergedIds.length) {
    const foundSet  = new Set(foundUsers.map((u) => u._id.toString()));
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
    // Auto-generate: {CATEGORY}-VIP-{8-HEX}
    // Pattern is visually distinct from compensation codes ({CATEGORY}-{NAME}-{8-HEX})
    // making them easy to distinguish in the audit log and admin UI.
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
      audience:    "specific",      // hardcoded — non-negotiable on this route
      validFrom:   validFrom ? new Date(validFrom) : new Date(),
      validUntil:  resolvedValidUntil,
      usageLimit: {
        totalUses:   parsedTotalUses,
        usesPerUser: parsedUsesPerUser,
      },
      conditions: {
        eligibleUsers:     mergedIds,  // ObjectIds only — emails were discarded above
        minPurchaseAmount: Number(minPurchaseAmount) || 0,
        firstOrderOnly:    Boolean(firstOrderOnly),
        excludeSaleItems:  Boolean(excludeSaleItems),
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
  // PII boundary: only ObjectIds recorded — emails are never written here.
  // vipDiscount: true flag allows the audit tab to filter VIP-origin creates
  // separately from compensation and general creates.
  await DiscountAuditLog.log({
    discountId:   discount._id,
    discountCode: discount.code,
    action:       "created",
    performedBy:  auditActor(req.user),
    meta: {
      audience:          "specific",
      vipDiscount:       true,
      type,
      value:             numericValue,
      category,
      validUntil:        resolvedValidUntil,
      eligibleUsers:     mergedIds,          // ObjectIds only
      eligibleCount:     mergedIds.length,
      usesPerUser:       parsedUsesPerUser,
      totalUses:         parsedTotalUses,
      autoGeneratedCode: !code,
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