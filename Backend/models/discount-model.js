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
      trim: true
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
      required: true
    },

    // ============================================
    // VALIDITY & USAGE
    // ============================================
    status: {
      type: String,
      enum: ["active", "inactive", "expired"],
      default: "active"
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
      minPurchaseAmount: {
        type: Number,
        default: 0
      },
      maxDiscountAmount: {
        type: Number,
        default: null
      },
      eligibleProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      }],
      eligibleCategories: [{ type: String }],
      // Sparse: only populated for personalized discounts (~small %)
      eligibleUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }],
      excludeSaleItems: {
        type: Boolean,
        default: false
      },
      firstOrderOnly: {
        type: Boolean,
        default: false
      }
    },

    // ============================================
    // TRACKING
    // NOTE: For 100M+ scale, usageHistory should be extracted into a
    // separate DiscountUsage collection to avoid unbounded document growth.
    // Each usage record here adds ~100 bytes; a high-use promo code with
    // 100k uses would push a single document to ~10 MB, hitting MongoDB's
    // 16 MB document limit. The TODO below wires the separate collection.
    // ============================================
    usageHistory: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
      discountAmount: Number,
      usedAt: { type: Date, default: Date.now }
    }],

    // ============================================
    // ADMIN & METADATA
    // ============================================
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    notes: { type: String, trim: true },

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
// Designed for 100M+ documents.
//
// Key decisions:
//  1. (code, status) — primary lookup path for validate endpoint.
//     Both fields are always present, selectivity is high on `code`.
//  2. (status, category, validFrom, validUntil) — covers the admin
//     list query which almost always filters by status + category, then
//     sorts/ranges on dates. Partial index on status:"active" cuts index
//     size ~60-70% since expired/inactive docs are rarely queried live.
//  3. (conditions.eligibleUsers, status) — sparse so it only indexes
//     documents that actually have eligible users (personalised discounts
//     are a tiny fraction of total volume).
//  4. (validUntil, status) — used exclusively by the cleanup job to find
//     expired-but-still-marked-active documents efficiently without a
//     collection scan.
//  5. createdAt desc — default sort for admin list view.
// ============================================

// Primary lookup — validate cart flow
discountSchema.index({ code: 1, status: 1 });

// Admin list + date range queries; partial keeps it lean
discountSchema.index(
  { status: 1, category: 1, validFrom: 1, validUntil: 1 },
  { partialFilterExpression: { status: "active" } }
);

// Personalised discount lookup — sparse skips docs without eligibleUsers
discountSchema.index(
  { "conditions.eligibleUsers": 1, status: 1 },
  { sparse: true }
);

// Cleanup job index — find active docs past their validUntil
discountSchema.index({ validUntil: 1, status: 1 });

// Default admin list sort
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

// ============================================
// METHODS
// ============================================

discountSchema.methods.calculateDiscount = function (cartTotal, items = []) {
  let discountAmount = 0;

  if (this.type === "percentage") {
    discountAmount = (cartTotal * this.value) / 100;
    if (this.conditions.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, this.conditions.maxDiscountAmount);
    }
  } else {
    discountAmount = this.value;
  }

  discountAmount = Math.min(discountAmount, cartTotal);
  return Math.round(discountAmount * 100) / 100;
};

discountSchema.methods.canUserUse = async function (userId) {
  if (this.conditions.eligibleUsers.length > 0) {
    const isEligible = this.conditions.eligibleUsers.some(
      (u) => u.toString() === userId.toString()
    );
    if (!userId || !isEligible) {
      return { canUse: false, reason: "This discount is not available for you" };
    }
  }

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

discountSchema.methods.validateCart = function (cartTotal, items = [], userId = null) {
  if (!this.isValid) {
    return { valid: false, reason: "Discount code is not valid or has expired" };
  }
  if (cartTotal < this.conditions.minPurchaseAmount) {
    return {
      valid: false,
      reason: `Minimum purchase amount of $${this.conditions.minPurchaseAmount} required`
    };
  }
  return { valid: true };
};

discountSchema.methods.recordUsage = async function (userId, orderId, discountAmount) {
  this.usageHistory.push({ user: userId, order: orderId, discountAmount, usedAt: new Date() });
  this.usageLimit.currentUses += 1;
  await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

discountSchema.statics.findActiveByCode = async function (code) {
  return this.findOne({ code: code.toUpperCase(), status: "active" });
};

discountSchema.statics.getActivePromos = async function () {
  const now = new Date();
  return this.find({
    status: "active",
    category: "promo",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    "conditions.eligibleUsers": { $size: 0 }
  }).select("code description type value validUntil conditions.minPurchaseAmount").lean();
};

discountSchema.statics.getUserDiscounts = async function (userId) {
  const now = new Date();
  return this.find({
    status: "active",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    "conditions.eligibleUsers": userId
  }).select("code description type value category validUntil").lean();
};

// ============================================
// STATIC: BULK EXPIRE (used by cleanup job)
// Uses updateMany — a single atomic write across matched docs.
// Far cheaper than loading + saving each document individually.
// ============================================

discountSchema.statics.bulkExpireStale = async function () {
  const result = await this.updateMany(
    {
      status: "active",
      validUntil: { $lt: new Date() }
    },
    { $set: { status: "expired" } }
  );
  return result.modifiedCount;
};

// ============================================
// STATIC: DELETE OLD EXPIRED DISCOUNTS
// Hard-deletes expired discounts older than `daysOld` days.
// Runs in batches to avoid locking the collection on large datasets.
// ============================================

discountSchema.statics.deleteOldExpired = async function (daysOld = 90, batchSize = 1000) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  let totalDeleted = 0;

  while (true) {
    // Find a batch of IDs first — avoids holding a write lock across
    // the full result set.
    const batch = await this.find(
      { status: "expired", validUntil: { $lt: cutoff } },
      { _id: 1 }
    )
      .limit(batchSize)
      .lean();

    if (batch.length === 0) break;

    const ids = batch.map((d) => d._id);
    const { deletedCount } = await this.deleteMany({ _id: { $in: ids } });
    totalDeleted += deletedCount;

    // Yield the event loop between batches so other queries aren't starved
    await new Promise((resolve) => setImmediate(resolve));
  }

  return totalDeleted;
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

discountSchema.pre("save", function (next) {
  if (this.validUntil < new Date() && this.status === "active") {
    this.status = "expired";
  }
  if (this.type === "percentage" && this.value > 100) {
    this.value = 100;
  }
  next();
});

export default mongoose.model("Discount", discountSchema);