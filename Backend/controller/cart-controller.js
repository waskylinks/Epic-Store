import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from '../models/product-model.js';
import Discount from '../models/discount-model.js';
import { deleteCachePattern } from '../utils/redis.js';
import Cart from '../models/cart-model.js';

// ============================================
// SHARED PRICE RESOLUTION
// ============================================

const resolveProductPrice = (product) => {
  if (product.pricing?.sale > 0) return product.pricing.sale;
  if (product.pricing?.regular > 0) return product.pricing.regular;
  return 0;
};

// ============================================
// GET CART DETAILS
// ============================================

export const getCartDetails = handleAsyncError(async (req, res, next) => {
  const { items } = req.body ?? {};

  if (!items || items.length === 0) {
    return res.status(200).json({ success: true, cartItems: [] });
  }

  const cartItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product || product.status !== 'published') continue;

    const currentPrice   = resolveProductPrice(product);
    const availableStock = product.inventory?.stock ?? product.stock ?? 0;

    cartItems.push({
      product:  product._id,
      name:     product.name,
      category: product.category,
      price:    currentPrice,
      stock:    availableStock,
      image:    product.images?.[0]?.url || product.image?.[0]?.url,
      quantity: Math.min(item.quantity, availableStock)
    });
  }

  return res.status(200).json({ success: true, cartItems });
});

// ============================================
// ADD TO CART  (FIXED — now persists to DB)
// ============================================

export const addToCart = handleAsyncError(async (req, res, next) => {
  const { product: productId, quantity = 1 } = req.body;

  if (!productId) return next(new HandleError('Product ID is required', 400));

  const product = await Product.findById(productId);
  if (!product)                       return next(new HandleError('Product not found', 404));
  if (product.status !== 'published') return next(new HandleError('Product is not available', 400));

  const availableStock = product.inventory?.stock ?? product.stock ?? 0;
  if (availableStock < quantity) {
    return next(new HandleError(`Only ${availableStock} items available in stock`, 400));
  }

  const currentPrice = resolveProductPrice(product);
  if (currentPrice === 0) return next(new HandleError('Product has no valid price', 500));

  // ── Persist to DB ──────────────────────────────────────────────────────
  const cart = await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id } },
    { upsert: true, new: true }
  );

  const existingItem = cart.cartItems.find(
    i => String(i.product) === String(productId)
  );

  if (existingItem) {
    existingItem.quantity = Math.min(existingItem.quantity + quantity, availableStock);
  } else {
    // ── Check limit BEFORE pushing, not after ──────────────────────────
    if (cart.cartItems.length >= 100) {
      return next(new HandleError('Cart limit reached (100 items)', 400));
    }
    cart.cartItems.push({ product: productId, quantity });
  }

  await cart.save();
  // ──────────────────────────────────────────────────────────────────────

  try { await product.incrementCart(true); } catch { /* analytics non-fatal */ }
  Promise.all([
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  return res.status(200).json({
    success: true,
    message: 'Item added to cart',
    item: {
      product:  product._id,
      name:     product.name,
      price:    currentPrice,
      quantity,
      image:    product.images?.[0]?.url || product.image?.[0]?.url,
      stock:    availableStock
    }
  });
});

// ============================================
// GET CART  (required by syncServerCart)
// GET /api/v1/cart  — auth required
// ============================================

export const getUserCart = handleAsyncError(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id }).lean();
  return res.status(200).json({
    success:   true,
    cartItems: cart?.cartItems ?? []
  });
});

// ============================================
// UPDATE CART ITEM  (FIXED — now persists to DB)
// ============================================

export const updateCartItem = handleAsyncError(async (req, res, next) => {
  const { product: productId, quantity } = req.body;

  if (!productId || !quantity) {
    return next(new HandleError('Product ID and quantity are required', 400));
  }
  if (quantity < 1) return next(new HandleError('Quantity must be at least 1', 400));

  const product = await Product.findById(productId);
  if (!product) return next(new HandleError('Product not found', 404));

  const availableStock = product.inventory?.stock ?? product.stock ?? 0;
  if (availableStock < quantity) {
    return next(new HandleError(`Only ${availableStock} items available in stock`, 400));
  }

  const finalQuantity = Math.min(quantity, availableStock);

  // ── Persist to DB ─────────────────────────────────────────────────────────
  if (req.user?._id) {
    await Cart.findOneAndUpdate(
      { user: req.user._id, 'cartItems.product': productId },
      { $set: { 'cartItems.$.quantity': finalQuantity } }
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    message: 'Cart updated',
    item:    { product: product._id, quantity: finalQuantity }
  });
});

// ============================================
// REMOVE FROM CART  (FIXED — now persists to DB)
// ============================================

export const removeFromCart = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  if (!productId) return next(new HandleError('Product ID is required', 400));

  // ── Persist to DB ─────────────────────────────────────────────────────────
  if (req.user?._id) {
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $pull: { cartItems: { product: productId } } }
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const product = await Product.findById(productId);
    if (product) await product.incrementCart(false);
  } catch { /* analytics non-fatal */ }

  deleteCachePattern('product_conversion*').catch(() => {});

  return res.status(200).json({ success: true, message: 'Item removed from cart', productId });
});

// ============================================
// CLEAR CART  (FIXED — now persists to DB)
// ============================================

