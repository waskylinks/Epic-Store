import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern, getCache, setCache } from '../utils/redis.js';
import { uploadToCloudinary } from '../utils/cloudinaryUpload.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import sanitizeHtml from 'isomorphic-dompurify';

// ============================================
// PRIVATE HELPERS
// ============================================

/**
 * assertOrderOwner
 * Throws a HandleError(403) if the order does not belong to the requesting user.
 * Admins always pass. Centralises the check that was duplicated 6-8 times.
 * FIX A-02
 */
const assertOrderOwner = (order, userId, userRole) => {
  if (userRole === 'admin') return;
  if (order.user.toString() !== userId.toString()) {
    throw new HandleError('Unauthorized', 403);
  }
};

/**
 * handleReturnUpload
 * Shared upload logic for both admin and customer upload endpoints.
 * FIX A-01 — removes 80% duplication between admin/customer handlers
 * FIX S-03 — folder path now includes a cryptographic salt so it is not
 *            guessable from the sequential ObjectId alone
 */
const handleReturnUpload = async (order, files, role, uploaderId) => {
  const salt   = crypto.randomBytes(8).toString('hex');
  const folder = `ecommerce/returns/${order._id}-${salt}/${role}`;

  const results = await Promise.all(
    files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' })
        .then((result) => ({ result, originalname: file.originalname }))
    )
  );

  return results.map(({ result, originalname }) => {
    const docType =
      result.resource_type === 'image' ? 'photo' :
      result.resource_type === 'video' ? 'video' : 'document';

    order.addReturnDocument(docType, result.secure_url, originalname, uploaderId, '');
    return {
      url:      result.secure_url,
      filename: originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    };
  });
};

/**
 * buildMatchStage
 * Builds the MongoDB $match stage from the query string.
 * FIX F-01 — adds multi-status, date range, RMA search, and reason filters
 */
const buildMatchStage = (query) => {
  const match = { 'returnInfo.status': { $nin: ['none'] } };

  if (query.status) {
    const statuses = query.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      match['returnInfo.status'] = { $in: statuses };
    }
  }

  if (query.from || query.to) {
    const dateFilter = {};
    if (query.from) {
      const from = new Date(query.from);
      if (!isNaN(from)) dateFilter.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (!isNaN(to)) dateFilter.$lte = to;
    }
    if (Object.keys(dateFilter).length > 0) {
      match['returnInfo.requestedAt'] = dateFilter;
    }
  }

  if (query.rma) {
    // Escape regex metacharacters to prevent ReDoS
    const escaped = query.rma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match['returnInfo.rmaNumber'] = new RegExp(escaped, 'i');
  }

  if (query.reason) {
    match['returnInfo.reason'] = query.reason;
  }

  return match;
};

/**
 * buildCacheKey
 * Produces a deterministic key that incorporates every active filter so
 * different filter combinations never collide in Redis.
 * FIX F-04
 */
const buildCacheKey = (query) => {
  const parts = [
    query.status  || 'all',
    query.from    || '',
    query.to      || '',
    query.rma     || '',
    query.reason  || '',
    query.sortBy  || 'requestedAt',
    query.order   || 'desc',
  ].join('|');
  return `return_stats:${parts}`;
};

// ============================================
// SHARED CACHE INVALIDATION
// FIX P-05 — scoped so low-impact operations don't flush stat caches
// FIX A-04 — failures are now logged at warn level, not silently swallowed
// ============================================

const CACHE_SCOPES = {
  stats:    ['admin_stats*', 'return_overview*', 'return_stats*'],
  status:   ['admin_stats*', 'return_overview*', 'return_stats*', 'returns_by_product*', 'returns_by_category*'],
  messages: ['return_overview*'],
};

const invalidateReturnCaches = (scope = 'stats') => {
  const patterns = CACHE_SCOPES[scope] ?? CACHE_SCOPES.stats;
  Promise.all(patterns.map((p) => deleteCachePattern(p))).catch((err) => {
    console.warn('[cache] invalidateReturnCaches failed', { scope, err: err?.message });
  });
};

// ============================================
// GET ALL RETURNS (Admin)
// FIX P-01 — totalCount now stored inside stats cache; warm hit skips aggregation
// FIX P-02 — $lookup inside facet replaces post-aggregate populate (no N+1)
// FIX F-01 — multi-status, date range, RMA search, reason filters
// FIX F-02 — dynamic sortBy / order params (whitelist-guarded)
// FIX F-03 — page / limit validated and clamped
// FIX F-04 — cache key hashes all active filters
// @route  GET /api/v1/admin/returns
// @access Private/Admin
// ============================================

