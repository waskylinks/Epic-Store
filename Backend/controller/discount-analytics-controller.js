import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import DiscountAnalytics from "../models/discount-analytics-model.js";
import Discount from "../models/discount-model.js";
import {
  syncDiscountAnalytics,
  syncAllDiscountAnalytics,
  getDiscountAnalyticsSummary,
} from "../Services/discount-analytics-service.js";
import { getCache, setCache, deleteCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";
import mongoose from "mongoose";

// ============================================
// HELPERS
// ============================================

const isValidObjectId = (s) => mongoose.Types.ObjectId.isValid(s);

const parsePositiveInt = (val, defaultVal) => {
  const n = parseInt(val, 10);
  return isNaN(n) || n <= 0 ? defaultVal : n;
};

// ============================================
// BALANCE FIELD GUARD
// ============================================

const stripBalanceIfNotApplicable = (analyticsDoc) => {
  if (!analyticsDoc) return analyticsDoc;

  const isSpecificFixed =
    analyticsDoc.meta?.type === "fixed" &&
    analyticsDoc.meta?.audience === "specific";

  if (!isSpecificFixed && analyticsDoc.financials) {
    analyticsDoc.financials.remainingBalance    = null;
    analyticsDoc.financials.originalValue       = null;
    analyticsDoc.financials.percentageExhausted = null;
  }

  return analyticsDoc;
};

const stripBalanceFromList = (docs) => docs.map(stripBalanceIfNotApplicable);

// ============================================
// SHARED LOOKUP HELPER
// ============================================

const findAnalyticsByEitherId = (id, projection = null) => {
  const q = {
    $or: [
      { discountId: id },
      {
        _id: mongoose.Types.ObjectId.isValid(id)
          ? new mongoose.Types.ObjectId(id)
          : id,
      },
    ],
  };
  return projection
    ? DiscountAnalytics.findOne(q, projection).lean()
    : DiscountAnalytics.findOne(q).lean();
};

// ============================================
// CACHE KEYS & TTLs
// ============================================

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

const CACHE = {
  OVERVIEW:        { key: "discount_analytics_overview",        ttl: 300 },
  ROI_BY_CATEGORY: { key: "discount_analytics_roi_by_category", ttl: 300 },
  ROI_BY_TYPE:     { key: "discount_analytics_roi_by_type",     ttl: 300 },
  TOP_PERFORMERS:  { key: "discount_analytics_top_performers",  ttl: 300 },
  TRENDS:          (timeframe) => ({
    key: `discount_analytics_trends_${timeframe}`,
    ttl: 600,
  }),
};


const buildTopPerformersCacheKeys = () => {
  const limits   = [5, 10, 20, 50];
  const sortBys  = ["roi", "revenue", "redemptions"];
  const categories = [
    "all", "promo", "refund", "return", "loyalty",
    "affiliate", "support", "blackfriday",
  ];
  const keys = [];
  for (const limit of limits) {
    for (const cat of categories) {
      for (const sortBy of sortBys) {
        keys.push(`${CACHE.TOP_PERFORMERS.key}_${limit}_${cat}_${sortBy}`);
      }
    }
  }
  return keys;
};

// ============================================
// OVERVIEW KPI PANEL
// ============================================

export const getDiscountAnalyticsOverview = handleAsyncError(
  async (req, res, next) => {
    const cached = await getCache(CACHE.OVERVIEW.key);
    if (cached) {
      return res.status(200).json({ success: true, ...cached, fromCache: true });
    }

    const summary = await getDiscountAnalyticsSummary();

    const overall = summary.overall[0] ?? {
      totalCodes:                0,
      totalCodesWithRedemptions: 0,
      totalRedemptions:          0,
      totalUniqueUsers:          0,
      totalDiscountCost:         0,
      totalRevenueInfluenced:    0,
      avgROI:                    null,
      avgAOV:                    0,
    };

    const redemptionRate =
      overall.totalCodes > 0
        ? Math.round(
            (overall.totalCodesWithRedemptions / overall.totalCodes) * 100 * 10
          ) / 10
        : 0;

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
      overall: { ...overall, redemptionRate, overallROI },
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
    roi:
      cat.computedROI !== null && cat.computedROI !== undefined
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
  if (sortBy === "roi") filter["financials.roi"] = { $ne: null };
  if (category)         filter["meta.category"]  = category;

  const topCodes = await DiscountAnalytics.find(filter)
    .sort(sortFieldMap[sortBy])
    .limit(limit)
    .select(
      "discountId discountCode meta.category meta.type meta.audience meta.status " +
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

  const trends = await DiscountAnalytics.aggregate([
    { $match: matchFilter },
    { $unwind: "$dailyRedemptions" },
    { $match: { "dailyRedemptions.date": { $gte: currentPeriodStart } } },
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

export const getDiscountAnalyticsDetail = handleAsyncError(
  async (req, res, next) => {
    const { discountId } = req.params;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    let analytics = await findAnalyticsByEitherId(discountId);

    if (!analytics) {
      // No document at all — trigger on-demand sync if the discount has been used.
      const discount = await Discount.findById(discountId).select("_id code usageLimit").lean();

      if (discount && discount.usageLimit?.currentUses > 0) {
        try {
          await syncDiscountAnalytics(discount._id);
          analytics = await findAnalyticsByEitherId(discountId);
        } catch (err) {
          console.error(`[DA:detail] on-demand sync failed:`, err?.message);
        }
      }
    } else {
      const lastSynced = analytics.lastSyncedAt ? new Date(analytics.lastSyncedAt) : null;
      const isStale    = !lastSynced || (Date.now() - lastSynced.getTime() > STALE_THRESHOLD_MS);

      if (isStale) {
        syncDiscountAnalytics(discountId).catch((err) => {
          console.error(`[DA:detail] background stale re-sync failed for ${discountId}:`, err?.message);
        });
      }
    }

    if (!analytics) {
      return next(
        new HandleError(
          "No analytics found for this discount. " +
            "Analytics are generated on first redemption.",
          404
        )
      );
    }

    analytics = stripBalanceIfNotApplicable(analytics);

    const lastSynced     = analytics.lastSyncedAt ? new Date(analytics.lastSyncedAt) : null;
    const isStaleForClient = !lastSynced || (Date.now() - lastSynced.getTime() > STALE_THRESHOLD_MS);

    res.status(200).json({
      success: true,
      analytics,
      meta: {
        isStale:      isStaleForClient,
        lastSyncedAt: analytics.lastSyncedAt ?? null,
        staleSyncTriggered: isStaleForClient,
      },
    });
  }
);

// ============================================
// SEGMENT BREAKDOWN FOR ONE CODE
// ============================================

export const getDiscountSegmentBreakdown = handleAsyncError(
  async (req, res, next) => {
    const { discountId } = req.params;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    const analytics = await findAnalyticsByEitherId(discountId, {
      discountCode:        1,
      segmentBreakdown:    1,
      valueTierBreakdown:  1,
      "redemptions.total": 1,
      lastSyncedAt:        1,
    });

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

export const getDiscountRedemptionTrend = handleAsyncError(
  async (req, res, next) => {
    const { discountId }          = req.params;
    const { timeframe = "month" } = req.query;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    validateTimeframe(timeframe, next);

    const { currentPeriodStart } = getDateRanges(timeframe);

    const analytics = await findAnalyticsByEitherId(discountId, {
      discountCode:     1,
      dailyRedemptions: 1,
      peakUsage:        1,
    });

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
      summary: {
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

export const getAllDiscountAnalytics = handleAsyncError(
  async (req, res, next) => {
    const { category, type, audience, cursor, sortBy = "revenue" } = req.query;

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
      filter["financials.roi"] = { $ne: null };
    }

    if (cursor) {
      try {
        const { id } = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
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
        "discountId discountCode meta redemptions.total redemptions.uniqueUsers " +
        "financials.roi financials.totalRevenueInfluenced " +
        "financials.totalDiscountCost financials.avgOrderValue " +
        "financials.avgDiscountAmount financials.remainingBalance " +
        "financials.originalValue financials.percentageExhausted " +
        "conversion.postRedemptionRetentionRate " +
        "conversion.targetedRedemptionRate baseline.aovLiftPercent " +
        "peakUsage lastSyncedAt"
      )
      .lean();

    const hasNextPage = docs.length > limit;
    if (hasNextPage) docs.pop();

    const analytics = stripBalanceFromList(docs);

    let nextCursor = null;
    if (hasNextPage && analytics.length > 0) {
      const last = analytics[analytics.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ id: last._id })).toString("base64");
    }

    res.status(200).json({
      success: true,
      analytics,
      pagination: { limit, hasNextPage, nextCursor },
    });
  }
);

// ============================================
// MANUAL SYNC — SINGLE DISCOUNT
// ============================================

export const syncSingleDiscountAnalytics = handleAsyncError(
  async (req, res, next) => {
    const { discountId } = req.params;

    if (!isValidObjectId(discountId)) {
      return next(new HandleError("Invalid discountId", 400));
    }

    const discount = await Discount.findById(discountId).select("_id").lean();
    if (!discount) {
      return next(new HandleError("Discount not found", 404));
    }

    try {
      const analyticsRaw = await syncDiscountAnalytics(discountId);
      await invalidateAllAnalyticsCache();

      const analytics = stripBalanceIfNotApplicable(
        analyticsRaw?.toObject ? analyticsRaw.toObject() : analyticsRaw
      );

      res.status(200).json({
        success:   true,
        message:   "Discount analytics synced successfully",
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

export const syncAllDiscounts = handleAsyncError(async (req, res, next) => {
  try {
    syncAllDiscountAnalytics().catch(() => {});

    res.status(202).json({
      success: true,
      message: "Bulk discount analytics sync initiated. This may take several minutes.",
    });
  } catch (err) {
    return next(new HandleError(err.message, 500));
  }
});

// ============================================
// STALE SYNC REPORT
// ============================================

export const getStaleSyncReport = handleAsyncError(async (req, res, next) => {
  const thresholdHours = parsePositiveInt(req.query.thresholdHours, 24);

  const stale = await DiscountAnalytics.findStale(thresholdHours);

  res.status(200).json({
    success:        true,
    staleCount:     stale.length,
    thresholdHours,
    staleDocuments: stale,
  });
});

// ============================================
// CACHE INVALIDATION HELPER
// ============================================

const invalidateAllAnalyticsCache = async () => {
  const fixedKeys = [
    CACHE.OVERVIEW.key,
    CACHE.ROI_BY_CATEGORY.key,
    CACHE.ROI_BY_TYPE.key,
  ];

  const topPerformersKeys = buildTopPerformersCacheKeys();

  const allKeys = [...fixedKeys, ...topPerformersKeys];

  await Promise.allSettled(
    allKeys.map((key) =>
      deleteCache(key).catch(() => {})
    )
  );
};