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
import Discount from '../models/discount-model.js';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
import Checkout from '../models/checkout-model.js';
import mongoose from 'mongoose';

// Helper: Invalidate payment-related caches
const invalidatePaymentCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*'),
            deleteCachePattern('customer_*'),
            deleteCachePattern('fraud_analytics*'),
            deleteCachePattern('payment_*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
    }
};

/**
 * Calculate fraud risk score
 */
const calculateFraudRisk = (order, user) => {
    let riskScore = 0;
    const flags = [];

    // High order value
    if (order.totalPrice > 1000) {
        riskScore += 20;
        flags.push('high_order_value');
    }

    // New account (less than 7 days)
    const accountAge = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (accountAge < 7) {
        riskScore += 30;
        flags.push('new_account');
    }

    // Very new account (less than 24 hours)
    if (accountAge < 1) {
        riskScore += 20;
        flags.push('very_new_account');
    }

    // First purchase with high value
    if (!user.orderHistory || user.orderHistory.length === 0) {
        if (order.totalPrice > 500) {
            riskScore += 15;
            flags.push('first_purchase_high_value');
        }
    }

    // Shipping and billing address mismatch (if available)
    if (order.shippingInfo?.address !== order.billingAddress) {
        riskScore += 15;
        flags.push('address_mismatch');
    }

    // Multiple high-value items
    if (order.orderItems && order.orderItems.length > 5) {
        riskScore += 10;
        flags.push('many_items');
    }

    // International shipping (if country differs from user's country)
    if (order.shippingInfo?.country && user.country && 
        order.shippingInfo.country !== user.country) {
        riskScore += 10;
        flags.push('international_shipping');
    }

    // Determine risk level
    let riskLevel = 'low';
    let reviewRequired = false;

    if (riskScore >= 70) {
        riskLevel = 'critical';
        reviewRequired = true;
    } else if (riskScore >= 50) {
        riskLevel = 'high';
        reviewRequired = true;
    } else if (riskScore >= 30) {
        riskLevel = 'medium';
    }

    return {
        riskScore,
        riskLevel,
        flags,
        reviewRequired,
        reviewDecision: reviewRequired ? 'Pending' : 'Approved',
        checkedAt: new Date()
    };
};

/**
 * Calculate fulfillment SLA
 */
