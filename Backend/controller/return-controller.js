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

const assertOrderOwner = (order, userId, userRole) => {
  if (userRole === 'admin') return;
  if (order.user.toString() !== userId.toString()) {
    throw new HandleError('Unauthorized', 403);
  }
};

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

const handlePleaUpload = async (order, files, uploaderId) => {
  const salt   = crypto.randomBytes(8).toString('hex');
  const folder = `ecommerce/returns/${order._id}-${salt}/plea`;
  const results = await Promise.all(
    files.map((file) =>
      uploadToCloudinary(file.buffer, { folder, resource_type: 'auto' })
        .then((result) => ({ result, originalname: file.originalname }))
    )
  );
  return results.map(({ result, originalname }) => {
    const docType =
      result.resource_type === 'image' ? 'photo' :
      result.resource_type === 'video' ? 'video' : 'other';
    order.addPleaDocument(docType, result.secure_url, originalname, uploaderId, '');
    return {
      url:      result.secure_url,
      filename: originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    };
  });
};

const buildMatchStage = (query) => {
  const match = { 'returnInfo.status': { $nin: ['none'] } };
  if (query.status) {
    const statuses = query.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) match['returnInfo.status'] = { $in: statuses };
  }
  if (query.from || query.to) {
    const dateFilter = {};
    if (query.from) { const from = new Date(query.from); if (!isNaN(from)) dateFilter.$gte = from; }
    if (query.to)   { const to   = new Date(query.to);   if (!isNaN(to))   dateFilter.$lte = to;   }
    if (Object.keys(dateFilter).length > 0) match['returnInfo.requestedAt'] = dateFilter;
  }
  if (query.rma) {
    const escaped = query.rma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match['returnInfo.rmaNumber'] = new RegExp(escaped, 'i');
  }
  if (query.reason) match['returnInfo.reason'] = query.reason;
  return match;
};

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
// checkAndExpireTimers
// Both timer expiry cases advance to 'approved'.
// Full lifecycle: items_reviewed → approved → in_transit (customer) →
// received → inspected → awaiting_discount → completed
// Timers only run at items_reviewed and plea_submitted.
// Once approved, no timer — customer ships at their own pace.
// ============================================
const checkAndExpireTimers = (order) => {
  if (!order.returnInfo) return false;
  const { status, pleaDeadline } = order.returnInfo;
  const now = new Date();
  let mutated = false;

  if (pleaDeadline && now > new Date(pleaDeadline)) {
    if (status === 'items_reviewed') {
      order.returnInfo.status       = 'approved';
      order.returnInfo.approvedAt   = now;
      order.returnInfo.pleaDeadline = null;
      order.addReturnTimeline(
        'plea_window_expired',
        'Plea window expired without submission. Return automatically approved.',
        null
      );
      mutated = true;
    } else if (status === 'plea_submitted') {
      order.returnInfo.status       = 'approved';
      order.returnInfo.approvedAt   = now;
      order.returnInfo.pleaDeadline = null;
      order.addReturnTimeline(
        'admin_plea_response_expired',
        'Admin did not respond to plea within 48 hours. Return automatically approved.',
        null
      );
      mutated = true;
    }
  }
  return mutated;
};

