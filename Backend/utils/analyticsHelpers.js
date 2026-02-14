import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import { ORDER_STATUSES, INVENTORY_STATUSES } from "../constants/analytics.constants.js";
import { calculateTrend } from "./calculateTrend.js";

// ============================================
// ORDER STATUS BREAKDOWN
// FIX: Was copy-pasted with switch/case in adminStatsController (x2),
// dashboardController, and reportsController. Single source of truth.
// ============================================
export const buildOrderStatusBreakdown = (statusAgg) => {
  const breakdown = { processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
  statusAgg.forEach(({ _id, count }) => {
    switch (_id) {
      case "Processing": breakdown.processing = count; break;
      case "Shipped":    breakdown.shipped    = count; break;
      case "Delivered":  breakdown.delivered  = count; break;
      case "Cancelled":  breakdown.cancelled  = count; break;
    }
  });
  return breakdown;
};

// ============================================
// INVENTORY STATUS BREAKDOWN
// FIX: Was copy-pasted in adminStatsController (x2) and dashboardController.
// ============================================
export const buildInventoryStatusBreakdown = (statusAgg) => {
  const breakdown = { inStock: 0, lowStock: 0, outOfStock: 0, discontinued: 0 };
  statusAgg.forEach(({ _id, count }) => {
    switch (_id) {
      case INVENTORY_STATUSES.IN_STOCK:     breakdown.inStock     = count; break;
      case INVENTORY_STATUSES.LOW_STOCK:    breakdown.lowStock    = count; break;
      case INVENTORY_STATUSES.OUT_OF_STOCK: breakdown.outOfStock  = count; break;
      case INVENTORY_STATUSES.DISCONTINUED: breakdown.discontinued = count; break;
    }
  });
  return breakdown;
};

// ============================================
// TOP PRODUCTS — DATE FILTERED (dashboard / reports)
// FIX: Was duplicated between dashboardController and adminStatsController
// with different signatures. Now one shared version.
// ============================================
export const getTopProductsByRevenue = async (startDate, limit = 10) => {
  const products = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        "paymentInfo.status": "success"
      }
    },
    { $unwind: "$orderItems" },
    {
      $group: {
        _id: "$orderItems.product",
        revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
        salesCount: { $sum: "$orderItems.quantity" },
        orders: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: limit }
  ]);

  return Promise.all(
    products.map(async (item) => {
      const product = await Product.findById(item._id).select("name images pricing");
      if (!product) return null;
      return {
        name: product.name,
        image: product.images?.[0]?.url,
        price: product.pricing?.regular || 0,
        revenue: Math.round(item.revenue * 100) / 100,
        salesCount: item.salesCount,
        orders: item.orders
      };
    })
  ).then((r) => r.filter(Boolean));
};

// ============================================
// TOP PRODUCTS — PAGINATED ALL-TIME (admin endpoint)
// ============================================
export const getTopProductsPaginated = async (limit = 10, skip = 0) => {
  return Order.aggregate([
    { $match: { orderStatus: { $ne: ORDER_STATUSES.CANCELLED } } },
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $ne: null } } },
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
    { $project: { _id: 0, productId: "$_id", name: 1, revenue: 1, quantity: 1 } }
  ]);
};

// ============================================
// TOP CUSTOMERS
// FIX: Was duplicated in dashboardController and reportsController.
// ============================================
export const getTopCustomers = async (startDate, limit = 10) => {
  const customers = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        "paymentInfo.status": "success"
      }
    },
    {
      $group: {
        _id: "$user",
        totalSpent: { $sum: "$totalPrice" },
        orderCount: { $sum: 1 }
      }
    },
    { $sort: { totalSpent: -1 } },
    { $limit: limit }
  ]);

  return Promise.all(
    customers.map(async (item) => {
      const user = await User.findById(item._id).select("firstName lastName email");
      if (!user) return null;
      return {
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        totalSpent: Math.round(item.totalSpent * 100) / 100,
        orderCount: item.orderCount
      };
    })
  ).then((r) => r.filter(Boolean));
};

// ============================================
// TOP CATEGORIES
// FIX: Was duplicated in dashboardController, reportsController,
// and productAnalyticsController with minor variations.
// ============================================
export const getTopCategories = async (startDate, limit = 10) => {
  return Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
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
    { $unwind: { path: "$productDetails", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$productDetails.category",
        revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
        unitsSold: { $sum: "$orderItems.quantity" }
      }
    },
    { $match: { _id: { $ne: null } } },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        name: "$_id",
        revenue: { $round: ["$revenue", 2] },
        unitsSold: 1
      }
    }
  ]);
};

// ============================================
// REVENUE METRICS (current vs previous period)
// FIX: Was duplicated across dashboardController, adminStatsController,
// and reportsController with inconsistent paymentInfo filters.
// Canonical version always requires paymentInfo.status: success.
// ============================================
export const getRevenueMetrics = async (currentStart, previousStart, previousEnd) => {
  const [current, previous] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: currentStart },
          orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
          "paymentInfo.status": "success"
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalPrice" },
          totalProfit: { $sum: "$profitAnalysis.netProfit" },
          orders: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: previousStart, $lt: previousEnd },
          orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
          "paymentInfo.status": "success"
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalPrice" },
          orders: { $sum: 1 }
        }
      }
    ])
  ]);

  const currentRevenue = current[0]?.totalRevenue || 0;
  const previousRevenue = previous[0]?.totalRevenue || 0;
  const currentProfit = current[0]?.totalProfit || 0;

  return {
    current: Math.round(currentRevenue * 100) / 100,
    previous: Math.round(previousRevenue * 100) / 100,
    change: calculateTrend(currentRevenue, previousRevenue),
    profit: Math.round(currentProfit * 100) / 100,
    profitMargin:
      currentRevenue > 0
        ? Math.round((currentProfit / currentRevenue) * 100 * 100) / 100
        : 0
  };
};

// ============================================
// INVENTORY STATUS AGGREGATION QUERY
// ============================================
export const fetchInventoryStatusAgg = () =>
  Product.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$inventory.status", count: { $sum: 1 } } }
  ]);

// ============================================
// LOW STOCK QUERY (shared filter)
// FIX: Was duplicated in adminStatsController, dashboardController,
// productAnalyticsController with different field selections.
// ============================================
export const LOW_STOCK_FILTER = {
  status: "published",
  "inventory.trackInventory": true,
  $expr: {
    $and: [
      { $gt: ["$inventory.stock", 0] },
      { $lte: ["$inventory.stock", "$inventory.lowStockThreshold"] }
    ]
  }
};

export const OUT_OF_STOCK_FILTER = {
  status: "published",
  "inventory.stock": 0,
  "inventory.trackInventory": true
};

// ============================================
// ESTIMATED VISITORS (placeholder — needs real session tracking)
// FIX: Was duplicated inline in dashboardController. Centralized here.
// ============================================
export const getEstimatedVisitors = async () => {
  const totalViews = await Product.aggregate([
    { $group: { _id: null, totalViews: { $sum: "$analytics.views" } } }
  ]);
  return Math.floor((totalViews[0]?.totalViews || 0) / 10);
};