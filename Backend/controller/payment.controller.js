// controllers/payment.controller.js
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js"; 
import { createReceiptIfNotExists } from "../Services/receipt.service.js"; 
import { deleteCachePattern } from '../utils/redis.js';


// Helper: Invalidate payment-related caches
const invalidatePaymentCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
    }
};

export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new HandleError("User not authenticated", 401));
    }

    const {
        gateway,
        reference,
        currency,
        shippingInfo,
        orderItems,
        itemPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        amountPaid
    } = req.body;

    let paymentService;
    try {
        paymentService = PaymentFactory.getService(gateway);
    } catch (err) {
        return next(new HandleError(err.message, 400));
    }

    try {
        const result = await paymentService.verifyAndCreateOrder({
            reference,
            currency,
            shippingInfo,
            orderItems,
            itemPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            amountPaid,
            userId
        });

        if (result.created) {
            await createReceiptIfNotExists({
                orderId: result.order._id,
                userId,
                reference,
                orderItems,
                itemPrice,
                taxPrice,
                shippingPrice,
                totalPrice,
                shippingInfo,
                currency,
                paymentGateway: gateway
            });

            // Invalidate caches after successful order creation
            await invalidatePaymentCaches();
        }

        return res.status(200).json({
            success: true,
            message: result.created
                ? "Order created successfully"
                : "Order already exists (idempotent)",
            order: result.order,
            idempotent: !result.created
        });

    } catch (err) {
        const status =
            err.message?.toLowerCase().includes("currency") ||
            err.message?.toLowerCase().includes("amount") ||
            err.message?.toLowerCase().includes("reference")
                ? 400
                : 500;

        return next(new HandleError(err.message, status));
    }
});

