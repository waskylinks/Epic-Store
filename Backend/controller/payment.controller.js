import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js"; 
import { createReceiptIfNotExists } from "../Services/receipt.service.js"; 
import { validateAndCalculateOrder } from "../Services/pricing.service.js";
import { deleteCachePattern } from '../utils/redis.js';
import Order from '../models/order-model.js';
import crypto from 'crypto';

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

/**
 * Generate unique payment reference
 */
const generatePaymentReference = () => {
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `ORD-${timestamp}-${randomStr}`;
};

/**
 * Initialize Payment - Creates pending order with server-calculated prices
 * @route POST /api/v1/payment/initialize
 * @access Private
 */
export const initializePaymentController = handleAsyncError(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new HandleError("User not authenticated", 401));
    }

    const { gateway, currency, shippingInfo, cartItems } = req.body;

    // 1. Validate and calculate order totals using database prices
    let validatedOrder;
    try {
        validatedOrder = await validateAndCalculateOrder(cartItems, currency);
    } catch (err) {
        return next(err); // Pricing service throws HandleError already
    }

    // 2. Generate unique payment reference
    const reference = generatePaymentReference();

    // 3. Create pending order with locked prices
    try {
        const pendingOrder = await Order.create({
            user: userId,
            shippingInfo,
            orderItems: validatedOrder.orderItems,
            itemPrice: validatedOrder.itemPrice,
            taxPrice: validatedOrder.taxPrice,
            shippingPrice: validatedOrder.shippingPrice,
            totalPrice: validatedOrder.totalPrice,
            amountPaid: 0, // Not paid yet
            paymentInfo: {
                reference,
                status: "pending",
                method: gateway,
                currency: validatedOrder.currency,
                amount: validatedOrder.totalPrice
            },
            orderStatus: "Processing" // Will remain Processing until payment verified
        });

        // 4. Return payment initialization data to frontend
        return res.status(200).json({
            success: true,
            message: "Payment initialized successfully",
            data: {
                reference,
                orderId: pendingOrder._id,
                amount: validatedOrder.totalPrice,
                currency: validatedOrder.currency,
                gateway,
                // Frontend uses this to initialize payment with gateway
                orderItems: validatedOrder.orderItems.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price
                })),
                breakdown: {
                    itemPrice: validatedOrder.itemPrice,
                    taxPrice: validatedOrder.taxPrice,
                    shippingPrice: validatedOrder.shippingPrice,
                    totalPrice: validatedOrder.totalPrice
                }
            }
        });

    } catch (err) {
        console.error("Pending order creation failed:", err);
        return next(new HandleError("Failed to initialize payment", 500));
    }
});

/**
 * Verify Payment - Updates pending order after successful payment
 * @route POST /api/v1/payment/verify
 * @access Private
 */
export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new HandleError("User not authenticated", 401));
    }

    const { gateway, reference } = req.body;

    // 1. Get payment service for the gateway
    let paymentService;
    try {
        paymentService = PaymentFactory.getService(gateway);
    } catch (err) {
        return next(new HandleError(err.message, 400));
    }

    // 2. Find the pending order by reference
    const pendingOrder = await Order.findOne({
        "paymentInfo.reference": reference,
        user: userId
    });

    if (!pendingOrder) {
        return next(new HandleError("Order not found for this reference", 404));
    }

    // 3. Check if already processed (idempotency)
    if (pendingOrder.paymentInfo.status === "success") {
        return res.status(200).json({
            success: true,
            message: "Payment already verified",
            order: pendingOrder,
            idempotent: true
        });
    }

    // 4. Verify payment with gateway and update order
    try {
        const result = await paymentService.verifyAndUpdateOrder({
            reference,
            orderId: pendingOrder._id,
            expectedAmount: pendingOrder.totalPrice,
            expectedCurrency: pendingOrder.paymentInfo.currency,
            userId
        });

        // 5. Create receipt if payment was successful
        if (result.success) {
            try {
                await createReceiptIfNotExists({
                    orderId: result.order._id,
                    userId,
                    reference,
                    orderItems: result.order.orderItems,
                    itemPrice: result.order.itemPrice,
                    taxPrice: result.order.taxPrice,
                    shippingPrice: result.order.shippingPrice,
                    totalPrice: result.order.totalPrice,
                    shippingInfo: result.order.shippingInfo,
                    currency: result.order.paymentInfo.currency,
                    paymentGateway: gateway
                });
            } catch (receiptErr) {
                // Log but don't fail the verification
                console.error("Receipt creation failed:", receiptErr);
            }

            // Invalidate caches after successful payment
            await invalidatePaymentCaches();
        }

        return res.status(200).json({
            success: true,
            message: result.success 
                ? "Payment verified successfully" 
                : "Payment verification failed",
            order: result.order,
            idempotent: false
        });

    } catch (err) {
        console.error("Payment verification error:", err);
        
        // Update order status to failed
        try {
            pendingOrder.paymentInfo.status = "failed";
            await pendingOrder.save();
        } catch (saveErr) {
            console.error("Failed to update order status:", saveErr);
        }

        const status =
            err.message?.toLowerCase().includes("currency") ||
            err.message?.toLowerCase().includes("amount") ||
            err.message?.toLowerCase().includes("reference")
                ? 400
                : 500;

        return next(new HandleError(err.message, status));
    }
});