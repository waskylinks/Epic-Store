import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Product from '../models/product-model.js';
import User from '../models/userModel.js';

// ============================================
// CART CALCULATION
// ============================================

/**
 * Calculate cart totals (itemPrice, taxPrice, shippingPrice, totalPrice)
 * @route POST /api/v1/cart/calculate
 * @access Public (can be used before login)
 */
export const calculateCart = handleAsyncError(async (req, res, next) => {
    const { cartItems, currency = 'NGN' } = req.body;

    if (!cartItems || cartItems.length === 0) {
        return next(new HandleError('Cart is empty', 400));
    }

    let itemPrice = 0;
    const breakdown = [];

    // Calculate item prices from database
    for (const item of cartItems) {
        const product = await Product.findById(item.product);

        if (!product) {
            return next(new HandleError(`Product not found: ${item.product}`, 404));
        }

        // Use sale price if available, otherwise regular price
        const unitPrice = product.pricing?.sale || product.pricing?.regular || product.price || 0;
        const itemTotal = unitPrice * item.quantity;
        
        itemPrice += itemTotal;

        breakdown.push({
            product: product._id,
            name: product.name,
            quantity: item.quantity,
            unitPrice,
            itemTotal
        });
    }

    // Calculate tax (18% for Nigeria)
    const taxRate = currency === 'NGN' ? 0.18 : 0.00;
    const taxPrice = Math.round(itemPrice * taxRate * 100) / 100;

    // Calculate shipping (free if over 500 NGN)
    const shippingPrice = itemPrice >= 500 ? 0 : 50;

    // Calculate total
    const totalPrice = Math.round((itemPrice + taxPrice + shippingPrice) * 100) / 100;

    return res.status(200).json({
        success: true,
        pricing: {
            itemPrice: Math.round(itemPrice * 100) / 100,
            taxPrice,
            shippingPrice,
            totalPrice,
            currency,
            breakdown,
            lastUpdated: new Date().toISOString()
        }
    });
});

// ============================================
// CART VALIDATION
// ============================================

/**
 * Validate entire cart before checkout
 * @route POST /api/v1/cart/validate
 * @access Public
 */
export const validateCart = handleAsyncError(async (req, res, next) => {
    const { cartItems } = req.body;

    if (!cartItems || cartItems.length === 0) {
        return res.status(200).json({
            success: true,
            isValid: true,
            errors: [],
            invalidItems: []
        });
    }

    const errors = [];
    const invalidItems = [];

    for (const item of cartItems) {
        const product = await Product.findById(item.product);

        // Product doesn't exist
        if (!product) {
            errors.push(`Product ${item.product} not found`);
            invalidItems.push({
                productId: item.product,
                reason: 'Product not found',
                requestedQuantity: item.quantity
            });
            continue;
        }

        // Product is not published
        if (product.status !== 'published') {
            errors.push(`${product.name} is no longer available`);
            invalidItems.push({
                productId: product._id,
                name: product.name,
                reason: 'Product unavailable',
                requestedQuantity: item.quantity
            });
            continue;
        }

        // Insufficient stock
        const availableStock = product.inventory?.stock || product.stock || 0;
        if (availableStock < item.quantity) {
            errors.push(`Only ${availableStock} available for ${product.name}`);
            invalidItems.push({
                productId: product._id,
                name: product.name,
                reason: 'Insufficient stock',
                requestedQuantity: item.quantity,
                availableQuantity: availableStock
            });
        }
    }

    return res.status(200).json({
        success: true,
        isValid: errors.length === 0,
        errors,
        invalidItems
    });
});

/**
 * Batch validate cart items
 * @route POST /api/v1/cart/validate-items
 * @access Public
 */
