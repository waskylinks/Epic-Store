import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import DiscountAnalytics from "../models/discount-analytics-model.js";
import Discount from "../models/discount-model.js";
import {
  syncDiscountAnalytics,
  syncAllDiscountAnalytics,
  getDiscountAnalyticsSummary,
} from "../Services/discount-analytics-service.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";
import mongoose from "mongoose";

// ============================================
// HELPERS
// ============================================

const isValidObjectId = (s) => mongoose.Types.ObjectId.isValid(s);

/**
 * Safely parse a positive integer query param.
 * Returns defaultVal when the param is absent, non-numeric, or <= 0.
 */
const parsePositiveInt = (val, defaultVal) => {
  const n = parseInt(val, 10);
  return isNaN(n) || n <= 0 ? defaultVal : n;
};

// ============================================
// CACHE KEYS & TTLs
// ============================================

const CACHE = {
  OVERVIEW:        { key: "discount_analytics_overview",        ttl: 300  },
  ROI_BY_CATEGORY: { key: "discount_analytics_roi_by_category", ttl: 300  },
  ROI_BY_TYPE:     { key: "discount_analytics_roi_by_type",     ttl: 300  },
  TOP_PERFORMERS:  { key: "discount_analytics_top_performers",  ttl: 300  },
  TRENDS:          (timeframe) => ({
    key: `discount_analytics_trends_${timeframe}`,
    ttl: 600,
  }),
};

// ============================================
// OVERVIEW KPI PANEL
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/overview
 * @access Admin
 *
 * Returns the store-wide discount performance summary used to populate
 * the overview KPI cards, top-performers panels, and underperforming list.
 *
 * Delegates entirely to DiscountAnalytics.getSummary() (single $facet
 * aggregation) so there are no per-request Order or Discount queries.
 */
export const getDiscountAnalyticsOverview = handleAsyncError(
  async (req, res, next) => {
    const cached = await getCache(CACHE.OVERVIEW.key);
    if (cached) {
      return res.status(200).json({ success: true, ...cached, fromCache: true });
    }

    const summary = await getDiscountAnalyticsSummary();

    const overall = summary.overall[0] ?? {
      totalCodes:               0,
      totalCodesWithRedemptions: 0,
      totalRedemptions:         0,
      totalUniqueUsers:         0,
      totalDiscountCost:        0,
      totalRevenueInfluenced:   0,
      avgROI:                   null,
      avgAOV:                   0,
    };

    // Redemption rate: codes that have at least one redemption / all codes
    const redemptionRate =
      overall.totalCodes > 0
        ? Math.round(
            (overall.totalCodesWithRedemptions / overall.totalCodes) * 100 * 10
          ) / 10
        : 0;

    // Overall ROI from first-principles (more accurate than avg of per-code ROIs)
    const overallROI =
      overall.totalDiscountCost > 0
        ? Math.round(
            ((overall.totalRevenueInfluenced - overall.totalDiscountCost) /
              overall.totalDiscountCost) *
              100 *
              100
          ) / 100
        : null;

    const response = {
      overall: {
        ...overall,
        redemptionRate,
        overallROI,
      },
      byCategory:      summary.byCategory      ?? [],
      byType:          summary.byType           ?? [],
      topByROI:        summary.topByROI         ?? [],
      topByRevenue:    summary.topByRevenue      ?? [],
      underperforming: summary.underperforming   ?? [],
    };

    await setCache(CACHE.OVERVIEW.key, response, CACHE.OVERVIEW.ttl);
    res.status(200).json({ success: true, ...response });
  }
);

// ============================================
// ROI BY DISCOUNT CATEGORY
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/roi-by-category
 * @access Admin
 *
 * Returns ROI, revenue influenced, and discount cost aggregated per
 * discount category (promo / return / loyalty / affiliate / support / refund).
 * Includes a computed overall ROI per category derived from totals rather
 * than averaging per-code ROIs, which avoids small-sample skew.
 */
