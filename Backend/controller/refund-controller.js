import mongoose from 'mongoose';
import Order from '../models/order-model.js';
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinaryUpload.js';
import { deleteCachePattern, getCache, setCache } from '../utils/redis.js';
import { PaymentFactory } from '../Services/payment/paymentFactory.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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
  'refundInfo.messages': 1,
  createdAt: 1,
};

// FIX: added gatewayResponse, gatewayStatus, refundId — these are now
// stored by the gateway service files and webhook handlers, and the
// frontend detail panel needs them to show the raw gateway reply.
const safeRefundResponse = (order) => ({
  _id:              order._id,
  orderNumber:      order.orderNumber,
  orderStatus:      order.orderStatus,
  totalPrice:       order.totalPrice,
  amountPaid:       order.amountPaid,
  refundableAmount: order.refundableAmount,
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
    refundId:        order.refundInfo?.refundId,         // gateway refund ID
    gatewayStatus:   order.refundInfo?.gatewayStatus,    // raw status from gateway
    gatewayResponse: order.refundInfo?.gatewayResponse,  // raw gateway response object
    processedAt:     order.refundInfo?.processedAt,
    processedBy:     order.refundInfo?.processedBy,      // admin who clicked Process Refund
    refundedAt:      order.refundInfo?.refundedAt,
    failureReason:   order.refundInfo?.failureReason,
    messages:        order.refundInfo?.messages,
    documents:       order.refundInfo?.documents,
    timeline:        order.refundInfo?.timeline,
  },
  unreadMessages: order.unreadRefundMessages,
  createdAt:      order.createdAt,
});

const invalidateRefundCaches = () => {
  Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('refund_overview*'),
    deleteCachePattern('refund_stats*'),
    deleteCachePattern('refunds_by_payment_method*'),
    deleteCachePattern('refund_timeline*'),
  ]).catch((err) => console.error('Refund cache invalidation error:', err));
};

const resolveDocType = (resourceType) => {
  if (resourceType === 'image') return 'photo';
  if (resourceType === 'video') return 'video';
  return 'other';
};

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
// GATEWAY REFUND HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the correct params object for each gateway's refundPayment() function.
 * Each service expects different field names — this centralises that mapping
 * so processRefund never has to branch on gateway itself.
 *
 * Paystack  : { transactionReference, amount, merchantNote }
 * Flutterwave: { chargeId, amount, reason, merchantNote }
 *              chargeId = providerTxId from original verify response
 * Stripe    : { paymentIntentId, amount, reason, merchantNote }
 *              paymentIntentId = stripePaymentIntentId ?? providerTxId
 */
const buildGatewayRefundParams = (order, refundAmount, merchantNote) => {
  const gateway = order.paymentInfo?.method;

  if (gateway === 'paystack') {
    return {
      transactionReference: order.paymentInfo.reference,
      amount: Number(refundAmount),
      merchantNote: merchantNote ?? '',
    };
  }

  if (gateway === 'flutterwave') {
    // Flutterwave refund API requires the charge_id from the original transaction.
    // This is stored as providerTxId when the payment was verified.
    return {
      chargeId: order.paymentInfo.providerTxId,
      amount: Number(refundAmount),
      reason: 'Customer refund request',
      merchantNote: merchantNote ?? '',
    };
  }

  if (gateway === 'stripe') {
    return {
      paymentIntentId: order.paymentInfo.stripePaymentIntentId ?? order.paymentInfo.providerTxId,
      amount: Number(refundAmount),
      reason: 'requested_by_customer',
      merchantNote: merchantNote ?? '',
    };
  }

  throw new Error(`Unsupported payment gateway for refund: ${gateway}`);
};

/**
 * Fire-and-forget gateway refund call.
 * Runs after the HTTP response has already been sent to the frontend.
 * Saves the final status (completed/failed) back to the order.
 *
 * The frontend receives 'processing' immediately. The order then updates
 * to completed/failed asynchronously here, and in production the webhook
 * from the gateway also updates it once the payment processor settles.
 */