export const validateCartItems = handleAsyncError(async (req, res, next) => {
    const { items } = req.body;

    if (!items || items.length === 0) {
        return res.status(200).json({
            success: true,
            validItems: [],
            invalidItems: []
        });
    }

    const validItems = [];
    const invalidItems = [];

    for (const item of items) {
        const product = await Product.findById(item.product);

        if (!product || product.status !== 'published') {
            invalidItems.push({
                productId: item.product,
                reason: !product ? 'Product not found' : 'Product unavailable',
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
        } else {
            validItems.push({
                productId: product._id,
                name: product.name,
                quantity: item.quantity,
                price: product.pricing?.sale || product.pricing?.regular || product.price,
                stock: availableStock
            });
        }
    }

    return res.status(200).json({
        success: true,
        validItems,
        invalidItems
    });
});

// ============================================
// PRODUCT AVAILABILITY CHECK
// ============================================

/**
 * Check product availability
 * @route GET /api/v1/products/:id/availability
 * @access Public
 */
export const checkProductAvailability = handleAsyncError(async (req, res, next) => {
    const { id } = req.params;
    const { quantity } = req.query;

    const product = await Product.findById(id);

    if (!product) {
        return next(new HandleError('Product not found', 404));
    }

    if (product.status !== 'published') {
        return res.status(200).json({
            success: true,
            isAvailable: false,
            name: product.name,
            reason: 'Product not available',
            maxAvailable: 0
        });
    }

    const availableStock = product.inventory?.stock || product.stock || 0;
    const requestedQty = parseInt(quantity) || 1;

    return res.status(200).json({
        success: true,
        isAvailable: availableStock >= requestedQty,
        name: product.name,
        maxAvailable: availableStock,
        requestedQuantity: requestedQty,
        stockStatus: availableStock === 0 ? 'out_of_stock' : 
                     availableStock <= 5 ? 'low_stock' : 'in_stock'
    });
});

// ============================================
// GUEST CART MERGE
// ============================================

/**
 * Merge guest cart to user cart on login
 * @route POST /api/v1/cart/merge
 * @access Private
 */
export const mergeGuestCart = handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;
    const { guestItems } = req.body;

    if (!guestItems || guestItems.length === 0) {
        return res.status(200).json({
            success: true,
            message: 'No guest cart to merge',
            cartItems: []
        });
    }

    // In a real implementation, you would fetch user's existing cart from database
    // For now, we'll just validate the guest items and return them
    const validatedItems = [];

    for (const item of guestItems) {
        const product = await Product.findById(item.product);

        if (product && product.status === 'published') {
            const availableStock = product.inventory?.stock || product.stock || 0;
            
            validatedItems.push({
                product: product._id,
                name: product.name,
                price: product.pricing?.sale || product.pricing?.regular || product.price,
                quantity: Math.min(item.quantity, availableStock),
                image: product.images?.[0]?.url,
                stock: availableStock
            });
        }
    }

    return res.status(200).json({
        success: true,
        message: 'Guest cart merged successfully',
        cartItems: validatedItems
    });
});

// ============================================
// DISCOUNT CODE
// ============================================

/**
 * Apply discount code to cart
 * @route POST /api/v1/cart/apply-discount
 * @access Public
 */
export const applyDiscountCode = handleAsyncError(async (req, res, next) => {
    const { code, cartItems } = req.body;

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
    for (const item of cartItems) {
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
        amount: discountAmount,
        pricing: {
            itemPrice: Math.round(discountedItemPrice * 100) / 100,
            taxPrice,
            shippingPrice,
            totalPrice,
            currency: 'NGN',
            lastUpdated: new Date().toISOString()
        }
    });
});

// ============================================
// SAVE FOR LATER
// ============================================

/**
 * Save item for later
 * @route POST /api/v1/cart/save-for-later
 * @access Private
 */
export const saveForLater = handleAsyncError(async (req, res, next) => {
    const { productId } = req.body;
    const userId = req.user._id;

    if (!productId) {
        return next(new HandleError('Product ID is required', 400));
    }

    const product = await Product.findById(productId);

    if (!product) {
        return next(new HandleError('Product not found', 404));
    }

    // In production, save to user's "saved for later" list in database
    // For now, just return success

    return res.status(200).json({
        success: true,
        message: `${product.name} saved for later`,
        productId: product._id
    });
});