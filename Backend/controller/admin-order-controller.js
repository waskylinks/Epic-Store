import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';
import axios from 'axios';

// ============================================
// STATUS TRANSITION VALIDATION
// ============================================

// Valid transitions: key = current status, value = allowed next statuses
const VALID_TRANSITIONS = {
  Processing: ['Shipped', 'Cancelled'],
  Shipped:    ['Delivered'],
  Delivered:  [],
  Cancelled:  []
};

const isValidTransition = (from, to) => {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
};

const TRANSITION_ERROR_MESSAGES = {
  'Shipped-Cancelled':   'Cannot cancel a shipped order. Ask the customer to initiate a return instead.',
  'Delivered-Cancelled': 'Cannot cancel a delivered order. Use the return/refund process instead.',
  'Delivered-Shipped':   'Cannot revert a delivered order to shipped.',
  'Delivered-Processing':'Cannot revert a delivered order.',
  'Cancelled-Processing':'Cannot reactivate a cancelled order.',
  'Cancelled-Shipped':   'Cannot reactivate a cancelled order.',
  'Cancelled-Delivered': 'Cannot reactivate a cancelled order.',
};

// ============================================
// GATEWAY REFUND HELPERS
// ============================================

/**
 * Initiate a real refund against the payment gateway used for the order.
 * Returns { success, refundReference, gatewayResponse } on success.
 * Returns { success: false, error } on failure.
 */
const initiateGatewayRefund = async (order) => {
  const { method, providerTxId, stripePaymentIntentId } = order.paymentInfo;
  const amount = order.amountPaid ?? 0;

  try {
    switch (method) {
      case 'paystack': {
        // Paystack uses kobo — multiply by 100
        const response = await axios.post(
          'https://api.paystack.co/refund',
          {
            transaction: providerTxId,
            amount:      Math.round(amount * 100)
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const data = response.data?.data;
        return {
          success:          true,
          refundReference:  String(data?.id || ''),
          gatewayResponse:  data
        };
      }

      case 'flutterwave': {
        // Flutterwave uses full units — no multiplication
        const response = await axios.post(
          `https://api.flutterwave.com/v3/transactions/${providerTxId}/refund`,
          { amount },
          {
            headers: {
              Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const data = response.data?.data;
        return {
          success:         true,
          refundReference: String(data?.id || ''),
          gatewayResponse: data
        };
      }

      case 'stripe': {
        // Stripe uses cents — multiply by 100
        const response = await axios.post(
          'https://api.stripe.com/v1/refunds',
          new URLSearchParams({
            payment_intent: stripePaymentIntentId,
            amount:         String(Math.round(amount * 100))
          }),
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );

        const data = response.data;
        return {
          success:         true,
          refundReference: String(data?.id || ''),
          gatewayResponse: data
        };
      }

      default:
        // Should never reach here — callers guard for 'manual' before calling
        return { success: false, error: `Unsupported gateway: ${method}` };
    }
  } catch (err) {
    const error =
      err.response?.data?.message ||
      err.response?.data?.error   ||
      err.message                 ||
      'Gateway refund request failed';
    return { success: false, error };
  }
};

// ============================================
// GET ALL ORDERS (admin)
// ============================================
export const getAllOrders = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20, from, to, sort = 'newest', search } = req.query;

  // ── Build filter query ────────────────────────────────────────
  const query = {};
  if (status && status !== 'all') query.orderStatus = status;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      query.createdAt.$lte = toDate;
    }
  }

  // ── Search: match order ID suffix or customer email ──────────
  // Note: full-text name search requires a text index or aggregation pipeline.
  // We search on the paymentInfo.reference (unique per order, often shown to customers)
  // and pre-filter by user email via a user lookup when search is present.
  if (search && search.trim()) {
    const term = search.trim();
    // Match partial order ID (last chars) or payment reference
    query.$or = [
      { 'paymentInfo.reference': { $regex: term, $options: 'i' } }
    ];
    // If term looks like an ObjectId suffix, also match _id string end
    if (/^[a-f0-9]+$/i.test(term) && term.length <= 24) {
      query.$or.push({ _id: { $regex: term + '$', $options: 'i' } });
    }
  }

  // ── Build sort ────────────────────────────────────────────────
  const sortMap = {
    newest:    { createdAt: -1 },
    oldest:    { createdAt:  1 },
    amount_hi: { totalPrice: -1 },
    amount_lo: { totalPrice:  1 },
    status_az: { orderStatus:  1, createdAt: -1 },
    status_za: { orderStatus: -1, createdAt: -1 }
  };
  const sortQuery = sortMap[sort] || sortMap.newest;

  const pageInt  = Math.max(1, parseInt(page)  || 1);
  const limitInt = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip     = (pageInt - 1) * limitInt;

  const [orders, totalOrders] = await Promise.all([
    Order.find(query)
      .populate('user',               'firstName lastName email phone')
      .populate('orderItems.product', 'name images pricing')
      .sort(sortQuery)
      .skip(skip)
      .limit(limitInt),
    Order.countDocuments(query)
  ]);

  const [processing, shipped, delivered, cancelled] = await Promise.all([
    Order.countDocuments({ orderStatus: 'Processing' }),
    Order.countDocuments({ orderStatus: 'Shipped'    }),
    Order.countDocuments({ orderStatus: 'Delivered'  }),
    Order.countDocuments({ orderStatus: 'Cancelled'  })
  ]);

  return res.status(200).json({
    success:     true,
    count:       orders.length,
    totalOrders,
    currentPage: pageInt,
    totalPages:  Math.ceil(totalOrders / limitInt),
    stats:       { total: totalOrders, processing, shipped, delivered, cancelled },
    orders
  });
});

