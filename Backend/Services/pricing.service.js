import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';

/**
 * Configuration for pricing rules
 * These can be moved to database or environment variables for flexibility
 */
const PRICING_CONFIG = {
  TAX_RATE: 0.18,
  FREE_SHIPPING_THRESHOLD: 500,
  STANDARD_SHIPPING_FEE: 50,
  SUPPORTED_CURRENCIES: ['USD', 'NGN', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'], // USD first
  DEFAULT_CURRENCY: 'USD' 
};

/**
 * Validate and calculate order totals with server-side pricing
 * This is the core security function that prevents price manipulation
 * 
 * @param {Array} cartItems - Array of {product: productId, quantity: number}
 * @param {string} currency - Currency code (NGN, USD, etc.)
 * @returns {Object} Validated order with calculated prices
 * @throws {HandleError} If validation fails
 */
export const validateAndCalculateOrder = async (cartItems, currency = 'USD') => {
  try {
    // 1. Input validation
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      throw new HandleError('Cart is empty or invalid', 400);
    }

    // Validate currency
    const normalizedCurrency = currency.toUpperCase();
    if (!PRICING_CONFIG.SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      throw new HandleError(
        `Unsupported currency: ${currency}. Supported: ${PRICING_CONFIG.SUPPORTED_CURRENCIES.join(', ')}`,
        400
      );
    }

    // 2. Extract product IDs and validate quantities
    const productIds = cartItems.map(item => {
      if (!item.product) {
        throw new HandleError('Invalid cart item: missing product ID', 400);
      }
      if (!item.quantity || item.quantity < 1 || !Number.isInteger(item.quantity)) {
        throw new HandleError(
          `Invalid quantity for product ${item.product}: must be a positive integer`,
          400
        );
      }
      return item.product;
    });

    // 3. Fetch products from database
    const products = await Product.find({
      _id: { $in: productIds }
    }).select('_id name price pricing stock inventory category images');

    // 4. Check if all products exist
    if (products.length !== productIds.length) {
      const foundIds = products.map(p => p._id.toString());
      const missingIds = productIds.filter(id => !foundIds.includes(id.toString()));
      throw new HandleError(
        `Products not found: ${missingIds.join(', ')}`,
        404
      );
    }

    // 5. Create product lookup map
    const productMap = {};
    products.forEach(product => {
      productMap[product._id.toString()] = product;
    });

    // 6. Validate each cart item and calculate totals
    let itemPrice = 0;
    const validatedOrderItems = [];

    for (const cartItem of cartItems) {
      const productId = cartItem.product.toString();
      const product = productMap[productId];
      const quantity = cartItem.quantity;

      // FIXED: Better price extraction with multiple fallbacks
      let dbPrice = 0;
      
      if (product.pricing?.sale && product.pricing.sale > 0) {
        dbPrice = Number(product.pricing.sale);
      } else if (product.pricing?.regular && product.pricing.regular > 0) {
        dbPrice = Number(product.pricing.regular);
      } else if (product.price && product.price > 0) {
        dbPrice = Number(product.price);
      } else {
        throw new HandleError(
          `Product "${product.name}" has no valid price`,
          500
        );
      }

      if (isNaN(dbPrice) || dbPrice <= 0) {
        throw new HandleError(
          `Invalid price for product "${product.name}"`,
          500
        );
      }

      // FIXED: Better stock extraction with fallbacks
      const availableStock = product.inventory?.stock ?? product.stock ?? 0;

      // Check stock availability
      if (availableStock < quantity) {
        throw new HandleError(
          `Insufficient stock for "${product.name}". Available: ${availableStock}, Requested: ${quantity}`,
          400
        );
      }

      // Calculate line total
      const lineTotal = dbPrice * quantity;
      itemPrice += lineTotal;

      // Build validated order item
      validatedOrderItems.push({
        product: product._id,
        name: product.name,
        price: dbPrice,
        quantity: quantity,
        image: product.images?.[0]?.url || product.images?.[0] || '',
        category: product.category,  
      });
    }

    // 7. Calculate tax
    const taxPrice = Number((itemPrice * PRICING_CONFIG.TAX_RATE).toFixed(2));

    // 8. Calculate shipping
    const shippingPrice = itemPrice > PRICING_CONFIG.FREE_SHIPPING_THRESHOLD 
      ? 0 
      : PRICING_CONFIG.STANDARD_SHIPPING_FEE;

    // 9. Calculate total
    const totalPrice = Number((itemPrice + taxPrice + shippingPrice).toFixed(2));

    // 10. Return validated data
    return {
      orderItems: validatedOrderItems,
      itemPrice: Number(itemPrice.toFixed(2)),
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: normalizedCurrency,
      validation: {
        productsValidated: products.length,
        stockChecked: true,
        pricesFromDatabase: true,
        calculatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('❌ validateAndCalculateOrder error:', error);
    
    // If it's already a HandleError, rethrow it
    if (error.statusCode) {
      throw error;
    }
    
    // Otherwise wrap in HandleError
    throw new HandleError(
      error.message || 'Failed to validate and calculate order',
      error.statusCode || 500
    );
  }
};

/**
 * Validate single product availability and price
 * Useful for quick checks before adding to cart
 * 
 * @param {string} productId - Product ID
 * @param {number} quantity - Requested quantity
 * @returns {Object} Product with availability info
 */
export const validateProductAvailability = async (productId, quantity = 1) => {
  const product = await Product.findById(productId).select('_id name price stock');

  if (!product) {
    throw new HandleError('Product not found', 404);
  }

  const isAvailable = product.stock >= quantity;
  const maxAvailable = product.stock;

  return {
    productId: product._id,
    name: product.name,
    price: product.price,
    requestedQuantity: quantity,
    isAvailable,
    maxAvailable,
    stockStatus: isAvailable ? 'In Stock' : 'Out of Stock'
  };
};

/**
 * Recalculate order total (used for order updates)
 * 
 * @param {Array} orderItems - Existing order items
 * @returns {Object} Recalculated totals
 */
export const recalculateOrderTotal = (orderItems) => {
  let itemPrice = 0;

  orderItems.forEach(item => {
    itemPrice += item.price * item.quantity;
  });

  const taxPrice = Number((itemPrice * PRICING_CONFIG.TAX_RATE).toFixed(2));
  const shippingPrice = itemPrice > PRICING_CONFIG.FREE_SHIPPING_THRESHOLD 
    ? 0 
    : PRICING_CONFIG.STANDARD_SHIPPING_FEE;
  const totalPrice = Number((itemPrice + taxPrice + shippingPrice).toFixed(2));

  return {
    itemPrice: Number(itemPrice.toFixed(2)),
    taxPrice,
    shippingPrice,
    totalPrice
  };
};

/**
 * Update pricing configuration (admin function)
 * Can be expanded to store in database
 */
export const updatePricingConfig = (newConfig) => {
  if (newConfig.TAX_RATE !== undefined) {
    PRICING_CONFIG.TAX_RATE = newConfig.TAX_RATE;
  }
  if (newConfig.FREE_SHIPPING_THRESHOLD !== undefined) {
    PRICING_CONFIG.FREE_SHIPPING_THRESHOLD = newConfig.FREE_SHIPPING_THRESHOLD;
  }
  if (newConfig.STANDARD_SHIPPING_FEE !== undefined) {
    PRICING_CONFIG.STANDARD_SHIPPING_FEE = newConfig.STANDARD_SHIPPING_FEE;
  }
  return PRICING_CONFIG;
};

/**
 * Get current pricing configuration
 */
export const getPricingConfig = () => {
  return { ...PRICING_CONFIG };
};