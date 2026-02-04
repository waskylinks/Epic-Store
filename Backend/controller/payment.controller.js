import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js"; 
import { createReceiptIfNotExists } from "../Services/receipt.service.js"; 
import { validateAndCalculateOrder } from "../Services/pricing.service.js";
import { deleteCachePattern } from '../utils/redis.js';
import { createPaymentSession, getPaymentSession, deletePaymentSession, createSessionAlias } from "../Services/paymentSession.service.js";
import Order from '../models/order-model.js';
import User from '../models/userModel.js';
import Product from '../models/product-model.js';
import crypto from 'crypto';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
import Cart from '../models/cart-model.js';

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
        return next(err);
    }

    // 3. ✅ Create payment session in Redis with OUR generated reference
    let reference;
    try {
        reference = await createPaymentSession({
            userId: userId.toString(),
            gateway,
            currency: validatedOrder.currency,
            shippingInfo,
            orderItems: validatedOrder.orderItems,
            itemPrice: validatedOrder.itemPrice,
            taxPrice: validatedOrder.taxPrice,
            shippingPrice: validatedOrder.shippingPrice,
            totalPrice: validatedOrder.totalPrice,
            userEmail: user.email,
            userName: user.name,
            validation: validatedOrder.validation
        });

        console.log(`✅ Payment session created in Redis: ${reference} (expires in 30min)`);
    } catch (err) {
        console.error("Payment session creation failed:", err);
        return next(new HandleError("Failed to initialize payment session", 500));
    }

    // 4. Initialize payment with the gateway
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
        
    } catch (err) {
        // ✅ If gateway fails, clean up the Redis session
        await deletePaymentSession(reference);
        
        console.error(`❌ ${gateway} initialization error:`, err);
        return next(new HandleError(
            `Failed to initialize ${gateway} payment: ${err.message}`, 
            500
        ));
    }

    // 5. ✅ CRITICAL FIX: For Stripe, create alias session with payment_intent_id
    if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
        try {
            await createSessionAlias(gatewayResponse.payment_intent_id, reference);
            console.log(`✅ Stripe alias created: ${gatewayResponse.payment_intent_id} → ${reference}`);
        } catch (err) {
            console.error("Failed to create Stripe alias:", err);
            // Continue anyway - this is not critical enough to fail the request
        }
    }

    // 6. Return payment initialization data to frontend
    const responseData = {
        reference,
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
 * Verify Payment - Creates order ONLY after successful payment verification
 * ✅ FIXED: Handles Stripe payment_intent_id lookup via alias
 * Verify Payment - with customer analytics and cart conversion tracking
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

    // 1. Get payment session from Redis
    const session = await getPaymentSession(reference);
    
    if (!session) {
        return next(new HandleError(
            "Payment session not found or expired. Please restart the payment process.",
            404
        ));
    }

    const orderReference = session.reference;

    // 2. Verify user owns this payment session
    if (session.userId !== userId.toString()) {
        return next(new HandleError("Unauthorized: Payment session does not belong to user", 403));
    }

    // 3. Verify gateway matches
    if (session.gateway !== gateway) {
        return next(new HandleError(
            `Gateway mismatch: session is for ${session.gateway}, not ${gateway}`,
            400
        ));
    }

    // 4. Check if order already exists (idempotency check)
    const existingOrder = await Order.findOne({
        $or: [
            { "paymentInfo.reference": orderReference },
            { "paymentInfo.stripePaymentIntentId": reference }
        ]
    });

    if (existingOrder) {
        console.log(`ℹ️ Order already exists for reference: ${orderReference}`);
        
        await deletePaymentSession(reference);
        if (reference !== orderReference) {
            await deletePaymentSession(orderReference);
        }
        
        return res.status(200).json({
            success: true,
            message: "Payment already verified",
            order: existingOrder,
            idempotent: true
        });
    }

    // 5. Get payment service for the gateway
    let paymentService;
    try {
        paymentService = PaymentFactory.getService(gateway);
    } catch (err) {
        return next(new HandleError(err.message, 400));
    }

    // 6. Verify payment with gateway
    let paymentVerified = false;
    let gatewayResponse = null;

    try {
        if (gateway === 'stripe') {
            gatewayResponse = await paymentService.verifyStripeTransaction(reference);
            paymentVerified = gatewayResponse.status === "succeeded";
        } else if (gateway === 'paystack') {
            gatewayResponse = await paymentService.verifyPaystackTransaction(reference);
            paymentVerified = gatewayResponse.status === "success";
        } else if (gateway === 'flutterwave') {
            gatewayResponse = await paymentService.verifyFlutterwaveTransaction(reference);
            paymentVerified = gatewayResponse.status === "successful";
        }

        if (!paymentVerified) {
            throw new Error(`Payment not successful. Status: ${gatewayResponse?.status}`);
        }

        console.log(`✅ ${gateway} payment verified successfully`);
    } catch (err) {
        console.error(`❌ ${gateway} verification failed:`, err);
        return next(new HandleError(
            `Payment verification failed: ${err.message}`,
            500
        ));
    }

    // 7. Validate amount and currency from gateway response
    let gatewayAmount, gatewayCurrency;
    
    if (gateway === 'stripe') {
        gatewayAmount = gatewayResponse.amount / 100;
        gatewayCurrency = gatewayResponse.currency.toUpperCase();
    } else if (gateway === 'paystack') {
        gatewayAmount = gatewayResponse.amount / 100;
        gatewayCurrency = gatewayResponse.currency;
    } else if (gateway === 'flutterwave') {
        gatewayAmount = parseFloat(gatewayResponse.amount);
        gatewayCurrency = gatewayResponse.currency;
    }

    if (gatewayCurrency !== session.currency) {
        return next(new HandleError(
            `Currency mismatch: expected ${session.currency}, got ${gatewayCurrency}`,
            400
        ));
    }

    if (Math.abs(session.totalPrice - gatewayAmount) > 0.01) {
        return next(new HandleError(
            `Amount mismatch: expected ${session.totalPrice}, gateway charged ${gatewayAmount}`,
            400
        ));
    }

    // 8. Create the order
    let order;
    try {
        order = await Order.create({
            user: userId,
            shippingInfo: session.shippingInfo,
            orderItems: session.orderItems,
            itemPrice: session.itemPrice,
            taxPrice: session.taxPrice,
            shippingPrice: session.shippingPrice,
            totalPrice: session.totalPrice,
            amountPaid: gatewayAmount,
            paymentInfo: {
                reference: orderReference,
                providerTxId: gatewayResponse.id || gatewayResponse.tx_id,
                stripePaymentIntentId: gateway === 'stripe' ? gatewayResponse.id : undefined,
                status: "success",
                method: gateway,
                currency: gatewayCurrency,
                amount: gatewayAmount,
                paidAt: new Date()
            },
            orderStatus: "Processing",
            // NEW: Add analytics data from session if available
            analytics: session.analytics || {
                source: 'direct',
                device: session.device,
                browser: session.browser
            }
        });

        // Store payment metadata
        if (gateway === 'stripe') {
            const paymentMethod = gatewayResponse.charges?.data[0]?.payment_method_details;
            order.paymentMeta = {
                channel: paymentMethod?.type || "card",
                customer: { email: gatewayResponse.receipt_email },
                cardDetails: paymentMethod?.card ? {
                    last4: paymentMethod.card.last4,
                    brand: paymentMethod.card.brand,
                    expMonth: paymentMethod.card.exp_month,
                    expYear: paymentMethod.card.exp_year
                } : undefined,
                customMetadata: gatewayResponse.metadata,
                raw: gatewayResponse
            };
        } else if (gateway === 'paystack') {
            order.paymentMeta = {
                channel: gatewayResponse.channel,
                ipAddress: gatewayResponse.ip_address,
                customer: gatewayResponse.customer,
                authorization: gatewayResponse.authorization,
                cardDetails: {
                    last4: gatewayResponse.authorization?.last4,
                    brand: gatewayResponse.authorization?.brand,
                    expMonth: gatewayResponse.authorization?.exp_month,
                    expYear: gatewayResponse.authorization?.exp_year
                },
                customMetadata: gatewayResponse.metadata,
                raw: gatewayResponse
            };
        } else if (gateway === 'flutterwave') {
            order.paymentMeta = {
                channel: gatewayResponse.payment_type,
                ipAddress: gatewayResponse.ip,
                customer: gatewayResponse.customer,
                cardDetails: gatewayResponse.card ? {
                    last4: gatewayResponse.card.last_4digits,
                    brand: gatewayResponse.card.type,
                    expMonth: gatewayResponse.card.expiry?.split('/')[0],
                    expYear: gatewayResponse.card.expiry?.split('/')[1]
                } : undefined,
                customMetadata: gatewayResponse.meta,
                raw: gatewayResponse
            };
        }

        await order.save();
        await order.populate('orderItems.product', 'name images price');

        console.log(`✅ Order created successfully: ${order._id} for reference: ${orderReference}`);

        // 9. Update product stock
        for (const item of session.orderItems) {
            try {
                const product = await Product.findById(item.product);
                if (product) {
                    if (product.inventory?.stock !== undefined) {
                        product.inventory.stock -= item.quantity;
                    } else if (product.stock !== undefined) {
                        product.stock -= item.quantity;
                    }
                    await product.save({ validateBeforeSave: false });
                }
            } catch (err) {
                console.error(`Failed to update stock for product ${item.product}:`, err);
            }
        }

        // 10. NEW: Mark cart as converted (if cart session exists)
        try {
            const cartSession = await Cart.findOne({
                user: userId,
                status: 'active'
            }).sort({ lastActivityAt: -1 }).limit(1);

            if (cartSession) {
                cartSession.markAsConverted(order._id);
                await cartSession.save();
                console.log(`✅ Cart session ${cartSession._id} marked as converted`);
            }
        } catch (cartErr) {
            console.error('Failed to mark cart as converted:', cartErr);
            // Don't fail the order if cart tracking fails
        }

        // 11. NEW: Sync customer analytics
        try {
            await syncCustomerAfterOrder(order._id);
            console.log(`✅ Customer analytics synced for user ${userId} after order ${order._id}`);
        } catch (analyticsErr) {
            console.error('Failed to sync customer analytics:', analyticsErr);
            // Don't fail the order if analytics sync fails
        }

    } catch (err) {
        console.error("❌ Order creation failed:", err);
        return next(new HandleError(
            "Payment verified but order creation failed. Please contact support with reference: " + orderReference,
            500
        ));
    }

    // 12. Create receipt
    try {
        const receipt = await createReceiptIfNotExists({
            orderId: order._id,
            userId,
            reference: orderReference,
            orderItems: order.orderItems,
            itemPrice: order.itemPrice,
            taxPrice: order.taxPrice,
            shippingPrice: order.shippingPrice,
            totalPrice: order.totalPrice,
            shippingInfo: order.shippingInfo,
            currency: order.paymentInfo.currency,
            paymentGateway: gateway
        });
        console.log(`✅ Receipt created: ${receipt._id}`);
    } catch (receiptErr) {
        console.error("❌ Receipt creation failed:", receiptErr);
    }

    // 13. Clean up Redis sessions
    await deletePaymentSession(reference);
    if (reference !== orderReference) {
        await deletePaymentSession(orderReference);
    }
    console.log(`✅ Payment sessions cleaned up: ${reference} & ${orderReference}`);

    // 14. Invalidate caches
    await invalidatePaymentCaches();

    return res.status(200).json({
        success: true,
        message: "Payment verified and order created successfully",
        order,
        idempotent: false
    });
});