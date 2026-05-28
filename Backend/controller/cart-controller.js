import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from '../models/product-model.js';
import Discount from '../models/discount-model.js';
import { deleteCachePattern } from '../utils/redis.js';
import Cart from '../models/cart-model.js';
import { sendGA4AddToCart } from '../Services/analytics/ga4Service.js';
import { sendMetaAddToCart } from '../Services/analytics/metaCapiService.js';
import mongoose from 'mongoose';

// ============================================
// SHARED PRICE RESOLUTION
// ============================================

const resolveProductPrice = (product) => {
  if (product.pricing?.sale > 0) return product.pricing.sale;
  if (product.pricing?.regular > 0) return product.pricing.regular;
  return 0;
};

// ============================================
// SHARED HELPERS
// ============================================

/**
 * Validates that a value is a valid MongoDB ObjectId string.
 * Prevents CastErrors from propagating to the DB layer.
 */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Fetches products by an array of IDs in a single query and returns a
 * Map keyed by string ID for O(1) lookup. Replaces N+1 findById patterns.
 */
const fetchProductMap = async (productIds) => {
  const validIds = productIds.filter(isValidObjectId);
  if (validIds.length === 0) return new Map();
  const products = await Product.find({ _id: { $in: validIds } });
  return new Map(products.map(p => [p._id.toString(), p]));
};

// ============================================
// GET CART DETAILS
// ============================================

export const getCartDetails = handleAsyncError(async (req, res, next) => {
  const { items } = req.body ?? {};

  if (!items || items.length === 0) {
    return res.status(200).json({ success: true, cartItems: [] });
  }

  // Validate item structure before hitting the DB — prevents CastErrors
  // from malformed product IDs propagating to findById.
  for (const item of items) {
    if (!item.product || !isValidObjectId(item.product)) {
      return next(new HandleError(`Invalid product ID: ${item.product}`, 400));
    }
  }

  // Single batched query replaces N+1 sequential findById calls.
  const productIds = items.map(i => i.product);
  const productMap = await fetchProductMap(productIds);

  const cartItems = [];

  for (const item of items) {
    const product = productMap.get(item.product.toString());

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
// ADD TO CART
// ============================================

export const addToCart = handleAsyncError(async (req, res, next) => {
  const { product: productId, quantity = 1 } = req.body;

  if (!productId) return next(new HandleError('Product ID is required', 400));

  // Validate ObjectId format before DB call to avoid an unhandled CastError.
  if (!isValidObjectId(productId)) {
    return next(new HandleError('Invalid product ID format', 400));
  }

  // Validate quantity: must be a positive integer.
  // A float like 0.5 would pass stock comparison checks and be stored otherwise.
  const parsedQuantity = Number(quantity);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
    return next(new HandleError('Quantity must be a positive integer', 400));
  }

  const product = await Product.findById(productId);
  if (!product)                       return next(new HandleError('Product not found', 404));
  if (product.status !== 'published') return next(new HandleError('Product is not available', 400));

  const availableStock = product.inventory?.stock ?? product.stock ?? 0;
  if (availableStock < parsedQuantity) {
    return next(new HandleError(`Only ${availableStock} items available in stock`, 400));
  }

  const currentPrice = resolveProductPrice(product);
  if (currentPrice === 0) return next(new HandleError('Product has no valid price', 500));

  const cart = await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id } },
    { upsert: true, new: true }
  );

  const existingItem = cart.cartItems.find(
    i => String(i.product) === String(productId)
  );

  if (existingItem) {
    existingItem.quantity = Math.min(existingItem.quantity + parsedQuantity, availableStock);
  } else {
    if (cart.cartItems.length >= 100) {
      return next(new HandleError('Cart limit reached (100 items)', 400));
    }
    cart.cartItems.push({ product: productId, quantity: parsedQuantity });
  }

  await cart.save();

  try { await product.incrementCart(true); } catch { /* non-fatal */ }
  Promise.all([
    deleteCachePattern('product_conversion*'),
    deleteCachePattern('product_performance*')
  ]).catch(() => {});

  const analyticsContext = {
    clientId:       req.body?.ga4ClientId || req.sessionId || null,
    userId:         req.user?._id?.toString(),
    sessionId:      req.sessionId         || null,
    eventId:        req.body?.analyticsEventId || null,
    eventSourceUrl: req.headers?.referer  || process.env.FRONTEND_URL,
    clientIp:       req.ip,
    userAgent:      req.headers?.['user-agent'],
    fbp:            req.body?.fbp || req.cookies?._fbp || null,
    fbc:            req.body?.fbc || req.cookies?._fbc || null,
    attribution:    req.attribution       || null,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[Cart Analytics] Cookie signals:', {
      fbp: req.cookies?._fbp,
      fbc: req.cookies?._fbc,
    });
  }

  sendGA4AddToCart(product, parsedQuantity, analyticsContext).catch(err =>
    console.error('[Analytics] GA4 add_to_cart failed (non-fatal):', err.message)
  );

  sendMetaAddToCart(product, parsedQuantity, req.user, analyticsContext).catch(err =>
    console.error('[Analytics] Meta add_to_cart failed (non-fatal):', err.message)
  );

  return res.status(200).json({
    success: true,
    message: 'Item added to cart',
    item: {
      product:  product._id,
      name:     product.name,
      price:    currentPrice,
      quantity: parsedQuantity,
      image:    product.images?.[0]?.url || product.image?.[0]?.url,
      stock:    availableStock
    }
  });
});

