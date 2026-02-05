import Product from "../models/product-model.js";

/**
 * Middleware to track product views
 * Add this to your product detail routes
 */
export const trackProductView = async (req, res, next) => {
  try {
    const productId = req.params.id || req.params.productId;
    
    if (!productId) {
      return next();
    }

    // Increment view count asynchronously (don't block the request)
    Product.findByIdAndUpdate(
      productId,
      {
        $inc: { 'analytics.views': 1 },
        $set: { 'analytics.lastViewed': new Date() }
      },
      { validateBeforeSave: false }
    ).catch(err => {
      console.error('Failed to track product view:', err);
      // Don't fail the request if tracking fails
    });

    next();
  } catch (error) {
    console.error('Product view tracking error:', error);
    next();
  }
};

/**
 * Middleware to track add to cart events
 * Add this to your cart add routes
 */
export const trackAddToCart = async (req, res, next) => {
  try {
    const { product, productId } = req.body;
    const id = product || productId;

    if (!id) {
      return next();
    }

    // Increment cart add count asynchronously
    Product.findByIdAndUpdate(
      id,
      { $inc: { 'analytics.addedToCart': 1 } },
      { validateBeforeSave: false }
    ).catch(err => {
      console.error('Failed to track add to cart:', err);
    });

    next();
  } catch (error) {
    console.error('Add to cart tracking error:', error);
    next();
  }
};

/**
 * Middleware to track add to wishlist events
 * Add this to your wishlist add routes
 */
export const trackAddToWishlist = async (req, res, next) => {
  try {
    const { productId } = req.body || req.params;

    if (!productId) {
      return next();
    }

    // Increment wishlist add count asynchronously
    Product.findByIdAndUpdate(
      productId,
      { $inc: { 'analytics.addedToWishlist': 1 } },
      { validateBeforeSave: false }
    ).catch(err => {
      console.error('Failed to track add to wishlist:', err);
    });

    next();
  } catch (error) {
    console.error('Add to wishlist tracking error:', error);
    next();
  }
};

/**
 * Track product purchase
 * This should be called from order creation logic
 */
export const trackProductPurchase = async (productId, quantity = 1) => {
  try {
    await Product.findByIdAndUpdate(
      productId,
      { $inc: { 'analytics.purchases': quantity } },
      { validateBeforeSave: false }
    );
  } catch (error) {
    console.error('Failed to track product purchase:', error);
  }
};

export default {
  trackProductView,
  trackAddToCart,
  trackAddToWishlist,
  trackProductPurchase
};