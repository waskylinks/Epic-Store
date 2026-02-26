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
  console.log(`[getAdminStats] Checking cache with key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[getAdminStats] Cache HIT — returning cached data:`, cached);
    return res.status(200).json({ success: true, ...cached });
  }
  console.log(`[getAdminStats] Cache MISS — querying DB...`);

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

  console.log(`[getAdminStats] DB results:`);
  console.log(`  → Published products:`, productCount);
  console.log(`  → Total orders (estimated):`, orderCount);
  console.log(`  → Total users:`, userCount);
  console.log(`  → Admin users:`, adminCount);
  console.log(`  → Revenue aggregation raw:`, revenueAgg);

  const response = {
    products:   productCount,
    orders:     orderCount,
    revenue:    Number((revenueAgg[0]?.total || 0).toFixed(2)),
    users:      userCount,
    adminCount,
  };

  console.log(`[getAdminStats] Final response to cache & send:`, response);
  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ORDER STATUS BREAKDOWN
// ============================================
export const getOrderStatusBreakdown = handleAsyncError(async (req, res) => {
  const cacheKey = `order_status_breakdown_${CACHE_VERSION}`;
  console.log(`[getOrderStatusBreakdown] Checking cache with key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[getOrderStatusBreakdown] Cache HIT — returning cached data:`, cached);
    return res.status(200).json({ success: true, ...cached });
  }
  console.log(`[getOrderStatusBreakdown] Cache MISS — querying DB...`);

  const orderStatusAgg = await Order.aggregate([
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
  ]);
  console.log(`[getOrderStatusBreakdown] Raw aggregation result:`, orderStatusAgg);

  const breakdown = {
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0
  };

  orderStatusAgg.forEach(item => {
    const status = item._id;
    const count = item.count;

    switch (status) {
      case "Processing": breakdown.processing = count; break;
      case "Shipped":    breakdown.shipped    = count; break;
      case "Delivered":  breakdown.delivered  = count; break;
      case "Cancelled":  breakdown.cancelled  = count; break;
    }
  });

  console.log(`[getOrderStatusBreakdown] Mapped breakdown:`, breakdown);

  const response = { ordersByStatus: breakdown };
  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// INVENTORY STATUS BREAKDOWN
// ============================================
export const getInventoryStatusBreakdown = handleAsyncError(async (req, res) => {
  const cacheKey = `inventory_status_breakdown_${CACHE_VERSION}`;
  console.log(`[getInventoryStatusBreakdown] Checking cache with key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[getInventoryStatusBreakdown] Cache HIT — returning cached data:`, cached);
    return res.status(200).json({ success: true, ...cached });
  }
  console.log(`[getInventoryStatusBreakdown] Cache MISS — querying DB...`);

  const inventoryAgg = await Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);
  console.log(`[getInventoryStatusBreakdown] Raw aggregation result:`, inventoryAgg);

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
  console.log(`[getInventoryStatusBreakdown] Mapped breakdown:`, breakdown);
  console.log(`[getInventoryStatusBreakdown] Total inventory count:`, totalInventory);

  const response = { inventory: { ...breakdown, total: totalInventory } };
  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ADVANCED ANALYTICS
// ============================================
export const getAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  console.log(`[getAnalytics] Called with timeframe: "${timeframe}"`);

  if (!validateTimeframe(timeframe, next)) return;

  const cacheKey = `analytics_${timeframe}_${CACHE_VERSION}`;
  console.log(`[getAnalytics] Checking cache with key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[getAnalytics] Cache HIT — returning cached data:`, cached);
    return res.status(200).json({ success: true, ...cached });
  }
  console.log(`[getAnalytics] Cache MISS — querying DB...`);

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);
  console.log(`[getAnalytics] Date ranges:`);
  console.log(`  → currentPeriodStart:`, currentPeriodStart);
  console.log(`  → previousPeriodStart:`, previousPeriodStart);
  console.log(`  → previousPeriodEnd:`, previousPeriodEnd);

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
  console.log(`[getAnalytics] Current period orders raw:`, currentOrders);
  console.log(`[getAnalytics] Previous period orders raw:`, previousOrders);

  const [currentUsers, previousUsers, currentProducts, previousProducts] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    User.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } }),
    Product.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    Product.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } })
  ]);
  console.log(`[getAnalytics] Current period users:`, currentUsers, `| Previous:`, previousUsers);
  console.log(`[getAnalytics] Current period products:`, currentProducts, `| Previous:`, previousProducts);

  const currentRevenue = currentOrders[0]?.revenue || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;
  console.log(`[getAnalytics] Current revenue:`, currentRevenue, `| Previous revenue:`, previousRevenue);

  const trends = {
    revenue:  calculateTrend(currentRevenue, previousRevenue),
    orders:   calculateTrend(currentOrders[0]?.orders || 0, previousOrders[0]?.orders || 0),
    users:    calculateTrend(currentUsers, previousUsers),
    products: calculateTrend(currentProducts, previousProducts)
  };
  console.log(`[getAnalytics] Calculated trends:`, trends);

  const orderStatusAgg = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
  ]);
  console.log(`[getAnalytics] Order status aggregation (current period):`, orderStatusAgg);

  const orderStatusBreakdown = buildOrderStatusBreakdown(orderStatusAgg);
  console.log(`[getAnalytics] Built order status breakdown:`, orderStatusBreakdown);

  const topProducts = await getTopProductsPaginated(5, 0);
  console.log(`[getAnalytics] Top 5 products fetched:`, topProducts);

  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("user", "firstName lastName email");
  console.log(`[getAnalytics] Recent 5 orders fetched:`, recentOrders.map(o => ({
    id: o._id,
    status: o.orderStatus,
    total: o.totalPrice,
    user: o.user,
    createdAt: o.createdAt
  })));

  const response = {
    trends,
    orderStatusBreakdown,
    topProducts,
    recentOrders,
    currentPeriod: {
      orders:   currentOrders[0]?.orders || 0,
      revenue:  Number(currentRevenue.toFixed(2)),
      users:    currentUsers,
      products: currentProducts
    },
    previousPeriod: {
      orders:   previousOrders[0]?.orders || 0,
      revenue:  Number(previousRevenue.toFixed(2)),
      users:    previousUsers,
      products: previousProducts
    }
  };

  console.log(`[getAnalytics] Final response summary:`, {
    currentPeriod:        response.currentPeriod,
    previousPeriod:       response.previousPeriod,
    trends:               response.trends,
    orderStatusBreakdown: response.orderStatusBreakdown,
    topProductsCount:     response.topProducts?.length,
    recentOrdersCount:    response.recentOrders?.length
  });

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

  console.log(`[getTopProductsEndpoint] Called with — limit: ${limit}, page: ${page}, skip: ${skip}`);

  const cacheKey = `top_products_${limit}_${page}_${CACHE_VERSION}`;
  console.log(`[getTopProductsEndpoint] Checking cache with key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[getTopProductsEndpoint] Cache HIT — returning cached data:`, cached);
    return res.status(200).json({ success: true, ...cached });
  }
  console.log(`[getTopProductsEndpoint] Cache MISS — querying DB...`);

  const topProducts = await getTopProductsPaginated(limit, skip);
  console.log(`[getTopProductsEndpoint] Fetched ${topProducts?.length} top products:`, topProducts);

  const totalCount = await Order.aggregate([
    { $match: { orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $ne: null } } },
    { $group: { _id: "$orderItems.product" } },
    { $count: "total" }
  ]);
  console.log(`[getTopProductsEndpoint] Total unique products in orders (raw):`, totalCount);

  const total      = totalCount[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);
  console.log(`[getTopProductsEndpoint] Pagination — total: ${total}, totalPages: ${totalPages}`);

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

  console.log(`[getTopProductsEndpoint] Final pagination:`, response.pagination);
  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// INVENTORY STATISTICS
