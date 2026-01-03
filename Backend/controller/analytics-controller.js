import handleAsyncError from "../middleware/handleAsyncError.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { calculateTrend } from "../utils/calculateTrend.js";
import { getDateRanges } from "../utils/dateRanges.js";
import {
  getAdminStatsService
} from "../services/analytics-service.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/user-model.js";

/* ================= ADMIN STATS ================= */
export const getAdminStats = handleAsyncError(async (req, res) => {
  const stats = await getAdminStatsService();

  res.status(200).json({
    success: true,
    products: stats.products.products || 0,
    orders: stats.orders.orders || 0,
    revenue: Number((stats.orders.revenue || 0).toFixed(2)),
    users: stats.users.users || 0,
    outOfStock: stats.products.outOfStock || 0,
    inStock: stats.products.inStock || 0,
    adminCount: stats.users.adminCount || 0
  });
});

/* ================= ADVANCED ANALYTICS ================= */
export const getAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

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
              $cond: [{ $ne: ["$orderStatus", "cancelled"] }, "$totalPrice", 0]
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
              $cond: [{ $ne: ["$orderStatus", "cancelled"] }, "$totalPrice", 0]
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
        _id: { $toLower: "$orderStatus" },
        count: { $sum: 1 }
      }
    }
  ]);

  const orderStatusBreakdown = {
    processing: orderStatusAgg.find(o => o._id === "processing")?.count || 0,
    shipped: orderStatusAgg.find(o => o._id === "shipped")?.count || 0,
    delivered: orderStatusAgg.find(o => o._id === "delivered")?.count || 0,
    cancelled: orderStatusAgg.find(o => o._id === "cancelled")?.count || 0
  };

  const topProducts = await Order.aggregate([
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
    { $limit: 5 },
    { $project: { _id: 0, name: 1, revenue: 1, quantity: 1 } }
  ]);

  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("user", "name email");

  res.status(200).json({
    success: true,
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
  });
});
