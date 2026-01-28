// ============================================
// NEW CONTROLLER FUNCTIONS FOR ENHANCED ORDER MODEL
// Add these to your existing order-controller.js
// ============================================

import Order from '../models/order-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// 1. STATUS HISTORY & TIMELINE
// ============================================

/**
 * Get complete status history timeline for an order
 * @route GET /api/v1/orders/:id/timeline
 * @access Private (User or Admin)
 */
export const getOrderTimeline = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('statusHistory.updatedBy', 'name email')
    .select('statusHistory orderStatus user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({
    success: true,
    timeline: order.statusHistory,
    currentStatus: order.orderStatus
  });
});

// ============================================
// 2. NOTES & COMMUNICATION
// ============================================

/**
 * Add a note to an order
 * @route POST /api/v1/orders/:id/notes
 * @access Private (User for customer notes, Admin for all)
 */
export const addOrderNote = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, type = 'customer', attachments = [] } = req.body;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify ownership
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  // Only admins can add internal notes
  if (type === 'internal' && !isAdmin) {
    return next(new HandleError('Only admins can add internal notes', 403));
  }

  // Add note using instance method
  order.addNote(content, type, userId);

  // Add audit entry
  order.addAuditEntry('note_added', userId, {
    field: 'notes',
    newValue: { type, content: content.substring(0, 50) + '...' }
  });

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Note added successfully',
    note: order.notes[order.notes.length - 1]
  });
});

/**
 * Get all notes for an order
 * @route GET /api/v1/orders/:id/notes
 * @access Private (User sees only customer notes, Admin sees all)
 */
export const getOrderNotes = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('notes.author', 'name email role')
    .select('notes user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  // Filter notes based on role
  const notes = isAdmin 
    ? order.notes 
    : order.notes.filter(note => note.type === 'customer');

  return res.status(200).json({
    success: true,
    count: notes.length,
    notes
  });
});

/**
 * Edit a note
 * @route PUT /api/v1/orders/:id/notes/:noteId
 * @access Private (Author or Admin)
 */
export const editOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;
  const { content } = req.body;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  const note = order.notes.id(noteId);
  if (!note) {
    return next(new HandleError('Note not found', 404));
  }

  // Only author or admin can edit
  if (!isAdmin && note.author.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized to edit this note', 403));
  }

  note.content = content;
  note.isEdited = true;
  note.editedAt = new Date();

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Note updated successfully',
    note
  });
});

// ============================================
// 3. TRACKING & SHIPMENT MANAGEMENT
// ============================================

/**
 * Add tracking information to an order
 * @route POST /api/v1/admin/orders/:id/tracking
 * @access Private (Admin only)
 */