// ============================================
// GET SINGLE ORDER (admin)
// ============================================
export const getSingleOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user',                    'firstName lastName email phone')
    .populate('orderItems.product',      'name images pricing inventory')
    .populate('statusHistory.updatedBy', 'firstName lastName email')
    // FIX: Schema field is 'author', not 'createdBy'
    .populate('notes.author',            'firstName lastName email role')
    .populate('refundInfo.requestedBy',  'firstName lastName email')
    .populate('refundInfo.approvedBy',   'firstName lastName email')
    .populate('returnInfo.requestedBy',  'firstName lastName email')
    .populate('returnInfo.approvedBy',   'firstName lastName email');

  if (!order) return next(new HandleError('Order not found', 404));

  return res.status(200).json({ success: true, order });
});

// ============================================
// UPDATE ORDER STATUS (admin)
// ============================================
export const updateOrder = handleAsyncError(async (req, res, next) => {
  const { id }          = req.params;
  const { status, note } = req.body;

  if (!status) return next(new HandleError('Order status is required', 400));

  const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid order status', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const oldStatus = order.orderStatus;

  // FIX: Enforce valid transition matrix
  if (!isValidTransition(oldStatus, status)) {
    const key     = `${oldStatus}-${status}`;
    const message = TRANSITION_ERROR_MESSAGES[key] ||
      `Cannot transition from ${oldStatus} to ${status}`;
    return next(new HandleError(message, 400));
  }

  order.orderStatus    = status;
  order.fulfillmentSLA = calculateFulfillmentSLA(order.createdAt, status);

  if (status === 'Delivered' && !order.deliveredAt) {
    order.deliveredAt = new Date();
  }

  // FIX: Reduce stock on Shipped (not Delivered) — item leaves warehouse at ship time
  if (status === 'Shipped' && oldStatus !== 'Shipped') {
    for (const item of order.orderItems) {
      const product = await Product.findById(item.product);
      if (product && product.inventory?.stock !== undefined) {
        // FIX: Math.max floor — stock cannot go negative
        product.inventory.stock = Math.max(0, product.inventory.stock - item.quantity);
        await product.save({ validateBeforeSave: false });
      }
    }
  }

  if (status === 'Delivered' && oldStatus !== 'Delivered') {
    // Fire-and-forget analytics sync
    syncCustomerAfterOrder(order._id).catch(() => {});
  }

  // FIX: addAuditEntry changes shape matches schema { field, oldValue, newValue }
  order.addStatusHistory(status, req.user._id, note || `Status updated from ${oldStatus} to ${status}`);
  order.addAuditEntry('status_updated', req.user._id, {
    field:    'orderStatus',
    oldValue: oldStatus,
    newValue: status
  }, { note });

  await order.save();
  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('fulfillment_analytics*'),
    deleteCachePattern('customer_analytics*')
  ]);

  // Repopulate so frontend receives full order with user/product fields intact
  await order.populate('user',               'firstName lastName email phone');
  await order.populate('orderItems.product', 'name images pricing');

  return res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    order
  });
});

