import mongoose from 'mongoose';
import Order from '../models/order-model.js';
import HandleError from '../utils/handleError.js';

// ============================================
// validateObjectId
// ============================================
export const validateObjectId = (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new HandleError('Invalid order ID format', 400));
  }
  next();
};

// ============================================
// checkReturnEligibility
// Guards the initial return request submission.
// Checks: order delivered, within 30-day window, no existing return.
// ============================================
export const checkReturnEligibility = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && order.user.toString() !== req.user._id.toString()) {
      return next(new HandleError('Unauthorized', 403));
    }
    if (order.orderStatus !== 'Delivered') {
      return next(new HandleError('Can only return delivered orders', 400));
    }
    if (!order.deliveredAt) {
      return next(new HandleError('Delivery date not found', 400));
    }

    const RETURN_WINDOW_DAYS = 30;
    const returnDeadline = new Date(order.deliveredAt);
    returnDeadline.setDate(returnDeadline.getDate() + RETURN_WINDOW_DAYS);

    if (Date.now() > returnDeadline.getTime()) {
      const daysSinceDelivery = Math.floor(
        (Date.now() - new Date(order.deliveredAt).getTime()) / 86_400_000
      );
      return next(new HandleError(
        `Return period has expired (${RETURN_WINDOW_DAYS} days from delivery). Order was delivered ${daysSinceDelivery} days ago.`, 400
      ));
    }

    if (order.returnInfo && order.returnInfo.status !== 'none') {
      return next(new HandleError(
        `Return request already exists with status: ${order.returnInfo.status}`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('Return eligibility check error:', error);
    return next(new HandleError('Failed to check return eligibility', 500));
  }
};

// ============================================
// canReviewFirstRound
// Admin only. Requires status='requested'.
// ============================================
export const canReviewFirstRound = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (!order.returnInfo || order.returnInfo.status !== 'requested') {
      return next(new HandleError(
        `First-round review requires status 'requested'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canReviewFirstRound check error:', error);
    return next(new HandleError('Failed to validate return review', 500));
  }
};

// ============================================
// canReviewPleaRound
// Admin only. Requires status='plea_submitted' and a plea on record.
// ============================================
export const canReviewPleaRound = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (!order.returnInfo || order.returnInfo.status !== 'plea_submitted') {
      return next(new HandleError(
        `Plea-round review requires status 'plea_submitted'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    if ((order.returnInfo.pleaAttempts ?? 0) === 0) {
      return next(new HandleError(
        'Cannot run plea-round review: no plea has been submitted by the customer', 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canReviewPleaRound check error:', error);
    return next(new HandleError('Failed to validate plea review', 500));
  }
};

// ============================================
// canAcceptDecisions
// Customer only. Guards the explicit "Accept Decisions" endpoint.
// Requires: status='items_reviewed', order ownership,
// pleaAttempts === 0 (no plea already submitted).
// If pleaDeadline has expired, checkAndExpireTimers will have already
// auto-advanced the status to 'approved', so this middleware won't
// even be reached in that case.
// ============================================
export const canAcceptDecisions = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;

    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (order.user.toString() !== userId.toString()) {
      return next(new HandleError('Unauthorized', 403));
    }

    if (!order.returnInfo || order.returnInfo.status !== 'items_reviewed') {
      return next(new HandleError(
        `Decisions can only be accepted when return status is 'items_reviewed'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    if ((order.returnInfo.pleaAttempts ?? 0) > 0) {
      return next(new HandleError(
        'A plea has already been submitted for this return. Use the plea resolution path.', 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canAcceptDecisions check error:', error);
    return next(new HandleError('Failed to validate decision acceptance', 500));
  }
};

// ============================================
// canSubmitPlea
// Customer only. Requires status='items_reviewed', no prior plea,
// and plea deadline not yet expired.
// ============================================
export const canSubmitPlea = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;

    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (order.user.toString() !== userId.toString()) {
      return next(new HandleError('Unauthorized', 403));
    }

    if (!order.returnInfo || order.returnInfo.status !== 'items_reviewed') {
      return next(new HandleError(
        `Plea submission is only allowed when return status is 'items_reviewed'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    if ((order.returnInfo.pleaAttempts ?? 0) >= 1) {
      return next(new HandleError(
        'You have already submitted a plea for this return. Only one plea is allowed.', 400
      ));
    }

    const deadline = order.returnInfo.pleaDeadline;
    if (!deadline || new Date() > new Date(deadline)) {
      return next(new HandleError(
        'The plea submission window has closed. Your return will proceed based on the original item decisions.', 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canSubmitPlea check error:', error);
    return next(new HandleError('Failed to validate plea submission', 500));
  }
};

// ============================================
// canConfirmShipped
// Customer only. Guards the confirm-shipped endpoint.
// Requires: status='approved', order ownership.
//
// Real-world flow: customer physically packs items, drops at courier,
// confirms here with optional courier name and tracking number.
// Admin has zero involvement at this stage — they did not ship anything.
//
// Timer note: pleaDeadline is null by the time status reaches 'approved'.
// There is no time limit on the customer shipping — they ship when ready.
// ============================================
export const canConfirmShipped = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;

    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (order.user.toString() !== userId.toString()) {
      return next(new HandleError('Unauthorized', 403));
    }

    if (!order.returnInfo || order.returnInfo.status !== 'approved') {
      return next(new HandleError(
        `Shipment can only be confirmed when return status is 'approved'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canConfirmShipped check error:', error);
    return next(new HandleError('Failed to validate shipment confirmation', 500));
  }
};

// ============================================
// canGenerateDiscount
// Admin only. Requires status='inspected'.
// generateDiscountCode transitions: inspected → awaiting_discount.
// Discount creation page then handles: awaiting_discount → completed.
// ============================================
export const canGenerateDiscount = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('user',                             'name email firstName lastName')
      .populate('returnInfo.itemsToReturn.product', 'name price images');

    if (!order) return next(new HandleError('Order not found', 404));

    if (!order.returnInfo || order.returnInfo.status !== 'inspected') {
      return next(new HandleError(
        `Discount generation requires status 'inspected'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canGenerateDiscount check error:', error);
    return next(new HandleError('Failed to validate discount generation', 500));
  }
};

// ============================================
// canAddReturnMessage
// Both admin and customer. All active statuses allow messaging.
// Only terminal statuses (completed, rejected, cancelled) block it.
// 'approved', 'in_transit', 'received', 'inspected', 'awaiting_discount'
// all remain open — both parties may need to communicate throughout
// the entire physical return process.
// ============================================
export const canAddReturnMessage = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;
    const isAdmin = req.user.role === 'admin';

    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (!order.returnInfo || order.returnInfo.status === 'none') {
      return next(new HandleError('No return request found for this order', 404));
    }

    if (!isAdmin && order.user.toString() !== userId.toString()) {
      return next(new HandleError('Unauthorized', 403));
    }

    const closedStatuses = ['completed', 'rejected', 'cancelled'];
    if (closedStatuses.includes(order.returnInfo.status)) {
      return next(new HandleError(
        `Cannot add messages to a ${order.returnInfo.status} return request`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('Add return message check error:', error);
    return next(new HandleError('Failed to validate message addition', 500));
  }
};

// ============================================
// canCancelReturn
// Customer only. Only cancellable at 'requested' status.
// Once admin has reviewed items the process is underway.
// ============================================
export const canCancelReturn = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;

    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    if (order.user.toString() !== userId.toString()) {
      return next(new HandleError('Unauthorized', 403));
    }
    if (!order.returnInfo || order.returnInfo.status === 'none') {
      return next(new HandleError('No return request found', 404));
    }
    if (order.returnInfo.status !== 'requested') {
      return next(new HandleError(
        `Cannot cancel return at this stage. Current status: ${order.returnInfo.status}`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('Cancel return check error:', error);
    return next(new HandleError('Failed to validate return cancellation', 500));
  }
};

// ============================================
// validateReturnFileUpload
// Shared file validation for all upload endpoints.
// Max 8 files, 5MB each, allowed types only.
// ============================================
export const validateReturnFileUpload = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const MAX_FILES     = 8;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];

  if (req.files.length > MAX_FILES) {
    return next(new HandleError(`Maximum ${MAX_FILES} files allowed`, 400));
  }

  for (const file of req.files) {
    if (file.size > MAX_FILE_SIZE) {
      return next(new HandleError(`File "${file.originalname}" exceeds maximum size of 5MB`, 400));
    }
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return next(new HandleError(
        `File "${file.originalname}" has invalid type. Allowed: JPEG, PNG, WebP, MP4, PDF`, 400
      ));
    }
  }

  next();
};