const calculateFulfillmentSLA = (orderDate, currentStatus) => {
    const now = new Date();
    const hoursSinceOrder = (now - orderDate) / (1000 * 60 * 60);
    
    // Standard SLA: 24 hours for processing, 72 hours for shipping
    const processingTarget = 24;
    const shippingTarget = 72;
    
    let targetHours = processingTarget;
    if (currentStatus === 'Shipped' || currentStatus === 'Delivered') {
        targetHours = shippingTarget;
    }
    
    const slaBreached = hoursSinceOrder > targetHours;
    const delayInHours = slaBreached ? hoursSinceOrder - targetHours : 0;
    
    return {
        targetFulfillmentHours: targetHours,
        actualFulfillmentHours: hoursSinceOrder,
        slaBreached,
        delayInHours,
        delayInDays: delayInHours / 24,
        calculatedAt: now
    };
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

    const { gateway, currency, shippingInfo, cartItems, discountCode } = req.body;

    // Validate required fields
    if (!gateway || !currency || !shippingInfo || !cartItems || cartItems.length === 0) {
        return next(new HandleError("Missing required fields", 400));
    }

    // 1. Get user info for payment gateway
    const user = await User.findById(userId).select('email name country createdAt');
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

    // 3. APPLY DISCOUNT IF PROVIDED
    let discountInfo = null;
    let finalTotalPrice = validatedOrder.totalPrice;

    if (discountCode) {
        try {
            const discount = await Discount.findActiveByCode(discountCode);

            if (!discount) {
                return next(new HandleError('Invalid or expired discount code', 400));
            }

            // Check if user can use this discount
            const canUse = await discount.canUserUse(userId);
            if (!canUse.canUse) {
                return next(new HandleError(canUse.reason, 400));
            }

            // Validate cart against discount conditions
            const validation = discount.validateCart(validatedOrder.itemPrice, cartItems, userId);
            if (!validation.valid) {
                return next(new HandleError(validation.reason, 400));
            }

            // Calculate discount amount
            const discountAmount = discount.calculateDiscount(validatedOrder.itemPrice, cartItems);

            // Recalculate totals with discount
            const discountedItemPrice = Math.max(0, validatedOrder.itemPrice - discountAmount);
            const taxPrice = Math.round(discountedItemPrice * 0.18 * 100) / 100;
            const shippingPrice = discountedItemPrice >= 500 ? 0 : 50;
            finalTotalPrice = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

            // Store discount info for session
            discountInfo = {
                code: discount.code,
                discountId: discount._id,
                type: discount.type,
                value: discount.value,
                discountAmount: Math.round(discountAmount * 100) / 100,
                description: discount.description
            };

            // Update validated order with discounted values
            validatedOrder.itemPrice = Math.round(discountedItemPrice * 100) / 100;
            validatedOrder.taxPrice = taxPrice;
            validatedOrder.shippingPrice = shippingPrice;
            validatedOrder.totalPrice = finalTotalPrice;

            console.log(`✅ Discount applied: ${discount.code} - $${discountAmount}`);
        } catch (err) {
            console.error('Discount application error:', err);
            return next(new HandleError('Failed to apply discount code', 500));
        }
    }

    // 4. Capture attribution data from request
    const attributionData = req.attributionData || {
        source: 'direct',
        medium: null,
        campaign: null,
        referrer: null,
        landingPage: null
    };

    const deviceInfo = req.deviceInfo || {
        device: 'desktop',
        browser: 'unknown'
    };

    // 5. Create payment session in Redis with attribution and discount data
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
            validation: validatedOrder.validation,
            discount: discountInfo,
            analytics: {
                source: attributionData.source,
                medium: attributionData.medium,
                campaign: attributionData.campaign,
                referrer: attributionData.referrer,
                landingPage: attributionData.landingPage,
                device: deviceInfo.device,
                browser: deviceInfo.browser
            },
            createdAt: Date.now() // Add timestamp for expiry checking
        });

        console.log(`✅ Payment session created: ${reference}`);
    } catch (err) {
        console.error("Payment session creation failed:", err);
        return next(new HandleError("Failed to initialize payment session", 500));
    }

    // 6. Initialize payment with the gateway
    let gatewayResponse = null;
    
    try {
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

        gatewayResponse = await PaymentFactory.initializePayment(gateway, initParams);
        console.log(`✅ ${gateway} payment initialized for reference: ${reference}`);
        
    } catch (err) {
        await deletePaymentSession(reference);
        console.error(`❌ ${gateway} initialization error:`, err);
        return next(new HandleError(
            `Failed to initialize ${gateway} payment: ${err.message}`, 
            500
        ));
    }

    // 7. For Stripe, create alias session with payment_intent_id
    if (gateway === 'stripe' && gatewayResponse.payment_intent_id) {
        try {
            await createSessionAlias(gatewayResponse.payment_intent_id, reference);
            console.log(`✅ Stripe alias created: ${gatewayResponse.payment_intent_id} → ${reference}`);
        } catch (err) {
            console.error("Failed to create Stripe alias:", err);
        }
    }

    // 8. Return payment initialization data
    const responseData = {
        reference,
        amount: validatedOrder.totalPrice,
        currency: validatedOrder.currency,
        gateway,
        orderItems: validatedOrder.orderItems.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price
        })),
        breakdown: {
            itemPrice: validatedOrder.itemPrice,
            taxPrice: validatedOrder.taxPrice,
            shippingPrice: validatedOrder.shippingPrice,
            totalPrice: validatedOrder.totalPrice,
            ...(discountInfo && {
                discount: {
                    code: discountInfo.code,
                    amount: discountInfo.discountAmount
                }
            })
        }
    };

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
 * Verify Payment - Creates order with complete analytics tracking
 * @route POST /api/v1/payment/verify
 * @access Private
 */