// ============================================
// GET ALL RETURNS (Admin)
// @route  GET /api/v1/admin/returns
// @access Private/Admin
// ============================================
export const getAllReturns = handleAsyncError(async (req, res, next) => {
  const { page = 1, limit = 20, sortBy, order } = req.query;
  const parsedPage  = Math.max(1, parseInt(page)  || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip        = (parsedPage - 1) * parsedLimit;
  const matchStage  = buildMatchStage(req.query);

  const ALLOWED_SORTS = {
    requestedAt: 'returnInfo.requestedAt',
    totalPrice:  'totalPrice',
    status:      'returnInfo.status',
  };
  const sortField = ALLOWED_SORTS[sortBy] ?? 'returnInfo.requestedAt';
  const sortDir   = order === 'asc' ? 1 : -1;

  const STATS_CACHE_KEY   = buildCacheKey(req.query);
  const STATS_TTL_SECONDS = (req.query.status || req.query.from || req.query.to) ? 30 : 60;

  let stats = null;
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) stats = JSON.parse(cached);
  } catch (_) { /* cache miss */ }

  const lookupStages = [
    {
      $lookup: {
        from:         'users',
        localField:   'user',
        foreignField: '_id',
        pipeline:     [{ $project: { name: 1, email: 1, firstName: 1, lastName: 1, phoneNo: 1 } }],
        as:           'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from:         'users',
        localField:   'returnInfo.requestedBy',
        foreignField: '_id',
        pipeline:     [{ $project: { name: 1, email: 1 } }],
        as:           'returnInfo.requestedBy',
      },
    },
    { $unwind: { path: '$returnInfo.requestedBy', preserveNullAndEmptyArrays: true } },
  ];

  const projectStage = {
    $project: {
      user: 1,
      returnInfo: {
        status: 1, rmaNumber: 1, reason: 1, description: 1,
        itemsToReturn: 1, requestedAmount: 1, requestedAt: 1,
        requestedBy: 1, adminNote: 1, restockFee: 1,
        pleaDeadline: 1, pleaAttempts: 1, discountValue: 1,
        // Include courier and tracking so admin table can display them
        courierName: 1, trackingNumber: 1,
      },
      orderStatus: 1,
      totalPrice:  1,
      createdAt:   1,
      shippingInfo: 1,
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
        shippingInfo: o.shippingInfo,
        unreadMessages: o.unreadMessages, createdAt: o.createdAt,
      })),
    });
  }

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
        totalCount:           [{ $count: 'count' }],
        statCounts:           [{ $group: { _id: '$returnInfo.status', count: { $sum: 1 } } }],
        totalRequestedAmount: [
          { $group: { _id: null, total: { $sum: { $ifNull: ['$returnInfo.requestedAmount', 0] } } } },
        ],
      },
    },
  ]);

  const orders       = facetResult.data            || [];
  const totalReturns = facetResult.totalCount?.[0]?.count || 0;
  const countMap     = Object.fromEntries((facetResult.statCounts || []).map((s) => [s._id, s.count]));
  const totalRequestedAmount = facetResult.totalRequestedAmount?.[0]?.total || 0;

  stats = {
    total:              totalReturns,
    requested:          countMap.requested          || 0,
    items_reviewed:     countMap.items_reviewed     || 0,
    plea_submitted:     countMap.plea_submitted     || 0,
    approved:           countMap.approved           || 0,
    in_transit:         countMap.in_transit         || 0,
    received:           countMap.received           || 0,
    inspected:          countMap.inspected          || 0,
    awaiting_discount:  countMap.awaiting_discount  || 0,
    completed:          countMap.completed          || 0,
    rejected:           countMap.rejected           || 0,
    cancelled:          countMap.cancelled          || 0,
    totalRequestedAmount,
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
      shippingInfo: o.shippingInfo,
      unreadMessages: o.unreadMessages, createdAt: o.createdAt,
    })),
  });
});

