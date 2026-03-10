import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Discount from "../models/discount-model.js";
import User from "../models/userModel.js";
import crypto from "crypto";

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
    validFrom, validUntil, usageLimit, conditions, notes,
    relatedOrder, relatedReturn
  } = req.body;

  if (!code || !description || !type || !value || !category || !validUntil) {
    return next(new HandleError("Missing required fields", 400));
  }

  const existingDiscount = await Discount.findOne({ code: code.toUpperCase() }).lean();
  if (existingDiscount) {
    return next(new HandleError("Discount code already exists", 400));
  }

  const discount = await Discount.create({
    code: code.toUpperCase(),
    description, type, value, category,
    validFrom: validFrom || Date.now(),
    validUntil,
    usageLimit: usageLimit || {},
    conditions: conditions || {},
    notes, relatedOrder, relatedReturn,
    createdBy: req.user._id
  });

  res.status(201).json({ success: true, message: "Discount created successfully", discount });
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

  const allowedUpdates = ["description", "status", "validFrom", "validUntil", "usageLimit", "conditions", "notes"];
  const updates = {};
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  // findByIdAndUpdate is a single round-trip vs findById + save (two round-trips).
  // returnDocument:"after" gives back the updated doc without a second query.
  const discount = await Discount.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!discount) return next(new HandleError("Discount not found", 404));

  res.status(200).json({ success: true, message: "Discount updated successfully", discount });
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

  const discount = await Discount.findByIdAndUpdate(
    id,
    { $set: { status: "inactive" } },
    { new: true }
  );

  if (!discount) return next(new HandleError("Discount not found", 404));

  res.status(200).json({ success: true, message: "Discount deleted successfully" });
});

// ============================================
// ADMIN: GET ALL DISCOUNTS
//
// Pagination strategy: CURSOR-BASED (keyset pagination)
// ─────────────────────────────────────────────────────
// Why not offset/skip?
//   SKIP scans and discards N documents before returning results.
//   On a 100M collection, `skip(5_000_000)` forces MongoDB to walk
//   through 5M index entries on every request — O(n) cost that grows
//   linearly with page depth. This becomes unusably slow by page ~500.
//
// How cursor pagination works here:
//   The client receives a `nextCursor` in each response. On the next
//   request it passes `cursor=<value>` instead of a page number.
//   The cursor encodes the _id of the last document seen. MongoDB can
//   seek directly to that _id position in the index — O(log n) — and
//   return the next `limit` documents regardless of how deep we are.
//
// Cursor format: base64-encoded JSON { id, createdAt }
//   Using _id alone is sufficient for unique ordering, but including
//   createdAt makes the cursor human-debuggable and resistant to
//   clock-skew edge cases on sharded clusters.
//
// Trade-off: cursor pagination does not support jumping to an arbitrary
//   page (e.g. "go to page 47"). If the admin UI needs that, a hybrid
//   approach — cursor for forward paging, count-limited skip for small
//   jumps — can be layered on top.
// ============================================

/**
 * @route GET /api/v1/discounts
 * @access Admin
 *
 * Query params:
 *   status, category, type   — filters
 *   search                   — text search on code / description
 *   limit                    — page size (default 20, max 100)
 *   cursor                   — opaque pagination token from previous response
 */
