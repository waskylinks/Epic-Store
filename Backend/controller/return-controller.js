import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern, getCache, setCache } from '../utils/redis.js';
import { uploadToCloudinary } from '../utils/cloudinaryUpload.js';

// ============================================
// SHARED CACHE INVALIDATION
// Fire-and-forget — never blocks responses.
// ============================================

const invalidateReturnCaches = () => {
  Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('return_overview*'),
    deleteCachePattern('return_stats*'),
    deleteCachePattern('returns_by_product*'),
    deleteCachePattern('returns_by_category*'),
  ]).catch(() => {
    // Cache invalidation failure must never affect the primary response
  });
};

// ============================================
// GET ALL RETURN REQUESTS (Admin)
// FIX: Replaced 9 separate DB queries (1 find + 8 countDocuments) with a
// single $facet aggregation. Stats are served from Redis for 60 s on warm
// cache so repeated page loads don't touch MongoDB for counts at all.
// @route GET /api/v1/admin/returns
// @access Private (Admin only)
// ============================================

export const getAllReturns = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const matchStage = { 'returnInfo.status': { $nin: ['none'] } };
  if (status) matchStage['returnInfo.status'] = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // ── Stats: serve from Redis cache when warm ──────────────────────────────
  const STATS_CACHE_KEY = `return_stats:${status || 'all'}`;
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
        // Paginated list — only fields needed for table rows
        data: [
          { $sort: { 'returnInfo.requestedAt': -1 } },
          { $skip: skip },
          { $limit: parseInt(limit) },
          {
            $project: {
              user: 1,
              returnInfo: {
                status: 1,
                rmaNumber: 1,
                reason: 1,
                description: 1,
                itemsToReturn: 1,
                requestedAmount: 1,
                requestedAt: 1,
                requestedBy: 1,
                adminNote: 1,
                restockFee: 1,
              },
              orderStatus: 1,
              totalPrice: 1,
              createdAt: 1,
              // Inline unread count — avoids virtual on lean doc
              unreadMessages: {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$returnInfo.messages', []] },
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
                    _id: '$returnInfo.status',
                    count: { $sum: 1 },
                  },
                },
              ],
            }),
      },
    },
  ]);

  const orders = facetResult.data || [];
  const totalReturns = facetResult.totalCount?.[0]?.count || 0;

  // Build / refresh stats
  if (!stats) {
    const rawCounts = facetResult.statCounts || [];
    const countMap = Object.fromEntries(rawCounts.map((s) => [s._id, s.count]));
    stats = {
      total: totalReturns,
      requested: countMap.requested || 0,
      approved: countMap.approved || 0,
      in_transit: countMap.in_transit || 0,
      received: countMap.received || 0,
      inspected: countMap.inspected || 0,
      completed: countMap.completed || 0,
      rejected: countMap.rejected || 0,
      cancelled: countMap.cancelled || 0,
    };

    // Populate Redis — intentionally fire-and-forget
    setCache(STATS_CACHE_KEY, JSON.stringify(stats), STATS_TTL_SECONDS).catch(() => {});
  }

  // Populate lightweight fields only; heavy population lives in getSingleReturn
  await Order.populate(orders, [
    { path: 'user', select: 'name email' },
    { path: 'returnInfo.requestedBy', select: 'name email' },
  ]);

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalReturns,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalReturns / parseInt(limit)),
    stats,
    returns: orders.map((order) => ({
      orderId: order._id,
      user: order.user,
      returnInfo: order.returnInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      unreadMessages: order.unreadMessages,
      createdAt: order.createdAt,
    })),
  });
});

// ============================================
// GET SINGLE RETURN (Admin)
// @route GET /api/v1/admin/returns/:id
// @access Private (Admin only)
// ============================================

