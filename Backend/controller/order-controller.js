import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import Errorhandler from '../utils/handleError.js';
import User from '../models/userModel.js';
import handleAsyncError from '../middleware/handleAsyncError.js';

//create new order
export const createNewOrder = handleAsyncError(async (req, res, next) => {
    const { shippingInfo, orderItems, paymentInfo, itemPrice, taxPrice, shippingPrice, totalPrice } = req.body;

    const order = await Order.create({
        shippingInfo,
        orderItems,
        paymentInfo,
        itemPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        paidAt: Date.now(),
        user: req.user._id
    });

    res.status(200).json({
        success: true,
        order
    });

});