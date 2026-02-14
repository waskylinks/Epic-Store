import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from '../models/product-model.js';
import Discount from '../models/discount-model.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// SHARED PRICE RESOLUTION
// ============================================

// FIX CC1: Centralised price resolution so the product.price dead field is
// removed in exactly one place. Product model schema has pricing.sale and
// pricing.regular; there is no top-level product.price field — it is always
// undefined. The old fallback chain leaked undefined into arithmetic, silently
// returning NaN totals or triggering the "no valid price" 500 error for
// products that do have a valid pricing.regular value.
const resolveProductPrice = (product) => {
  if (product.pricing?.sale > 0) return product.pricing.sale;
  if (product.pricing?.regular > 0) return product.pricing.regular;
  return 0;
};

// ============================================
// GET CART DETAILS
// ============================================

export const getCartDetails = handleAsyncError(async (req, res, next) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(200).json({ success: true, cartItems: [] });
  }

  const cartItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product || product.status !== 'published') continue;

    const currentPrice = resolveProductPrice(product);
    const availableStock = product.inventory?.stock ?? product.stock ?? 0;

    cartItems.push({
      product: product._id,
      name: product.name,
      price: currentPrice,
      stock: availableStock,
      image: product.images?.[0]?.url || product.image?.[0]?.url,
      quantity: Math.min(item.quantity, availableStock)
    });
  }

  return res.status(200).json({ success: true, cartItems });
});

// ============================================
// ADD TO CART
// ============================================

export const addToCart = handleAsyncError(async (req, res, next) => {
  const { product: productId, quantity = 1 } = req.body;

  if (!productId) return next(new HandleError('Product ID is required', 400));

  const product = await Product.findById(productId);

  if (!product) return next(new HandleError('Product not found', 404));

  if (product.status !== 'published') {
    return next(new HandleError('Product is not available', 400));
  }

  const availableStock = product.inventory?.stock ?? product.stock ?? 0;
  if (availableStock < quantity) {
    return next(new HandleError(`Only ${availableStock} items available in stock`, 400));
  }

  const currentPrice = resolveProductPrice(product);
  if (currentPrice === 0) {
    return next(new HandleError('Product has no valid price', 500));
  }

  try {
    await product.incrementCart(true);
  } catch {
    // Analytics failure must not abort the cart operation
  }

  // Invalidate product analytics caches (fire-and-forget)
  Promise.all([
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  return res.status(200).json({
    success: true,
    message: 'Item added to cart',
    item: {
      product: product._id,
      name: product.name,
      price: currentPrice,
      quantity,
      image: product.images?.[0]?.url || product.image?.[0]?.url,
      stock: availableStock
    }
  });
});

// ============================================
// UPDATE CART ITEM
// ============================================

export const updateCartItem = handleAsyncError(async (req, res, next) => {
  const { product: productId, quantity } = req.body;

  if (!productId || !quantity) {
    return next(new HandleError('Product ID and quantity are required', 400));
  }

  if (quantity < 1) {
    return next(new HandleError('Quantity must be at least 1', 400));
  }

  const product = await Product.findById(productId);
  if (!product) return next(new HandleError('Product not found', 404));

  const availableStock = product.inventory?.stock ?? product.stock ?? 0;
  if (availableStock < quantity) {
    return next(new HandleError(`Only ${availableStock} items available in stock`, 400));
  }

  return res.status(200).json({
    success: true,
    message: 'Cart updated',
    item: {
      product: product._id,
      quantity: Math.min(quantity, availableStock)
    }
  });
});

// ============================================
// REMOVE FROM CART
// ============================================

export const removeFromCart = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;

  if (!productId) return next(new HandleError('Product ID is required', 400));

  try {
    const product = await Product.findById(productId);
    if (product) {
      await product.incrementCart(false);
    }
  } catch {
    // Analytics failure must not abort the remove operation
  }

  deleteCachePattern('product_conversion*').catch(() => {});

  return res.status(200).json({
    success: true,
    message: 'Item removed from cart',
    productId
  });
});

// ============================================
// CLEAR CART
// ============================================

