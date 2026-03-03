import mongoose from 'mongoose';
import Order from '../models/order-model.js';
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinaryUpload.js';
import { deleteCachePattern, getCache, setCache } from '../utils/redis.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Fields that are safe to return in list responses. Excludes auditLog,
// shipments, paymentMeta, fraudCheck, orderItems — none of which are
// needed to render the refunds table or KPI cards.
const LIST_PROJECTION = {
  user: 1,
  orderNumber: 1,
  orderStatus: 1,
  totalPrice: 1,
  amountPaid: 1,
  'paymentInfo.method': 1,
  'paymentInfo.currency': 1,
  'paymentInfo.status': 1,
  'refundInfo.status': 1,
  'refundInfo.reason': 1,
  'refundInfo.refundType': 1,
  'refundInfo.requestedAmount': 1,
  'refundInfo.refundAmount': 1,
  'refundInfo.requestedAt': 1,
  'refundInfo.adminNote': 1,
  'refundInfo.messages': 1,   // needed for unreadMessages virtual
  createdAt: 1,
};

// Strip sensitive / heavy fields from single-order responses. Returns only
// what the detail panel and message modal need.
const safeRefundResponse = (order) => ({
  _id:             order._id,
  orderNumber:     order.orderNumber,
  orderStatus:     order.orderStatus,
  totalPrice:      order.totalPrice,
  amountPaid:      order.amountPaid,
  refundableAmount: order.refundableAmount,   // virtual
  paymentInfo: {
    method:   order.paymentInfo?.method,
    currency: order.paymentInfo?.currency,
    status:   order.paymentInfo?.status,
  },
  user: order.user,
  refundInfo: {
    status:          order.refundInfo?.status,
    reason:          order.refundInfo?.reason,
    description:     order.refundInfo?.description,
    refundType:      order.refundInfo?.refundType,
    requestedAmount: order.refundInfo?.requestedAmount,
    requestedAt:     order.refundInfo?.requestedAt,
    reviewedAt:      order.refundInfo?.reviewedAt,
    approvedAt:      order.refundInfo?.approvedAt,
    approvedBy:      order.refundInfo?.approvedBy,
    rejectedAt:      order.refundInfo?.rejectedAt,
    rejectedBy:      order.refundInfo?.rejectedBy,
    adminNote:       order.refundInfo?.adminNote,
    refundAmount:    order.refundInfo?.refundAmount,
    refundCurrency:  order.refundInfo?.refundCurrency,
    refundReference: order.refundInfo?.refundReference,
    refundId:        order.refundInfo?.refundId,
    processedAt:     order.refundInfo?.processedAt,
    refundedAt:      order.refundInfo?.refundedAt,
    failureReason:   order.refundInfo?.failureReason,
    messages:        order.refundInfo?.messages,
    documents:       order.refundInfo?.documents,
    timeline:        order.refundInfo?.timeline,
  },
  unreadMessages: order.unreadRefundMessages,   // virtual
  createdAt:      order.createdAt,
});

// Shared cache invalidation — fire-and-forget, never blocks responses.
const invalidateRefundCaches = () => {
  Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('refund_overview*'),
    deleteCachePattern('refund_stats*'),
    deleteCachePattern('refunds_by_payment_method*'),
    deleteCachePattern('refund_timeline*'),
  ]).catch((err) => console.error('Refund cache invalidation error:', err));
};

// Cloudinary resource_type → document type enum map.
// Shared by admin and customer upload handlers so the mapping stays
// consistent and is not duplicated.
const resolveDocType = (resourceType) => {
  if (resourceType === 'image') return 'photo';
  if (resourceType === 'video') return 'video';
  return 'other';
};