export const getAllDiscounts = handleAsyncError(async (req, res, next) => {
  const { status, category, type, search, cursor } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  // Build filter
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (type) filter.type = type;
  if (search) {
    filter.$or = [
      { code: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } }
    ];
  }

  // Decode cursor if present
  if (cursor) {
    try {
      const { id } = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      // We want documents AFTER the cursor position (older, since we sort desc)
      filter._id = { $lt: id };
    } catch {
      return next(new HandleError("Invalid pagination cursor", 400));
    }
  }

  // Fetch one extra document to detect if a next page exists
  const discounts = await Discount.find(filter)
    .sort({ _id: -1 }) // _id desc == createdAt desc for ObjectId
    .limit(limit + 1)
    .populate("createdBy", "firstName lastName email")
    .populate("relatedOrder", "orderNumber")
    .lean();

  const hasNextPage = discounts.length > limit;
  if (hasNextPage) discounts.pop(); // remove the probe document

  // Encode next cursor from the last document in this page
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
    pagination: {
      limit,
      hasNextPage,
      nextCursor // pass this as `cursor` in the next request; null = last page
    }
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
    .populate("relatedReturn", "returnInfo.rmaNumber returnInfo.status returnInfo.discountValue")
    .populate("usageHistory.user", "firstName lastName email")
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
    userId, amount, reason, category,
    validDays = 30, relatedOrder, relatedReturn
  } = req.body;

  if (!userId || amount === undefined || amount === null || !category) {
    return next(new HandleError("Missing required fields", 400));
  }

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return next(new HandleError("Amount must be a positive number", 400));
  }

  const user = await User.findById(userId).lean();
  if (!user) return next(new HandleError("User not found", 404));

  const uniqueSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  const code = `${category.toUpperCase()}-${user.firstName.toUpperCase()}-${uniqueSuffix}`;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + parseInt(validDays));

  const discount = await Discount.create({
    code,
    description: reason || `Compensation discount for ${user.firstName}`,
    type: "fixed",
    value: Number(amount),
    category,
    validUntil,
    usageLimit: { totalUses: 1, usesPerUser: 1 },
    conditions: { eligibleUsers: [userId], minPurchaseAmount: 0 },
    notes: `Auto-generated compensation for ${category}`,
    relatedOrder, relatedReturn,
    createdBy: req.user._id
  });

  res.status(201).json({
    success: true,
    message: "Compensation discount created successfully",
    discount
  });
});

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE
// ============================================

/**
 * @route POST /api/v1/discounts/validate
 * @access Public
 */
export const validateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, cartTotal, items } = req.body;

  if (!code) return next(new HandleError("Discount code is required", 400));
  if (!cartTotal || cartTotal <= 0) return next(new HandleError("Invalid cart total", 400));

  const discount = await Discount.findActiveByCode(code);
  if (!discount) return next(new HandleError("Invalid or expired discount code", 400));

  const userId = req.user?._id;
  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));
  }

  const validation = discount.validateCart(cartTotal, items, userId);
  if (!validation.valid) return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(cartTotal, items);

  res.status(200).json({
    success: true,
    valid: true,
    discount: {
      code: discount.code,
      type: discount.type,
      value: discount.value,
      discountAmount,
      description: discount.description
    }
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
  const discounts = await Discount.getUserDiscounts(req.user._id);
  res.status(200).json({ success: true, discounts });
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
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] }
          },
          totalUses: { $sum: "$usageLimit.currentUses" },
          totalDiscountValue: {
            $sum: {
              $reduce: {
                input: "$usageHistory",
                initialValue: 0,
                in: { $add: ["$$value", "$$this.discountAmount"] }
              }
            }
          }
        }
      },
      { $sort: { totalUses: -1 } }
    ]),
    Discount.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] } },
          totalUses: { $sum: "$usageLimit.currentUses" }
        }
      }
    ])
  ]);

  res.status(200).json({
    success: true,
    stats,
    overall: overall[0] || { total: 0, active: 0, expired: 0, totalUses: 0 }
  });
});

// ============================================
// ADMIN: TRIGGER MANUAL CLEANUP
// (The scheduled job calls the same statics directly.)
// ============================================

/**
 * @route POST /api/v1/discounts/cleanup
 * @access Admin
 */
export const triggerCleanup = handleAsyncError(async (req, res, next) => {
  const { daysOld = 90 } = req.body;

  const [expired, deleted] = await Promise.all([
    Discount.bulkExpireStale(),
    Discount.deleteOldExpired(daysOld)
  ]);

  res.status(200).json({
    success: true,
    message: "Cleanup complete",
    expired,   // docs marked expired in this run
    deleted    // docs hard-deleted in this run
  });
});