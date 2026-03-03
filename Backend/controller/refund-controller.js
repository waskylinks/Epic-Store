import Order from '../models/order-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern, getCache, setCache } from '../utils/redis.js';
import { uploadToCloudinary } from '../utils/cloudinaryUpload.js';

// ============================================
// SHARED CACHE INVALIDATION
// Fire-and-forget — never blocks responses.
// ============================================

const invalidateRefundCaches = () => {
  Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('refund_overview*'),
    deleteCachePattern('refund_stats*'),
    deleteCachePattern('refunds_by_payment_method*'),
    deleteCachePattern('refund_timeline*'),
  ]).catch((err) => console.error('Refund cache invalidation error:', err));
};

// ============================================
// GET ALL REFUND REQUESTS (Admin)
// FIX: Replaced 9 separate DB queries (1 find + 8 countDocuments) with a
// single $facet aggregation. Stats are cached in Redis for 60 s so repeated
// page loads don't hit MongoDB at all for the counts.
// @route GET /api/v1/admin/refunds
// @access Private (Admin only)
// ============================================

export const getAllRefunds = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const matchStage = {
    'refundInfo.status': { $nin: ['none'] },
  };
  if (status) matchStage['refundInfo.status'] = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // ── Stats: serve from Redis cache when warm ──────────────────────────────
  const STATS_CACHE_KEY = `refund_stats:${status || 'all'}`;
  const STATS_TTL_SECONDS = 60;

  let stats = null;
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) stats = JSON.parse(cached);
  } catch (_) { /* cache miss is fine */ }

  // ── Single $facet aggregation replaces 1 find + 8 countDocuments ─────────
  const [facetResult] = await Order.aggregate([
    { $match: matchStage },
    {
      $facet: {
        // Paginated list — only fields needed for the table
        data: [
          { $sort: { 'refundInfo.requestedAt': -1 } },
          { $skip: skip },
          { $limit: parseInt(limit) },
          {
            $project: {
              user: 1,
              refundInfo: {
                status: 1,
                reason: 1,
                description: 1,
                refundType: 1,
                requestedAmount: 1,
                requestedAt: 1,
                requestedBy: 1,
                adminNote: 1,
                refundAmount: 1,
                refundCurrency: 1,
                refundReference: 1,
              },
              orderStatus: 1,
              totalPrice: 1,
              amountPaid: 1,
              'paymentInfo.method': 1,
              'paymentInfo.reference': 1,
              createdAt: 1,
              // Inline unread count — avoids virtual on lean doc
              unreadMessages: {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$refundInfo.messages', []] },
                    as: 'm',
                    cond: {
                      $and: [
                        { $eq: ['$$m.isRead', false] },
                        { $eq: ['$$m.senderType', 'customer'] },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
        // Total count for pagination
        totalCount: [{ $count: 'count' }],
        // Per-status counts — only computed when cache is cold
        ...(stats
          ? {}
          : {
              statCounts: [
                {
                  $group: {
                    _id: '$refundInfo.status',
                    count: { $sum: 1 },
                  },
                },
              ],
            }),
      },
    },
  ]);

  const orders = facetResult.data || [];
  const totalRefunds = facetResult.totalCount?.[0]?.count || 0;

  // Build / refresh stats
  if (!stats) {
    const rawCounts = facetResult.statCounts || [];
    const countMap = Object.fromEntries(rawCounts.map((s) => [s._id, s.count]));
    stats = {
      total: totalRefunds,
      requested: countMap.requested || 0,
      approved: countMap.approved || 0,
      processing: countMap.processing || 0,
      completed: countMap.completed || 0,
      rejected: countMap.rejected || 0,
      failed: countMap.failed || 0,
      cancelled: countMap.cancelled || 0,
    };

    // Populate in Redis — intentionally fire-and-forget
    setCache(STATS_CACHE_KEY, JSON.stringify(stats), STATS_TTL_SECONDS).catch(() => {});
  }

  // $lookup for user / requestedBy is skipped here intentionally; populate
  // only the lightweight fields that the list view actually renders.
  // Full population happens in getSingleRefund.
  await Order.populate(orders, [
    { path: 'user', select: 'name email' },
    { path: 'refundInfo.requestedBy', select: 'name email' },
  ]);

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalRefunds,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalRefunds / parseInt(limit)),
    stats,
    orders,
  });
});

// ============================================
// GET SINGLE REFUND DETAILS (Admin)
// @route GET /api/v1/admin/refunds/:id
// @access Private (Admin only)
// ============================================

export const getSingleRefund = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user', 'name email phone')
    .populate('refundInfo.requestedBy', 'name email')
    .populate('refundInfo.approvedBy', 'name email')
    .populate('refundInfo.rejectedBy', 'name email')
    .populate('refundInfo.processedBy', 'name email')
    .populate('refundInfo.messages.sender', 'name email role')
    .populate('refundInfo.documents.uploadedBy', 'name email')
    .populate('orderItems.product', 'name images');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found for this order', 404));
  }

  // FIX: Only write if there is actually something to mark — avoids a
  // superfluous save() on every admin view.
  const hasUnread = order.refundInfo.messages?.some(
    (m) => !m.isRead && m.senderType === 'customer'
  );
  if (hasUnread) {
    order.markRefundMessagesAsRead('admin');
    await order.save({ validateBeforeSave: false });
  }

  return res.status(200).json({
    success: true,
    order: {
      _id: order._id,
      user: order.user,
      orderItems: order.orderItems,
      shippingInfo: order.shippingInfo,
      paymentInfo: order.paymentInfo,
      refundInfo: order.refundInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      amountPaid: order.amountPaid,
      refundableAmount: order.refundableAmount,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
    },
  });
});