// ============================================
// GET SINGLE RETURN (Admin)
// @route  GET /api/v1/admin/returns/:id
// @access Private/Admin
// ============================================
export const getSingleReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user',                                'name email phoneNo firstName lastName')
    .populate('returnInfo.requestedBy',              'name email')
    .populate('returnInfo.approvedBy',               'name email')
    .populate('returnInfo.inspectedBy',              'name email')
    .populate('returnInfo.documents.uploadedBy',     'name email')
    .populate('returnInfo.pleaInfo.pleaDocuments.uploadedBy', 'name email')
    .populate('orderItems.product',                  'name images price')
    .populate('returnInfo.itemsToReturn.product',    'name images price');

  if (!order) return next(new HandleError('Order not found', 404));
  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found for this order', 404));
  }

  const timerMutated = checkAndExpireTimers(order);

  const hasUnread = order.returnInfo.messages?.some(
    (m) => !m.isRead && m.senderType === 'customer'
  );

  if (hasUnread || timerMutated) {
    if (hasUnread) {
      order.markReturnMessagesAsRead('admin');
      invalidateReturnCaches('messages');
    }
    await order.save({ validateBeforeSave: false });
    if (timerMutated) invalidateReturnCaches('status');
  }

  const messagePreview = (order.returnInfo.messages ?? []).slice(-5);
  const returnInfoObj  = order.returnInfo.toObject();
  returnInfoObj.messages = messagePreview;

  return res.status(200).json({
    success:        true,
    unreadMessages: 0,
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
// @route  POST /api/v1/orders/:id/return/request
// @access Private/Customer
// ============================================
export const requestReturn = handleAsyncError(async (req, res, next) => {
  const { reason, description, items, attachments = [], policyAcknowledged } = req.body;
  const userId = req.user._id;
  const order  = req.order;

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

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

  const orderItemMap = new Map(
    order.orderItems.map((i) => {
      const id = i.product?._id ?? i.product;
      return [id.toString(), i.price ?? 0];
    })
  );

  const requestedAmount = items.reduce((sum, item) => {
    const price = orderItemMap.get(item.product?.toString()) ?? 0;
    return sum + price * (item.quantity || 0);
  }, 0);

  const itemsWithPrice = items.map((item) => ({
    ...item,
    price: orderItemMap.get(item.product?.toString()) ?? 0,
  }));

  order.returnInfo = {
    status:               'requested',
    reason,
    description,
    itemsToReturn:        itemsWithPrice,
    requestedAmount,
    requestedAt:          new Date(),
    requestedBy:          userId,
    attachments,
    messages:             [],
    timeline:             [],
    documents:            [],
    policyAcknowledgedAt: policyAcknowledged ? new Date() : null,
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
// ADMIN REVIEWS RETURN — per-item decisions (first round)
// Status: requested → items_reviewed
// Sets 48h plea window for customer to accept or dispute.
// @route  PUT /api/v1/admin/orders/:id/return/review
// @access Private/Admin
// ============================================
export const reviewReturnRequest = handleAsyncError(async (req, res, next) => {
  const { itemDecisions, adminNote = '' } = req.body;
  const order = req.order;

  const sanitizedNote = adminNote ? sanitizeHtml.sanitize(String(adminNote)) : '';

  itemDecisions.forEach((decision) => {
    const item = order.returnInfo.itemsToReturn.find((i) => {
      const itemProductId = i.product?._id?.toString() ?? i.product?.toString();
      return itemProductId === decision.productId.toString();
    });
    if (item) {
      item.adminDecision        = decision.decision;
      item.adminRejectionReason = decision.decision === 'rejected'
        ? sanitizeHtml.sanitize(String(decision.rejectionReason ?? ''))
        : '';
    }
  });

  const orderItemPriceMap = new Map(
    order.orderItems.map((i) => {
      const pid = i.product?._id?.toString() ?? i.product?.toString();
      return [pid, i.price ?? 0];
    })
  );

  const missingProductIds = [];
  const discountValue = order.returnInfo.itemsToReturn
    .filter((i) => i.adminDecision === 'approved')
    .reduce((sum, i) => {
      const pid       = i.product?._id?.toString() ?? i.product?.toString();
      const unitPrice = (i.price != null && i.price > 0)
        ? i.price
        : (orderItemPriceMap.get(pid) ?? null);
      if (unitPrice === null) { missingProductIds.push(pid); return sum; }
      return sum + unitPrice * (i.quantity ?? 1);
    }, 0);

  if (missingProductIds.length > 0) {
    return next(new HandleError(
      `Cannot calculate discount: approved items with no price data (product IDs: ${missingProductIds.join(', ')}).`,
      400
    ));
  }

  order.returnInfo.discountValue = discountValue;
  order.returnInfo.status        = 'items_reviewed';
  order.returnInfo.approvedAt    = new Date();
  order.returnInfo.approvedBy    = req.user._id;

  const pleaDeadline = new Date();
  pleaDeadline.setHours(pleaDeadline.getHours() + 48);
  order.returnInfo.pleaDeadline = pleaDeadline;

  if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

  const approvedCount = itemDecisions.filter((d) => d.decision === 'approved').length;
  const rejectedCount = itemDecisions.filter((d) => d.decision === 'rejected').length;

  order.addReturnTimeline(
    'items_reviewed',
    `Admin reviewed items: ${approvedCount} approved, ${rejectedCount} rejected`,
    req.user._id,
    { approvedCount, rejectedCount, discountValue }
  );
  order.addAuditEntry('items_reviewed', req.user._id, { approvedCount, rejectedCount, discountValue });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    `Items reviewed. ${approvedCount} approved, ${rejectedCount} rejected. Customer has 48 hours to respond.`,
    returnInfo: order.returnInfo,
  });
});

// ============================================
// CUSTOMER ACCEPTS DECISIONS (without disputing)
// Status: items_reviewed → approved
// Customer accepts admin decisions and return proceeds to shipping.
// @route  POST /api/v1/orders/:id/return/accept-decisions
// @access Private/Customer
// ============================================
export const acceptDecisions = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const order  = req.order;

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  order.returnInfo.status       = 'approved';
  order.returnInfo.approvedAt   = order.returnInfo.approvedAt ?? new Date();
  order.returnInfo.pleaDeadline = null;
  order.returnInfo.acceptedAt   = new Date();

  order.addReturnTimeline(
    'decisions_accepted',
    'Customer accepted admin item decisions. Return approved — awaiting customer shipment.',
    userId
  );
  order.addAuditEntry('decisions_accepted', userId, {
    approvedItems: order.returnInfo.itemsToReturn.filter((i) => i.adminDecision === 'approved').length,
  });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    'Decisions accepted. Please ship your approved items back to us.',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// CUSTOMER SUBMITS PLEA
// Status: items_reviewed → plea_submitted
// @route  POST /api/v1/orders/:id/return/plea
// @access Private/Customer
// ============================================
export const submitPlea = handleAsyncError(async (req, res, next) => {
  const { pleaDescription } = req.body;
  const userId  = req.user._id;
  const order   = req.order;

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  const hasRejectedItem = order.returnInfo.itemsToReturn.some(
    (i) => i.adminDecision === 'rejected'
  );
  if (!hasRejectedItem) {
    return next(new HandleError(
      'All items in this return have been approved. There are no rejected items to submit a plea for.',
      400
    ));
  }

  order.returnInfo.pleaInfo = {
    pleaDescription:  sanitizeHtml.sanitize(String(pleaDescription)),
    pleaSubmittedAt:  new Date(),
    pleaDocuments:    order.returnInfo.pleaInfo?.pleaDocuments ?? [],
  };

  order.returnInfo.status       = 'plea_submitted';
  order.returnInfo.pleaAttempts = (order.returnInfo.pleaAttempts ?? 0) + 1;

  const adminResponseDeadline = new Date();
  adminResponseDeadline.setHours(adminResponseDeadline.getHours() + 48);
  order.returnInfo.pleaDeadline = adminResponseDeadline;

  order.addReturnTimeline('plea_submitted', 'Customer submitted a plea for reconsideration', userId);
  order.addAuditEntry('plea_submitted', userId, { pleaAttempts: order.returnInfo.pleaAttempts });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    'Plea submitted successfully. The admin will review your plea within 48 hours.',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADMIN RESOLVES PLEA — second-round per-item decisions
// Status: plea_submitted → approved
// @route  PUT /api/v1/admin/orders/:id/return/plea-review
// @access Private/Admin
// ============================================
export const resolveAfterPlea = handleAsyncError(async (req, res, next) => {
  const { itemDecisions, adminNote = '' } = req.body;
  const order = req.order;

  if ((order.returnInfo.pleaAttempts ?? 0) === 0) {
    return next(new HandleError(
      'Cannot resolve plea: no plea has been submitted by the customer for this return.',
      400
    ));
  }

  const sanitizedNote = adminNote ? sanitizeHtml.sanitize(String(adminNote)) : '';

  itemDecisions.forEach((decision) => {
    const item = order.returnInfo.itemsToReturn.find((i) => {
      const itemProductId = i.product?._id?.toString() ?? i.product?.toString();
      return itemProductId === decision.productId.toString();
    });
    if (item) {
      item.adminDecision        = decision.decision;
      item.adminRejectionReason = decision.decision === 'rejected'
        ? sanitizeHtml.sanitize(String(decision.rejectionReason ?? ''))
        : '';
    }
  });

  const orderItemPriceMap = new Map(
    order.orderItems.map((i) => {
      const pid = i.product?._id?.toString() ?? i.product?.toString();
      return [pid, i.price ?? 0];
    })
  );

  const discountValue = order.returnInfo.itemsToReturn
    .filter((i) => i.adminDecision === 'approved')
    .reduce((sum, i) => {
      const pid       = i.product?._id?.toString() ?? i.product?.toString();
      const unitPrice = (i.price != null && i.price > 0)
        ? i.price
        : (orderItemPriceMap.get(pid) ?? 0);
      return sum + unitPrice * (i.quantity ?? 1);
    }, 0);

  order.returnInfo.discountValue = discountValue;
  order.returnInfo.status        = 'approved';
  order.returnInfo.approvedAt    = new Date();
  order.returnInfo.pleaDeadline  = null;

  if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

  const approvedCount = itemDecisions.filter((d) => d.decision === 'approved').length;
  const rejectedCount = itemDecisions.filter((d) => d.decision === 'rejected').length;

  order.addReturnTimeline(
    'plea_resolved',
    `Plea reviewed. Final decisions: ${approvedCount} approved, ${rejectedCount} rejected. Awaiting customer shipment.`,
    req.user._id,
    { approvedCount, rejectedCount, discountValue, isFinalRound: true }
  );
  order.addAuditEntry('plea_resolved', req.user._id, { approvedCount, rejectedCount, discountValue });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    `Plea resolved. ${approvedCount} items approved, ${rejectedCount} rejected. Customer will now ship items back.`,
    returnInfo: order.returnInfo,
  });
});

// ============================================
// CUSTOMER CONFIRMS SHIPMENT
// Status: approved → in_transit
//
// This is the correct real-world flow. The customer physically packs
// items, drops them at a courier, and confirms here with optional
// courier name and tracking number. Admin should NOT set in_transit —
// they have no involvement at this stage.
//
// The timer is completely done by the time approved is reached
// (pleaDeadline is null). Customer can take as long as needed to ship.
//
// @route  POST /api/v1/orders/:id/return/confirm-shipped
// @access Private/Customer
// ============================================
export const confirmShipped = handleAsyncError(async (req, res, next) => {
  const { courierName, trackingNumber } = req.body;
  const userId = req.user._id;
  const order  = req.order; // set by canConfirmShipped middleware

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  const sanitizedCourier  = courierName    ? sanitizeHtml.sanitize(String(courierName).trim())    : null;
  const sanitizedTracking = trackingNumber ? sanitizeHtml.sanitize(String(trackingNumber).trim()) : null;

  order.returnInfo.status         = 'in_transit';
  order.returnInfo.shippedAt      = new Date();
  order.returnInfo.courierName    = sanitizedCourier;
  order.returnInfo.trackingNumber = sanitizedTracking ?? order.returnInfo.trackingNumber ?? null;

  const timelineMsg = sanitizedCourier
    ? `Customer confirmed shipment via ${sanitizedCourier}${sanitizedTracking ? ` — tracking: ${sanitizedTracking}` : ''}`
    : 'Customer confirmed shipment of return items.';

  order.addReturnTimeline('customer_shipped', timelineMsg, userId, {
    courierName:    sanitizedCourier,
    trackingNumber: sanitizedTracking,
  });
  order.addAuditEntry('customer_shipped', userId, {
    courierName:    sanitizedCourier,
    trackingNumber: sanitizedTracking,
  });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    'Shipment confirmed. We will notify you when your items are received.',
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADMIN GENERATES DISCOUNT CODE
// Status: inspected → awaiting_discount
// The discount creation page handles awaiting_discount → completed.
// @route  POST /api/v1/admin/orders/:id/return/generate-discount
// @access Private/Admin
// ============================================
export const generateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { adminNote = '' } = req.body;
  const order = req.order;

  const sanitizedNote = adminNote ? sanitizeHtml.sanitize(String(adminNote)) : '';

  order.returnInfo.status = 'awaiting_discount';
  if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

  order.addReturnTimeline(
    'discount_initiated',
    'Admin initiated discount code generation. Return awaiting discount issuance.',
    req.user._id
  );
  order.addAuditEntry('discount_initiated', req.user._id, {
    discountValue: order.returnInfo.discountValue,
  });

  await order.save();
  invalidateReturnCaches('status');

  const approvedItems = order.returnInfo.itemsToReturn
    .filter((i) => i.adminDecision === 'approved')
    .map((i) => ({
      productId:  i.product?._id ?? i.product,
      name:       i.product?.name ?? 'Unknown Product',
      quantity:   i.quantity ?? 1,
      unitPrice:  i.product?.price ?? i.price ?? 0,
      image:      i.product?.images?.[0]?.url ?? null,
      reason:     i.reason ?? '',
    }));

  const returnDataForDiscount = {
    orderId:            order._id,
    orderReference:     order.returnInfo.rmaNumber ?? order.orderNumber ?? order._id.toString().slice(-8).toUpperCase(),
    customerId:         order.user?._id ?? order.user,
    customerName:       order.user?.name ?? '',
    customerEmail:      order.user?.email ?? '',
    approvedItems,
    totalApprovedValue: order.returnInfo.discountValue ?? 0,
    discountValue:      order.returnInfo.discountValue ?? 0,
    returnStatus:       'awaiting_discount',
  };

  return res.status(200).json({
    success:               true,
    message:               'Discount code generation initiated. Return is awaiting discount issuance.',
    redirectToDiscount:    true,
    returnDataForDiscount,
    returnInfo:            order.returnInfo,
  });
});

// ============================================
// UPDATE RETURN STATUS (Admin)
// Handles: received → inspected and awaiting_discount → completed.
// NOTE: approved → in_transit is now CUSTOMER-triggered via confirmShipped.
//       Admin cannot set in_transit directly.
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

  // Hard guard: in_transit is customer-triggered only
  if (status === 'in_transit') {
    return next(new HandleError(
      'Status in_transit is set by the customer when they confirm shipment. Use POST /orders/:id/return/confirm-shipped.',
      400
    ));
  }

  order.returnInfo.status = status;

  if (status === 'received') {
    order.returnInfo.receivedAt = new Date();
    order.addReturnTimeline('return_received', 'Return package received at warehouse', req.user._id);
  }

  if (status === 'inspected') {
    order.returnInfo.inspectedAt = new Date();
    order.returnInfo.inspectedBy = req.user._id;
    if (inspectionNotes) {
      order.returnInfo.inspectionNotes = sanitizeHtml.sanitize(String(inspectionNotes));
    }
    order.addReturnTimeline('return_inspected', 'Return items inspected', req.user._id, {
      inspectionNotes: order.returnInfo.inspectionNotes,
    });
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();

    const restorableItems = order.returnInfo.itemsToReturn.filter(
      (item) => item.condition !== 'damaged'
    );

    if (restorableItems.length > 0) {
      const bulkOps = restorableItems.map((item) => ({
        updateOne: {
          filter: { _id: item.product },
          update: [{
            $set: {
              'inventory.stock': { $add: [{ $ifNull: ['$inventory.stock', 0] }, item.quantity] },
              stock:             { $add: [{ $ifNull: ['$stock',             0] }, item.quantity] },
            },
          }],
        },
      }));
      await Product.bulkWrite(bulkOps, { ordered: false });
    }

    order.addReturnTimeline('return_completed', 'Return process completed and discount issued', req.user._id);
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
// @route  POST /api/v1/admin/returns/:id/messages
// @access Private/Admin
// ============================================
export const addReturnMessage = handleAsyncError(async (req, res, next) => {
  const order                         = req.order;
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
// @route  POST /api/v1/orders/:id/return/messages
// @access Private/Customer
// ============================================
export const addCustomerReturnMessage = handleAsyncError(async (req, res, next) => {
  const order                         = req.order;
  const userId                        = req.user._id;
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
// @route  GET /api/v1/orders/:id/return/messages
// @access Private/User or Admin
// ============================================
export const getReturnMessages = handleAsyncError(async (req, res, next) => {
  const { id }                   = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const parsedPage  = Math.max(1, parseInt(page)  || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const skip        = (parsedPage - 1) * parsedLimit;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new HandleError('Invalid order ID', 400));
  }

  const [result] = await Order.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    {
      $project: {
        user:          1,
        'returnInfo.status': 1,
        totalMessages: { $size: { $ifNull: ['$returnInfo.messages', []] } },
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

  await Order.populate(result.messages, { path: 'sender', model: 'User', select: 'name email role' });

  const unreadSenderType = isAdmin ? 'customer' : 'admin';
  const hasUnread = result.messages.some((m) => !m.isRead && m.senderType === unreadSenderType);

  if (hasUnread) {
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
  try { assertOrderOwner(order, userId, isAdmin ? 'admin' : 'customer'); } catch (e) { return next(e); }

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
    .populate('returnInfo.documents.uploadedBy',              'name email role')
    .populate('returnInfo.pleaInfo.pleaDocuments.uploadedBy', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));
  try { assertOrderOwner(order, userId, isAdmin ? 'admin' : 'customer'); } catch (e) { return next(e); }

  return res.status(200).json({
    success:       true,
    count:         order.returnInfo?.documents?.length || 0,
    documents:     order.returnInfo?.documents         || [],
    pleaDocuments: order.returnInfo?.pleaInfo?.pleaDocuments || [],
  });
});

// ============================================
// UPLOAD FILES — Admin
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
// UPLOAD PLEA FILES — Customer
// @route  POST /api/v1/orders/:id/return/plea/upload
// @access Private/Customer
// ============================================
export const uploadPleaFiles = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const order  = await Order.findById(req.params.id);
  if (!order) return next(new HandleError('Order not found', 404));
  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  const allowedStatuses = ['items_reviewed', 'plea_submitted'];
  if (!order.returnInfo || !allowedStatuses.includes(order.returnInfo.status)) {
    return next(new HandleError(
      'Plea evidence can only be uploaded during the plea window (items_reviewed or plea_submitted status)', 400
    ));
  }

  const deadline = order.returnInfo.pleaDeadline;
  if (!deadline || new Date() > new Date(deadline)) {
    return next(new HandleError('The plea window has closed. Evidence can no longer be uploaded.', 400));
  }

  const uploadedFiles = await handlePleaUpload(order, req.files, userId);
  await order.save();
  return res.status(200).json({ success: true, message: 'Plea evidence uploaded successfully', files: uploadedFiles });
});

// ============================================
// GET RETURN STATUS — Customer
// @route  GET /api/v1/orders/:id/return/status
// @access Private/Customer
// ============================================
export const getReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;

  const order = await Order.findById(id).select('returnInfo user');
  if (!order) return next(new HandleError('Order not found', 404));
  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  const timerMutated = checkAndExpireTimers(order);
  if (timerMutated) {
    await order.save({ validateBeforeSave: false });
    invalidateReturnCaches('status');
  }

  const hasReturn = order.returnInfo && order.returnInfo.status !== 'none';
  if (!hasReturn) {
    return res.status(200).json({ success: true, returnInfo: { status: 'none', hasReturn: false } });
  }

  const ri = order.returnInfo.toObject();
  const { messages: _omitted, ...returnInfoWithoutMessages } = ri;

  return res.status(200).json({
    success:    true,
    returnInfo: { ...returnInfoWithoutMessages, hasReturn: true },
  });
});

// ============================================
// GET RETURNS WITH UNREAD MESSAGES (Admin)
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
// @route  PUT /api/v1/orders/:id/return/cancel
// @access Private/Customer
// ============================================
export const cancelReturnRequest = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const order  = req.order;
  order.returnInfo.status = 'cancelled';
  order.addReturnTimeline('return_cancelled', 'Return cancelled by customer', userId);
  order.addAuditEntry('return_cancelled', userId);
  await order.save();
  invalidateReturnCaches('stats');
  return res.status(200).json({ success: true, message: 'Return request cancelled successfully' });
});