export const getROIByCategory = handleAsyncError(async (req, res, next) => {
  const cached = await getCache(CACHE.ROI_BY_CATEGORY.key);
  if (cached) {
    return res.status(200).json({ success: true, ...cached, fromCache: true });
  }

  const raw = await DiscountAnalytics.getROIByCategory();

  const categories = raw.map((cat) => ({
    category:               cat._id,
    totalCodes:             cat.totalCodes,
    totalRedemptions:       cat.totalRedemptions,
    totalDiscountCost:      Math.round(cat.totalDiscountCost * 100) / 100,
    totalRevenueInfluenced: Math.round(cat.totalRevenueInfluenced * 100) / 100,
    // computedROI: derived from category totals (not avg of per-code ROIs)
    roi: cat.computedROI !== null && cat.computedROI !== undefined
      ? Math.round(cat.computedROI * 100) / 100
      : null,
    avgAOV: Math.round((cat.avgAOV ?? 0) * 100) / 100,
  }));

  const response = {
    categories,
    summary: {
      totalDiscountCost:      categories.reduce((s, c) => s + c.totalDiscountCost, 0),
      totalRevenueInfluenced: categories.reduce((s, c) => s + c.totalRevenueInfluenced, 0),
    },
  };

  await setCache(CACHE.ROI_BY_CATEGORY.key, response, CACHE.ROI_BY_CATEGORY.ttl);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ROI BY DISCOUNT TYPE
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/roi-by-type
 * @access Admin
 *
 * Compares percentage vs fixed discount performance — ROI, avg discount
 * amount, and revenue influenced. Helps decide which discount mechanic
 * to favour in future campaigns.
 */
export const getROIByType = handleAsyncError(async (req, res, next) => {
  const cached = await getCache(CACHE.ROI_BY_TYPE.key);
  if (cached) {
    return res.status(200).json({ success: true, ...cached, fromCache: true });
  }

  const raw = await DiscountAnalytics.getROIByType();

  const types = raw.map((t) => {
    const roi =
      t.totalDiscountCost > 0
        ? Math.round(
            ((t.totalRevenueInfluenced - t.totalDiscountCost) /
              t.totalDiscountCost) *
              100 *
              100
          ) / 100
        : null;

    return {
      type:                   t._id,
      totalCodes:             t.totalCodes,
      totalRedemptions:       t.totalRedemptions,
      totalDiscountCost:      Math.round(t.totalDiscountCost * 100) / 100,
      totalRevenueInfluenced: Math.round(t.totalRevenueInfluenced * 100) / 100,
      avgDiscountAmount:      Math.round((t.avgDiscountAmount ?? 0) * 100) / 100,
      avgAOV:                 Math.round((t.avgAOV ?? 0) * 100) / 100,
      roi,
    };
  });

  const response = { types };

  await setCache(CACHE.ROI_BY_TYPE.key, response, CACHE.ROI_BY_TYPE.ttl);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// TOP PERFORMERS
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/top-performers
 * @access Admin
 *
 * Query params:
 *   limit    {number}  — max codes to return per list (default 10, max 50)
 *   category {string}  — filter to one discount category (optional)
 *   sortBy   {string}  — "roi" | "revenue" | "redemptions" (default "roi")
 */
export const getTopPerformers = handleAsyncError(async (req, res, next) => {
  const limit    = Math.min(parsePositiveInt(req.query.limit, 10), 50);
  const category = req.query.category ?? null;
  const sortBy   = req.query.sortBy   ?? "roi";

  const validSortBy = ["roi", "revenue", "redemptions"];
  if (!validSortBy.includes(sortBy)) {
    return next(
      new HandleError(
        `Invalid sortBy value. Must be one of: ${validSortBy.join(", ")}`,
        400
      )
    );
  }

  const cacheKey = `${CACHE.TOP_PERFORMERS.key}_${limit}_${category ?? "all"}_${sortBy}`;
  const cached   = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached, fromCache: true });
  }

  const sortFieldMap = {
    roi:         { "financials.roi": -1 },
    revenue:     { "financials.totalRevenueInfluenced": -1 },
    redemptions: { "redemptions.total": -1 },
  };

  const filter = { "redemptions.total": { $gt: 0 } };

  if (sortBy === "roi") {
    // Exclude codes with null ROI (no matched orders yet) from ROI leaderboard
    filter["financials.roi"] = { $ne: null };
  }

  if (category) {
    filter["meta.category"] = category;
  }

  const topCodes = await DiscountAnalytics.find(filter)
    .sort(sortFieldMap[sortBy])
    .limit(limit)
    .select(
      "discountCode meta.category meta.type meta.audience meta.status " +
      "redemptions.total redemptions.uniqueUsers " +
      "financials.roi financials.totalRevenueInfluenced " +
      "financials.totalDiscountCost financials.avgOrderValue " +
      "conversion.postRedemptionRetentionRate " +
      "baseline.aovLiftPercent peakUsage"
    )
    .lean();

  const response = {
    sortBy,
    category: category ?? "all",
    codes:    topCodes,
    count:    topCodes.length,
  };

  await setCache(cacheKey, response, CACHE.TOP_PERFORMERS.ttl);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// REDEMPTION TRENDS
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/trends
 * @access Admin
 *
 * Aggregates the dailyRedemptions time-series across ALL codes (or a
 * filtered subset) to produce a store-wide redemption trend chart.
 *
 * Query params:
 *   timeframe {string}  — "week" | "month" | "quarter" | "year" (default "month")
 *   category  {string}  — filter to one discount category (optional)
 *   type      {string}  — filter to "percentage" | "fixed" (optional)
 */
export const getRedemptionTrends = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", category, type } = req.query;

  validateTimeframe(timeframe, next);

  const cacheEntry = CACHE.TRENDS(
    `${timeframe}_${category ?? "all"}_${type ?? "all"}`
  );
  const cached = await getCache(cacheEntry.key);
  if (cached) {
    return res.status(200).json({ success: true, ...cached, fromCache: true });
  }

  const { currentPeriodStart } = getDateRanges(timeframe);

  const matchFilter = {};
  if (category) matchFilter["meta.category"] = category;
  if (type)     matchFilter["meta.type"]     = type;

  // Unwind dailyRedemptions, filter to the requested period, then
  // group by day to produce a single merged time-series across all codes.
  const trends = await DiscountAnalytics.aggregate([
    { $match: matchFilter },
    { $unwind: "$dailyRedemptions" },
    {
      $match: {
        "dailyRedemptions.date": { $gte: currentPeriodStart },
      },
    },
    {
      $group: {
        _id:               "$dailyRedemptions.date",
        redemptions:       { $sum: "$dailyRedemptions.redemptions" },
        discountCost:      { $sum: "$dailyRedemptions.discountCost" },
        revenueInfluenced: { $sum: "$dailyRedemptions.revenueInfluenced" },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id:  0,
        date: "$_id",
        redemptions:       1,
        discountCost:      { $round: ["$discountCost",      2] },
        revenueInfluenced: { $round: ["$revenueInfluenced", 2] },
        // Daily ROI: (revenueInfluenced - discountCost) / discountCost * 100
        // Null when discountCost is 0 to avoid division errors in the frontend.
        dailyROI: {
          $cond: [
            { $gt: ["$discountCost", 0] },
            {
              $round: [
                {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: ["$revenueInfluenced", "$discountCost"] },
                        "$discountCost",
                      ],
                    },
                    100,
                  ],
                },
                2,
              ],
            },
            null,
          ],
        },
      },
    },
  ]);

  // Period-level summary for the trend header KPIs
  const periodTotals = trends.reduce(
    (acc, day) => {
      acc.totalRedemptions       += day.redemptions;
      acc.totalDiscountCost      += day.discountCost;
      acc.totalRevenueInfluenced += day.revenueInfluenced;
      return acc;
    },
    { totalRedemptions: 0, totalDiscountCost: 0, totalRevenueInfluenced: 0 }
  );

  periodTotals.totalDiscountCost      = Math.round(periodTotals.totalDiscountCost      * 100) / 100;
  periodTotals.totalRevenueInfluenced = Math.round(periodTotals.totalRevenueInfluenced * 100) / 100;
  periodTotals.periodROI =
    periodTotals.totalDiscountCost > 0
      ? Math.round(
          ((periodTotals.totalRevenueInfluenced - periodTotals.totalDiscountCost) /
            periodTotals.totalDiscountCost) *
            100 *
            100
        ) / 100
      : null;

  const response = {
    timeframe,
    category: category ?? "all",
    type:     type     ?? "all",
    trends,
    summary:  periodTotals,
  };

  await setCache(cacheEntry.key, response, cacheEntry.ttl);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// SINGLE DISCOUNT ANALYTICS DETAIL
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/:discountId
 * @access Admin
 *
 * Returns the full DiscountAnalytics document for one discount code,
 * including segment breakdown, value tier breakdown, daily trend, and
 * all conversion metrics.
 *
 * Populates the detail drawer in the admin discounts UI.
 */
