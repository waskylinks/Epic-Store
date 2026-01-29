// return-policy.middleware.js - NEW FILE

import mongoose from 'mongoose';
import Order from '../models/order-model.js';
import HandleError from '../utils/handleError.js';

/**
 * Check if order is eligible for return
 */
export const checkReturnEligibility = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && order.user.toString() !== req.user._id.toString()) {
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
 * Check if admin can review return
 */
export const canReviewReturn = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (!order.returnInfo || order.returnInfo.status !== "requested") {
      return next(new HandleError(
        "No pending return request found. Current status: " + 
        (order.returnInfo?.status || "none"),
        400
      ));
    }

    req.order = order;
    next();

  } catch (error) {
    console.error("Review return check error:", error);
    return next(new HandleError("Failed to validate return review", 500));
  }
};

/**
 * Check if user can add message to return
 */
export const canAddReturnMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const isAdmin = req.user.role === 'admin';

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HandleError("Invalid order ID format", 400));
    }

    const order = await Order.findById(id);

    if (!order) {
      return next(new HandleError("Order not found", 404));
    }

    if (!order.returnInfo || order.returnInfo.status === 'none') {
      return next(new HandleError("No return request found for this order", 404));
    }

    if (!isAdmin && order.user.toString() !== userId.toString()) {
      return next(new HandleError("Unauthorized", 403));
    }

    const closedStatuses = ['completed'];
    if (closedStatuses.includes(order.returnInfo.status)) {
      return next(new HandleError(
        `Cannot add messages to ${order.returnInfo.status} return requests`,
        400
      ));
    }

    req.order = order;
    next();

  } catch (error) {
    console.error("Add return message check error:", error);
    return next(new HandleError("Failed to validate message addition", 500));
  }
};

/**
 * Check if user can cancel return request
 */
export const canCancelReturn = async (req, res, next) => {
  try {
    const { id } = req.params;
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

    if (!order.returnInfo || order.returnInfo.status === 'none') {
      return next(new HandleError("No return request found", 404));
    }

    if (order.returnInfo.status !== 'requested') {
      return next(new HandleError(
        `Cannot cancel return at this stage. Current status: ${order.returnInfo.status}`,
        400
      ));
    }

    req.order = order;
    next();

  } catch (error) {
    console.error("Cancel return check error:", error);
    return next(new HandleError("Failed to validate return cancellation", 500));
  }
};

/**
 * Validate file uploads for returns
 */
export const validateReturnFileUpload = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new HandleError("No files uploaded", 400));
  }

  const MAX_FILES = 5;
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];

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
        `File ${file.originalname} has invalid type. Allowed: JPEG, PNG, WebP, MP4, PDF`,
        400
      ));
    }
  }

  next();
};