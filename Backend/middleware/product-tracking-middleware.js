import Product from "../models/product-model.js";

// FIX: All findByIdAndUpdate calls were passing `{ validateBeforeSave: false }`.
// That option only applies to `.save()`. It is SILENTLY IGNORED by findByIdAndUpdate.
// The correct option to skip validators on a findByIdAndUpdate is `runValidators: false`
// (or simply omit it, since validators don't run on updates by default anyway).
//
// FIX: trackProductView duplicated Product.incrementView() instance method.
// Middleware approach (direct $inc) is preferred over the instance method on hot paths
// because it avoids loading the full document + full validation cycle on every page view.
// DO NOT call both trackProductView middleware AND product.incrementView() on the same
// request — that will double-count views.
//
// FIX: trackProductPurchase only updates analytics.purchases. Stock deduction is
// intentionally separate (handled in order creation via Product.incrementPurchase()).
// Do not call both on the same order or purchases AND stock will double-deduct.

export const trackProductView = async (req, res, next) => {
  try {
    const productId = req.params.id || req.params.productId;
    if (!productId) return next();

    // Fire-and-forget: don't block the request
    Product.findByIdAndUpdate(
      productId,
      {
        $inc: { "analytics.views": 1 },
        $set: { "analytics.lastViewed": new Date() }
      }
      // No options needed — runValidators defaults to false for updates
    ).catch((err) => console.error("Failed to track product view:", err));

    next();
  } catch (error) {
    console.error("Product view tracking error:", error);
    next();
  }
};

export const trackAddToCart = async (req, res, next) => {
  try {
    const id = req.body?.product || req.body?.productId;
    if (!id) return next();

    Product.findByIdAndUpdate(id, {
      $inc: { "analytics.addedToCart": 1 }
    }).catch((err) => console.error("Failed to track add to cart:", err));

    next();
  } catch (error) {
    console.error("Add to cart tracking error:", error);
    next();
  }
};

export const trackAddToWishlist = async (req, res, next) => {
  try {
    // FIX: `req.body || req.params` is always req.body (truthy object even when empty).
    // Destructure each individually.
    const productId = req.body?.productId || req.params?.productId;
    if (!productId) return next();

    Product.findByIdAndUpdate(productId, {
      $inc: { "analytics.addedToWishlist": 1 }
    }).catch((err) => console.error("Failed to track add to wishlist:", err));

    next();
  } catch (error) {
    console.error("Add to wishlist tracking error:", error);
    next();
  }
};

// Called explicitly from order creation logic.
// NOTE: does NOT deduct stock — that's handled by Product.incrementPurchase()
// called separately in the order service. Don't call both on the same order.
export const trackProductPurchase = async (productId, quantity = 1) => {
  try {
    await Product.findByIdAndUpdate(productId, {
      $inc: { "analytics.purchases": quantity }
    });
  } catch (error) {
    console.error("Failed to track product purchase:", error);
  }
};

export default {
  trackProductView,
  trackAddToCart,
  trackAddToWishlist,
  trackProductPurchase
};