export const getAllReturns = handleAsyncError(async (req, res, next) => {
  const { page = 1, limit = 20, sortBy, order } = req.query;

  // FIX F-03
  const parsedPage  = Math.max(1, parseInt(page)  || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip        = (parsedPage - 1) * parsedLimit;

  const matchStage = buildMatchStage(req.query);

  // FIX F-02 — whitelist prevents field injection
  const ALLOWED_SORTS = {
    requestedAt: 'returnInfo.requestedAt',
    totalPrice:  'totalPrice',
    status:      'returnInfo.status',
  };
  const sortField = ALLOWED_SORTS[sortBy] ?? 'returnInfo.requestedAt';
  const sortDir   = order === 'asc' ? 1 : -1;

  // FIX F-04
  const STATS_CACHE_KEY   = buildCacheKey(req.query);
  // Shorter TTL for filtered views — less risk of stale counts
  const STATS_TTL_SECONDS = (req.query.status || req.query.from || req.query.to) ? 30 : 60;

  // ── Warm cache path ──────────────────────────────────────────────────────
  let stats = null;
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) stats = JSON.parse(cached);
  } catch (_) { /* cache miss is fine */ }

  // Shared $lookup pipeline used in both warm and cold paths
  const lookupStages = [
    {
      $lookup: {
        from:        'users',
        localField:  'user',
        foreignField: '_id',
        pipeline:    [{ $project: { name: 1, email: 1 } }],
        as:          'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmpty: true } },
    {
      $lookup: {
        from:        'users',
        localField:  'returnInfo.requestedBy',
        foreignField: '_id',
        pipeline:    [{ $project: { name: 1, email: 1 } }],
        as:          'returnInfo.requestedBy',
      },
    },
    { $unwind: { path: '$returnInfo.requestedBy', preserveNullAndEmpty: true } },
  ];

  const projectStage = {
    $project: {
      user: 1,
      returnInfo: {
        status: 1, rmaNumber: 1, reason: 1, description: 1,
        itemsToReturn: 1, requestedAmount: 1, requestedAt: 1,
        requestedBy: 1, adminNote: 1, restockFee: 1,
      },
      orderStatus: 1,
      totalPrice:  1,
      createdAt:   1,
      unreadMessages: {
        $size: {
          $filter: {
            input: { $ifNull: ['$returnInfo.messages', []] },
            as:    'm',
            cond: {
              $and: [
                { $eq: ['$$m.isRead',     false] },
                { $eq: ['$$m.senderType', 'customer'] },
              ],
            },
          },
        },
      },
    },
  };

  // FIX P-01 — warm cache hit: skip aggregation, just fetch the page
  if (stats) {
    const orders = await Order.aggregate([
      { $match: matchStage },
      { $sort: { [sortField]: sortDir } },
      { $skip: skip },
      { $limit: parsedLimit },
      ...lookupStages,
      projectStage,
    ]);

    return res.status(200).json({
      success:      true,
      count:        orders.length,
      totalReturns: stats.total,
      currentPage:  parsedPage,
      totalPages:   Math.ceil(stats.total / parsedLimit),
      stats,
      returns: orders.map((o) => ({
        orderId: o._id, user: o.user, returnInfo: o.returnInfo,
        orderStatus: o.orderStatus, totalPrice: o.totalPrice,
        unreadMessages: o.unreadMessages, createdAt: o.createdAt,
      })),
    });
  }

  // ── Cold cache: single $facet ────────────────────────────────────────────
  // FIX P-02 — $lookup inside data facet replaces N+1 post-aggregate populate
  const [facetResult] = await Order.aggregate([
    { $match: matchStage },
    {
      $facet: {
        data: [
          { $sort: { [sortField]: sortDir } },
          { $skip: skip },
          { $limit: parsedLimit },
          ...lookupStages,
          projectStage,
        ],
        totalCount: [{ $count: 'count' }],
        statCounts: [{ $group: { _id: '$returnInfo.status', count: { $sum: 1 } } }],
      },
    },
  ]);

  const orders       = facetResult.data            || [];
  const totalReturns = facetResult.totalCount?.[0]?.count || 0;
  const countMap     = Object.fromEntries((facetResult.statCounts || []).map((s) => [s._id, s.count]));

  // FIX P-01 — total is now inside the cached payload
  stats = {
    total:      totalReturns,
    requested:  countMap.requested  || 0,
    approved:   countMap.approved   || 0,
    in_transit: countMap.in_transit || 0,
    received:   countMap.received   || 0,
    inspected:  countMap.inspected  || 0,
    completed:  countMap.completed  || 0,
    rejected:   countMap.rejected   || 0,
    cancelled:  countMap.cancelled  || 0,
  };

  setCache(STATS_CACHE_KEY, JSON.stringify(stats), STATS_TTL_SECONDS).catch((err) => {
    console.warn('[cache] setCache failed for return stats', { err: err?.message });
  });

  return res.status(200).json({
    success:      true,
    count:        orders.length,
    totalReturns,
    currentPage:  parsedPage,
    totalPages:   Math.ceil(totalReturns / parsedLimit),
    stats,
    returns: orders.map((o) => ({
      orderId: o._id, user: o.user, returnInfo: o.returnInfo,
      orderStatus: o.orderStatus, totalPrice: o.totalPrice,
      unreadMessages: o.unreadMessages, createdAt: o.createdAt,
    })),
  });
});

// ============================================
// GET SINGLE RETURN (Admin)
// FIX P-04 — removed full message-thread populate (7 → 5 chains)
//            Last 5 messages returned as a preview only
// @route  GET /api/v1/admin/returns/:id
// @access Private/Admin
// ============================================

export const getSingleReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user',                           'name email phone')
    .populate('returnInfo.requestedBy',         'name email')
    .populate('returnInfo.approvedBy',          'name email')
    .populate('returnInfo.inspectedBy',         'name email')
    .populate('returnInfo.documents.uploadedBy','name email')
    .populate('orderItems.product',             'name images price');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found for this order', 404));
  }

  const hasUnread = order.returnInfo.messages?.some(
    (m) => !m.isRead && m.senderType === 'customer'
  );
  if (hasUnread) {
    order.markReturnMessagesAsRead('admin');
    await order.save({ validateBeforeSave: false });
  }

  // FIX P-04 — preview only; full thread via GET /return/messages
  const messagePreview = (order.returnInfo.messages ?? []).slice(-5);
  const returnInfoObj  = order.returnInfo.toObject();
  returnInfoObj.messages = messagePreview;

  return res.status(200).json({
    success: true,
    order: {
      _id:          order._id,
      user:         order.user,
      orderItems:   order.orderItems,
      shippingInfo: order.shippingInfo,
      returnInfo:   returnInfoObj,
      orderStatus:  order.orderStatus,
      totalPrice:   order.totalPrice,
      createdAt:    order.createdAt,
      deliveredAt:  order.deliveredAt,
    },
  });
});

