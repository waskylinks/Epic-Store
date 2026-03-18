import mongoose from "mongoose";

// ============================================
// DISCOUNT MODEL
// ============================================

const USAGE_SCAN_THRESHOLD = 500;

// Canonical list of product categories (mirrors Product model enum).
// Stored here as a single source of truth for the discount model validator.
const PRODUCT_CATEGORIES = [
  "Electronics",
  "Clothing & Apparel",
  "Home & Living",
  "Sports & Outdoors",
  "Beauty & Personal Care",
  "Books & Media",
  "Food & Beverages",
];

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
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },

    // ============================================
    // DISCOUNT TYPE & VALUE
    // ============================================
    type: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },

    value: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Value cannot be negative"],
    },

    // ============================================
    // AUDIENCE
    // ============================================
    audience: {
      type: String,
      enum: ["specific", "all"],
      default: "specific",
      required: true,
    },

    // ============================================
    // DISCOUNT CATEGORY
    // ============================================
    category: {
      type: String,
      // blackfriday added — seasonal campaign category for Black Friday promotions.
      // Treated like "promo" functionally but tracked separately for analytics.
      enum: ["promo", "refund", "return", "loyalty", "affiliate", "support", "blackfriday"],
      required: true,
    },

    // ============================================
    // VALIDITY & USAGE
    // ============================================
    status: {
      type: String,
      enum: ["active", "inactive", "expired"],
      default: "active",
    },

    validFrom: {
      type: Date,
      required: true,
      default: Date.now,
    },

    validUntil: {
      type: Date,
      required: true,
    },

    usageLimit: {
      totalUses: {
        type: Number,
        default: null,
      },
      usesPerUser: {
        type: Number,
        default: 1,
      },
      currentUses: {
        type: Number,
        default: 0,
      },
    },

    // ============================================
    // CONDITIONS
    // ============================================
    conditions: {
      minPurchaseAmount: {
        type: Number,
        default: 0,
      },
      maxDiscountAmount: {
        type: Number,
        default: null,
      },
      eligibleProducts: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
      ],
      eligibleCategories: [{ type: String }],

      // NEW — product-category restriction.
      // Empty array (default) = no restriction, discount applies to all products.
      // Non-empty = discount only valid when at least one cart item belongs to
      // one of the listed categories.
      // Values must come from PRODUCT_CATEGORIES above (validated in controller).
      eligibleProductCategories: {
        type: [String],
        default: [],
      },

      eligibleUsers: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      excludeSaleItems: {
        type: Boolean,
        default: false,
      },
      firstOrderOnly: {
        type: Boolean,
        default: false,
      },
    },

    // ============================================
    // TRACKING
    // NOTE: For 100M+ scale, usageHistory should be extracted into a
    // separate DiscountUsage collection to avoid unbounded document growth.
    // Each usage record here adds ~100 bytes; a high-use promo code with
    // 100k uses would push a single document to ~10 MB, hitting MongoDB's
    // 16 MB document limit.
    // ============================================
    usageHistory: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        discountAmount: Number,
        usedAt: { type: Date, default: Date.now },
      },
    ],

    // ============================================
    // FRAUD PROTECTION FIELDS
    // ============================================
    lockedAt: {
      type: Date,
      default: null,
    },

    deletionEligibleAt: {
      type: Date,
      default: null,
    },

    // ============================================
    // ADMIN & METADATA
    // ============================================
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    notes: { type: String, trim: true },

    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },

    relatedReturn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Return",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================

discountSchema.index({ code: 1, status: 1 });

discountSchema.index(
  { status: 1, category: 1, validFrom: 1, validUntil: 1 },
  { partialFilterExpression: { status: "active" } }
);

discountSchema.index(
  { audience: 1, status: 1, validUntil: 1 },
  { partialFilterExpression: { status: "active" } }
);

discountSchema.index(
  { "conditions.eligibleUsers": 1, status: 1 },
  { sparse: true }
);

// NEW — sparse index: only present on documents that actually restrict
// by product category. Sparse avoids indexing the large majority of
// documents where the array is empty.
discountSchema.index(
  { "conditions.eligibleProductCategories": 1 },
  { sparse: true }
);

discountSchema.index({ validUntil: 1, status: 1 });

