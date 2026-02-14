import handleAsyncError from "../middleware/handleAsyncError.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import { getDateRanges } from "../utils/dateRanges.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import { getCache, setCache } from "../utils/redis.js";
import {
  buildOrderStatusBreakdown,
  buildInventoryStatusBreakdown,
  getTopProductsPaginated
} from "../utils/analyticsHelpers.js";

// ============================================
// BASIC ADMIN STATS
// ============================================

export const getAdminStats = handleAsyncError(async (req, res) => {
  const cacheKey = "admin_stats_v5";

  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const [productCount, orderCount, userCount, adminCount] = await Promise.all([
    Product.countDocuments({ status: "published" }),
    Order.countDocuments(),
    User.countDocuments(),
    User.countDocuments({ role: "admin" })
  ]);

  // FIX A1: Added paymentInfo.status: 'success' to revenue filter.
  // Without it, failed/pending payments were counted as revenue.
  const revenueAgg = await Order.aggregate([
    {
      $match: {
        orderStatus: { $ne: "Cancelled" },
        "paymentInfo.status": "success"
      }
    },
    { $group: { _id: null, total: { $sum: "$totalPrice" } } }
  ]);
  const totalRevenue = revenueAgg[0]?.total || 0;

  // FIX A2: Replaced copy-pasted switch/case with shared helper.
  const orderStatusAgg = await Order.aggregate([
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
  ]);
  const ordersByStatus = buildOrderStatusBreakdown(orderStatusAgg);

  // FIX A3: Replaced copy-pasted switch/case with shared helper.
  const inventoryAgg = await Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);
  const inventoryByStatus = buildInventoryStatusBreakdown(inventoryAgg);

  const totalInventory =
    inventoryByStatus.inStock +
    inventoryByStatus.lowStock +
    inventoryByStatus.outOfStock +
    inventoryByStatus.discontinued;

  const response = {
    products: productCount,
    orders: orderCount,
    revenue: Number(totalRevenue.toFixed(2)),
    users: userCount,
    adminCount,
    ordersByStatus,
    inventory: { ...inventoryByStatus, total: totalInventory }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ADVANCED ANALYTICS (LEGACY)
// ============================================

export const getAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;

  if (!validateTimeframe(timeframe, next)) return;

  const cacheKey = `analytics_${timeframe}_v5`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  // FIX A1 (repeated): Both periods now filter for payment success.
  const [currentOrders, previousOrders] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: currentPeriodStart },
          "paymentInfo.status": "success"
        }
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: {
            $sum: { $cond: [{ $ne: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0] }
          }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          "paymentInfo.status": "success"
        }
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: {
            $sum: { $cond: [{ $ne: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0] }
          }
        }
      }
    ])
  ]);

  const [currentUsers, previousUsers, currentProducts, previousProducts] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    User.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } }),
    Product.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    Product.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } })
  ]);

  const currentRevenue = currentOrders[0]?.revenue || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;

  const trends = {
    revenue: calculateTrend(currentRevenue, previousRevenue),
    orders: calculateTrend(currentOrders[0]?.orders || 0, previousOrders[0]?.orders || 0),
    users: calculateTrend(currentUsers, previousUsers),
    products: calculateTrend(currentProducts, previousProducts)
  };

  // FIX A2: Replaced inline switch/case with shared helper.
  const orderStatusAgg = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
  ]);
  const orderStatusBreakdown = buildOrderStatusBreakdown(orderStatusAgg);

  // FIX A4: Replaced local getTopProducts with shared paginated helper.
  const topProducts = await getTopProductsPaginated(5, 0);
  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("user", "firstName lastName email");

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
// TOP PRODUCTS (endpoint wrapper)
// ============================================

// FIX A4: Removed local getTopProducts definition — now imported from analyticsHelpers.
// Export kept for any direct callers of the function (non-HTTP usage).
export { getTopProductsPaginated as getTopProducts } from "../utils/analyticsHelpers.js";

export const getTopProductsEndpoint = handleAsyncError(async (req, res) => {
  const rawLimit = parseInt(req.query.limit);
  const rawPage = parseInt(req.query.page);

  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 10;
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const skip = (page - 1) * limit;

  const cacheKey = `top_products_${limit}_${page}_v5`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const topProducts = await getTopProductsPaginated(limit, skip);

  const totalCount = await Order.aggregate([
    { $match: { orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $ne: null } } },
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
// INVENTORY STATISTICS
// ============================================

export const getInventoryStats = handleAsyncError(async (req, res) => {
  const cacheKey = "inventory_stats_v5";

  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  // FIX A3: Replaced copy-pasted switch/case with shared helper.
  const inventoryStatusAgg = await Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);
  const inventoryByStatus = buildInventoryStatusBreakdown(inventoryStatusAgg);

  const inventoryValue = await Product.aggregate([
    {
      $match: {
        status: "published",
        "inventory.trackInventory": true,
        "inventory.stock": { $gt: 0 }
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

  const lowStockProducts = await Product.find({
    status: "published",
    "inventory.status": "LowStock"
  })
    .select("name inventory.stock inventory.lowStockThreshold pricing.regular")
    .sort({ "inventory.stock": 1 })
    .limit(10);

  const response = {
    inventoryByStatus,
    totalInventoryValue: inventoryValue[0]?.totalValue || 0,
    totalUnits: inventoryValue[0]?.totalUnits || 0,
    lowStockProducts: lowStockProducts.map((p) => ({
      id: p._id,
      name: p.name,
      stock: p.inventory?.stock || 0,
      threshold: p.inventory?.lowStockThreshold || 5,
      price: p.pricing?.regular || 0
    })),
    alerts: {
      needsRestock: inventoryByStatus.lowStock + inventoryByStatus.outOfStock,
      outOfStockCount: inventoryByStatus.outOfStock,
      criticalCount: inventoryByStatus.outOfStock
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getAdminStats,
  getAnalytics,
  getTopProductsEndpoint,
  getInventoryStats
};