export const addTrackingInfo = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { carrier, trackingNumber, estimatedDelivery } = req.body;

  if (!carrier || !trackingNumber) {
    return next(new HandleError('Carrier and tracking number are required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Generate tracking URL based on carrier
  const trackingUrls = {
    'DHL': `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
    'FedEx': `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
    'UPS': `https://www.ups.com/track?tracknum=${trackingNumber}`,
    'USPS': `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
  };

  order.tracking = {
    carrier,
    trackingNumber,
    trackingUrl: trackingUrls[carrier] || '',
    estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
    lastUpdated: new Date()
  };

  // Add status history
  order.addStatusHistory('Shipped', req.user._id, `Tracking number: ${trackingNumber}`);

  // Add audit entry
  order.addAuditEntry('tracking_added', req.user._id, {
    field: 'tracking',
    newValue: { carrier, trackingNumber }
  });

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Tracking information added successfully',
    tracking: order.tracking
  });
});

/**
 * Get tracking information for an order
 * @route GET /api/v1/orders/:id/tracking
 * @access Private (User or Admin)
 */
export const getTrackingInfo = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .select('tracking orderStatus user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.tracking || !order.tracking.trackingNumber) {
    return res.status(200).json({
      success: true,
      message: 'No tracking information available yet',
      tracking: null
    });
  }

  return res.status(200).json({
    success: true,
    tracking: order.tracking
  });
});

/**
 * Create a shipment (for split shipments)
 * @route POST /api/v1/admin/orders/:id/shipments
 * @access Private (Admin only)
 */
export const createShipment = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { items, warehouse, carrier, weight, dimensions } = req.body;

  if (!items || items.length === 0) {
    return next(new HandleError('Shipment must contain at least one item', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  const shipmentId = `SHP-${Date.now()}`;

  const shipment = {
    shipmentId,
    warehouse,
    items,
    carrier,
    status: 'pending',
    weight,
    dimensions
  };

  if (!order.shipments) {
    order.shipments = [];
  }
  order.shipments.push(shipment);

  // Update item fulfillment status
  items.forEach(shipItem => {
    const orderItem = order.orderItems.find(
      item => item.product.toString() === shipItem.product.toString()
    );
    if (orderItem) {
      orderItem.quantityShipped = (orderItem.quantityShipped || 0) + shipItem.quantity;
      if (orderItem.quantityShipped >= orderItem.quantityOrdered) {
        orderItem.fulfillmentStatus = 'complete';
      } else {
        orderItem.fulfillmentStatus = 'partial';
      }
    }
  });

  order.addAuditEntry('shipment_created', req.user._id, { shipmentId });

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Shipment created successfully',
    shipment
  });
});

/**
 * Update shipment status
 * @route PUT /api/v1/admin/orders/:id/shipments/:shipmentId
 * @access Private (Admin only)
 */
export const updateShipmentStatus = handleAsyncError(async (req, res, next) => {
  const { id, shipmentId } = req.params;
  const { status, trackingNumber } = req.body;

  const validStatuses = ['pending', 'packed', 'shipped', 'delivered'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid shipment status', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  const shipment = order.shipments.find(s => s.shipmentId === shipmentId);
  if (!shipment) {
    return next(new HandleError('Shipment not found', 404));
  }

  shipment.status = status;
  if (trackingNumber) shipment.trackingNumber = trackingNumber;

  if (status === 'shipped') {
    shipment.shippedAt = new Date();
  }
  if (status === 'delivered') {
    shipment.deliveredAt = new Date();
  }

  order.addAuditEntry('shipment_updated', req.user._id, {
    shipmentId,
    status
  });

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Shipment updated successfully',
    shipment
  });
});

// ============================================
// 4. RETURN MANAGEMENT (RMA)
// ============================================

/**
 * Request return for an order (RMA)
 * @route POST /api/v1/orders/:id/return/request
 * @access Private (User who owns the order)
 */
export const requestReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, itemsToReturn } = req.body;
  const userId = req.user._id;

  if (!reason || !itemsToReturn || itemsToReturn.length === 0) {
    return next(new HandleError('Reason and items to return are required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify ownership
  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  // Check if order is delivered
  if (order.orderStatus !== 'Delivered') {
    return next(new HandleError('Can only return delivered orders', 400));
  }

  // Check return window (30 days from delivery)
  const returnDeadline = new Date(order.deliveredAt);
  returnDeadline.setDate(returnDeadline.getDate() + 30);

  if (new Date() > returnDeadline) {
    return next(new HandleError('Return period has expired (30 days from delivery)', 400));
  }

  // Check if return already exists
  if (order.returnInfo && order.returnInfo.status !== 'none') {
    return next(new HandleError('Return request already exists for this order', 400));
  }

  order.returnInfo = {
    status: 'requested',
    reason,
    itemsToReturn,
    requestedAt: new Date(),
    requestedBy: userId
  };

  order.addStatusHistory('Return Requested', userId, reason);
  order.addAuditEntry('return_requested', userId, { reason });

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Return request submitted successfully. You will receive an RMA number once approved.',
    returnInfo: order.returnInfo
  });
});

/**
 * Admin approves/rejects return request
 * @route PUT /api/v1/admin/orders/:id/return/review
 * @access Private (Admin only)
 */
export const reviewReturnRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { action, restockFee = 0 } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return next(new HandleError('Action must be approve or reject', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.returnInfo || order.returnInfo.status !== 'requested') {
    return next(new HandleError('No pending return request found', 400));
  }

  if (action === 'approve') {
    order.returnInfo.status = 'approved';
    order.returnInfo.approvedAt = new Date();
    order.returnInfo.approvedBy = req.user._id;
    order.returnInfo.restockFee = restockFee;
    
    // RMA number is auto-generated by pre-save hook

    order.addAuditEntry('return_approved', req.user._id);

    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Return approved. RMA number generated.',
      returnInfo: order.returnInfo
    });
  } else {
    order.returnInfo.status = 'rejected';
    order.returnInfo.approvedAt = new Date();
    order.returnInfo.approvedBy = req.user._id;

    order.addAuditEntry('return_rejected', req.user._id);

    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Return request rejected',
      returnInfo: order.returnInfo
    });
  }
});

/**
 * Update return status (in_transit, received, inspected, completed)
 * @route PUT /api/v1/admin/orders/:id/return/status
 * @access Private (Admin only)
 */
export const updateReturnStatus = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { status, inspectionNotes } = req.body;

  const validStatuses = ['in_transit', 'received', 'inspected', 'completed'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid return status', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 400));
  }

  order.returnInfo.status = status;

  if (status === 'received') {
    order.returnInfo.receivedAt = new Date();
  }

  if (status === 'inspected') {
    order.returnInfo.inspectedAt = new Date();
    order.returnInfo.inspectedBy = req.user._id;
    if (inspectionNotes) {
      order.returnInfo.inspectionNotes = inspectionNotes;
    }
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();
    
    // Restock items
    for (const item of order.returnInfo.itemsToReturn) {
      const product = await Product.findById(item.product);
      if (product && item.condition !== 'damaged') {
        product.stock += item.quantity;
        await product.save({ validateBeforeSave: false });
      }
    }
  }

  order.addAuditEntry('return_status_updated', req.user._id, { status });

  await order.save();

  return res.status(200).json({
    success: true,
    message: `Return status updated to ${status}`,
    returnInfo: order.returnInfo
  });
});

/**
 * Get all active returns (Admin)
 * @route GET /api/v1/admin/returns
 * @access Private (Admin only)
 */
export const getAllReturns = handleAsyncError(async (req, res, next) => {
  const { status } = req.query;

  const query = {
    'returnInfo.status': { 
      $in: ['requested', 'approved', 'in_transit', 'received', 'inspected'] 
    }
  };

  if (status) {
    query['returnInfo.status'] = status;
  }

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('returnInfo.requestedBy', 'name email')
    .populate('returnInfo.approvedBy', 'name email')
    .sort({ 'returnInfo.requestedAt': -1 });

  return res.status(200).json({
    success: true,
    count: orders.length,
    returns: orders.map(order => ({
      orderId: order._id,
      user: order.user,
      returnInfo: order.returnInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice
    }))
  });
});

// ============================================
// 5. INVOICE MANAGEMENT
// ============================================

/**
 * Generate/Download invoice for an order
 * @route GET /api/v1/orders/:id/invoice
 * @access Private (User or Admin)
 */
export const downloadInvoice = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('user', 'name email')
    .populate('orderItems.product', 'name');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  // Check if invoice exists
  if (!order.invoiceInfo || !order.invoiceInfo.pdfUrl) {
    return res.status(200).json({
      success: false,
      message: 'Invoice not yet generated for this order'
    });
  }

  return res.status(200).json({
    success: true,
    invoice: {
      invoiceNumber: order.invoiceInfo.invoiceNumber,
      invoiceDate: order.invoiceInfo.invoiceDate,
      pdfUrl: order.invoiceInfo.pdfUrl,
      version: order.invoiceInfo.version
    }
  });
});

// ============================================
// 6. FRAUD PREVENTION & REVIEW
// ============================================

/**
 * Get orders pending fraud review
 * @route GET /api/v1/admin/orders/fraud-review
 * @access Private (Admin only)
 */
export const getPendingFraudReviews = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getPendingFraudReviews();

  return res.status(200).json({
    success: true,
    count: orders.length,
    orders: orders.map(order => ({
      _id: order._id,
      user: order.user,
      totalPrice: order.totalPrice,
      fraudCheck: order.fraudCheck,
      paymentInfo: order.paymentInfo,
      shippingInfo: order.shippingInfo,
      createdAt: order.createdAt
    }))
  });
});

/**
 * Review flagged order (approve/reject)
 * @route PUT /api/v1/admin/orders/:id/fraud-review
 * @access Private (Admin only)
 */
export const reviewFraudCheck = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { decision } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(decision)) {
    return next(new HandleError('Decision must be approved or rejected', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.fraudCheck || !order.fraudCheck.reviewRequired) {
    return next(new HandleError('This order does not require fraud review', 400));
  }

  order.fraudCheck.reviewDecision = decision;
  order.fraudCheck.reviewedBy = req.user._id;
  order.fraudCheck.reviewedAt = new Date();
  order.fraudCheck.reviewRequired = false;

  if (decision === 'rejected') {
    // Cancel order and initiate refund
    order.orderStatus = 'Cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'Fraud risk - order rejected';
  }

  order.addAuditEntry('fraud_review', req.user._id, { decision });

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: `Order ${decision}`,
    order
  });
});

// ============================================
// 7. AUDIT LOG
// ============================================

/**
 * Get audit log for an order
 * @route GET /api/v1/admin/orders/:id/audit
 * @access Private (Admin only)
 */
export const getAuditLog = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('auditLog.performedBy', 'name email role')
    .select('auditLog');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  return res.status(200).json({
    success: true,
    count: order.auditLog.length,
    auditLog: order.auditLog
  });
});

// ============================================
// 8. ANALYTICS HELPERS
// ============================================

/**
 * Get customer order analytics
 * @route GET /api/v1/analytics/customer/:userId/orders
 * @access Private (Admin only)
 */
export const getCustomerOrderAnalytics = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;

  const orders = await Order.find({ user: userId });

  const analytics = {
    totalOrders: orders.length,
    totalSpent: orders.reduce((sum, order) => sum + order.totalPrice, 0),
    averageOrderValue: orders.length > 0 
      ? orders.reduce((sum, order) => sum + order.totalPrice, 0) / orders.length 
      : 0,
    firstOrderDate: orders.length > 0 
      ? orders.sort((a, b) => a.createdAt - b.createdAt)[0].createdAt 
      : null,
    lastOrderDate: orders.length > 0 
      ? orders.sort((a, b) => b.createdAt - a.createdAt)[0].createdAt 
      : null,
    refundedOrders: orders.filter(o => o.refundInfo?.status === 'completed').length,
    returnedOrders: orders.filter(o => o.returnInfo?.status === 'completed').length,
    cancelledOrders: orders.filter(o => o.orderStatus === 'Cancelled').length
  };

  return res.status(200).json({
    success: true,
    userId,
    analytics
  });
});