discountSchema.index(
  { deletionEligibleAt: 1 },
  { sparse: true }
);

discountSchema.index({ createdAt: -1 });

// ============================================
// VIRTUALS
// ============================================

discountSchema.virtual("isValid").get(function () {
  const now = new Date();
  return (
    this.status === "active" &&
    this.validFrom <= now &&
    this.validUntil >= now &&
    (this.usageLimit.totalUses === null ||
      this.usageLimit.currentUses < this.usageLimit.totalUses)
  );
});

discountSchema.virtual("isExpired").get(function () {
  return new Date() > this.validUntil;
});

discountSchema.virtual("remainingUses").get(function () {
  if (this.usageLimit.totalUses === null) return "Unlimited";
  return Math.max(0, this.usageLimit.totalUses - this.usageLimit.currentUses);
});

discountSchema.virtual("isProtected").get(function () {
  if (!this.deletionEligibleAt) return false;
  return new Date() < this.deletionEligibleAt;
});

// ============================================
// METHODS
// ============================================

discountSchema.methods.calculateDiscount = function (cartTotal, items = []) {
  const eligibleCats = this.conditions?.eligibleProductCategories ?? [];
  let discountAmount = 0;

  if (this.type === "percentage") {
    // If a product-category restriction is active, base the percentage
    // only on the qualifying items' subtotal.
    let base = cartTotal;
    if (eligibleCats.length > 0 && Array.isArray(items) && items.length > 0) {
      base = items
        .filter(
          (item) =>
            item &&
            typeof item.category === "string" &&
            eligibleCats.includes(item.category)
        )
        .reduce((sum, item) => {
          const price = Number(item.price) || 0;
          const qty   = Number(item.quantity) || 1;
          return sum + price * qty;
        }, 0);

      // Guard: if the eligible subtotal somehow exceeds cartTotal
      // (e.g. caller passed inconsistent data) cap it to cartTotal.
      base = Math.min(base, cartTotal);
    }

    discountAmount = (base * this.value) / 100;

    if (this.conditions.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, this.conditions.maxDiscountAmount);
    }
  } else {
    // Fixed discount — always deduct the full fixed value.
    discountAmount = this.value;
  }

  // Discount can never exceed the cart total.
  discountAmount = Math.min(discountAmount, cartTotal);
  return Math.round(discountAmount * 100) / 100;
};

// ============================================
// canUserUse()
//
// FIX #14 — the original implementation used Array.prototype.filter() over
// the fully-loaded usageHistory array to count a user's prior uses.
// For a broadcast code with 50,000 uses this scans 50,000 elements in JS memory
// on every validate request.
//
// Fix: when usageHistory.length exceeds USAGE_SCAN_THRESHOLD, fall back to a
// server-side MongoDB aggregate that counts only the requesting user's entries.
// This avoids loading the full array while the TODO migration to a dedicated
// DiscountUsage collection is pending.
// ============================================
discountSchema.methods.canUserUse = async function (userId) {
  if (this.audience === "specific" && this.conditions.eligibleUsers.length > 0) {
    const isEligible = this.conditions.eligibleUsers.some(
      (u) => u.toString() === userId.toString()
    );
    if (!userId || !isEligible) {
      return { canUse: false, reason: "This discount is not available for you" };
    }
  }

  if (userId) {
    let userUsageCount;

    if (this.usageHistory.length > USAGE_SCAN_THRESHOLD) {
      // FIX #14 — use a server-side aggregate to avoid O(n) JS scan.
      const result = await this.constructor.aggregate([
        { $match: { _id: this._id } },
        {
          $project: {
            count: {
              $size: {
                $filter: {
                  input: "$usageHistory",
                  as:    "entry",
                  cond:  {
                    $eq: [
                      "$$entry.user",
                      new mongoose.Types.ObjectId(userId.toString()),
                    ],
                  },
                },
              },
            },
          },
        },
      ]);
      userUsageCount = result[0]?.count ?? 0;
    } else {
      userUsageCount = this.usageHistory.filter(
        (usage) => usage.user && usage.user.toString() === userId.toString()
      ).length;
    }

    if (userUsageCount >= this.usageLimit.usesPerUser) {
      return {
        canUse: false,
        reason: "You have reached the usage limit for this discount",
      };
    }
  }

  return { canUse: true };
};