// ============================================
// DELETE ORDER (admin)
// ============================================
export const deleteOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.orderStatus === 'Delivered') {
    return next(new HandleError('Cannot delete delivered orders', 400));
  }

  if (order.refundInfo?.status === 'completed') {
    return next(new HandleError('Cannot delete orders with completed refunds', 400));
  }

  await order.deleteOne();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({ success: true, message: 'Order deleted successfully' });
});

// ============================================
// CANCEL ORDER WITH REFUND (admin)
// ============================================
export const cancelOrderWithRefund = handleAsyncError(async (req, res, next) => {
  const { id }                    = req.params;
  const { reason, skipRefund = false } = req.body;

  if (!reason) return next(new HandleError('Cancellation reason is required', 400));

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  // FIX: Block cancellation on Shipped/Delivered — direct to return process
  if (order.orderStatus === 'Shipped') {
    return next(new HandleError(
      'Cannot cancel a shipped order. Ask the customer to initiate a return instead.',
      400
    ));
  }

  if (order.orderStatus === 'Delivered') {
    return next(new HandleError(
      'Cannot cancel a delivered order. Use the return/refund process instead.',
      400
    ));
  }

  if (order.orderStatus === 'Cancelled') {
    return next(new HandleError('Order is already cancelled', 400));
  }

  // At this point orderStatus must be 'Processing'
  // FIX: Stock was never reduced at Processing — no stock restoration needed

  order.orderStatus        = 'Cancelled';
  order.cancelledAt        = new Date();
  order.cancelledBy        = req.user._id;
  order.cancellationReason = reason;

  order.addStatusHistory('Cancelled', req.user._id, reason);

  let refundTriggered  = false;
  let refundReference  = null;
  let refundFailed     = false;
  let refundFailReason = null;

  const isPaid          = order.paymentInfo?.status === 'success';
  const amountPaid      = order.amountPaid ?? 0;
  const isGatewayMethod = ['paystack', 'flutterwave', 'stripe'].includes(order.paymentInfo?.method);

  if (!skipRefund && isPaid && amountPaid > 0 && isGatewayMethod) {
    // Initialise refund info
    order.refundInfo = {
      status:          'processing',
      reason:          'Order Cancellation',
      description:     `Order cancelled by admin. Reason: ${reason}`,
      refundType:      'full',
      requestedAmount: amountPaid,
      refundAmount:    amountPaid,
      requestedAt:     new Date(),
      requestedBy:     req.user._id,
      messages:        [],
      documents:       [],
      timeline:        []
    };

    order.addRefundTimeline(
      'refund_initiated',
      `Automatic refund initiated on order cancellation via ${order.paymentInfo.method}`,
      req.user._id,
      { refundType: 'full', requestedAmount: amountPaid }
    );

    // Call the real payment gateway
    const result = await initiateGatewayRefund(order);

    if (result.success) {
      order.refundInfo.status          = 'completed';
      order.refundInfo.refundReference = result.refundReference;
      order.refundInfo.gatewayResponse = result.gatewayResponse;
      order.refundInfo.refundedAt      = new Date();
      order.refundInfo.processedAt     = new Date();
      order.refundInfo.processedBy     = req.user._id;
      order.refundInfo.approvedAt      = new Date();
      order.refundInfo.approvedBy      = req.user._id;
      order.refundInfo.adminNote       = 'Auto-processed via gateway on order cancellation';

      order.addRefundTimeline(
        'refund_completed',
        `Refund of ${amountPaid} processed successfully via ${order.paymentInfo.method}`,
        req.user._id,
        { refundReference: result.refundReference }
      );

      refundTriggered = true;
      refundReference = result.refundReference;
    } else {
      // Gateway call failed — order still cancelled but refund needs manual action
      order.refundInfo.status        = 'failed';
      order.refundInfo.failureReason = result.error;

      order.addRefundTimeline(
        'refund_failed',
        `Refund failed: ${result.error}`,
        req.user._id
      );

      refundFailed     = true;
      refundFailReason = result.error;
    }
  } else if (!skipRefund && isPaid && amountPaid > 0 && order.paymentInfo?.method === 'manual') {
    // Manual payment — flag for manual refund, do not call any gateway
    order.refundInfo = {
      status:          'requested',
      reason:          'Order Cancellation',
      description:     `Order cancelled by admin. Manual refund required. Reason: ${reason}`,
      refundType:      'full',
      requestedAmount: amountPaid,
      requestedAt:     new Date(),
      requestedBy:     req.user._id,
      adminNote:       'Manual payment method — refund must be processed manually',
      messages:        [],
      documents:       [],
      timeline:        []
    };

    order.addRefundTimeline(
      'refund_requested',
      'Manual refund required — payment was not made via a gateway',
      req.user._id
    );
  }

  // FIX: Audit entry uses correct schema shape { field, oldValue, newValue }
  order.addAuditEntry('order_cancelled', req.user._id, {
    field:    'orderStatus',
    oldValue: 'Processing',
    newValue: 'Cancelled'
  }, {
    reason,
    skipRefund,
    refundTriggered,
    refundReference,
    refundFailed,
    refundFailReason
  });

  await order.save();
  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('cancellation_analytics*')
  ]);

  // Build a meaningful response message
  let message = 'Order cancelled successfully';
  if (refundTriggered)  message = `Order cancelled and refund of ${amountPaid} processed via ${order.paymentInfo.method}`;
  if (refundFailed)     message = `Order cancelled but refund failed: ${refundFailReason}. Please process manually.`;
  if (skipRefund)       message = 'Order cancelled. Refund was skipped as requested.';

  // Repopulate so frontend receives the full order
  await order.populate('user',               'firstName lastName email phone');
  await order.populate('orderItems.product', 'name images pricing');

  return res.status(200).json({
    success: true,
    message,
    refundStatus: order.refundInfo?.status || null,
    order
  });
});