const fireGatewayRefund = async (orderId, gateway, refundParams, adminUserId) => {
  try {
    console.log(`[Refund] Calling ${gateway} gateway | order=${orderId}`);

    const gatewayResult = await PaymentFactory.refundPayment(gateway, refundParams);

    console.log(`[Refund] ${gateway} response | status=${gatewayResult.gatewayStatus} | mapped=${gatewayResult.status}`);

    // Reload order fresh — it may have changed since the HTTP response was sent
    const order = await Order.findById(orderId);
    if (!order) {
      console.error(`[Refund] Order ${orderId} not found when saving gateway result`);
      return;
    }

    // Guard: only update if still in processing — webhook may have already settled it
    if (order.refundInfo?.status !== 'processing') {
      console.log(`[Refund] Order ${orderId} already in state '${order.refundInfo?.status}', skipping gateway result write`);
      return;
    }

    order.refundInfo.refundId        = gatewayResult.refundId;
    order.refundInfo.gatewayStatus   = gatewayResult.gatewayStatus;
    order.refundInfo.gatewayResponse = gatewayResult.raw;
    order.refundInfo.status          = gatewayResult.status; // 'completed' | 'failed' | 'processing'

    if (gatewayResult.status === 'completed') {
      order.refundInfo.refundedAt  = new Date();
      order.refundInfo.refundAmount = gatewayResult.amount ?? order.refundInfo.refundAmount;

      order.addRefundTimeline(
        'refund_completed',
        `Refund of $${(gatewayResult.amount ?? order.refundInfo.refundAmount).toFixed(2)} completed via ${gateway}${gatewayResult.refundId ? ` (ref: ${gatewayResult.refundId})` : ''}`,
        adminUserId,
        { gatewayStatus: gatewayResult.gatewayStatus, refundId: gatewayResult.refundId }
      );

      order.addRefundMessage(
        adminUserId,
        'admin',
        `Your refund of $${(gatewayResult.amount ?? order.refundInfo.refundAmount).toFixed(2)} has been processed and should appear within 3–10 business days.`
      );

      order.addAuditEntry(
        'refund_completed',
        adminUserId,
        { field: 'refundInfo.status', oldValue: 'processing', newValue: 'completed' }
      );
    } else if (gatewayResult.status === 'failed') {
      order.refundInfo.failureReason = `${gateway} declined: ${gatewayResult.gatewayStatus}`;

      order.addRefundTimeline(
        'refund_failed',
        `Refund failed via ${gateway}: ${gatewayResult.gatewayStatus}`,
        adminUserId,
        { gatewayStatus: gatewayResult.gatewayStatus }
      );

      order.addAuditEntry(
        'refund_failed',
        adminUserId,
        { field: 'refundInfo.status', oldValue: 'processing', newValue: 'failed' }
      );
    } else {
      // Still processing (prod: gateway returned pending) — webhook will finalise
      console.log(`[Refund] ${gateway} returned pending for order=${orderId}, awaiting webhook`);
    }

    await order.save();
    invalidateRefundCaches();

    console.log(`[Refund] Gateway result saved | order=${orderId} | final status=${order.refundInfo.status}`);
  } catch (err) {
    console.error(`[Refund] ${gateway} gateway call failed for order=${orderId}:`, err.message);

    // Save failed status so admin can see it in the panel
    try {
      const order = await Order.findById(orderId);
      if (order && order.refundInfo?.status === 'processing') {
        order.refundInfo.status        = 'failed';
        order.refundInfo.failureReason = err.message ?? 'Gateway error';
        order.refundInfo.gatewayResponse = { error: err.message };

        order.addRefundTimeline(
          'refund_failed',
          `Refund failed via ${gateway}: ${err.message}`,
          adminUserId
        );

        order.addAuditEntry(
          'refund_failed',
          adminUserId,
          { field: 'refundInfo.status', oldValue: 'processing', newValue: 'failed' }
        );

        await order.save();
        invalidateRefundCaches();
      }
    } catch (saveErr) {
      console.error(`[Refund] Failed to save error state for order=${orderId}:`, saveErr.message);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/v1/admin/refunds ─────────────────────────────────────────────
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

  const baseMatch = { 'refundInfo.status': { $nin: ['none'] } };

  if (status) baseMatch['refundInfo.status'] = status;

  if (startDate || endDate) {
    baseMatch['refundInfo.requestedAt'] = {};
    if (startDate) baseMatch['refundInfo.requestedAt'].$gte = new Date(startDate);
    if (endDate) {
      baseMatch['refundInfo.requestedAt'].$lte = new Date(
        new Date(endDate).setHours(23, 59, 59, 999)
      );
    }
  }

  const STATS_CACHE_KEY   = 'refund_stats:all';
  const STATS_TTL_SECONDS = 60;

  let stats = null;
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) stats = JSON.parse(cached);
  } catch (_) { /* cache miss is fine */ }

  let orders;
  let totalRefunds;

  if (search && search.trim()) {
    const trimmed = search.trim();
    const isOrderNumberSearch = /^[a-f0-9]+$/i.test(trimmed);

    if (isOrderNumberSearch) {
      const orderMatch = { ...baseMatch, orderNumber: { $regex: trimmed, $options: 'i' } };
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
      const nameRx = new RegExp(trimmed, 'i');
      const pipeline = [
        { $match: baseMatch },
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
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
              { $sort: { 'refundInfo.requestedAt': -1, _id: -1 } },
              { $skip: skip },
              { $limit: limitNum },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ];

      const [result] = await Order.aggregate(pipeline);
      totalRefunds = result.total[0]?.count ?? 0;
      orders = (result.data ?? []).map((o) => ({
        ...o,
        unreadMessages: (o.refundInfo?.messages ?? []).filter(
          (m) => !m.isRead && m.senderType === 'customer'
        ).length,
      }));
    }
  } else {
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
        unreadCount:     order.unreadRefundMessages,
      },
      latestMessage: order.latestRefundMessage,
    })),
  });
});

