import handleAsyncError from "../middleware/handleAsyncError.js";
import User from "../models/userModel.js";
import Product from "../models/product-model.js";
import HandleError from "../utils/handleError.js";
import { getCache, setCache, deleteCache, deleteCachePattern } from "../utils/redis.js";

/* ================= GET USER WISHLIST ================= */
export const getWishlist = handleAsyncError(async (req, res, next) => {
  const userId = req.user.id;
  
  // Try cache first
  const cacheKey = `wishlist_${userId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({
      success: true,
      ...cached
    });
  }

  // Fetch from database
  const user = await User.findById(userId)
    .populate({
      path: 'wishlist.product',
      select: 'name slug price pricing images category brand ratings numOfReviews stock inventory isFeatured isNewArrival isBestseller isOnSale status',
      match: { status: 'published' } // Only return published products
    })
    .lean();

  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // Filter out null products (deleted or unpublished)
  const validWishlist = user.wishlist.filter(item => item.product !== null);

  const response = {
    wishlist: validWishlist,
    count: validWishlist.length
  };

  // Cache for 5 minutes
  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

/* ================= ADD PRODUCT TO WISHLIST ================= */
export const addToWishlist = handleAsyncError(async (req, res, next) => {
  const { productId } = req.body;
  const userId = req.user.id;

  if (!productId) {
    return next(new HandleError("Product ID is required", 400));
  }

  // Verify product exists and is published
  const product = await Product.findById(productId);
  if (!product) {
    return next(new HandleError("Product not found", 404));
  }

  if (product.status !== 'published') {
    return next(new HandleError("This product is not available", 400));
  }

  // Get user
  const user = await User.findById(userId);
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // Check if product already in wishlist
  const alreadyInWishlist = user.wishlist.some(
    item => item.product.toString() === productId
  );

  if (alreadyInWishlist) {
    return next(new HandleError("Product already in wishlist", 400));
  }

  // Add to wishlist
  user.wishlist.push({
    product: productId,
    addedAt: new Date()
  });

  await user.save({ validateBeforeSave: false });

  // Update product analytics
  try {
    await product.incrementWishlist(true);
    console.log(`✅ Product ${productId} wishlist analytics updated (+1)`);
  } catch (error) {
    console.warn('Failed to update product wishlist analytics:', error);
  }

  // Invalidate caches
  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]);

  res.status(200).json({
    success: true,
    message: "Product added to wishlist",
    wishlistCount: user.wishlist.length
  });
});

/* ================= REMOVE PRODUCT FROM WISHLIST ================= */
export const removeFromWishlist = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId = req.user.id;

  if (!productId) {
    return next(new HandleError("Product ID is required", 400));
  }

  // Get user
  const user = await User.findById(userId);
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // Check if product is in wishlist
  const itemIndex = user.wishlist.findIndex(
    item => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    return next(new HandleError("Product not in wishlist", 404));
  }

  // Remove from wishlist
  user.wishlist.splice(itemIndex, 1);
  await user.save({ validateBeforeSave: false });

  // Update product analytics
  try {
    const product = await Product.findById(productId);
    if (product) {
      await product.incrementWishlist(false);
      console.log(`✅ Product ${productId} wishlist analytics updated (-1)`);
    }
  } catch (error) {
    console.warn('Failed to update product wishlist analytics:', error);
  }

  // Invalidate caches
  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]);

  res.status(200).json({
    success: true,
    message: "Product removed from wishlist",
    wishlistCount: user.wishlist.length
  });
});

/* ================= CLEAR ENTIRE WISHLIST ================= */
export const clearWishlist = handleAsyncError(async (req, res, next) => {
  const userId = req.user.id;

  const user = await User.findById(userId);
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // Update analytics for all products
  const productIds = user.wishlist.map(item => item.product);
  
  try {
    await Product.updateMany(
      { _id: { $in: productIds } },
      { $inc: { 'analytics.addedToWishlist': -1 } }
    );
    console.log(`✅ Bulk wishlist analytics updated for ${productIds.length} products`);
  } catch (error) {
    console.warn('Failed to update product analytics during clear:', error);
  }

  // Clear wishlist
  user.wishlist = [];
  await user.save({ validateBeforeSave: false });

  // Invalidate caches
  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]);

  res.status(200).json({
    success: true,
    message: "Wishlist cleared successfully",
    wishlistCount: 0
  });
});

/* ================= CHECK IF PRODUCT IS IN WISHLIST ================= */
export const checkWishlistStatus = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId = req.user.id;

  if (!productId) {
    return next(new HandleError("Product ID is required", 400));
  }

  const user = await User.findById(userId).select('wishlist').lean();
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  const isInWishlist = user.wishlist.some(
    item => item.product.toString() === productId
  );

  res.status(200).json({
    success: true,
    isInWishlist,
    productId
  });
});

/* ================= MOVE PRODUCT TO CART (BONUS) ================= */
export const moveToCart = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId = req.user.id;

  if (!productId) {
    return next(new HandleError("Product ID is required", 400));
  }

  // Verify product exists and has stock
  const product = await Product.findById(productId);
  if (!product) {
    return next(new HandleError("Product not found", 404));
  }

  const stock = product.inventory?.stock ?? product.stock ?? 0;
  if (stock === 0) {
    return next(new HandleError("Product is out of stock", 400));
  }

  // Get user
  const user = await User.findById(userId);
  if (!user) {
    return next(new HandleError("User not found", 404));
  }

  // Check if product is in wishlist
  const itemIndex = user.wishlist.findIndex(
    item => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    return next(new HandleError("Product not in wishlist", 404));
  }

  // Remove from wishlist
  user.wishlist.splice(itemIndex, 1);
  await user.save({ validateBeforeSave: false });

  // Update product analytics
  try {
    await product.incrementWishlist(false);
    console.log(`✅ Product ${productId} wishlist analytics updated on move to cart`);
  } catch (error) {
    console.warn('Failed to update product analytics:', error);
  }

  // Invalidate caches
  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]);

  // NOTE: Actual cart addition should be handled by your cart controller
  // This endpoint just removes from wishlist and returns product info
  res.status(200).json({
    success: true,
    message: "Product removed from wishlist. Add to cart using cart endpoint.",
    product: {
      id: product._id,
      name: product.name,
      price: product.price,
      stock
    },
    wishlistCount: user.wishlist.length
  });
});