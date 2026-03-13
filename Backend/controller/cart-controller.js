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
  // FIX GCD-1: Guard against missing body (e.g. middleware not applied,
  // or caller sends a body-less request). Destructure from req.body ?? {}
  // so items defaults to undefined rather than throwing a TypeError.
  const { items } = req.body ?? {};

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
      category: product.category, 
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
  // FIX CC3: DELETE requests do not guarantee a body — many HTTP clients,
  // proxies, and the Express body-parser itself may leave req.body as
  // undefined when no Content-Type / body is sent. Destructuring directly
  // from undefined throws:
  //   TypeError: Cannot destructure property 'items' of 'req.body'
  //   as it is undefined.
  // Guard with nullish coalescing so items defaults to undefined
  // (handled by the truthy check below) instead of crashing.
  const { items } = req.body ?? {};

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
  if (!items || items.length === 0)
    return next(new HandleError('Cart is empty', 400));

  const discount = await Discount.findActiveByCode(code);
  if (!discount)
    return next(new HandleError('Invalid or expired discount code', 400));

  // FIX BUG-03: Reject unauthenticated users for audience-specific codes
  // before any cart validation occurs. Previously only canUserUse() was
  // guarded behind userId — validateCart() and calculateDiscount() were
  // still reached, letting guests preview user-targeted codes.
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

    // FIX BUG-05: Track invalid/unavailable items instead of silently
    // skipping them. Silent skips produced a ghost cart total — the discount
    // was computed on a smaller-than-real sum, under-applying percentage
    // discounts and potentially producing false minPurchaseAmount failures.
    if (!product) {
      invalidItems.push({ productId: item.product, reason: 'Product not found' });
      continue;
    }
    if (product.status !== 'published') {
      invalidItems.push({
        productId: product._id,
        name: product.name,
        reason: 'Product unavailable',
      });
      continue;
    }

    const unitPrice = resolveProductPrice(product);

    // Guard: a product with no valid price would silently contribute $0 to
    // itemPrice, producing the same ghost-total problem as BUG-05. Treat it
    // as an invalid item so the caller refreshes their cart.
    if (unitPrice === 0) {
      invalidItems.push({
        productId: product._id,
        name: product.name,
        reason: 'Product has no valid price',
      });
      continue;
    }

    const itemTotal = unitPrice * item.quantity;
    itemPrice += itemTotal;

    // FIX BUG-01: Include product.category in each validItem.
    // validateCart() and calculateDiscount() both inspect item.category to
    // enforce eligibleProductCategories restrictions. Without this field
    // every category-scoped discount code was redeemable on any cart,
    // silently bypassing the restriction entirely.
    validItems.push({
      product:  product._id,
      name:     product.name,
      category: product.category,   // was missing — broke category-scoped codes
      quantity: item.quantity,
      unitPrice,
      itemTotal,
    });
  }

  // FIX BUG-05 (continued): Abort before discount math if cart is stale.
  if (invalidItems.length > 0) {
    return res.status(400).json({
      success:      false,
      message:      'Cart contains unavailable items. Please refresh your cart before applying a discount.',
      invalidItems,
    });
  }

  if (userId) {
    const canUse = await discount.canUserUse(userId);
    if (!canUse.canUse) return next(new HandleError(canUse.reason, 400));
  }

  // FIX BUG-02: validItems now carries category (BUG-01 fix), so
  // validateCart() correctly enforces eligibleProductCategories.
  const validation = discount.validateCart(itemPrice, validItems, userId);
  if (!validation.valid)
    return next(new HandleError(validation.reason, 400));

  const discountAmount = discount.calculateDiscount(itemPrice, validItems);

  // ── NEW: compute eligibleSubtotal ─────────────────────────────────────────
  // When a product-category restriction is active, calculate the subtotal of
  // only the items that qualified for the discount. This is sent to the
  // frontend so the UI can show a transparent breakdown:
  //   e.g. "30% off $745.00 of Electronics items = -$223.50"
  // rather than implying the entire cart total was the discount base.
  //
  // When there is no category restriction (eligibleProductCategories is empty),
  // eligibleSubtotal equals the full itemPrice — the entire cart qualified.
  const eligibleCats = discount.conditions?.eligibleProductCategories ?? [];

  const eligibleSubtotal = eligibleCats.length > 0
    ? Math.round(
        validItems
          .filter(
            (item) =>
              item.category &&
              eligibleCats.includes(item.category)
          )
          .reduce((sum, item) => sum + item.itemTotal, 0)
        * 100
      ) / 100
    : Math.round(itemPrice * 100) / 100;

  // ineligibleSubtotal: portion of the cart the discount did NOT touch.
  // Useful for the frontend to display "X of your cart did not qualify".
  const ineligibleSubtotal = Math.round((itemPrice - eligibleSubtotal) * 100) / 100;
  // ─────────────────────────────────────────────────────────────────────────

  const discountedItemPrice = Math.max(0, itemPrice - discountAmount);
  const taxPrice            = Math.round(discountedItemPrice * 0.18 * 100) / 100;
  const shippingPrice       = discountedItemPrice >= 500 ? 0 : 50;
  const totalPrice          =
    Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

  // NOTE BUG-04: Usage is intentionally NOT recorded here — this endpoint
  // is a preview/price-calculation step. Usage must be recorded by the order
  // creation flow via POST /api/v1/discounts/validate. appliedPending: true
  // signals to the caller that the code is valid but not yet consumed.
  return res.status(200).json({
    success:        true,
    appliedPending: true,
    discount: {
      code:           discount.code,
      type:           discount.type,
      value:          discount.value,
      description:    discount.description,
      discountAmount: Math.round(discountAmount * 100) / 100,
      // Expose restriction so frontend can surface it to the user
      eligibleProductCategories: eligibleCats,
      // NEW — the subtotal the discount was actually computed against.
      // For unrestricted codes this equals the full cart itemPrice.
      // For category-restricted codes this is the sum of qualifying items only.
      eligibleSubtotal,
      // NEW — the portion of the cart that did not qualify.
      // Zero for unrestricted codes.
      ineligibleSubtotal,
    },
    pricing: {
      itemPrice:           Math.round(itemPrice * 100) / 100,
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