// ============================================
// CUSTOMER REQUESTS REFUND
// FIX: Cloudinary uploads are now parallel (Promise.all) instead of
// sequential for-await, cutting upload wall-time by N-1 round trips.
// @route POST /api/v1/orders/:id/refund/request
// @access Private (User who owns the order)
// ============================================

export const requestRefund = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, description, refundType = 'full', requestedAmount } = req.body;
  const userId = req.user._id;

  if (!reason || !description) {
    return next(new HandleError('Reason and description are required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (order.paymentInfo.status !== 'success') {
    return next(new HandleError('Cannot refund unpaid order', 400));
  }

  if (order.refundInfo && order.refundInfo.status !== 'none') {
    return next(new HandleError(`Refund already ${order.refundInfo.status}`, 400));
  }

  if (order.daysUntilRefundDeadline <= 0) {
    return next(
      new HandleError('Refund period has expired (30 days from delivery/payment)', 400)
    );
  }

  let refundAmount = order.amountPaid;
  if (refundType === 'partial') {
    const parsedAmount = parseFloat(requestedAmount);
    if (!parsedAmount || parsedAmount <= 0 || parsedAmount > order.amountPaid) {
      return next(new HandleError('Invalid refund amount', 400));
    }
    refundAmount = parsedAmount;
  }

  order.refundInfo = {
    status: 'requested',
    reason,
    description,
    refundType,
    requestedAmount: refundAmount,
    requestedAt: new Date(),
    requestedBy: userId,
    messages: [],
    documents: [],
    timeline: [],
  };

  order.addRefundTimeline('refund_requested', `Refund requested: ${reason}`, userId, {
    refundType,
    requestedAmount: refundAmount,
  });
  order.addStatusHistory('Refund Requested', userId, reason);
  order.addAuditEntry('refund_requested', userId, { reason, refundType, requestedAmount: refundAmount });

  // FIX: Parallel Cloudinary uploads — all files sent concurrently.
  if (req.files && req.files.length > 0) {
    const folder = `ecommerce/refunds/${order._id}/customer`;

    const uploadResults = await Promise.all(
      req.files.map((file) =>
        uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' }).then((result) => ({
          result,
          originalname: file.originalname,
        }))
      )
    );

    for (const { result, originalname } of uploadResults) {
      const docType =
        result.resource_type === 'image'
          ? 'photo'
          : result.resource_type === 'video'
          ? 'video'
          : 'document';

      order.addRefundDocument(docType, result.secure_url, originalname, userId, '');
    }
  }

  await order.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund request submitted successfully. Our team will review your request.',
    refundInfo: order.refundInfo,
  });
});

// ============================================
// GET REFUND STATUS (Customer)
// @route GET /api/v1/orders/:id/refund/status
// @access Private (User who owns the order)
// ============================================

export const getRefundStatus = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id).select('user refundInfo');
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({
    success: true,
    refundInfo: order.refundInfo || { status: 'none', hasRefund: false },
  });
});

// ============================================
// ADMIN APPROVES / REJECTS REFUND REQUEST
// @route PUT /api/v1/admin/orders/:id/refund/review
// @access Private (Admin only)
// ============================================