// Compute refund stats from a count query rather than loading documents.
// Stats are always computed against the full non-filtered dataset so cached
// values are never contaminated by a ?status filter.
const getRefundStats = async () => {
  const results = await Order.aggregate([
    { $match: { 'refundInfo.status': { $nin: ['none'] } } },
    { $group: { _id: '$refundInfo.status', count: { $sum: 1 } } },
  ]);

  const stats = {
    total: 0, requested: 0, approved: 0, rejected: 0,
    processing: 0, completed: 0, failed: 0, cancelled: 0,
  };

  results.forEach(({ _id, count }) => {
    if (_id in stats) stats[_id] = count;
    stats.total += count;
  });

  return stats;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/v1/admin/refunds ─────────────────────────────────────────────
// Supports: status filter, date range, search (orderNumber or customer name),
//           pagination. Stats are always computed from the full dataset
//           independent of the ?status filter.
export const getAllRefunds = handleAsyncError(async (req, res, next) => {
  const {
    status,
    startDate,
    endDate,
    search,
    page  = 1,
    limit = 20,
  } = req.query;

  const pageNum  = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const skip     = (pageNum - 1) * limitNum;

  // List filter — may be narrowed by ?status.
  // Uses compound index { 'refundInfo.status': 1, 'refundInfo.requestedAt': -1 }.
  const baseMatch = {
    'refundInfo.status': { $nin: ['none'] },
  };

  if (status) {
    baseMatch['refundInfo.status'] = status;
  }

  if (startDate || endDate) {
    baseMatch['refundInfo.requestedAt'] = {};
    if (startDate) {
      baseMatch['refundInfo.requestedAt'].$gte = new Date(startDate);
    }
    if (endDate) {
      // Include the full end date day up to 23:59:59.999.
      baseMatch['refundInfo.requestedAt'].$lte = new Date(
        new Date(endDate).setHours(23, 59, 59, 999)
      );
    }
  }

  // Stats cache is keyed to 'all' only — never to a specific status filter
  // so cached stats always represent the global picture.
  const STATS_CACHE_KEY    = 'refund_stats:all';
  const STATS_TTL_SECONDS  = 60;

  let stats = null;
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) stats = JSON.parse(cached);
  } catch (_) { /* cache miss is fine */ }

  let orders;
  let totalRefunds;

  // ── Search path ───────────────────────────────────────────────────────────
  // orderNumber search: plain find() — orderNumber is indexed on Order directly.
  // Name/email search: aggregation with $lookup — user is a ref, not embedded,
  //   so we can't query user.firstName at find() time.
  if (search && search.trim()) {
    const trimmed = search.trim();

    // orderNumber is last 8 chars of _id uppercased, e.g. "A1B2C3D4".
    const isOrderNumberSearch = /^[a-f0-9]+$/i.test(trimmed);

    if (isOrderNumberSearch) {
      // Efficient regex on the indexed orderNumber field.
      // Collation on the index makes this case-insensitive without 'i' flag overhead.
      const orderMatch = {
        ...baseMatch,
        orderNumber: { $regex: trimmed, $options: 'i' },
      };

      [orders, totalRefunds] = await Promise.all([
        Order.find(orderMatch)
          .select(LIST_PROJECTION)
          .populate('user', 'firstName lastName email')
          .populate('refundInfo.messages.sender', 'firstName lastName email')
          .sort({ 'refundInfo.requestedAt': -1, _id: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean({ virtuals: true }),
        Order.countDocuments(orderMatch),
      ]);
    } else {
      // Name/email search — requires $lookup because user is a ref.
      // baseMatch runs before $lookup so only refund orders are joined,
      // keeping the join set small.
      const nameRx = new RegExp(trimmed, 'i');

      const pipeline = [
        { $match: baseMatch },
        {
          $lookup: {
            from:         'users',
            localField:   'user',
            foreignField: '_id',
            as:           'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmpty: true } },
        {
          $match: {
            $or: [
              { 'user.firstName': nameRx },
              { 'user.lastName':  nameRx },
              { 'user.email':     nameRx },
            ],
          },
        },
        {
          $facet: {
            data: [
              { $sort:  { 'refundInfo.requestedAt': -1, _id: -1 } },
              { $skip:  skip },
              { $limit: limitNum },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ];

      const [result] = await Order.aggregate(pipeline);
      totalRefunds   = result.total[0]?.count ?? 0;

      // Aggregate returns plain objects — virtuals don't fire. Compute
      // unreadMessages manually so the table renderer gets the same shape
      // as the find() path.
      orders = (result.data ?? []).map((o) => ({
        ...o,
        unreadMessages: (o.refundInfo?.messages ?? []).filter(
          (m) => !m.isRead && m.senderType === 'customer'
        ).length,
      }));
    }
  } else {
    // No search — plain find() with projection and populate.
    [orders, totalRefunds] = await Promise.all([
      Order.find(baseMatch)
        .select(LIST_PROJECTION)
        .populate('user', 'firstName lastName email')
        .populate('refundInfo.messages.sender', 'firstName lastName email')
        .sort({ 'refundInfo.requestedAt': -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Order.countDocuments(baseMatch),
    ]);
  }

  // Stats — only computed when cache is cold.
  if (!stats) {
    stats = await getRefundStats();
    setCache(STATS_CACHE_KEY, JSON.stringify(stats), STATS_TTL_SECONDS).catch(() => {});
  }

  res.status(200).json({
    success: true,
    orders,
    stats,
    count:       orders.length,
    totalRefunds,
    currentPage: pageNum,
    totalPages:  Math.ceil(totalRefunds / limitNum),
  });
});

// ── GET /api/v1/admin/refunds/unread ─────────────────────────────────────
// Returns orders with unread customer refund messages.
export const getRefundsWithUnreadMessages = handleAsyncError(async (req, res) => {
  const orders = await Order.getRefundsWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count:   orders.length,
    orders:  orders.map((order) => ({
      _id:  order._id,
      user: order.user,
      refundInfo: {
        status:          order.refundInfo.status,
        reason:          order.refundInfo.reason,
        requestedAmount: order.refundInfo.requestedAmount,
        unreadCount:     order.unreadRefundMessages,   // virtual
      },
      latestMessage: order.latestRefundMessage,        // virtual
    })),
  });
});

// ── GET /api/v1/admin/refunds/:orderId ────────────────────────────────────
// Returns a single refund order. Also marks all customer messages as read.
export const getSingleRefund = handleAsyncError(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId)
    .populate('user',                               'firstName lastName email phone')
    .populate('refundInfo.requestedBy',             'firstName lastName email')
    .populate('refundInfo.approvedBy',              'firstName lastName email')
    .populate('refundInfo.rejectedBy',              'firstName lastName email')
    .populate('refundInfo.processedBy',             'firstName lastName email')
    .populate('refundInfo.messages.sender',         'firstName lastName email role')
    .populate('refundInfo.documents.uploadedBy',    'firstName lastName email')
    .populate('refundInfo.timeline.performedBy',    'firstName lastName email')
    .populate('orderItems.product',                 'name images');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo?.status === 'none') {
    return next(new HandleError('This order has no refund request', 400));
  }

  // Mark all unread customer messages as read now that admin is viewing.
  const hasUnread = order.refundInfo?.messages?.some(
    (m) => !m.isRead && m.senderType === 'customer'
  );

  if (hasUnread) {
    order.markRefundMessagesAsRead('admin');
    await order.save({ validateBeforeSave: false });
  }

  res.status(200).json({
    success: true,
    order: {
      _id:              order._id,
      user:             order.user,
      orderNumber:      order.orderNumber,
      orderItems:       order.orderItems,
      shippingInfo:     order.shippingInfo,
      paymentInfo:      order.paymentInfo,
      refundInfo:       order.refundInfo,
      orderStatus:      order.orderStatus,
      totalPrice:       order.totalPrice,
      amountPaid:       order.amountPaid,
      refundableAmount: order.refundableAmount,
      createdAt:        order.createdAt,
      deliveredAt:      order.deliveredAt,
    },
  });
});

// ── POST /api/v1/orders/:orderId/refund/request ───────────────────────────
// Customer submits a refund request.
// Uses req.order attached by checkRefundEligibility middleware.
export const requestRefund = handleAsyncError(async (req, res, next) => {
  const { reason, description, refundType = 'full', requestedAmount } = req.body;
  const userId = req.user._id;

  // Use the order already fetched and validated by checkRefundEligibility.
  const order = req.order;

  let refundAmount = order.amountPaid;
  if (refundType === 'partial') {
    // validateRefundAmount middleware already validated this value.
    refundAmount = parseFloat(requestedAmount);
  }

  order.refundInfo = {
    status:          'requested',
    reason,
    description,
    refundType,
    requestedAmount: refundAmount,
    requestedAt:     new Date(),
    requestedBy:     userId,
    messages:        [],
    documents:       [],
    timeline:        [],
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
    success:    true,
    message:    'Refund request submitted successfully. Our team will review your request.',
    refundInfo: order.refundInfo,
  });
});

// ── GET /api/v1/orders/:orderId/refund/status ─────────────────────────────
// Customer checks their own refund status.
export const getRefundStatus = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;

  const order = await Order.findById(orderId).select('user refundInfo orderNumber');
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({
    success:    true,
    refundInfo: order.refundInfo || { status: 'none', hasRefund: false },
  });
});

