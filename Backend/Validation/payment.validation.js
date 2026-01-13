import Joi from 'joi';

/**
 * Validation schema for payment initialization
 * This is called BEFORE payment to validate cart and create pending order
 */
export const initializePaymentSchema = Joi.object({
  // Payment gateway selection
  gateway: Joi.string()
    .valid('paystack', 'flutterwave', 'stripe')
    .required()
    .messages({
      'any.only': 'Gateway must be one of: paystack, flutterwave, stripe',
      'any.required': 'Payment gateway is required'
    }),

  // Currency
  currency: Joi.string()
    .valid('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR')
    .uppercase()
    .required()
    .messages({
      'any.only': 'Unsupported currency. Supported: NGN, USD, GBP, EUR, GHS, KES, ZAR',
      'any.required': 'Currency is required'
    }),

  // Shipping information
  shippingInfo: Joi.object({
    phoneNo: Joi.string()
      .required()
      .messages({
        'any.required': 'Phone number is required'
      }),
    address: Joi.string()
      .min(5)
      .required()
      .messages({
        'string.min': 'Address must be at least 5 characters',
        'any.required': 'Address is required'
      }),
    city: Joi.string()
      .required()
      .messages({
        'any.required': 'City is required'
      }),
    state: Joi.string()
      .required()
      .messages({
        'any.required': 'State is required'
      }),
    country: Joi.string()
      .required()
      .messages({
        'any.required': 'Country is required'
      }),
    pinCode: Joi.string()
      .required()
      .messages({
        'any.required': 'Postal code is required'
      })
  }).required(),

  // Cart items - ONLY product ID and quantity (NO PRICES from client)
  cartItems: Joi.array()
    .items(
      Joi.object({
        product: Joi.string()
          .required()
          .messages({
            'any.required': 'Product ID is required'
          }),
        quantity: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .required()
          .messages({
            'number.base': 'Quantity must be a number',
            'number.integer': 'Quantity must be an integer',
            'number.min': 'Quantity must be at least 1',
            'number.max': 'Quantity cannot exceed 100 per item',
            'any.required': 'Quantity is required'
          })
      })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      'array.min': 'At least one item is required in cart',
      'array.max': 'Maximum 50 items allowed per order',
      'any.required': 'Cart items are required'
    })
});

/**
 * Validation schema for payment verification (existing)
 * This is called AFTER payment to verify and update pending order
 */
export const verifyPaymentSchema = Joi.object({
  // Payment gateway
  gateway: Joi.string()
    .valid('paystack', 'flutterwave', 'stripe')
    .required()
    .messages({
      'any.only': 'Gateway must be one of: paystack, flutterwave, stripe',
      'any.required': 'Payment gateway is required'
    }),

  // Payment reference from gateway
  reference: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Reference must be at least 8 characters',
      'any.required': 'Payment reference is required'
    })
  
  // NOTE: We removed all other fields (shippingInfo, orderItems, prices)
  // because the pending order already has this data
  // This makes the verification endpoint much simpler and more secure
});

/**
 * Validation schema for product availability check (optional - for frontend use)
 */
export const checkProductAvailabilitySchema = Joi.object({
  productId: Joi.string()
    .required()
    .messages({
      'any.required': 'Product ID is required'
    }),
  quantity: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(1)
    .messages({
      'number.integer': 'Quantity must be an integer',
      'number.min': 'Quantity must be at least 1',
      'number.max': 'Quantity cannot exceed 100'
    })
});