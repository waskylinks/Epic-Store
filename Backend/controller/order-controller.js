import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';
import { PaymentFactory } from '../Services/payment/paymentFactory.js';

// Helper: Check if we're in test/development mode
const isTestMode = () => {
  return process.env.NODE_ENV === 'development' || 
         process.env.PAYMENT_TEST_MODE === 'true';
};

// Helper: Invalidate analytics caches
const invalidateAnalyticsCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
        // Don't block the request if cache fails
    }
};

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

    // Invalidate caches after creating order
    await invalidateAnalyticsCaches();

    res.status(200).json({
        success: true,
        order
    });
});

//all orders 
export const allMyOrders = handleAsyncError(async (req, res, next) => {
    const orders = await Order.find({
        user: req.user._id
    });
    if(!orders) {
        return next(new HandleError('No order found', 404));
    }

    res.status(200).json({
        success: true,
        orders
    })
});

//admin- getting single order
export const getSingleOrder = handleAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id).populate('user', 'name email')
    if(!order) {
        return next(new HandleError('No order found', 404));
    }

    res.status(200).json({
        success: true,
        order
    });
});

// admin- getting all orders placed by users
export const getAllOrders = handleAsyncError(async (req, res, next) => {
    const orders = await Order.find().populate('user', 'name email');

    let totalAmount = 0;
    orders.forEach(order => {
        totalAmount += order.totalPrice;
    });

    res.status(200).json({
        success: true,
        orders,
        totalAmount
    });
});

// admin- update order status
/**
 * Auto-refund on cancel with test mode handling
 */