export const getDiscountAnalyticsDetail = handleAsyncError(
  async (req, res, next) => {
    const { discountId } = req.params;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    // No cache here — detail views are low-frequency and always need
    // the freshest sync timestamp, retention rate, and segment data.
    const analytics = await DiscountAnalytics.findOne({ discountId }).lean();

    if (!analytics) {
      // Could be a new code that has never been redeemed — no analytics doc yet.
      return next(
        new HandleError(
          "No analytics found for this discount. " +
            "Analytics are generated on first redemption.",
          404
        )
      );
    }

    res.status(200).json({ success: true, analytics });
  }
);

// ============================================
// SEGMENT BREAKDOWN FOR ONE CODE
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/:discountId/segments
 * @access Admin
 *
 * Returns the segmentBreakdown and valueTierBreakdown arrays for a single
 * discount code. Useful for the "Who used this code?" panel in the detail
 * drawer without loading the full analytics document.
 */
export const getDiscountSegmentBreakdown = handleAsyncError(
  async (req, res, next) => {
    const { discountId } = req.params;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    const analytics = await DiscountAnalytics.findOne(
      { discountId },
      {
        discountCode:      1,
        segmentBreakdown:  1,
        valueTierBreakdown: 1,
        "redemptions.total": 1,
        lastSyncedAt:      1,
      }
    ).lean();

    if (!analytics) {
      return next(new HandleError("No analytics found for this discount", 404));
    }

    res.status(200).json({
      success:            true,
      discountCode:       analytics.discountCode,
      totalRedemptions:   analytics.redemptions?.total ?? 0,
      segmentBreakdown:   analytics.segmentBreakdown   ?? [],
      valueTierBreakdown: analytics.valueTierBreakdown  ?? [],
      lastSyncedAt:       analytics.lastSyncedAt,
    });
  }
);

