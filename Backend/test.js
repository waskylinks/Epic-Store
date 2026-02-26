import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { connectDB } from './Database/database.js';
import { initializeRedis, shutdownRedis, getCache, setCache } from './utils/redis.js';
import Order from './models/order-model.js';
import Product from './models/product-model.js';
import User from './models/userModel.js';
import { calculateTrend } from './utils/calculateTrend.js';
import { getDateRanges } from './utils/dateRanges.js';
import {
  buildOrderStatusBreakdown,
  buildInventoryStatusBreakdown,
  getTopProductsPaginated
} from './utils/analyticsHelpers.js';

const CACHE_VERSION = 'v10';

// ─────────────────────────────────────────────
// HELPER: section header
// ─────────────────────────────────────────────
const section = (title) => {
  console.log('\n' + '='.repeat(55));
  console.log(`  🔍 ${title}`);
  console.log('='.repeat(55));
};

// ─────────────────────────────────────────────
// 1. getAdminStats
// ─────────────────────────────────────────────
async function testGetAdminStats() {
  section('getAdminStats');

  const cacheKey = `admin_stats_${CACHE_VERSION}`;
  console.log(`[getAdminStats] Cache key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log('[getAdminStats] Cache HIT:', cached);
    return;
  }
  console.log('[getAdminStats] Cache MISS — querying DB...');

  const [productCount, orderCount, userCount, adminCount, revenueAgg] = await Promise.all([
    Product.countDocuments({ status: 'published' }),
    Order.estimatedDocumentCount(),
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    Order.aggregate([
      { $match: { orderStatus: { $ne: 'Cancelled' }, 'paymentInfo.status': 'success' } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ])
  ]);

  console.log('[getAdminStats] Published products:', productCount);
  console.log('[getAdminStats] Total orders (estimated):', orderCount);
  console.log('[getAdminStats] Total users:', userCount);
  console.log('[getAdminStats] Admin users:', adminCount);
  console.log('[getAdminStats] Revenue aggregation raw:', revenueAgg);

  const response = {
    products: productCount,
    orders: orderCount,
    revenue: Number((revenueAgg[0]?.total || 0).toFixed(2)),
    users: userCount,
    adminCount
  };

  console.log('[getAdminStats] ✅ Final result:', response);
  await setCache(cacheKey, response, 300);
}

// ─────────────────────────────────────────────
// 2. getOrderStatusBreakdown
// ─────────────────────────────────────────────
async function testGetOrderStatusBreakdown() {
  section('getOrderStatusBreakdown');

  const cacheKey = 'order_status_breakdown_v7';
  console.log(`[getOrderStatusBreakdown] Cache key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log('[getOrderStatusBreakdown] Cache HIT:', cached);
    return;
  }
  console.log('[getOrderStatusBreakdown] Cache MISS — querying DB...');

  const orderStatusAgg = await Order.aggregate([
    { $group: { _id: '$orderStatus', count: { $sum: 1 } } }
  ]);
  console.log('[getOrderStatusBreakdown] Raw aggregation:', orderStatusAgg);

  const breakdown = { processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
  orderStatusAgg.forEach(item => {
    switch (item._id) {
      case 'Processing': breakdown.processing = item.count; break;
      case 'Shipped':    breakdown.shipped    = item.count; break;
      case 'Delivered':  breakdown.delivered  = item.count; break;
      case 'Cancelled':  breakdown.cancelled  = item.count; break;
    }
  });

  console.log('[getOrderStatusBreakdown] ✅ Mapped breakdown:', breakdown);
  await setCache(cacheKey, { ordersByStatus: breakdown }, 300);
}

// ─────────────────────────────────────────────
// 3. getInventoryStatusBreakdown
// ─────────────────────────────────────────────
async function testGetInventoryStatusBreakdown() {
  section('getInventoryStatusBreakdown');

  const cacheKey = 'inventory_status_breakdown_v7';
  console.log(`[getInventoryStatusBreakdown] Cache key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log('[getInventoryStatusBreakdown] Cache HIT:', cached);
    return;
  }
  console.log('[getInventoryStatusBreakdown] Cache MISS — querying DB...');

  const inventoryAgg = await Product.aggregate([
    { $match: { status: 'published' } },
    { $group: { _id: '$inventory.status', count: { $sum: 1 } } }
  ]);
  console.log('[getInventoryStatusBreakdown] Raw aggregation:', inventoryAgg);

  const breakdown = { inStock: 0, lowStock: 0, outOfStock: 0, discontinued: 0 };
  inventoryAgg.forEach(item => {
    switch (item._id) {
      case 'InStock':      breakdown.inStock      = item.count; break;
      case 'LowStock':     breakdown.lowStock     = item.count; break;
      case 'OutOfStock':   breakdown.outOfStock   = item.count; break;
      case 'Discontinued': breakdown.discontinued = item.count; break;
    }
  });

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  console.log('[getInventoryStatusBreakdown] Mapped breakdown:', breakdown);
  console.log('[getInventoryStatusBreakdown] ✅ Total inventory count:', total);
  await setCache(cacheKey, { inventory: { ...breakdown, total } }, 300);
}

// ─────────────────────────────────────────────
// 4. getAnalytics
// ─────────────────────────────────────────────
async function testGetAnalytics(timeframe = 'month') {
  section(`getAnalytics (timeframe: "${timeframe}")`);

  const cacheKey = `analytics_${timeframe}_v7`;
  console.log(`[getAnalytics] Cache key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log('[getAnalytics] Cache HIT:', JSON.stringify(cached, null, 2));
    return;
  }
  console.log('[getAnalytics] Cache MISS — querying DB...');

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);
  console.log('[getAnalytics] Date ranges:');
  console.log('  → currentPeriodStart:', currentPeriodStart);
  console.log('  → previousPeriodStart:', previousPeriodStart);
  console.log('  → previousPeriodEnd:', previousPeriodEnd);

  const [currentOrders, previousOrders] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart }, 'paymentInfo.status': 'success' } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $ne: ['$orderStatus', 'Cancelled'] }, '$totalPrice', 0] } } } }
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }, 'paymentInfo.status': 'success' } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $ne: ['$orderStatus', 'Cancelled'] }, '$totalPrice', 0] } } } }
    ])
  ]);
  console.log('[getAnalytics] Current period orders raw:', currentOrders);
  console.log('[getAnalytics] Previous period orders raw:', previousOrders);

  const [currentUsers, previousUsers, currentProducts, previousProducts] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    User.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } }),
    Product.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
    Product.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd } })
  ]);
  console.log('[getAnalytics] Current users:', currentUsers, '| Previous users:', previousUsers);
  console.log('[getAnalytics] Current products:', currentProducts, '| Previous products:', previousProducts);

  const currentRevenue = currentOrders[0]?.revenue || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;
  console.log('[getAnalytics] Current revenue:', currentRevenue, '| Previous revenue:', previousRevenue);

  const trends = {
    revenue:  calculateTrend(currentRevenue, previousRevenue),
    orders:   calculateTrend(currentOrders[0]?.orders || 0, previousOrders[0]?.orders || 0),
    users:    calculateTrend(currentUsers, previousUsers),
    products: calculateTrend(currentProducts, previousProducts)
  };
  console.log('[getAnalytics] Calculated trends:', trends);

  const orderStatusAgg = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    { $group: { _id: '$orderStatus', count: { $sum: 1 } } }
  ]);
  console.log('[getAnalytics] Order status agg (current period):', orderStatusAgg);

  const orderStatusBreakdown = buildOrderStatusBreakdown(orderStatusAgg);
  console.log('[getAnalytics] Order status breakdown:', orderStatusBreakdown);

  const topProducts = await getTopProductsPaginated(5, 0);
  console.log('[getAnalytics] Top 5 products:', topProducts);

  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('user', 'firstName lastName email');
  console.log('[getAnalytics] Recent 5 orders:', recentOrders.map(o => ({
    id: o._id,
    status: o.orderStatus,
    total: o.totalPrice,
    user: o.user,
    createdAt: o.createdAt
  })));

  console.log('[getAnalytics] ✅ Summary:', {
    currentPeriod:  { orders: currentOrders[0]?.orders || 0, revenue: Number(currentRevenue.toFixed(2)), users: currentUsers, products: currentProducts },
    previousPeriod: { orders: previousOrders[0]?.orders || 0, revenue: Number(previousRevenue.toFixed(2)), users: previousUsers, products: previousProducts },
    trends,
    orderStatusBreakdown
  });
}

