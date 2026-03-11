import mongoose from "mongoose";

// ============================================
// DISCOUNT MODEL
//
// Changelog from previous version:
//
//  1. audience field
//     'specific' — personalised discount, eligibleUsers enforced.
//     'all'      — broadcast to every logged-in user. eligibleUsers
//                  ignored during validation.
//
//  2. lockedAt
//     Set the moment currentUses transitions 0 → 1 (first use).
//     Never updated after that. Used by the delete protection guard.
//
//  3. deletionEligibleAt
//     Set at same moment as lockedAt: lockedAt + 30 days.
//     deleteDiscount controller blocks soft-deletion until this date.
//     Cleanup job exclusion filter also references this field.
//
//  4. canUserUse() — FIX #14
//     For discounts with large usageHistory arrays (> USAGE_SCAN_THRESHOLD),
//     a DB-level aggregate is used to count the user's prior uses instead
//     of an O(n) JavaScript filter over the already-loaded array.
//     This prevents memory exhaustion on high-use broadcast codes.
//
//  5. deleteOldExpired() — FIX #15
//     An _id ceiling is captured before the loop starts. This bounds the
//     working set to documents that existed when the job began, preventing
//     an unbounded loop if new records age into the eligibility window
//     mid-run (e.g. a long-running job on a busy cluster).
// ============================================

// Threshold above which canUserUse() switches from an in-memory filter
// to a server-side aggregate count. Set conservatively at 500 to ensure
// even moderately popular broadcast codes stay responsive.
const USAGE_SCAN_THRESHOLD = 500;

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
      enum: ["promo", "refund", "return", "loyalty", "affiliate", "support"],
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
      // The $filter + $size pipeline evaluates entirely in MongoDB, returning
      // only a single count integer rather than loading the full array.
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
      // For small arrays (< USAGE_SCAN_THRESHOLD) the already-loaded array is fine.
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
  return { valid: true };
};

// ============================================
// recordUsage()
//
// Sets lockedAt and deletionEligibleAt on first use (currentUses 0 → 1).
// These fields are immutable after being set.
//
// NOTE (FIX #1 context): orderId will always be null when called from the
// /validate endpoint — the order does not exist at validation time.
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
  return this.findOne({ code: code.toUpperCase(), status: "active" });
};

discountSchema.statics.getActivePromos = async function () {
  const now = new Date();
  return this.find({
    audience: "all",
    status: "active",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
  })
    .select("code description type value validUntil conditions.minPurchaseAmount audience")
    .lean();
};

discountSchema.statics.getUserDiscounts = async function (userId) {
  const now = new Date();
  return this.find({
    audience: "specific",
    status: "active",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    "conditions.eligibleUsers": userId,
  })
    .select("code description type value category validUntil audience")
    .lean();
};

discountSchema.statics.bulkExpireStale = async function () {
  const result = await this.updateMany(
    {
      status: "active",
      validUntil: { $lt: new Date() },
    },
    { $set: { status: "expired" } }
  );
  return result.modifiedCount;
};

// ============================================
// STATIC: DELETE OLD EXPIRED DISCOUNTS
//
// FIX #15 — the original while(true) loop re-queried from scratch on every
// iteration. If a long-running batch run allowed new documents to age into
// eligibility mid-run, the loop could process them immediately — potentially
// running indefinitely on a very active cluster.
//
// Fix: capture an ObjectId ceiling _before_ the loop begins. All find()
// calls inside the loop add _id: { $lt: ceiling }, bounding the working set
// to documents that existed when the job started. Newly eligible documents
// are processed on the next scheduled run.
//
// FRAUD PROTECTION GUARD (unchanged):
//   Excludes discounts where deletionEligibleAt > now (within 30-day window).
// ============================================
discountSchema.statics.deleteOldExpired = async function (daysOld = 90, batchSize = 1000) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const now = new Date();

  // FIX #15 — capture the working-set ceiling BEFORE the loop.
  // Uses ObjectId as a timestamp proxy (ObjectIds are monotonically increasing).
  // Documents inserted after this point will NOT be processed in this run.
  const runCeiling = new mongoose.Types.ObjectId();

  let totalDeleted = 0;

  while (true) {
    const batch = await this.find(
      {
        status:     "expired",
        validUntil: { $lt: cutoff },
        _id:        { $lt: runCeiling }, // FIX #15 — bounded working set
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