// ============================================
export const getInventoryStats = handleAsyncError(async (req, res) => {
  const cacheKey = `inventory_stats_${CACHE_VERSION}`;
  console.log(`[getInventoryStats] Checking cache with key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[getInventoryStats] Cache HIT — returning cached data:`, cached);
    return res.status(200).json({ success: true, ...cached });
  }
  console.log(`[getInventoryStats] Cache MISS — querying DB...`);

  const inventoryStatusAgg = await Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);
  console.log(`[getInventoryStats] Raw inventory status aggregation:`, inventoryStatusAgg);

  const inventoryByStatus = buildInventoryStatusBreakdown(inventoryStatusAgg);
  console.log(`[getInventoryStats] Mapped inventory by status:`, inventoryByStatus);

  const inventoryValue = await Product.aggregate([
    { $match: { status: "published", "inventory.trackInventory": true, "inventory.stock": { $gt: 0 } } },
    { $group: { _id: null, totalValue: { $sum: { $multiply: ["$inventory.stock", { $ifNull: ["$pricing.cost", "$pricing.regular"] }] } }, totalUnits: { $sum: "$inventory.stock" } } }
  ]);
  console.log(`[getInventoryStats] Inventory value aggregation raw:`, inventoryValue);
  console.log(`[getInventoryStats]  → Total value:`, inventoryValue[0]?.totalValue || 0);
  console.log(`[getInventoryStats]  → Total units:`, inventoryValue[0]?.totalUnits || 0);

  const lowStockProducts = await Product.find({ status: "published", "inventory.status": "LowStock" })
    .select("name inventory.stock inventory.lowStockThreshold pricing.regular")
    .sort({ "inventory.stock": 1 })
    .limit(10);
  console.log(`[getInventoryStats] Low stock products fetched (${lowStockProducts.length}):`, lowStockProducts.map(p => ({
    name:      p.name,
    stock:     p.inventory?.stock,
    threshold: p.inventory?.lowStockThreshold,
    price:     p.pricing?.regular
  })));

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
      needsRestock:   inventoryByStatus.lowStock + inventoryByStatus.outOfStock,
      outOfStockCount: inventoryByStatus.outOfStock,
      criticalCount:   inventoryByStatus.outOfStock
    }
  };

  console.log(`[getInventoryStats] Alerts:`, response.alerts);
  console.log(`[getInventoryStats] Final response ready to cache & send.`);
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