export const updateOrderStatus = handleAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        return next(new HandleError('Order not found', 404));
    }

    if (order.orderStatus === 'Delivered') {
        return next(new HandleError("This order has already been delivered", 400));
    }

    const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!req.body.status || !validStatuses.includes(req.body.status)) {
        return next(new HandleError('Invalid order status', 400));
    }

    // HANDLE CANCELLATION WITH AUTO-REFUND
    if (req.body.status === 'Cancelled') {
        // 1. Restore stock
        try {
            await Promise.all(
                order.orderItems.map(async (item) => {
                    const product = await Product.findById(item.product);
                    if (product) {
                        product.stock += item.quantity;
                        await product.save({ validateBeforeSave: false });
                    }
                })
            );
            console.log(`✅ Stock restored for cancelled order ${order._id}`);
        } catch (error) {
            console.error("❌ Stock restoration failed:", error);
            return next(error);
        }

        // 2. Auto-refund if payment was successful
        if (order.paymentInfo.status === "success" && 
            (!order.refundInfo || order.refundInfo.status === "none")) {
            
            const gateway = order.paymentInfo.method;
            const supportedGateways = ['paystack', 'flutterwave', 'stripe'];

            if (supportedGateways.includes(gateway)) {
                let refundResponse;
                let refundStatus = "processing";

                // ✅ TEST MODE HANDLING
                if (isTestMode()) {
                    console.log(`🧪 TEST MODE: Simulating auto-refund for cancelled order ${order._id}...`);
                    
                    refundResponse = {
                        refundId: `test_refund_${Date.now()}`,
                        status: "completed", // ✅ Auto-complete in test mode
                        amount: order.amountPaid,
                        currency: order.paymentInfo.currency,
                        raw: {
                            test_mode: true,
                            message: "Auto-refund completed in test mode"
                        }
                    };
                    
                    refundStatus = "completed";
                    console.log(`✅ TEST MODE: Auto-refund completed`);
                } else {
                    // PRODUCTION MODE
                    try {
                        console.log(`🔄 Auto-refunding cancelled order ${order._id} via ${gateway}...`);

                        let refundParams;
                        
                        if (gateway === "paystack") {
                            refundParams = {
                                transactionReference: order.paymentInfo.reference,
                                reason: "Order cancelled by admin",
                                merchantNote: req.body.cancellationReason || "Order cancelled"
                            };
                        } else if (gateway === "flutterwave") {
                            refundParams = {
                                transactionId: order.paymentInfo.providerTxId,
                                reason: "Order cancelled by admin",
                                merchantNote: req.body.cancellationReason || "Order cancelled"
                            };
                        } else if (gateway === "stripe") {
                            refundParams = {
                                paymentIntentId: order.paymentInfo.stripePaymentIntentId || order.paymentInfo.providerTxId,
                                reason: "requested_by_customer",
                                merchantNote: req.body.cancellationReason || "Order cancelled"
                            };
                        }

                        refundResponse = await PaymentFactory.refundPayment(gateway, refundParams);

                        const gatewayStatus = refundResponse.status?.toLowerCase();
                        if (gatewayStatus === "succeeded" || gatewayStatus === "success" || gatewayStatus === "completed") {
                            refundStatus = "completed";
                        } else if (gatewayStatus === "failed") {
                            refundStatus = "failed";
                        }

                        console.log(`✅ Refund ${refundStatus} for cancelled order ${order._id}`);
                    } catch (refundError) {
                        console.error("❌ Auto-refund failed:", refundError);
                        
                        order.refundInfo = {
                            status: "failed",
                            reason: "Order cancelled by admin",
                            description: "Automatic refund failed - requires manual processing",
                            failureReason: refundError.message,
                            requestedAt: new Date(),
                            requestedBy: req.user._id
                        };

                        console.error(`⚠️ MANUAL REFUND REQUIRED for order ${order._id} - ${refundError.message}`);
                        
                        // Still proceed with cancellation
                        order.cancelledAt = Date.now();
                        order.cancellationReason = req.body.cancellationReason || "Cancelled by admin";
                        order.orderStatus = req.body.status;
                        await order.save({ validateBeforeSave: false });
                        await invalidateAnalyticsCaches();
                        
                        return res.status(200).json({
                            success: true,
                            order,
                            message: 'Order cancelled but refund failed. Manual refund required.'
                        });
                    }
                }

                // Update order with refund details
                order.refundInfo = {
                    status: refundStatus,
                    reason: "Order cancelled by admin",
                    description: req.body.cancellationReason || "Order was cancelled",
                    refundType: "full",
                    requestedAmount: order.amountPaid,
                    requestedAt: new Date(),
                    requestedBy: req.user._id,
                    approvedAt: new Date(),
                    approvedBy: req.user._id,
                    adminNote: isTestMode() 
                        ? "Auto-approved due to order cancellation (Test Mode)" 
                        : "Auto-approved due to order cancellation",
                    refundId: refundResponse.refundId,
                    refundAmount: refundResponse.amount,
                    refundCurrency: refundResponse.currency,
                    processedAt: new Date(),
                    processedBy: req.user._id,
                    gatewayResponse: refundResponse.raw
                };
            } else {
                console.warn(`⚠️ Manual refund required for ${gateway} payment on order ${order._id}`);
                
                order.refundInfo = {
                    status: "requested",
                    reason: "Order cancelled - manual refund required",
                    description: `Payment gateway ${gateway} requires manual refund processing`,
                    requestedAt: new Date(),
                    requestedBy: req.user._id
                };
            }
        }

        order.cancelledAt = Date.now();
        order.cancellationReason = req.body.cancellationReason || "Cancelled by admin";
    }

    // HANDLE DELIVERY
    if (req.body.status === 'Delivered') {
        try {
            await Promise.all(
                order.orderItems.map(async (item) => {
                    await updateQuantity(item.product.toString(), item.quantity);
                })
            );
            order.deliveredAt = Date.now();
        } catch (error) {
            return next(error);
        }
    }

    order.orderStatus = req.body.status;
    await order.save({ validateBeforeSave: false });
    await invalidateAnalyticsCaches();

    let responseMessage = 'Order updated successfully';
    if (req.body.status === 'Cancelled' && order.refundInfo && order.refundInfo.status !== 'none') {
        responseMessage = `Order cancelled. Refund status: ${order.refundInfo.status}${isTestMode() ? ' (Test Mode)' : ''}`;
    }

    res.status(200).json({
        success: true,
        order,
        message: responseMessage
    });
});