export const clearCart = handleAsyncError(async (req, res, next) => {
  const { items } = req.body;

  if (items && items.length > 0) {
    try {
      // FIX CC2: Original code did updateMany with $inc: -1 regardless of item
      // quantity, which (a) decremented by 1 even when 5 units were added, and
      // (b) had no floor — repeated clears pushed the counter below zero.
      // Fix: decrement per item by its actual quantity, clamped at 0.
      for (const item of items) {
        await Product.findByIdAndUpdate(
          item.product,
          [
            {
              $set: {
                'analytics.addedToCart': {
                  $max: [
                    { $subtract: ['$analytics.addedToCart', item.quantity || 1] },
                    0
                  ]
                }
              }
            }
          ]
        );
      }
    } catch {
      // Analytics failure must not abort the clear operation
    }

    deleteCachePattern('product_conversion*').catch(() => {});
  }

  return res.status(200).json({ success: true, message: 'Cart cleared' });
});

// ============================================
// VALIDATE CHECKOUT
// ============================================

export const validateCheckout = handleAsyncError(async (req, res, next) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return next(new HandleError('Cart is empty', 400));
  }

  let itemPrice = 0;
  const validItems = [];
  const invalidItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product) {
      invalidItems.push({
        productId: item.product,
        reason: 'Product not found',
        requestedQuantity: item.quantity
      });
      continue;
    }

    if (product.status !== 'published') {
      invalidItems.push({
        productId: product._id,
        name: product.name,
        reason: 'Product unavailable',
        requestedQuantity: item.quantity
      });
      continue;
    }

    const availableStock = product.inventory?.stock || product.stock || 0;
    if (availableStock < item.quantity) {
      invalidItems.push({
        productId: product._id,
        name: product.name,
        reason: 'Insufficient stock',
        requestedQuantity: item.quantity,
        availableQuantity: availableStock
      });
      continue;
    }

    const unitPrice = resolveProductPrice(product);
    if (unitPrice === 0) {
      return next(new HandleError(`Product "${product.name}" has no valid price`, 500));
    }

    const itemTotal = unitPrice * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product: product._id,
      name: product.name,
      quantity: item.quantity,
      unitPrice,
      itemTotal
    });
  }

  if (invalidItems.length > 0) {
    return res.status(400).json({
      success: false,
      isValid: false,
      invalidItems,
      message: `${invalidItems.length} item(s) are no longer available`
    });
  }

  const taxPrice = Math.round(itemPrice * 0.18 * 100) / 100;
  const shippingPrice = itemPrice >= 500 ? 0 : 50;
  const totalPrice = Math.round((itemPrice + taxPrice + shippingPrice) * 100) / 100;

  return res.status(200).json({
    success: true,
    isValid: true,
    pricing: {
      itemPrice: Math.round(itemPrice * 100) / 100,
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: 'USD'
    },
    items: validItems
  });
});

// ============================================
// APPLY DISCOUNT CODE
// ============================================

export const applyDiscountCode = handleAsyncError(async (req, res, next) => {
  const { code, items } = req.body;

  if (!code) return next(new HandleError('Discount code is required', 400));
  if (!items || items.length === 0) return next(new HandleError('Cart is empty', 400));

  const discount = await Discount.findActiveByCode(code);
  if (!discount) return next(new HandleError('Invalid or expired discount code', 400));

  let itemPrice = 0;
  const validItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product || product.status !== 'published') continue;

    // FIX CC1 (applyDiscountCode): Same dead product.price field removed here.
    const unitPrice = resolveProductPrice(product);
    const itemTotal = unitPrice * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product: product._id,
      name: product.name,
      quantity: item.quantity,
      unitPrice,
      itemTotal
    });
  }

  const userId = req.user?._id;
  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));
  }

  const validation = discount.validateCart(itemPrice, validItems, userId);
  if (!validation.valid) return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(itemPrice, validItems);

  const discountedItemPrice = Math.max(0, itemPrice - discountAmount);
  const taxPrice = Math.round(discountedItemPrice * 0.18 * 100) / 100;
  const shippingPrice = discountedItemPrice >= 500 ? 0 : 50;
  const totalPrice = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

  return res.status(200).json({
    success: true,
    discount: {
      code: discount.code,
      type: discount.type,
      value: discount.value,
      description: discount.description,
      discountAmount: Math.round(discountAmount * 100) / 100
    },
    pricing: {
      itemPrice: Math.round(itemPrice * 100) / 100,
      discountAmount: Math.round(discountAmount * 100) / 100,
      discountedItemPrice: Math.round(discountedItemPrice * 100) / 100,
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: 'USD'
    },
    items: validItems
  });
});