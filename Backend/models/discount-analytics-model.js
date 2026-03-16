import mongoose from "mongoose";
import { PRODUCT_CATEGORIES } from "./discount-model.js";

// ============================================
// DISCOUNT ANALYTICS MODEL
//
// One document per discount code. Stores pre-aggregated performance
// snapshots so the analytics API never aggregates Discount.usageHistory
// or Order collections on the fly.
//
// Sync lifecycle:
//   - Created on first redemption via syncDiscountAfterRedemption()
//   - Updated after every subsequent redemption (fire-and-forget)
//   - Full re-sync available via syncAllDiscountAnalytics() (admin / CRON)
//
// Revenue figures come from Order documents (not usageHistory.order refs)
// because usageHistory.order is null at /validate time and only populated
// once the order is created. The service queries:
//   Order.find({ discountCode: discount.code, "paymentInfo.status": "success" })
//
// Cross-domain integration:
//   CustomerAnalytics.discountEngagement is populated during
//   syncCustomerAnalytics() and provides the customer-side view of discount
//   usage (savings, dependency, favourite category). This model holds the
//   discount-side view (ROI, redemption rate, segment breakdown).
// ============================================

// ============================================
// SUB-SCHEMA: Daily redemption tick
// Used to build trend sparklines in the admin UI.
// Capped at 365 entries (one per calendar day) — older days are dropped
// by the service during sync to keep document size bounded.
// ============================================
const dailyRedemptionSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    redemptions: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Sum of discountAmount for all redemptions on this day
    discountCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Sum of order revenue on this day from orders that used this code.
    // Null when no orders have been matched yet for the day.
    revenueInfluenced: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ============================================
// SUB-SCHEMA: Per-category redemption breakdown
// Tracks how the discount was used across PRODUCT_CATEGORIES.
// Only populated for category-restricted codes and for unrestricted codes
// where item-level data was passed to /validate.
// ============================================
const categoryBreakdownSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: PRODUCT_CATEGORIES,
      required: true,
    },
    redemptions: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenueInfluenced: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ============================================
