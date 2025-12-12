import Joi from 'joi';

export const verifyPaymentSchema = Joi.object({
  reference: Joi.string().min(8).required(),
  
  shippingInfo: Joi.object({
    phoneNo: Joi.string().required(),
    address: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    country: Joi.string().required(),
    pinCode: Joi.string().required()  // store as string for flexibility
  }).required(),

  orderItems: Joi.array().items(
    Joi.object({
      product: Joi.string().required(), // matches ObjectId in model
      name: Joi.string().required(),
      price: Joi.number().min(0).required(),
      quantity: Joi.number().integer().min(1).required(),
      image: Joi.string().required()
    })
  ).required(),

  itemPrice: Joi.number().min(0).required(),
  taxPrice: Joi.number().min(0).required(),
  shippingPrice: Joi.number().min(0).required(),
  totalPrice: Joi.number().min(0).required(),
  amountPaid: Joi.number().min(0).required()
});
