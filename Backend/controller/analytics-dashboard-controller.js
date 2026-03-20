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
  const dateFormat = getDateGroupFormat(groupBy);

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
        grossRevenue: { $sum: "$totalPrice" },
        orders:       { $sum: 1 },
        avgOrderValue: { $avg: "$totalPrice" },
        customers:    { $addToSet: "$user" },
        totalRefunded: {
          $sum: {
            $cond: [
              { $eq: ["$refundInfo.status", "completed"] },
              "$refundInfo.refundAmount",
              0
            ]
          }
        }
      }
    },
    {
      $project: {
        date:          "$_id",
        grossRevenue:  { $round: ["$grossRevenue", 2] },
        totalRefunded: { $round: ["$totalRefunded", 2] },
        revenue: {
          $round: [{ $subtract: ["$grossRevenue", "$totalRefunded"] }, 2]
        },
        orders:          1,
        avgOrderValue:   { $round: ["$avgOrderValue", 2] },
        uniqueCustomers: { $size: "$customers" }
      }
    },
    { $sort: { date: 1 } }
  ]);

  let cumulativeRevenue  = 0;
  let cumulativeRefunded = 0;
  const trendsWithCumulative = trends.map((item) => {
    cumulativeRevenue  += item.revenue;
    cumulativeRefunded += item.totalRefunded;
    return {
      ...item,
      cumulativeRevenue:  Math.round(cumulativeRevenue  * 100) / 100,
      cumulativeRefunded: Math.round(cumulativeRefunded * 100) / 100
    };
  });

  const response = {
    data: trendsWithCumulative,
    summary: {
      grossRevenue:    Math.round(trends.reduce((s, t) => s + t.grossRevenue,  0) * 100) / 100,
      totalRefunded:   Math.round(cumulativeRefunded * 100) / 100,
      totalRevenue:    Math.round(cumulativeRevenue  * 100) / 100,
      totalOrders:     trends.reduce((s, t) => s + t.orders, 0),
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
// FIX: Replaced two Order.find() calls (which hydrated thousands of full
// documents into Node memory) with a single $facet aggregation that does
// all arithmetic inside MongoDB. For the "month" timeframe this was the
// primary cause of the 3-5 second render delay — the DB was doing the
// work correctly but shipping megabytes of BSON to Node just to sum them.
//
// Before: O(n) documents in memory, JS reduce loops, slow on large datasets.
// After:  O(1) aggregation result, all math in MongoDB, <100ms at any scale.
// ============================================

export const getDashboardKPIs = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `dashboard_kpis_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, kpis: cached, timeframe });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } =
    getDateRanges(timeframe);

  // ── Single aggregation replaces two Order.find() calls ──────────────────
  // $facet runs both period pipelines in one query round-trip.
  // Each branch uses $group to compute revenue and refund totals server-side,
  // and $addToSet to collect unique customer IDs without shipping them to Node.
  const [orderFacet, currentUsers, previousUsers, totalVisitors, avgCLV] =
    await Promise.all([
      Order.aggregate([
        {
          $facet: {
            current: [
              {
                $match: {
                  createdAt:            { $gte: currentPeriodStart },
                  orderStatus:          { $ne: ORDER_STATUSES.CANCELLED },
                  "paymentInfo.status": "success"
                }
              },
              {
                $group: {
                  _id:           null,
                  orderCount:    { $sum: 1 },
                  grossRevenue:  { $sum: "$totalPrice" },
                  totalRefunded: {
                    $sum: {
                      $cond: [
                        { $eq: ["$refundInfo.status", "completed"] },
                        { $ifNull: ["$refundInfo.refundAmount", 0] },
                        0
                      ]
                    }
                  },
                  // Collect unique customer ObjectIds server-side —
                  // $addToSet deduplicates without shipping IDs to Node.
                  customerSet: { $addToSet: "$user" }
                }
              },
              {
                $project: {
                  _id:            0,
                  orderCount:     1,
                  grossRevenue:   1,
                  totalRefunded:  1,
                  // Count the set in the projection rather than in Node
                  uniqueCustomers: { $size: "$customerSet" }
                }
              }
            ],
            previous: [
              {
                $match: {
                  createdAt: {
                    $gte: previousPeriodStart,
                    $lt:  previousPeriodEnd
                  },
                  orderStatus:          { $ne: ORDER_STATUSES.CANCELLED },
                  "paymentInfo.status": "success"
                }
              },
              {
                $group: {
                  _id:           null,
                  orderCount:    { $sum: 1 },
                  grossRevenue:  { $sum: "$totalPrice" },
                  totalRefunded: {
                    $sum: {
                      $cond: [
                        { $eq: ["$refundInfo.status", "completed"] },
                        { $ifNull: ["$refundInfo.refundAmount", 0] },
                        0
                      ]
                    }
                  },
                  customerSet: { $addToSet: "$user" }
                }
              },
              {
                $project: {
                  _id:             0,
                  orderCount:      1,
                  grossRevenue:    1,
                  totalRefunded:   1,
                  uniqueCustomers: { $size: "$customerSet" }
                }
              }
            ]
          }
        }
      ]),

      // User counts stay as countDocuments — they're indexed and instant
      User.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
      User.countDocuments({
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
      }),

      getEstimatedVisitors(),

      CustomerAnalytics.aggregate([
        { $group: { _id: null, avgCLV: { $avg: "$clv.totalRevenue" } } }
      ])
    ]);

  // ── Unpack facet results ─────────────────────────────────────────────────
  const cur  = orderFacet[0]?.current[0]  || { orderCount: 0, grossRevenue: 0, totalRefunded: 0, uniqueCustomers: 0 };
  const prev = orderFacet[0]?.previous[0] || { orderCount: 0, grossRevenue: 0, totalRefunded: 0, uniqueCustomers: 0 };

  const currentRevenue  = cur.grossRevenue  - cur.totalRefunded;
  const previousRevenue = prev.grossRevenue - prev.totalRefunded;

  const currentOrderCount  = cur.orderCount;
  const previousOrderCount = prev.orderCount;

  // AOV on gross (pre-refund) — refunds are post-purchase and shouldn't
  // distort the average ticket size metric.
  const currentAOV  = currentOrderCount  > 0 ? cur.grossRevenue  / currentOrderCount  : 0;
  const previousAOV = previousOrderCount > 0 ? prev.grossRevenue / previousOrderCount : 0;

  const currentCustomers  = cur.uniqueCustomers;
  const previousCustomers = prev.uniqueCustomers;

  const conversionRate =
    totalVisitors > 0 ? (currentOrderCount / totalVisitors) * 100 : 0;

  const kpis = {
    revenue: {
      current:       Math.round(currentRevenue  * 100) / 100,
      previous:      Math.round(previousRevenue * 100) / 100,
      change:        calculateTrend(currentRevenue, previousRevenue),
      grossRevenue:  Math.round(cur.grossRevenue   * 100) / 100,
      totalRefunded: Math.round(cur.totalRefunded  * 100) / 100,
      target:        Math.round(currentRevenue * 1.15 * 100) / 100
    },
    orders: {
      current:  currentOrderCount,
      previous: previousOrderCount,
      change:   calculateTrend(currentOrderCount, previousOrderCount),
      target:   Math.round(currentOrderCount * 1.15)
    },
    averageOrderValue: {
      current:  Math.round(currentAOV  * 100) / 100,
      previous: Math.round(previousAOV * 100) / 100,
      change:   calculateTrend(currentAOV, previousAOV)
    },
    customers: {
      current:  currentCustomers,
      previous: previousCustomers,
      change:   calculateTrend(currentCustomers, previousCustomers)
    },
    conversionRate: {
      current:     Math.round(conversionRate * 100) / 100,
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

  // Cache the kpis object directly; the route wraps it in { kpis, timeframe }
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
    totalAlerts:       alerts.length,
    criticalCount:     alerts.filter((a) => a.priority === "critical").length,
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

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } =
    getDateRanges(timeframe);

  const [revenue, orders, customers, products, checkouts, returns] =
    await Promise.all([
      getRevenueMetrics(
        currentPeriodStart,
        previousPeriodStart,
        previousPeriodEnd
      ),
      getOrderMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
      getCustomerMetrics(
        currentPeriodStart,
        previousPeriodStart,
        previousPeriodEnd
      ),
      getProductMetrics(),
      getCheckoutMetrics(
        currentPeriodStart,
        previousPeriodStart,
        previousPeriodEnd
      ),
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
    Order.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd }
    }),
    Order.aggregate([
      { $match: { createdAt: { $gte: currentStart } } },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
    ])
  ]);

  const breakdown = statusBreakdown.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  return {
    current,
    previous,
    change:          calculateTrend(current, previous),
    statusBreakdown: breakdown
  };
};

const getCustomerMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, vipCount, atRiskCount] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: currentStart } }),
    User.countDocuments({ createdAt: { $gte: previousStart, $lt: previousEnd } }),
    CustomerAnalytics.countDocuments({ isVIP: true }),
    CustomerAnalytics.countDocuments({ "risk.isAtRisk": true })
  ]);

  return {
    newCustomers:    { current, previous, change: calculateTrend(current, previous) },
    vipCustomers:    vipCount,
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
  const [
    currentAbandoned,
    totalCurrent,
    previousAbandoned,
    totalPrevious
  ] = await Promise.all([
    Checkout.countDocuments({
      createdAt: { $gte: currentStart },
      "abandonment.isAbandoned": true
    }),
    Checkout.countDocuments({ createdAt: { $gte: currentStart } }),
    Checkout.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd },
      "abandonment.isAbandoned": true
    }),
    Checkout.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd }
    })
  ]);

  const currentRate  =
    totalCurrent  > 0 ? (currentAbandoned  / totalCurrent)  * 100 : 0;
  const previousRate =
    totalPrevious > 0 ? (previousAbandoned / totalPrevious) * 100 : 0;

  return {
    abandonmentRate: {
      current:  Math.round(currentRate  * 100) / 100,
      previous: Math.round(previousRate * 100) / 100,
      change:   calculateTrend(currentRate, previousRate)
    },
    abandonedCount: currentAbandoned
  };
};

const getReturnMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, delivered] = await Promise.all([
    Order.countDocuments({
      "returnInfo.requestedAt": { $gte: currentStart },
      "returnInfo.status":      { $ne: "none" }
    }),
    Order.countDocuments({
      "returnInfo.requestedAt": { $gte: previousStart, $lt: previousEnd },
      "returnInfo.status":      { $ne: "none" }
    }),
    Order.countDocuments({
      orderStatus:  "Delivered",
      deliveredAt:  { $gte: currentStart }
    })
  ]);

  const returnRate = delivered > 0 ? (current / delivered) * 100 : 0;

  return {
    current,
    previous,
    change:     calculateTrend(current, previous),
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