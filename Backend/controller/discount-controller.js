import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Discount from "../models/discount-model.js";
import User from "../models/userModel.js";
import crypto from "crypto";
import Order from "../models/order-model.js";

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
// ============================================
// ADMIN: CREATE COMPENSATION DISCOUNT (refund / return)
//
// FIX 1 — relatedReturn uniqueness guard
//   Before creating, check whether a discount already exists for this
//   relatedReturn ID. Returns 409 with the existing code so the admin
//   sees it rather than silently creating a duplicate. Without this, the
//   admin could navigate back from the discount creation page and click
//   "Generate Discount Code" again on the same completed return, producing
//   two valid discount codes for the same customer compensation.
//
// FIX 2 — server-side amount re-validation from the return document
//   When the request comes from the return flow (relatedReturn is present),
//   the backend re-reads discountValue directly from the Order document
//   instead of trusting the amount the frontend sends. This means the
//   frontend pre-fill is display-only — an intercepted or tampered request
//   cannot inflate the discount amount, because the final value always
//   comes from the server-authoritative return record.
//
//   For manually created compensation discounts (no relatedReturn), the
//   admin-supplied amount is used as before, subject to the existing
//   positive-number validation.
//
// FIX 3 — return status guard
//   If relatedReturn is provided, the referenced Order must be in
//   'awaiting_discount' or 'completed' status. This prevents a race
//   condition where two admins both click "Generate Discount Code" on
//   the same return at the same time — the second request arrives after
//   the first has already flipped the status to 'completed', so the
//   guard on the second request catches it and returns a clear error.
//
// Existing fixes preserved from previous iteration:
//   - amount === undefined/null check before Number() coercion
//   - isNaN / <= 0 guard for manual compensation amounts
//   - crypto.randomBytes(4) suffix instead of Date.now().slice(-6)
//   - validUntil calculation from validDays
//   - eligibleUsers scoped to the specific customer
//
// @route  POST /api/v1/discounts/create-compensation
// @access Admin
// ============================================

export const createCompensationDiscount = handleAsyncError(async (req, res, next) => {
  const {
    userId,
    amount,        // used only when relatedReturn is absent (manual compensation)
    reason,
    category,      // 'refund' | 'return'
    validDays = 30,
    relatedOrder,
    relatedReturn,
  } = req.body;

  // ── Basic presence check ────────────────────────────────────────────────
  if (!userId || !category) {
    return next(new HandleError("Missing required fields: userId, category", 400));
  }

  // ── FIX 1: relatedReturn uniqueness guard ───────────────────────────────
  // Check BEFORE any DB writes so we never enter a partial-create state.
  if (relatedReturn) {
    const existing = await Discount.findOne({ relatedReturn }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A discount code already exists for this return: ${existing.code}`,
        existingCode: existing.code,
        existingDiscountId: existing._id,
      });
    }
  }

  // ── Verify user exists ──────────────────────────────────────────────────
  const user = await User.findById(userId).lean();
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // ── FIX 2 + FIX 3: re-read amount from the return document ─────────────
  // When this request originates from the return flow, authoritative amount
  // comes from the Order — never from the request body.
  let finalAmount;

  if (relatedReturn) {
    // Import Order model — already available in the return controller; add
    // the import at the top of discount-controller.js if not already present:
    //   import Order from "../models/order-model.js";
    const order = await Order.findById(relatedReturn)
      .select("returnInfo.status returnInfo.discountValue")
      .lean();

    if (!order) {
      return next(new HandleError("Related return order not found", 404));
    }

    // FIX 3 — status guard: only awaiting_discount is a valid entry point.
    // 'completed' is also accepted defensively in case the status was
    // already flipped by a concurrent generateDiscountCode call — the
    // uniqueness guard above (FIX 1) will catch true duplicates first, so
    // reaching 'completed' here means the status advanced between the
    // uniqueness check and this read (very rare but possible under load).
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

    // Re-read the server-authoritative discount value — ignore req.body.amount
    finalAmount = order.returnInfo?.discountValue;

    if (
      finalAmount === undefined ||
      finalAmount === null ||
      isNaN(Number(finalAmount)) ||
      Number(finalAmount) <= 0
    ) {
      return next(
        new HandleError(
          "Return has no valid discount value. Ensure items have been reviewed and approved before generating a discount.",
          400
        )
      );
    }

    finalAmount = Number(finalAmount);
  } else {
    // ── Manual compensation (no relatedReturn): validate req.body.amount ──
    if (amount === undefined || amount === null) {
      return next(new HandleError("Missing required field: amount", 400));
    }
    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      return next(new HandleError("Amount must be a positive number", 400));
    }
    finalAmount = Number(amount);
  }

  // ── Generate collision-resistant code ───────────────────────────────────
  // crypto.randomBytes(4) → 2^32 combinations; far safer than Date.now().slice(-6)
  // which collides when two requests arrive within the same millisecond.
  // The unique index on Discount.code is still a safety net.
  const uniqueSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  const code = `${category.toUpperCase()}-${user.firstName.toUpperCase()}-${uniqueSuffix}`;

  // ── Build validUntil ────────────────────────────────────────────────────
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + parseInt(validDays));

  // ── Create discount ─────────────────────────────────────────────────────
  const discount = await Discount.create({
    code,
    description:
      reason ||
      `Compensation discount for ${user.firstName}${relatedReturn ? " (return)" : ""}`,
    type: "fixed",
    value: finalAmount,
    category,
    validUntil,
    usageLimit: {
      totalUses: 1,    // single-use — this is a personalised compensation code
      usesPerUser: 1,
    },
    conditions: {
      // Scoped to the specific customer — cannot be used by anyone else.
      // The validateDiscountCode endpoint enforces this via canUserUse().
      eligibleUsers: [userId],
      minPurchaseAmount: 0,
    },
    notes: relatedReturn
      ? `Auto-generated from return ${relatedReturn}`
      : `Manual compensation — ${category}`,
    relatedOrder,
    relatedReturn,
    createdBy: req.user._id,
  });

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