export const clearCart = handleAsyncError(async (req, res, next) => {
  const { items } = req.body ?? {};

  // ── Persist to DB ─────────────────────────────────────────────────────────
  if (req.user?._id) {
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $set: { cartItems: [] } },
      { upsert: true }
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (items && items.length > 0) {
    try {
      for (const item of items) {
        await Product.findByIdAndUpdate(item.product, [
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
        ]);
      }
    } catch { /* analytics non-fatal */ }
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
  const validItems   = [];
  const invalidItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product) {
      invalidItems.push({
        productId:         item.product,
        reason:            'Product not found',
        requestedQuantity: item.quantity
      });
      continue;
    }

    if (product.status !== 'published') {
      invalidItems.push({
        productId:         product._id,
        name:              product.name,
        reason:            'Product unavailable',
        requestedQuantity: item.quantity
      });
      continue;
    }

    const availableStock = product.inventory?.stock || product.stock || 0;
    if (availableStock < item.quantity) {
      invalidItems.push({
        productId:         product._id,
        name:              product.name,
        reason:            'Insufficient stock',
        requestedQuantity: item.quantity,
        availableQuantity: availableStock
      });
      continue;
    }

    const price = resolveProductPrice(product);
    if (price === 0) {
      return next(new HandleError(`Product "${product.name}" has no valid price`, 500));
    }

    const itemTotal = price * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product:   product._id,
      name:      product.name,
      quantity:  item.quantity,
      price,
      itemTotal
    });
  }

  if (invalidItems.length > 0) {
    return res.status(400).json({
      success:      false,
      isValid:      false,
      invalidItems,
      message:      `${invalidItems.length} item(s) are no longer available`
    });
  }

  const taxPrice      = Math.round(itemPrice * 0.18 * 100) / 100;
  const shippingPrice = itemPrice >= 500 ? 0 : 50;
  const totalPrice    = Math.round((itemPrice + taxPrice + shippingPrice) * 100) / 100;

  return res.status(200).json({
    success: true,
    isValid: true,
    pricing: {
      itemPrice:    Math.round(itemPrice * 100) / 100,
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
  if (!items || items.length === 0)
    return next(new HandleError('Cart is empty', 400));

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError('Invalid or expired discount code', 400));

  const userId = req.user?._id;
  if (discount.audience === 'specific' && !userId) {
    return next(
      new HandleError('You must be logged in to use this discount code', 401)
    );
  }

  let itemPrice = 0;
  const validItems   = [];
  const invalidItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product) {
      invalidItems.push({ productId: item.product, reason: 'Product not found' });
      continue;
    }
    if (product.status !== 'published') {
      invalidItems.push({
        productId: product._id,
        name:      product.name,
        reason:    'Product unavailable',
      });
      continue;
    }

    const price = resolveProductPrice(product);

    if (price === 0) {
      invalidItems.push({
        productId: product._id,
        name:      product.name,
        reason:    'Product has no valid price',
      });
      continue;
    }

    const itemTotal = price * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product:  product._id,
      name:     product.name,
      category: product.category,
      quantity: item.quantity,
      price,
      itemTotal,
    });
  }

  if (invalidItems.length > 0) {
    return res.status(400).json({
      success:      false,
      message:      'Cart contains unavailable items. Please refresh your cart before applying a discount.',
      invalidItems,
    });
  }


  const canUse = await discount.canUserUse(userId ?? null);
  if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));

  const validation = discount.validateCart(itemPrice, validItems, userId);
  if (!validation.valid)
    return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(itemPrice, validItems);

  const balanceAfterThisUse =
    discount.type === 'fixed' && discount.remainingBalance !== null
      ? Math.max(0, discount.remainingBalance - discountAmount)
      : null;

  const eligibleCats = discount.conditions?.eligibleProductCategories ?? [];

  const eligibleSubtotal = eligibleCats.length > 0
    ? Math.round(
        validItems
          .filter((item) => item.category && eligibleCats.includes(item.category))
          .reduce((sum, item) => sum + item.itemTotal, 0)
        * 100
      ) / 100
    : Math.round(itemPrice * 100) / 100;

  const ineligibleSubtotal    = Math.round((itemPrice - eligibleSubtotal) * 100) / 100;
  const originalItemPrice     = Math.round(itemPrice * 100) / 100;
  const discountedItemPrice   = Math.max(0, itemPrice - discountAmount);
  const taxPrice              = Math.round(discountedItemPrice * 0.18 * 100) / 100;
  const shippingPrice         = discountedItemPrice >= 500 ? 0 : 50;
  const totalPrice            = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

  return res.status(200).json({
    success:        true,
    appliedPending: true,
    discount: {
      id:             discount._id.toString(),
      code:           discount.code,
      type:           discount.type,
      value:          discount.value,
      description:    discount.description,
      discountAmount: Math.round(discountAmount * 100) / 100,
      eligibleProductCategories: eligibleCats,
      eligibleSubtotal,
      ineligibleSubtotal,
      remainingBalance: discount.remainingBalance ?? null,
      balanceAfterUse:  balanceAfterThisUse,
      isPartialAllowed: discount.isPartialAllowed ?? true,
      originalItemPrice,
    },
    pricing: {
      itemPrice:           originalItemPrice,
      discountAmount:      Math.round(discountAmount * 100) / 100,
      discountedItemPrice: Math.round(discountedItemPrice * 100) / 100,
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: 'USD',
    },
    items: validItems,
  });
});