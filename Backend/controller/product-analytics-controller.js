import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from "../models/product-model.js";
import Order from "../models/order-model.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";

// ============================================
// PRODUCT PERFORMANCE OVERVIEW
// ============================================

export const getProductPerformanceOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `product_performance_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const summary = await Product.aggregate([
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        publishedProducts: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
        draftProducts: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $eq: ["$inventory.stock", 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ["$inventory.stock", 0] },
                  { $lte: ["$inventory.stock", "$inventory.lowStockThreshold"] }
                ]
              },
              1,
              0
            ]
          }
        },
        totalViews: { $sum: "$analytics.views" },
        totalPurchases: { $sum: "$analytics.purchases" },
        totalWishlistAdds: { $sum: "$analytics.addedToWishlist" }
      }
    }
  ]);

  const data = summary[0] || {
    totalProducts: 0,
    publishedProducts: 0,
    draftProducts: 0,
    outOfStock: 0,
    lowStock: 0,
    totalViews: 0,
    totalPurchases: 0,
    totalWishlistAdds: 0
  };

  const conversionRate =
    data.totalViews > 0
      ? Math.round((data.totalPurchases / data.totalViews) * 100 * 100) / 100
      : 0;

  const topProducts = await Order.aggregate([
    {
      $match: {
        orderStatus: { $ne: "Cancelled" },
        "paymentInfo.status": "success",
        createdAt: { $gte: currentPeriodStart }
      }
    },
    { $unwind: "$orderItems" },
    {
      $group: {
        _id: "$orderItems.product",
        revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
        unitsSold: { $sum: "$orderItems.quantity" },
        orders: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 }
  ]);

  const populatedTopProducts = await Promise.all(
    topProducts.map(async (item) => {
      const product = await Product.findById(item._id).select(
        "name images pricing category"
      );
      return {
        product,
        revenue: Math.round(item.revenue * 100) / 100,
        unitsSold: item.unitsSold,
        orders: item.orders
      };
    })
  );

  const response = {
    summary: { ...data, conversionRate },
    topProducts: populatedTopProducts.filter((p) => p.product !== null)
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// CONVERSION METRICS
// ============================================

export const getProductConversionMetrics = handleAsyncError(async (req, res, next) => {
  const { limit = 20, sortBy = "conversionRate" } = req.query;

  const cacheKey = `product_conversion_${limit}_${sortBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const products = await Product.find({
    status: "published",
    "analytics.views": { $gt: 0 }
  })
    .select("name images pricing category analytics inventory")
    .lean();

  const productsWithMetrics = products.map((product) => {
    const views = product.analytics?.views || 0;
    const purchases = product.analytics?.purchases || 0;
    const cartAdds = product.analytics?.addedToCart || 0;
    const wishlistAdds = product.analytics?.addedToWishlist || 0;

    const viewToPurchaseRate =
      views > 0 ? Math.round((purchases / views) * 100 * 100) / 100 : 0;
    const viewToCartRate =
      views > 0 ? Math.round((cartAdds / views) * 100 * 100) / 100 : 0;
    const cartToPurchaseRate =
      cartAdds > 0 ? Math.round((purchases / cartAdds) * 100 * 100) / 100 : 0;

    return {
      _id: product._id,
      name: product.name,
      image: product.images?.[0]?.url,
      category: product.category,
      // FIX P1: Product model has no top-level `price` field.
      // The field is nested at `pricing.regular`.
      price: product.pricing?.regular || 0,
      analytics: { views, purchases, cartAdds, wishlistAdds },
      conversionMetrics: { viewToPurchaseRate, viewToCartRate, cartToPurchaseRate },
      stock: product.inventory?.stock || 0
    };
  });

  let sortedProducts = [...productsWithMetrics];
  if (sortBy === "conversionRate") {
    sortedProducts.sort(
      (a, b) =>
        b.conversionMetrics.viewToPurchaseRate - a.conversionMetrics.viewToPurchaseRate
    );
  } else if (sortBy === "views") {
    sortedProducts.sort((a, b) => b.analytics.views - a.analytics.views);
  } else if (sortBy === "purchases") {
    sortedProducts.sort((a, b) => b.analytics.purchases - a.analytics.purchases);
  }

  const limitedProducts = sortedProducts.slice(0, parseInt(limit));

  const response = {
    products: limitedProducts,
    summary: {
      avgViewToPurchase:
        sortedProducts.length > 0
          ? Math.round(
              (sortedProducts.reduce(
                (sum, p) => sum + p.conversionMetrics.viewToPurchaseRate,
                0
              ) /
                sortedProducts.length) *
                100
            ) / 100
          : 0,
      avgViewToCart:
        sortedProducts.length > 0
          ? Math.round(
              (sortedProducts.reduce(
                (sum, p) => sum + p.conversionMetrics.viewToCartRate,
                0
              ) /
                sortedProducts.length) *
                100
            ) / 100
          : 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// INVENTORY TURNOVER
// ============================================

export const getInventoryTurnover = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `inventory_turnover_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const salesData = await Order.aggregate([
    {
      $match: {
        orderStatus: { $in: ["Delivered", "Shipped"] },
        "paymentInfo.status": "success",
        createdAt: { $gte: currentPeriodStart }
      }
    },
    { $unwind: "$orderItems" },
    {
      $group: {
        _id: "$orderItems.product",
        unitsSold: { $sum: "$orderItems.quantity" }
      }
    }
  ]);

  const products = await Product.find({ status: "published" }).select(
    "name images category inventory pricing"
  );

  const productsWithTurnover = await Promise.all(
    products.map(async (product) => {
      const sales = salesData.find(
        (s) => s._id.toString() === product._id.toString()
      );
      const unitsSold = sales?.unitsSold || 0;
      const currentStock = product.inventory?.stock || 0;
      const avgStock = currentStock + unitsSold / 2;

      const turnoverRatio =
        avgStock > 0 ? Math.round((unitsSold / avgStock) * 100) / 100 : 0;

      const daysInPeriod = Math.ceil(
        (Date.now() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24)
      );
      const dailySales = daysInPeriod > 0 ? unitsSold / daysInPeriod : 0;
      const daysOfInventory =
        dailySales > 0
          ? Math.round((currentStock / dailySales) * 10) / 10
          : 999;

      return {
        _id: product._id,
        name: product.name,
        image: product.images?.[0]?.url,
        category: product.category,
        // FIX P1: Same issue - use correct nested field
        price: product.pricing?.regular || 0,
        currentStock,
        unitsSold,
        turnoverRatio,
        daysOfInventory,
        status:
          currentStock === 0
            ? "out_of_stock"
            : currentStock <= (product.inventory?.lowStockThreshold || 5)
            ? "low_stock"
            : "in_stock"
      };
    })
  );

  const sortedProducts = productsWithTurnover
    .filter((p) => p.unitsSold > 0)
    .sort((a, b) => b.turnoverRatio - a.turnoverRatio);

  const slowMoving = productsWithTurnover
    .filter((p) => p.turnoverRatio < 0.5 && p.currentStock > 0)
    .sort((a, b) => a.turnoverRatio - b.turnoverRatio)
    .slice(0, 20);

  const response = {
    topTurnover: sortedProducts.slice(0, 20),
    slowMoving,
    summary: {
      avgTurnoverRatio:
        sortedProducts.length > 0
          ? Math.round(
              (sortedProducts.reduce((sum, p) => sum + p.turnoverRatio, 0) /
                sortedProducts.length) *
                100
            ) / 100
          : 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// LOW STOCK ALERTS
// ============================================

export const getLowStockAlerts = handleAsyncError(async (req, res, next) => {
  const [lowStockProducts, outOfStockProducts] = await Promise.all([
    Product.find({
      status: "published",
      "inventory.trackInventory": true,
      $expr: {
        $and: [
          { $gt: ["$inventory.stock", 0] },
          { $lte: ["$inventory.stock", "$inventory.lowStockThreshold"] }
        ]
      }
    })
      .select("name images category inventory pricing analytics")
      .sort({ "inventory.stock": 1 })
      .limit(50),
    Product.find({
      status: "published",
      "inventory.stock": 0,
      "inventory.trackInventory": true
    })
      .select("name images category inventory pricing analytics")
      .sort({ "analytics.purchases": -1 })
      .limit(50)
  ]);

  res.status(200).json({
    success: true,
    lowStock: { count: lowStockProducts.length, products: lowStockProducts },
    outOfStock: { count: outOfStockProducts.length, products: outOfStockProducts }
  });
});

// ============================================
// PROFIT MARGINS
// ============================================

export const getProductProfitMargins = handleAsyncError(async (req, res, next) => {
  const { limit = 20, sortBy = "margin" } = req.query;

  const cacheKey = `product_margins_${limit}_${sortBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const products = await Product.find({
    status: "published",
    "pricing.cost": { $exists: true, $gt: 0 }
  }).select("name images category pricing analytics");

  const productsWithMargins = products.map((product) => {
    const sellingPrice = product.pricing?.sale || product.pricing?.regular || 0;
    const cost = product.pricing?.cost || 0;
    const profit = sellingPrice - cost;
    const marginPercentage =
      sellingPrice > 0
        ? Math.round((profit / sellingPrice) * 100 * 100) / 100
        : 0;

    const unitsSold = product.analytics?.purchases || 0;
    const totalProfit = profit * unitsSold;

    return {
      _id: product._id,
      name: product.name,
      image: product.images?.[0]?.url,
      category: product.category,
      pricing: {
        sellingPrice: Math.round(sellingPrice * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round(profit * 100) / 100
      },
      marginPercentage,
      unitsSold,
      totalProfit: Math.round(totalProfit * 100) / 100
    };
  });

  let sortedProducts = [...productsWithMargins];
  if (sortBy === "margin") {
    sortedProducts.sort((a, b) => b.marginPercentage - a.marginPercentage);
  } else if (sortBy === "totalProfit") {
    sortedProducts.sort((a, b) => b.totalProfit - a.totalProfit);
  } else if (sortBy === "unitsSold") {
    sortedProducts.sort((a, b) => b.unitsSold - a.unitsSold);
  }

  const limitedProducts = sortedProducts.slice(0, parseInt(limit));

  const response = {
    products: limitedProducts,
    summary: {
      avgMargin:
        sortedProducts.length > 0
          ? Math.round(
              (sortedProducts.reduce((sum, p) => sum + p.marginPercentage, 0) /
                sortedProducts.length) *
                100
            ) / 100
          : 0,
      totalProfit:
        Math.round(
          sortedProducts.reduce((sum, p) => sum + p.totalProfit, 0) * 100
        ) / 100
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// PRODUCTS BOUGHT TOGETHER
// ============================================

export const getProductsBoughtTogether = handleAsyncError(async (req, res, next) => {
  const { productId, limit = 10 } = req.query;

  if (!productId) {
    return next(new HandleError("Product ID is required", 400));
  }

  const cacheKey = `bought_together_${productId}_${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const ordersWithProduct = await Order.find({
    "orderItems.product": productId,
    orderStatus: { $ne: "Cancelled" },
    "paymentInfo.status": "success"
  }).select("orderItems");

  const coOccurrences = new Map();
  ordersWithProduct.forEach((order) => {
    order.orderItems.forEach((item) => {
      const itemId = item.product.toString();
      if (itemId === productId) return;
      coOccurrences.set(itemId, (coOccurrences.get(itemId) || 0) + 1);
    });
  });

  const sortedProducts = Array.from(coOccurrences.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, parseInt(limit));

  const products = await Promise.all(
    sortedProducts.map(async ([coProductId, count]) => {
      const product = await Product.findById(coProductId).select(
        "name images pricing category"
      );

      return {
        product: product
          ? {
              _id: product._id,
              name: product.name,
              image: product.images?.[0]?.url,
              category: product.category,
              // FIX P1: Third occurrence - use correct nested field
              price: product.pricing?.regular || 0
            }
          : null,
        timesBoughtTogether: count,
        percentage:
          ordersWithProduct.length > 0
            ? Math.round((count / ordersWithProduct.length) * 100 * 100) / 100
            : 0
      };
    })
  );

  const response = {
    products: products.filter((p) => p.product !== null),
    totalOrders: ordersWithProduct.length
  };

  await setCache(cacheKey, response, 600);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// CATEGORY PERFORMANCE
// ============================================

export const getCategoryPerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `category_performance_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const [categoryPerformance, productCounts] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          orderStatus: { $ne: "Cancelled" },
          "paymentInfo.status": "success",
          createdAt: { $gte: currentPeriodStart }
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
      { $unwind: "$productDetails" },
      {
        $group: {
          _id: "$productDetails.category",
          revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
          unitsSold: { $sum: "$orderItems.quantity" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } }
    ]),
    Product.aggregate([
      { $match: { status: "published" } },
      { $group: { _id: "$category", productCount: { $sum: 1 } } }
    ])
  ]);

  const productCountMap = new Map(
    productCounts.map((item) => [item._id, item.productCount])
  );

  const enrichedPerformance = categoryPerformance.map((cat) => ({
    category: cat._id,
    revenue: Math.round(cat.revenue * 100) / 100,
    unitsSold: cat.unitsSold,
    orders: cat.orders,
    productCount: productCountMap.get(cat._id) || 0,
    avgRevenuePerProduct:
      productCountMap.get(cat._id) > 0
        ? Math.round((cat.revenue / productCountMap.get(cat._id)) * 100) / 100
        : 0
  }));

  const response = {
    categories: enrichedPerformance,
    totalRevenue: enrichedPerformance.reduce((sum, cat) => sum + cat.revenue, 0)
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getProductPerformanceOverview,
  getProductConversionMetrics,
  getInventoryTurnover,
  getLowStockAlerts,
  getProductProfitMargins,
  getProductsBoughtTogether,
  getCategoryPerformance
};