async function updateQuantity(id, quantity) {
    const product = await Product.findById(id);
    if (!product) {
        throw new HandleError(`Product not found with id: ${id}`, 404);
    }
    if (product.stock < quantity) {
        throw new HandleError(`Only ${product.stock} units available for ${product.name}`, 400);
    }
    product.stock -= quantity;
    await product.save({ validateBeforeSave: false });
}

// Delete order 
export const deleteOrder = handleAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        return next(new HandleError("Order not found", 404));
    }

    if (order.orderStatus !== 'Delivered') {
        return next(new HandleError("Cannot delete order that is not delivered", 400));
    }

    await Order.findByIdAndDelete(req.params.id);

    // Invalidate caches after deleting order
    await invalidateAnalyticsCaches();

    res.status(200).json({
        success: true,
        message: 'Order deleted successfully'
    });
});

/**
 * Get order by payment reference
 * Used by success page to display order details
 * @route GET /api/v1/orders/reference/:reference
 * @access Private
 */
export const getOrderByReference = handleAsyncError(async (req, res, next) => {
  const { reference } = req.params;
  const userId = req.user._id;

  // Find order by payment reference
  const order = await Order.findOne({
    "paymentInfo.reference": reference,
    user: userId
  }).populate('orderItems.product', 'name images');

  if (!order) {
    return next(new HandleError("Order not found for this reference", 404));
  }

  // Return order details
  return res.status(200).json({
    success: true,
    order
  });
});


// REFUND CONTROLLER FUNCTIONS


/**
 * User requests a refund for their order
 * @route POST /api/v1/orders/:orderId/refund/request
 * @access Private (User who owns the order)
 */
export const requestRefund = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const { reason, description, refundType, requestedAmount } = req.body;
  const userId = req.user._id;

  // Order was already validated by checkRefundEligibility middleware
  // So we can safely fetch it again or use req.order if middleware attaches it
  const order = await Order.findById(orderId);

  if (!order) {
    return next(new HandleError("Order not found", 404));
  }

  // Verify ownership (double-check even though middleware did it)
  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError("Unauthorized", 403));
  }

  // Create refund request
  order.refundInfo = {
    status: "requested",
    reason: reason,
    description: description,
    refundType: refundType || "full",
    requestedAmount: refundType === "partial" ? requestedAmount : undefined,
    requestedAt: new Date(),
    requestedBy: userId
  };

  await order.save();

  // Invalidate caches
  await invalidateAnalyticsCaches();

  return res.status(200).json({
    success: true,
    message: "Refund request submitted successfully. Our team will review it shortly.",
    order: {
      _id: order._id,
      refundInfo: order.refundInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice
    }
  });
});

/**
 * Admin approves/rejects refund request
 * @route PUT /api/v1/admin/orders/:orderId/refund/review
 * @access Private (Admin only)
 */
export const reviewRefundRequest = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const { action, adminNote } = req.body;

  const order = await Order.findById(orderId);

  if (!order) {
    return next(new HandleError("Order not found", 404));
  }

  // Check if refund was requested
  if (!order.refundInfo || order.refundInfo.status !== "requested") {
    return next(new HandleError(
      `No pending refund request for this order. Current status: ${order.refundInfo?.status || "none"}`,
      400
    ));
  }

  // Approve or reject
  if (action === "approve") {
    order.refundInfo.status = "approved";
    order.refundInfo.approvedAt = new Date();
    order.refundInfo.approvedBy = req.user._id;
    order.refundInfo.adminNote = adminNote;

    await order.save();
    await invalidateAnalyticsCaches();

    return res.status(200).json({
      success: true,
      message: "Refund request approved. You can now process the refund.",
      order
    });

  } else if (action === "reject") {
    order.refundInfo.status = "rejected";
    order.refundInfo.rejectedAt = new Date();
    order.refundInfo.rejectedBy = req.user._id;
    order.refundInfo.adminNote = adminNote;

    await order.save();
    await invalidateAnalyticsCaches();

    return res.status(200).json({
      success: true,
      message: "Refund request rejected",
      order
    });

  } else {
    return next(new HandleError("Invalid action. Must be 'approve' or 'reject'", 400));
  }
});

