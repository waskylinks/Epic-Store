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

const PRODUCT_SELECT =
  'name slug price pricing images category brand ratings numOfReviews stock inventory isFeatured isNewArrival isBestseller isOnSale status';

// ── shared helper — fire-and-forget cache invalidation ────────────────────────
const invalidateWishlistCache = (userId) => {
  setImmediate(() => {
    Promise.all([
      deleteCache(`wishlist_${userId}`),
      deleteCachePattern('product_conversion*'),
      deleteCachePattern('product_performance*'),
    ]).catch(() => {});
  });
};

// ============================================
// GET USER WISHLIST
// ============================================

export const getWishlist = handleAsyncError(async (req, res, next) => {
  const userId   = req.user.id;
  const cacheKey = `wishlist_${userId}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  const user = await User.findById(userId)
    .populate({
      path:   'wishlist.product',
      select: PRODUCT_SELECT,
      match:  { status: 'published' },
    })
    .lean();

  if (!user) return next(new HandleError("User not found", 404));

  const validWishlist = user.wishlist.filter(item => item.product !== null);
  const response      = { wishlist: validWishlist, count: validWishlist.length };

  // [FIX] Fire-and-forget cache write — don't block the response on Redis
  setImmediate(() => { setCache(cacheKey, response, 300).catch(() => {}); });

  res.status(200).json({ success: true, ...response });
});

// ============================================
// ADD PRODUCT TO WISHLIST
// ============================================

export const addToWishlist = handleAsyncError(async (req, res, next) => {
  const { productId } = req.body;
  const userId        = req.user.id;

  if (!productId) return next(new HandleError("Product ID is required", 400));

  const product = await Product.findById(productId)
    .select(PRODUCT_SELECT)
    .lean();

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

  const addedAt = new Date();
  user.wishlist.push({ product: productId, addedAt });
  await user.save({ validateBeforeSave: false });

  // [FIX] Fire-and-forget: cache invalidation + analytics never block response
  invalidateWishlistCache(userId);
  setImmediate(async () => {
    try {
      const productDoc = await Product.findById(productId);
      if (productDoc) await productDoc.incrementWishlist(true);
    } catch { /* non-fatal */ }

    try {
      const { fireWishlistEvent } = await import('../Services/analytics/analyticsOrchestrator.js');
      let fullUser = req.user;
      try {
        fullUser = await User.findById(userId)
          .select('email firstName lastName phone dateOfBirth facebookId shippingAddress')
          .lean();
      } catch { /* fallback */ }
      fireWishlistEvent(product, fullUser || req.user, req).catch(() => {});
    } catch { /* non-fatal */ }
  });

  // [FIX] Stringify _id — .lean() returns ObjectId, frontend === needs string
  const wishlistItem = {
    product: { ...product, _id: product._id.toString() },
    addedAt,
  };

  res.status(200).json({
    success:       true,
    message:       "Product added to wishlist",
    wishlistItem,
    wishlistCount: user.wishlist.length,
  });
});

// ============================================
// REMOVE PRODUCT FROM WISHLIST
// ============================================

export const removeFromWishlist = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId        = req.user.id;

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

  // [FIX] Fire-and-forget: cache invalidation + analytics never block response
  invalidateWishlistCache(userId);
  setImmediate(async () => {
    try {
      const product = await Product.findById(productId);
      if (product) await product.incrementWishlist(false);
    } catch { /* non-fatal */ }
  });

  res.status(200).json({
    success:           true,
    message:           "Product removed from wishlist",
    removedProductId:  productId,
    wishlistCount:     user.wishlist.length,
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

  user.wishlist = [];
  await user.save({ validateBeforeSave: false });

  // [FIX] Fire-and-forget: cache invalidation + analytics never block response
  invalidateWishlistCache(userId);
  setImmediate(async () => {
    try {
      await Product.updateMany(
        { _id: { $in: productIds } },
        [{ $set: { 'analytics.addedToWishlist': { $max: [{ $subtract: ['$analytics.addedToWishlist', 1] }, 0] } } }]
      );
    } catch { /* non-fatal */ }
  });

  res.status(200).json({
    success:       true,
    message:       "Wishlist cleared successfully",
    wishlistCount: 0,
  });
});

// ============================================
// CHECK IF PRODUCT IS IN WISHLIST
// ============================================

export const checkWishlistStatus = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  const userId        = req.user.id;

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
  const userId        = req.user.id;

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

  // [FIX] Fire-and-forget: cache invalidation + analytics never block response
  invalidateWishlistCache(userId);
  setImmediate(async () => {
    try {
      await product.incrementWishlist(false);
    } catch { /* non-fatal */ }
  });

  res.status(200).json({
    success: true,
    message: "Product removed from wishlist. Add to cart using cart endpoint.",
    product: {
      id:    product._id,
      name:  product.name,
      price: resolveProductPrice(product),
      stock,
    },
    wishlistCount: user.wishlist.length,
  });
});