export const getSingleReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user', 'name email phone')
    .populate('returnInfo.requestedBy', 'name email')
    .populate('returnInfo.approvedBy', 'name email')
    .populate('returnInfo.inspectedBy', 'name email')
    .populate('returnInfo.messages.sender', 'name email role')
    .populate('returnInfo.documents.uploadedBy', 'name email')
    .populate('orderItems.product', 'name images price');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found for this order', 404));
  }

  // FIX: Only write if there is actually something to mark — avoids a
  // superfluous save() on every admin view.
  const hasUnread = order.returnInfo.messages?.some(
    (m) => !m.isRead && m.senderType === 'customer'
  );
  if (hasUnread) {
    order.markReturnMessagesAsRead('admin');
    await order.save({ validateBeforeSave: false });
  }

  return res.status(200).json({
    success: true,
    order: {
      _id: order._id,
      user: order.user,
      orderItems: order.orderItems,
      shippingInfo: order.shippingInfo,
      returnInfo: order.returnInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
    },
  });
});

// ============================================
// CUSTOMER REQUESTS RETURN
// @route POST /api/v1/orders/:id/return/request
// @access Private (User who owns the order)
// ============================================

export const requestReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, description, items, attachments = [] } = req.body;
  const userId = req.user._id;

  if (!reason || !description || !items || items.length === 0) {
    return next(
      new HandleError('Reason, description, and items to return are required', 400)
    );
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (order.orderStatus !== 'Delivered') {
    return next(new HandleError('Can only return delivered orders', 400));
  }

  if (order.returnInfo && order.returnInfo.status !== 'none') {
    return next(new HandleError('Return request already exists for this order', 400));
  }

  order.returnInfo = {
    status: 'requested',
    reason,
    description,
    itemsToReturn: items,
    requestedAt: new Date(),
    requestedBy: userId,
    attachments,
    messages: [],
    timeline: [],
    documents: [],
  };

  order.addReturnTimeline('return_requested', `Return requested: ${reason}`, userId);
  order.addStatusHistory('Return Requested', userId, reason);
  order.addAuditEntry('return_requested', userId, {
    reason,
    description,
    itemsCount: items.length,
  });

  await order.save();
  invalidateReturnCaches();

  return res.status(200).json({
    success: true,
    message: 'Return request submitted successfully',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADMIN APPROVES / REJECTS RETURN
// @route PUT /api/v1/admin/orders/:id/return/review
// @access Private (Admin only)
// ============================================

export const reviewReturnRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { action, restockFee = 0, adminNote = '' } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return next(new HandleError('Action must be approve or reject', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status !== 'requested') {
    return next(new HandleError('No pending return request found', 400));
  }

  if (action === 'approve') {
    order.returnInfo.status = 'approved';
    order.returnInfo.approvedAt = new Date();
    order.returnInfo.approvedBy = req.user._id;
    order.returnInfo.restockFee = restockFee;
    order.returnInfo.rmaNumber = `RMA-${Date.now()}`;
    if (adminNote) order.returnInfo.adminNote = adminNote;

    order.addReturnTimeline('return_approved', 'Return approved by admin', req.user._id);
    order.addAuditEntry('return_approved', req.user._id, {
      rmaNumber: order.returnInfo.rmaNumber,
    });

    await order.save();
    invalidateReturnCaches();

    return res.status(200).json({
      success: true,
      message: 'Return approved. RMA number generated.',
      returnInfo: order.returnInfo,
    });
  }

  // reject
  order.returnInfo.status = 'rejected';
  order.returnInfo.approvedAt = new Date();
  order.returnInfo.approvedBy = req.user._id;
  if (adminNote) order.returnInfo.adminNote = adminNote;

  order.addReturnTimeline('return_rejected', 'Return rejected by admin', req.user._id, {
    reason: adminNote,
  });
  order.addAuditEntry('return_rejected', req.user._id, { adminNote });

  await order.save();
  invalidateReturnCaches();

  return res.status(200).json({
    success: true,
    message: 'Return request rejected',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// UPDATE RETURN STATUS (Admin)
// FIX: Stock restoration uses bulkWrite instead of N individual
// findById + save calls — single round trip regardless of item count.
// @route PUT /api/v1/admin/orders/:id/return/status
// @access Private (Admin only)
// ============================================

export const updateReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { status, inspectionNotes } = req.body;

  const validStatuses = ['in_transit', 'received', 'inspected', 'completed'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid return status', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 400));
  }

  order.returnInfo.status = status;

  if (status === 'received') {
    order.returnInfo.receivedAt = new Date();
    order.addReturnTimeline('return_received', 'Return package received', req.user._id);
  }

  if (status === 'inspected') {
    order.returnInfo.inspectedAt = new Date();
    order.returnInfo.inspectedBy = req.user._id;
    if (inspectionNotes) order.returnInfo.inspectionNotes = inspectionNotes;
    order.addReturnTimeline('return_inspected', 'Return inspected', req.user._id, {
      inspectionNotes,
    });
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();

    // FIX: Replace N find+save pairs with a single bulkWrite round trip.
    const restorableItems = order.returnInfo.itemsToReturn.filter(
      (item) => item.condition !== 'damaged'
    );

    if (restorableItems.length > 0) {
      const bulkOps = restorableItems.map((item) => ({
        updateOne: {
          filter: { _id: item.product },
          update: [
            {
              // Handles both inventory.stock and legacy stock field
              $set: {
                'inventory.stock': {
                  $cond: [
                    { $gt: [{ $type: '$inventory.stock' }, 'missing'] },
                    { $add: ['$inventory.stock', item.quantity] },
                    '$inventory.stock',
                  ],
                },
                stock: {
                  $cond: [
                    { $gt: [{ $type: '$stock' }, 'missing'] },
                    { $add: ['$stock', item.quantity] },
                    '$stock',
                  ],
                },
              },
            },
          ],
        },
      }));

      await Product.bulkWrite(bulkOps, { ordered: false });
    }

    order.addReturnTimeline('return_completed', 'Return process completed', req.user._id);
  }

  order.addAuditEntry('return_status_updated', req.user._id, { status });
  await order.save();
  invalidateReturnCaches();

  return res.status(200).json({
    success: true,
    message: `Return status updated to ${status}`,
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADD MESSAGE TO RETURN (Admin)
// @route POST /api/v1/admin/returns/:id/messages
// @access Private (Admin only)
// ============================================

export const addReturnMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, attachments = [] } = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  order.addReturnMessage(req.user._id, 'admin', content, attachments);
  await order.save();

  const newMessage = order.returnInfo.messages[order.returnInfo.messages.length - 1];

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data: { orderId: order._id, message: newMessage },
  });
});

// ============================================
// ADD MESSAGE TO RETURN (Customer)
// @route POST /api/v1/orders/:id/return/messages
// @access Private (User who owns the order)
// ============================================

export const addCustomerReturnMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, attachments = [] } = req.body;
  const userId = req.user._id;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  order.addReturnMessage(userId, 'customer', content, attachments);
  await order.save();

  const newMessage = order.returnInfo.messages[order.returnInfo.messages.length - 1];

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data: { orderId: order._id, message: newMessage },
  });
});