// ── PUT /api/v1/admin/orders/:orderId/refund/review ───────────────────────
// Approves or rejects a refund request.
// Uses req.order attached by canReviewRefund middleware.
export const reviewRefund = handleAsyncError(async (req, res, next) => {
  const { action, adminNote } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    return next(new HandleError('action must be "approve" or "reject"', 400));
  }

  // Use the order already fetched and validated by canReviewRefund middleware
  // when present, otherwise fall back to fetching by param.
  const order = req.order ?? await Order.findById(req.params.orderId);

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.refundInfo?.status !== 'requested') {
    return next(
      new HandleError(
        `Cannot review a refund with status "${order.refundInfo?.status}"`,
        400
      )
    );
  }

  const now       = new Date();
  const isApprove = action === 'approve';

  order.refundInfo.status     = isApprove ? 'approved' : 'rejected';
  order.refundInfo.reviewedAt = now;
  order.refundInfo.adminNote  = adminNote ?? order.refundInfo.adminNote;

  if (isApprove) {
    order.refundInfo.approvedAt = now;
    order.refundInfo.approvedBy = req.user._id;
  } else {
    order.refundInfo.rejectedAt = now;
    order.refundInfo.rejectedBy = req.user._id;
  }

  order.addRefundTimeline(
    isApprove ? 'refund_approved' : 'refund_rejected',
    isApprove
      ? `Refund approved by admin${adminNote ? `: ${adminNote}` : ''}`
      : `Refund rejected by admin${adminNote ? `: ${adminNote}` : ''}`,
    req.user._id
  );

  // Notify customer via system message.
  order.addRefundMessage(
    req.user._id,
    'admin',
    isApprove
      ? `Your refund request has been approved.${adminNote ? ` Note: ${adminNote}` : ''}`
      : `Your refund request has been rejected.${adminNote ? ` Reason: ${adminNote}` : ''}`
  );

  order.addAuditEntry(
    `refund_${isApprove ? 'approved' : 'rejected'}`,
    req.user._id,
    { field: 'refundInfo.status', oldValue: 'requested', newValue: order.refundInfo.status }
  );

  await order.save();
  invalidateRefundCaches();

  await order.populate('user', 'firstName lastName email');

  res.status(200).json({
    success: true,
    message: `Refund ${isApprove ? 'approved' : 'rejected'} successfully`,
    order:   safeRefundResponse(order),
  });
});