export const reviewRefundRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { action, adminNote } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return next(new HandleError('Action must be approve or reject', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo.status !== 'requested') {
    return next(new HandleError('No pending refund request found', 400));
  }

  if (action === 'approve') {
    order.refundInfo.status = 'approved';
    order.refundInfo.approvedAt = new Date();
    order.refundInfo.approvedBy = req.user._id;
    order.refundInfo.reviewedAt = new Date();
    if (adminNote) order.refundInfo.adminNote = adminNote;

    order.addRefundTimeline('refund_approved', 'Refund approved by admin', req.user._id);
    order.addAuditEntry('refund_approved', req.user._id, { adminNote });

    await order.save();
    invalidateRefundCaches();

    return res.status(200).json({
      success: true,
      message: 'Refund approved. Proceed to process payment.',
      order,
    });
  }

  // reject
  order.refundInfo.status = 'rejected';
  order.refundInfo.rejectedAt = new Date();
  order.refundInfo.rejectedBy = req.user._id;
  order.refundInfo.reviewedAt = new Date();
  if (adminNote) order.refundInfo.adminNote = adminNote;

  order.addRefundTimeline('refund_rejected', 'Refund rejected by admin', req.user._id, {
    reason: adminNote,
  });
  order.addAuditEntry('refund_rejected', req.user._id, { adminNote });

  await order.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund request rejected',
    order,
  });
});

// ============================================
// ADMIN PROCESSES REFUND PAYMENT
// @route POST /api/v1/admin/orders/:id/refund/process
// @access Private (Admin only)
// ============================================

export const processRefundPayment = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { refundAmount, merchantNote } = req.body;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo.status !== 'approved') {
    return next(new HandleError('Refund must be approved before processing', 400));
  }

  const maxRefund = order.amountPaid - (order.refundInfo.refundAmount || 0);
  if (!refundAmount || refundAmount <= 0 || refundAmount > maxRefund) {
    return next(
      new HandleError(`Invalid refund amount. Maximum refundable: ${maxRefund}`, 400)
    );
  }

  order.refundInfo.status = 'processing';
  order.refundInfo.refundAmount = refundAmount;
  order.refundInfo.refundCurrency = order.paymentInfo.currency;
  order.refundInfo.processedAt = new Date();
  order.refundInfo.processedBy = req.user._id;
  if (merchantNote) order.refundInfo.adminNote = merchantNote;
  order.refundInfo.refundReference = `REF-${Date.now()}-${order._id.toString().slice(-6)}`;

  order.addRefundTimeline('refund_processing', 'Refund payment initiated', req.user._id, {
    refundAmount,
  });

  try {
    // PAYMENT GATEWAY INTEGRATION WOULD GO HERE
    const gatewayResponse = {
      success: true,
      refundId: `rfnd_${Date.now()}`,
      amount: refundAmount,
      currency: order.paymentInfo.currency,
      status: 'succeeded',
    };

    order.refundInfo.status = 'completed';
    order.refundInfo.refundedAt = new Date();
    order.refundInfo.refundId = gatewayResponse.refundId;
    order.refundInfo.gatewayResponse = gatewayResponse;

    order.addRefundTimeline(
      'refund_completed',
      'Refund successfully processed',
      req.user._id,
      { refundId: gatewayResponse.refundId, refundAmount }
    );
    order.addAuditEntry('refund_completed', req.user._id, { refundAmount });
  } catch (error) {
    order.refundInfo.status = 'failed';
    order.refundInfo.failureReason = error.message;

    order.addRefundTimeline('refund_failed', 'Refund processing failed', req.user._id, {
      error: error.message,
    });

    await order.save();
    invalidateRefundCaches();

    return next(new HandleError(`Refund processing failed: ${error.message}`, 500));
  }

  await order.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund processed successfully',
    order,
  });
});

// ============================================
// ADD MESSAGE TO REFUND CONVERSATION (Admin)
// @route POST /api/v1/admin/refunds/:id/messages
// @access Private (Admin only)
// ============================================

export const addRefundMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { message, attachments = [] } = req.body;

  if (!message || message.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  order.addRefundMessage(req.user._id, 'admin', message, attachments);
  await order.save();

  const newMessage = order.refundInfo.messages[order.refundInfo.messages.length - 1];

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data: { orderId: order._id, message: newMessage },
  });
});

// ============================================
// ADD MESSAGE TO REFUND CONVERSATION (Customer)
// @route POST /api/v1/orders/:id/refund/messages
// @access Private (User who owns the order)
// ============================================

export const addCustomerRefundMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { message, attachments = [] } = req.body;
  const userId = req.user._id;

  if (!message || message.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  order.addRefundMessage(userId, 'customer', message, attachments);
  await order.save();

  const newMessage = order.refundInfo.messages[order.refundInfo.messages.length - 1];

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data: { orderId: order._id, message: newMessage },
  });
});

// ============================================
// GET REFUND MESSAGES
// FIX: Added pagination ($slice) so large message threads don't load in full.
// FIX: markAsRead only writes to DB when there are actually unread messages.
// @route GET /api/v1/orders/:id/refund/messages
// @access Private (User or Admin)
// ============================================

