import handleAsyncError from "../middleware/handleAsyncError.js";
import User from "../models/userModel.js";
import Product from "../models/product-model.js";
import HandleError from "../utils/handleError.js";
import { getCache, setCache, deleteCache, deleteCachePattern } from "../utils/redis.js";

const resolveProductPrice = (product) => {
  if (product.pricing?.sale > 0) return product.pricing.sale;
  if (product.pricing?.regular > 0) return product.pricing.regular;
  return 0;
};

// ============================================
// GET USER WISHLIST
// ============================================

export const getWishlist = handleAsyncError(async (req, res, next) => {
  const userId = req.user.id;
  const cacheKey = `wishlist_${userId}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const user = await User.findById(userId)
    .populate({
      path: 'wishlist.product',
      select: 'name slug price pricing images category brand ratings numOfReviews stock inventory isFeatured isNewArrival isBestseller isOnSale status',
      match: { status: 'published' }
    })
    .lean();

  if (!user) return next(new HandleError("User not found", 404));

  const validWishlist = user.wishlist.filter(item => item.product !== null);
  const response = { wishlist: validWishlist, count: validWishlist.length };

  await setCache(cacheKey, response, 300);

  res.status(200).json({ success: true, ...response });
});

// ============================================
// ADD PRODUCT TO WISHLIST
// ============================================

export const addToWishlist = handleAsyncError(async (req, res, next) => {
  const { productId } = req.body;
  const userId = req.user.id;

  if (!productId) return next(new HandleError("Product ID is required", 400));

  const product = await Product.findById(productId);
  if (!product) return next(new HandleError("Product not found", 404));

  if (product.status !== 'published') {
    return next(new HandleError("This product is not available", 400));
  }

  const user = await User.findById(userId);
  if (!user) return next(new HandleError("User not found", 404));

  const alreadyInWishlist = user.wishlist.some(
    item => item.product.toString() === productId
  );

  if (alreadyInWishlist) {
    return next(new HandleError("Product already in wishlist", 400));
  }

  user.wishlist.push({ product: productId, addedAt: new Date() });
  await user.save({ validateBeforeSave: false });

  try {
    await product.incrementWishlist(true);
  } catch {
    // Analytics failure must not abort the wishlist operation
  }

  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  (async () => {
    try {
      const { fireWishlistEvent } = await import('../Services/analytics/analyticsOrchestrator.js');

      // Fetch full user document for maximum EMQ on Meta CAPI.
      // Falls back to req.user (lower EMQ) if the query fails.
      let fullUser = req.user;
      try {
        fullUser = await User.findById(userId)
          .select('email firstName lastName phone dateOfBirth facebookId shippingAddress')
          .lean();
      } catch (userFetchErr) {
        console.warn('[Wishlist Analytics] fullUser fetch failed (non-fatal), falling back to req.user:', userFetchErr.message);
      }

      fireWishlistEvent(product, fullUser || req.user, req).catch(err =>
        console.error('[Analytics] fireWishlistEvent failed (non-fatal):', err.message)
      );
    } catch (err) {
      console.error('[Wishlist Analytics] Import or dispatch failed (non-fatal):', err.message);
    }
  })();

  res.status(200).json({
    success: true,
    message: "Product added to wishlist",
    wishlistCount: user.wishlist.length
  });
});

// ============================================
// REMOVE PRODUCT FROM WISHLIST
// ============================================

export const removeFromWishlist = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId = req.user.id;

  if (!productId) return next(new HandleError("Product ID is required", 400));

  const user = await User.findById(userId);
  if (!user) return next(new HandleError("User not found", 404));

  const itemIndex = user.wishlist.findIndex(
    item => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    return next(new HandleError("Product not in wishlist", 404));
  }

  user.wishlist.splice(itemIndex, 1);
  await user.save({ validateBeforeSave: false });

  try {
    const product = await Product.findById(productId);
    if (product) await product.incrementWishlist(false);
  } catch {
    // Analytics failure must not abort the wishlist operation
  }

  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  res.status(200).json({
    success: true,
    message: "Product removed from wishlist",
    wishlistCount: user.wishlist.length
  });
});

// ============================================
// CLEAR ENTIRE WISHLIST
// ============================================

export const clearWishlist = handleAsyncError(async (req, res, next) => {
  const userId = req.user.id;

  const user = await User.findById(userId);
  if (!user) return next(new HandleError("User not found", 404));

  const productIds = user.wishlist.map(item => item.product);

  try {
    await Product.updateMany(
      { _id: { $in: productIds } },
      [
        {
          $set: {
            'analytics.addedToWishlist': {
              $max: [{ $subtract: ['$analytics.addedToWishlist', 1] }, 0]
            }
          }
        }
      ]
    );
  } catch {
    // Analytics failure must not abort the clear operation
  }

  user.wishlist = [];
  await user.save({ validateBeforeSave: false });

  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  res.status(200).json({
    success: true,
    message: "Wishlist cleared successfully",
    wishlistCount: 0
  });
});

// ============================================
// CHECK IF PRODUCT IS IN WISHLIST
// ============================================

export const checkWishlistStatus = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId = req.user.id;

  if (!productId) return next(new HandleError("Product ID is required", 400));

  const user = await User.findById(userId).select('wishlist').lean();
  if (!user) return next(new HandleError("User not found", 404));

  const isInWishlist = user.wishlist.some(
    item => item.product.toString() === productId
  );

  res.status(200).json({ success: true, isInWishlist, productId });
});

// ============================================
// MOVE PRODUCT TO CART
// ============================================

export const moveToCart = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId = req.user.id;

  if (!productId) return next(new HandleError("Product ID is required", 400));

  const product = await Product.findById(productId);
  if (!product) return next(new HandleError("Product not found", 404));

  const stock = product.inventory?.stock ?? product.stock ?? 0;
  if (stock === 0) return next(new HandleError("Product is out of stock", 400));

  const user = await User.findById(userId);
  if (!user) return next(new HandleError("User not found", 404));

  const itemIndex = user.wishlist.findIndex(
    item => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    return next(new HandleError("Product not in wishlist", 404));
  }

  user.wishlist.splice(itemIndex, 1);
  await user.save({ validateBeforeSave: false });

  try {
    await product.incrementWishlist(false);
  } catch {
    // Analytics failure must not abort the move operation
  }

  await Promise.all([
    deleteCache(`wishlist_${userId}`),
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  res.status(200).json({
    success: true,
    message: "Product removed from wishlist. Add to cart using cart endpoint.",
    product: {
      id:    product._id,
      name:  product.name,
      price: resolveProductPrice(product),
      stock
    },
    wishlistCount: user.wishlist.length
  });
});