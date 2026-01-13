import Joi from 'joi';

export const verifyPaymentSchema = Joi.object({
  // Payment gateway selection (CRITICAL - was missing)
  gateway: Joi.string()
    .valid('paystack', 'flutterwave', 'stripe')
    .required()
    .messages({
      'any.only': 'Gateway must be one of: paystack, flutterwave, stripe',
      'any.required': 'Payment gateway is required'
    }),

  // Currency (CRITICAL - was missing)
  currency: Joi.string()
    .valid('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR')
    .uppercase()
    .required()
    .messages({
      'any.only': 'Unsupported currency. Supported: NGN, USD, GBP, EUR, GHS, KES, ZAR',
      'any.required': 'Currency is required'
    }),

  reference: Joi.string().min(8).required(),
  
  shippingInfo: Joi.object({
    phoneNo: Joi.string().required(),
    address: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    country: Joi.string().required(),
    pinCode: Joi.string().required()
  }).required(),

  orderItems: Joi.array()
    .items(
      Joi.object({
        product: Joi.string().required(),
        name: Joi.string().required(),
        price: Joi.number().min(0).required(),
        quantity: Joi.number().integer().min(1).required(),
        image: Joi.string().required()
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required'
    }),

  itemPrice: Joi.number().min(0).required(),
  taxPrice: Joi.number().min(0).required(),
  shippingPrice: Joi.number().min(0).required(),
  totalPrice: Joi.number().min(0).required(),
  amountPaid: Joi.number().min(0).required()
    .messages({
      'number.min': 'Amount paid must be greater than or equal to 0'
    })
});