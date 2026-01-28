// return-controller.js - NEW FILE

import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// RETURN MANAGEMENT - COMPLETE CONTROLLERS
// ============================================

/**
 * Get all return requests (Admin)
 * @route GET /api/v1/admin/returns
 * @access Private (Admin only)
 */
export const getAllReturns = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const query = {
    'returnInfo.status': { 
      $nin: ['none'] 
    }
  };

  if (status) {
    query['returnInfo.status'] = status;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('returnInfo.requestedBy', 'name email')
    .populate('returnInfo.approvedBy', 'name email')
    .populate('returnInfo.inspectedBy', 'name email')
    .populate('returnInfo.messages.sender', 'name email')
    .sort({ 'returnInfo.requestedAt': -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const totalReturns = await Order.countDocuments(query);

  const stats = {
    total: totalReturns,
    requested: await Order.countDocuments({ 'returnInfo.status': 'requested' }),
    approved: await Order.countDocuments({ 'returnInfo.status': 'approved' }),
    in_transit: await Order.countDocuments({ 'returnInfo.status': 'in_transit' }),
    received: await Order.countDocuments({ 'returnInfo.status': 'received' }),
    inspected: await Order.countDocuments({ 'returnInfo.status': 'inspected' }),
    completed: await Order.countDocuments({ 'returnInfo.status': 'completed' }),
    rejected: await Order.countDocuments({ 'returnInfo.status': 'rejected' }),
  };

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalReturns,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalReturns / parseInt(limit)),
    stats,
    returns: orders.map(order => ({
      orderId: order._id,
      user: order.user,
      returnInfo: order.returnInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      unreadMessages: order.unreadReturnMessages,
      createdAt: order.createdAt
    }))
  });
});

/**
 * Get single return details
 * @route GET /api/v1/admin/returns/:id
 * @access Private (Admin only)
 */
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

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found for this order', 404));
  }

  // Mark admin messages as read
  order.markReturnMessagesAsRead('admin');
  await order.save({ validateBeforeSave: false });

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
      deliveredAt: order.deliveredAt
    }
  });
});

/**
 * Customer requests return
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
    requestedBy: userId,
    messages: [],
    timeline: [],
    documents: []
  };

  order.addReturnTimeline('return_requested', `Return requested: ${reason}`, userId);
  order.addStatusHistory('Return Requested', userId, reason);
  order.addAuditEntry('return_requested', userId, { reason, itemsCount: itemsToReturn.length });

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

    order.addReturnTimeline('return_approved', 'Return approved by admin', req.user._id);
    order.addAuditEntry('return_approved', req.user._id, { rmaNumber: order.returnInfo.rmaNumber });

    await order.save();
    await deleteCachePattern('admin_stats*');

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

    order.addReturnTimeline('return_rejected', 'Return rejected by admin', req.user._id, { reason: adminNote });
    order.addAuditEntry('return_rejected', req.user._id, { adminNote });

    await order.save();
    await deleteCachePattern('admin_stats*');

    return res.status(200).json({
      success: true,
      message: 'Return request rejected',
      returnInfo: order.returnInfo
    });
  }
});

/**
 * Update return status
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
    order.addReturnTimeline('return_received', 'Return package received', req.user._id);
  }

  if (status === 'inspected') {
    order.returnInfo.inspectedAt = new Date();
    order.returnInfo.inspectedBy = req.user._id;
    if (inspectionNotes) {
      order.returnInfo.inspectionNotes = inspectionNotes;
    }
    order.addReturnTimeline('return_inspected', 'Return inspected', req.user._id, { inspectionNotes });
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
    
    order.addReturnTimeline('return_completed', 'Return process completed', req.user._id);
  }

  order.addAuditEntry('return_status_updated', req.user._id, { status });
  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: `Return status updated to ${status}`,
    returnInfo: order.returnInfo
  });
});

/**
 * Add message to return conversation (Admin)
 * @route POST /api/v1/admin/returns/:id/messages
 * @access Private (Admin only)
 */
export const addReturnMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, attachments = [] } = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  order.addReturnMessage(req.user._id, 'admin', content, attachments);

  await order.save();

  const newMessage = order.returnInfo.messages[order.returnInfo.messages.length - 1];

  return res.status(200).json({
    success: true,
    message: 'Message sent successfully',
    data: {
      orderId: order._id,
      message: newMessage
    }
  });
});