// ── GET /api/v1/admin/refunds/:orderId ────────────────────────────────────
export const getSingleRefund = handleAsyncError(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId)
    .populate('user',                             'firstName lastName email phone')
    .populate('refundInfo.requestedBy',           'firstName lastName email')
    .populate('refundInfo.approvedBy',            'firstName lastName email')
    .populate('refundInfo.rejectedBy',            'firstName lastName email')
    .populate('refundInfo.processedBy',           'firstName lastName email')
    .populate('refundInfo.messages.sender',       'firstName lastName email role')
    .populate('refundInfo.documents.uploadedBy',  'firstName lastName email')
    .populate('refundInfo.timeline.performedBy',  'firstName lastName email')
    .populate('orderItems.product',               'name images');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.refundInfo || order.refundInfo?.status === 'none') {
    return next(new HandleError('This order has no refund request', 400));
  }

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

  // req.order is required — attached by checkRefundEligibility middleware.
  // The middleware validates ownership, order status, and refund eligibility
  // before this controller runs, so no fallback fetch is needed here.
  const order = req.order;

  let refundAmount = order.amountPaid;
  if (refundType === 'partial') {
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
      order.addRefundDocument(resolveDocType(result.resource_type), result.secure_url, originalname, userId, '');
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
export const reviewRefund = handleAsyncError(async (req, res, next) => {
  const { action, adminNote } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    return next(new HandleError('action must be "approve" or "reject"', 400));
  }

  const order = req.order ?? await Order.findById(req.params.orderId);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.refundInfo?.status !== 'requested') {
    return next(new HandleError(
      `Cannot review a refund with status "${order.refundInfo?.status}"`, 400
    ));
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
//
// Flow:
//   1. Validate amount and current status
//   2. Atomic CAS: approved → processing (prevents duplicate gateway calls)
//   3. Reload order, write processing metadata, save to DB
//   4. Return 'processing' response to frontend immediately
//   5. Fire gateway call asynchronously via setImmediate (after response is sent)
//   6. Gateway result saves completed/failed back to order (fireGatewayRefund)
//   7. In production, webhook from gateway also updates the order when it settles
export const processRefund = handleAsyncError(async (req, res, next) => {
  const { orderId }                  = req.params;
  const { refundAmount, merchantNote } = req.body;

  if (!refundAmount || isNaN(Number(refundAmount)) || Number(refundAmount) <= 0) {
    return next(new HandleError('A valid refundAmount is required', 400));
  }

  const order = req.order ?? await Order.findById(orderId);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.refundInfo?.status !== 'approved') {
    return next(new HandleError(
      `Cannot process a refund with status "${order.refundInfo?.status}". Must be "approved".`, 400
    ));
  }

  const maxRefund = order.amountPaid - (order.refundInfo.refundAmount || 0);
  if (Number(refundAmount) > maxRefund) {
    return next(new HandleError(
      `Refund amount $${refundAmount} exceeds the maximum refundable amount of $${maxRefund.toFixed(2)}`, 400
    ));
  }

  const gateway = order.paymentInfo?.method;

  // FIX: validate gateway is supported before the CAS so we don't lock
  // the order into 'processing' and then immediately fail on an unknown gateway
  if (!PaymentFactory.isSupported(gateway)) {
    return next(new HandleError(`Unsupported payment gateway: ${gateway}`, 400));
  }

  // FIX: validate we have the required identifier for this gateway before CAS
  if (gateway === 'flutterwave' && !order.paymentInfo?.providerTxId) {
    return next(new HandleError(
      'Flutterwave refund requires providerTxId (charge ID) which is missing from this order', 400
    ));
  }
  if (gateway === 'stripe' && !order.paymentInfo?.stripePaymentIntentId && !order.paymentInfo?.providerTxId) {
    return next(new HandleError(
      'Stripe refund requires paymentIntentId which is missing from this order', 400
    ));
  }
  if (gateway === 'paystack' && !order.paymentInfo?.reference) {
    return next(new HandleError(
      'Paystack refund requires transaction reference which is missing from this order', 400
    ));
  }

  // ── Atomic CAS: approved → processing ──────────────────────────────────
  const transitioned = await Order.findOneAndUpdate(
    { _id: orderId, 'refundInfo.status': 'approved' },
    { $set: { 'refundInfo.status': 'processing' } },
    { new: false }
  );

  if (!transitioned) {
    return next(new HandleError(
      'Refund is no longer in an approved state. It may have already been submitted for processing.', 409
    ));
  }

  // Reload fresh after the CAS
  const freshOrder = await Order.findById(orderId);

  freshOrder.refundInfo.refundAmount    = Number(refundAmount);
  freshOrder.refundInfo.refundCurrency  = freshOrder.paymentInfo?.currency ?? 'USD';
  freshOrder.refundInfo.processedAt     = new Date();
  freshOrder.refundInfo.processedBy     = req.user._id;
  freshOrder.refundInfo.refundReference = `REF-${Date.now()}-${freshOrder._id.toString().slice(-6)}`;
  if (merchantNote) freshOrder.refundInfo.notes = merchantNote;

  freshOrder.addRefundTimeline(
    'refund_processing',
    `Refund of $${Number(refundAmount).toFixed(2)} submitted to ${gateway}`,
    req.user._id,
    { refundAmount, gateway }
  );

  freshOrder.addAuditEntry(
    'refund_processing',
    req.user._id,
    { field: 'refundInfo.status', oldValue: 'approved', newValue: 'processing' }
  );

  await freshOrder.save();
  invalidateRefundCaches();

  await freshOrder.populate('user', 'firstName lastName email');

  // ── Return 'processing' to frontend immediately ────────────────────────
  // FIX: response message now accurately reflects that processing has started
  // not that it completed. The frontend shows a processing badge from here.
  res.status(200).json({
    success: true,
    message: `Refund submitted to ${gateway} for processing`,
    order:   safeRefundResponse(freshOrder),
  });

  // ── Fire gateway call after response is sent ───────────────────────────
  // setImmediate ensures this runs after the current event loop tick
  // (i.e. after res.json() has flushed). The HTTP response is already sent
  // to the client before any gateway network call happens.
  setImmediate(() => {
    const refundParams = buildGatewayRefundParams(freshOrder, refundAmount, merchantNote);
    fireGatewayRefund(orderId, gateway, refundParams, req.user._id);
  });
});

// ── GET /api/v1/orders/:orderId/refund/messages ───────────────────────────
export const getRefundMessages = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const page        = Math.max(1, Number(req.query.page  ?? 1));
  const limit       = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const userId      = req.user._id;
  const isAdmin     = req.user.role === 'admin';
  const skip        = (page - 1) * limit;

  const order = await Order.findById(orderId, {
    user:                  1,
    'refundInfo.status':   1,
    'refundInfo.messages': { $slice: [skip, limit] },
  }).populate('refundInfo.messages.sender', 'firstName lastName email role');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo?.messages) {
    return res.status(200).json({ success: true, total: 0, messages: [] });
  }

  const senderToMarkRead = isAdmin ? 'customer' : 'admin';

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
export const sendRefundMessage = handleAsyncError(async (req, res, next) => {
  const { message, attachments = [] } = req.body;

  if (!message?.trim() && attachments.length === 0) {
    return next(new HandleError('Message content or attachments are required', 400));
  }

  const order = req.order ?? await Order.findById(req.params.orderId);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.refundInfo?.status === 'none') {
    return next(new HandleError('This order has no refund request', 400));
  }

  order.addRefundMessage(req.user._id, 'admin', message?.trim() ?? '', attachments);
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

  res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data:    { orderId: order._id, message: populatedMessage },
  });
});

