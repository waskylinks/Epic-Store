import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js"; 
import { createReceiptIfNotExists } from "../Services/receipt.service.js"; 
import { validateAndCalculateOrder } from "../Services/pricing.service.js";
import { deleteCachePattern } from '../utils/redis.js';
import Order from '../models/order-model.js';
import User from '../models/userModel.js';
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
 * Initialize Payment - Creates pending order and returns gateway authorization URL
 * @route POST /api/v1/payment/initialize
 * @access Private
 */
export const initializePaymentController = handleAsyncError(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new HandleError("User not authenticated", 401));
    }

    const { gateway, currency, shippingInfo, cartItems } = req.body;

    // 1. Get user info for payment gateway
    const user = await User.findById(userId).select('email name');
    if (!user) {
        return next(new HandleError("User not found", 404));
    }

    // 2. Validate and calculate order totals using database prices
    let validatedOrder;
    try {
        validatedOrder = await validateAndCalculateOrder(cartItems, currency);
    } catch (err) {
        return next(err); // Pricing service throws HandleError already
    }

    // 3. Generate unique payment reference
    const reference = generatePaymentReference();

    // 4. Create pending order with locked prices
    let pendingOrder;
    try {
        pendingOrder = await Order.create({
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

        console.log(`✅ Pending order created: ${pendingOrder._id} with reference: ${reference}`);
    } catch (err) {
        console.error("Pending order creation failed:", err);
        return next(new HandleError("Failed to initialize payment", 500));
    }

    // 5. Initialize payment with the gateway
    let gatewayResponse = null;
    
    try {
        // Common parameters for all gateways
        const initParams = {
            email: user.email,
            amount: validatedOrder.totalPrice,
            currency: validatedOrder.currency,
            reference,
            userId: userId.toString(),
            orderReference: reference,
            itemCount: validatedOrder.orderItems.length,
            callback_url: `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}`,
            customer_name: user.name,
            customer_phone: shippingInfo.phoneNo
        };

        // Initialize payment using the factory
        gatewayResponse = await PaymentFactory.initializePayment(gateway, initParams);
        
        console.log(`✅ ${gateway} payment initialized for reference: ${reference}`);
        
        // ✅ OPTIONAL: Store payment intent ID for Stripe (for better security)
        if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
            pendingOrder.paymentInfo.stripePaymentIntentId = gatewayResponse.payment_intent_id;
            await pendingOrder.save();
            console.log(`✅ Stripe payment intent ID stored: ${gatewayResponse.payment_intent_id}`);
        }
        
    } catch (err) {
        // If gateway initialization fails, mark order as failed and clean up
        pendingOrder.paymentInfo.status = "failed";
        await pendingOrder.save();
        
        console.error(`❌ ${gateway} initialization error:`, err);
        return next(new HandleError(
            `Failed to initialize ${gateway} payment: ${err.message}`, 
            500
        ));
    }

    // 6. Return payment initialization data to frontend
    const responseData = {
        reference,
        orderId: pendingOrder._id,
        amount: validatedOrder.totalPrice,
        currency: validatedOrder.currency,
        gateway,
        // Order details for display
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
    };

    // Add gateway-specific data
    if (gateway === 'paystack') {
        responseData.authorization_url = gatewayResponse.authorization_url;
        responseData.access_code = gatewayResponse.access_code;
    } else if (gateway === 'flutterwave') {
        responseData.payment_link = gatewayResponse.payment_link;
    } else if (gateway === 'stripe') {
        responseData.client_secret = gatewayResponse.client_secret;
        responseData.payment_intent_id = gatewayResponse.payment_intent_id;
    }

    return res.status(200).json({
        success: true,
        message: "Payment initialized successfully",
        data: responseData
    });
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

    console.log(`🔍 Verifying ${gateway} payment with reference: ${reference}`);

    // 1. Get payment service for the gateway
    let paymentService;
    try {
        paymentService = PaymentFactory.getService(gateway);
    } catch (err) {
        return next(new HandleError(err.message, 400));
    }

    // 2. Find the pending order
    // ✅ IMPROVED: For Stripe, also search by payment intent ID if available
    let pendingOrder;
    
    if (gateway === 'stripe' && reference.startsWith('pi_')) {
        // Stripe: reference is payment_intent_id
        pendingOrder = await Order.findOne({
            "paymentInfo.stripePaymentIntentId": reference,
            user: userId
        });
        
        // Fallback to reference search if not found by payment intent ID
        if (!pendingOrder) {
            pendingOrder = await Order.findOne({
                "paymentInfo.reference": reference,
                user: userId
            });
        }
    } else {
        // Flutterwave and Paystack: search by reference
        pendingOrder = await Order.findOne({
            "paymentInfo.reference": reference,
            user: userId
        });
    }

    if (!pendingOrder) {
        console.error(`❌ Order not found for ${gateway} reference: ${reference}`);
        return next(new HandleError("Order not found for this reference", 404));
    }

    console.log(`✅ Order found: ${pendingOrder._id}`);

    // 3. Check if already processed (idempotency)
    if (pendingOrder.paymentInfo.status === "success") {
        console.log(`ℹ️ Payment already verified for order: ${pendingOrder._id}`);
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

        console.log(`✅ ${gateway} payment verified for order: ${pendingOrder._id}`);

        // 5. Create receipt if payment was successful
        if (result.success) {
            try {
                const receipt = await createReceiptIfNotExists({
                    orderId: result.order._id,
                    userId,
                    reference: pendingOrder.paymentInfo.reference, // Use original order reference
                    orderItems: result.order.orderItems,
                    itemPrice: result.order.itemPrice,
                    taxPrice: result.order.taxPrice,
                    shippingPrice: result.order.shippingPrice,
                    totalPrice: result.order.totalPrice,
                    shippingInfo: result.order.shippingInfo,
                    currency: result.order.paymentInfo.currency,
                    paymentGateway: gateway
                });
                console.log(`✅ Receipt created: ${receipt._id}`);
            } catch (receiptErr) {
                // Log but don't fail the verification
                console.error("❌ Receipt creation failed:", receiptErr);
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
        console.error(`❌ ${gateway} verification error:`, err);
        
        // Update order status to failed
        try {
            pendingOrder.paymentInfo.status = "failed";
            await pendingOrder.save();
            console.log(`⚠️ Order marked as failed: ${pendingOrder._id}`);
        } catch (saveErr) {
            console.error("Failed to update order status:", saveErr);
        }

        // ✅ IMPROVED: Return specific error message from gateway
        return next(new HandleError(
            `Payment verification failed: ${err.message}`,
            err.message?.includes("currency") || 
            err.message?.includes("amount") ||
            err.message?.includes("mismatch") ? 400 : 500
        ));
    }
});