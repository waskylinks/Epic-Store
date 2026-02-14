import Product from "../models/product-model.js";

// All trackProductView calls handle analytics.views increment via direct $inc.
// This middleware approach (direct $inc on hot path) is preferred over
// Product.incrementView() instance method because it avoids loading the full
// document + full validation cycle on every page view.
//
// DO NOT call both trackProductView middleware AND product.incrementView() on
// the same request — that will double-count views.
//
// trackProductPurchase only updates analytics.purchases. Stock deduction is
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
    // FIX PTM2: Destructure each source individually instead of using falsy check
    // `req.body || req.params` is always truthy (always returns req.body object)
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