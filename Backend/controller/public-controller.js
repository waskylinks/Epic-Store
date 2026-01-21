import handleAsyncError from "../middleware/handleAsyncError.js";
import { ORDER_STATUSES } from "../constants/analytics.constants.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import HandleError from "../utils/handleError.js";
import { getCache, setCache } from "../utils/redis.js";

/* ================= TRENDING PRODUCTS (PUBLIC) ================= */
export const getTrendingProducts = handleAsyncError(async (req, res, next) => {
  // Extract and validate query params
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 50);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;
  const category = req.query.category;
  const inStockOnly = req.query.inStockOnly !== 'false'; // Default true
  const timeframe = req.query.timeframe || 'month'; // 'week', 'month', 'all'

  // Build cache key
  const cacheKey = `trending_products_${timeframe}_${category || 'all'}_${inStockOnly}_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  // Calculate date range for timeframe
  let dateFilter = {};
  if (timeframe !== 'all') {
    const now = new Date();
    if (timeframe === 'week') {
      dateFilter = { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7) }};
    } else if (timeframe === 'month') {
      dateFilter = { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()) }};
    }
  }

  // Build aggregation pipeline
  const pipeline = [
    // Stage 1: Filter orders
    { 
      $match: { 
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        ...dateFilter
      }
    },
    
    // Stage 2: Unwind order items
    { $unwind: "$orderItems" },
    
    // Stage 3: Filter out items without product reference
    { $match: { "orderItems.product": { $exists: true, $ne: null } }},
    
    // Stage 4: Group by product and calculate metrics
    {
      $group: {
        _id: "$orderItems.product",
        totalRevenue: { 
          $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] }
        },
        totalQuantity: { $sum: "$orderItems.quantity" },
        orderCount: { $sum: 1 }
      }
    },
    
    // Stage 5: Sort by revenue (trending = highest revenue)
    { $sort: { totalRevenue: -1 }},
    
    // Stage 6: Lookup product details
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "productDetails"
      }
    },
    
    // Stage 7: Unwind product details
    { $unwind: "$productDetails" },
    
    // Stage 8: Filter by product status
    { $match: { "productDetails.status": "published" }},
    
    // Stage 9: Filter by stock if needed
    ...(inStockOnly ? [{ $match: { "productDetails.stock": { $gt: 0 }}}] : []),
    
    // Stage 10: Filter by category if provided
    ...(category ? [{ $match: { "productDetails.category": category }}] : []),
    
    // Stage 11: Project final structure
    {
      $project: {
        _id: "$productDetails._id",
        name: "$productDetails.name",
        slug: "$productDetails.slug",
        description: "$productDetails.description",
        shortDescription: "$productDetails.shortDescription",
        price: "$productDetails.price",
        pricing: "$productDetails.pricing",
        images: "$productDetails.images",
        category: "$productDetails.category",
        brand: "$productDetails.brand",
        ratings: "$productDetails.ratings",
        numOfReviews: "$productDetails.numOfReviews",
        stock: "$productDetails.stock",
        inventory: "$productDetails.inventory",
        isFeatured: "$productDetails.isFeatured",
        isNewArrival: "$productDetails.isNewArrival",
        isBestseller: "$productDetails.isBestseller",
        isOnSale: "$productDetails.isOnSale",
        // Analytics metadata
        trendingScore: "$totalRevenue",
        soldCount: "$totalQuantity",
        orderCount: "$orderCount"
      }
    },
    
    // Stage 12: Pagination
    { $skip: skip },
    { $limit: limit }
  ];

  // Execute aggregation
  const products = await Order.aggregate(pipeline);

  // Get total count for pagination
  const countPipeline = [
    { $match: { orderStatus: { $ne: ORDER_STATUSES.CANCELLED }, ...dateFilter }},
    { $unwind: "$orderItems" },
    { $match: { "orderItems.product": { $exists: true, $ne: null } }},
    { $group: { _id: "$orderItems.product" }},
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "productDetails"
      }
    },
    { $unwind: "$productDetails" },
    { $match: { "productDetails.status": "published" }},
    ...(inStockOnly ? [{ $match: { "productDetails.stock": { $gt: 0 }}}] : []),
    ...(category ? [{ $match: { "productDetails.category": category }}] : []),
    { $count: "total" }
  ];

  const totalCount = await Order.aggregate(countPipeline);
  const total = totalCount[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const response = {
    products,
    pagination: {
      currentPage: page,
      totalPages,
      totalProducts: total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      limit
    },
    timeframe
  };

  // Cache for 15 minutes
  await setCache(cacheKey, response, 900);

  res.status(200).json({ success: true, ...response });
});

/* ================= NEW PRODUCTS (PUBLIC) ================= */
export const getNewProducts = handleAsyncError(async (req, res, next) => {
  // Extract and validate query params
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 50);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;
  const category = req.query.category;
  const inStockOnly = req.query.inStockOnly !== 'false'; // Default true
  const daysBack = parseInt(req.query.daysBack) || 30; // Default 30 days

  // Build cache key
  const cacheKey = `new_products_${category || 'all'}_${inStockOnly}_${daysBack}_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  // Build query
  const query = { status: 'published' };

  // Date filter
  if (daysBack) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    query.createdAt = { $gte: cutoffDate };
  }

  // Stock filter
  if (inStockOnly) {
    query.stock = { $gt: 0 };
  }

  // Category filter
  if (category) {
    query.category = category;
  }

  // Execute query
  const products = await Product.find(query)
    .select('name slug description shortDescription price pricing images category brand ratings numOfReviews stock inventory isFeatured isNewArrival isBestseller isOnSale createdAt analytics')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Get total count
  const total = await Product.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  const response = {
    products,
    pagination: {
      currentPage: page,
      totalPages,
      totalProducts: total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      limit
    },
    daysBack
  };

  // Cache for 15 minutes
  await setCache(cacheKey, response, 900);

  res.status(200).json({ success: true, ...response });
});

/* ================= FEATURED PRODUCTS (PUBLIC) ================= */
export const getFeaturedProducts = handleAsyncError(async (req, res, next) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 50);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const cacheKey = `featured_products_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const query = { 
    status: 'published',
    isFeatured: true,
    stock: { $gt: 0 }
  };

  const products = await Product.find(query)
    .select('name slug description shortDescription price pricing images category brand ratings numOfReviews stock inventory isFeatured isOnSale')
    .sort({ ratings: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Product.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  const response = {
    products,
    pagination: {
      currentPage: page,
      totalPages,
      totalProducts: total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      limit
    }
  };

  await setCache(cacheKey, response, 900);

  res.status(200).json({ success: true, ...response });
});

/* ================= BESTSELLERS (PUBLIC) ================= */
export const getBestsellers = handleAsyncError(async (req, res, next) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 50);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const cacheKey = `bestsellers_${limit}_${page}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const query = { 
    status: 'published',
    stock: { $gt: 0 }
  };

  const products = await Product.find(query)
    .select('name slug description shortDescription price pricing images category brand ratings numOfReviews stock inventory isBestseller isOnSale analytics')
    .sort({ 'analytics.purchases': -1, ratings: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Product.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  const response = {
    products,
    pagination: {
      currentPage: page,
      totalPages,
      totalProducts: total,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      limit
    }
  };

  await setCache(cacheKey, response, 900);

  res.status(200).json({ success: true, ...response });
});