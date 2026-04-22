import mongoose from "mongoose";

// ============================================
// DISCOUNT MODEL
// ============================================

const USAGE_SCAN_THRESHOLD = 500;

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
    remainingBalance: {
      type: Number,
      default: null,
      min: 0,
    },
    isPartialAllowed: {
      type: Boolean,
      default: true,
    },
    audience: {
      type: String,
      enum: ["specific", "all"],
      default: "specific",
      required: true,
    },
    category: {
      type: String,
      enum: ["promo", "refund", "return", "loyalty", "affiliate", "support", "blackfriday"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "expired", "exhausted"],
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
      totalUses: { type: Number, default: null },
      usesPerUser: { type: Number, default: 1 },
      currentUses: { type: Number, default: 0 },
    },
    conditions: {
      minPurchaseAmount: { type: Number, default: 0 },
      maxDiscountAmount: { type: Number, default: null },
      eligibleProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      eligibleCategories: [{ type: String }],
      eligibleProductCategories: { type: [String], default: [] },
      eligibleUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      excludeSaleItems: { type: Boolean, default: false },
      firstOrderOnly: { type: Boolean, default: false },
    },
    usageHistory: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        discountAmount: Number,
        amountUsed: Number,
        usedAt: { type: Date, default: Date.now },
      },
    ],
    lockedAt: { type: Date, default: null },
    deletionEligibleAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    notes: { type: String, trim: true },
    relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    relatedReturn: { type: mongoose.Schema.Types.ObjectId, ref: "Return" },
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
discountSchema.index({ "conditions.eligibleUsers": 1, status: 1 }, { sparse: true });
discountSchema.index({ "conditions.eligibleProductCategories": 1 }, { sparse: true });
discountSchema.index({ validUntil: 1, status: 1 });
discountSchema.index({ deletionEligibleAt: 1 }, { sparse: true });
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
      this.usageLimit.currentUses < this.usageLimit.totalUses) &&
    (this.type !== "fixed" || this.remainingBalance === null || this.remainingBalance > 0)
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

// FIX #3 — cap eligible subtotal against sum of eligible-item subtotals only,
// not the full cartTotal which includes ineligible items.
discountSchema.methods.calculateDiscount = function (cartTotal, items = []) {
  const eligibleCats = this.conditions?.eligibleProductCategories ?? [];
  let discountAmount = 0;

  if (this.type === "percentage") {
    let base = cartTotal;
    if (eligibleCats.length > 0 && Array.isArray(items) && items.length > 0) {
      const eligibleSubtotal = items
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

      // FIX #3: cap against eligible subtotal, not full cartTotal.
      // cartTotal includes ineligible items, so using it as the cap could
      // allow a discount larger than the qualifying items' actual value.
      base = Math.min(eligibleSubtotal, eligibleSubtotal); // explicit: base IS eligibleSubtotal
      base = eligibleSubtotal;
    }

    discountAmount = (base * this.value) / 100;

    if (this.conditions.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, this.conditions.maxDiscountAmount);
    }
  } else {
    discountAmount = Math.min(
      this.value,
      cartTotal,
      this.remainingBalance ?? this.value
    );
  }

  discountAmount = Math.min(discountAmount, cartTotal);
  return Math.round(discountAmount * 100) / 100;
};

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

