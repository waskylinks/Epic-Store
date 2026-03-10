import mongoose from "mongoose";

// ============================================
// DISCOUNT MODEL
//
// Changelog from previous version:
//
//  1. audience field (NEW)
//     'specific' — personalised discount, eligibleUsers enforced.
//     'all'      — broadcast to every logged-in user. eligibleUsers
//                  ignored during validation. Used for seasonal promos.
//
//  2. lockedAt (NEW)
//     Set the moment currentUses transitions 0 → 1 (first use).
//     Never updated after that. Used by the delete protection guard.
//
//  3. deletionEligibleAt (NEW)
//     Set at same moment as lockedAt: lockedAt + 30 days.
//     deleteDiscount controller blocks soft-deletion until this date.
//     Cleanup job exclusion filter also references this field.
//
//  4. canUserUse() updated
//     audience:'all' bypasses eligibleUsers check entirely.
//     usesPerUser limit still applies — a broadcast promo with no
//     per-user cap is a financial risk regardless of audience.
//
//  5. getActivePromos() updated
//     Filters on audience:'all' instead of eligibleUsers:{$size:0}.
//     Cleaner, explicit, and future-proof.
//
//  6. getUserDiscounts() — stays narrow (eligibleUsers-scoped only).
//     The controller (getMyDiscounts) owns the combined query that
//     merges audience:'all' + personal discounts in one response.
//
//  7. deleteOldExpired() updated
//     Excludes discounts within their fraud-protection window
//     (deletionEligibleAt exists AND deletionEligibleAt > now).
//     Closes the backdoor where the cleanup job hard-deletes a
//     recently-used discount before the 30-day protection window ends.
// ============================================

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
    // 'specific' — personalised code scoped to eligibleUsers list.
    //              Compensation, refund, loyalty, affiliate codes.
    // 'all'      — broadcast to every authenticated user.
    //              Seasonal promos, sitewide sales.
    //              eligibleUsers is ignored during validation when this is set.
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

    // Usage limits
    usageLimit: {
      totalUses: {
        type: Number,
        default: null, // null = unlimited
      },
      usesPerUser: {
        type: Number,
        default: 1,
        // Applies to ALL discounts regardless of audience.
        // A broadcast promo still enforces one use per user
        // to prevent a single customer exhausting a sitewide offer.
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
      // Sparse: only populated for personalised discounts (~small %).
      // Ignored during validation when audience === 'all'.
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
    // 16 MB document limit. The TODO below wires the separate collection.
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
    // FRAUD PROTECTION FIELDS (NEW)
    // ============================================

    // Set when currentUses transitions 0 → 1 (first use of this code).
    // Never updated after that point.
    // Used as the reference timestamp for deletionEligibleAt.
    lockedAt: {
      type: Date,
      default: null,
    },

    // lockedAt + 30 days. Set at same time as lockedAt.
    // deleteDiscount controller rejects soft-deletion requests before
    // this date to prevent post-use cover-up.
    // deleteOldExpired cleanup job excludes discounts where
    // deletionEligibleAt > now for the same reason.
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
// Designed for 100M+ documents.
//
// Key decisions:
//  1. (code, status) — primary lookup path for validate endpoint.
//     Both fields always present; selectivity is high on `code`.
//
//  2. (status, category, validFrom, validUntil) — covers the admin
//     list query which almost always filters by status + category,
//     then sorts/ranges on dates. Partial index on status:"active"
//     cuts index size ~60-70% since expired/inactive docs are rarely
//     queried live.
//
//  3. (audience, status, validUntil) — NEW. Powers:
//       - getActivePromos() static (audience:'all')
//       - hasNewDiscounts controller (audience:'all', status:'active')
//       - getMyDiscounts controller combined query
//     Partial on status:'active' keeps it lean.
//
//  4. (conditions.eligibleUsers, status) — sparse so it only indexes
//     documents that actually have eligible users (personalised
//     discounts are a tiny fraction of total volume).
//
//  5. (validUntil, status) — used exclusively by the cleanup job to
//     find expired-but-still-marked-active documents efficiently.
//
//  6. (deletionEligibleAt) — NEW. Used by deleteOldExpired() exclusion
//     filter to skip recently-used discounts in the cleanup pass.
//     Sparse because null values (never-used discounts) don't need
//     to participate in this index.
//
//  7. createdAt desc — default sort for admin list view.
// ============================================

// Primary lookup — validate cart flow
discountSchema.index({ code: 1, status: 1 });

// Admin list + date range queries; partial keeps it lean
discountSchema.index(
  { status: 1, category: 1, validFrom: 1, validUntil: 1 },
  { partialFilterExpression: { status: "active" } }
);

// Broadcast promo queries (hasNewDiscounts, getActivePromos, getMyDiscounts)
discountSchema.index(
  { audience: 1, status: 1, validUntil: 1 },
  { partialFilterExpression: { status: "active" } }
);

// Personalised discount lookup — sparse skips docs without eligibleUsers
discountSchema.index(
  { "conditions.eligibleUsers": 1, status: 1 },
  { sparse: true }
);

// Cleanup job — find active docs past their validUntil
discountSchema.index({ validUntil: 1, status: 1 });

// Fraud protection exclusion filter in deleteOldExpired()
// Sparse: null values (never-used discounts) are excluded from the index
discountSchema.index(
  { deletionEligibleAt: 1 },
  { sparse: true }
);

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

// Whether the discount is currently within its fraud-protection window.
// Used by the admin UI to show the lock icon and disable the deactivate button.
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
// audience:'all' — skips eligibleUsers check entirely.
//                  usesPerUser still enforced (financial protection).
//
// audience:'specific' — original behaviour: checks eligibleUsers first,
//                        then per-user usage count.
// ============================================
discountSchema.methods.canUserUse = async function (userId) {
  // Only enforce eligibleUsers for 'specific' audience discounts.
  // Broadcast discounts are open to all authenticated users.
  if (this.audience === "specific" && this.conditions.eligibleUsers.length > 0) {
    const isEligible = this.conditions.eligibleUsers.some(
      (u) => u.toString() === userId.toString()
    );
    if (!userId || !isEligible) {
      return { canUse: false, reason: "This discount is not available for you" };
    }
  }

  // Per-user usage cap applies regardless of audience.
  // Prevents a single user from using a broadcast promo multiple times.
  if (userId) {
    const userUsageCount = this.usageHistory.filter(
      (usage) => usage.user && usage.user.toString() === userId.toString()
    ).length;

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
// These fields are immutable after being set — subsequent calls to
// recordUsage() will not overwrite them.
// ============================================
discountSchema.methods.recordUsage = async function (userId, orderId, discountAmount) {
  const isFirstUse = this.usageLimit.currentUses === 0;

  this.usageHistory.push({ user: userId, order: orderId, discountAmount, usedAt: new Date() });
  this.usageLimit.currentUses += 1;

  // Lock the discount against premature deletion on first use only.
  // lockedAt and deletionEligibleAt are set once and never changed.
  if (isFirstUse) {
    const now = new Date();
    this.lockedAt = now;
    this.deletionEligibleAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  await this.save();

  // Return whether this was the first use so the controller can
  // include it in the DiscountAuditLog 'used' entry meta.
  return { isFirstUse };
};

// ============================================
// STATIC METHODS
// ============================================

discountSchema.statics.findActiveByCode = async function (code) {
  return this.findOne({ code: code.toUpperCase(), status: "active" });
};

// ============================================
// getActivePromos()
//
// Updated: filters on audience:'all' instead of
// eligibleUsers:{$size:0}. Semantically correct and uses the new
// (audience, status, validUntil) index directly.
// ============================================
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

// ============================================
// getUserDiscounts()
//
// Intentionally narrow — returns eligibleUsers-scoped discounts only.
// The getMyDiscounts controller merges this result with audience:'all'
// discounts and stamps lastSeenDiscountsAt on the user.
// ============================================
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

// ============================================
// STATIC: BULK EXPIRE (used by cleanup job)
// Uses updateMany — a single atomic write across matched docs.
// Far cheaper than loading + saving each document individually.
// ============================================
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
// Hard-deletes expired discounts older than `daysOld` days.
// Runs in batches to avoid locking the collection on large datasets.
//
// FRAUD PROTECTION GUARD (NEW):
//   Excludes any discount where deletionEligibleAt > now.
//   This prevents the cleanup job from hard-deleting a recently-used
//   discount that is still within its 30-day protection window —
//   closing the backdoor where cleanup is used as a proxy delete
//   to hide evidence of a suspicious compensation code being used.
// ============================================
discountSchema.statics.deleteOldExpired = async function (daysOld = 90, batchSize = 1000) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const now = new Date();
  let totalDeleted = 0;

  while (true) {
    // Find a batch of IDs first — avoids holding a write lock across
    // the full result set.
    const batch = await this.find(
      {
        status: "expired",
        validUntil: { $lt: cutoff },
        // Fraud protection exclusion:
        // Skip discounts still within their 30-day post-use protection window.
        // $not with $gt means: deletionEligibleAt does not exist OR
        // deletionEligibleAt is null OR deletionEligibleAt <= now.
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