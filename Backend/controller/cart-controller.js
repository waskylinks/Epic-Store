import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from '../models/product-model.js';
import Discount from '../models/discount-model.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// GET CART DETAILS - Fetch fresh product data
// ============================================

/**
 * Get cart details with current prices and stock
 * @route POST /api/v1/cart/details
 * @access Public
 */
export const getCartDetails = handleAsyncError(async (req, res, next) => {
    const { items } = req.body;

    if (!items || items.length === 0) {
        return res.status(200).json({
            success: true,
            cartItems: []
        });
    }

    const cartItems = [];

    for (const item of items) {
        const product = await Product.findById(item.product);

        if (!product || product.status !== 'published') {
            continue; // Skip unavailable products
        }

        // Get current price (prioritize sale price)
        let currentPrice = 0;
        if (product.pricing?.sale && product.pricing.sale > 0) {
            currentPrice = product.pricing.sale;
        } else if (product.pricing?.regular && product.pricing.regular > 0) {
            currentPrice = product.pricing.regular;
        } else if (product.price && product.price > 0) {
            currentPrice = product.price;
        }

        const availableStock = product.inventory?.stock ?? product.stock ?? 0;

        cartItems.push({
            product: product._id,
            name: product.name,
            price: currentPrice,
            stock: availableStock,
            image: product.images?.[0]?.url || product.image?.[0]?.url,
            quantity: Math.min(item.quantity, availableStock) // Cap at available stock
        });
    }

    return res.status(200).json({
        success: true,
        cartItems
    });
});

// ============================================
// ADD TO CART - Add item to cart
// ============================================

/**
 * Add item to cart (or update quantity)
 * @route POST /api/v1/cart/add
 * @access Public
 */