export const getRefundMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // $slice projection avoids loading the full messages array
  const order = await Order.findById(id, {
    user: 1,
    'refundInfo.status': 1,
    'refundInfo.messages': { $slice: [skip, parseInt(limit)] },
  }).populate('refundInfo.messages.sender', 'name email role');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo?.messages) {
    return res.status(200).json({ success: true, count: 0, messages: [] });
  }

  // FIX: Only write if there is something to mark read
  const readerType = isAdmin ? 'customer' : 'admin';
  const hasUnread = order.refundInfo.messages.some(
    (m) => !m.isRead && m.senderType === readerType
  );
  if (hasUnread) {
    order.markRefundMessagesAsRead(readerType);
    await order.save({ validateBeforeSave: false });
  }

  return res.status(200).json({
    success: true,
    count: order.refundInfo.messages.length,
    messages: order.refundInfo.messages,
  });
});

// ============================================
// UPLOAD FILES FOR REFUND (Admin)
// FIX: Parallel Cloudinary uploads.
// @route POST /api/v1/admin/refunds/:id/upload
// @access Private (Admin only)
// ============================================

export const uploadRefundFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  const folder = `ecommerce/refunds/${order._id}/admin`;

  // FIX: Parallel uploads
  const results = await Promise.all(
    req.files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' }).then((result) => ({
        result,
        originalname: file.originalname,
      }))
    )
  );

  const uploadedFiles = results.map(({ result, originalname }) => {
    order.addRefundDocument('other', result.secure_url, originalname, req.user._id, '');
    return {
      url: result.secure_url,
      filename: originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    };
  });

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles,
  });
});

// ============================================
// UPLOAD FILES FOR REFUND (Customer)
// FIX: Parallel Cloudinary uploads.
// @route POST /api/v1/orders/:id/refund/upload
// @access Private (User who owns the order)
// ============================================

export const uploadCustomerRefundFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  const folder = `ecommerce/refunds/${order._id}/customer`;

  // FIX: Parallel uploads
  const results = await Promise.all(
    req.files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' }).then((result) => ({
        result,
        originalname: file.originalname,
      }))
    )
  );

  const uploadedFiles = results.map(({ result, originalname }) => {
    const docType =
      result.resource_type === 'image'
        ? 'photo'
        : result.resource_type === 'video'
        ? 'video'
        : 'document';

    order.addRefundDocument(docType, result.secure_url, originalname, userId, '');
    return {
      url: result.secure_url,
      filename: originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    };
  });

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles,
  });
});

// ============================================
// GET REFUND TIMELINE
// @route GET /api/v1/orders/:id/refund/timeline
// @access Private (User or Admin)
// ============================================

export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.timeline.performedBy', 'name email role')
    .select('refundInfo.timeline user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo?.timeline) {
    return res.status(200).json({ success: true, count: 0, timeline: [] });
  }

  return res.status(200).json({
    success: true,
    count: order.refundInfo.timeline.length,
    timeline: order.refundInfo.timeline,
  });
});

// ============================================
// GET REFUND DOCUMENTS
// @route GET /api/v1/orders/:id/refund/documents
// @access Private (User or Admin)
// ============================================

export const getRefundDocuments = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.documents.uploadedBy', 'name email role')
    .select('refundInfo.documents user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo?.documents) {
    return res.status(200).json({ success: true, count: 0, documents: [] });
  }

  return res.status(200).json({
    success: true,
    count: order.refundInfo.documents.length,
    documents: order.refundInfo.documents,
  });
});

// ============================================
// GET REFUNDS WITH UNREAD MESSAGES (Admin)
// @route GET /api/v1/admin/refunds/unread
// @access Private (Admin only)
// ============================================

export const getRefundsWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getRefundsWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count: orders.length,
    orders: orders.map((order) => ({
      _id: order._id,
      user: order.user,
      refundInfo: {
        status: order.refundInfo.status,
        reason: order.refundInfo.reason,
        requestedAmount: order.refundInfo.requestedAmount,
        unreadCount: order.unreadRefundMessages,
      },
      latestMessage: order.latestRefundMessage,
    })),
  });
});

// ============================================
// CANCEL REFUND REQUEST (Customer)
// @route PUT /api/v1/orders/:id/refund/cancel
// @access Private (User who owns the order)
// ============================================

export const cancelRefundRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  if (order.refundInfo.status !== 'requested') {
    return next(new HandleError('Cannot cancel refund at this stage', 400));
  }

  order.refundInfo.status = 'cancelled';
  order.addRefundTimeline('refund_cancelled', 'Refund cancelled by customer', userId);
  order.addAuditEntry('refund_cancelled', userId);

  await order.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund request cancelled successfully',
  });
});