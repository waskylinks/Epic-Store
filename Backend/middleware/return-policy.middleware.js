import mongoose from 'mongoose';
import Order from '../models/order-model.js';
import HandleError from '../utils/handleError.js';

// ============================================
// validateObjectId
// FIX V-01 — centralised ObjectId validation. Apply via
//            router.param('id', validateObjectId) in return-routes.js
//            to cover every :id param automatically.
// ============================================
export const validateObjectId = (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new HandleError('Invalid order ID format', 400));
  }
  next();
};

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
// FIX BUG-1 / BUG-3 — previously a single canReviewReturn middleware
// accepted only 'requested', then was naively patched to also accept
// 'plea_submitted'. That caused both the first-round review route
// (PUT /review) and the second-round plea-review route (PUT /plea-review)
// to accept the wrong statuses — an admin could re-run the first-round
// review on a plea_submitted return, overwriting plea data.
//
// Solution: two separate middleware functions with explicit allowed
// statuses, one per route.
//
// canReviewFirstRound — used ONLY by PUT /admin/orders/:id/return/review
// Allows: 'requested' only.
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
// FIX BUG-1 / BUG-3 — second half of the split.
//
// canReviewPleaRound — used ONLY by PUT /admin/orders/:id/return/plea-review
// Allows: 'plea_submitted' only.
// Guards that a plea was actually submitted (pleaAttempts > 0) as a
// defence-in-depth check against a manually forced status change.
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

    // Defence-in-depth: if status was manually forced to plea_submitted
    // without a real plea being submitted, pleaAttempts will be 0.
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
// canAddReturnMessage
// FIX V-04 — updated closed statuses list.
// 'rejected' is kept closed: in the new flow the overall return status
// 'rejected' is only reachable via the legacy updateReturnStatus admin
// endpoint and represents a terminal admin rejection of the whole request
// (not a per-item rejection). Per-item rejections land the return in
// 'items_reviewed', not 'rejected', so messaging remains open there.
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

    // Only truly terminal statuses block messaging.
    // 'items_reviewed', 'plea_submitted', 'awaiting_discount' must remain
    // open so customers and admins can communicate throughout the new flow.
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

export const validateReturnFileUpload = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const MAX_FILES     = 8; // FIX BUG-16 (already in routes) — aligned here too
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

// ============================================
// canSubmitPlea
// FIX BUG-2 — was completely missing from the file, causing a hard crash
// when the route tried to invoke it as Express middleware.
//
// Guards:
// 1. Order exists and belongs to the requesting customer
// 2. Status is exactly 'items_reviewed' (the only window for a plea)
// 3. pleaAttempts < 1 (maximum one plea allowed per return)
// 4. pleaDeadline has not expired (48-hour window enforced here)
//    — if the deadline has passed the customer missed their window;
//      checkAndExpireTimers will auto-advance the status on the next read.
// ============================================
export const canSubmitPlea = async (req, res, next) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;

    const order = await Order.findById(id);
    if (!order) return next(new HandleError('Order not found', 404));

    // Ownership — only the order owner can submit a plea
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
// canGenerateDiscount
// FIX BUG-2 — was completely missing from the file, causing a hard crash.
//
// Guards:
// 1. Order exists and is in 'awaiting_discount' status
// 2. Pre-populates order.user and order.returnInfo.itemsToReturn.product
//    so the controller can build the discount page payload without any
//    additional DB round-trips.
//
// Note: admin-only access is already enforced by the adminAuth middleware
// array applied in return-routes.js before this middleware runs.
// ============================================
export const canGenerateDiscount = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('user',                             'name email')
      .populate('returnInfo.itemsToReturn.product', 'name price images');

    if (!order) return next(new HandleError('Order not found', 404));

    if (!order.returnInfo || order.returnInfo.status !== 'awaiting_discount') {
      return next(new HandleError(
        `Discount generation requires status 'awaiting_discount'. Current status: ${order.returnInfo?.status || 'none'}`, 400
      ));
    }

    req.order = order;
    next();
  } catch (error) {
    console.error('canGenerateDiscount check error:', error);
    return next(new HandleError('Failed to validate discount generation', 500));
  }
};