/**
 * Admin processes the actual refund (calls payment gateway)
 * @route POST /api/v1/admin/orders/:orderId/refund/process
 * @access Private (Admin only)
 */

/**
 * Process refund with test mode handling
 */
export const processRefund = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const { refundAmount, merchantNote } = req.body;

  const order = await Order.findById(orderId);
  if (!order) {
    return next(new HandleError("Order not found", 404));
  }

  const maxRefundAmount = order.amountPaid;
  const finalRefundAmount = refundAmount || maxRefundAmount;

  if (finalRefundAmount > maxRefundAmount) {
    return next(new HandleError(
      `Refund amount cannot exceed ${maxRefundAmount} ${order.paymentInfo.currency}`,
      400
    ));
  }

  const gateway = order.paymentInfo.method;

  // Build gateway-specific refund parameters
  let refundParams;
  
  if (gateway === "paystack") {
    refundParams = {
      transactionReference: order.paymentInfo.reference,
      amount: finalRefundAmount < maxRefundAmount ? finalRefundAmount : undefined,
      reason: order.refundInfo.reason,
      merchantNote: merchantNote
    };
  } else if (gateway === "flutterwave") {
    refundParams = {
      transactionId: order.paymentInfo.providerTxId,
      amount: finalRefundAmount < maxRefundAmount ? finalRefundAmount : undefined,
      reason: order.refundInfo.reason,
      merchantNote: merchantNote
    };
  } else if (gateway === "stripe") {
    refundParams = {
      paymentIntentId: order.paymentInfo.stripePaymentIntentId || order.paymentInfo.providerTxId,
      amount: finalRefundAmount < maxRefundAmount ? finalRefundAmount : undefined,
      reason: "requested_by_customer",
      merchantNote: merchantNote
    };
  } else {
    return next(new HandleError(`Unsupported payment gateway: ${gateway}`, 400));
  }

  let refundResponse;
  let finalStatus = "processing";
  
  // ✅ TEST MODE HANDLING
  if (isTestMode()) {
    console.log(`🧪 TEST MODE: Simulating refund for order ${orderId}...`);
    
    // Simulate gateway response in test mode
    refundResponse = {
      success: true,
      refundId: `test_refund_${Date.now()}`,
      status: "completed", // ✅ Auto-complete in test mode
      amount: finalRefundAmount,
      currency: order.paymentInfo.currency,
      raw: {
        test_mode: true,
        message: "Refund completed in test mode"
      }
    };
    
    finalStatus = "completed";
    console.log(`✅ TEST MODE: Refund auto-completed`);
  } else {
    // PRODUCTION MODE: Call actual gateway
    try {
      console.log(`🔄 PRODUCTION: Processing ${gateway} refund for order ${orderId}...`);
      refundResponse = await PaymentFactory.refundPayment(gateway, refundParams);
      console.log(`✅ Refund response:`, refundResponse);
      
      // Map gateway status
      const gatewayStatus = refundResponse.status?.toLowerCase();
      if (gatewayStatus === "succeeded" || gatewayStatus === "success" || gatewayStatus === "completed") {
        finalStatus = "completed";
      } else if (gatewayStatus === "failed") {
        finalStatus = "failed";
      } else {
        finalStatus = "processing";
      }
    } catch (error) {
      console.error("❌ Refund processing error:", error);
      
      order.refundInfo.status = "failed";
      order.refundInfo.failureReason = error.message;
      order.refundInfo.processedAt = new Date();
      await order.save();

      return next(new HandleError(`Refund failed: ${error.message}`, 500));
    }
  }

  // Update order with refund details
  order.refundInfo.status = finalStatus;
  order.refundInfo.refundId = refundResponse.refundId;
  order.refundInfo.refundAmount = refundResponse.amount;
  order.refundInfo.refundCurrency = refundResponse.currency;
  order.refundInfo.processedAt = new Date();
  order.refundInfo.processedBy = req.user._id;
  order.refundInfo.gatewayResponse = refundResponse.raw;

  await order.save();
  await invalidateAnalyticsCaches();

  return res.status(200).json({
    success: true,
    message: `Refund ${finalStatus}. ${finalStatus === 'completed' ? 'Customer will receive funds in 3-10 business days.' : 'Refund is being processed.'}`,
    refund: {
      refundId: refundResponse.refundId,
      status: finalStatus,
      amount: refundResponse.amount,
      currency: refundResponse.currency,
      gateway: gateway,
      testMode: isTestMode() // ✅ Indicate if this was a test mode refund
    },
    order
  });
});