// ============================================
// GET RETURN MESSAGES
// FIX: Added pagination ($slice) so large message threads don't fully load.
// FIX: markAsRead only writes to DB when there are actually unread messages.
// @route GET /api/v1/orders/:id/return/messages
// @access Private (User or Admin)
// ============================================

export const getReturnMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // $slice projection avoids loading the full messages array
  const order = await Order.findById(id, {
    user: 1,
    'returnInfo.status': 1,
    'returnInfo.messages': { $slice: [skip, parseInt(limit)] },
  }).populate('returnInfo.messages.sender', 'name email role');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo?.messages) {
    return res.status(200).json({ success: true, count: 0, messages: [] });
  }

  // FIX: Only write if there is something to mark read
  const readerType = isAdmin ? 'customer' : 'admin';
  const hasUnread = order.returnInfo.messages.some(
    (m) => !m.isRead && m.senderType === readerType
  );
  if (hasUnread) {
    order.markReturnMessagesAsRead(readerType);
    await order.save({ validateBeforeSave: false });
  }

  return res.status(200).json({
    success: true,
    count: order.returnInfo.messages.length,
    messages: order.returnInfo.messages,
  });
});

// ============================================
// GET RETURN TIMELINE
// @route GET /api/v1/orders/:id/return/timeline
// @access Private (User or Admin)
// ============================================