// ============================================
// CUSTOMER REQUESTS RETURN
// FIX S-01 — uses req.order from checkReturnEligibility (no duplicate findById)
// FIX L-02 — requestedAmount calculated from order item prices
// FIX L-03 — return window check duplicated here as service-layer safety net
// FIX A-02 — assertOrderOwner helper
// @route  POST /api/v1/orders/:id/return/request
// @access Private/Customer
// ============================================

export const requestReturn = handleAsyncError(async (req, res, next) => {
  const { reason, description, items, attachments = [] } = req.body;
  const userId = req.user._id;

  // FIX S-01 — req.order set by checkReturnEligibility
  const order = req.order;

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  // FIX L-03 — service-layer guard (in case middleware is ever bypassed)
  if (order.orderStatus !== 'Delivered') {
    return next(new HandleError('Can only return delivered orders', 400));
  }
  if (order.returnInfo && order.returnInfo.status !== 'none') {
    return next(new HandleError('Return request already exists for this order', 400));
  }
  if (order.deliveredAt) {
    const RETURN_WINDOW_DAYS = 30;
    const deadline = new Date(order.deliveredAt);
    deadline.setDate(deadline.getDate() + RETURN_WINDOW_DAYS);
    if (Date.now() > deadline.getTime()) {
      const days = Math.floor((Date.now() - new Date(order.deliveredAt).getTime()) / 86_400_000);
      return next(new HandleError(
        `Return period has expired (${RETURN_WINDOW_DAYS} days). Order was delivered ${days} days ago.`, 400
      ));
    }
  }

  // FIX L-02 — calculate requestedAmount so admins have financial context
  const orderItemMap = new Map(
    order.orderItems.map((i) => [i.product.toString(), i.price])
  );
  const requestedAmount = items.reduce((sum, item) => {
    const price = orderItemMap.get(item.product?.toString()) ?? 0;
    return sum + price * (item.quantity || 0);
  }, 0);

  order.returnInfo = {
    status:          'requested',
    reason,
    description,
    itemsToReturn:   items,
    requestedAmount,
    requestedAt:     new Date(),
    requestedBy:     userId,
    attachments,
    messages:        [],
    timeline:        [],
    documents:       [],
  };

  order.addReturnTimeline('return_requested', `Return requested: ${reason}`, userId);
  order.addStatusHistory('Return Requested', userId, reason);
  order.addAuditEntry('return_requested', userId, { reason, description, itemsCount: items.length, requestedAmount });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    'Return request submitted successfully',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADMIN APPROVES / REJECTS RETURN
// FIX S-01 — uses req.order from canReviewReturn
// FIX S-05 — adminNote sanitized before persistence
// FIX M-01 — RMA generation removed; delegated entirely to pre-save hook
// @route  PUT /api/v1/admin/orders/:id/return/review
// @access Private/Admin
// ============================================

export const reviewReturnRequest = handleAsyncError(async (req, res, next) => {
  const { action, restockFee = 0, adminNote = '' } = req.body;

  // FIX S-01
  const order = req.order;

  // FIX S-05 — sanitize before any persistence
  const sanitizedNote = adminNote
    ? sanitizeHtml.sanitize(String(adminNote))
    : '';

  if (action === 'approve') {
    order.returnInfo.status     = 'approved';
    order.returnInfo.approvedAt = new Date();
    order.returnInfo.approvedBy = req.user._id;
    order.returnInfo.restockFee = Number(restockFee) || 0;
    // FIX M-01 — rmaNumber deliberately NOT set here.
    // The pre-save hook in order-model.js is the single canonical source,
    // triggered automatically when status becomes 'approved' and rmaNumber
    // is absent. Two generators producing different formats has been removed.
    if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

    order.addReturnTimeline('return_approved', 'Return approved by admin', req.user._id);
    order.addAuditEntry('return_approved', req.user._id, {});

    await order.save();
    invalidateReturnCaches('stats');

    return res.status(200).json({
      success:    true,
      message:    'Return approved. RMA number generated.',
      returnInfo: order.returnInfo,
    });
  }

  // reject
  order.returnInfo.status     = 'rejected';
  order.returnInfo.approvedAt = new Date();
  order.returnInfo.approvedBy = req.user._id;
  if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

  order.addReturnTimeline('return_rejected', 'Return rejected by admin', req.user._id, { reason: sanitizedNote });
  order.addAuditEntry('return_rejected', req.user._id, { adminNote: sanitizedNote });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    'Return request rejected',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// UPDATE RETURN STATUS (Admin)
// FIX L-01 — stock restoration uses $ifNull instead of the broken
//            $type/$gt/'missing' string comparison that silently skipped
//            the increment for all numeric inventory fields
// FIX S-05 — inspectionNotes sanitized before persistence
// @route  PUT /api/v1/admin/orders/:id/return/status
// @access Private/Admin
// ============================================

export const updateReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id }                      = req.params;
  const { status, inspectionNotes } = req.body;

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
    // FIX S-05
    if (inspectionNotes) {
      order.returnInfo.inspectionNotes = sanitizeHtml.sanitize(String(inspectionNotes));
    }
    order.addReturnTimeline('return_inspected', 'Return inspected', req.user._id, {
      inspectionNotes: order.returnInfo.inspectionNotes,
    });
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();

    const restorableItems = order.returnInfo.itemsToReturn.filter(
      (item) => item.condition !== 'damaged'
    );

    if (restorableItems.length > 0) {
      // FIX L-01 — the original code used:
      //   { $gt: [{ $type: '$inventory.stock' }, 'missing'] }
      // $type returns a BSON type string (e.g. "double", "int").
      // "double" > "missing" is FALSE lexicographically (d < m), so the
      // $add branch was NEVER taken — stock was silently never restored.
      // $ifNull correctly handles both present and absent fields.
      const bulkOps = restorableItems.map((item) => ({
        updateOne: {
          filter: { _id: item.product },
          update: [
            {
              $set: {
                'inventory.stock': { $add: [{ $ifNull: ['$inventory.stock', 0] }, item.quantity] },
                stock:             { $add: [{ $ifNull: ['$stock',             0] }, item.quantity] },
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
  invalidateReturnCaches('status');

  return res.status(200).json({
    success:    true,
    message:    `Return status updated to ${status}`,
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADD MESSAGE — Admin
// Uses req.order from canAddReturnMessage middleware
// @route  POST /api/v1/admin/returns/:id/messages
// @access Private/Admin
// ============================================

export const addReturnMessage = handleAsyncError(async (req, res, next) => {
  const order                       = req.order;
  const { content, attachments = [] } = req.body;

  order.addReturnMessage(req.user._id, 'admin', content, attachments);
  await order.save();

  const newMessage = order.returnInfo.messages[order.returnInfo.messages.length - 1];
  invalidateReturnCaches('messages');

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data:    { orderId: order._id, message: newMessage },
  });
});

// ============================================
// ADD MESSAGE — Customer
// Uses req.order from canAddReturnMessage middleware
// @route  POST /api/v1/orders/:id/return/messages
// @access Private/Customer
// ============================================

export const addCustomerReturnMessage = handleAsyncError(async (req, res, next) => {
  const order                       = req.order;
  const userId                      = req.user._id;
  const { content, attachments = [] } = req.body;

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  order.addReturnMessage(userId, 'customer', content, attachments);
  await order.save();

  const newMessage = order.returnInfo.messages[order.returnInfo.messages.length - 1];
  invalidateReturnCaches('messages');

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data:    { orderId: order._id, message: newMessage },
  });
});

// ============================================
// GET RETURN MESSAGES (paginated)
// FIX L-04 — response now includes totalCount so clients can paginate
// FIX L-06 — readerType renamed to unreadSenderType (accurate semantics)
// FIX F-03 — page/limit validated and clamped
// NOTE: Uses aggregation to get page slice + total in one round trip,
//       then refetches the Mongoose document only if markAsRead is needed.
// @route  GET /api/v1/orders/:id/return/messages
// @access Private/User or Admin
// ============================================

export const getReturnMessages = handleAsyncError(async (req, res, next) => {
  const { id }           = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  // FIX F-03
  const parsedPage  = Math.max(1, parseInt(page)  || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const skip        = (parsedPage - 1) * parsedLimit;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new HandleError('Invalid order ID', 400));
  }

  // Single aggregation — page slice + total count in one round trip
  const [result] = await Order.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    {
      $project: {
        user:             1,
        'returnInfo.status': 1,
        totalMessages:    { $size: { $ifNull: ['$returnInfo.messages', []] } },
        messages: {
          $slice: [{ $ifNull: ['$returnInfo.messages', []] }, skip, parsedLimit],
        },
      },
    },
  ]);

  if (!result) return next(new HandleError('Order not found', 404));

  if (!isAdmin && result.user?.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!result.messages?.length) {
    return res.status(200).json({
      success: true, count: 0, totalCount: result.totalMessages || 0,
      currentPage: parsedPage, totalPages: Math.ceil((result.totalMessages || 0) / parsedLimit),
      messages: [],
    });
  }

  // Populate senders on the in-memory slice
  await Order.populate(result.messages, { path: 'sender', model: 'User', select: 'name email role' });

  // FIX L-06 — this holds the SENDER type whose messages should be marked read,
  // not the reader's type. markReturnMessagesAsRead marks where senderType !== arg.
  // Admin reading → mark 'customer' messages as read, and vice-versa.
  const unreadSenderType = isAdmin ? 'customer' : 'admin';
  const hasUnread = result.messages.some(
    (m) => !m.isRead && m.senderType === unreadSenderType
  );

  if (hasUnread) {
    // Re-fetch the Mongoose document only when a write is actually needed
    const orderDoc = await Order.findById(id).select('returnInfo.messages user');
    if (orderDoc) {
      orderDoc.markReturnMessagesAsRead(unreadSenderType);
      await orderDoc.save({ validateBeforeSave: false });
    }
  }

  return res.status(200).json({
    success:     true,
    count:       result.messages.length,
    totalCount:  result.totalMessages,
    currentPage: parsedPage,
    totalPages:  Math.ceil(result.totalMessages / parsedLimit),
    messages:    result.messages,
  });
});

// ============================================
// GET RETURN TIMELINE
// @route  GET /api/v1/orders/:id/return/timeline
// @access Private/User or Admin
// ============================================

export const getReturnTimeline = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.timeline.performedBy', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));

  try { assertOrderOwner(order, userId, isAdmin ? 'admin' : 'customer'); }
  catch (e) { return next(e); }

  return res.status(200).json({
    success:  true,
    count:    order.returnInfo?.timeline?.length || 0,
    timeline: order.returnInfo?.timeline        || [],
  });
});

// ============================================
// GET RETURN DOCUMENTS
// @route  GET /api/v1/orders/:id/return/documents
// @access Private/User or Admin
// ============================================

export const getReturnDocuments = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.documents.uploadedBy', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));

  try { assertOrderOwner(order, userId, isAdmin ? 'admin' : 'customer'); }
  catch (e) { return next(e); }

  return res.status(200).json({
    success:   true,
    count:     order.returnInfo?.documents?.length || 0,
    documents: order.returnInfo?.documents         || [],
  });
});

// ============================================
// UPLOAD FILES — Admin
// FIX A-01 — shared handleReturnUpload helper
// FIX S-03 — cryptographic salt in path (via helper)
// @route  POST /api/v1/admin/returns/:id/upload
// @access Private/Admin
// ============================================

export const uploadReturnFiles = handleAsyncError(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new HandleError('Order not found', 404));
  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  const uploadedFiles = await handleReturnUpload(order, req.files, 'admin', req.user._id);
  await order.save();

  return res.status(200).json({ success: true, message: 'Files uploaded successfully', files: uploadedFiles });
});