// SUB-SCHEMA: Per-RFM-segment redemption breakdown
// Joined from CustomerAnalytics.rfm.segment at sync time.
// Lets admins see "Champions used this code 40% of the time" etc.
// ============================================
const segmentBreakdownSchema = new mongoose.Schema(
  {
    segment: {
      type: String,
      enum: [
        "Champions",
        "Loyal Customers",
        "Potential Loyalists",
        "New Customers",
        "Promising",
        "Need Attention",
        "About To Sleep",
        "At Risk",
        "Cannot Lose Them",
        "Hibernating",
        "Lost",
        "Unknown", // fallback when CustomerAnalytics doc doesn't exist yet
      ],
      required: true,
    },
    redemptions: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalSavings: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenueInfluenced: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ============================================
// SUB-SCHEMA: Per-value-tier redemption breakdown
// Parallel to segmentBreakdown but grouped by CustomerAnalytics.valueTier.
// Useful for "VIP customers accounted for X% of discount cost" KPI.
// ============================================
const valueTierBreakdownSchema = new mongoose.Schema(
  {
    tier: {
      type: String,
      enum: ["VIP", "High Value", "Medium Value", "Low Value", "New", "Unknown"],
      required: true,
    },
    redemptions: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalSavings: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenueInfluenced: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ============================================
// MAIN SCHEMA
// ============================================
const discountAnalyticsSchema = new mongoose.Schema(
  {
    // ============================================
    // IDENTITY — links back to the Discount document.
    // Both fields stored for resilience: discountId for O(1) joins,
    // discountCode for human-readable audit queries.
    // ============================================
    discountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Discount",
      required: true,
      unique: true,
      index: true,
    },

    discountCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // Denormalised metadata — avoids a Discount lookup on every analytics read.
    // Updated during each sync so it stays current with discount mutations.
    meta: {
      type: {
        type: String,
        enum: ["percentage", "fixed"],
      },
      value: {
        type: Number,
        default: 0,
      },
      category: {
        type: String,
        enum: ["promo", "refund", "return", "loyalty", "affiliate", "support"],
      },
      audience: {
        type: String,
        enum: ["all", "specific"],
      },
      // Whether this discount has eligibleProductCategories restrictions
      isCategoryRestricted: {
        type: Boolean,
        default: false,
      },
      eligibleProductCategories: {
        type: [String],
        default: [],
      },
      validFrom: Date,
      validUntil: Date,
      status: {
        type: String,
        enum: ["active", "inactive", "expired"],
      },
      isCompensation: {
        type: Boolean,
        default: false,
      },
    },

    // ============================================
    // REDEMPTION METRICS
    // Core usage counts. totalRedemptions mirrors Discount.usageLimit.currentUses
    // but is stored here independently so the analytics read path never touches
    // the Discount collection.
    // ============================================
    redemptions: {
      // Total number of times the code was redeemed
      total: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Unique users who redeemed (deduplicated)
      uniqueUsers: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Redemptions from first-time buyers (isFirstUse flag from recordUsage)
      firstTimeUsers: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Redemptions from returning users (total - firstTimeUsers)
      returningUsers: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Guest redemptions (userId was null at validate time)
      guestRedemptions: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // ============================================
    // FINANCIAL METRICS
    // ============================================
    financials: {
      // Total discount value given away (sum of discountAmount across all redemptions)
      totalDiscountCost: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Average discount amount per redemption
      avgDiscountAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Sum of totalPrice from orders where this discount code was applied.
      // Source: Order.find({ discountCode: code }) — NOT usageHistory.order refs
      // because those are null at /validate time.
      totalRevenueInfluenced: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Average order value for orders that used this code
      avgOrderValue: {
        type: Number,
        default: 0,
        min: 0,
      },

      // ROI = (totalRevenueInfluenced - totalDiscountCost) / totalDiscountCost * 100
      // Null when totalDiscountCost === 0 (code was never redeemed).
      roi: {
        type: Number,
        default: null,
      },

      // Incremental revenue = revenueInfluenced - avgOrderValue of non-discount orders.
      // Null until baseline is established. Set manually or via future ML integration.
      incrementalRevenue: {
        type: Number,
        default: null,
      },

      // For category-restricted codes: the sum of eligible-item subtotals
      // across all redemptions. This is the actual base the % was applied to.
      // Null for unrestricted codes.
      totalEligibleSubtotal: {
        type: Number,
        default: null,
      },
    },

    // ============================================
    // CONVERSION METRICS
    // Ratios that indicate discount effectiveness.
    // ============================================
    conversion: {
      // Percentage of users who, having redeemed this code, placed a second
      // order within 90 days (without a discount). Signals whether the discount
      // acquired loyal customers or one-time buyers.
      // Null until sufficient data exists (< 10 redeemers).
      postRedemptionRetentionRate: {
        type: Number,
        default: null,
        min: 0,
        max: 100,
      },

      // Average number of days between redemption and next purchase (no discount).
      // Null when postRedemptionRetentionRate is null.
      avgDaysToNextPurchase: {
        type: Number,
        default: null,
        min: 0,
      },

      // For audience:'all' broadcast codes — ratio of redemptions to estimated
      // exposure (derived from active user count at time of first redemption).
      // Set to null for audience:'specific' codes.
      broadcastRedemptionRate: {
        type: Number,
        default: null,
        min: 0,
        max: 100,
      },

      // For audience:'specific' codes — redemptions / eligibleUsers count.
      // Null for audience:'all' codes.
      targetedRedemptionRate: {
        type: Number,
        default: null,
        min: 0,
        max: 100,
      },
    },

    // ============================================
    // BREAKDOWNS
    // Pre-aggregated splits. Each array is re-built from scratch on every sync
    // so there is no incremental merge logic to maintain.
    // ============================================

    // Redemption counts per PRODUCT_CATEGORIES value.
    // Empty array for codes where no item-level data was passed to /validate.
    categoryBreakdown: {
      type: [categoryBreakdownSchema],
      default: [],
    },

    // Redemption counts per CustomerAnalytics RFM segment.
    segmentBreakdown: {
      type: [segmentBreakdownSchema],
      default: [],
    },

    // Redemption counts per CustomerAnalytics valueTier.
    valueTierBreakdown: {
      type: [valueTierBreakdownSchema],
      default: [],
    },

    // ============================================
    // TIME-SERIES
    // Rolling 365-day window of daily redemption activity.
    // Entries older than 365 days are pruned during sync.
    // Used by the admin UI trend sparklines.
    // ============================================
    dailyRedemptions: {
      type: [dailyRedemptionSchema],
      default: [],
    },

    // ============================================
    // PEAK USAGE
    // Derived from dailyRedemptions during sync.
    // Stored separately so the peak can be surfaced in list views
    // without loading the full dailyRedemptions array.
    // ============================================
    peakUsage: {
      date: {
        type: Date,
        default: null,
      },
      redemptions: {
        type: Number,
        default: 0,
      },
      // Day of week of peak (0 = Sunday, 6 = Saturday).
      // Useful for scheduling future promotions.
      dayOfWeek: {
        type: Number,
        default: null,
        min: 0,
        max: 6,
      },
    },

    // ============================================
    // COMPARISON BASELINE
    // Snapshot of store-wide averages captured at sync time.
    // Used to contextualise this discount's performance relative to the store.
    // e.g. "This code's AOV was 23% above baseline".
    // ============================================
    baseline: {
      // Store-wide average order value at last sync
      storeAvgOrderValue: {
        type: Number,
        default: null,
      },

      // Store-wide average discount amount at last sync
      storeAvgDiscountAmount: {
        type: Number,
        default: null,
      },

      // AOV lift: ((this code's AOV - baseline AOV) / baseline AOV) * 100
      // Positive = this discount correlates with higher-value orders.
      aovLiftPercent: {
        type: Number,
        default: null,
      },
    },

    // ============================================
    // SYNC METADATA
    // ============================================

    // ISO timestamp of the most recent full sync
    lastSyncedAt: {
      type: Date,
      default: null,
    },

    // How many times this document has been synced
    syncCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Set to true if the last sync encountered an error.
    // Cleared on next successful sync.
    syncError: {
      type: Boolean,
      default: false,
    },

    syncErrorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    strict: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================

// Primary lookup by discountId (unique enforced at schema level)
// and by discountCode for human-readable queries.
discountAnalyticsSchema.index({ discountCode: 1 });

// Leaderboard queries: top codes by ROI, revenue influenced, redemption count
discountAnalyticsSchema.index({ "financials.roi": -1 });
discountAnalyticsSchema.index({ "financials.totalRevenueInfluenced": -1 });
discountAnalyticsSchema.index({ "redemptions.total": -1 });

// Category / type filtering in the admin analytics tab
discountAnalyticsSchema.index({ "meta.category": 1, "financials.roi": -1 });
discountAnalyticsSchema.index({ "meta.type": 1, "financials.roi": -1 });
discountAnalyticsSchema.index({ "meta.audience": 1, "redemptions.total": -1 });

// Status filter (admin may want to see only active or expired code performance)
discountAnalyticsSchema.index({ "meta.status": 1, "redemptions.total": -1 });

// Stale-sync detection — CRON finds documents not synced in > 24 hours
discountAnalyticsSchema.index({ lastSyncedAt: 1 });

// Error queue — quick lookup of documents that need re-sync
discountAnalyticsSchema.index(
  { syncError: 1 },
  { partialFilterExpression: { syncError: true } }
);

// ============================================
// VIRTUALS
// ============================================

// Human-readable ROI label ("3.2x return", "No data")
discountAnalyticsSchema.virtual("roiLabel").get(function () {
  if (this.financials.roi === null) return "No data";
  if (this.financials.roi < 0) return "Negative ROI";
  return `${(this.financials.roi / 100 + 1).toFixed(1)}x return`;
});

// Whether this code has been redeemed at all
discountAnalyticsSchema.virtual("hasRedemptions").get(function () {
  return this.redemptions.total > 0;
});

// Discount cost as a percentage of revenue influenced — the "discount rate"
// as experienced in practice. Null when no revenue data exists.
discountAnalyticsSchema.virtual("effectiveDiscountRate").get(function () {
  if (
    !this.financials.totalRevenueInfluenced ||
    this.financials.totalRevenueInfluenced === 0
  ) {
    return null;
  }
  return (
    Math.round(
      (this.financials.totalDiscountCost /
        this.financials.totalRevenueInfluenced) *
        100 *
        100
    ) / 100
  );
});

// Ratio of unique users to total redemptions.
// < 1 means some users redeemed more than once (multi-use code).
// === 1 means every redeemer used it exactly once.
discountAnalyticsSchema.virtual("uniqueRedemptionRatio").get(function () {
  if (this.redemptions.total === 0) return null;
  return (
    Math.round((this.redemptions.uniqueUsers / this.redemptions.total) * 100) /
    100
  );
});

// ============================================
// STATIC METHODS
// ============================================

/**
 * Upsert a DiscountAnalytics document by discountId.
 * Called by the service after building the full analytics payload —
 * never called directly from controllers.
 *
 * @param {ObjectId} discountId
 * @param {Object}   payload     — full update object from the service
 * @returns {Promise<Document>}
 */
discountAnalyticsSchema.statics.upsertForDiscount = async function (
  discountId,
  payload
) {
  return this.findOneAndUpdate(
    { discountId },
    { $set: payload },
    { upsert: true, new: true, runValidators: true }
  );
};

/**
 * Return the top N discount codes by ROI, filtered by optional category.
 *
 * @param {number}  limit
 * @param {string}  [category]  — one of the discount category enum values
 * @returns {Promise<Array>}
 */
discountAnalyticsSchema.statics.getTopByROI = async function (
  limit = 10,
  category = null
) {
  const filter = {
    "financials.roi": { $ne: null },
    "redemptions.total": { $gt: 0 },
  };
  if (category) filter["meta.category"] = category;

  return this.find(filter)
    .sort({ "financials.roi": -1 })
    .limit(limit)
    .lean();
};

/**
 * Return aggregate ROI stats grouped by discount category
 * (promo / return / loyalty / etc.).
 * Used by the admin discount analytics overview KPI cards.
 *
 * @returns {Promise<Array>}
 */
discountAnalyticsSchema.statics.getROIByCategory = async function () {
  return this.aggregate([
    { $match: { "redemptions.total": { $gt: 0 } } },
    {
      $group: {
        _id: "$meta.category",
        totalCodes: { $sum: 1 },
        totalRedemptions: { $sum: "$redemptions.total" },
        totalDiscountCost: { $sum: "$financials.totalDiscountCost" },
        totalRevenueInfluenced: { $sum: "$financials.totalRevenueInfluenced" },
        avgROI: { $avg: "$financials.roi" },
        avgAOV: { $avg: "$financials.avgOrderValue" },
      },
    },
    {
      $addFields: {
        computedROI: {
          $cond: [
            { $gt: ["$totalDiscountCost", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ["$totalRevenueInfluenced", "$totalDiscountCost"] },
                    "$totalDiscountCost",
                  ],
                },
                100,
              ],
            },
            null,
          ],
        },
      },
    },
    { $sort: { totalRevenueInfluenced: -1 } },
  ]);
};

/**
 * Return aggregate ROI stats grouped by discount type (percentage / fixed).
 * Lets admins compare which discount mechanic drives better ROI.
 *
 * @returns {Promise<Array>}
 */
discountAnalyticsSchema.statics.getROIByType = async function () {
  return this.aggregate([
    { $match: { "redemptions.total": { $gt: 0 } } },
    {
      $group: {
        _id: "$meta.type",
        totalCodes: { $sum: 1 },
        totalRedemptions: { $sum: "$redemptions.total" },
        totalDiscountCost: { $sum: "$financials.totalDiscountCost" },
        totalRevenueInfluenced: { $sum: "$financials.totalRevenueInfluenced" },
        avgROI: { $avg: "$financials.roi" },
        avgDiscountAmount: { $avg: "$financials.avgDiscountAmount" },
        avgAOV: { $avg: "$financials.avgOrderValue" },
      },
    },
    { $sort: { totalRevenueInfluenced: -1 } },
  ]);
};

/**
 * Store-wide discount analytics summary for the overview KPI panel.
 * Returns overall totals + per-category + per-type breakdowns in one
 * aggregation pass using $facet — mirrors getCustomerAnalyticsSummary().
 *
 * @returns {Promise<Object>}
 */
discountAnalyticsSchema.statics.getSummary = async function () {
  const result = await this.aggregate([
    {
      $facet: {
        // Overall store-wide discount performance
        overall: [
          {
            $group: {
              _id: null,
              totalCodes: { $sum: 1 },
              totalCodesWithRedemptions: {
                $sum: { $cond: [{ $gt: ["$redemptions.total", 0] }, 1, 0] },
              },
              totalRedemptions: { $sum: "$redemptions.total" },
              totalUniqueUsers: { $sum: "$redemptions.uniqueUsers" },
              totalDiscountCost: { $sum: "$financials.totalDiscountCost" },
              totalRevenueInfluenced: {
                $sum: "$financials.totalRevenueInfluenced",
              },
              avgROI: { $avg: "$financials.roi" },
              avgAOV: { $avg: "$financials.avgOrderValue" },
            },
          },
        ],

        // Breakdown by discount category
        byCategory: [
          { $match: { "redemptions.total": { $gt: 0 } } },
          {
            $group: {
              _id: "$meta.category",
              totalCodes: { $sum: 1 },
              totalRedemptions: { $sum: "$redemptions.total" },
              totalDiscountCost: { $sum: "$financials.totalDiscountCost" },
              totalRevenueInfluenced: { $sum: "$financials.totalRevenueInfluenced" },
              avgROI: { $avg: "$financials.roi" },
            },
          },
          { $sort: { totalRevenueInfluenced: -1 } },
        ],

        // Breakdown by discount type (percentage vs fixed)
        byType: [
          { $match: { "redemptions.total": { $gt: 0 } } },
          {
            $group: {
              _id: "$meta.type",
              totalCodes: { $sum: 1 },
              totalRedemptions: { $sum: "$redemptions.total" },
              totalDiscountCost: { $sum: "$financials.totalDiscountCost" },
              totalRevenueInfluenced: { $sum: "$financials.totalRevenueInfluenced" },
              avgROI: { $avg: "$financials.roi" },
              avgDiscountAmount: { $avg: "$financials.avgDiscountAmount" },
            },
          },
          { $sort: { totalRevenueInfluenced: -1 } },
        ],

        // Top 5 performing codes by ROI (for overview quick-wins panel)
        topByROI: [
          {
            $match: {
              "financials.roi": { $ne: null },
              "redemptions.total": { $gt: 0 },
            },
          },
          { $sort: { "financials.roi": -1 } },
          { $limit: 5 },
          {
            $project: {
              discountCode: 1,
              "meta.category": 1,
              "meta.type": 1,
              "redemptions.total": 1,
              "financials.roi": 1,
              "financials.totalRevenueInfluenced": 1,
              "financials.totalDiscountCost": 1,
            },
          },
        ],

        // Top 5 by total revenue influenced (high-volume codes)
        topByRevenue: [
          { $match: { "redemptions.total": { $gt: 0 } } },
          { $sort: { "financials.totalRevenueInfluenced": -1 } },
          { $limit: 5 },
          {
            $project: {
              discountCode: 1,
              "meta.category": 1,
              "meta.type": 1,
              "redemptions.total": 1,
              "financials.roi": 1,
              "financials.totalRevenueInfluenced": 1,
              "financials.totalDiscountCost": 1,
            },
          },
        ],

        // Codes with negative or null ROI (cost more than they influenced)
        underperforming: [
          {
            $match: {
              "redemptions.total": { $gt: 0 },
              $or: [
                { "financials.roi": { $lt: 0 } },
                // Codes with discount cost but zero matched orders
                {
                  "financials.totalDiscountCost": { $gt: 0 },
                  "financials.totalRevenueInfluenced": 0,
                },
              ],
            },
          },
          { $sort: { "financials.roi": 1 } },
          { $limit: 5 },
          {
            $project: {
              discountCode: 1,
              "meta.category": 1,
              "redemptions.total": 1,
              "financials.roi": 1,
              "financials.totalDiscountCost": 1,
            },
          },
        ],
      },
    },
  ]);

  return result[0];
};

/**
 * Find all DiscountAnalytics documents that are stale (lastSyncedAt older
 * than `thresholdHours` hours) or have never been synced. Used by the CRON
 * job to build the re-sync queue.
 *
 * @param {number} thresholdHours — default 24
 * @returns {Promise<Array<{ discountId, discountCode }>>}
 */
discountAnalyticsSchema.statics.findStale = async function (
  thresholdHours = 24
) {
  const threshold = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);
  return this.find(
    {
      $or: [
        { lastSyncedAt: null },
        { lastSyncedAt: { $lt: threshold } },
        { syncError: true },
      ],
    },
    { discountId: 1, discountCode: 1, syncError: 1, lastSyncedAt: 1 }
  ).lean();
};

export default mongoose.model("DiscountAnalytics", discountAnalyticsSchema);