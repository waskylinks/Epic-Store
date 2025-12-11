import Order from '../models/order-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import axios from 'axios';


// Verify payment and save order
export const verifyPayment = handleAsyncError(async (req, res, next) => {
    const { reference, shippingInfo, orderItems, itemPrice, taxPrice, shippingPrice, totalPrice } = req.body;

    // Verify payment with Paystack
    const { data } = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`
        }
    });

    if (data.data.status !== 'success') {
        return next(new HandleError('Payment failed', 400));
    }

    // Save order in DB
    const order = await Order.create({
        shippingInfo,
        orderItems,
        user: req.user._id,
        paymentInfo: {
            id: data.data.id,
            status: data.data.status,
            paidAt: Date.now()
        },
        itemPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        paymentDetails: data.data
    });

    res.status(200).json({ 
        success: true, 
        order 
    });
});