/**
 * Get refund status for an order
 * @route GET /api/v1/orders/:orderId/refund/status
 * @access Private (User or Admin)
 */

export const getRefundStatus = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === "admin";

  const order = await Order.findById(orderId);

  if (!order) {
    return next(new HandleError("Order not found", 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError("Unauthorized", 403));
  }

  // Always return an object with consistent structure
  // Check if refund exists and is not 'none'
  const hasActiveRefund = order.refundInfo && order.refundInfo.status !== 'none';

  if (!hasActiveRefund) {
    return res.status(200).json({
      success: true,
      message: "No refund requested for this order",
      refundInfo: {
        status: 'none', 
        hasRefund: false
      },
      isRefundable: order.isRefundable,
      daysUntilDeadline: order.daysUntilRefundDeadline
    });
  }

  // If refund is processing/completed, fetch latest status from gateway
  if (order.refundInfo.status === "processing" || order.refundInfo.status === "completed") {
    const gateway = order.paymentInfo.method;
    const refundReference = order.refundInfo.refundId;

    if (refundReference) {
      try {
        console.log(`🔍 Checking ${gateway} refund status for ${refundReference}...`);
        const gatewayStatus = await PaymentFactory.getRefundStatus(gateway, refundReference);
        
        // Update order if status changed
        if (gatewayStatus.status !== order.refundInfo.status) {
          order.refundInfo.status = gatewayStatus.status;
          await order.save();
        }
      } catch (error) {
        console.error("⚠️ Failed to fetch refund status from gateway:", error);
        // Continue with order's stored status
      }
    }
  }

  // Return consistent structure
  return res.status(200).json({
    success: true,
    refundInfo: {
      ...order.refundInfo.toObject(),
      hasRefund: true 
    },
    order: {
      _id: order._id,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      amountPaid: order.amountPaid,
      paymentMethod: order.paymentInfo.method
    }
  });
});

/**
 * Get all refund requests (Admin only)
 * @route GET /api/v1/admin/refunds?status=requested
 * @access Private (Admin only)
 */
export const getAllRefundRequests = handleAsyncError(async (req, res, next) => {
  const { status, from, to } = req.query;

  // Build query
  const query = { 'refundInfo.status': { $ne: 'none' } };
  
  if (status) {
    query['refundInfo.status'] = status;
  }

  // Date range filter
  if (from || to) {
    query['refundInfo.requestedAt'] = {};
    if (from) query['refundInfo.requestedAt'].$gte = new Date(from);
    if (to) query['refundInfo.requestedAt'].$lte = new Date(to);
  }

  // Find orders with refund requests
  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('refundInfo.requestedBy', 'name email')
    .populate('refundInfo.approvedBy', 'name email')
    .populate('refundInfo.rejectedBy', 'name email')
    .populate('refundInfo.processedBy', 'name email')
    .sort({ 'refundInfo.requestedAt': -1 });

  // Calculate stats
  const stats = {
    total: orders.length,
    requested: orders.filter(o => o.refundInfo.status === 'requested').length,
    approved: orders.filter(o => o.refundInfo.status === 'approved').length,
    rejected: orders.filter(o => o.refundInfo.status === 'rejected').length,
    processing: orders.filter(o => o.refundInfo.status === 'processing').length,
    completed: orders.filter(o => o.refundInfo.status === 'completed').length,
    failed: orders.filter(o => o.refundInfo.status === 'failed').length,
    totalRefundedAmount: orders
      .filter(o => o.refundInfo.status === 'completed')
      .reduce((sum, o) => sum + (o.refundInfo.refundAmount || 0), 0)
  };

  return res.status(200).json({
    success: true,
    count: orders.length,
    stats,
    orders
  });
});