import handleAsyncError from "../middleware/handleAsyncError.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { getAdminStatsService } from "../Services/analytics-service.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import { getCache, setCache } from "../utils/redis.js";

/* ================= ADMIN STATS ================= */
export const getAdminStats = handleAsyncError(async (req, res) => {
  const cacheKey = "admin_stats";

  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const stats = await getAdminStatsService();

  const response = {
    products: stats.products.products || 0,
    orders: stats.orders.orders || 0,
    revenue: Number((stats.orders.revenue || 0).toFixed(2)),
    users: stats.users.users || 0,
    outOfStock: stats.products.outOfStock || 0,
    inStock: stats.products.inStock || 0,
    adminCount: stats.users.adminCount || 0
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

/* ================= ADVANCED ANALYTICS ================= */
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

  // Use the reusable getTopProducts function
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

/* ================= TOP PRODUCTS (REUSABLE WITH PAGINATION) ================= */
export const getTopProducts = async (limit = 5, skip = 0) => {
  return await Order.aggregate([
    // Filter out cancelled orders
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

/* ================= STANDALONE TOP PRODUCTS ENDPOINT (OPTIONAL) ================= */
export const getTopProductsEndpoint = handleAsyncError(async (req, res, next) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  const cacheKey = `top_products_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const topProducts = await getTopProducts(limit, skip);

  // Get total count for pagination
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