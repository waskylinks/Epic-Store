import Order from '../models/order-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import axios from 'axios';

export const verifyPayment = handleAsyncError(async (req, res, next) => {
    console.log('--- verifyPayment called ---');
    console.log('Request user:', req.user);
    console.log('Request body:', req.body);

    const { reference, shippingInfo, orderItems, itemPrice, taxPrice, shippingPrice, totalPrice, amountPaid } = req.body;

    if (!req.user) {
        return next(new HandleError('User not authenticated', 401));
    }

    if (!reference) {
        return next(new HandleError('Payment reference is required', 400));
    }

    if (!shippingInfo || !shippingInfo.phoneNo) {
        return next(new HandleError('Shipping phone number is required', 400));
    }

    let paystackData;
    try {
        const { data } = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}` } }
        );
        paystackData = data;
    } catch (err) {
        console.error('Paystack verification failed:', err.response?.data || err.message);
        return next(new HandleError('Payment verification failed', 500));
    }

    // Failed verification
    if (!paystackData.data || paystackData.data.status !== 'success') {
        return next(new HandleError('Payment was not successful', 400));
    }

    try {
        const order = await Order.create({
            shippingInfo,
            orderItems: orderItems || [],
            user: req.user._id,
            paymentInfo: {
                id: paystackData.data.id,
                status: paystackData.data.status,
                paidAt: Date.now()
            },
            itemPrice: itemPrice || 0,
            taxPrice: taxPrice || 0,
            shippingPrice: shippingPrice || 0,
            totalPrice: totalPrice || 0,
            amountPaid: amountPaid || totalPrice || 0,
            paymentDetails: paystackData.data
        });

        return res.status(200).json({
            success: true,
            message: "Order created successfully",
            order
        });

    } catch (err) {
        console.error('Order creation failed:', err);
        return next(new HandleError('Failed to save order', 500));
    }
});