// ============================================
// REDEMPTION TREND FOR ONE CODE
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/:discountId/trend
 * @access Admin
 *
 * Returns the dailyRedemptions time-series for a single discount code,
 * sliced to the requested timeframe.
 *
 * Query params:
 *   timeframe {string} — "week" | "month" | "quarter" | "year" (default "month")
 */
export const getDiscountRedemptionTrend = handleAsyncError(
  async (req, res, next) => {
    const { discountId }     = req.params;
    const { timeframe = "month" } = req.query;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    validateTimeframe(timeframe, next);

    const { currentPeriodStart } = getDateRanges(timeframe);

    const analytics = await DiscountAnalytics.findOne(
      { discountId },
      { discountCode: 1, dailyRedemptions: 1, peakUsage: 1 }
    ).lean();

    if (!analytics) {
      return next(new HandleError("No analytics found for this discount", 404));
    }

    const trend = (analytics.dailyRedemptions ?? []).filter(
      (entry) => new Date(entry.date) >= currentPeriodStart
    );

    const periodTotals = trend.reduce(
      (acc, day) => {
        acc.totalRedemptions       += day.redemptions;
        acc.totalDiscountCost      += day.discountCost;
        acc.totalRevenueInfluenced += day.revenueInfluenced;
        return acc;
      },
      { totalRedemptions: 0, totalDiscountCost: 0, totalRevenueInfluenced: 0 }
    );

    res.status(200).json({
      success:      true,
      discountCode: analytics.discountCode,
      timeframe,
      trend,
      peakUsage:    analytics.peakUsage,
      summary:      {
        ...periodTotals,
        totalDiscountCost:      Math.round(periodTotals.totalDiscountCost      * 100) / 100,
        totalRevenueInfluenced: Math.round(periodTotals.totalRevenueInfluenced * 100) / 100,
      },
    });
  }
);

