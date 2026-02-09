import mongoose from "mongoose";

const discountSchema = new mongoose.Schema(
  {
    // ============================================
    // BASIC INFO
    // ============================================
    code: {
      type: String,
      required: [true, "Discount code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true
    },

    // ============================================
    // DISCOUNT TYPE & VALUE
    // ============================================
    type: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true
    },

    value: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Value cannot be negative"]
    },

    // ============================================
    // DISCOUNT CATEGORY
    // ============================================
    category: {
      type: String,
      enum: ["promo", "refund", "return", "loyalty", "affiliate", "support"],
      required: true,
      index: true
    },

    // ============================================
    // VALIDITY & USAGE
    // ============================================
    status: {
      type: String,
      enum: ["active", "inactive", "expired"],
      default: "active",
      index: true
    },

    validFrom: {
      type: Date,
      required: true,
      default: Date.now
    },

    validUntil: {
      type: Date,
      required: true
    },

    // Usage limits
    usageLimit: {
      totalUses: {
        type: Number,
        default: null // null = unlimited
      },
      usesPerUser: {
        type: Number,
        default: 1
      },
      currentUses: {
        type: Number,
        default: 0
      }
    },

    // ============================================
    // CONDITIONS
    // ============================================
    conditions: {
      // Minimum purchase amount
      minPurchaseAmount: {
        type: Number,
        default: 0
      },

      // Maximum discount cap (for percentage discounts)
      maxDiscountAmount: {
        type: Number,
        default: null
      },

      // Specific products eligible
      eligibleProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      }],

      // Specific categories eligible
      eligibleCategories: [{
        type: String
      }],

      // Specific users eligible (for personalized discounts)
      eligibleUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }],

      // Exclude sale items
      excludeSaleItems: {
        type: Boolean,
        default: false
      },

      // First order only
      firstOrderOnly: {
        type: Boolean,
        default: false
      }
    },

    // ============================================
    // TRACKING
    // ============================================
    usageHistory: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order"
      },
      discountAmount: Number,
      usedAt: {
        type: Date,
        default: Date.now
      }
    }],

    // ============================================
    // ADMIN & METADATA
    // ============================================
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    notes: {
      type: String,
      trim: true
    },

    // For refund/return specific discounts
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order"
    },

    relatedReturn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Return"
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// INDEXES
// ============================================
discountSchema.index({ code: 1, status: 1 });
discountSchema.index({ validFrom: 1, validUntil: 1 });
discountSchema.index({ category: 1, status: 1 });
discountSchema.index({ "conditions.eligibleUsers": 1 });

// ============================================
// VIRTUALS
// ============================================

// Check if discount is currently valid
discountSchema.virtual("isValid").get(function () {
  const now = new Date();
  return (
    this.status === "active" &&
    this.validFrom <= now &&
    this.validUntil >= now &&
    (this.usageLimit.totalUses === null || this.usageLimit.currentUses < this.usageLimit.totalUses)
  );
});

// Check if discount is expired
discountSchema.virtual("isExpired").get(function () {
  return new Date() > this.validUntil;
});

// Remaining uses
discountSchema.virtual("remainingUses").get(function () {
  if (this.usageLimit.totalUses === null) return "Unlimited";
  return Math.max(0, this.usageLimit.totalUses - this.usageLimit.currentUses);
});

// ============================================
// METHODS
// ============================================

// Calculate discount amount for a cart
discountSchema.methods.calculateDiscount = function (cartTotal, items = []) {
  let discountAmount = 0;

  if (this.type === "percentage") {
    discountAmount = (cartTotal * this.value) / 100;
    
    // Apply max discount cap if set
    if (this.conditions.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, this.conditions.maxDiscountAmount);
    }
  } else {
    // Fixed amount
    discountAmount = this.value;
  }

  // Cannot exceed cart total
  discountAmount = Math.min(discountAmount, cartTotal);

  return Math.round(discountAmount * 100) / 100;
};

// Check if user can use this discount
discountSchema.methods.canUserUse = async function (userId) {
  // Check if discount has eligible users restriction
  if (this.conditions.eligibleUsers.length > 0) {
    if (!userId || !this.conditions.eligibleUsers.includes(userId)) {
      return { canUse: false, reason: "This discount is not available for you" };
    }
  }

  // Check per-user usage limit
  if (userId) {
    const userUsageCount = this.usageHistory.filter(
      (usage) => usage.user && usage.user.toString() === userId.toString()
    ).length;

    if (userUsageCount >= this.usageLimit.usesPerUser) {
      return { canUse: false, reason: "You have reached the usage limit for this discount" };
    }
  }

  return { canUse: true };
};

// Validate discount against cart
discountSchema.methods.validateCart = function (cartTotal, items = [], userId = null) {
  // Check if valid
  if (!this.isValid) {
    return { valid: false, reason: "Discount code is not valid or has expired" };
  }

  // Check minimum purchase amount
  if (cartTotal < this.conditions.minPurchaseAmount) {
    return {
      valid: false,
      reason: `Minimum purchase amount of $${this.conditions.minPurchaseAmount} required`
    };
  }

  return { valid: true };
};

// Record usage
discountSchema.methods.recordUsage = async function (userId, orderId, discountAmount) {
  this.usageHistory.push({
    user: userId,
    order: orderId,
    discountAmount,
    usedAt: new Date()
  });

  this.usageLimit.currentUses += 1;

  await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

// Find active discount by code
discountSchema.statics.findActiveByCode = async function (code) {
  return this.findOne({
    code: code.toUpperCase(),
    status: "active"
  });
};

// Get all active public promos
discountSchema.statics.getActivePromos = async function () {
  const now = new Date();
  
  return this.find({
    status: "active",
    category: "promo",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    "conditions.eligibleUsers": { $size: 0 } // Public promos only
  }).select("code description type value validUntil conditions.minPurchaseAmount");
};

// Get user-specific discounts
discountSchema.statics.getUserDiscounts = async function (userId) {
  const now = new Date();
  
  return this.find({
    status: "active",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    "conditions.eligibleUsers": userId
  }).select("code description type value category validUntil");
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
discountSchema.pre("save", function (next) {
  // Auto-expire if past validUntil date
  if (this.validUntil < new Date() && this.status === "active") {
    this.status = "expired";
  }

  // Ensure percentage is between 0-100
  if (this.type === "percentage" && this.value > 100) {
    this.value = 100;
  }

  next();
});

export default mongoose.model("Discount", discountSchema);