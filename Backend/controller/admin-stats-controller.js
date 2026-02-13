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
// SHARED HELPER: Dynamic inventory status computation
// ============================================
// inventory.status is only updated by the Mongoose pre-save hook, which does NOT
// fire on findOneAndUpdate / updateOne / bulkWrite / aggregate writes.
// We compute status dynamically from actual stock values to avoid stale reads.
//
// FIX (v1 regression): Using a dotted key in $addFields ("inventory.computedStatus")
// does NOT write into the nested subdocument — MongoDB creates a top-level field
// literally named "inventory.computedStatus". Subsequent reads of "$inventory.computedStatus"
// resolve the nested path (undefined), causing all products to group under _id: null.
// Fix: use $mergeObjects to properly write into the inventory subdocument.
//
// NOTE on Discontinued: it is an admin-set flag with no stock-based trigger.
// We intentionally read "$inventory.status" to preserve it. All other statuses
// are computed purely from stock values.
const buildInventoryStatusStage = () => ({
  $addFields: {
    inventory: {
      $mergeObjects: [
        "$inventory",
        {
          computedStatus: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$inventory.stock", 0] },
                  then: "OutOfStock"
                },
                {
                  case: {
                    $and: [
                      { $gt: ["$inventory.stock", 0] },
                      {
                        $lte: [
                          "$inventory.stock",
                          { $ifNull: ["$inventory.lowStockThreshold", 5] }
                        ]
                      }
                    ]
                  },
                  then: "LowStock"
                }
              ],
              default: {
                $cond: [
                  { $eq: ["$inventory.status", "Discontinued"] },
                  "Discontinued",
                  "InStock"
                ]
              }
            }
          }
        }
      ]
    }
  }
});

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
    shipped:    orderStatusAgg.find(o => o._id === "Shipped")?.count    || 0,
    delivered:  orderStatusAgg.find(o => o._id === "Delivered")?.count  || 0,
    cancelled:  orderStatusAgg.find(o => o._id === "Cancelled")?.count  || 0
  };

  // Compute inventory status dynamically — reads actual stock, not the stale stored field.
  const inventoryStatusAgg = await Product.aggregate([
    { $match: { status: "published" } },
    buildInventoryStatusStage(),
    {
      $group: {
        _id: "$inventory.computedStatus",
        count: { $sum: 1 }
      }
    }
  ]);

  const inventoryByStatus = {
    inStock:      inventoryStatusAgg.find(i => i._id === "InStock")?.count      || 0,
    lowStock:     inventoryStatusAgg.find(i => i._id === "LowStock")?.count     || 0,
    outOfStock:   inventoryStatusAgg.find(i => i._id === "OutOfStock")?.count   || 0,
    discontinued: inventoryStatusAgg.find(i => i._id === "Discontinued")?.count || 0
  };

  const response = {
    products:   stats.products?.products  ?? 0,
    orders:     stats.orders?.orders      ?? 0,
    revenue:    Number((stats.orders?.revenue ?? 0).toFixed(2)),
    users:      stats.users?.users        ?? 0,
    adminCount: stats.users?.adminCount   ?? 0,
    ordersByStatus,
    inventory: {
      inStock:      inventoryByStatus.inStock,
      lowStock:     inventoryByStatus.lowStock,
      outOfStock:   inventoryByStatus.outOfStock,
      discontinued: inventoryByStatus.discontinued,
      total:
        inventoryByStatus.inStock +
        inventoryByStatus.lowStock +
        inventoryByStatus.outOfStock +
        inventoryByStatus.discontinued
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

  // validateTimeframe calls next(err) on failure; return immediately so execution
  // does not continue into DB queries with an invalid timeframe.
  if (!validateTimeframe(timeframe, next)) return;

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

  const [currentUsers, previousUsers, currentProducts, previousProducts] =
    await Promise.all([
      User.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
      User.countDocuments({
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
      }),
      Product.countDocuments({ createdAt: { $gte: currentPeriodStart } }),
      Product.countDocuments({
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
      })
    ]);

  const currentRevenue  = currentOrders[0]?.revenue  || 0;
  const previousRevenue = previousOrders[0]?.revenue || 0;

  const trends = {
    revenue:  calculateTrend(currentRevenue, previousRevenue),
    orders:   calculateTrend(currentOrders[0]?.orders  || 0, previousOrders[0]?.orders  || 0),
    users:    calculateTrend(currentUsers,    previousUsers),
    products: calculateTrend(currentProducts, previousProducts)
  };

  // FIX: Scope order status breakdown to the same period as other metrics.
  // Previously this was an all-time scan, producing counts inconsistent with
  // the timeframe-scoped currentPeriod / trends data in the same response.
  const orderStatusAgg = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 }
      }
    }
  ]);

  const orderStatusBreakdown = {
    processing: orderStatusAgg.find(o => o._id === "Processing")?.count || 0,
    shipped:    orderStatusAgg.find(o => o._id === "Shipped")?.count    || 0,
    delivered:  orderStatusAgg.find(o => o._id === "Delivered")?.count  || 0,
    cancelled:  orderStatusAgg.find(o => o._id === "Cancelled")?.count  || 0
  };

  const topProducts = await getTopProducts(5, 0);

  // User model stores firstName + lastName separately — no `name` field exists.
  // Virtuals (fullName) are not available through populate projections.
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

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

