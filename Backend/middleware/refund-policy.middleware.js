// Backend/middleware/refund-policy.middleware.js

import mongoose from 'mongoose';
import Order from '../models/order-model.js';
import HandleError from '../utils/handleError.js';

/**
 * Resolves the order ID from req.params regardless of whether the route
 * defines the param as :id or :orderId.
 */
const resolveOrderId = (req) => req.params.id ?? req.params.orderId;

/**
 * Check if order is eligible for refund based on business rules
 * @middleware
 */
export const checkRefundEligibility = async (req, res, next) => {
  try {
    const id = resolveOrderId(req);

    // 0. Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    // 1. Find the order
    const order = await Order.findById(id);

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

    // 4. Check refund status against re-request policy:
    //    - requested / approved / processing / completed → hard block
    //    - rejected → block, must contact support
    //    - cancelled / failed → allow re-request (customer cancelled by mistake
    //      or gateway failed; penalising them serves no purpose)
    if (order.refundInfo && order.refundInfo.status !== 'none') {
      const status = order.refundInfo.status;

      if (status === 'requested') {
        return next(new HandleError("Refund request is already pending review", 400));
      }

      if (status === 'approved') {
        return next(new HandleError("Refund has already been approved and is being processed", 400));
      }

      if (status === 'processing') {
        return next(new HandleError("Refund is currently being processed", 400));
      }

      if (status === 'completed') {
        return next(new HandleError("This order has already been refunded", 400));
      }

      if (status === 'rejected') {
        return next(new HandleError("Your refund request was rejected. Please contact support to proceed.", 400));
      }

      // cancelled and failed → fall through, re-request is allowed
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
    const baseDate = order.deliveredAt || order.paymentInfo.paidAt;

    if (!baseDate) {
      return next(new HandleError("Cannot determine refund eligibility date", 400));
    }

    const refundDeadline = new Date(baseDate);
    refundDeadline.setDate(refundDeadline.getDate() + REFUND_WINDOW_DAYS);

    if (new Date() > refundDeadline) {
      const daysSincePurchase = Math.floor(
        (new Date() - new Date(baseDate)) / (1000 * 60 * 60 * 24)
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
        `Refunds are not supported for payment method: ${gateway}. Please contact support for manual refund.`,
        400
      ));
    }

    // 8. Ensure there's a payment reference
    if (!order.paymentInfo.reference) {
      return next(new HandleError(
        "Payment reference not found. Cannot process refund.",
        400
      ));
    }

    // 9. Attach order to request for use in controller
    req.order = order;

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
  const { refundType, requestedAmount } = req.body;
  const order = req.order; // Attached by checkRefundEligibility

  if (!order) {
    return next(new HandleError("Order not found in request. Ensure checkRefundEligibility runs first.", 500));
  }

  // For full refunds, no validation needed
  if (refundType === 'full' || !requestedAmount) {
    return next();
  }

  // Partial refund validation
  const maxRefundable = order.amountPaid - (order.refundInfo?.refundAmount || 0);

  if (requestedAmount <= 0) {
    return next(new HandleError("Refund amount must be greater than 0", 400));
  }

  if (requestedAmount > maxRefundable) {
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

  if (requestedAmount < minAmount) {
    return next(new HandleError(
      `Refund amount must be at least ${minAmount} ${order.paymentInfo.currency}`,
      400
    ));
  }

  // Check for decimal places (max 2)
  const decimalPlaces = (requestedAmount.toString().split('.')[1] || '').length;
  if (decimalPlaces > 2) {
    return next(new HandleError(
      "Refund amount cannot have more than 2 decimal places",
      400
    ));
  }

  next();
};

/**
 * Check if admin can review refund
 * @middleware
 */
export const canReviewRefund = async (req, res, next) => {
  try {
    const id = resolveOrderId(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (!order.refundInfo || order.refundInfo.status !== "requested") {
      return next(new HandleError(
        "No pending refund request found. Current status: " +
        (order.refundInfo?.status || "none"),
        400
      ));
    }

    req.order = order;

    next();

  } catch (error) {
    console.error("Review refund check error:", error);
    return next(new HandleError("Failed to validate refund review", 500));
  }
};

/**
 * Check if admin can process refund
 * @middleware
 */
export const canProcessRefund = async (req, res, next) => {
  try {
    const id = resolveOrderId(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (!order.refundInfo || order.refundInfo.status !== "approved") {
      return next(new HandleError(
        "Refund must be approved before processing. Current status: " +
        (order.refundInfo?.status || "not requested"),
        400
      ));
    }

    if (order.refundInfo.status === "processing" || order.refundInfo.status === "completed") {
      return next(new HandleError("Refund already processed or in progress", 400));
    }

    if (!order.paymentInfo.reference) {
      return next(new HandleError("Payment reference not found", 400));
    }

    req.order = order;

    next();

  } catch (error) {
    console.error("Process refund check error:", error);
    return next(new HandleError("Failed to validate refund processing", 500));
  }
};

/**
 * Check if user can add message to refund
 * @middleware
 */
export const canAddRefundMessage = async (req, res, next) => {
  try {
    const id = resolveOrderId(req);
    const userId = req.user._id;
    const isAdmin = req.user.role === 'admin';

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (!order.refundInfo || order.refundInfo.status === 'none') {
      return next(new HandleError("No refund request found for this order", 404));
    }

    if (!isAdmin && order.user.toString() !== userId.toString()) {
      return next(new HandleError("Unauthorized", 403));
    }

    const closedStatuses = ['completed', 'failed'];
    if (closedStatuses.includes(order.refundInfo.status)) {
      return next(new HandleError(
        `Cannot add messages to ${order.refundInfo.status} refund requests`,
        400
      ));
    }

    req.order = order;

    next();

  } catch (error) {
    console.error("Add refund message check error:", error);
    return next(new HandleError("Failed to validate message addition", 500));
  }
};

/**
 * Check if user can cancel refund request
 * @middleware
 */
export const canCancelRefund = async (req, res, next) => {
  try {
    const id = resolveOrderId(req);
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (order.user.toString() !== userId.toString()) {
      return next(new HandleError("Unauthorized", 403));
    }

    if (!order.refundInfo || order.refundInfo.status === 'none') {
      return next(new HandleError("No refund request found", 404));
    }

    if (order.refundInfo.status !== 'requested') {
      return next(new HandleError(
        `Cannot cancel refund at this stage. Current status: ${order.refundInfo.status}`,
        400
      ));
    }

    req.order = order;

    next();

  } catch (error) {
    console.error("Cancel refund check error:", error);
    return next(new HandleError("Failed to validate refund cancellation", 500));
  }
};

/**
 * Check return eligibility
 * @middleware
 */
export const checkReturnEligibility = async (req, res, next) => {
  try {
    const id = resolveOrderId(req);
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (order.user.toString() !== userId.toString()) {
      return next(new HandleError("Unauthorized", 403));
    }

    if (order.orderStatus !== 'Delivered') {
      return next(new HandleError("Can only return delivered orders", 400));
    }

    if (!order.deliveredAt) {
      return next(new HandleError("Delivery date not found", 400));
    }

    const RETURN_WINDOW_DAYS = 30;
    const returnDeadline = new Date(order.deliveredAt);
    returnDeadline.setDate(returnDeadline.getDate() + RETURN_WINDOW_DAYS);

    if (new Date() > returnDeadline) {
      const daysSinceDelivery = Math.floor(
        (new Date() - new Date(order.deliveredAt)) / (1000 * 60 * 60 * 24)
      );
      return next(new HandleError(
        `Return period has expired (${RETURN_WINDOW_DAYS} days from delivery). Order was delivered ${daysSinceDelivery} days ago.`,
        400
      ));
    }

    if (order.returnInfo && order.returnInfo.status !== 'none') {
      return next(new HandleError(
        `Return request already exists with status: ${order.returnInfo.status}`,
        400
      ));
    }

    req.order = order;

    next();

  } catch (error) {
    console.error("Return eligibility check error:", error);
    return next(new HandleError("Failed to check return eligibility", 500));
  }
};

/**
 * Validate file uploads for refunds
 * @middleware
 */
export const validateRefundFileUpload = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new HandleError("No files uploaded", 400));
  }

  const MAX_FILES = 5;
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

  if (req.files.length > MAX_FILES) {
    return next(new HandleError(`Maximum ${MAX_FILES} files allowed`, 400));
  }

  for (const file of req.files) {
    if (file.size > MAX_FILE_SIZE) {
      return next(new HandleError(
        `File ${file.originalname} exceeds maximum size of 5MB`,
        400
      ));
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return next(new HandleError(
        `File ${file.originalname} has invalid type. Allowed: JPEG, PNG, WebP, PDF`,
        400
      ));
    }
  }

  next();
};