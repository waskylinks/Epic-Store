import handleAsyncError from "../middleware/handleAsyncError.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { getAdminStatsService } from "../Services/analytics-service.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import { getCache, setCache } from "../utils/redis.js";

/**
 * Admin Stats Controller
 * Handles basic admin statistics and top products endpoints
 * For comprehensive analytics, use the analytics-dashboard-controller
 */

// ============================================
// BASIC ADMIN STATS
// ============================================

/**
 * Get basic admin statistics (simplified)
 * @route GET /api/v1/admin/stats
 * @access Admin
 */
export const getAdminStats = handleAsyncError(async (req, res) => {
  const cacheKey = "admin_stats";

  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const stats = await getAdminStatsService();

  // Get order status counts
  const orderStatusAgg = await Order.aggregate([
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 }
      }
    }
  ]);

  const ordersByStatus = {
    processing: orderStatusAgg.find(o => o._id === "Processing")?.count || 0,
    shipped: orderStatusAgg.find(o => o._id === "Shipped")?.count || 0,
    delivered: orderStatusAgg.find(o => o._id === "Delivered")?.count || 0,
    cancelled: orderStatusAgg.find(o => o._id === "Cancelled")?.count || 0
  };

  // Get inventory status counts using the calculated inventory.status field
  const inventoryStatusAgg = await Product.aggregate([
    {
      $match: { status: 'published' }
    },
    {
      $group: {
        _id: "$inventory.status",
        count: { $sum: 1 }
      }
    }
  ]);

  const inventoryByStatus = {
    inStock: inventoryStatusAgg.find(i => i._id === "InStock")?.count || 0,
    lowStock: inventoryStatusAgg.find(i => i._id === "LowStock")?.count || 0,
    outOfStock: inventoryStatusAgg.find(i => i._id === "OutOfStock")?.count || 0,
    discontinued: inventoryStatusAgg.find(i => i._id === "Discontinued")?.count || 0
  };

  const response = {
    products: stats.products.products || 0,
    orders: stats.orders.orders || 0,
    revenue: Number((stats.orders.revenue || 0).toFixed(2)),
    users: stats.users.users || 0,
    adminCount: stats.users.adminCount || 0,
    ordersByStatus,
    inventory: {
      inStock: inventoryByStatus.inStock,
      lowStock: inventoryByStatus.lowStock,
      outOfStock: inventoryByStatus.outOfStock,
      discontinued: inventoryByStatus.discontinued,
      total: inventoryByStatus.inStock + inventoryByStatus.lowStock + inventoryByStatus.outOfStock + inventoryByStatus.discontinued
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

// ============================================
// ADVANCED ANALYTICS (LEGACY)
// ============================================

/**
 * Get analytics with trends (legacy endpoint)
 * @route GET /api/v1/admin/analytics
 * @access Admin
 * @deprecated Use /api/v1/analytics/dashboard instead for comprehensive analytics
 */
export const getAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } =
    getDateRanges(timeframe);

  const [currentOrders, previousOrders] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $ne: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0]
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
          orders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $ne: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0]
            }
          }
        }
      }
    ])
  ]);

  const currentUsers = await User.countDocuments({ createdAt: { $gte: currentPeriodStart } });
  const previousUsers = await User.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } });

  const currentProducts = await Product.countDocuments({ createdAt: { $gte: currentPeriodStart } });
  const previousProducts = await Product.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } });

  const currentRevenue = currentOrders[0]?.revenue || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;

  const trends = {
    revenue: calculateTrend(currentRevenue, previousRevenue),
    orders: calculateTrend(currentOrders[0]?.orders || 0, previousOrders[0]?.orders || 0),
    users: calculateTrend(currentUsers, previousUsers),
    products: calculateTrend(currentProducts, previousProducts)
  };

  const orderStatusAgg = await Order.aggregate([
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 }
      }
    }
  ]);

  const orderStatusBreakdown = {
    processing: orderStatusAgg.find(o => o._id === "Processing")?.count || 0,
    shipped: orderStatusAgg.find(o => o._id === "Shipped")?.count || 0,
    delivered: orderStatusAgg.find(o => o._id === "Delivered")?.count || 0,
    cancelled: orderStatusAgg.find(o => o._id === "Cancelled")?.count || 0
  };

  const topProducts = await getTopProducts(5, 0);

  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("user", "name email");

  const response = {
    trends,
    orderStatusBreakdown,
    topProducts,
    recentOrders,
    currentPeriod: {
      orders: currentOrders[0]?.orders || 0,
      revenue: Number(currentRevenue.toFixed(2)),
      users: currentUsers,
      products: currentProducts
    },
    previousPeriod: {
      orders: previousOrders[0]?.orders || 0,
      revenue: Number(previousRevenue.toFixed(2)),
      users: previousUsers,
      products: previousProducts
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

// ============================================
// TOP PRODUCTS (REUSABLE WITH PAGINATION)
// ============================================

/**
 * Get top products by revenue
 * @param {number} limit - Number of products to return
 * @param {number} skip - Number of products to skip
 * @returns {Promise<Array>} Top products
 */
export const getTopProducts = async (limit = 5, skip = 0) => {
  return await Order.aggregate([
    { $match: { orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $exists: true } } },
    {
      $group: {
        _id: "$orderItems.product",
        name: { $first: "$orderItems.name" },
        revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
        quantity: { $sum: "$orderItems.quantity" }
      }
    },
    { $sort: { revenue: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _id: 0, name: 1, revenue: 1, quantity: 1 } }
  ]);
};

// ============================================
// STANDALONE TOP PRODUCTS ENDPOINT
// ============================================

/**
 * Get top products endpoint with pagination
 * @route GET /api/v1/admin/top-products
 * @access Admin
 */
export const getTopProductsEndpoint = handleAsyncError(async (req, res, next) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  const cacheKey = `top_products_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const topProducts = await getTopProducts(limit, skip);

  const totalCount = await Order.aggregate([
    { $match: { orderStatus: { $ne: "Cancelled" } } },
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

// ============================================
// DETAILED INVENTORY STATISTICS
// ============================================

/**
 * Get detailed inventory statistics
 * @route GET /api/v1/admin/inventory-stats
 * @access Admin
 */
export const getInventoryStats = handleAsyncError(async (req, res) => {
  const cacheKey = "inventory_stats";

  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  // Aggregate inventory status counts using the calculated status field
  const inventoryStatusAgg = await Product.aggregate([
    {
      $match: { status: 'published' }
    },
    {
      $group: {
        _id: "$inventory.status",
        count: { $sum: 1 }
      }
    }
  ]);

  const inventoryByStatus = {
    inStock: inventoryStatusAgg.find(i => i._id === "InStock")?.count || 0,
    lowStock: inventoryStatusAgg.find(i => i._id === "LowStock")?.count || 0,
    outOfStock: inventoryStatusAgg.find(i => i._id === "OutOfStock")?.count || 0,
    discontinued: inventoryStatusAgg.find(i => i._id === "Discontinued")?.count || 0
  };

  // Get total inventory value
  const inventoryValue = await Product.aggregate([
    {
      $match: { 
        status: 'published',
        'inventory.stock': { $gt: 0 }
      }
    },
    {
      $group: {
        _id: null,
        totalValue: {
          $sum: {
            $multiply: [
              "$inventory.stock",
              { $ifNull: ["$pricing.cost", "$pricing.regular"] }
            ]
          }
        },
        totalUnits: { $sum: "$inventory.stock" }
      }
    }
  ]);

  // Get low stock products
  const lowStockProducts = await Product.find({
    status: 'published',
    'inventory.status': 'LowStock'
  })
    .select('name inventory.stock inventory.lowStockThreshold pricing.regular')
    .sort({ 'inventory.stock': 1 })
    .limit(10);

  const response = {
    inventoryByStatus,
    totalInventoryValue: inventoryValue[0]?.totalValue || 0,
    totalUnits: inventoryValue[0]?.totalUnits || 0,
    lowStockProducts: lowStockProducts.map(p => ({
      id: p._id,
      name: p.name,
      stock: p.inventory?.stock || 0,
      threshold: p.inventory?.lowStockThreshold || 5,
      price: p.pricing?.regular || 0
    })),
    alerts: {
      needsRestock: inventoryByStatus.lowStock + inventoryByStatus.outOfStock,
      outOfStockCount: inventoryByStatus.outOfStock,
      criticalCount: inventoryByStatus.outOfStock // Items completely out
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

export default {
  getAdminStats,
  getAnalytics,
  getTopProducts,
  getTopProductsEndpoint,
  getInventoryStats
};