// ============================================
// ALL CODES — PAGINATED LIST WITH ANALYTICS
// ============================================

/**
 * @route  GET /api/v1/discount-analytics
 * @access Admin
 *
 * Cursor-based paginated list of all DiscountAnalytics documents.
 * Mirrors the pattern in getAllDiscounts (discount-controller.js).
 *
 * Query params:
 *   limit    {number}  — default 20, max 100
 *   cursor   {string}  — base64 pagination cursor
 *   category {string}  — filter by discount category
 *   type     {string}  — filter by discount type
 *   audience {string}  — filter by audience ("all" | "specific")
 *   sortBy   {string}  — "roi" | "revenue" | "redemptions" | "cost"
 *                        (default "revenue")
 *   minRedemptions {number} — only show codes with at least N redemptions
 */
export const getAllDiscountAnalytics = handleAsyncError(
  async (req, res, next) => {
    const {
      category,
      type,
      audience,
      cursor,
      sortBy = "revenue",
    } = req.query;

    const limit          = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const minRedemptions = parsePositiveInt(req.query.minRedemptions, 0);

    const validSortBy = ["roi", "revenue", "redemptions", "cost"];
    if (!validSortBy.includes(sortBy)) {
      return next(
        new HandleError(
          `Invalid sortBy value. Must be one of: ${validSortBy.join(", ")}`,
          400
        )
      );
    }

    const sortFieldMap = {
      roi:         { "financials.roi": -1 },
      revenue:     { "financials.totalRevenueInfluenced": -1 },
      redemptions: { "redemptions.total": -1 },
      cost:        { "financials.totalDiscountCost": -1 },
    };

    const filter = {};

    if (category)  filter["meta.category"] = category;
    if (type)      filter["meta.type"]     = type;
    if (audience)  filter["meta.audience"] = audience;

    if (minRedemptions > 0) {
      filter["redemptions.total"] = { $gte: minRedemptions };
    }

    if (sortBy === "roi") {
      // Only codes with a computable ROI make sense in an ROI sort
      filter["financials.roi"] = { $ne: null };
    }

    if (cursor) {
      try {
        const { id } = JSON.parse(
          Buffer.from(cursor, "base64").toString("utf8")
        );
        if (!isValidObjectId(id)) throw new Error("invalid id in cursor");
        filter._id = { $lt: new mongoose.Types.ObjectId(id) };
      } catch {
        return next(new HandleError("Invalid pagination cursor", 400));
      }
    }

    const docs = await DiscountAnalytics.find(filter)
      .sort(sortFieldMap[sortBy])
      .limit(limit + 1)
      .select(
        "discountCode meta redemptions.total redemptions.uniqueUsers " +
        "financials.roi financials.totalRevenueInfluenced " +
        "financials.totalDiscountCost financials.avgOrderValue " +
        "financials.avgDiscountAmount conversion.postRedemptionRetentionRate " +
        "conversion.targetedRedemptionRate baseline.aovLiftPercent " +
        "peakUsage lastSyncedAt"
      )
      .lean();

    const hasNextPage = docs.length > limit;
    if (hasNextPage) docs.pop();

    let nextCursor = null;
    if (hasNextPage && docs.length > 0) {
      const last = docs[docs.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ id: last._id })
      ).toString("base64");
    }

    res.status(200).json({
      success: true,
      analytics: docs,
      pagination: { limit, hasNextPage, nextCursor },
    });
  }
);