// ─────────────────────────────────────────────
// 5. getTopProductsEndpoint
// ─────────────────────────────────────────────
async function testGetTopProductsEndpoint(limit = 10, page = 1) {
  section(`getTopProductsEndpoint (limit: ${limit}, page: ${page})`);

  const skip = (page - 1) * limit;
  const cacheKey = `top_products_${limit}_${page}_v7`;
  console.log(`[getTopProductsEndpoint] Cache key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log('[getTopProductsEndpoint] Cache HIT:', cached);
    return;
  }
  console.log('[getTopProductsEndpoint] Cache MISS — querying DB...');

  const topProducts = await getTopProductsPaginated(limit, skip);
  console.log(`[getTopProductsEndpoint] Fetched ${topProducts?.length} products:`, topProducts);

  const totalCount = await Order.aggregate([
    { $match: { orderStatus: { $ne: 'Cancelled' } } },
    { $unwind: '$orderItems' },
    { $match: { 'orderItems.product': { $ne: null } } },
    { $group: { _id: '$orderItems.product' } },
    { $count: 'total' }
  ]);
  console.log('[getTopProductsEndpoint] Total unique products in orders raw:', totalCount);

  const total = totalCount[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);
  console.log('[getTopProductsEndpoint] ✅ Pagination:', { currentPage: page, totalPages, totalProducts: total });
}

// ─────────────────────────────────────────────
// 6. getInventoryStats
// ─────────────────────────────────────────────
async function testGetInventoryStats() {
  section('getInventoryStats');

  const cacheKey = 'inventory_stats_v7';
  console.log(`[getInventoryStats] Cache key: "${cacheKey}"`);

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log('[getInventoryStats] Cache HIT:', cached);
    return;
  }
  console.log('[getInventoryStats] Cache MISS — querying DB...');

  const inventoryStatusAgg = await Product.aggregate([
    { $match: { status: 'published' } },
    { $group: { _id: '$inventory.status', count: { $sum: 1 } } }
  ]);
  console.log('[getInventoryStats] Raw inventory status agg:', inventoryStatusAgg);

  const inventoryByStatus = buildInventoryStatusBreakdown(inventoryStatusAgg);
  console.log('[getInventoryStats] Mapped inventory by status:', inventoryByStatus);

  const inventoryValue = await Product.aggregate([
    { $match: { status: 'published', 'inventory.trackInventory': true, 'inventory.stock': { $gt: 0 } } },
    { $group: { _id: null, totalValue: { $sum: { $multiply: ['$inventory.stock', { $ifNull: ['$pricing.cost', '$pricing.regular'] }] } }, totalUnits: { $sum: '$inventory.stock' } } }
  ]);
  console.log('[getInventoryStats] Inventory value raw:', inventoryValue);
  console.log('[getInventoryStats]  → Total value:', inventoryValue[0]?.totalValue || 0);
  console.log('[getInventoryStats]  → Total units:', inventoryValue[0]?.totalUnits || 0);

  const lowStockProducts = await Product.find({ status: 'published', 'inventory.status': 'LowStock' })
    .select('name inventory.stock inventory.lowStockThreshold pricing.regular')
    .sort({ 'inventory.stock': 1 })
    .limit(10);

  console.log(`[getInventoryStats] Low stock products (${lowStockProducts.length}):`,
    lowStockProducts.map(p => ({
      name: p.name,
      stock: p.inventory?.stock,
      threshold: p.inventory?.lowStockThreshold,
      price: p.pricing?.regular
    }))
  );

  const alerts = {
    needsRestock: (inventoryByStatus.lowStock || 0) + (inventoryByStatus.outOfStock || 0),
    outOfStockCount: inventoryByStatus.outOfStock || 0,
    criticalCount: inventoryByStatus.outOfStock || 0
  };
  console.log('[getInventoryStats] ✅ Alerts:', alerts);
}

// ─────────────────────────────────────────────
// MAIN — boot connections, run all tests, exit
// ─────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(55));
  console.log('  🚀 ANALYTICS TEST RUNNER');
  console.log('='.repeat(55));

  try {
    console.log('\n[boot] Connecting to Redis...');
    await initializeRedis();
    console.log('[boot] ✅ Redis connected');

    console.log('[boot] Connecting to MongoDB...');
    await connectDB();
    console.log('[boot] ✅ MongoDB connected\n');

    await testGetAdminStats();
    await testGetOrderStatusBreakdown();
    await testGetInventoryStatusBreakdown();
    await testGetAnalytics('month');
    await testGetTopProductsEndpoint(10, 1);
    await testGetInventoryStats();

    console.log('\n' + '='.repeat(55));
    console.log('  ✅ ALL TESTS COMPLETE');
    console.log('='.repeat(55) + '\n');

  } catch (err) {
    console.error('\n💥 Test runner error:', err.message);
    console.error(err.stack);
  } finally {
    await shutdownRedis();
    process.exit(0);
  }
}

main();