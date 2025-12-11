import Order from '../models/order-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import axios from 'axios';

// Verify payment and save order with detailed console logging
export const verifyPayment = handleAsyncError(async (req, res, next) => {
    console.log('--- verifyPayment called ---');
    console.log('Request user:', req.user);
    console.log('Request body:', req.body);

    const { reference, shippingInfo, orderItems, itemPrice, taxPrice, shippingPrice, totalPrice, amountPaid } = req.body;

    if (!req.user) {
        console.error('User not authenticated');
        return next(new HandleError('User not authenticated', 401));
    }

    if (!reference) {
        console.error('Payment reference missing');
        return next(new HandleError('Payment reference is required', 400));
    }

    // Check shipping info
    if (!shippingInfo || !shippingInfo.phoneNo) {
        console.error('Shipping info or phone number missing', shippingInfo);
        return next(new HandleError('Shipping phone number is required', 400));
    }

    let paystackData;
    try {
        console.log('Verifying payment with Paystack for reference:', reference);
        const { data } = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}` } }
        );
        paystackData = data;
        console.log('Paystack verification response:', paystackData);
    } catch (err) {
        console.error('Paystack verification error:', err.response?.data || err.message);
        return next(new HandleError('Payment verification failed', 500));
    }

    if (!paystackData.data || paystackData.data.status !== 'success') {
        console.error('Payment not successful:', paystackData.data);
        return next(new HandleError('Payment was not successful', 400));
    }

    try {
        console.log('Creating order with the following details:');
        console.log({
            shippingInfo,
            orderItems,
            itemPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            amountPaid
        });

        const order = await Order.create({
            shippingInfo: {
                ...shippingInfo,
            },
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

        console.log('Order successfully created:', order);

        res.status(200).json({ success: true, order });
    } catch (err) {
        console.error('Order creation error:', err);
        return next(new HandleError('Failed to save order', 500));
    }
});