// ============================================
// MANUAL SYNC — SINGLE DISCOUNT
// ============================================

/**
 * @route  POST /api/v1/discount-analytics/:discountId/sync
 * @access Admin
 *
 * Triggers an immediate full re-sync for one discount code.
 * Useful after a batch of orders is manually reconciled or when
 * the admin notices a stale analytics document.
 *
 * Invalidates all analytics cache keys on success so the next
 * overview/trends request reflects the updated data.
 */
export const syncSingleDiscountAnalytics = handleAsyncError(
  async (req, res, next) => {
    const { discountId } = req.params;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    // Verify the discount exists before attempting sync
    const discount = await Discount.findById(discountId).select("_id").lean();
    if (!discount) {
      return next(new HandleError("Discount not found", 404));
    }

    try {
      const analytics = await syncDiscountAnalytics(discountId);
      await invalidateAllAnalyticsCache();

      res.status(200).json({
        success:  true,
        message:  "Discount analytics synced successfully",
        analytics,
      });
    } catch (err) {
      return next(new HandleError(err.message, 500));
    }
  }
);

// ============================================
// MANUAL SYNC — ALL DISCOUNTS
// ============================================

/**
 * @route  POST /api/v1/discount-analytics/sync-all
 * @access Admin
 *
 * Initiates a background bulk re-sync of all discounts with at least
 * one redemption. Returns 202 immediately — mirrors syncAllCustomers()
 * in customer-analytics-controller.js.
 *
 * The sync runs fire-and-forget; errors are counted internally and
 * surfaced via the syncError flag on individual DiscountAnalytics docs.
 */
export const syncAllDiscounts = handleAsyncError(async (req, res, next) => {
  try {
    // Fire and forget — do not await
    syncAllDiscountAnalytics().catch(() => {});

    res.status(202).json({
      success: true,
      message:
        "Bulk discount analytics sync initiated. This may take several minutes.",
    });
  } catch (err) {
    return next(new HandleError(err.message, 500));
  }
});

// ============================================
// STALE SYNC REPORT
// ============================================

/**
 * @route  GET /api/v1/discount-analytics/stale
 * @access Admin
 *
 * Returns all DiscountAnalytics documents that are stale (lastSyncedAt
 * older than thresholdHours) or have a syncError flag set. Useful for
 * the admin to see what needs attention before triggering a manual sync.
 *
 * Query params:
 *   thresholdHours {number} — default 24
 */
export const getStaleSyncReport = handleAsyncError(async (req, res, next) => {
  const thresholdHours = parsePositiveInt(req.query.thresholdHours, 24);

  const stale = await DiscountAnalytics.findStale(thresholdHours);

  res.status(200).json({
    success:         true,
    staleCount:      stale.length,
    thresholdHours,
    staleDocuments:  stale,
  });
});

// ============================================
// CACHE INVALIDATION HELPER
// ============================================

/**
 * Invalidates all analytics cache keys. Called after any admin-triggered
 * sync so stale totals don't persist in Redis.
 */
const invalidateAllAnalyticsCache = async () => {
  const keys = [
    CACHE.OVERVIEW.key,
    CACHE.ROI_BY_CATEGORY.key,
    CACHE.ROI_BY_TYPE.key,
  ];

  await Promise.allSettled(
    keys.map((key) =>
      setCache(key, null, 1).catch(() => {})
    )
  );
};