// ── POST /api/v1/admin/orders/:orderId/refund/process ─────────────────────
// Processes the actual payment transfer for an approved refund.
// Uses req.order from canProcessRefund middleware. Applies an atomic
// compare-and-swap to prevent duplicate gateway calls under concurrency.
export const processRefund = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const { refundAmount, merchantNote } = req.body;

  if (!refundAmount || isNaN(Number(refundAmount)) || Number(refundAmount) <= 0) {
    return next(new HandleError('A valid refundAmount is required', 400));
  }

  // Use the order already fetched and validated by canProcessRefund middleware
  // when present, otherwise fall back to fetching by param.
  const order = req.order ?? await Order.findById(orderId);

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.refundInfo?.status !== 'approved') {
    return next(
      new HandleError(
        `Cannot process a refund with status "${order.refundInfo?.status}". Must be "approved".`,
        400
      )
    );
  }

  // Enforce refundableAmount (amountPaid minus any already-refunded amount)
  // to prevent over-refunding on partial refunds already partially processed.
  const maxRefund = order.amountPaid - (order.refundInfo.refundAmount || 0);

  if (Number(refundAmount) > maxRefund) {
    return next(
      new HandleError(
        `Refund amount $${refundAmount} exceeds the maximum refundable amount of $${maxRefund.toFixed(2)}`,
        400
      )
    );
  }

  // Atomic compare-and-swap — transition status from 'approved' → 'processing'
  // only if it is still 'approved'. A second concurrent request will find 0
  // matching documents and be rejected before the gateway is called,
  // eliminating the duplicate-refund race condition.
  const transitioned = await Order.findOneAndUpdate(
    { _id: orderId, 'refundInfo.status': 'approved' },
    { $set: { 'refundInfo.status': 'processing' } },
    { new: false }
  );

  if (!transitioned) {
    return next(
      new HandleError(
        'Refund is no longer in an approved state. It may have already been processed.',
        409
      )
    );
  }

  // Reload fresh after the atomic update so all subsequent mutations work
  // on the correct version.
  const freshOrder = await Order.findById(orderId);

  freshOrder.refundInfo.refundAmount   = Number(refundAmount);
  freshOrder.refundInfo.refundCurrency = freshOrder.paymentInfo?.currency ?? 'USD';
  freshOrder.refundInfo.processedAt    = new Date();
  freshOrder.refundInfo.processedBy    = req.user._id;
  freshOrder.refundInfo.refundReference = `REF-${Date.now()}-${freshOrder._id.toString().slice(-6)}`;
  if (merchantNote) freshOrder.refundInfo.notes = merchantNote;

  freshOrder.addRefundTimeline(
    'refund_processing',
    `Refund of $${Number(refundAmount).toFixed(2)} initiated`,
    req.user._id,
    { refundAmount }
  );

  freshOrder.addAuditEntry(
    'refund_processing',
    req.user._id,
    { field: 'refundInfo.status', oldValue: 'approved', newValue: 'processing' }
  );

  // ── Payment gateway integration ─────────────────────────────────────────
  // Replace this block with your actual gateway call (Paystack, Stripe, etc.).
  // On success: set status → 'completed', store gatewayResponse, refundReference.
  // On failure: set status → 'failed', store failureReason.
  try {
    // const gatewayResult = await yourGateway.refund({ ... });
    // freshOrder.refundInfo.gatewayResponse = gatewayResult;
    // freshOrder.refundInfo.refundId        = gatewayResult.refundId;
    freshOrder.refundInfo.status     = 'completed';
    freshOrder.refundInfo.refundedAt = new Date();

    freshOrder.addRefundTimeline(
      'refund_completed',
      `Refund of $${Number(refundAmount).toFixed(2)} completed successfully`,
      req.user._id,
      { refundAmount }
    );

    freshOrder.addRefundMessage(
      req.user._id,
      'admin',
      `Your refund of $${Number(refundAmount).toFixed(2)} has been processed and should appear within 3–5 business days.`
    );

    freshOrder.addAuditEntry(
      'refund_completed',
      req.user._id,
      { field: 'refundInfo.status', oldValue: 'processing', newValue: 'completed' }
    );
  } catch (gatewayErr) {
    freshOrder.refundInfo.status        = 'failed';
    freshOrder.refundInfo.failureReason = gatewayErr?.message ?? 'Gateway error';

    freshOrder.addRefundTimeline(
      'refund_failed',
      `Refund failed: ${freshOrder.refundInfo.failureReason}`,
      req.user._id
    );

    freshOrder.addAuditEntry(
      'refund_failed',
      req.user._id,
      { field: 'refundInfo.status', oldValue: 'processing', newValue: 'failed' }
    );

    await freshOrder.save();
    invalidateRefundCaches();

    return next(new HandleError(`Refund processing failed: ${gatewayErr?.message ?? 'Gateway error'}`, 500));
  }

  await freshOrder.save();
  invalidateRefundCaches();

  await freshOrder.populate('user', 'firstName lastName email');

  res.status(200).json({
    success: true,
    message: freshOrder.refundInfo.status === 'completed'
      ? 'Refund processed successfully'
      : 'Refund processing failed — check failureReason',
    order: safeRefundResponse(freshOrder),
  });
});

