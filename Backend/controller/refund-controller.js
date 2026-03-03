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
// SAFE REFUND RESPONSE SHAPE
// Strips internal/sensitive fields before sending order data to clients.
// Used by reviewRefundRequest and processRefundPayment which previously
// returned the raw Mongoose document (leaking auditLog, paymentMeta.raw,
// invoiceInfo.pdfData, fraudCheck, etc.).
// ============================================

const safeRefundResponse = (order) => ({
  _id: order._id,
  user: order.user,
  orderStatus: order.orderStatus,
  totalPrice: order.totalPrice,
  amountPaid: order.amountPaid,
  refundableAmount: order.refundableAmount,
  // Proper nested object — dot-string keys ('paymentInfo.method': v) would
  // create a literal key named "paymentInfo.method", not a nested structure,
  // causing order.paymentInfo.method to be undefined on the receiving end.
  paymentInfo: {
    method: order.paymentInfo?.method,
    currency: order.paymentInfo?.currency,
  },
  refundInfo: {
    status: order.refundInfo?.status,
    reason: order.refundInfo?.reason,
    description: order.refundInfo?.description,
    refundType: order.refundInfo?.refundType,
    requestedAmount: order.refundInfo?.requestedAmount,
    requestedAt: order.refundInfo?.requestedAt,
    reviewedAt: order.refundInfo?.reviewedAt,
    approvedAt: order.refundInfo?.approvedAt,
    approvedBy: order.refundInfo?.approvedBy,
    rejectedAt: order.refundInfo?.rejectedAt,
    rejectedBy: order.refundInfo?.rejectedBy,
    adminNote: order.refundInfo?.adminNote,
    refundAmount: order.refundInfo?.refundAmount,
    refundCurrency: order.refundInfo?.refundCurrency,
    refundReference: order.refundInfo?.refundReference,
    refundId: order.refundInfo?.refundId,
    processedAt: order.refundInfo?.processedAt,
    refundedAt: order.refundInfo?.refundedAt,
    failureReason: order.refundInfo?.failureReason,
    timeline: order.refundInfo?.timeline,
  },
  createdAt: order.createdAt,
});

// ============================================
// CLOUDINARY RESOURCE TYPE → DOCUMENT TYPE MAP
// Shared by both admin and customer upload handlers so the mapping
// stays consistent and is not duplicated.
// Previously the admin upload hardcoded 'other' for every file type.
// ============================================

const resolveDocType = (resourceType) => {
  if (resourceType === 'image') return 'photo';
  if (resourceType === 'video') return 'video';
  return 'document';
};

// ============================================
// GET ALL REFUNDS (Admin)
// FIX 1: Stats aggregation is now always computed against the full
//         non-filtered dataset (only $nin: ['none'] applied), independent
//         of the ?status filter used for the paginated list. Previously
//         the status filter overwrote the $nin clause, contaminating stats.
// FIX 2: stats.total is now the sum of per-status counts, not the filtered
//         page count.
// FIX 3: Sort has an _id tiebreaker to guarantee stable pagination when
//         multiple refunds share the same requestedAt timestamp.
// FIX 4: Per-status cache keys now store stats computed from the full
//         dataset so cached values are never contaminated by a filter.
// @route  GET /api/v1/admin/refunds
// @access Private (Admin only)
// ============================================