// ============================================
// UPLOAD FILES — Customer
// FIX A-01 — shared handleReturnUpload helper
// FIX A-02 — assertOrderOwner helper
// @route  POST /api/v1/orders/:id/return/upload
// @access Private/Customer
// ============================================

export const uploadCustomerReturnFiles = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const order  = await Order.findById(req.params.id);
  if (!order) return next(new HandleError('Order not found', 404));

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  const uploadedFiles = await handleReturnUpload(order, req.files, 'customer', userId);
  await order.save();

  return res.status(200).json({ success: true, message: 'Files uploaded successfully', files: uploadedFiles });
});

// ============================================
// GET RETURN STATUS — Customer
// FIX A-02 — assertOrderOwner helper
// @route  GET /api/v1/orders/:id/return/status
// @access Private/Customer
// ============================================

export const getReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id).select('returnInfo user');
  if (!order) return next(new HandleError('Order not found', 404));

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  const hasReturn = order.returnInfo && order.returnInfo.status !== 'none';

  return res.status(200).json({
    success:    true,
    returnInfo: hasReturn
      ? { ...order.returnInfo.toObject(), hasReturn: true }
      : { status: 'none', hasReturn: false },
  });
});

// ============================================
// GET RETURNS WITH UNREAD MESSAGES (Admin)
// FIX P-03 — model static method rewritten with $filter + $slice
//            (see order-model.js); controller unchanged, benefits automatically
// @route  GET /api/v1/admin/returns/unread
// @access Private/Admin
// ============================================

export const getReturnsWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getReturnsWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count:   orders.length,
    returns: orders.map((order) => ({
      _id:  order._id,
      user: order.user,
      returnInfo: {
        status:      order.returnInfo.status,
        rmaNumber:   order.returnInfo.rmaNumber,
        reason:      order.returnInfo.reason,
        unreadCount: order.unreadReturnMessages,
      },
      latestMessage: order.latestReturnMessage,
    })),
  });
});

// ============================================
// CANCEL RETURN — Customer
// FIX S-01 / L-05 — uses req.order from canCancelReturn; duplicate
//                   eligibility checks removed
// @route  PUT /api/v1/orders/:id/return/cancel
// @access Private/Customer
// ============================================

export const cancelReturnRequest = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  // FIX S-01/L-05 — req.order already validated by canCancelReturn middleware
  const order  = req.order;

  order.returnInfo.status = 'cancelled';
  order.addReturnTimeline('return_cancelled', 'Return cancelled by customer', userId);
  order.addAuditEntry('return_cancelled', userId);

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({ success: true, message: 'Return request cancelled successfully' });
});