// ── GET /api/v1/orders/:orderId/refund/messages ───────────────────────────
// Paginated refund message history. Accessible by both customer and admin.
// Bulk-updates all unread messages as read via arrayFilters (fire-and-forget)
// so messages across all pages are marked, not just the current slice.
export const getRefundMessages = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const page        = Math.max(1, Number(req.query.page  ?? 1));
  const limit       = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const userId      = req.user._id;
  const isAdmin     = req.user.role === 'admin';
  const skip        = (page - 1) * limit;

  const order = await Order.findById(orderId, {
    user:                    1,
    'refundInfo.status':     1,
    'refundInfo.messages':   { $slice: [skip, limit] },
  }).populate('refundInfo.messages.sender', 'firstName lastName email role');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo?.messages) {
    return res.status(200).json({ success: true, total: 0, messages: [] });
  }

  // Admin reads → mark customer messages as read.
  // Customer reads → mark admin messages as read.
  const senderToMarkRead = isAdmin ? 'customer' : 'admin';

  // Bulk-update all unread messages from senderToMarkRead across the FULL
  // messages array using arrayFilters — not limited to the current $slice.
  // Fire-and-forget so it does not block the response.
  Order.updateOne(
    { _id: orderId },
    {
      $set: {
        'refundInfo.messages.$[msg].isRead': true,
        'refundInfo.messages.$[msg].readAt': new Date(),
      },
    },
    { arrayFilters: [{ 'msg.isRead': false, 'msg.senderType': senderToMarkRead }] }
  ).catch((err) => console.error('Mark refund messages read error:', err));

  return res.status(200).json({
    success:  true,
    messages: order.refundInfo.messages,
    total:    order.refundInfo.messages.length,
    page,
    limit,
  });
});

