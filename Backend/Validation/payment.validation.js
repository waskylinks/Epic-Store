import Joi from 'joi';

/**
 * Validation schema for payment initialization
 *
 * FIX: Added cartPricing and discountSnapshot fields.
 * Previously the schema only allowed the original fields, so Joi was
 * stripping cartPricing and discountSnapshot before the controller ran —
 * causing the "cartPricing is required" 400 error even when the frontend
 * sent the correct payload.
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
    }),

  // FIX: Pre-computed pricing from the cart controller.
  // This is the single source of truth for all totals — the payment
  // controller trusts these figures directly instead of recalculating.
  // Previously absent from the schema, causing Joi to strip it silently
  // before the controller ran and triggering the 400 "cartPricing required" error.
  cartPricing: Joi.object({
    itemPrice: Joi.number()
      .min(0)
      .required()
      .messages({
        'number.base': 'itemPrice must be a number',
        'number.min': 'itemPrice cannot be negative',
        'any.required': 'itemPrice is required in cartPricing'
      }),
    taxPrice: Joi.number()
      .min(0)
      .required()
      .messages({
        'number.base': 'taxPrice must be a number',
        'number.min': 'taxPrice cannot be negative',
        'any.required': 'taxPrice is required in cartPricing'
      }),
    shippingPrice: Joi.number()
      .min(0)
      .required()
      .messages({
        'number.base': 'shippingPrice must be a number',
        'number.min': 'shippingPrice cannot be negative',
        'any.required': 'shippingPrice is required in cartPricing'
      }),
    totalPrice: Joi.number()
      .positive()
      .required()
      .messages({
        'number.base': 'totalPrice must be a number',
        'number.positive': 'totalPrice must be greater than zero',
        'any.required': 'totalPrice is required in cartPricing'
      }),
    // currency is optional here — the top-level currency field is the
    // authoritative value; this is carried along for convenience only.
    currency: Joi.string()
      .valid('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR')
      .optional()
  })
    .required()
    .messages({
      'any.required': 'cartPricing is required — complete the cart/checkout step before paying'
    }),

  // FIX: Full discount snapshot forwarded from cart Redux state.
  // Previously the schema only accepted discountCode (a plain string).
  // That approach required the backend to re-run the entire discount
  // calculation, which was the root cause of the discount being lost at
  // payment time. Now the pre-computed snapshot is forwarded directly and
  // the backend records it without recalculating.
  // Optional — omitted entirely when no discount is active.
  discountSnapshot: Joi.object({
    code: Joi.string()
      .required()
      .messages({
        'any.required': 'Discount code is required in discountSnapshot'
      }),
    discountId: Joi.string()
      .allow(null, '')
      .optional(),
    type: Joi.string()
      .allow(null, '')
      .optional(),
    value: Joi.number()
      .allow(null)
      .optional(),
    discountAmount: Joi.number()
      .min(0)
      .required()
      .messages({
        'number.base': 'discountAmount must be a number',
        'number.min': 'discountAmount cannot be negative',
        'any.required': 'discountAmount is required in discountSnapshot'
      }),
    originalItemPrice: Joi.number()
      .min(0)
      .required()
      .messages({
        'number.base': 'originalItemPrice must be a number',
        'number.min': 'originalItemPrice cannot be negative',
        'any.required': 'originalItemPrice is required in discountSnapshot'
      }),
    description: Joi.string()
      .allow(null, '')
      .optional()
  })
    .optional()
    .allow(null)
});

/**
 * Validation schema for payment verification.
 * Unchanged — verify reads everything from the Redis session, so no new
 * fields are needed here.
 *
 * NOTE: min length requirement is intentionally absent to support all
 * gateway reference formats:
 *   - Paystack:     "ORD-1768858351837-00AB28A3124F" (long)
 *   - Flutterwave:  "9950870" (short numeric string, 7 chars)
 *   - Stripe:       "pi_3QcXXXXXXXXXXXXXXXXX" (~27 chars)
 */
export const verifyPaymentSchema = Joi.object({
  gateway: Joi.string()
    .valid('paystack', 'flutterwave', 'stripe')
    .required()
    .messages({
      'any.only': 'Gateway must be one of: paystack, flutterwave, stripe',
      'any.required': 'Payment gateway is required'
    }),

  reference: Joi.string()
    .required()
    .messages({
      'any.required': 'Payment reference is required'
    }),

  // transactionId is Flutterwave-specific — numeric transaction ID used to
  // bypass the unreliable tx_ref search endpoint.
  transactionId: Joi.string()
    .allow(null, '')
    .optional()
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