// ── POST /api/v1/orders/:orderId/refund/messages ──────────────────────────
export const addCustomerRefundMessage = handleAsyncError(async (req, res, next) => {
  const { message, attachments = [] } = req.body;
  const userId = req.user._id;

  const order = req.order ?? await Order.findById(req.params.orderId);
  if (!order) return next(new HandleError('Order not found', 404));

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
export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;
  const isAdmin     = req.user.role === 'admin';

  const order = await Order.findById(orderId)
    .populate('refundInfo.timeline.performedBy', 'firstName lastName email role')
    .select({ 'refundInfo.timeline': 1, user: 1 });

  if (!order) return next(new HandleError('Order not found', 404));

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
export const getRefundDocuments = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;
  const isAdmin     = req.user.role === 'admin';

  const order = await Order.findById(orderId)
    .populate('refundInfo.documents.uploadedBy', 'firstName lastName email role')
    .select({ 'refundInfo.documents': 1, user: 1 });

  if (!order) return next(new HandleError('Order not found', 404));

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
export const uploadRefundFiles = handleAsyncError(async (req, res, next) => {
  if (!req.files?.length) return next(new HandleError('No files provided', 400));

  const order = await Order.findById(req.params.orderId);
  if (!order) return next(new HandleError('Order not found', 404));

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
export const uploadCustomerRefundFiles = handleAsyncError(async (req, res, next) => {
  const { orderId } = req.params;
  const userId      = req.user._id;

  if (!req.files?.length) return next(new HandleError('No files provided', 400));

  const order = await Order.findById(orderId);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found for this order', 400));
  }

  const folder  = `ecommerce/refunds/${order._id}/customer`;
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
export const cancelRefundRequest = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const order = req.order ?? await Order.findById(req.params.orderId);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!['requested', 'approved'].includes(order.refundInfo?.status)) {
    return next(new HandleError(
      `Cannot cancel a refund with status "${order.refundInfo?.status}"`, 400
    ));
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