// ── POST /api/v1/admin/refunds/:orderId/messages ──────────────────────────
// Admin sends a message on a refund thread.
// Uses req.order from canAddRefundMessage middleware when available.
export const sendRefundMessage = handleAsyncError(async (req, res, next) => {
  const { message, attachments = [] } = req.body;

  if (!message?.trim() && attachments.length === 0) {
    return next(new HandleError('Message content or attachments are required', 400));
  }

  const order = req.order ?? await Order.findById(req.params.orderId);

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.refundInfo?.status === 'none') {
    return next(new HandleError('This order has no refund request', 400));
  }

  order.addRefundMessage(req.user._id, 'admin', message?.trim() ?? '', attachments);

  await order.save();

  const newMessage = order.refundInfo.messages[order.refundInfo.messages.length - 1];

  // Manually populate sender from req.user — avoids an extra DB round-trip.
  const populatedMessage = {
    ...newMessage.toObject(),
    sender: {
      _id:       req.user._id,
      firstName: req.user.firstName,
      lastName:  req.user.lastName,
      email:     req.user.email,
      role:      req.user.role,
    },
  };

  res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data:    { orderId: order._id, message: populatedMessage },
  });
});

// ── POST /api/v1/orders/:orderId/refund/messages ──────────────────────────
// Customer sends a message on a refund thread.
// Uses req.order from canAddRefundMessage middleware when available.
export const addCustomerRefundMessage = handleAsyncError(async (req, res, next) => {
  const { message, attachments = [] } = req.body;
  const userId = req.user._id;

  const order = req.order ?? await Order.findById(req.params.orderId);

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (order.refundInfo?.status === 'none') {
    return next(new HandleError('This order has no refund request', 400));
  }

  order.addRefundMessage(userId, 'customer', message?.trim() ?? '', attachments);

  await order.save();

  const newMessage = order.refundInfo.messages[order.refundInfo.messages.length - 1];

  const populatedMessage = {
    ...newMessage.toObject(),
    sender: {
      _id:       req.user._id,
      firstName: req.user.firstName,
      lastName:  req.user.lastName,
      email:     req.user.email,
      role:      req.user.role,
    },
  };

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data:    { orderId: order._id, message: populatedMessage },
  });
});