// ============================================
// ADMIN NOTES
// ============================================
export const addAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id }              = req.params;
  const { content, type = 'internal' } = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const note = {
    content:     content.trim(),
    type,
    // FIX: Schema field is 'author', not 'createdBy'
    author:      req.user._id,
    createdAt:   new Date(),
    attachments: []
  };

  if (req.files && req.files.length > 0) {
    note.attachments = req.files.map(file => ({
      url:      `/uploads/orders/${order._id}/${file.filename}`,
      filename: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size
    }));
  }

  order.notes.push(note);

  // FIX: Audit entry shape { field, oldValue, newValue }
  order.addAuditEntry('note_added', req.user._id, {
    field:    'notes',
    oldValue: null,
    newValue: type
  }, { noteType: type });

  await order.save();

  // FIX: Populate 'notes.author' (not 'notes.createdBy')
  const populatedOrder = await Order.findById(id)
    .populate('notes.author', 'firstName lastName email role');
  const addedNote = populatedOrder.notes[populatedOrder.notes.length - 1];

  return res.status(200).json({ success: true, message: 'Note added successfully', note: addedNote });
});

export const getAdminOrderNotes = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  // FIX: Populate 'notes.author' (not 'notes.createdBy')
  const order = await Order.findById(id)
    .populate('notes.author', 'firstName lastName email role')
    .select('notes');

  if (!order) return next(new HandleError('Order not found', 404));

  return res.status(200).json({ success: true, count: order.notes.length, notes: order.notes });
});

export const editAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;
  const { content }    = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const note = order.notes.id(noteId);
  if (!note) return next(new HandleError('Note not found', 404));

  // FIX: Compare against 'note.author' (not 'note.createdBy')
  if (note.author.toString() !== req.user._id.toString()) {
    return next(new HandleError('You can only edit your own notes', 403));
  }

  note.content  = content.trim();
  note.editedAt = new Date();
  note.isEdited = true;
  await order.save();

  // FIX: Populate 'notes.author'
  const populatedOrder = await Order.findById(id)
    .populate('notes.author', 'firstName lastName email role');
  const updatedNote = populatedOrder.notes.id(noteId);

  return res.status(200).json({ success: true, message: 'Note updated successfully', note: updatedNote });
});

export const deleteAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const note = order.notes.id(noteId);
  if (!note) return next(new HandleError('Note not found', 404));

  // FIX: Compare against 'note.author' (not 'note.createdBy')
  if (note.author.toString() !== req.user._id.toString()) {
    return next(new HandleError('You can only delete your own notes', 403));
  }

  note.deleteOne();
  await order.save();

  return res.status(200).json({ success: true, message: 'Note deleted successfully' });
});

