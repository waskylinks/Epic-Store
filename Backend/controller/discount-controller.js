import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Discount from "../models/discount-model.js";
import User from "../models/user-model.js";
import Product from "../models/product-model.js";

// ============================================
// ADMIN: CREATE DISCOUNT
// ============================================

/**
 * Create new discount code
 * @route POST /api/v1/discounts
 * @access Admin
 */
export const createDiscount = handleAsyncError(async (req, res, next) => {
  const {
    code,
    description,
    type,
    value,
    category,
    validFrom,
    validUntil,
    usageLimit,
    conditions,
    notes,
    relatedOrder,
    relatedReturn
  } = req.body;

  // Validate required fields
  if (!code || !description || !type || !value || !category || !validUntil) {
    return next(new HandleError("Missing required fields", 400));
  }

  // Check if code already exists
  const existingDiscount = await Discount.findOne({ code: code.toUpperCase() });
  if (existingDiscount) {
    return next(new HandleError("Discount code already exists", 400));
  }

  // Create discount
  const discount = await Discount.create({
    code: code.toUpperCase(),
    description,
    type,
    value,
    category,
    validFrom: validFrom || Date.now(),
    validUntil,
    usageLimit: usageLimit || {},
    conditions: conditions || {},
    notes,
    relatedOrder,
    relatedReturn,
    createdBy: req.user._id
  });

  res.status(201).json({
    success: true,
    message: "Discount created successfully",
    discount
  });
});

// ============================================
// ADMIN: UPDATE DISCOUNT
// ============================================

/**
 * Update discount
 * @route PUT /api/v1/discounts/:id
 * @access Admin
 */
export const updateDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const discount = await Discount.findById(id);

  if (!discount) {
    return next(new HandleError("Discount not found", 404));
  }

  // Update allowed fields
  const allowedUpdates = [
    "description",
    "status",
    "validFrom",
    "validUntil",
    "usageLimit",
    "conditions",
    "notes"
  ];

  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      discount[field] = req.body[field];
    }
  });

  await discount.save();

  res.status(200).json({
    success: true,
    message: "Discount updated successfully",
    discount
  });
});

// ============================================
// ADMIN: DELETE DISCOUNT
// ============================================

/**
 * Delete discount
 * @route DELETE /api/v1/discounts/:id
 * @access Admin
 */
export const deleteDiscount = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const discount = await Discount.findById(id);

  if (!discount) {
    return next(new HandleError("Discount not found", 404));
  }

  // Soft delete by setting status to inactive
  discount.status = "inactive";
  await discount.save();

  res.status(200).json({
    success: true,
    message: "Discount deleted successfully"
  });
});

// ============================================
// ADMIN: GET ALL DISCOUNTS
// ============================================

/**
 * Get all discounts with filters
 * @route GET /api/v1/discounts
 * @access Admin
 */
export const getAllDiscounts = handleAsyncError(async (req, res, next) => {
  const {
    status,
    category,
    type,
    page = 1,
    limit = 20,
    search
  } = req.query;

  const query = {};

  // Filters
  if (status) query.status = status;
  if (category) query.category = category;
  if (type) query.type = type;
  if (search) {
    query.$or = [
      { code: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [discounts, total] = await Promise.all([
    Discount.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("createdBy", "firstName lastName email")
      .populate("relatedOrder", "orderNumber")
      .lean(),
    Discount.countDocuments(query)
  ]);

  res.status(200).json({
    success: true,
    discounts,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      totalDiscounts: total,
      limit: parseInt(limit)
    }
  });
});

// ============================================
// ADMIN: GET SINGLE DISCOUNT
// ============================================

/**
 * Get discount details
 * @route GET /api/v1/discounts/:id
 * @access Admin
 */
export const getDiscountById = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const discount = await Discount.findById(id)
    .populate("createdBy", "firstName lastName email")
    .populate("relatedOrder", "orderNumber totalPrice")
    .populate("usageHistory.user", "firstName lastName email")
    .populate("usageHistory.order", "orderNumber");

  if (!discount) {
    return next(new HandleError("Discount not found", 404));
  }

  res.status(200).json({
    success: true,
    discount
  });
});

// ============================================
// ADMIN: CREATE REFUND/RETURN DISCOUNT
// ============================================

/**
 * Create personalized discount for refund/return
 * @route POST /api/v1/discounts/create-compensation
 * @access Admin
 */
export const createCompensationDiscount = handleAsyncError(async (req, res, next) => {
  const {
    userId,
    amount,
    reason,
    category, // 'refund' or 'return'
    validDays = 30,
    relatedOrder,
    relatedReturn
  } = req.body;

  if (!userId || !amount || !category) {
    return next(new HandleError("Missing required fields", 400));
  }

  // Verify user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // Generate unique code
  const code = `${category.toUpperCase()}-${user.firstName.toUpperCase()}-${Date.now().toString().slice(-6)}`;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + parseInt(validDays));

  const discount = await Discount.create({
    code,
    description: reason || `Compensation discount for ${user.firstName}`,
    type: "fixed",
    value: amount,
    category,
    validUntil,
    usageLimit: {
      totalUses: 1,
      usesPerUser: 1
    },
    conditions: {
      eligibleUsers: [userId],
      minPurchaseAmount: 0
    },
    notes: `Auto-generated compensation for ${category}`,
    relatedOrder,
    relatedReturn,
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
 * Validate discount code (used in cart)
 * @route POST /api/v1/discounts/validate
 * @access Public
 */
export const validateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, cartTotal, items } = req.body;

  if (!code) {
    return next(new HandleError("Discount code is required", 400));
  }

  if (!cartTotal || cartTotal <= 0) {
    return next(new HandleError("Invalid cart total", 400));
  }

  // Find discount
  const discount = await Discount.findActiveByCode(code);

  if (!discount) {
    return next(new HandleError("Invalid or expired discount code", 400));
  }

  // Check if user can use (if logged in)
  const userId = req.user?._id;
  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse) {
      return next(new HandleError(canUse.reason, 400));
    }
  }

  // Validate cart
  const validation = discount.validateCart(cartTotal, items, userId);
  if (!validation.valid) {
    return next(new HandleError(validation.reason, 400));
  }

  // Calculate discount
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
 * Get all active public promo codes
 * @route GET /api/v1/discounts/promos
 * @access Public
 */
export const getActivePromos = handleAsyncError(async (req, res, next) => {
  const promos = await Discount.getActivePromos();

  res.status(200).json({
    success: true,
    promos
  });
});

// ============================================
// USER: GET MY DISCOUNTS
// ============================================

/**
 * Get user's personalized discounts
 * @route GET /api/v1/discounts/my-discounts
 * @access Private (User)
 */
export const getMyDiscounts = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const discounts = await Discount.getUserDiscounts(userId);

  res.status(200).json({
    success: true,
    discounts
  });
});

// ============================================
// ADMIN: GET DISCOUNT STATS
// ============================================

/**
 * Get discount usage statistics
 * @route GET /api/v1/discounts/stats
 * @access Admin
 */
export const getDiscountStats = handleAsyncError(async (req, res, next) => {
  const stats = await Discount.aggregate([
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
    {
      $sort: { totalUses: -1 }
    }
  ]);

  // Overall stats
  const overall = await Discount.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        expired: { $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] } },
        totalUses: { $sum: "$usageLimit.currentUses" }
      }
    }
  ]);

  res.status(200).json({
    success: true,
    stats,
    overall: overall[0] || { total: 0, active: 0, expired: 0, totalUses: 0 }
  });
});