// ============================================
// GET CART
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
// UPDATE CART ITEM
// ============================================

export const updateCartItem = handleAsyncError(async (req, res, next) => {
  const { product: productId, quantity } = req.body;

  if (!productId || !quantity) {
    return next(new HandleError('Product ID and quantity are required', 400));
  }
  if (!isValidObjectId(productId)) {
    return next(new HandleError('Invalid product ID format', 400));
  }
  if (quantity < 1) return next(new HandleError('Quantity must be at least 1', 400));

  const product = await Product.findById(productId);
  if (!product) return next(new HandleError('Product not found', 404));

  const availableStock = product.inventory?.stock ?? product.stock ?? 0;
  if (availableStock < quantity) {
    return next(new HandleError(`Only ${availableStock} items available in stock`, 400));
  }

  const finalQuantity = Math.min(quantity, availableStock);

  if (req.user?._id) {
    await Cart.findOneAndUpdate(
      { user: req.user._id, 'cartItems.product': productId },
      { $set: { 'cartItems.$.quantity': finalQuantity } }
    );
  }

  // Return the full updated cart so the client can reconcile totals
  // without a follow-up GET request.
  const updatedCart = await Cart.findOne({ user: req.user._id }).lean();

  return res.status(200).json({
    success:   true,
    message:   'Cart updated',
    item:      { product: product._id, quantity: finalQuantity },
    cartItems: updatedCart?.cartItems ?? []
  });
});

// ============================================
// REMOVE FROM CART
// ============================================

export const removeFromCart = handleAsyncError(async (req, res, next) => {
  const { productId } = req.params;
  if (!productId) return next(new HandleError('Product ID is required', 400));

  if (!isValidObjectId(productId)) {
    return next(new HandleError('Invalid product ID format', 400));
  }

  if (req.user?._id) {
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $pull: { cartItems: { product: productId } } }
    );
  }

  // Fire-and-forget: if product was deleted between add and remove the
  // error is swallowed intentionally. The analytics count will drift in
  // that case — acceptable vs. blocking the remove response.
  try {
    const product = await Product.findById(productId);
    if (product) await product.incrementCart(false);
  } catch { /* non-fatal */ }

  deleteCachePattern('product_conversion*').catch(() => {});

  return res.status(200).json({ success: true, message: 'Item removed from cart', productId });
});

// ============================================
// CLEAR CART
// ============================================

export const clearCart = handleAsyncError(async (req, res, next) => {
  const { items } = req.body ?? {};

  if (req.user?._id) {
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $set: { cartItems: [] } },
      { upsert: true }
    );
  }

  if (items && items.length > 0) {
    try {
      // Batched bulkWrite replaces N+1 sequential per-item awaited updates.
      // All decrements are sent in a single round-trip; MongoDB applies them
      // atomically per-document. A mid-batch failure will still leave some
      // documents partially decremented — acceptable for a non-critical
      // analytics counter where no rollback strategy exists.
      const bulkOps = items
        .filter(item => item.product && isValidObjectId(item.product))
        .map(item => ({
          updateOne: {
            filter: { _id: item.product },
            update: [
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
          }
        }));

      if (bulkOps.length > 0) {
        await Product.bulkWrite(bulkOps, { ordered: false });
      }
    } catch { /* non-fatal */ }

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

  // Validate ObjectId format on all items before hitting the DB.
  for (const item of items) {
    if (!item.product || !isValidObjectId(item.product)) {
      return next(new HandleError(`Invalid product ID: ${item.product}`, 400));
    }
  }

  // Single batched query replaces N+1 sequential findById calls.
  const productIds = items.map(i => i.product);
  const productMap = await fetchProductMap(productIds);

  let itemPrice = 0;
  const validItems   = [];
  const invalidItems = [];

  for (const item of items) {
    const product = productMap.get(item.product.toString());

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

  // Validate ObjectId format on all items before hitting the DB.
  for (const item of items) {
    if (!item.product || !isValidObjectId(item.product)) {
      return next(new HandleError(`Invalid product ID: ${item.product}`, 400));
    }
  }

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError('Invalid or expired discount code', 400));

  const userId = req.user?._id;
  if (discount.audience === 'specific' && !userId) {
    return next(
      new HandleError('You must be logged in to use this discount code', 401)
    );
  }

  // Single batched query replaces N+1 sequential findById calls.
  const productIds = items.map(i => i.product);
  const productMap = await fetchProductMap(productIds);

  let itemPrice = 0;
  const validItems   = [];
  const invalidItems = [];

  for (const item of items) {
    const product = productMap.get(item.product.toString());

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

  // Coerce userId to a mongoose ObjectId string for consistent comparison
  // inside canUserUse — req.user._id may be an ObjectId or string depending
  // on auth middleware, and the Discount model likely compares with .toString().
  const normalizedUserId = userId ? new mongoose.Types.ObjectId(userId.toString()) : null;

  const canUse = await discount.canUserUse(normalizedUserId);
  if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));

  const validation = discount.validateCart(itemPrice, validItems, normalizedUserId);
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