// ============================================
// TRACKING (admin)
// ============================================
export const addTrackingInfo = handleAsyncError(async (req, res, next) => {
  const { id }                                        = req.params;
  const { carrier, trackingNumber, estimatedDelivery } = req.body;

  if (!carrier || !trackingNumber) {
    return next(new HandleError('Carrier and tracking number are required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const trackingUrls = {
    DHL:   `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
    UPS:   `https://www.ups.com/track?tracknum=${trackingNumber}`,
    USPS:  `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
  };

  const oldStatus      = order.orderStatus;
  order.tracking       = {
    carrier,
    trackingNumber,
    trackingUrl:       trackingUrls[carrier] || '',
    estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
    lastUpdated:       new Date()
  };

  // Adding tracking implies the order is now shipped
  if (order.orderStatus === 'Processing') {
    order.orderStatus    = 'Shipped';
    order.fulfillmentSLA = calculateFulfillmentSLA(order.createdAt, 'Shipped');

    // FIX: Reduce stock now that it's shipped
    for (const item of order.orderItems) {
      const product = await Product.findById(item.product);
      if (product && product.inventory?.stock !== undefined) {
        product.inventory.stock = Math.max(0, product.inventory.stock - item.quantity);
        await product.save({ validateBeforeSave: false });
      }
    }

    order.addStatusHistory('Shipped', req.user._id, 'Tracking information added');
    order.addAuditEntry('tracking_added', req.user._id, {
      field:    'orderStatus',
      oldValue: oldStatus,
      newValue: 'Shipped'
    }, { carrier, trackingNumber });
  } else {
    order.addAuditEntry('tracking_updated', req.user._id, {
      field:    'tracking',
      oldValue: null,
      newValue: trackingNumber
    }, { carrier });
  }

  await order.save();
  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('fulfillment_analytics*'),
    deleteCachePattern('shipping_carriers*')
  ]);

  // Repopulate for consistent response shape
  await order.populate('user',               'firstName lastName email phone');
  await order.populate('orderItems.product', 'name images pricing');

  return res.status(200).json({
    success:  true,
    message:  'Tracking information added successfully',
    tracking: order.tracking,
    order
  });
});

// ============================================
// SHIPMENTS (admin)
// ============================================
export const createShipment = handleAsyncError(async (req, res, next) => {
  const { id }                                        = req.params;
  const { items, warehouse, carrier, weight, dimensions } = req.body;

  if (!items || items.length === 0) {
    return next(new HandleError('Shipment must contain at least one item', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const shipment = {
    shipmentId: `SHP-${Date.now()}`,
    warehouse,
    items,
    carrier,
    status:    'Processing',
    weight,
    dimensions,
    createdAt: new Date()
  };

  if (!order.shipments) order.shipments = [];
  order.shipments.push(shipment);
  await order.save();
  await deleteCachePattern('fulfillment_analytics*');

  return res.status(200).json({ success: true, message: 'Shipment created successfully', shipment });
});

export const updateShipmentStatus = handleAsyncError(async (req, res, next) => {
  const { id, shipmentId }         = req.params;
  const { status, trackingNumber } = req.body;

  const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid shipment status', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const shipment = order.shipments?.find(s => s.shipmentId === shipmentId);
  if (!shipment) return next(new HandleError('Shipment not found', 404));

  shipment.status = status;
  if (trackingNumber)      shipment.trackingNumber = trackingNumber;
  if (status === 'Shipped')   shipment.shippedAt   = new Date();
  if (status === 'Delivered') shipment.deliveredAt = new Date();

  await order.save();
  await Promise.all([
    deleteCachePattern('fulfillment_analytics*'),
    deleteCachePattern('shipping_carriers*')
  ]);

  return res.status(200).json({ success: true, message: 'Shipment updated successfully', shipment });
});

// ============================================
// RETURNS (admin review)
// ============================================
export const reviewReturnRequest = handleAsyncError(async (req, res, next) => {
  const { id }                              = req.params;
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
    order.returnInfo.status      = 'approved';
    order.returnInfo.approvedAt  = new Date();
    order.returnInfo.approvedBy  = req.user._id;
    order.returnInfo.restockFee  = restockFee;
    order.returnInfo.rmaNumber   = `RMA-${Date.now()}`;
    if (adminNote) order.returnInfo.adminNote = adminNote;
    await order.save();
    return res.status(200).json({
      success:    true,
      message:    'Return approved. RMA number generated.',
      returnInfo: order.returnInfo
    });
  } else {
    order.returnInfo.status     = 'rejected';
    order.returnInfo.approvedAt = new Date();
    order.returnInfo.approvedBy = req.user._id;
    if (adminNote) order.returnInfo.adminNote = adminNote;
    await order.save();
    return res.status(200).json({
      success:    true,
      message:    'Return request rejected',
      returnInfo: order.returnInfo
    });
  }
});

export const updateReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id }                        = req.params;
  const { status, inspectionNotes }   = req.body;

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
  if (status === 'received') order.returnInfo.receivedAt = new Date();

  if (status === 'inspected') {
    order.returnInfo.inspectedAt  = new Date();
    order.returnInfo.inspectedBy  = req.user._id;
    if (inspectionNotes) order.returnInfo.inspectionNotes = inspectionNotes;
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();
    for (const item of order.returnInfo.itemsToReturn) {
      const product = await Product.findById(item.product);
      if (product && item.condition !== 'damaged') {
        if (product.inventory?.stock !== undefined) {
          product.inventory.stock += item.quantity;
        }
        await product.save({ validateBeforeSave: false });
      }
    }
  }

  await order.save();
  return res.status(200).json({
    success:    true,
    message:    `Return status updated to ${status}`,
    returnInfo: order.returnInfo
  });
});

// ============================================
// MESSAGES (admin side)
// ============================================
export const getOrdersWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getOrdersWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count:   orders.length,
    orders:  orders.map(order => ({
      _id:           order._id,
      user:          order.user,
      orderStatus:   order.orderStatus,
      unreadCount:   order.unreadOrderMessagesFromCustomer,
      latestMessage: order.latestOrderMessage
    }))
  });
});

// ============================================
// FRAUD REVIEW (admin)
// ============================================
export const getPendingFraudReviews = handleAsyncError(async (req, res, next) => {
  const orders = await Order.find({
    'fraudCheck.reviewRequired': true,
    'fraudCheck.reviewDecision': 'Pending'
  })
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    count:   orders.length,
    orders:  orders.map(order => ({
      _id:         order._id,
      user:        order.user,
      totalPrice:  order.totalPrice,
      fraudCheck:  order.fraudCheck,
      paymentInfo: order.paymentInfo,
      shippingInfo: order.shippingInfo,
      createdAt:   order.createdAt
    }))
  });
});

export const reviewFraudCheck = handleAsyncError(async (req, res, next) => {
  const { id }          = req.params;
  const { decision, note } = req.body;

  if (!['Approved', 'Rejected'].includes(decision)) {
    return next(new HandleError('Decision must be Approved or Rejected', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.fraudCheck?.reviewRequired) {
    return next(new HandleError('This order does not require fraud review', 400));
  }

  order.fraudCheck.reviewDecision = decision;
  order.fraudCheck.reviewedBy     = req.user._id;
  order.fraudCheck.reviewedAt     = new Date();
  order.fraudCheck.reviewRequired = false;
  if (note) order.fraudCheck.reviewNote = note;

  if (decision === 'Rejected') {
    order.orderStatus        = 'Cancelled';
    order.cancelledAt        = new Date();
    order.cancellationReason = 'Fraud risk - order rejected';
  }

  await order.save();
  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('fraud_analytics*')
  ]);

  return res.status(200).json({ success: true, message: `Order ${decision}`, order });
});

// ============================================
// AUDIT LOG (admin)
// ============================================
export const getAuditLog = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('auditLog.performedBy', 'firstName lastName email role')
    .select('auditLog');

  if (!order) return next(new HandleError('Order not found', 404));

  return res.status(200).json({
    success:  true,
    count:    order.auditLog?.length || 0,
    auditLog: order.auditLog || []
  });
});

export default {
  getAllOrders,
  getSingleOrder,
  updateOrder,
  deleteOrder,
  cancelOrderWithRefund,
  addAdminOrderNote,
  getAdminOrderNotes,
  editAdminOrderNote,
  deleteAdminOrderNote,
  addTrackingInfo,
  createShipment,
  updateShipmentStatus,
  reviewReturnRequest,
  updateReturnStatus,
  getOrdersWithUnreadMessages,
  getPendingFraudReviews,
  reviewFraudCheck,
  getAuditLog
};