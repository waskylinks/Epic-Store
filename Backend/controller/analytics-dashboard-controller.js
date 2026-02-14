import handleAsyncError from "../middleware/handleAsyncError.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges, getDateGroupFormat } from "../utils/dateRanges.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";
import Checkout from "../models/checkout-model.js";
import { ORDER_STATUSES } from "../constants/analytics.constants.js";
import {
  getTopProductsByRevenue,
  getTopCustomers,
  getTopCategories,
  getRevenueMetrics,
  getEstimatedVisitors
} from "../utils/analyticsHelpers.js";

// ============================================
// REVENUE TRENDS
// ============================================

export const getRevenueTrends = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", groupBy = "day" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `revenue_trends_${timeframe}_${groupBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // FIX D1: Replaced inline date format switch/case with shared getDateGroupFormat.
  const dateFormat = getDateGroupFormat(groupBy);

  // FIX D2: Added paymentInfo.status: 'success' — only count revenue that was
  // actually collected. "Relaxing" this filter inflates revenue with failed payments.
  const trends = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        "paymentInfo.status": "success"
      }
    },
    {
      $group: {
        _id: dateFormat,
        revenue: { $sum: "$totalPrice" },
        orders: { $sum: 1 },
        avgOrderValue: { $avg: "$totalPrice" },
        customers: { $addToSet: "$user" }
      }
    },
    {
      $project: {
        date: "$_id",
        revenue: { $round: ["$revenue", 2] },
        orders: 1,
        avgOrderValue: { $round: ["$avgOrderValue", 2] },
        uniqueCustomers: { $size: "$customers" }
      }
    },
    { $sort: { date: 1 } }
  ]);

  let cumulativeRevenue = 0;
  const trendsWithCumulative = trends.map((item) => {
    cumulativeRevenue += item.revenue;
    return { ...item, cumulativeRevenue: Math.round(cumulativeRevenue * 100) / 100 };
  });

  const response = {
    data: trendsWithCumulative,
    summary: {
      totalRevenue: Math.round(cumulativeRevenue * 100) / 100,
      totalOrders: trends.reduce((sum, t) => sum + t.orders, 0),
      avgDailyRevenue:
        trends.length > 0
          ? Math.round((cumulativeRevenue / trends.length) * 100) / 100
          : 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// TOP PERFORMERS
// ============================================

export const getTopPerformers = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `top_performers_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // FIX D3: Replaced three local duplicate functions with shared helpers.
  const [products, customers, categories] = await Promise.all([
    getTopProductsByRevenue(currentPeriodStart, 10),
    getTopCustomers(currentPeriodStart, 10),
    getTopCategories(currentPeriodStart, 10)
  ]);

  const response = { products, customers, categories };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// KEY METRICS SUMMARY (KPIs)
// ============================================

export const getDashboardKPIs = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `dashboard_kpis_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  // FIX D2: Consistent payment success filter.
  const [currentOrders, previousOrders] = await Promise.all([
    Order.find({
      createdAt: { $gte: currentPeriodStart },
      orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
      "paymentInfo.status": "success"
    }).select("totalPrice orderItems user createdAt"),
    Order.find({
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd },
      orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
      "paymentInfo.status": "success"
    }).select("totalPrice orderItems user")
  ]);

  const currentRevenue = currentOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const currentOrderCount = currentOrders.length;
  const currentAOV = currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0;
  const currentCustomers = new Set(currentOrders.map((o) => o.user?.toString())).size;

  const previousRevenue = previousOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const previousOrderCount = previousOrders.length;
  const previousAOV = previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;
  const previousCustomers = new Set(previousOrders.map((o) => o.user?.toString())).size;

  // FIX D4: Replaced local getEstimatedVisitors with shared helper.
  const totalVisitors = await getEstimatedVisitors();
  const conversionRate = totalVisitors > 0 ? (currentOrderCount / totalVisitors) * 100 : 0;

  const avgCLV = await CustomerAnalytics.aggregate([
    { $group: { _id: null, avgCLV: { $avg: "$clv.totalRevenue" } } }
  ]);

  const kpis = {
    revenue: {
      current: Math.round(currentRevenue * 100) / 100,
      previous: Math.round(previousRevenue * 100) / 100,
      change: calculateTrend(currentRevenue, previousRevenue),
      target: Math.round(currentRevenue * 1.15 * 100) / 100
    },
    orders: {
      current: currentOrderCount,
      previous: previousOrderCount,
      change: calculateTrend(currentOrderCount, previousOrderCount),
      target: Math.round(currentOrderCount * 1.15)
    },
    averageOrderValue: {
      current: Math.round(currentAOV * 100) / 100,
      previous: Math.round(previousAOV * 100) / 100,
      change: calculateTrend(currentAOV, previousAOV)
    },
    customers: {
      current: currentCustomers,
      previous: previousCustomers,
      change: calculateTrend(currentCustomers, previousCustomers)
    },
    conversionRate: {
      current: Math.round(conversionRate * 100) / 100,
      description: "Orders / Estimated Visitors"
    },
    customerLifetimeValue: {
      average: Math.round((avgCLV[0]?.avgCLV || 0) * 100) / 100
    },
    revenuePerCustomer: {
      current:
        currentCustomers > 0
          ? Math.round((currentRevenue / currentCustomers) * 100) / 100
          : 0
    }
  };

  await setCache(cacheKey, kpis, 300);
  res.status(200).json({ success: true, kpis, timeframe });
});

