// Backend/middleware/refund-policy.middleware.js

import Order from '../models/order-model.js';
import HandleError from '../utils/handleError.js';

/**
 * Check if order is eligible for refund based on business rules
 * @middleware
 */
export const checkRefundEligibility = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    // 1. Find the order
    const order = await Order.findById(orderId);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    // 2. Check if user owns the order (unless admin)
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && order.user.toString() !== req.user._id.toString()) {
      return next(new HandleError("Unauthorized: You can only request refunds for your own orders", 403));
    }

    // 3. Check if order was paid
    if (order.paymentInfo.status !== "success") {
      return next(new HandleError("Cannot refund unpaid order", 400));
    }

    // 4. Check if refund already requested/processed
    if (order.refundInfo) {
      const status = order.refundInfo.status;
      
      if (status === "requested") {
        return next(new HandleError("Refund request is already pending review", 400));
      }
      
      if (status === "approved") {
        return next(new HandleError("Refund has already been approved and is being processed", 400));
      }
      
      if (status === "processing") {
        return next(new HandleError("Refund is currently being processed", 400));
      }
      
      if (status === "completed") {
        return next(new HandleError("This order has already been refunded", 400));
      }
    }

    // 5. Check order status - only specific statuses can be refunded
    const refundableStatuses = ['Delivered', 'Cancelled', 'Shipped'];
    if (!refundableStatuses.includes(order.orderStatus)) {
      return next(new HandleError(
        `Cannot refund order with status "${order.orderStatus}". Only delivered, shipped, or cancelled orders can be refunded.`,
        400
      ));
    }

    // 6. Check refund time window (30 days from delivery/payment)
    const REFUND_WINDOW_DAYS = 30;
    const refundDeadline = new Date(order.deliveredAt || order.paymentInfo.paidAt);
    refundDeadline.setDate(refundDeadline.getDate() + REFUND_WINDOW_DAYS);

    if (new Date() > refundDeadline) {
      const daysSincePurchase = Math.floor(
        (new Date() - new Date(order.deliveredAt || order.paymentInfo.paidAt)) / (1000 * 60 * 60 * 24)
      );
      
      return next(new HandleError(
        `Refund request period has expired. You can only request refunds within ${REFUND_WINDOW_DAYS} days. This order was ${daysSincePurchase} days ago.`,
        400
      ));
    }

    // 7. Check if payment gateway supports refunds
    const gateway = order.paymentInfo.method;
    const supportedGateways = ['paystack', 'flutterwave', 'stripe'];
    
    if (!supportedGateways.includes(gateway)) {
      return next(new HandleError(
        `Refunds are not supported for payment method: ${gateway}`,
        400
      ));
    }

    // 8. Attach order to request for use in controller
    req.order = order;

    // Proceed to controller
    next();

  } catch (error) {
    console.error("Refund eligibility check error:", error);
    return next(new HandleError("Failed to check refund eligibility", 500));
  }
};

/**
 * Validate refund amount for partial refunds
 * @middleware
 */
export const validateRefundAmount = (req, res, next) => {
  const { refundAmount } = req.body;
  const order = req.order; // Attached by checkRefundEligibility

  if (!refundAmount) {
    // Full refund - no validation needed
    return next();
  }

  // Partial refund validation
  const maxRefundable = order.amountPaid;

  if (refundAmount <= 0) {
    return next(new HandleError("Refund amount must be greater than 0", 400));
  }

  if (refundAmount > maxRefundable) {
    return next(new HandleError(
      `Refund amount cannot exceed ${maxRefundable} ${order.paymentInfo.currency}`,
      400
    ));
  }

  // Minimum refund amount (e.g., 100 NGN or 1 USD)
  const minimumRefunds = {
    NGN: 100,
    USD: 1,
    GBP: 1,
    EUR: 1,
    GHS: 5,
    KES: 100,
    ZAR: 10
  };

  const minAmount = minimumRefunds[order.paymentInfo.currency] || 1;

  if (refundAmount < minAmount) {
    return next(new HandleError(
      `Refund amount must be at least ${minAmount} ${order.paymentInfo.currency}`,
      400
    ));
  }

  next();
};

/**
 * Check if admin can process refund
 * @middleware
 */
export const canProcessRefund = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    // Check if refund was approved
    if (!order.refundInfo || order.refundInfo.status !== "approved") {
      return next(new HandleError(
        "Refund must be approved before processing. Current status: " + 
        (order.refundInfo?.status || "not requested"),
        400
      ));
    }

    // Check if already processed
    if (order.refundInfo.status === "processing" || order.refundInfo.status === "completed") {
      return next(new HandleError("Refund already processed or in progress", 400));
    }

    // Attach order to request
    req.order = order;

    next();

  } catch (error) {
    console.error("Process refund check error:", error);
    return next(new HandleError("Failed to validate refund processing", 500));
  }
};