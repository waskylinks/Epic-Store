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
 * handlePleaUpload
 * Like handleReturnUpload but writes to pleaInfo.pleaDocuments via the
 * addPleaDocument instance method. Kept separate so plea evidence is
 * stored distinctly from the main return documents array.
 */
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

/**
 * checkAndExpireTimers
 * Lazily checks whether any pending timers on the order have expired and
 * auto-advances status accordingly. Called at the top of any controller
 * that reads or writes return state so no cron job is required.
 *
 * Rules:
 * - items_reviewed + pleaDeadline expired → advance to awaiting_discount
 *   (customer did not submit a plea within 48 hours)
 *
 * Returns true if the order was mutated (caller must save).
 */
const checkAndExpireTimers = (order) => {
  if (!order.returnInfo) return false;

  const { status, pleaDeadline } = order.returnInfo;
  const now = new Date();
  let mutated = false;

  if (
    status === 'items_reviewed' &&
    pleaDeadline &&
    now > new Date(pleaDeadline)
  ) {
    // Plea window expired with no plea submitted — move forward automatically
    order.returnInfo.status = 'awaiting_discount';
    order.addReturnTimeline(
      'plea_window_expired',
      'Plea window expired. Return advanced to awaiting discount.',
      null
    );
    mutated = true;
  }

  return mutated;
};

// ============================================
// GET ALL RETURNS (Admin)
// FIX P-01 — totalCount now stored inside stats cache; warm hit skips aggregation
// FIX P-02 — $lookup inside facet replaces post-aggregate populate (no N+1)
// FIX F-01 — multi-status, date range, RMA search, reason filters
// FIX F-02 — dynamic sortBy / order params (whitelist-guarded)
// FIX F-03 — page / limit validated and clamped
// FIX F-04 — cache key hashes all active filters
// UPDATED  — stats now include new flow statuses + totalRequestedAmount
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
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from:        'users',
        localField:  'returnInfo.requestedBy',
        foreignField: '_id',
        pipeline:    [{ $project: { name: 1, email: 1 } }],
        as:          'returnInfo.requestedBy',
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
  // UPDATED: added totalRequestedAmount facet and new status counts
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
        // NEW — sum all requestedAmount values across the filtered result set
        // so the admin KPI card can show the total financial exposure at a glance
        totalRequestedAmount: [
          {
            $group: {
              _id:   null,
              total: { $sum: { $ifNull: ['$returnInfo.requestedAmount', 0] } },
            },
          },
        ],
      },
    },
  ]);

  const orders       = facetResult.data            || [];
  const totalReturns = facetResult.totalCount?.[0]?.count || 0;
  const countMap     = Object.fromEntries((facetResult.statCounts || []).map((s) => [s._id, s.count]));
  // NEW — extract the aggregated total, default 0 when no results match
  const totalRequestedAmount = facetResult.totalRequestedAmount?.[0]?.total || 0;

  // UPDATED: added new flow status counts alongside existing ones
  stats = {
    total:              totalReturns,
    requested:          countMap.requested          || 0,
    approved:           countMap.approved           || 0,
    items_reviewed:     countMap.items_reviewed     || 0,
    plea_submitted:     countMap.plea_submitted     || 0,
    awaiting_discount:  countMap.awaiting_discount  || 0,
    in_transit:         countMap.in_transit         || 0,
    received:           countMap.received           || 0,
    inspected:          countMap.inspected          || 0,
    completed:          countMap.completed          || 0,
    rejected:           countMap.rejected           || 0,
    cancelled:          countMap.cancelled          || 0,
    // NEW — total financial value of all return requests in the current filter
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
      unreadMessages: o.unreadMessages, createdAt: o.createdAt,
    })),
  });
});

// ============================================
// GET SINGLE RETURN (Admin)
// FIX P-04 — removed full message-thread populate (7 → 5 chains)
//            Last 5 messages returned as a preview only
// UPDATED  — response includes unreadMessages: 0 explicitly after marking
//            read so the frontend badge zeros on the same render cycle
// @route  GET /api/v1/admin/returns/:id
// @access Private/Admin
// ============================================