export const getReturnTimeline = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.timeline.performedBy', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo?.timeline) {
    return res.status(200).json({ success: true, count: 0, timeline: [] });
  }

  return res.status(200).json({
    success: true,
    count: order.returnInfo.timeline.length,
    timeline: order.returnInfo.timeline,
  });
});

// ============================================
// GET RETURN DOCUMENTS
// @route GET /api/v1/orders/:id/return/documents
// @access Private (User or Admin)
// ============================================

export const getReturnDocuments = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.documents.uploadedBy', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo?.documents) {
    return res.status(200).json({ success: true, count: 0, documents: [] });
  }

  return res.status(200).json({
    success: true,
    count: order.returnInfo.documents.length,
    documents: order.returnInfo.documents,
  });
});

// ============================================
// UPLOAD FILES FOR RETURN (Admin)
// FIX: Parallel Cloudinary uploads.
// @route POST /api/v1/admin/returns/:id/upload
// @access Private (Admin only)
// ============================================

export const uploadReturnFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  const folder = `ecommerce/returns/${order._id}/admin`;

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
    order.addReturnDocument('other', result.secure_url, originalname, req.user._id, '');
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
// UPLOAD FILES FOR RETURN (Customer)
// FIX: Parallel Cloudinary uploads.
// @route POST /api/v1/orders/:id/return/upload
// @access Private (User who owns the order)
// ============================================

export const uploadCustomerReturnFiles = handleAsyncError(async (req, res, next) => {
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

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  const folder = `ecommerce/returns/${order._id}/customer`;

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

    order.addReturnDocument(docType, result.secure_url, originalname, userId, '');
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
// GET RETURN STATUS (Customer)
// @route GET /api/v1/orders/:id/return/status
// @access Private (User who owns the order)
// ============================================

export const getReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id).select('returnInfo user');
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  const hasReturn = order.returnInfo && order.returnInfo.status !== 'none';

  return res.status(200).json({
    success: true,
    returnInfo: hasReturn
      ? { ...order.returnInfo.toObject(), hasReturn: true }
      : { status: 'none', hasReturn: false },
  });
});

// ============================================
// GET RETURNS WITH UNREAD MESSAGES (Admin)
// @route GET /api/v1/admin/returns/unread
// @access Private (Admin only)
// ============================================

export const getReturnsWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getReturnsWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count: orders.length,
    returns: orders.map((order) => ({
      _id: order._id,
      user: order.user,
      returnInfo: {
        status: order.returnInfo.status,
        rmaNumber: order.returnInfo.rmaNumber,
        reason: order.returnInfo.reason,
        unreadCount: order.unreadReturnMessages,
      },
      latestMessage: order.latestReturnMessage,
    })),
  });
});

// ============================================
// CANCEL RETURN REQUEST (Customer)
// @route PUT /api/v1/orders/:id/return/cancel
// @access Private (User who owns the order)
// ============================================

export const cancelReturnRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  if (order.returnInfo.status !== 'requested') {
    return next(new HandleError('Cannot cancel return at this stage', 400));
  }

  order.returnInfo.status = 'cancelled';
  order.addReturnTimeline('return_cancelled', 'Return cancelled by customer', userId);
  order.addAuditEntry('return_cancelled', userId);

  await order.save();
  invalidateReturnCaches();

  return res.status(200).json({
    success: true,
    message: 'Return request cancelled successfully',
  });
});