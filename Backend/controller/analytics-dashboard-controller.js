import handleAsyncError from "../middleware/handleAsyncError.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";
import Checkout from "../models/checkout-model.js";
import { ORDER_STATUSES } from "../constants/analytics.constants.js";

/**
 * Analytics Dashboard Controller
 * Aggregates data from all analytics domains for a unified dashboard view
 */

// ============================================
// MAIN DASHBOARD OVERVIEW
// ============================================

/**
 * Get comprehensive dashboard overview
 * @route GET /api/v1/analytics/dashboard
 * @access Admin
 */
export const getDashboardOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `dashboard_overview_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  // Run all metrics in parallel for performance
  const [
    revenueMetrics,
    orderMetrics,
    customerMetrics,
    productMetrics,
    checkoutMetrics,
    returnMetrics
  ] = await Promise.all([
    getRevenueMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getOrderMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getCustomerMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getProductMetrics(currentPeriodStart),
    getCheckoutMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd),
    getReturnMetrics(currentPeriodStart, previousPeriodStart, previousPeriodEnd)
  ]);

  const response = {
    revenue: revenueMetrics,
    orders: orderMetrics,
    customers: customerMetrics,
    products: productMetrics,
    checkouts: checkoutMetrics,
    returns: returnMetrics,
    timeframe,
    generatedAt: new Date()
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// KEY METRICS SUMMARY
// ============================================

/**
 * Get key performance indicators (KPIs)
 * @route GET /api/v1/analytics/dashboard/kpis
 * @access Admin
 */
export const getDashboardKPIs = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `dashboard_kpis_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  // Get current and previous period orders for KPI calculations
  const [currentOrders, previousOrders] = await Promise.all([
    Order.find({
      createdAt: { $gte: currentPeriodStart },
      orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
      'paymentInfo.status': 'success'
    }).select('totalPrice orderItems user createdAt'),
    Order.find({
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd },
      orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
      'paymentInfo.status': 'success'
    }).select('totalPrice orderItems user')
  ]);

  // Calculate current period metrics
  const currentRevenue = currentOrders.reduce((sum, order) => sum + order.totalPrice, 0);
  const currentOrderCount = currentOrders.length;
  const currentAOV = currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0;
  const currentCustomers = new Set(currentOrders.map(o => o.user?.toString())).size;

  // Calculate previous period metrics
  const previousRevenue = previousOrders.reduce((sum, order) => sum + order.totalPrice, 0);
  const previousOrderCount = previousOrders.length;
  const previousAOV = previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;
  const previousCustomers = new Set(previousOrders.map(o => o.user?.toString())).size;

  // Get conversion rate (orders / total sessions or visitors)
  // Note: This requires session tracking - placeholder calculation
  const totalVisitors = await getEstimatedVisitors(currentPeriodStart);
  const conversionRate = totalVisitors > 0 ? (currentOrderCount / totalVisitors) * 100 : 0;

  // Get customer lifetime value
  const avgCLV = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: null,
        avgCLV: { $avg: '$clv.totalRevenue' }
      }
    }
  ]);

  const kpis = {
    revenue: {
      current: Math.round(currentRevenue * 100) / 100,
      previous: Math.round(previousRevenue * 100) / 100,
      trend: calculateTrend(currentRevenue, previousRevenue),
      target: Math.round(currentRevenue * 1.15 * 100) / 100 // 15% growth target
    },
    orders: {
      current: currentOrderCount,
      previous: previousOrderCount,
      trend: calculateTrend(currentOrderCount, previousOrderCount),
      target: Math.round(currentOrderCount * 1.15)
    },
    averageOrderValue: {
      current: Math.round(currentAOV * 100) / 100,
      previous: Math.round(previousAOV * 100) / 100,
      trend: calculateTrend(currentAOV, previousAOV)
    },
    customers: {
      current: currentCustomers,
      previous: previousCustomers,
      trend: calculateTrend(currentCustomers, previousCustomers)
    },
    conversionRate: {
      current: Math.round(conversionRate * 100) / 100,
      description: 'Orders / Estimated Visitors'
    },
    customerLifetimeValue: {
      average: Math.round((avgCLV[0]?.avgCLV || 0) * 100) / 100
    },
    revenuePerCustomer: {
      current: currentCustomers > 0 ? Math.round((currentRevenue / currentCustomers) * 100) / 100 : 0
    }
  };

  await setCache(cacheKey, kpis, 300);

  res.status(200).json({
    success: true,
    kpis,
    timeframe
  });
});

