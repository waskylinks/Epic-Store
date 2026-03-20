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
// BUMP THIS ONE NUMBER TO BUST ALL CACHES
// ============================================
const CACHE_VERSION = 'v1';


// ============================================
// BASIC ADMIN STATS (MINIMAL - NO ORDER/INVENTORY BREAKDOWN)
// ============================================
export const getAdminStats = handleAsyncError(async (req, res) => {
  const cacheKey = `admin_stats_${CACHE_VERSION}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const [productCount, orderCount, userCount, adminCount, revenueAgg] = await Promise.all([
    Product.countDocuments({ status: "published" }),
    Order.estimatedDocumentCount(),
    User.countDocuments(),
    User.countDocuments({ role: "admin" }),
    Order.aggregate([
      { $match: { orderStatus: { $ne: "Cancelled" }, "paymentInfo.status": "success" } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } }
    ])
  ]);

  const response = {
    products:   productCount,
    orders:     orderCount,
    revenue:    Number((revenueAgg[0]?.total || 0).toFixed(2)),
    users:      userCount,
    adminCount,
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ORDER STATUS BREAKDOWN
// Accepts an optional ?timeframe=day|week|month|year query param.
// When timeframe is provided the counts are scoped to that date range
// and a previousPeriod breakdown + per-status trends are included,
// mirroring the pattern used by getDashboardKPIs.
// When no timeframe is supplied the behaviour is unchanged — all-time
// counts are returned (same as before).
// ============================================
export const getOrderStatusBreakdown = handleAsyncError(async (req, res, next) => {
  const { timeframe } = req.query;

  // ── All-time path (no timeframe) ────────────────────────────────────────
  if (!timeframe) {
    const cacheKey = `order_status_breakdown_${CACHE_VERSION}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.status(200).json({ success: true, ...cached });

    const orderStatusAgg = await Order.aggregate([
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
    ]);

    const breakdown = { processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
    orderStatusAgg.forEach(({ _id: status, count }) => {
      switch (status) {
        case "Processing": breakdown.processing = count; break;
        case "Shipped":    breakdown.shipped    = count; break;
        case "Delivered":  breakdown.delivered  = count; break;
        case "Cancelled":  breakdown.cancelled  = count; break;
      }
    });

    const response = { ordersByStatus: breakdown };
    await setCache(cacheKey, response, 300);
    return res.status(200).json({ success: true, ...response });
  }

  // ── Timeframe-scoped path ────────────────────────────────────────────────
  if (!validateTimeframe(timeframe, next)) return;

  const cacheKey = `order_status_breakdown_${timeframe}_${CACHE_VERSION}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } =
    getDateRanges(timeframe);

  // Run both period aggregations in parallel via $facet in a single round-trip
  const [facetResult] = await Order.aggregate([
    {
      $facet: {
        current: [
          { $match: { createdAt: { $gte: currentPeriodStart } } },
          { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
        ],
        previous: [
          {
            $match: {
              createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
            }
          },
          { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
        ],
        // Total order count for the current period (used for percentages)
        currentTotal: [
          { $match: { createdAt: { $gte: currentPeriodStart } } },
          { $group: { _id: null, total: { $sum: 1 } } }
        ],
        previousTotal: [
          {
            $match: {
              createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
            }
          },
          { $group: { _id: null, total: { $sum: 1 } } }
        ]
      }
    }
  ]);

  // ── Build breakdown objects from aggregation arrays ──────────────────────
  const STATUSES = ["Processing", "Shipped", "Delivered", "Cancelled"];
  const KEY_MAP  = {
    Processing: "processing",
    Shipped:    "shipped",
    Delivered:  "delivered",
    Cancelled:  "cancelled"
  };

  const toBreakdown = (agg) => {
    const obj = { processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
    agg.forEach(({ _id: status, count }) => {
      const key = KEY_MAP[status];
      if (key) obj[key] = count;
    });
    return obj;
  };

  const current  = toBreakdown(facetResult.current);
  const previous = toBreakdown(facetResult.previous);

  const currentTotal  = facetResult.currentTotal[0]?.total  || 0;
  const previousTotal = facetResult.previousTotal[0]?.total || 0;

  // ── Per-status trends and share percentages ──────────────────────────────
  const trends = {};
  const share  = {};
  STATUSES.forEach((status) => {
    const key      = KEY_MAP[status];
    trends[key]    = calculateTrend(current[key], previous[key]);
    share[key]     = currentTotal > 0
      ? Math.round((current[key] / currentTotal) * 100 * 10) / 10
      : 0;
  });

  const response = {
    timeframe,
    ordersByStatus: current,
    previousPeriod: {
      ordersByStatus: previous,
      total:          previousTotal
    },
    currentTotal,
    trends,
    share
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// INVENTORY STATUS BREAKDOWN
// ============================================
export const getInventoryStatusBreakdown = handleAsyncError(async (req, res) => {
  const cacheKey = `inventory_status_breakdown_${CACHE_VERSION}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const inventoryAgg = await Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);

  const breakdown = { inStock: 0, lowStock: 0, outOfStock: 0, discontinued: 0 };
  inventoryAgg.forEach(item => {
    const status = item._id;
    const count = item.count;
    switch (status) {
      case "InStock":      breakdown.inStock      = count; break;
      case "LowStock":     breakdown.lowStock     = count; break;
      case "OutOfStock":   breakdown.outOfStock   = count; break;
      case "Discontinued": breakdown.discontinued = count; break;
    }
  });

  const totalInventory = breakdown.inStock + breakdown.lowStock + breakdown.outOfStock + breakdown.discontinued;
  const response = { inventory: { ...breakdown, total: totalInventory } };
  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ADVANCED ANALYTICS
// ============================================
export const getAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;

  if (!validateTimeframe(timeframe, next)) return;

  const cacheKey = `analytics_${timeframe}_${CACHE_VERSION}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [currentOrders, previousOrders] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart }, "paymentInfo.status": "success" } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $ne: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0] } } } }
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }, "paymentInfo.status": "success" } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $ne: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0] } } } }
    ])
  ]);

  const [currentUsers, previousUsers, currentProducts, previousProducts] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    User.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } }),
    Product.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    Product.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } })
  ]);

  const currentRevenue  = currentOrders[0]?.revenue  || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;

  const trends = {
    revenue:  calculateTrend(currentRevenue, previousRevenue),
    orders:   calculateTrend(currentOrders[0]?.orders  || 0, previousOrders[0]?.orders || 0),
    users:    calculateTrend(currentUsers,   previousUsers),
    products: calculateTrend(currentProducts, previousProducts)
  };

  const orderStatusAgg = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
  ]);

  const orderStatusBreakdown = buildOrderStatusBreakdown(orderStatusAgg);

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
      orders:   currentOrders[0]?.orders  || 0,
      revenue:  Number(currentRevenue.toFixed(2)),
      users:    currentUsers,
      products: currentProducts
    },
    previousPeriod: {
      orders:   previousOrders[0]?.orders  || 0,
      revenue:  Number(previousRevenue.toFixed(2)),
      users:    previousUsers,
      products: previousProducts
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// TOP PRODUCTS ENDPOINT
// ============================================
export { getTopProductsPaginated as getTopProducts };

export const getTopProductsEndpoint = handleAsyncError(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
  const page  = Math.max(parseInt(req.query.page) || 1, 1);
  const skip  = (page - 1) * limit;

  const cacheKey = `top_products_${limit}_${page}_${CACHE_VERSION}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const topProducts = await getTopProductsPaginated(limit, skip);

  const totalCount = await Order.aggregate([
    { $match: { orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $ne: null } } },
    { $group: { _id: "$orderItems.product" } },
    { $count: "total" }
  ]);

  const total      = totalCount[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const response = {
    topProducts,
    pagination: {
      currentPage:   page,
      totalPages,
      totalProducts: total,
      hasNextPage:   page < totalPages,
      hasPrevPage:   page > 1
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// INVENTORY STATISTICS
// ============================================
export const getInventoryStats = handleAsyncError(async (req, res) => {
  const cacheKey = `inventory_stats_${CACHE_VERSION}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const inventoryStatusAgg = await Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);

  const inventoryByStatus = buildInventoryStatusBreakdown(inventoryStatusAgg);

  const inventoryValue = await Product.aggregate([
    { $match: { status: "published", "inventory.trackInventory": true, "inventory.stock": { $gt: 0 } } },
    { $group: { _id: null, totalValue: { $sum: { $multiply: ["$inventory.stock", { $ifNull: ["$pricing.cost", "$pricing.regular"] }] } }, totalUnits: { $sum: "$inventory.stock" } } }
  ]);

  const lowStockProducts = await Product.find({ status: "published", "inventory.status": "LowStock" })
    .select("name inventory.stock inventory.lowStockThreshold pricing.regular")
    .sort({ "inventory.stock": 1 })
    .limit(10);

  const response = {
    inventoryByStatus,
    totalInventoryValue: inventoryValue[0]?.totalValue || 0,
    totalUnits:          inventoryValue[0]?.totalUnits || 0,
    lowStockProducts: lowStockProducts.map(p => ({
      id:        p._id,
      name:      p.name,
      stock:     p.inventory?.stock || 0,
      threshold: p.inventory?.lowStockThreshold || 5,
      price:     p.pricing?.regular || 0
    })),
    alerts: {
      needsRestock:    inventoryByStatus.lowStock + inventoryByStatus.outOfStock,
      outOfStockCount: inventoryByStatus.outOfStock,
      criticalCount:   inventoryByStatus.outOfStock
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getAdminStats,
  getOrderStatusBreakdown,
  getInventoryStatusBreakdown,
  getAnalytics,
  getTopProductsEndpoint,
  getInventoryStats
};