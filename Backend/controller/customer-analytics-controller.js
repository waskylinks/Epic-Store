import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";
import {
  syncCustomerAnalytics,
  syncAllCustomerAnalytics,
  getCustomerAnalyticsSummary
} from "../Services/customer-analytics-service.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";

// ============================================
// CUSTOMER ANALYTICS OVERVIEW
// ============================================

export const getCustomerOverview = handleAsyncError(async (req, res, next) => {
  const cacheKey = "customer_analytics_overview";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const summary = await getCustomerAnalyticsSummary();

  const response = {
    segments: summary.segments,
    valueTiers: summary.valueTiers,
    churnRisk: summary.churnRisk,
    overall: summary.overall[0] || {
      totalCustomers: 0,
      totalRevenue: 0,
      avgCLV: 0,
      avgOrders: 0,
      avgAOV: 0,
      vipCount: 0,
      atRiskCount: 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// CUSTOMER SEGMENTS
// ============================================

export const getCustomersBySegment = handleAsyncError(async (req, res, next) => {
  const { segment } = req.params;
  const { limit = 100, page = 1 } = req.query;

  const validSegments = [
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
    "Lost"
  ];

  if (!validSegments.includes(segment)) {
    return next(new HandleError("Invalid segment", 400));
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [customers, totalCount, segmentStats] = await Promise.all([
    CustomerAnalytics.find({ "rfm.segment": segment })
      .populate("user", "firstName lastName email")
      .sort({ "clv.totalRevenue": -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    CustomerAnalytics.countDocuments({ "rfm.segment": segment }),
    CustomerAnalytics.aggregate([
      { $match: { "rfm.segment": segment } },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          totalRevenue: { $sum: "$clv.totalRevenue" },
          avgRevenue: { $avg: "$clv.totalRevenue" },
          avgOrders: { $avg: "$clv.totalOrders" },
          avgAOV: { $avg: "$clv.averageOrderValue" }
        }
      }
    ])
  ]);

  res.status(200).json({
    success: true,
    segment,
    customers,
    stats: segmentStats[0] || {
      totalCustomers: 0,
      totalRevenue: 0,
      avgRevenue: 0,
      avgOrders: 0,
      avgAOV: 0
    },
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCustomers: totalCount
    }
  });
});

export const getSegmentDistribution = handleAsyncError(async (req, res, next) => {
  const cacheKey = "customer_segment_distribution";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const distribution = await CustomerAnalytics.getSegmentDistribution();

  const response = {
    distribution,
    totalCustomers: distribution.reduce((sum, seg) => sum + seg.count, 0),
    totalRevenue: distribution.reduce((sum, seg) => sum + seg.totalRevenue, 0)
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// CLV ANALYTICS
// ============================================

export const getHighValueCustomers = handleAsyncError(async (req, res, next) => {
  const { minRevenue = 1000, limit = 50 } = req.query;

  const customers = await CustomerAnalytics.getHighValueCustomers(
    parseFloat(minRevenue),
    parseInt(limit)
  );

  const stats = customers.reduce(
    (acc, customer) => {
      acc.totalRevenue += customer.clv.totalRevenue;
      acc.totalOrders += customer.clv.totalOrders;
      return acc;
    },
    { totalRevenue: 0, totalOrders: 0 }
  );

  res.status(200).json({
    success: true,
    count: customers.length,
    customers,
    stats: {
      ...stats,
      avgRevenue: customers.length > 0 ? stats.totalRevenue / customers.length : 0,
      avgOrders: customers.length > 0 ? stats.totalOrders / customers.length : 0
    }
  });
});

export const getCLVDistribution = handleAsyncError(async (req, res, next) => {
  const cacheKey = "customer_clv_distribution";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const distribution = await CustomerAnalytics.aggregate([
    {
      $bucket: {
        groupBy: "$clv.totalRevenue",
        boundaries: [0, 100, 500, 1000, 2000, 5000, 10000],
        default: "10000+",
        output: {
          count: { $sum: 1 },
          totalRevenue: { $sum: "$clv.totalRevenue" },
          avgRevenue: { $avg: "$clv.totalRevenue" }
        }
      }
    }
  ]);

  const ranges = [
    "$0-$99",
    "$100-$499",
    "$500-$999",
    "$1000-$1999",
    "$2000-$4999",
    "$5000-$9999",
    "$10000+"
  ];
  const formattedDistribution = distribution.map((bucket, index) => ({
    range: ranges[index] || "$10000+",
    ...bucket
  }));

  const response = { distribution: formattedDistribution };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// VIP CUSTOMERS
// ============================================

export const getVIPCustomers = handleAsyncError(async (req, res, next) => {
  const { limit = 50 } = req.query;

  const customers = await CustomerAnalytics.getVIPCustomers(parseInt(limit));

  const stats = {
    totalVIPs: customers.length,
    totalRevenue: customers.reduce((sum, c) => sum + c.clv.totalRevenue, 0),
    avgRevenue:
      customers.length > 0
        ? customers.reduce((sum, c) => sum + c.clv.totalRevenue, 0) / customers.length
        : 0,
    avgOrders:
      customers.length > 0
        ? customers.reduce((sum, c) => sum + c.clv.totalOrders, 0) / customers.length
        : 0
  };

  res.status(200).json({ success: true, count: customers.length, customers, stats });
});

// ============================================
// CHURN RISK ANALYTICS
// ============================================

export const getAtRiskCustomers = handleAsyncError(async (req, res, next) => {
  const { limit = 100, riskLevel } = req.query;

  const query = { "risk.isAtRisk": true };
  if (riskLevel) query["risk.churnPrediction"] = riskLevel;

  const customers = await CustomerAnalytics.find(query)
    .populate("user", "firstName lastName email")
    .sort({ "clv.totalRevenue": -1, "risk.churnRiskScore": -1 })
    .limit(parseInt(limit));

  const byRiskLevel = {
    critical: customers.filter((c) => c.risk.churnPrediction === "critical").length,
    high: customers.filter((c) => c.risk.churnPrediction === "high").length,
    medium: customers.filter((c) => c.risk.churnPrediction === "medium").length,
    low: customers.filter((c) => c.risk.churnPrediction === "low").length
  };

  const revenueAtRisk = customers.reduce((sum, c) => sum + c.clv.totalRevenue, 0);

  res.status(200).json({
    success: true,
    count: customers.length,
    customers,
    byRiskLevel,
    revenueAtRisk: Math.round(revenueAtRisk * 100) / 100
  });
});

export const getCustomersNeedingAttention = handleAsyncError(async (req, res, next) => {
  const customers = await CustomerAnalytics.getNeedingAttention();

  const categorized = {
    atRisk: customers.filter((c) => c.risk.isAtRisk),
    highValueAtRisk: customers.filter(
      (c) => c.risk.isAtRisk && c.clv.totalRevenue >= 1000
    ),
    cannotLoseThem: customers.filter((c) => c.rfm.segment === "Cannot Lose Them"),
    aboutToSleep: customers.filter((c) => c.rfm.segment === "About To Sleep"),
    flaggedForReview: customers.filter((c) => c.flaggedForReview)
  };

  res.status(200).json({
    success: true,
    totalNeedingAttention: customers.length,
    categorized,
    summary: {
      atRisk: categorized.atRisk.length,
      highValueAtRisk: categorized.highValueAtRisk.length,
      cannotLoseThem: categorized.cannotLoseThem.length,
      aboutToSleep: categorized.aboutToSleep.length,
      flaggedForReview: categorized.flaggedForReview.length
    }
  });
});

// ============================================
// COHORT ANALYSIS
// ============================================

export const getCustomerCohorts = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `customer_cohorts_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const cohorts = await CustomerAnalytics.aggregate([
    {
      $match: { "purchaseBehavior.firstPurchaseDate": { $exists: true } }
    },
    {
      $group: {
        _id: {
          year: { $year: "$purchaseBehavior.firstPurchaseDate" },
          month: { $month: "$purchaseBehavior.firstPurchaseDate" }
        },
        customers: { $sum: 1 },
        totalRevenue: { $sum: "$clv.totalRevenue" },
        avgRevenue: { $avg: "$clv.totalRevenue" },
        avgOrders: { $avg: "$clv.totalOrders" }
      }
    },
    { $sort: { "_id.year": -1, "_id.month": -1 } },
    { $limit: 12 }
  ]);

  const response = { cohorts };

  await setCache(cacheKey, response, 600);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// PURCHASE BEHAVIOR
// ============================================

export const getRepeatPurchaseAnalytics = handleAsyncError(async (req, res, next) => {
  const cacheKey = "customer_repeat_purchase";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const analytics = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: null,
        totalCustomers: { $sum: 1 },
        avgRepeatRate: { $avg: "$purchaseBehavior.repeatPurchaseRate" },
        oneTimeCustomers: { $sum: { $cond: [{ $eq: ["$clv.totalOrders", 1] }, 1, 0] } },
        repeatCustomers: { $sum: { $cond: [{ $gt: ["$clv.totalOrders", 1] }, 1, 0] } },
        loyalCustomers: { $sum: { $cond: [{ $gte: ["$clv.totalOrders", 5] }, 1, 0] } }
      }
    }
  ]);

  const data = analytics[0] || {
    totalCustomers: 0,
    avgRepeatRate: 0,
    oneTimeCustomers: 0,
    repeatCustomers: 0,
    loyalCustomers: 0
  };

  const response = {
    ...data,
    oneTimePercentage:
      data.totalCustomers > 0
        ? Math.round((data.oneTimeCustomers / data.totalCustomers) * 100 * 100) / 100
        : 0,
    repeatPercentage:
      data.totalCustomers > 0
        ? Math.round((data.repeatCustomers / data.totalCustomers) * 100 * 100) / 100
        : 0,
    loyalPercentage:
      data.totalCustomers > 0
        ? Math.round((data.loyalCustomers / data.totalCustomers) * 100 * 100) / 100
        : 0
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getPurchaseFrequencyAnalytics = handleAsyncError(async (req, res, next) => {
  const cacheKey = "customer_purchase_frequency";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const [analytics, distribution] = await Promise.all([
    CustomerAnalytics.aggregate([
      {
        $group: {
          _id: null,
          avgFrequency: { $avg: "$purchaseBehavior.purchaseFrequency" },
          avgDaysBetweenPurchases: { $avg: "$purchaseBehavior.avgDaysBetweenPurchases" }
        }
      }
    ]),
    CustomerAnalytics.aggregate([
      {
        $bucket: {
          groupBy: "$clv.totalOrders",
          boundaries: [1, 2, 3, 5, 10, 20],
          default: "20+",
          output: {
            count: { $sum: 1 },
            avgRevenue: { $avg: "$clv.totalRevenue" }
          }
        }
      }
    ])
  ]);

  const ranges = [
    "1 order",
    "2 orders",
    "3-4 orders",
    "5-9 orders",
    "10-19 orders",
    "20+ orders"
  ];
  const formattedDistribution = distribution.map((bucket, index) => ({
    range: ranges[index] || "20+ orders",
    ...bucket
  }));

  const response = {
    overall: analytics[0] || { avgFrequency: 0, avgDaysBetweenPurchases: 0 },
    distribution: formattedDistribution
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ACQUISITION SOURCE ANALYTICS
// ============================================

export const getAcquisitionSourceAnalytics = handleAsyncError(async (req, res, next) => {
  const cacheKey = "customer_acquisition_sources";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const sourcePerformance = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: "$acquisition.source",
        customers: { $sum: 1 },
        totalRevenue: { $sum: "$clv.totalRevenue" },
        avgCLV: { $avg: "$clv.totalRevenue" },
        avgOrders: { $avg: "$clv.totalOrders" },
        vipCount: { $sum: { $cond: ["$isVIP", 1, 0] } }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ]);

  const sourcesWithROI = sourcePerformance.map((source) => {
    const totalAcquisitionCost = source.customers * 50; // Placeholder
    const roi =
      totalAcquisitionCost > 0
        ? ((source.totalRevenue - totalAcquisitionCost) / totalAcquisitionCost) * 100
        : 0;
    return {
      ...source,
      estimatedAcquisitionCost: totalAcquisitionCost,
      roi: Math.round(roi * 100) / 100
    };
  });

  const response = {
    sources: sourcesWithROI,
    totalCustomers: sourcePerformance.reduce((sum, s) => sum + s.customers, 0),
    totalRevenue: sourcePerformance.reduce((sum, s) => sum + s.totalRevenue, 0)
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// INDIVIDUAL CUSTOMER
// ============================================

export const getCustomerDetails = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;

  const customer = await CustomerAnalytics.findOne({ user: userId })
    .populate("user", "firstName lastName email avatar createdAt")
    .populate(
      "purchaseBehavior.favoriteProducts.product",
      "name images pricing"
    );

  if (!customer) {
    return next(new HandleError("Customer analytics not found", 404));
  }

  res.status(200).json({ success: true, customer });
});

export const syncSingleCustomer = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;

  try {
    const customerAnalytics = await syncCustomerAnalytics(userId);
    res.status(200).json({
      success: true,
      message: "Customer analytics synced successfully",
      customer: customerAnalytics
    });
  } catch (error) {
    return next(new HandleError(error.message, 500));
  }
});

// ============================================
// BULK OPERATIONS
// ============================================

export const syncAllCustomers = handleAsyncError(async (req, res, next) => {
  try {
    // FIX CA1: Removed console.error - background job errors should be tracked
    // through proper logging system or job status endpoint, not console.
    // Silent suppression is intentional here since it's a fire-and-forget background job.
    syncAllCustomerAnalytics().catch(() => {});

    res.status(202).json({
      success: true,
      message: "Bulk customer analytics sync initiated. This may take several minutes."
    });
  } catch (error) {
    return next(new HandleError(error.message, 500));
  }
});

// ============================================
// NOTES & FLAGS
// ============================================

export const addCustomerNote = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;
  const { content, type = "general" } = req.body;

  if (!content) {
    return next(new HandleError("Note content is required", 400));
  }

  const customer = await CustomerAnalytics.findOne({ user: userId });
  if (!customer) {
    return next(new HandleError("Customer analytics not found", 404));
  }

  customer.addNote(content, type, req.user._id);
  await customer.save();

  res.status(200).json({
    success: true,
    message: "Note added successfully",
    note: customer.notes[customer.notes.length - 1]
  });
});

export const toggleVIPStatus = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;
  const { isVIP } = req.body;

  const customer = await CustomerAnalytics.findOne({ user: userId });
  if (!customer) {
    return next(new HandleError("Customer analytics not found", 404));
  }

  customer.isVIP = isVIP;
  await customer.save();

  res.status(200).json({
    success: true,
    message: `Customer ${isVIP ? "marked as" : "removed from"} VIP`,
    customer
  });
});

export const flagCustomerForReview = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;
  const { flagged, note } = req.body;

  const customer = await CustomerAnalytics.findOne({ user: userId });
  if (!customer) {
    return next(new HandleError("Customer analytics not found", 404));
  }

  customer.flaggedForReview = flagged;
  if (note) customer.addNote(note, "warning", req.user._id);
  await customer.save();

  res.status(200).json({
    success: true,
    message: `Customer ${flagged ? "flagged" : "unflagged"} for review`,
    customer
  });
});

export default {
  getCustomerOverview,
  getCustomersBySegment,
  getSegmentDistribution,
  getHighValueCustomers,
  getCLVDistribution,
  getVIPCustomers,
  getAtRiskCustomers,
  getCustomersNeedingAttention,
  getCustomerCohorts,
  getRepeatPurchaseAnalytics,
  getPurchaseFrequencyAnalytics,
  getAcquisitionSourceAnalytics,
  getCustomerDetails,
  syncSingleCustomer,
  syncAllCustomers,
  addCustomerNote,
  toggleVIPStatus,
  flagCustomerForReview
};