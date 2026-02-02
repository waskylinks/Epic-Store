import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from '../models/product-model.js';

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
// APPLY DISCOUNT CODE
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

    // Mock discount codes (replace with database lookup in production)
    const discountCodes = {
        'SAVE10': { type: 'percentage', amount: 10 },
        'SAVE20': { type: 'percentage', amount: 20 },
        'FLAT50': { type: 'fixed', amount: 50 }
    };

    const discount = discountCodes[code.toUpperCase()];

    if (!discount) {
        return next(new HandleError('Invalid discount code', 400));
    }

    // Calculate original pricing
    let itemPrice = 0;
    for (const item of items) {
        const product = await Product.findById(item.product);
        if (product) {
            const unitPrice = product.pricing?.sale || product.pricing?.regular || product.price || 0;
            itemPrice += unitPrice * item.quantity;
        }
    }

    // Apply discount
    let discountAmount = 0;
    if (discount.type === 'percentage') {
        discountAmount = (itemPrice * discount.amount) / 100;
    } else {
        discountAmount = discount.amount;
    }

    const discountedItemPrice = Math.max(0, itemPrice - discountAmount);
    const taxPrice = Math.round(discountedItemPrice * 0.18 * 100) / 100;
    const shippingPrice = discountedItemPrice >= 500 ? 0 : 50;
    const totalPrice = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

    return res.status(200).json({
        success: true,
        code: code.toUpperCase(),
        type: discount.type,
        discountAmount: Math.round(discountAmount * 100) / 100,
        pricing: {
            itemPrice: Math.round(discountedItemPrice * 100) / 100,
            taxPrice,
            shippingPrice,
            totalPrice,
            currency: 'USD'
        }
    });
});