// FIX #2 — enforce isPartialAllowed: false. Reject the cart when the discount
// cannot fully cover it and partial use is not permitted.
discountSchema.methods.validateCart = function (cartTotal, items = [], userId = null) {
  if (!this.isValid) {
    return { valid: false, reason: "Discount code is not valid or has expired" };
  }

  if (this.type === "fixed" && this.remainingBalance !== null && this.remainingBalance <= 0) {
    return { valid: false, reason: "This discount code has been fully used." };
  }

  if (cartTotal < this.conditions.minPurchaseAmount) {
    return {
      valid: false,
      reason: `Minimum purchase amount of $${this.conditions.minPurchaseAmount} required`,
    };
  }

  // FIX #2: enforce isPartialAllowed === false.
  // If the remaining balance is less than the cart total and partial use is
  // not allowed, reject the redemption rather than silently giving a partial discount.
  if (
    this.type === "fixed" &&
    this.remainingBalance !== null &&
    !this.isPartialAllowed &&
    this.remainingBalance < cartTotal
  ) {
    return {
      valid: false,
      reason:
        `This discount code has a remaining balance of $${this.remainingBalance.toFixed(2)} ` +
        `which does not cover your cart total of $${cartTotal.toFixed(2)}. ` +
        `Partial use is not permitted for this code.`,
    };
  }

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

// FIX #1 — atomic remainingBalance deduction using $inc + $gte guard to
// eliminate the race condition where two concurrent redemptions both read the
// same balance before either write completes, potentially driving it negative.
discountSchema.methods.recordUsage = async function (userId, orderId, discountAmount) {
  const actualAmount = discountAmount;
  const now = new Date();

  const isFirstUseCheck = this.usageLimit.currentUses === 0;

  // Build the atomic update payload
  const updateOp = {
    $inc: { "usageLimit.currentUses": 1 },
    $push: {
      usageHistory: {
        user:           userId,
        order:          orderId,
        discountAmount: actualAmount,
        amountUsed:     actualAmount,
        usedAt:         now,
      },
    },
  };

  // FIX #1: for fixed codes with balance tracking, deduct atomically so
  // concurrent redemptions cannot both read the same pre-deduction balance.
  let atomicFilter = { _id: this._id };
  if (this.type === "fixed" && this.remainingBalance !== null) {
    // Guard: only proceed if balance is still sufficient (>= actualAmount).
    // This prevents the balance going negative under concurrent load.
    atomicFilter.remainingBalance = { $gte: actualAmount };
    updateOp.$inc.remainingBalance = -actualAmount;
  }

  const updated = await this.constructor.findOneAndUpdate(
    atomicFilter,
    updateOp,
    { new: true }
  );

  if (!updated) {
    // Balance was insufficient at write time (lost race) — reject.
    throw new Error(
      "Discount balance was insufficient at the time of redemption. " +
      "Please refresh your cart and try again."
    );
  }

  // Mark exhausted if balance reached zero after the atomic deduction
  if (updated.type === "fixed" && updated.remainingBalance === 0 && updated.status === "active") {
    await this.constructor.findOneAndUpdate(
      { _id: this._id, remainingBalance: 0, status: "active" },
      { $set: { status: "exhausted" } }
    );
  }

  // Set fraud-protection timestamps on first use
  if (isFirstUseCheck && updated.usageLimit.currentUses === 1) {
    const deletionEligibleAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await this.constructor.findOneAndUpdate(
      { _id: this._id, lockedAt: null },
      { $set: { lockedAt: now, deletionEligibleAt } }
    );
  }

  // Sync local instance fields so callers reading this.remainingBalance etc. are current
  Object.assign(this, updated.toObject());

  return { isFirstUse: isFirstUseCheck };
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
      "conditions.eligibleProductCategories remainingBalance isPartialAllowed"
    )
    .lean();
};

discountSchema.statics.bulkExpireStale = async function () {
  const result = await this.updateMany(
    { status: "active", validUntil: { $lt: new Date() } },
    { $set: { status: "expired" } }
  );
  return result.modifiedCount;
};

discountSchema.statics.deleteOldExpired = async function (daysOld = 90, batchSize = 1000) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
 
  const now = new Date();
  const runCeiling = new mongoose.Types.ObjectId();
 
  let totalDeleted = 0;
  const allDeletedIds = [];
 
  while (true) {
    const batch = await this.find(
      {
        status:     { $in: ["expired", "exhausted"] },
        validUntil: { $lt: cutoff },
        _id:        { $lt: runCeiling },
 
        'usageLimit.currentUses': { $eq: 0 },
 
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
    allDeletedIds.push(...ids);
 
    await new Promise((resolve) => setImmediate(resolve));
  }
 
  return { totalDeleted, deletedIds: allDeletedIds };
};


export { PRODUCT_CATEGORIES };

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

discountSchema.pre("save", function (next) {
  if (this.isNew && this.type === "fixed" && this.remainingBalance === null) {
    this.remainingBalance = this.value;
  }

  if (this.validUntil <= new Date() && this.status === "active") {
    this.status = "expired";
  }

  // FIX #4 — flip to exhausted when remainingBalance is administratively set
  // to zero via updateDiscount (not just via recordUsage).
  if (
    this.type === "fixed" &&
    this.remainingBalance === 0 &&
    this.status === "active"
  ) {
    this.status = "exhausted";
  }

  if (this.type === "percentage" && this.value > 100) {
    this.value = 100;
  }

  next();
});

export default mongoose.model("Discount", discountSchema);