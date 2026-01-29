import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// BASIC ORDER OPERATIONS
// ============================================

/**
 * Get all orders for the logged-in user
 * @route GET /api/v1/orders/user
 * @access Private (User)
 */
export const getAllMyOrders = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const orders = await Order.find({ user: userId })
    .populate('orderItems.product', 'name images price')
    .sort({ createdAt: -1 });

  if (!orders || orders.length === 0) {
    return res.status(200).json({
      success: true,
      count: 0,
      orders: [],
      message: 'No orders found'
    });
  }

  return res.status(200).json({
    success: true,
    count: orders.length,
    orders
  });
});

/**
 * Get single order details
 * @route GET /api/v1/order/:id
 * @access Private (User or Admin)
 */
export const getOrderDetails = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('user', 'name email')
    .populate('orderItems.product', 'name images price');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({
    success: true,
    order
  });
});

/**
 * Create new order
 * @route POST /api/v1/order/new
 * @access Private (User)
 */
export const createOrder = handleAsyncError(async (req, res, next) => {
  const {
    orderItems,
    shippingInfo,
    paymentInfo,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice
  } = req.body;

  if (!orderItems || orderItems.length === 0) {
    return next(new HandleError('No order items provided', 400));
  }

  const order = await Order.create({
    orderItems,
    shippingInfo,
    paymentInfo,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    user: req.user._id,
    paidAt: paymentInfo?.status === 'paid' ? Date.now() : null
  });

  await order.populate('orderItems.product', 'name images price');

  return res.status(201).json({
    success: true,
    message: 'Order created successfully',
    order
  });
});

// ============================================
// STATUS HISTORY & TIMELINE
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
// NOTES & COMMUNICATION
// ============================================

/**
 * Add a note to an order
 * @route POST /api/v1/orders/:id/notes
 * @access Private (User for customer notes, Admin for all)
 */
export const addOrderNote = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, type = 'customer' } = req.body;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (type === 'internal' && !isAdmin) {
    return next(new HandleError('Only admins can add internal notes', 403));
  }

  const note = {
    content,
    type,
    author: userId,
    createdAt: new Date()
  };

  if (!order.notes) {
    order.notes = [];
  }
  order.notes.push(note);

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

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  const notes = isAdmin 
    ? order.notes 
    : order.notes?.filter(note => note.type === 'customer') || [];

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
// TRACKING & SHIPMENT MANAGEMENT
// ============================================

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

  order.orderStatus = 'Shipped';
  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Tracking information added successfully',
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
    dimensions,
    createdAt: new Date()
  };

  if (!order.shipments) {
    order.shipments = [];
  }
  order.shipments.push(shipment);

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

  const shipment = order.shipments?.find(s => s.shipmentId === shipmentId);
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

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Shipment updated successfully',
    shipment
  });
});

// ============================================
// RETURN MANAGEMENT (RMA)
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
    itemsToReturn,
    requestedAt: new Date(),
    requestedBy: userId
  };

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Return request submitted successfully',
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
  const { action, restockFee = 0, adminNote = '' } = req.body;

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
    order.returnInfo.rmaNumber = `RMA-${Date.now()}`;
    if (adminNote) order.returnInfo.adminNote = adminNote;

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
    if (adminNote) order.returnInfo.adminNote = adminNote;

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
    
    for (const item of order.returnInfo.itemsToReturn) {
      const product = await Product.findById(item.product);
      if (product && item.condition !== 'damaged') {
        product.stock += item.quantity;
        await product.save({ validateBeforeSave: false });
      }
    }
  }

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
// INVOICE MANAGEMENT
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

  if (!isAdmin && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.invoiceInfo || !order.invoiceInfo.pdfUrl) {
    return res.status(200).json({
      success: false,
      message: 'Invoice not yet generated for this order',
      invoice: null
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
// FRAUD PREVENTION & REVIEW
// ============================================

/**
 * Get orders pending fraud review
 * @route GET /api/v1/admin/orders/fraud-review
 * @access Private (Admin only)
 */
export const getPendingFraudReviews = handleAsyncError(async (req, res, next) => {
  const orders = await Order.find({
    'fraudCheck.reviewRequired': true
  })
    .populate('user', 'name email')
    .sort({ createdAt: -1 });

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
  const { decision } = req.body;

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
    order.orderStatus = 'Cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'Fraud risk - order rejected';
  }

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: `Order ${decision}`,
    order
  });
});

// ============================================
// AUDIT LOG
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
    count: order.auditLog?.length || 0,
    auditLog: order.auditLog || []
  });
});

// ============================================
// ANALYTICS HELPERS
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

// ADD THESE TO order-controller.js

// ============================================
// ORDER MESSAGES (Customer ↔ Admin Chat)
// ============================================

/**
 * Add message to order
 * @route POST /api/v1/orders/:id/messages
 * @access Private (User or Admin)
 */
export const addOrderMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, attachments = [] } = req.body;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  const senderType = isAdmin ? 'admin' : 'customer';
  
  order.addOrderMessage(userId, senderType, content, attachments);

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    orderMessage: order.orderMessages[order.orderMessages.length - 1]
  });
});

/**
 * Get all messages for order
 * @route GET /api/v1/orders/:id/messages
 * @access Private (User or Admin)
 */
export const getOrderMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('orderMessages.sender', 'name email role')
    .select('orderMessages user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  const senderType = isAdmin ? 'admin' : 'customer';
  order.markOrderMessagesDelivered(senderType);
  order.markOrderMessagesAsRead(senderType);
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({
    success: true,
    count: order.orderMessages?.length || 0,
    messages: order.orderMessages || []
  });
});

/**
 * Mark messages as read
 * @route PUT /api/v1/orders/:id/messages/read
 * @access Private (User or Admin)
 */
export const markOrderMessagesRead = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  const senderType = isAdmin ? 'admin' : 'customer';
  order.markOrderMessagesAsRead(senderType);
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({
    success: true,
    message: 'Messages marked as read'
  });
});

/**
 * Get orders with unread messages (Admin)
 * @route GET /api/v1/admin/orders/unread-messages
 * @access Private (Admin only)
 */
export const getOrdersWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getOrdersWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count: orders.length,
    orders: orders.map(order => ({
      _id: order._id,
      user: order.user,
      orderStatus: order.orderStatus,
      unreadCount: order.unreadOrderMessages,
      latestMessage: order.latestOrderMessage
    }))
  });
});

// UPDATE YOUR EXPORTS at the bottom of order-controller.js:
export {
  getAllMyOrders,
  getOrderDetails,
  createOrder,
  getOrderTimeline,
  addOrderNote,
  getOrderNotes,
  editOrderNote,
  addTrackingInfo,
  getTrackingInfo,
  createShipment,
  updateShipmentStatus,
  requestReturn,
  reviewReturnRequest,
  updateReturnStatus,
  getAllReturns,
  downloadInvoice,
  getPendingFraudReviews,
  reviewFraudCheck,
  getAuditLog,
  getCustomerOrderAnalytics,
  addOrderMessage,
  getOrderMessages,
  markOrderMessagesRead,
  getOrdersWithUnreadMessages
};