// ── GET /api/v1/orders/:orderId/refund/timeline ───────────────────────────
// Accessible by both customer and admin.
export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;
  const isAdmin     = req.user.role === 'admin';

  const order = await Order.findById(orderId)
    .populate('refundInfo.timeline.performedBy', 'firstName lastName email role')
    // Object projection is reliable for nested subdocument paths.
    .select({ 'refundInfo.timeline': 1, user: 1 });

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  res.status(200).json({
    success:  true,
    count:    order.refundInfo?.timeline?.length ?? 0,
    timeline: order.refundInfo?.timeline ?? [],
  });
});

// ── GET /api/v1/orders/:orderId/refund/documents ──────────────────────────
// Accessible by both customer and admin.
export const getRefundDocuments = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;
  const isAdmin     = req.user.role === 'admin';

  const order = await Order.findById(orderId)
    .populate('refundInfo.documents.uploadedBy', 'firstName lastName email role')
    // Object projection is reliable for nested subdocument paths.
    .select({ 'refundInfo.documents': 1, user: 1 });

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  res.status(200).json({
    success:   true,
    count:     order.refundInfo?.documents?.length ?? 0,
    documents: order.refundInfo?.documents ?? [],
  });
});

// ── POST /api/v1/admin/refunds/:orderId/upload ────────────────────────────
// Admin uploads files to Cloudinary and attaches them as refund documents.
export const uploadRefundFiles = handleAsyncError(async (req, res, next) => {
  if (!req.files?.length) {
    return next(new HandleError('No files provided', 400));
  }

  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found for this order', 400));
  }

  const folder  = `ecommerce/refunds/${order._id}/admin`;

  const results = await Promise.all(
    req.files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' }).then((result) => ({
        result,
        originalname: file.originalname,
        size:         file.size,
      }))
    )
  );

  const uploadedFiles = results.map(({ result, originalname, size }) => {
    order.addRefundDocument(
      resolveDocType(result.resource_type),
      result.secure_url,
      originalname,
      req.user._id,
      ''
    );
    return {
      url:      result.secure_url,
      filename: originalname,
      fileType: result.resource_type,
      fileSize: result.bytes ?? size,
    };
  });

  await order.save();

  res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files:   uploadedFiles,
  });
});

// ── POST /api/v1/orders/:orderId/refund/upload ────────────────────────────
// Customer uploads files for their own refund.
export const uploadCustomerRefundFiles = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;

  if (!req.files?.length) {
    return next(new HandleError('No files provided', 400));
  }

  const order = await Order.findById(orderId);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found for this order', 400));
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
      url:      result.secure_url,
      filename: originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    };
  });

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files:   uploadedFiles,
  });
});

// ── PUT /api/v1/orders/:orderId/refund/cancel ─────────────────────────────
// Customer cancels their own refund request.
// Uses req.order from canCancelRefund middleware when available.
export const cancelRefundRequest = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const order = req.order ?? await Order.findById(req.params.orderId);

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!['requested', 'approved'].includes(order.refundInfo?.status)) {
    return next(
      new HandleError(
        `Cannot cancel a refund with status "${order.refundInfo?.status}"`,
        400
      )
    );
  }

  order.refundInfo.status = 'cancelled';
  order.addRefundTimeline('refund_cancelled', 'Refund cancelled by customer', userId);
  order.addAuditEntry('refund_cancelled', userId);
  order.addStatusHistory('Refund Cancelled', userId, 'Customer cancelled refund request');

  await order.save();
  invalidateRefundCaches();

  return res.status(200).json({
    success: true,
    message: 'Refund request cancelled successfully',
  });
});