// ============================================
// REVENUE TRENDS
// ============================================

/**
 * Get revenue trends over time
 * @route GET /api/v1/analytics/dashboard/revenue-trends
 * @access Admin
 */
export const getRevenueTrends = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", groupBy = "day" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `revenue_trends_${timeframe}_${groupBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Determine date grouping format
  const dateFormat = groupBy === "hour"
    ? { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } }
    : groupBy === "week"
    ? { $dateToString: { format: "%Y-W%V", date: "$createdAt" } }
    : groupBy === "month"
    ? { $dateToString: { format: "%Y-%m", date: "$createdAt" } }
    : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };

  const trends = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    {
      $group: {
        _id: dateFormat,
        revenue: { $sum: '$totalPrice' },
        orders: { $sum: 1 },
        avgOrderValue: { $avg: '$totalPrice' },
        customers: { $addToSet: '$user' }
      }
    },
    {
      $project: {
        date: '$_id',
        revenue: { $round: ['$revenue', 2] },
        orders: 1,
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        uniqueCustomers: { $size: '$customers' }
      }
    },
    {
      $sort: { date: 1 }
    }
  ]);

  // Calculate cumulative revenue
  let cumulativeRevenue = 0;
  const trendsWithCumulative = trends.map(item => {
    cumulativeRevenue += item.revenue;
    return {
      ...item,
      cumulativeRevenue: Math.round(cumulativeRevenue * 100) / 100
    };
  });

  const response = {
    trends: trendsWithCumulative,
    summary: {
      totalRevenue: Math.round(cumulativeRevenue * 100) / 100,
      totalOrders: trends.reduce((sum, t) => sum + t.orders, 0),
      avgDailyRevenue: trends.length > 0 
        ? Math.round((cumulativeRevenue / trends.length) * 100) / 100 
        : 0
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// TOP PERFORMERS
// ============================================

/**
 * Get top performing entities (products, customers, categories)
 * @route GET /api/v1/analytics/dashboard/top-performers
 * @access Admin
 */
export const getTopPerformers = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `top_performers_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const [topProducts, topCustomers, topCategories] = await Promise.all([
    getTopProducts(currentPeriodStart, 10),
    getTopCustomers(currentPeriodStart, 10),
    getTopCategories(currentPeriodStart)
  ]);

  const response = {
    topProducts,
    topCustomers,
    topCategories
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// ALERTS & NOTIFICATIONS
// ============================================

/**
 * Get dashboard alerts and notifications
 * @route GET /api/v1/analytics/dashboard/alerts
 * @access Admin
 */
export const getDashboardAlerts = handleAsyncError(async (req, res, next) => {
  const cacheKey = 'dashboard_alerts';
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const alerts = [];

  // Check for low stock products
  const lowStockCount = await Product.countDocuments({
    status: 'published',
    'inventory.trackInventory': true,
    $expr: {
      $and: [
        { $gt: ['$inventory.stock', 0] },
        { $lte: ['$inventory.stock', '$inventory.lowStockThreshold'] }
      ]
    }
  });

  if (lowStockCount > 0) {
    alerts.push({
      type: 'warning',
      category: 'inventory',
      message: `${lowStockCount} product(s) are low in stock`,
      priority: 'medium',
      actionUrl: '/admin/inventory/low-stock'
    });
  }

  // Check for out of stock products
  const outOfStockCount = await Product.countDocuments({
    status: 'published',
    'inventory.stock': 0,
    'inventory.trackInventory': true
  });

  if (outOfStockCount > 0) {
    alerts.push({
      type: 'error',
      category: 'inventory',
      message: `${outOfStockCount} product(s) are out of stock`,
      priority: 'high',
      actionUrl: '/admin/inventory/out-of-stock'
    });
  }

  // Check for high-risk customers
  const atRiskCustomers = await CustomerAnalytics.countDocuments({
    'risk.isAtRisk': true,
    'risk.churnPrediction': { $in: ['critical', 'high'] }
  });

  if (atRiskCustomers > 0) {
    alerts.push({
      type: 'warning',
      category: 'customers',
      message: `${atRiskCustomers} high-value customer(s) at risk of churning`,
      priority: 'high',
      actionUrl: '/admin/customers/at-risk'
    });
  }

  // Check for abandoned checkouts
  const abandonedCheckouts = await Checkout.countDocuments({
    'abandonment.isAbandoned': true,
    'conversion.isConverted': false,
    'abandonment.abandonedAt': {
      $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    }
  });

  if (abandonedCheckouts > 5) {
    alerts.push({
      type: 'info',
      category: 'checkout',
      message: `${abandonedCheckouts} checkout(s) abandoned in the last 24 hours`,
      priority: 'medium',
      actionUrl: '/admin/checkout/abandoned'
    });
  }

  // Check for pending fraud reviews
  const pendingFraudReviews = await Order.countDocuments({
    'fraudCheck.reviewRequired': true,
    'fraudCheck.reviewDecision': 'Pending'
  });

  if (pendingFraudReviews > 0) {
    alerts.push({
      type: 'warning',
      category: 'fraud',
      message: `${pendingFraudReviews} order(s) pending fraud review`,
      priority: 'high',
      actionUrl: '/admin/orders/fraud-review'
    });
  }

  // Check for SLA breaches
  const slaBreaches = await Order.countDocuments({
    'fulfillmentSLA.slaBreached': true,
    orderStatus: { $in: ['Processing', 'Shipped'] }
  });

  if (slaBreaches > 0) {
    alerts.push({
      type: 'error',
      category: 'fulfillment',
      message: `${slaBreaches} order(s) have breached SLA`,
      priority: 'critical',
      actionUrl: '/admin/fulfillment/sla-breaches'
    });
  }

  // Check for high return rate
  const recentReturns = await Order.countDocuments({
    'returnInfo.status': { $nin: ['none', 'rejected'] },
    'returnInfo.requestedAt': {
      $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
    }
  });

  if (recentReturns > 10) {
    alerts.push({
      type: 'info',
      category: 'returns',
      message: `${recentReturns} return(s) in the last 7 days`,
      priority: 'medium',
      actionUrl: '/admin/returns/overview'
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const response = {
    alerts,
    totalAlerts: alerts.length,
    criticalCount: alerts.filter(a => a.priority === 'critical').length,
    highPriorityCount: alerts.filter(a => a.priority === 'high').length
  };

  await setCache(cacheKey, response, 180); // Cache for 3 minutes

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

const getRevenueMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: currentStart },
          orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
          'paymentInfo.status': 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPrice' },
          totalProfit: { $sum: '$profitAnalysis.netProfit' },
          orders: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: previousStart, $lt: previousEnd },
          orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
          'paymentInfo.status': 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPrice' },
          orders: { $sum: 1 }
        }
      }
    ])
  ]);

  const currentRevenue = current[0]?.totalRevenue || 0;
  const previousRevenue = previous[0]?.totalRevenue || 0;
  const currentProfit = current[0]?.totalProfit || 0;

  return {
    current: Math.round(currentRevenue * 100) / 100,
    previous: Math.round(previousRevenue * 100) / 100,
    trend: calculateTrend(currentRevenue, previousRevenue),
    profit: Math.round(currentProfit * 100) / 100,
    profitMargin: currentRevenue > 0 ? Math.round((currentProfit / currentRevenue) * 100 * 100) / 100 : 0
  };
};

const getOrderMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, statusBreakdown] = await Promise.all([
    Order.countDocuments({
      createdAt: { $gte: currentStart }
    }),
    Order.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd }
    }),
    Order.aggregate([
      {
        $match: { createdAt: { $gte: currentStart } }
      },
      {
        $group: {
          _id: '$orderStatus',
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  const breakdown = statusBreakdown.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  return {
    current,
    previous,
    trend: calculateTrend(current, previous),
    statusBreakdown: breakdown
  };
};

const getCustomerMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, vipCount, atRiskCount] = await Promise.all([
    User.countDocuments({
      createdAt: { $gte: currentStart }
    }),
    User.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd }
    }),
    CustomerAnalytics.countDocuments({ isVIP: true }),
    CustomerAnalytics.countDocuments({ 'risk.isAtRisk': true })
  ]);

  return {
    newCustomers: {
      current,
      previous,
      trend: calculateTrend(current, previous)
    },
    vipCustomers: vipCount,
    atRiskCustomers: atRiskCount
  };
};

const getProductMetrics = async (currentStart) => {
  const [total, published, lowStock, outOfStock] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ status: 'published' }),
    Product.countDocuments({
      status: 'published',
      'inventory.trackInventory': true,
      $expr: {
        $and: [
          { $gt: ['$inventory.stock', 0] },
          { $lte: ['$inventory.stock', '$inventory.lowStockThreshold'] }
        ]
      }
    }),
    Product.countDocuments({
      status: 'published',
      'inventory.stock': 0,
      'inventory.trackInventory': true
    })
  ]);

  return {
    total,
    published,
    lowStock,
    outOfStock
  };
};

const getCheckoutMetrics = async (currentStart, previousStart, previousEnd) => {
  const [currentAbandoned, totalCurrent, previousAbandoned, totalPrevious] = await Promise.all([
    Checkout.countDocuments({
      createdAt: { $gte: currentStart },
      'abandonment.isAbandoned': true
    }),
    Checkout.countDocuments({
      createdAt: { $gte: currentStart }
    }),
    Checkout.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd },
      'abandonment.isAbandoned': true
    }),
    Checkout.countDocuments({
      createdAt: { $gte: previousStart, $lt: previousEnd }
    })
  ]);

  const currentRate = totalCurrent > 0 ? (currentAbandoned / totalCurrent) * 100 : 0;
  const previousRate = totalPrevious > 0 ? (previousAbandoned / totalPrevious) * 100 : 0;

  return {
    abandonmentRate: {
      current: Math.round(currentRate * 100) / 100,
      previous: Math.round(previousRate * 100) / 100,
      trend: calculateTrend(currentRate, previousRate)
    },
    abandonedCount: currentAbandoned
  };
};

const getReturnMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous, delivered] = await Promise.all([
    Order.countDocuments({
      'returnInfo.requestedAt': { $gte: currentStart },
      'returnInfo.status': { $ne: 'none' }
    }),
    Order.countDocuments({
      'returnInfo.requestedAt': { $gte: previousStart, $lt: previousEnd },
      'returnInfo.status': { $ne: 'none' }
    }),
    Order.countDocuments({
      orderStatus: 'Delivered',
      deliveredAt: { $gte: currentStart }
    })
  ]);

  const returnRate = delivered > 0 ? (current / delivered) * 100 : 0;

  return {
    current,
    previous,
    trend: calculateTrend(current, previous),
    returnRate: Math.round(returnRate * 100) / 100
  };
};

const getTopProducts = async (startDate, limit) => {
  const products = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    { $unwind: '$orderItems' },
    {
      $group: {
        _id: '$orderItems.product',
        revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
        unitsSold: { $sum: '$orderItems.quantity' },
        orders: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: limit }
  ]);

  return Promise.all(
    products.map(async (item) => {
      const product = await Product.findById(item._id).select('name images pricing');
      return {
        product: product ? {
          _id: product._id,
          name: product.name,
          image: product.images?.[0]?.url,
          price: product.pricing?.regular || product.price
        } : null,
        revenue: Math.round(item.revenue * 100) / 100,
        unitsSold: item.unitsSold,
        orders: item.orders
      };
    })
  ).then(results => results.filter(r => r.product !== null));
};

const getTopCustomers = async (startDate, limit) => {
  const customers = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    {
      $group: {
        _id: '$user',
        totalSpent: { $sum: '$totalPrice' },
        orderCount: { $sum: 1 }
      }
    },
    { $sort: { totalSpent: -1 } },
    { $limit: limit }
  ]);

  return Promise.all(
    customers.map(async (item) => {
      const user = await User.findById(item._id).select('firstName lastName email');
      return {
        customer: user ? {
          _id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email
        } : null,
        totalSpent: Math.round(item.totalSpent * 100) / 100,
        orderCount: item.orderCount,
        avgOrderValue: Math.round((item.totalSpent / item.orderCount) * 100) / 100
      };
    })
  ).then(results => results.filter(r => r.customer !== null));
};

const getTopCategories = async (startDate) => {
  return await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    { $unwind: '$orderItems' },
    {
      $lookup: {
        from: 'products',
        localField: 'orderItems.product',
        foreignField: '_id',
        as: 'productDetails'
      }
    },
    { $unwind: '$productDetails' },
    {
      $group: {
        _id: '$productDetails.category',
        revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
        unitsSold: { $sum: '$orderItems.quantity' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 },
    {
      $project: {
        category: '$_id',
        revenue: { $round: ['$revenue', 2] },
        unitsSold: 1,
        _id: 0
      }
    }
  ]);
};

const getEstimatedVisitors = async (startDate) => {
  // This is a placeholder - implement with actual session tracking
  const totalViews = await Product.aggregate([
    {
      $group: {
        _id: null,
        totalViews: { $sum: '$analytics.views' }
      }
    }
  ]);
  
  // Rough estimate: assume 10 page views per visitor
  return Math.floor((totalViews[0]?.totalViews || 0) / 10);
};

export default {
  getDashboardOverview,
  getDashboardKPIs,
  getRevenueTrends,
  getTopPerformers,
  getDashboardAlerts
};