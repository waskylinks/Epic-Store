import handleAsyncError from "../middleware/handleAsyncError.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { ORDER_STATUSES } from "../constants/analytics.constants.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import { getCache, setCache } from "../utils/redis.js";

/**
 * Admin Stats Controller
 * Provides comprehensive admin statistics with trend analysis
 */

// ============================================
// ADMIN STATS WITH TRENDS
// ============================================

/**
 * Get comprehensive admin statistics with trends
 * @route GET /api/v1/admin/stats
 * @query {string} timeframe - 'day' | 'week' | 'month' | 'year' (default: 'month')
 * @access Admin
 */
export const getAdminStats = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `admin_stats_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } =
    getDateRanges(timeframe);

  // ============================================
  // PRODUCTS STATS WITH TRENDS
  // ============================================
  const [
    currentTotalProducts,
    previousTotalProducts,
    currentInStock,
    previousInStock,
    currentOutOfStock,
    previousOutOfStock
  ] = await Promise.all([
    Product.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    Product.countDocuments({ 
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } 
    }),
    Product.countDocuments({ 
      stock: { $gt: 0 },
      createdAt: { $gte: currentPeriodStart }
    }),
    Product.countDocuments({ 
      stock: { $gt: 0 },
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    }),
    Product.countDocuments({ 
      stock: { $lte: 0 },
      createdAt: { $gte: currentPeriodStart }
    }),
    Product.countDocuments({ 
      stock: { $lte: 0 },
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    })
  ]);

  // ============================================
  // ORDERS & REVENUE WITH TRENDS
  // ============================================
  const [currentOrders, previousOrders] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart } } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $ne: ["$orderStatus", ORDER_STATUSES.CANCELLED] },
                "$totalPrice",
                0
              ]
            }
          }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $ne: ["$orderStatus", ORDER_STATUSES.CANCELLED] },
                "$totalPrice",
                0
              ]
            }
          }
        }
      }
    ])
  ]);

  // ============================================
  // ORDER STATUS BREAKDOWN WITH TRENDS
  // ============================================
  const [currentOrderStatus, previousOrderStatus] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart } } },
      {
        $group: {
          _id: "$orderStatus",
          count: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
        }
      },
      {
        $group: {
          _id: "$orderStatus",
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  // Extract order status counts
  const getCurrentStatusCount = (status) =>
    currentOrderStatus.find(o => o._id === status)?.count || 0;
  const getPreviousStatusCount = (status) =>
    previousOrderStatus.find(o => o._id === status)?.count || 0;

  const currentShipped = getCurrentStatusCount(ORDER_STATUSES.SHIPPED);
  const previousShipped = getPreviousStatusCount(ORDER_STATUSES.SHIPPED);

  const currentProcessing = getCurrentStatusCount(ORDER_STATUSES.PROCESSING);
  const previousProcessing = getPreviousStatusCount(ORDER_STATUSES.PROCESSING);

  const currentCancelled = getCurrentStatusCount(ORDER_STATUSES.CANCELLED);
  const previousCancelled = getPreviousStatusCount(ORDER_STATUSES.CANCELLED);

  const currentDelivered = getCurrentStatusCount(ORDER_STATUSES.DELIVERED);
  const previousDelivered = getPreviousStatusCount(ORDER_STATUSES.DELIVERED);

  // ============================================
  // USERS/CUSTOMERS WITH TRENDS
  // ============================================
  const [currentUsers, previousUsers, currentAdmins, previousAdmins] = await Promise.all([
    User.countDocuments({ 
      createdAt: { $gte: currentPeriodStart }
    }),
    User.countDocuments({ 
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    }),
    User.countDocuments({ 
      role: "admin",
      createdAt: { $gte: currentPeriodStart }
    }),
    User.countDocuments({ 
      role: "admin",
      createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    })
  ]);

  // ============================================
  // CALCULATE ALL TRENDS
  // ============================================
  const currentRevenue = currentOrders[0]?.revenue || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;
  const currentTotalOrders = currentOrders[0]?.totalOrders || 0;
  const previousTotalOrders = previousOrders[0]?.totalOrders || 0;

  // ============================================
  // BUILD RESPONSE WITH TRENDS
  // ============================================
  const response = {
    // Revenue
    revenue: {
      current: Number(currentRevenue.toFixed(2)),
      previous: Number(previousRevenue.toFixed(2)),
      change: calculateTrend(currentRevenue, previousRevenue)
    },

    // Total Orders
    orders: {
      current: currentTotalOrders,
      previous: previousTotalOrders,
      change: calculateTrend(currentTotalOrders, previousTotalOrders)
    },

    // Order Status - Shipped
    shipped: {
      current: currentShipped,
      previous: previousShipped,
      change: calculateTrend(currentShipped, previousShipped)
    },

    // Order Status - Processing
    processing: {
      current: currentProcessing,
      previous: previousProcessing,
      change: calculateTrend(currentProcessing, previousProcessing)
    },

    // Order Status - Cancelled
    cancelled: {
      current: currentCancelled,
      previous: previousCancelled,
      change: calculateTrend(currentCancelled, previousCancelled)
    },

    // Order Status - Delivered
    delivered: {
      current: currentDelivered,
      previous: previousDelivered,
      change: calculateTrend(currentDelivered, previousDelivered)
    },

    // Customers/Users
    customers: {
      current: currentUsers,
      previous: previousUsers,
      change: calculateTrend(currentUsers, previousUsers)
    },

    // Products
    products: {
      current: currentTotalProducts,
      previous: previousTotalProducts,
      change: calculateTrend(currentTotalProducts, previousTotalProducts)
    },

    // In Stock
    inStock: {
      current: currentInStock,
      previous: previousInStock,
      change: calculateTrend(currentInStock, previousInStock)
    },

    // Out of Stock
    outOfStock: {
      current: currentOutOfStock,
      previous: previousOutOfStock,
      change: calculateTrend(currentOutOfStock, previousOutOfStock)
    },

    // Admin Count
    adminCount: {
      current: currentAdmins,
      previous: previousAdmins,
      change: calculateTrend(currentAdmins, previousAdmins)
    },

    // Metadata
    timeframe,
    periodStart: currentPeriodStart.toISOString(),
    periodEnd: new Date().toISOString()
  };

  await setCache(cacheKey, response, 300); // Cache for 5 minutes

  res.status(200).json({ success: true, ...response });
});

// ============================================
// TOP PRODUCTS WITH PAGINATION
// ============================================

/**
 * Get top products by revenue
 * @param {number} limit - Number of products to return
 * @param {number} skip - Number of products to skip
 * @returns {Promise<Array>} Top products
 */
export const getTopProducts = async (limit = 5, skip = 0) => {
  return await Order.aggregate([
    { $match: { orderStatus: { $ne: ORDER_STATUSES.CANCELLED } } },
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $exists: true } } },
    {
      $group: {
        _id: "$orderItems.product",
        name: { $first: "$orderItems.name" },
        revenue: { 
          $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } 
        },
        quantity: { $sum: "$orderItems.quantity" }
      }
    },
    { $sort: { revenue: -1 } },
    { $skip: skip },
    { $limit: limit },
    { 
      $project: { 
        _id: 0, 
        productId: "$_id",
        name: 1, 
        revenue: 1, 
        quantity: 1 
      } 
    }
  ]);
};

/**
 * Get top products endpoint with pagination
 * @route GET /api/v1/admin/top-products
 * @query {number} limit - Products per page (default: 10)
 * @query {number} page - Page number (default: 1)
 * @access Admin
 */
export const getTopProductsEndpoint = handleAsyncError(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  const cacheKey = `top_products_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const topProducts = await getTopProducts(limit, skip);

  // Get total count for pagination
  const totalCount = await Order.aggregate([
    { $match: { orderStatus: { $ne: ORDER_STATUSES.CANCELLED } } },
    { $unwind: "$orderItems" },
    { $group: { _id: "$orderItems.product" } },
    { $count: "total" }
  ]);

  const total = totalCount[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const response = {
    topProducts,
    pagination: {
      currentPage: page,
      totalPages,
      totalProducts: total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

export default {
  getAdminStats,
  getTopProducts,
  getTopProductsEndpoint
};