export const addToCart = handleAsyncError(async (req, res, next) => {
    const { product: productId, quantity = 1 } = req.body;

    if (!productId) {
        return next(new HandleError('Product ID is required', 400));
    }

    // Validate product exists and is available
    const product = await Product.findById(productId);

    if (!product) {
        return next(new HandleError('Product not found', 404));
    }

    if (product.status !== 'published') {
        return next(new HandleError('Product is not available', 400));
    }

    // Check stock
    const availableStock = product.inventory?.stock ?? product.stock ?? 0;
    if (availableStock < quantity) {
        return next(new HandleError(
            `Only ${availableStock} items available in stock`, 
            400
        ));
    }

    // Get current price
    let currentPrice = 0;
    if (product.pricing?.sale && product.pricing.sale > 0) {
        currentPrice = product.pricing.sale;
    } else if (product.pricing?.regular && product.pricing.regular > 0) {
        currentPrice = product.pricing.regular;
    } else if (product.price && product.price > 0) {
        currentPrice = product.price;
    } else {
        return next(new HandleError('Product has no valid price', 500));
    }

    // Track add to cart analytics
    try {
        await product.incrementCart(true);
        console.log(`✅ Product ${productId} cart analytics updated (+${quantity})`);
    } catch (error) {
        console.warn('Failed to update product cart analytics:', error);
    }

    // Invalidate product analytics caches
    deleteCachePattern('product_conversion*').catch(err => 
        console.warn('Failed to invalidate cache:', err)
    );
    deleteCachePattern('product_performance*').catch(err => 
        console.warn('Failed to invalidate cache:', err)
    );

    // Return item details
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
// UPDATE CART ITEM - Update quantity
// ============================================

/**
 * Update cart item quantity
 * @route PUT /api/v1/cart/update
 * @access Public
 */
export const updateCartItem = handleAsyncError(async (req, res, next) => {
    const { product: productId, quantity } = req.body;

    if (!productId || !quantity) {
        return next(new HandleError('Product ID and quantity are required', 400));
    }

    if (quantity < 1) {
        return next(new HandleError('Quantity must be at least 1', 400));
    }

    // Validate product
    const product = await Product.findById(productId);

    if (!product) {
        return next(new HandleError('Product not found', 404));
    }

    // Check stock
    const availableStock = product.inventory?.stock ?? product.stock ?? 0;
    if (availableStock < quantity) {
        return next(new HandleError(
            `Only ${availableStock} items available in stock`, 
            400
        ));
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

/**
 * Remove item from cart
 * @route DELETE /api/v1/cart/remove/:productId
 * @access Public
 */
export const removeFromCart = handleAsyncError(async (req, res, next) => {
    const { productId } = req.params;

    if (!productId) {
        return next(new HandleError('Product ID is required', 400));
    }

    // Track cart removal analytics
    try {
        const product = await Product.findById(productId);
        if (product) {
            await product.incrementCart(false);
            console.log(`✅ Product ${productId} cart analytics updated on removal`);
        }
    } catch (error) {
        console.warn('Failed to update product cart analytics:', error);
    }

    // Invalidate product analytics caches
    deleteCachePattern('product_conversion*').catch(err => 
        console.warn('Failed to invalidate cache:', err)
    );

    return res.status(200).json({
        success: true,
        message: 'Item removed from cart',
        productId
    });
});

// ============================================
// CLEAR CART
// ============================================

/**
 * Clear entire cart
 * @route DELETE /api/v1/cart/clear
 * @access Public
 */
export const clearCart = handleAsyncError(async (req, res, next) => {
    const { items } = req.body;

    // Update analytics for all products being removed
    if (items && items.length > 0) {
        try {
            const productIds = items.map(item => item.product);
            await Product.updateMany(
                { _id: { $in: productIds } },
                { $inc: { 'analytics.addedToCart': -1 } }
            );
            console.log(`✅ Bulk cart analytics updated for ${productIds.length} products on clear`);
        } catch (error) {
            console.warn('Failed to update product analytics during cart clear:', error);
        }

        // Invalidate caches
        deleteCachePattern('product_conversion*').catch(err => 
            console.warn('Failed to invalidate cache:', err)
        );
    }

    return res.status(200).json({
        success: true,
        message: 'Cart cleared'
    });
});

// ============================================
// VALIDATE CHECKOUT - Validate and calculate totals
// ============================================

/**
 * Validate cart and calculate final pricing before checkout
 * @route POST /api/v1/cart/checkout/validate
 * @access Public
 */
export const validateCheckout = handleAsyncError(async (req, res, next) => {
    const { items } = req.body;

    if (!items || items.length === 0) {
        return next(new HandleError('Cart is empty', 400));
    }

    let itemPrice = 0;
    const validItems = [];
    const invalidItems = [];

    // Validate each item and calculate pricing
    for (const item of items) {
        const product = await Product.findById(item.product);

        // Product doesn't exist
        if (!product) {
            invalidItems.push({
                productId: item.product,
                reason: 'Product not found',
                requestedQuantity: item.quantity
            });
            continue;
        }

        // Product not published
        if (product.status !== 'published') {
            invalidItems.push({
                productId: product._id,
                name: product.name,
                reason: 'Product unavailable',
                requestedQuantity: item.quantity
            });
            continue;
        }

        // Check stock
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

        // Get current price
        let unitPrice = 0;
        if (product.pricing?.sale && product.pricing.sale > 0) {
            unitPrice = product.pricing.sale;
        } else if (product.pricing?.regular && product.pricing.regular > 0) {
            unitPrice = product.pricing.regular;
        } else if (product.price && product.price > 0) {
            unitPrice = product.price;
        } else {
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

    // If there are invalid items, return error
    if (invalidItems.length > 0) {
        return res.status(400).json({
            success: false,
            isValid: false,
            invalidItems,
            message: `${invalidItems.length} item(s) are no longer available`
        });
    }

    // Calculate totals
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
// APPLY DISCOUNT CODE - INTEGRATED WITH DISCOUNT MODEL
// ============================================

/**
 * Apply discount code to cart
 * @route POST /api/v1/cart/apply-discount
 * @access Public
 */
export const applyDiscountCode = handleAsyncError(async (req, res, next) => {
    const { code, items } = req.body;

    if (!code) {
        return next(new HandleError('Discount code is required', 400));
    }

    if (!items || items.length === 0) {
        return next(new HandleError('Cart is empty', 400));
    }

    // Find discount from database
    const discount = await Discount.findActiveByCode(code);

    if (!discount) {
        return next(new HandleError('Invalid or expired discount code', 400));
    }

    // Calculate original cart pricing
    let itemPrice = 0;
    const validItems = [];

    for (const item of items) {
        const product = await Product.findById(item.product);
        
        if (!product || product.status !== 'published') {
            continue;
        }

        const unitPrice = product.pricing?.sale || product.pricing?.regular || product.price || 0;
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

    // Check if user can use this discount (if logged in)
    const userId = req.user?._id;
    if (userId) {
        const canUse = await discount.canUserUse(userId);
        if (!canUse.canUse) {
            return next(new HandleError(canUse.reason, 400));
        }
    }

    // Validate cart against discount conditions
    const validation = discount.validateCart(itemPrice, validItems, userId);
    if (!validation.valid) {
        return next(new HandleError(validation.reason, 400));
    }

    // Calculate discount amount using model method
    const discountAmount = discount.calculateDiscount(itemPrice, validItems);

    // Calculate final pricing
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