// ============================================
// DASHBOARD ALERTS
// ============================================

export const getDashboardAlerts = handleAsyncError(async (req, res, next) => {
  const cacheKey = "dashboard_alerts";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const alerts = [];

  const [
    lowStockCount,
    outOfStockCount,
    atRiskCustomers,
    abandonedCheckouts,
    pendingFraudReviews,
    slaBreaches,
    recentReturns
  ] = await Promise.all([
    Product.countDocuments({
      status: "published",
      "inventory.trackInventory": true,
      $expr: {
        $and: [
          { $gt: ["$inventory.stock", 0] },
          { $lte: ["$inventory.stock", "$inventory.lowStockThreshold"] }
        ]
      }
    }),
    Product.countDocuments({
      status: "published",
      "inventory.stock": 0,
      "inventory.trackInventory": true
    }),
    CustomerAnalytics.countDocuments({
      "risk.isAtRisk": true,
      "risk.churnPrediction": { $in: ["critical", "high"] }
    }),
    Checkout.countDocuments({
      "abandonment.isAbandoned": true,
      "conversion.isConverted": false,
      "abandonment.abandonedAt": {
        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    }),
    Order.countDocuments({
      "fraudCheck.reviewRequired": true,
      "fraudCheck.reviewDecision": "Pending"
    }),
    Order.countDocuments({
      "fulfillmentSLA.slaBreached": true,
      orderStatus: { $in: ["Processing", "Shipped"] }
    }),
    Order.countDocuments({
      "returnInfo.status": { $nin: ["none", "rejected"] },
      "returnInfo.requestedAt": {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    })
  ]);

  if (lowStockCount > 0) {
    alerts.push({
      type: "warning",
      category: "inventory",
      message: `${lowStockCount} product(s) are low in stock`,
      priority: "medium",
      actionUrl: "/admin/inventory/low-stock",
      timeAgo: "Just now"
    });
  }
  if (outOfStockCount > 0) {
    alerts.push({
      type: "error",
      category: "inventory",
      message: `${outOfStockCount} product(s) are out of stock`,
      priority: "high",
      actionUrl: "/admin/inventory/out-of-stock",
      timeAgo: "Just now"
    });
  }
  if (atRiskCustomers > 0) {
    alerts.push({
      type: "warning",
      category: "customers",
      message: `${atRiskCustomers} high-value customer(s) at risk of churning`,
      priority: "high",
      actionUrl: "/admin/customers/at-risk",
      timeAgo: "2 hours ago"
    });
  }
  if (abandonedCheckouts > 5) {
    alerts.push({
      type: "info",
      category: "checkout",
      message: `${abandonedCheckouts} checkout(s) abandoned in the last 24 hours`,
      priority: "medium",
      actionUrl: "/admin/checkout/abandoned",
      timeAgo: "3 hours ago"
    });
  }
  if (pendingFraudReviews > 0) {
    alerts.push({
      type: "warning",
      category: "fraud",
      message: `${pendingFraudReviews} order(s) pending fraud review`,
      priority: "high",
      actionUrl: "/admin/orders/fraud-review",
      timeAgo: "1 hour ago"
    });
  }
  if (slaBreaches > 0) {
    alerts.push({
      type: "error",
      category: "fulfillment",
      message: `${slaBreaches} order(s) have breached SLA`,
      priority: "critical",
      actionUrl: "/admin/fulfillment/sla-breaches",
      timeAgo: "30 minutes ago"
    });
  }
  if (recentReturns > 10) {
    alerts.push({
      type: "info",
      category: "returns",
      message: `${recentReturns} return(s) in the last 7 days`,
      priority: "medium",
      actionUrl: "/admin/returns/overview",
      timeAgo: "5 hours ago"
    });
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const response = {
    alerts,
    totalAlerts: alerts.length,
    criticalCount: alerts.filter((a) => a.priority === "critical").length,
    highPriorityCount: alerts.filter((a) => a.priority === "high").length
  };

  await setCache(cacheKey, response, 180);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// DASHBOARD OVERVIEW
// ============================================

export const getDashboardOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `dashboard_overview_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [revenue, orders, customers, products, checkouts, returns] = await Promise.all([
    // FIX D3: Replaced duplicate local getRevenueMetrics with shared helper.
    getRevenueMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getOrderMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getCustomerMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getProductMetrics(),
    getCheckoutMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getReturnMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd)
  ]);

  const response = {
    revenue,
    orders,
    customers,
    products,
    checkouts,
    returns,
    timeframe,
    generatedAt: new Date()
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// PRIVATE HELPERS (dashboard-specific, not shared)
// ============================================

const getOrderMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, statusBreakdown] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: currentStart } }),
    Order.countDocuments({ createdAt: { $gte: previousStart, $lt: previousEnd } }),
    Order.aggregate([
      { $match: { createdAt: { $gte: currentStart } } },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
    ])
  ]);

  const breakdown = statusBreakdown.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  return { current, previous, change: calculateTrend(current, previous), statusBreakdown: breakdown };
};

const getCustomerMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, vipCount, atRiskCount] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: currentStart } }),
    User.countDocuments({ createdAt: { $gte: previousStart, $lt: previousEnd } }),
    CustomerAnalytics.countDocuments({ isVIP: true }),
    CustomerAnalytics.countDocuments({ "risk.isAtRisk": true })
  ]);

  return {
    newCustomers: { current, previous, change: calculateTrend(current, previous) },
    vipCustomers: vipCount,
    atRiskCustomers: atRiskCount
  };
};

const getProductMetrics = async () => {
  const [total, published, lowStock, outOfStock] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ status: "published" }),
    Product.countDocuments({
      status: "published",
      "inventory.trackInventory": true,
      $expr: {
        $and: [
          { $gt: ["$inventory.stock", 0] },
          { $lte: ["$inventory.stock", "$inventory.lowStockThreshold"] }
        ]
      }
    }),
    Product.countDocuments({
      status: "published",
      "inventory.stock": 0,
      "inventory.trackInventory": true
    })
  ]);

  return { total, published, lowStock, outOfStock };
};

const getCheckoutMetrics = async (currentStart, previousStart, previousEnd) => {
  const [currentAbandoned, totalCurrent, previousAbandoned, totalPrevious] = await Promise.all([
    Checkout.countDocuments({ createdAt: { $gte: currentStart }, "abandonment.isAbandoned": true }),
    Checkout.countDocuments({ createdAt: { $gte: currentStart } }),
    Checkout.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd },
      "abandonment.isAbandoned": true
    }),
    Checkout.countDocuments({ createdAt: { $gte: previousStart, $lt: previousEnd } })
  ]);

  const currentRate = totalCurrent > 0 ? (currentAbandoned / totalCurrent) * 100 : 0;
  const previousRate = totalPrevious > 0 ? (previousAbandoned / totalPrevious) * 100 : 0;

  return {
    abandonmentRate: {
      current: Math.round(currentRate * 100) / 100,
      previous: Math.round(previousRate * 100) / 100,
      change: calculateTrend(currentRate, previousRate)
    },
    abandonedCount: currentAbandoned
  };
};

const getReturnMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, delivered] = await Promise.all([
    Order.countDocuments({
      "returnInfo.requestedAt": { $gte: currentStart },
      "returnInfo.status": { $ne: "none" }
    }),
    Order.countDocuments({
      "returnInfo.requestedAt": { $gte: previousStart, $lt: previousEnd },
      "returnInfo.status": { $ne: "none" }
    }),
    Order.countDocuments({ orderStatus: "Delivered", deliveredAt: { $gte: currentStart } })
  ]);

  const returnRate = delivered > 0 ? (current / delivered) * 100 : 0;

  return {
    current,
    previous,
    change: calculateTrend(current, previous),
    returnRate: Math.round(returnRate * 100) / 100
  };
};

export default {
  getDashboardOverview,
  getDashboardKPIs,
  getRevenueTrends,
  getTopPerformers,
  getDashboardAlerts
};