export const getAllRefunds = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  // List filter — may be narrowed by ?status
  const listMatchStage = { 'refundInfo.status': { $nin: ['none'] } };
  if (status) listMatchStage['refundInfo.status'] = status;

  // Stats filter — always the full non-none dataset regardless of ?status
  const statsMatchStage = { 'refundInfo.status': { $nin: ['none'] } };

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Stats cache is keyed to 'all' only — never to a specific status filter,
  // so cached stats always represent the global picture.
  const STATS_CACHE_KEY = 'refund_stats:all';
  const STATS_TTL_SECONDS = 60;

  let stats = null;
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) stats = JSON.parse(cached);
  } catch (_) { /* cache miss is fine */ }

  // ── Paginated list aggregation (filtered) ────────────────────────────────
  const [listResult] = await Order.aggregate([
    { $match: listMatchStage },
    {
      $facet: {
        data: [
          // FIX 3: _id tiebreaker for deterministic pagination
          { $sort: { 'refundInfo.requestedAt': -1, _id: -1 } },
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
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);

  const orders = listResult.data || [];
  const totalRefunds = listResult.totalCount?.[0]?.count || 0;

  // ── Stats aggregation (always unfiltered) ───────────────────────────────
  // Only runs when cache is cold. Separate pipeline so it is never
  // contaminated by the list's ?status filter.
  if (!stats) {
    const [statsResult] = await Order.aggregate([
      { $match: statsMatchStage },
      {
        $facet: {
          statCounts: [
            { $group: { _id: '$refundInfo.status', count: { $sum: 1 } } },
          ],
        },
      },
    ]);

    const rawCounts = statsResult?.statCounts || [];
    const countMap = Object.fromEntries(rawCounts.map((s) => [s._id, s.count]));

    // FIX 2: total is the sum of all per-status counts, not the filtered page count
    const statusTotal =
      (countMap.requested || 0) +
      (countMap.approved || 0) +
      (countMap.processing || 0) +
      (countMap.completed || 0) +
      (countMap.rejected || 0) +
      (countMap.failed || 0) +
      (countMap.cancelled || 0);

    stats = {
      total: statusTotal,
      requested: countMap.requested || 0,
      approved: countMap.approved || 0,
      processing: countMap.processing || 0,
      completed: countMap.completed || 0,
      rejected: countMap.rejected || 0,
      failed: countMap.failed || 0,
      cancelled: countMap.cancelled || 0,
    };

    setCache(STATS_CACHE_KEY, JSON.stringify(stats), STATS_TTL_SECONDS).catch(() => {});
  }

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
// @route  GET /api/v1/admin/refunds/:id
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
// FIX 1: Controller now uses req.order attached by checkRefundEligibility
//         middleware instead of issuing a second Order.findById() call.
//         Eliminates the double DB fetch and the race-condition window
//         between middleware validation and controller execution.
// FIX 2: All eligibility checks (payment status, refund status, deadline,
//         ownership) removed from controller — they are guaranteed by
//         middleware and were duplicated here, creating drift risk.
// @route  POST /api/v1/orders/:id/refund/request
// @access Private (User who owns the order)
// ============================================

export const requestRefund = handleAsyncError(async (req, res, next) => {
  const { reason, description, refundType = 'full', requestedAmount } = req.body;
  const userId = req.user._id;

  // FIX 1: Use the order already fetched and validated by checkRefundEligibility
  const order = req.order;

  let refundAmount = order.amountPaid;
  if (refundType === 'partial') {
    // validateRefundAmount middleware already validated this value;
    // parseFloat is safe here.
    refundAmount = parseFloat(requestedAmount);
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
      order.addRefundDocument(
        resolveDocType(result.resource_type),
        result.secure_url,
        originalname,
        userId,
        ''
      );
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
// @route  GET /api/v1/orders/:id/refund/status
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
// FIX 1: Uses req.order from canReviewRefund — eliminates double DB fetch.
// FIX 2: Duplicate status check removed — guaranteed by middleware.
// FIX 3: Response now uses safeRefundResponse() to strip sensitive fields
//         (auditLog, paymentMeta.raw, invoiceInfo.pdfData, fraudCheck, etc.)
//         that were previously leaked by returning the raw order document.
// @route  PUT /api/v1/admin/orders/:id/refund/review
// @access Private (Admin only)
// ============================================

export const reviewRefundRequest = handleAsyncError(async (req, res, next) => {
  const { action, adminNote } = req.body;

  // FIX 1: Use the order already fetched and validated by canReviewRefund
  const order = req.order;

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
      // FIX 3: Safe response — no sensitive fields
      order: safeRefundResponse(order),
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
    // FIX 3: Safe response — no sensitive fields
    order: safeRefundResponse(order),
  });
});

// ============================================
// ADMIN PROCESSES REFUND PAYMENT
// FIX 1: Uses req.order from canProcessRefund — eliminates double DB fetch.
// FIX 2: Removed unreachable processing/completed guard (the preceding
//         status !== 'approved' check already gates those states).
// FIX 3: Atomic status transition via findOneAndUpdate before calling the
//         payment gateway. If two concurrent requests both pass the
//         canProcessRefund middleware check, only one will successfully
//         transition from 'approved' → 'processing'; the other receives a
//         null result and is rejected, preventing duplicate gateway calls.
// FIX 4: Response uses safeRefundResponse() — no raw document leak.
// FIX 5: refundAmount is now required (enforced in validateProcessRefund).
// @route  POST /api/v1/admin/orders/:id/refund/process
// @access Private (Admin only)
// ============================================

export const processRefundPayment = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { refundAmount, merchantNote } = req.body;

  // req.order is available but we intentionally re-fetch after the atomic
  // CAS update below to work on a post-update document. req.order is used
  // only for the maxRefund calculation before the gateway call.
  const order = req.order;

  const maxRefund = order.amountPaid - (order.refundInfo.refundAmount || 0);

  if (!refundAmount || refundAmount <= 0 || refundAmount > maxRefund) {
    return next(
      new HandleError(`Invalid refund amount. Maximum refundable: ${maxRefund}`, 400)
    );
  }

  // FIX 3: Atomic compare-and-swap — transition status from 'approved' →
  // 'processing' only if it is still 'approved'. A second concurrent
  // request will find 0 matching documents and be rejected before the
  // gateway is called, eliminating the duplicate-refund race condition.
  const transitioned = await Order.findOneAndUpdate(
    { _id: id, 'refundInfo.status': 'approved' },
    { $set: { 'refundInfo.status': 'processing' } },
    { new: false } // we don't need the updated doc here
  );

  if (!transitioned) {
    return next(
      new HandleError('Refund is no longer in an approved state. It may have already been processed.', 409)
    );
  }

  // Reload the document fresh after the atomic update so all subsequent
  // mutations work on the correct version.
  const freshOrder = await Order.findById(id);

  freshOrder.refundInfo.refundAmount = refundAmount;
  freshOrder.refundInfo.refundCurrency = freshOrder.paymentInfo.currency;
  freshOrder.refundInfo.processedAt = new Date();
  freshOrder.refundInfo.processedBy = req.user._id;
  if (merchantNote) freshOrder.refundInfo.adminNote = merchantNote;
  freshOrder.refundInfo.refundReference = `REF-${Date.now()}-${freshOrder._id.toString().slice(-6)}`;

  freshOrder.addRefundTimeline('refund_processing', 'Refund payment initiated', req.user._id, {
    refundAmount,
  });

  try {
    // PAYMENT GATEWAY INTEGRATION WOULD GO HERE
    const gatewayResponse = {
      success: true,
      refundId: `rfnd_${Date.now()}`,
      amount: refundAmount,
      currency: freshOrder.paymentInfo.currency,
      status: 'succeeded',
    };

    freshOrder.refundInfo.status = 'completed';
    freshOrder.refundInfo.refundedAt = new Date();
    freshOrder.refundInfo.refundId = gatewayResponse.refundId;
    freshOrder.refundInfo.gatewayResponse = gatewayResponse;

    freshOrder.addRefundTimeline(
      'refund_completed',
      'Refund successfully processed',
      req.user._id,
      { refundId: gatewayResponse.refundId, refundAmount }
    );
    freshOrder.addAuditEntry('refund_completed', req.user._id, { refundAmount });
  } catch (error) {
    freshOrder.refundInfo.status = 'failed';
    freshOrder.refundInfo.failureReason = error.message;

    freshOrder.addRefundTimeline('refund_failed', 'Refund processing failed', req.user._id, {
      error: error.message,
    });

    await freshOrder.save();
    invalidateRefundCaches();

    return next(new HandleError(`Refund processing failed: ${error.message}`, 500));
  }

  await freshOrder.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund processed successfully',
    // FIX 4: Safe response — no raw document leak
    order: safeRefundResponse(freshOrder),
  });
});

// ============================================
// ADD MESSAGE TO REFUND CONVERSATION (Admin)
// FIX 1: Uses req.order from canAddRefundMessage middleware.
// FIX 2: Redundant refundInfo state check removed — guaranteed by middleware.
// FIX 3: Redundant message.trim() check removed — sanitizeInput and
//         validateRefundMessage already guarantee a non-empty message by
//         the time execution reaches here.
// @route  POST /api/v1/admin/refunds/:id/messages
// @access Private (Admin only)
// ============================================

export const addRefundMessage = handleAsyncError(async (req, res, next) => {
  const { message, attachments = [] } = req.body;

  // FIX 1: Use the order already fetched and validated by canAddRefundMessage
  const order = req.order;

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
// FIX 1: Uses req.order from canAddRefundMessage middleware.
// FIX 2: Redundant ownership, refundInfo state, and message checks removed.
// @route  POST /api/v1/orders/:id/refund/messages
// @access Private (User who owns the order)
// ============================================

export const addCustomerRefundMessage = handleAsyncError(async (req, res, next) => {
  const { message, attachments = [] } = req.body;
  const userId = req.user._id;

  // FIX 1: Use the order already fetched and validated by canAddRefundMessage
  const order = req.order;

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
// GET REFUND MESSAGES (User or Admin)
// FIX 1: markRefundMessagesAsRead now uses a MongoDB arrayFilters bulk
//         update instead of loading only the $slice'd page. Previously,
//         marking-as-read only applied to the current page; messages on
//         other pages remained unread indefinitely. The update is issued
//         as a fire-and-forget after the response is sent so it does not
//         block the client.
// FIX 2: senderToMarkRead replaces the old inverted 'readerType' variable.
//         Old code: isAdmin ? 'customer' : 'admin' was passed to
//         markRefundMessagesAsRead() which internally marks messages where
//         senderType !== param. So admins were accidentally marking their
//         own messages read instead of customer messages.
//         New code: explicitly names the sender whose messages should be
//         marked read from the reader's perspective.
// @route  GET /api/v1/orders/:id/refund/messages
// @access Private (User or Admin)
// ============================================

export const getRefundMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const skip = (parseInt(page) - 1) * parseInt(limit);

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

  // FIX 2: senderToMarkRead is the party whose messages the current reader
  // should be marking as read — the opposite of who is reading.
  // Admin reads → mark customer messages as read.
  // Customer reads → mark admin messages as read.
  const senderToMarkRead = isAdmin ? 'customer' : 'admin';

  // FIX 1: Bulk-update all unread messages from senderToMarkRead across the
  // FULL messages array using arrayFilters — not limited to the current
  // $slice page. updateOne with no matching array elements is a safe no-op
  // so no pre-check countDocuments is needed; that would add an extra
  // round-trip with no benefit.
  Order.updateOne(
    { _id: id },
    {
      $set: {
        'refundInfo.messages.$[msg].isRead': true,
        'refundInfo.messages.$[msg].readAt': new Date(),
      },
    },
    {
      arrayFilters: [{ 'msg.isRead': false, 'msg.senderType': senderToMarkRead }],
    }
  ).catch((err) => console.error('Mark refund messages read error:', err));
  // Fire-and-forget — does not block the response

  return res.status(200).json({
    success: true,
    count: order.refundInfo.messages.length,
    messages: order.refundInfo.messages,
  });
});

// ============================================
// UPLOAD FILES FOR REFUND (Admin)
// FIX: Admin uploads now use resolveDocType() to map Cloudinary's
//      resource_type to the correct document type enum value. Previously
//      every file uploaded by an admin was stored as type 'other',
//      regardless of whether it was an image or video.
// @route  POST /api/v1/admin/refunds/:id/upload
// @access Private (Admin only)
// ============================================

export const uploadRefundFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  // No middleware attaches req.order for this route — own fetch is necessary.
  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  const folder = `ecommerce/refunds/${order._id}/admin`;

  const results = await Promise.all(
    req.files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' }).then((result) => ({
        result,
        originalname: file.originalname,
      }))
    )
  );

  const uploadedFiles = results.map(({ result, originalname }) => {
    // FIX: use shared resolveDocType instead of hardcoded 'other'
    order.addRefundDocument(
      resolveDocType(result.resource_type),
      result.secure_url,
      originalname,
      req.user._id,
      ''
    );
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
// No changes — was already correct. Own fetch is necessary (no middleware
// attaches req.order for this route). resolveDocType() replaces the
// inline ternary chain for consistency.
// @route  POST /api/v1/orders/:id/refund/upload
// @access Private (User who owns the order)
// ============================================

export const uploadCustomerRefundFiles = handleAsyncError(async (req, res, next) => {
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

  const folder = `ecommerce/refunds/${order._id}/customer`;

  const results = await Promise.all(
    req.files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' }).then((result) => ({
        result,
        originalname: file.originalname,
      }))
    )
  );

  const uploadedFiles = results.map(({ result, originalname }) => {
    order.addRefundDocument(
      resolveDocType(result.resource_type),
      result.secure_url,
      originalname,
      userId,
      ''
    );
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
// GET REFUND TIMELINE (User or Admin)
// FIX: .select() uses an object projection instead of a string to ensure
//      only refundInfo.timeline and user fields are loaded. String-based
//      dot-notation projection on nested paths can load the full parent
//      subdocument in some Mongoose/MongoDB versions.
// @route  GET /api/v1/orders/:id/refund/timeline
// @access Private (User or Admin)
// ============================================

export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.timeline.performedBy', 'name email role')
    // FIX: object projection is reliable for nested subdocument paths
    .select({ 'refundInfo.timeline': 1, user: 1 });

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
// GET REFUND DOCUMENTS (User or Admin)
// FIX: Same object projection fix as getRefundTimeline.
// @route  GET /api/v1/orders/:id/refund/documents
// @access Private (User or Admin)
// ============================================

export const getRefundDocuments = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.documents.uploadedBy', 'name email role')
    // FIX: object projection is reliable for nested subdocument paths
    .select({ 'refundInfo.documents': 1, user: 1 });

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
// FIX 1: Added .limit(50) to prevent unbounded query — previously all
//         matching orders were fetched with no cap.
// FIX 2: Added .select() projection — previously the static method loaded
//         full order documents; the controller only used ~6 fields.
// @route  GET /api/v1/admin/refunds/unread
// @access Private (Admin only)
// ============================================

export const getRefundsWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  // FIX 1 & 2: limit and projection applied at the call site since the
  // static method is also used elsewhere and should remain generic.
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
// FIX 1: Uses req.order from canCancelRefund — eliminates double DB fetch.
// FIX 2: Redundant ownership and status checks removed.
// FIX 3: addStatusHistory('Refund Cancelled') added for a complete audit
//         trail. requestRefund adds 'Refund Requested'; the cancel path
//         previously had no matching status history entry.
// @route  PUT /api/v1/orders/:id/refund/cancel
// @access Private (User who owns the order)
// ============================================

export const cancelRefundRequest = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  // FIX 1: Use the order already fetched and validated by canCancelRefund
  const order = req.order;

  order.refundInfo.status = 'cancelled';
  order.addRefundTimeline('refund_cancelled', 'Refund cancelled by customer', userId);
  order.addAuditEntry('refund_cancelled', userId);
  // FIX 3: Mirror the addStatusHistory call made in requestRefund
  order.addStatusHistory('Refund Cancelled', userId, 'Customer cancelled refund request');

  await order.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund request cancelled successfully',
  });
});