/**
 * Customer adds message to return conversation
 * @route POST /api/v1/orders/:id/return/messages
 * @access Private (User who owns the order)
 */
export const addCustomerReturnMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, attachments = [] } = req.body;
  const userId = req.user._id;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

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
    data: {
      orderId: order._id,
      message: newMessage
    }
  });
});

/**
 * Get return messages/conversation
 * @route GET /api/v1/orders/:id/return/messages
 * @access Private (User or Admin)
 */
export const getReturnMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.messages.sender', 'name email role')
    .select('returnInfo.messages user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || !order.returnInfo.messages) {
    return res.status(200).json({
      success: true,
      count: 0,
      messages: []
    });
  }

  const senderType = isAdmin ? 'admin' : 'customer';
  order.markReturnMessagesDelivered(senderType);
  order.markReturnMessagesAsRead(senderType);
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({
    success: true,
    count: order.returnInfo.messages.length,
    messages: order.returnInfo.messages
  });
});

/**
 * Get return timeline
 * @route GET /api/v1/orders/:id/return/timeline
 * @access Private (User or Admin)
 */
export const getReturnTimeline = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.timeline.performedBy', 'name email role')
    .select('returnInfo.timeline user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || !order.returnInfo.timeline) {
    return res.status(200).json({
      success: true,
      count: 0,
      timeline: []
    });
  }

  return res.status(200).json({
    success: true,
    count: order.returnInfo.timeline.length,
    timeline: order.returnInfo.timeline
  });
});

/**
 * Get return documents
 * @route GET /api/v1/orders/:id/return/documents
 * @access Private (User or Admin)
 */
export const getReturnDocuments = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.documents.uploadedBy', 'name email role')
    .select('returnInfo.documents user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || !order.returnInfo.documents) {
    return res.status(200).json({
      success: true,
      count: 0,
      documents: []
    });
  }

  return res.status(200).json({
    success: true,
    count: order.returnInfo.documents.length,
    documents: order.returnInfo.documents
  });
});

/**
 * Upload files for return (Admin)
 * @route POST /api/v1/admin/returns/:id/upload
 * @access Private (Admin only)
 */
export const uploadReturnFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  const uploadedFiles = [];
  
  for (const file of req.files) {
    const fileUrl = `/uploads/returns/${order._id}/${file.filename}`;
    
    order.addReturnDocument(
      'other',
      fileUrl,
      file.originalname,
      req.user._id,
      ''
    );

    uploadedFiles.push({
      url: fileUrl,
      filename: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size
    });
  }

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles
  });
});

/**
 * Customer uploads files for return
 * @route POST /api/v1/orders/:id/return/upload
 * @access Private (User who owns the order)
 */
export const uploadCustomerReturnFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  const uploadedFiles = [];
  
  for (const file of req.files) {
    const fileUrl = `/uploads/returns/${order._id}/${file.filename}`;
    
    order.addReturnDocument(
      'photo',
      fileUrl,
      file.originalname,
      userId,
      ''
    );

    uploadedFiles.push({
      url: fileUrl,
      filename: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size
    });
  }

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles
  });
});

/**
 * Get returns with unread messages (Admin)
 * @route GET /api/v1/admin/returns/unread
 * @access Private (Admin only)
 */
export const getReturnsWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getReturnsWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count: orders.length,
    returns: orders.map(order => ({
      _id: order._id,
      user: order.user,
      returnInfo: {
        status: order.returnInfo.status,
        rmaNumber: order.returnInfo.rmaNumber,
        reason: order.returnInfo.reason,
        unreadCount: order.unreadReturnMessages
      },
      latestMessage: order.latestReturnMessage
    }))
  });
});

/**
 * Cancel return request (Customer only, before approval)
 * @route PUT /api/v1/orders/:id/return/cancel
 * @access Private (User who owns the order)
 */
export const cancelReturnRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 404));
  }

  if (order.returnInfo.status !== 'requested') {
    return next(new HandleError('Cannot cancel return at this stage', 400));
  }

  order.returnInfo.status = 'none';
  order.addReturnTimeline('return_cancelled', 'Return cancelled by customer', userId);
  order.addAuditEntry('return_cancelled', userId);

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Return request cancelled successfully'
  });
});