export const getSingleReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user',                                'name email phoneNo')
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

  // Run lazy timer expiry check — if the plea window has elapsed, advance
  // status before returning so the frontend always sees the current state
  const timerMutated = checkAndExpireTimers(order);

  const hasUnread = order.returnInfo.messages?.some(
    (m) => !m.isRead && m.senderType === 'customer'
  );

  if (hasUnread || timerMutated) {
    if (hasUnread) order.markReturnMessagesAsRead('admin');
    await order.save({ validateBeforeSave: false });
    if (timerMutated) invalidateReturnCaches('status');
  }

  // FIX P-04 — preview only; full thread via GET /return/messages
  const messagePreview = (order.returnInfo.messages ?? []).slice(-5);
  const returnInfoObj  = order.returnInfo.toObject();
  returnInfoObj.messages = messagePreview;

  return res.status(200).json({
    success: true,
    // NEW — explicit 0 so the frontend badge clears immediately without
    // waiting for the list to re-fetch
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
// FIX S-01 — uses req.order from checkReturnEligibility (no duplicate findById)
// FIX L-02 — requestedAmount calculated from order item prices
// FIX L-03 — return window check duplicated here as service-layer safety net
// FIX A-02 — assertOrderOwner helper
// UPDATED  — records policyAcknowledgedAt from request body
// @route  POST /api/v1/orders/:id/return/request
// @access Private/Customer
// ============================================

export const requestReturn = handleAsyncError(async (req, res, next) => {
  // NEW — policyAcknowledged: the frontend sends this as true after the user
  // clicks through the policy screen. We record the timestamp server-side.
  const { reason, description, items, attachments = [], policyAcknowledged } = req.body;
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
    order.orderItems.map((i) => {
      const id = i.product?._id ?? i.product;
      return [id.toString(), i.price];
    })
  );

  const requestedAmount = items.reduce((sum, item) => {
    const price = orderItemMap.get(item.product?.toString()) ?? 0;
    return sum + price * (item.quantity || 0);
  }, 0);

  order.returnInfo = {
    status:               'requested',
    reason,
    description,
    itemsToReturn:        items,
    requestedAmount,
    requestedAt:          new Date(),
    requestedBy:          userId,
    attachments,
    messages:             [],
    timeline:             [],
    documents:            [],
    // NEW — record when the customer acknowledged the discount-only policy
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
// ADMIN REVIEWS RETURN — per-item decisions
// UPDATED — replaces the old single approve/reject with per-item decisions.
//           Sets status to items_reviewed and starts the 48-hour plea timer.
//           restockFee is intentionally never written — all returns use
//           discount codes only.
// Uses req.order from canReviewReturn (allows requested + plea_submitted)
// @route  PUT /api/v1/admin/orders/:id/return/review
// @access Private/Admin
// ============================================

export const reviewReturnRequest = handleAsyncError(async (req, res, next) => {
  const { itemDecisions, adminNote = '' } = req.body;

  const order = req.order;

  // FIX S-05 — sanitize before any persistence
  const sanitizedNote = adminNote
    ? sanitizeHtml.sanitize(String(adminNote))
    : '';

  // Apply per-item decisions from the validated itemDecisions array.
  // Each entry: { productId, decision: 'approved'|'rejected', rejectionReason? }
  itemDecisions.forEach((decision) => {
    const item = order.returnInfo.itemsToReturn.find(
      (i) => {
        const itemProductId = i.product?._id?.toString() ?? i.product?.toString();
        return itemProductId === decision.productId.toString();
      }
    );
    if (item) {
      item.adminDecision          = decision.decision;
      item.adminRejectionReason   = decision.decision === 'rejected'
        ? sanitizeHtml.sanitize(String(decision.rejectionReason ?? ''))
        : '';
    }
  });

  // Calculate discountValue from all approved items.
  // Uses item price stored at return-request time (requestedAmount calc).
  const orderItemPriceMap = new Map(
    order.orderItems.map((i) => {
      const pid = i.product?._id?.toString() ?? i.product?.toString();
      return [pid, i.price ?? 0];
    })
  );

  const discountValue = order.returnInfo.itemsToReturn
    .filter((i) => i.adminDecision === 'approved')
    .reduce((sum, i) => {
      const pid   = i.product?._id?.toString() ?? i.product?.toString();
      const price = orderItemPriceMap.get(pid) ?? 0;
      return sum + price * (i.quantity ?? 1);
    }, 0);

  order.returnInfo.discountValue = discountValue;
  order.returnInfo.status        = 'items_reviewed';
  order.returnInfo.approvedAt    = new Date();
  order.returnInfo.approvedBy    = req.user._id;

  // Set the 48-hour plea window. The customer has until this deadline to
  // submit a plea on any rejected items. After expiry checkAndExpireTimers
  // advances the status to awaiting_discount lazily on the next read.
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
    message:    `Items reviewed. ${approvedCount} approved, ${rejectedCount} rejected. Customer has 48 hours to submit a plea.`,
    returnInfo: order.returnInfo,
  });
});

// ============================================
// CUSTOMER SUBMITS PLEA
// Uses req.order from canSubmitPlea middleware
// @route  POST /api/v1/orders/:id/return/plea
// @access Private/Customer
// ============================================

export const submitPlea = handleAsyncError(async (req, res, next) => {
  const { pleaDescription } = req.body;
  const userId  = req.user._id;
  const order   = req.order;

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  // Persist plea info
  order.returnInfo.pleaInfo = {
    pleaDescription:  sanitizeHtml.sanitize(String(pleaDescription)),
    pleaSubmittedAt:  new Date(),
    pleaDocuments:    order.returnInfo.pleaInfo?.pleaDocuments ?? [],
  };

  order.returnInfo.status       = 'plea_submitted';
  order.returnInfo.pleaAttempts = (order.returnInfo.pleaAttempts ?? 0) + 1;

  // Reset the plea deadline to give the admin 48 hours to respond
  const adminResponseDeadline = new Date();
  adminResponseDeadline.setHours(adminResponseDeadline.getHours() + 48);
  order.returnInfo.pleaDeadline = adminResponseDeadline;

  // Upload any new evidence files if they were sent via a separate upload
  // request (the plea upload route calls addPleaDocument directly; this
  // controller only handles the text description submission)

  order.addReturnTimeline(
    'plea_submitted',
    'Customer submitted a plea for reconsideration',
    userId
  );
  order.addAuditEntry('plea_submitted', userId, {
    pleaAttempts: order.returnInfo.pleaAttempts,
  });

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
// Uses req.order from canReviewReturn (which allows plea_submitted status)
// This is the final item-level decision round. pleaAttempts >= 1 means
// no further pleas can be submitted after this.
// @route  PUT /api/v1/admin/orders/:id/return/plea-review
// @access Private/Admin
// ============================================

export const resolveAfterPlea = handleAsyncError(async (req, res, next) => {
  const { itemDecisions, adminNote = '' } = req.body;

  const order = req.order;

  const sanitizedNote = adminNote
    ? sanitizeHtml.sanitize(String(adminNote))
    : '';

  // Apply updated per-item decisions — same logic as reviewReturnRequest
  itemDecisions.forEach((decision) => {
    const item = order.returnInfo.itemsToReturn.find(
      (i) => {
        const itemProductId = i.product?._id?.toString() ?? i.product?.toString();
        return itemProductId === decision.productId.toString();
      }
    );
    if (item) {
      item.adminDecision        = decision.decision;
      item.adminRejectionReason = decision.decision === 'rejected'
        ? sanitizeHtml.sanitize(String(decision.rejectionReason ?? ''))
        : '';
    }
  });

  // Recalculate discountValue with the updated decisions
  const orderItemPriceMap = new Map(
    order.orderItems.map((i) => {
      const pid = i.product?._id?.toString() ?? i.product?.toString();
      return [pid, i.price ?? 0];
    })
  );

  const discountValue = order.returnInfo.itemsToReturn
    .filter((i) => i.adminDecision === 'approved')
    .reduce((sum, i) => {
      const pid   = i.product?._id?.toString() ?? i.product?.toString();
      const price = orderItemPriceMap.get(pid) ?? 0;
      return sum + price * (i.quantity ?? 1);
    }, 0);

  order.returnInfo.discountValue = discountValue;
  order.returnInfo.status        = 'awaiting_discount';
  order.returnInfo.pleaDeadline  = null; // plea phase is permanently closed

  if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

  const approvedCount = itemDecisions.filter((d) => d.decision === 'approved').length;
  const rejectedCount = itemDecisions.filter((d) => d.decision === 'rejected').length;

  order.addReturnTimeline(
    'plea_resolved',
    `Plea reviewed. Final decisions: ${approvedCount} approved, ${rejectedCount} rejected. Return awaiting discount.`,
    req.user._id,
    { approvedCount, rejectedCount, discountValue, isFinalRound: true }
  );
  order.addAuditEntry('plea_resolved', req.user._id, { approvedCount, rejectedCount, discountValue });

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({
    success:    true,
    message:    `Plea resolved. ${approvedCount} items approved, ${rejectedCount} rejected. Return is now awaiting discount code generation.`,
    returnInfo: order.returnInfo,
  });
});

// ============================================
// ADMIN GENERATES DISCOUNT CODE
// Uses req.order from canGenerateDiscount middleware (pre-populated with
// user and itemsToReturn.product so no extra DB round-trip needed here)
// Sets status to completed, returns full return data for discount page
// pre-population, and triggers the frontend redirect.
// @route  POST /api/v1/admin/orders/:id/return/generate-discount
// @access Private/Admin
// ============================================

export const generateDiscountCode = handleAsyncError(async (req, res, next) => {
  const { adminNote = '' } = req.body;
  const order = req.order; // pre-populated by canGenerateDiscount

  const sanitizedNote = adminNote
    ? sanitizeHtml.sanitize(String(adminNote))
    : '';

  // Mark the return as completed
  order.returnInfo.status      = 'completed';
  order.returnInfo.completedAt = new Date();
  if (sanitizedNote) order.returnInfo.adminNote = sanitizedNote;

  order.addReturnTimeline(
    'discount_generated',
    'Admin manually generated discount code. Return marked completed.',
    req.user._id
  );
  order.addAuditEntry('discount_generated', req.user._id, {
    discountValue: order.returnInfo.discountValue,
  });

  await order.save();
  invalidateReturnCaches('status');

  // Build the approved items summary for discount page pre-population.
  // canGenerateDiscount already populated itemsToReturn.product and user
  // so we can access .name, .price, .images without another findById.
  const approvedItems = order.returnInfo.itemsToReturn
    .filter((i) => i.adminDecision === 'approved')
    .map((i) => ({
      productId:   i.product?._id ?? i.product,
      name:        i.product?.name ?? 'Unknown Product',
      quantity:    i.quantity ?? 1,
      unitPrice:   i.product?.price ?? 0,
      image:       i.product?.images?.[0]?.url ?? null,
      reason:      i.reason ?? '',
    }));

  // Full return data payload sent to the frontend so the admin is redirected
  // to the discount creation page with everything pre-populated.
  const returnDataForDiscount = {
    orderId:            order._id,
    orderReference:     order.orderNumber ?? order._id.toString().slice(-8).toUpperCase(),
    customerId:         order.user?._id ?? order.user,
    customerName:       order.user?.name ?? '',
    customerEmail:      order.user?.email ?? '',
    approvedItems,
    totalApprovedValue: order.returnInfo.discountValue ?? 0,
    discountValue:      order.returnInfo.discountValue ?? 0,
    returnStatus:       'completed',
  };

  return res.status(200).json({
    success:               true,
    message:               'Return marked as completed. Discount code data ready.',
    // redirectToDiscount: true is a signal to the frontend to navigate to
    // the discount creation page with returnDataForDiscount pre-filled
    redirectToDiscount:    true,
    returnDataForDiscount,
    returnInfo:            order.returnInfo,
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
// Uses req.order from canAddReturnMessage middleware
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
// FIX L-04 — response now includes totalCount so clients can paginate
// FIX L-06 — readerType renamed to unreadSenderType (accurate semantics)
// FIX F-03 — page/limit validated and clamped
// NOTE: Uses aggregation to get page slice + total in one round trip,
//       then refetches the Mongoose document only if markAsRead is needed.
// @route  GET /api/v1/orders/:id/return/messages
// @access Private/User or Admin
// ============================================

export const getReturnMessages = handleAsyncError(async (req, res, next) => {
  const { id }                   = req.params;
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
    .populate('returnInfo.documents.uploadedBy',          'name email role')
    .populate('returnInfo.pleaInfo.pleaDocuments.uploadedBy', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));

  try { assertOrderOwner(order, userId, isAdmin ? 'admin' : 'customer'); }
  catch (e) { return next(e); }

  return res.status(200).json({
    success:      true,
    count:        order.returnInfo?.documents?.length || 0,
    documents:    order.returnInfo?.documents         || [],
    // NEW — plea evidence returned separately so the frontend can display
    // original evidence and plea evidence in distinct sections
    pleaDocuments: order.returnInfo?.pleaInfo?.pleaDocuments || [],
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
// UPLOAD PLEA FILES — Customer
// Separate from uploadCustomerReturnFiles so plea evidence is written to
// pleaInfo.pleaDocuments via addPleaDocument rather than the main
// documents array. Only allowed when status is items_reviewed.
// @route  POST /api/v1/orders/:id/return/plea/upload
// @access Private/Customer
// ============================================

export const uploadPleaFiles = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const order  = await Order.findById(req.params.id);
  if (!order) return next(new HandleError('Order not found', 404));

  try { assertOrderOwner(order, userId, req.user.role); } catch (e) { return next(e); }

  if (!order.returnInfo || order.returnInfo.status !== 'items_reviewed') {
    return next(new HandleError(
      'Plea evidence can only be uploaded when the return is in items_reviewed status', 400
    ));
  }

  const uploadedFiles = await handlePleaUpload(order, req.files, userId);
  await order.save();

  return res.status(200).json({ success: true, message: 'Plea evidence uploaded successfully', files: uploadedFiles });
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

  // Run lazy timer expiry on the customer status fetch too so the customer
  // always sees the current state even when the admin hasn't opened the panel
  const timerMutated = checkAndExpireTimers(order);
  if (timerMutated) {
    await order.save({ validateBeforeSave: false });
    invalidateReturnCaches('status');
  }

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
  const order  = req.order;

  order.returnInfo.status = 'cancelled';
  order.addReturnTimeline('return_cancelled', 'Return cancelled by customer', userId);
  order.addAuditEntry('return_cancelled', userId);

  await order.save();
  invalidateReturnCaches('stats');

  return res.status(200).json({ success: true, message: 'Return request cancelled successfully' });
});