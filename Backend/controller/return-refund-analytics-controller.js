import handleAsyncError from "../middleware/handleAsyncError.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";
// FIX RR1: calculateTrend was missing. Both getReturnOverview and getRefundOverview
// calculated trends manually inline — inconsistent with every other controller and
// wrong when previous is 0 (divide-by-zero produces NaN, not 100% increase).
import { calculateTrend } from "../utils/calculateTrend.js";

// ============================================
// RETURN ANALYTICS
// ============================================

export const getReturnOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `return_overview_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [currentReturns, previousReturns] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "returnInfo.requestedAt": { $gte: currentPeriodStart },
          "returnInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id: null,
          totalReturns: { $sum: 1 },
          requested: { $sum: { $cond: [{ $eq: ["$returnInfo.status", "requested"] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$returnInfo.status", "approved"] }, 1, 0] } },
          inTransit: { $sum: { $cond: [{ $eq: ["$returnInfo.status", "in_transit"] }, 1, 0] } },
          received: { $sum: { $cond: [{ $eq: ["$returnInfo.status", "received"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$returnInfo.status", "completed"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$returnInfo.status", "rejected"] }, 1, 0] } },
          totalValue: { $sum: "$totalPrice" },
          avgOrderValue: { $avg: "$totalPrice" }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          "returnInfo.requestedAt": { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          "returnInfo.status": { $ne: "none" }
        }
      },
      { $group: { _id: null, totalReturns: { $sum: 1 } } }
    ])
  ]);

  const totalDeliveredOrders = await Order.countDocuments({
    orderStatus: "Delivered",
    deliveredAt: { $gte: currentPeriodStart }
  });

  const current = currentReturns[0] || {
    totalReturns: 0,
    requested: 0,
    approved: 0,
    inTransit: 0,
    received: 0,
    completed: 0,
    rejected: 0,
    totalValue: 0,
    avgOrderValue: 0
  };
  const previous = previousReturns[0] || { totalReturns: 0 };

  const returnRate =
    totalDeliveredOrders > 0
      ? Math.round((current.totalReturns / totalDeliveredOrders) * 100 * 100) / 100
      : 0;

  const [returnReasons, processingTimes] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "returnInfo.requestedAt": { $gte: currentPeriodStart },
          "returnInfo.status": { $ne: "none" }
        }
      },
      { $group: { _id: "$returnInfo.reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Order.aggregate([
      {
        $match: {
          "returnInfo.status": "completed",
          "returnInfo.requestedAt": { $gte: currentPeriodStart }
        }
      },
      {
        $project: {
          processingTime: {
            $divide: [
              { $subtract: ["$returnInfo.completedAt", "$returnInfo.requestedAt"] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      { $group: { _id: null, avgProcessingDays: { $avg: "$processingTime" } } }
    ])
  ]);

  const response = {
    currentPeriod: {
      ...current,
      returnRate,
      avgProcessingDays: processingTimes[0]?.avgProcessingDays || 0
    },
    previousPeriod: { totalReturns: previous.totalReturns },
    // FIX RR1: Use calculateTrend — handles previous=0 safely (returns 0 not NaN).
    trend: calculateTrend(current.totalReturns, previous.totalReturns),
    breakdown: {
      byStatus: {
        requested: current.requested,
        approved: current.approved,
        inTransit: current.inTransit,
        received: current.received,
        completed: current.completed,
        rejected: current.rejected
      },
      byReason: returnReasons
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getReturnsByProduct = handleAsyncError(async (req, res, next) => {
  const { limit = 20, sortBy = "returnRate" } = req.query;

  const cacheKey = `returns_by_product_${limit}_${sortBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const [returnsByProduct, productSales] = await Promise.all([
    Order.aggregate([
      { $match: { "returnInfo.status": { $nin: ["none", "rejected"] } } },
      { $unwind: "$returnInfo.itemsToReturn" },
      {
        $group: {
          _id: "$returnInfo.itemsToReturn.product",
          totalReturns: { $sum: 1 },
          totalQuantity: { $sum: "$returnInfo.itemsToReturn.quantity" }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          orderStatus: { $in: ["Delivered", "Shipped"] },
          "paymentInfo.status": "success"
        }
      },
      { $unwind: "$orderItems" },
      {
        $group: {
          _id: "$orderItems.product",
          totalSales: { $sum: 1 },
          totalQuantitySold: { $sum: "$orderItems.quantity" }
        }
      }
    ])
  ]);

  const salesMap = new Map(
    productSales.map((item) => [item._id.toString(), item])
  );

  const productsWithReturnRate = await Promise.all(
    returnsByProduct.map(async (item) => {
      const productId = item._id.toString();
      const sales = salesMap.get(productId) || { totalSales: 0, totalQuantitySold: 0 };

      const product = await Product.findById(item._id).select(
        "name images category pricing"
      );

      const returnRate =
        sales.totalSales > 0
          ? Math.round((item.totalReturns / sales.totalSales) * 100 * 100) / 100
          : 0;

      return {
        product: product
          ? {
              _id: product._id,
              name: product.name,
              image: product.images?.[0]?.url,
              category: product.category,
              price: product.pricing?.regular || 0
            }
          : null,
        returns: { totalReturns: item.totalReturns, totalQuantity: item.totalQuantity },
        sales: { totalSales: sales.totalSales, totalQuantitySold: sales.totalQuantitySold },
        returnRate
      };
    })
  );

  let sortedProducts = productsWithReturnRate.filter((p) => p.product !== null);
  if (sortBy === "returnRate") {
    sortedProducts.sort((a, b) => b.returnRate - a.returnRate);
  } else if (sortBy === "totalReturns") {
    sortedProducts.sort((a, b) => b.returns.totalReturns - a.returns.totalReturns);
  }

  const limitedProducts = sortedProducts.slice(0, parseInt(limit));

  const response = {
    products: limitedProducts,
    summary: {
      totalProductsWithReturns: sortedProducts.length,
      avgReturnRate:
        sortedProducts.length > 0
          ? Math.round(
              (sortedProducts.reduce((sum, p) => sum + p.returnRate, 0) /
                sortedProducts.length) *
                100
            ) / 100
          : 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getReturnsByCategory = handleAsyncError(async (req, res, next) => {
  const cacheKey = "returns_by_category";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const [returnsByCategory, salesByCategory] = await Promise.all([
    Order.aggregate([
      { $match: { "returnInfo.status": { $nin: ["none", "rejected"] } } },
      { $unwind: "$returnInfo.itemsToReturn" },
      {
        $lookup: {
          from: "products",
          localField: "returnInfo.itemsToReturn.product",
          foreignField: "_id",
          as: "productDetails"
        }
      },
      { $unwind: "$productDetails" },
      { $group: { _id: "$productDetails.category", totalReturns: { $sum: 1 } } },
      { $sort: { totalReturns: -1 } }
    ]),
    Order.aggregate([
      {
        $match: {
          orderStatus: { $in: ["Delivered", "Shipped"] },
          "paymentInfo.status": "success"
        }
      },
      { $unwind: "$orderItems" },
      {
        $lookup: {
          from: "products",
          localField: "orderItems.product",
          foreignField: "_id",
          as: "productDetails"
        }
      },
      { $unwind: "$productDetails" },
      { $group: { _id: "$productDetails.category", totalSales: { $sum: 1 } } }
    ])
  ]);

  const salesMap = new Map(salesByCategory.map((item) => [item._id, item.totalSales]));

  const categoriesWithReturnRate = returnsByCategory.map((item) => {
    const totalSales = salesMap.get(item._id) || 0;
    const returnRate =
      totalSales > 0
        ? Math.round((item.totalReturns / totalSales) * 100 * 100) / 100
        : 0;
    return { category: item._id, totalReturns: item.totalReturns, totalSales, returnRate };
  });

  const response = { categories: categoriesWithReturnRate };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// REFUND ANALYTICS
// ============================================

export const getRefundOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `refund_overview_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [currentRefunds, previousRefunds] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "refundInfo.requestedAt": { $gte: currentPeriodStart },
          "refundInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id: null,
          totalRefunds: { $sum: 1 },
          requested: { $sum: { $cond: [{ $eq: ["$refundInfo.status", "requested"] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$refundInfo.status", "approved"] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ["$refundInfo.status", "processing"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$refundInfo.status", "completed"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$refundInfo.status", "rejected"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$refundInfo.status", "failed"] }, 1, 0] } },
          totalRefundAmount: { $sum: "$refundInfo.refundAmount" },
          avgRefundAmount: { $avg: "$refundInfo.refundAmount" }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          "refundInfo.requestedAt": { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          "refundInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id: null,
          totalRefunds: { $sum: 1 },
          totalRefundAmount: { $sum: "$refundInfo.refundAmount" }
        }
      }
    ])
  ]);

  const current = currentRefunds[0] || {
    totalRefunds: 0,
    requested: 0,
    approved: 0,
    processing: 0,
    completed: 0,
    rejected: 0,
    failed: 0,
    totalRefundAmount: 0,
    avgRefundAmount: 0
  };
  const previous = previousRefunds[0] || { totalRefunds: 0, totalRefundAmount: 0 };

  const [refundReasons, processingTimes] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "refundInfo.requestedAt": { $gte: currentPeriodStart },
          "refundInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id: "$refundInfo.reason",
          count: { $sum: 1 },
          totalAmount: { $sum: "$refundInfo.refundAmount" }
        }
      },
      { $sort: { count: -1 } }
    ]),
    Order.aggregate([
      {
        $match: {
          "refundInfo.status": "completed",
          "refundInfo.requestedAt": { $gte: currentPeriodStart }
        }
      },
      {
        $project: {
          processingTime: {
            $divide: [
              { $subtract: ["$refundInfo.refundedAt", "$refundInfo.requestedAt"] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      { $group: { _id: null, avgProcessingDays: { $avg: "$processingTime" } } }
    ])
  ]);

  const response = {
    currentPeriod: {
      ...current,
      avgProcessingDays: processingTimes[0]?.avgProcessingDays || 0
    },
    previousPeriod: {
      totalRefunds: previous.totalRefunds,
      totalRefundAmount: previous.totalRefundAmount
    },
    trends: {
      // FIX RR1 (same): Use calculateTrend instead of manual divide-by-zero-prone expression.
      refunds: calculateTrend(current.totalRefunds, previous.totalRefunds),
      amount: calculateTrend(current.totalRefundAmount, previous.totalRefundAmount)
    },
    breakdown: {
      byStatus: {
        requested: current.requested,
        approved: current.approved,
        processing: current.processing,
        completed: current.completed,
        rejected: current.rejected,
        failed: current.failed
      },
      byReason: refundReasons
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getRefundsByPaymentMethod = handleAsyncError(async (req, res, next) => {
  const cacheKey = "refunds_by_payment_method";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const [refundsByMethod, ordersByMethod] = await Promise.all([
    Order.aggregate([
      { $match: { "refundInfo.status": "completed" } },
      {
        $group: {
          _id: "$paymentInfo.method",
          totalRefunds: { $sum: 1 },
          totalRefundAmount: { $sum: "$refundInfo.refundAmount" },
          avgRefundAmount: { $avg: "$refundInfo.refundAmount" }
        }
      },
      { $sort: { totalRefunds: -1 } }
    ]),
    Order.aggregate([
      { $match: { "paymentInfo.status": "success" } },
      { $group: { _id: "$paymentInfo.method", totalOrders: { $sum: 1 } } }
    ])
  ]);

  const ordersMap = new Map(ordersByMethod.map((item) => [item._id, item.totalOrders]));

  const methodsWithRefundRate = refundsByMethod.map((item) => {
    const totalOrders = ordersMap.get(item._id) || 0;
    const refundRate =
      totalOrders > 0
        ? Math.round((item.totalRefunds / totalOrders) * 100 * 100) / 100
        : 0;

    return {
      paymentMethod: item._id,
      totalRefunds: item.totalRefunds,
      totalRefundAmount: Math.round(item.totalRefundAmount * 100) / 100,
      avgRefundAmount: Math.round(item.avgRefundAmount * 100) / 100,
      totalOrders,
      refundRate
    };
  });

  const response = { byPaymentMethod: methodsWithRefundRate };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", groupBy = "day" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `refund_timeline_${timeframe}_${groupBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const dateFormat =
    groupBy === "hour"
      ? { $dateToString: { format: "%Y-%m-%d %H:00", date: "$refundInfo.requestedAt" } }
      : { $dateToString: { format: "%Y-%m-%d", date: "$refundInfo.requestedAt" } };

  const timeline = await Order.aggregate([
    {
      $match: {
        "refundInfo.requestedAt": { $gte: currentPeriodStart },
        "refundInfo.status": { $ne: "none" }
      }
    },
    {
      $group: {
        _id: dateFormat,
        totalRefunds: { $sum: 1 },
        totalAmount: { $sum: "$refundInfo.refundAmount" },
        completed: {
          $sum: { $cond: [{ $eq: ["$refundInfo.status", "completed"] }, 1, 0] }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const response = {
    timeline,
    summary: {
      totalRefunds: timeline.reduce((sum, t) => sum + t.totalRefunds, 0),
      totalAmount: timeline.reduce((sum, t) => sum + t.totalAmount, 0),
      totalCompleted: timeline.reduce((sum, t) => sum + t.completed, 0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getReturnOverview,
  getReturnsByProduct,
  getReturnsByCategory,
  getRefundOverview,
  getRefundsByPaymentMethod,
  getRefundTimeline
};