// ============================================
// TOP PRODUCTS (REUSABLE WITH PAGINATION)
// ============================================

/**
 * Get top products by revenue
 * @param {number} limit - Number of products to return
 * @param {number} skip  - Number of products to skip
 * @returns {Promise<Array>} Top products
 */
export const getTopProducts = async (limit = 5, skip = 0) => {
  return await Order.aggregate([
    { $match: { orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$orderItems" },
    // $exists:true passes null values — use $ne:null to exclude deleted product refs.
    { $match: { "orderItems.product": { $ne: null } } },
    {
      $group: {
        _id: "$orderItems.product",
        name:     { $first: "$orderItems.name" },
        revenue:  { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
        quantity: { $sum: "$orderItems.quantity" }
      }
    },
    { $sort: { revenue: -1 } },
    { $skip: skip },
    { $limit: limit },
    // Expose productId so admin UI can link to the product detail page.
    {
      $project: {
        _id: 0,
        productId: "$_id",
        name:      1,
        revenue:   1,
        quantity:  1
      }
    }
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
export const getTopProductsEndpoint = handleAsyncError(async (req, res) => {
  // parseInt("-5") = -5 (truthy) — the `|| default` fallback never fires for negatives.
  // A negative $limit or $skip throws a MongoError. Clamp to safe ranges.
  const rawLimit = parseInt(req.query.limit);
  const rawPage  = parseInt(req.query.page);

  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 10;
  const page  = Number.isFinite(rawPage)  ? Math.max(1, rawPage) : 1;
  const skip  = (page - 1) * limit;

  const cacheKey = `top_products_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const topProducts = await getTopProducts(limit, skip);

  // FIX: Mirror the $ne:null filter from getTopProducts so the pagination total
  // matches the actual result set. Without this, null product refs inflate `total`,
  // producing phantom pages that return empty results.
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

  // Compute inventory status dynamically — same fix as getAdminStats.
  const inventoryStatusAgg = await Product.aggregate([
    { $match: { status: "published" } },
    buildInventoryStatusStage(),
    {
      $group: {
        _id: "$inventory.computedStatus",
        count: { $sum: 1 }
      }
    }
  ]);

  const inventoryByStatus = {
    inStock:      inventoryStatusAgg.find(i => i._id === "InStock")?.count      || 0,
    lowStock:     inventoryStatusAgg.find(i => i._id === "LowStock")?.count     || 0,
    outOfStock:   inventoryStatusAgg.find(i => i._id === "OutOfStock")?.count   || 0,
    discontinued: inventoryStatusAgg.find(i => i._id === "Discontinued")?.count || 0
  };

  // Only include products where inventory is actually being tracked;
  // trackInventory:false means stock is not managed and should not factor into value.
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

  // FIX: Query by actual stock values rather than the stale stored status field.
  const lowStockProducts = await Product.find({
    status: "published",
    "inventory.stock": { $gt: 0 },
    $expr: {
      $lte: [
        "$inventory.stock",
        { $ifNull: ["$inventory.lowStockThreshold", 5] }
      ]
    }
  })
    .select("name inventory.stock inventory.lowStockThreshold pricing.regular")
    .sort({ "inventory.stock": 1 })
    .limit(10);

  const response = {
    inventoryByStatus,
    totalInventoryValue: inventoryValue[0]?.totalValue || 0,
    totalUnits:          inventoryValue[0]?.totalUnits  || 0,
    lowStockProducts: lowStockProducts.map(p => ({
      id:        p._id,
      name:      p.name,
      stock:     p.inventory?.stock             || 0,
      threshold: p.inventory?.lowStockThreshold || 5,
      price:     p.pricing?.regular             || 0
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
  getAnalytics,
  getTopProducts,
  getTopProductsEndpoint,
  getInventoryStats
};