export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new HandleError("User not authenticated", 401));
    }

    const { gateway, reference } = req.body;

    if (!gateway || !reference) {
        return next(new HandleError("Gateway and reference are required", 400));
    }

    console.log(`🔍 Verifying ${gateway} payment with reference: ${reference}`);

    // 1. Get payment session from Redis
    const session = await getPaymentSession(reference);
    
    if (!session) {
        return next(new HandleError(
            "Payment session not found or expired. Please restart the payment process.",
            404
        ));
    }

    // Validate session structure
    if (!session.orderItems || !session.shippingInfo || !session.totalPrice) {
        await deletePaymentSession(reference);
        return next(new HandleError("Invalid payment session data", 400));
    }

    // Check session expiry (30 minutes)
    if (session.createdAt && Date.now() - session.createdAt > 30 * 60 * 1000) {
        await deletePaymentSession(reference);
        return next(new HandleError("Payment session expired. Please restart the payment process.", 400));
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

    // 4. Check if order already exists (idempotency) - BEFORE payment verification
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

    // 5. Get payment service
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

    // 7. Validate amount and currency
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

    // Use slightly higher tolerance for amount comparison
    const tolerance = session.currency === 'USD' ? 0.02 : 0.05;
    if (Math.abs(session.totalPrice - gatewayAmount) > tolerance) {
        return next(new HandleError(
            `Amount mismatch: expected ${session.totalPrice}, gateway charged ${gatewayAmount}`,
            400
        ));
    }

    // 8. Get user for fraud check
    const user = await User.findById(userId).select('email name country createdAt');
    if (!user) {
        return next(new HandleError("User not found", 404));
    }

    // 9. Calculate isFirstPurchase and purchaseNumber
    const userOrderCount = await Order.countDocuments({
        user: userId,
        'paymentInfo.status': 'success'
    });

    const isFirstPurchase = userOrderCount === 0;
    const purchaseNumber = userOrderCount + 1;

    // ═══════════════════════════════════════════════════════════════
    // ATOMIC TRANSACTION SECTION - All critical operations together
    // ═══════════════════════════════════════════════════════════════
    
    let order;
    const mongoSession = await mongoose.startSession();
    
    try {
        await mongoSession.startTransaction();

        // 10. Validate stock availability BEFORE creating order
        for (const item of session.orderItems) {
            const product = await Product.findById(item.product).session(mongoSession);
            if (!product) {
                throw new Error(`Product ${item.product} not found`);
            }

            const currentStock = product.inventory?.stock ?? product.stock ?? 0;
            if (currentStock < item.quantity) {
                throw new Error(`Insufficient stock for ${product.name}. Available: ${currentStock}, Requested: ${item.quantity}`);
            }
        }

        // 11. Calculate fraud risk score
        const fraudCheck = calculateFraudRisk({
            totalPrice: session.totalPrice,
            shippingInfo: session.shippingInfo,
            orderItems: session.orderItems,
            billingAddress: gatewayResponse.customer?.billing_address || null
        }, user);

        // 12. Calculate initial SLA
        const orderDate = new Date();
        const fulfillmentSLA = calculateFulfillmentSLA(orderDate, 'Processing');

        // 13. Create the order with complete analytics and operational data
        const orderData = {
            user: userId,
            shippingInfo: session.shippingInfo,
            orderItems: session.orderItems,
            itemPrice: session.itemPrice,
            taxPrice: session.taxPrice,
            shippingPrice: session.shippingPrice,
            totalPrice: session.totalPrice,
            amountPaid: gatewayAmount,
            ...(session.discount && {
                discounts: {
                    codes: [{
                        code: session.discount.code,
                        amount: session.discount.discountAmount,
                        type: session.discount.type
                    }],
                    totalDiscount: session.discount.discountAmount
                }
            }),
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
            analytics: {
                source: session.analytics?.source || 'direct',
                medium: session.analytics?.medium || null,
                campaign: session.analytics?.campaign || null,
                referrer: session.analytics?.referrer || null,
                landingPage: session.analytics?.landingPage || null,
                device: session.analytics?.device || 'desktop',
                browser: session.analytics?.browser || 'unknown',
                customerSegment: null,
                isFirstPurchase,
                purchaseNumber
            },
            fraudCheck,
            fulfillmentSLA
        };

        // Store payment metadata
        if (gateway === 'stripe') {
            const paymentMethod = gatewayResponse.charges?.data[0]?.payment_method_details;
            orderData.paymentMeta = {
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
            orderData.paymentMeta = {
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
            orderData.paymentMeta = {
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

        // Create order within transaction
        const [createdOrder] = await Order.create([orderData], { session: mongoSession });
        order = createdOrder;

        console.log(`✅ Order created: ${order._id}`);

        // 14. Update product stock atomically
        for (const item of session.orderItems) {
            const product = await Product.findById(item.product).session(mongoSession);
            if (product) {
                // Use atomic decrement
                const stockField = product.inventory?.stock !== undefined ? 'inventory.stock' : 'stock';
                await Product.findByIdAndUpdate(
                    item.product,
                    { $inc: { [stockField]: -item.quantity } },
                    { session: mongoSession, new: true }
                );
                console.log(`✅ Stock updated for ${product.name}: -${item.quantity}`);
            }
        }

        // 15. Mark checkout as converted (if exists)
        try {
            const checkout = await Checkout.findOne({
                user: userId,
                status: 'pending'
            })
            .sort({ lastActivityAt: -1 })
            .session(mongoSession);

            if (checkout) {
                checkout.markAsConverted(order._id, orderReference);
                await checkout.save({ session: mongoSession });
                console.log(`✅ Checkout converted: ${checkout._id}`);
            }
        } catch (checkoutErr) {
            console.error('Failed to mark checkout as converted:', checkoutErr);
            // Don't throw - this is not critical
        }

        // Commit transaction - all operations succeeded
        await mongoSession.commitTransaction();
        console.log(`✅ Transaction committed successfully`);

    } catch (err) {
        // Rollback on any error
        await mongoSession.abortTransaction();
        console.error("❌ Transaction failed, rolling back:", err);
        
        return next(new HandleError(
            `Payment verified but order creation failed: ${err.message}. Please contact support with reference: ${orderReference}`,
            500
        ));
    } finally {
        mongoSession.endSession();
    }

    // ═══════════════════════════════════════════════════════════════
    // POST-TRANSACTION OPERATIONS (non-critical, can fail gracefully)
    // ═══════════════════════════════════════════════════════════════

    // 16. Record discount usage (AFTER transaction commits)
    if (session.discount?.discountId) {
        try {
            const discount = await Discount.findById(session.discount.discountId);
            if (discount) {
                await discount.recordUsage(userId, order._id, session.discount.discountAmount);
                console.log(`✅ Discount usage recorded: ${session.discount.code} for order ${order._id}`);
            }
        } catch (err) {
            console.error('❌ Failed to record discount usage:', err);
            // Non-critical - order is already created successfully
        }
    }

    // 17. Populate order items for response
    try {
        await order.populate('orderItems.product', 'name images pricing');
    } catch (err) {
        console.error('Failed to populate order items:', err);
    }

    // 18. Sync customer analytics (async, non-blocking)
    syncCustomerAfterOrder(order._id)
        .then(() => console.log(`✅ Customer analytics synced for order ${order._id}`))
        .catch(err => console.error('Failed to sync customer analytics:', err));

    // 19. Create receipt (async, non-blocking)
    createReceiptIfNotExists({
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
    })
        .then(receipt => console.log(`✅ Receipt created: ${receipt._id}`))
        .catch(err => console.error("❌ Receipt creation failed:", err));

    // 20. Clean up Redis sessions
    Promise.all([
        deletePaymentSession(reference),
        reference !== orderReference ? deletePaymentSession(orderReference) : Promise.resolve()
    ])
        .then(() => console.log(`✅ Sessions cleaned up`))
        .catch(err => console.error('Failed to clean up sessions:', err));

    // 21. Invalidate caches (async, non-blocking)
    invalidatePaymentCaches()
        .then(() => console.log(`✅ Caches invalidated`))
        .catch(err => console.error('Failed to invalidate caches:', err));

    return res.status(200).json({
        success: true,
        message: "Payment verified and order created successfully",
        order,
        idempotent: false
    });
});