// ============================================
// validateCart()
// ============================================
discountSchema.methods.validateCart = function (cartTotal, items = [], userId = null) {
  if (!this.isValid) {
    return { valid: false, reason: "Discount code is not valid or has expired" };
  }

  if (cartTotal < this.conditions.minPurchaseAmount) {
    return {
      valid: false,
      reason: `Minimum purchase amount of $${this.conditions.minPurchaseAmount} required`,
    };
  }

  // product-category restriction
  const eligibleCats = this.conditions?.eligibleProductCategories ?? [];
  if (eligibleCats.length > 0) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        valid: false,
        reason:
          "This discount is only valid for specific product categories. " +
          "Cart item details are required to validate eligibility.",
      };
    }

    const hasEligibleItem = items.some(
      (item) =>
        item &&
        typeof item.category === "string" &&
        eligibleCats.includes(item.category)
    );

    if (!hasEligibleItem) {
      const catList = eligibleCats.join(", ");
      return {
        valid: false,
        reason: `This discount is only valid for the following product categories: ${catList}.`,
      };
    }
  }

  return { valid: true };
};

// ============================================
// recordUsage()
// ============================================
discountSchema.methods.recordUsage = async function (userId, orderId, discountAmount) {
  const isFirstUse = this.usageLimit.currentUses === 0;

  this.usageHistory.push({ user: userId, order: orderId, discountAmount, usedAt: new Date() });
  this.usageLimit.currentUses += 1;

  if (isFirstUse) {
    const now = new Date();
    this.lockedAt = now;
    this.deletionEligibleAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  await this.save();

  return { isFirstUse };
};

// ============================================
// STATIC METHODS
// ============================================

discountSchema.statics.findActiveByCode = async function (code) {
  const now = new Date();
  return this.findOne({
    code:       code.toUpperCase(),
    status:     "active",
    validFrom:  { $lte: now },
    validUntil: { $gte: now },
  });
};

discountSchema.statics.getActivePromos = async function () {
  const now = new Date();
  return this.find({
    audience:   "all",
    status:     "active",
    validFrom:  { $lte: now },
    validUntil: { $gte: now },
  })
    .select(
      "code description type value validUntil " +
      "conditions.minPurchaseAmount conditions.eligibleProductCategories audience"
    )
    .lean();
};

discountSchema.statics.getUserDiscounts = async function (userId) {
  const now = new Date();
  return this.find({
    audience:   "specific",
    status:     "active",
    validFrom:  { $lte: now },
    validUntil: { $gte: now },
    "conditions.eligibleUsers": userId,
  })
    .select(
      "code description type value category validUntil audience " +
      "conditions.eligibleProductCategories"
    )
    .lean();
};

discountSchema.statics.bulkExpireStale = async function () {
  const result = await this.updateMany(
    {
      status:     "active",
      validUntil: { $lt: new Date() },
    },
    { $set: { status: "expired" } }
  );
  return result.modifiedCount;
};

// ============================================
// STATIC: DELETE OLD EXPIRED DISCOUNTS
// ============================================
discountSchema.statics.deleteOldExpired = async function (daysOld = 90, batchSize = 1000) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const now = new Date();

  const runCeiling = new mongoose.Types.ObjectId();

  let totalDeleted = 0;

  while (true) {
    const batch = await this.find(
      {
        status:     "expired",
        validUntil: { $lt: cutoff },
        _id:        { $lt: runCeiling },
        deletionEligibleAt: { $not: { $gt: now } },
      },
      { _id: 1 }
    )
      .limit(batchSize)
      .lean();

    if (batch.length === 0) break;

    const ids = batch.map((d) => d._id);
    const { deletedCount } = await this.deleteMany({ _id: { $in: ids } });
    totalDeleted += deletedCount;

    await new Promise((resolve) => setImmediate(resolve));
  }

  return totalDeleted;
};

// ============================================
// EXPORTS (for use in controllers)
// ============================================
export { PRODUCT_CATEGORIES };

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

discountSchema.pre("save", function (next) {
  if (this.validUntil <= new Date() && this.status === "active") {
    this.status = "expired";
  }
  if (this.type === "percentage" && this.value > 100) {
    this.value = 100;
  }
  next();
});

export default mongoose.model("Discount", discountSchema);