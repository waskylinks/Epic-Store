import Order from '../models/order-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// REFUND MANAGEMENT - COMPLETE CONTROLLERS
// ============================================

/**
 * Get all refund requests (Admin)
 * @route GET /api/v1/admin/refunds
 * @access Private (Admin only)
 */
export const getAllRefunds = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const query = {
    'refundInfo.status': { 
      $nin: ['none'] 
    }
  };

  // Filter by specific status if provided
  if (status) {
    query['refundInfo.status'] = status;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('refundInfo.requestedBy', 'name email')
    .populate('refundInfo.approvedBy', 'name email')
    .populate('refundInfo.processedBy', 'name email')
    .populate('refundInfo.messages.sender', 'name email')
    .sort({ 'refundInfo.requestedAt': -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const totalRefunds = await Order.countDocuments(query);

  // Calculate stats
  const stats = {
    total: totalRefunds,
    requested: await Order.countDocuments({ 'refundInfo.status': 'requested' }),
    approved: await Order.countDocuments({ 'refundInfo.status': 'approved' }),
    processing: await Order.countDocuments({ 'refundInfo.status': 'processing' }),
    completed: await Order.countDocuments({ 'refundInfo.status': 'completed' }),
    rejected: await Order.countDocuments({ 'refundInfo.status': 'rejected' }),
    failed: await Order.countDocuments({ 'refundInfo.status': 'failed' }),
  };

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalRefunds,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalRefunds / parseInt(limit)),
    stats,
    orders: orders.map(order => ({
      _id: order._id,
      user: order.user,
      refundInfo: order.refundInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      amountPaid: order.amountPaid,
      refundableAmount: order.refundableAmount,
      paymentInfo: {
        method: order.paymentInfo.method,
        reference: order.paymentInfo.reference
      },
      unreadMessages: order.unreadRefundMessages,
      createdAt: order.createdAt
    }))
  });
});

/**
 * Get single refund details
 * @route GET /api/v1/admin/refunds/:id
 * @access Private (Admin only)
 */
export const getSingleRefund = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user', 'name email phone')
    .populate('refundInfo.requestedBy', 'name email')
    .populate('refundInfo.approvedBy', 'name email')
    .populate('refundInfo.rejectedBy', 'name email')
    .populate('refundInfo.processedBy', 'name email')
    .populate('refundInfo.messages.sender', 'name email role')
    .populate('refundInfo.documents.uploadedBy', 'name email')
    .populate('orderItems.product', 'name images');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found for this order', 404));
  }

  // Mark admin messages as read
  order.markRefundMessagesAsRead('admin');
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({
    success: true,
    order: {
      _id: order._id,
      user: order.user,
      orderItems: order.orderItems,
      shippingInfo: order.shippingInfo,
      paymentInfo: order.paymentInfo,
      refundInfo: order.refundInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      amountPaid: order.amountPaid,
      refundableAmount: order.refundableAmount,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt
    }
  });
});

/**
 * Customer requests refund
 * @route POST /api/v1/orders/:id/refund/request
 * @access Private (User who owns the order)
 */
export const requestRefund = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, description, refundType = 'full', requestedAmount } = req.body;
  const userId = req.user._id;

  if (!reason || !description) {
    return next(new HandleError('Reason and description are required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify ownership
  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  // Check if payment was successful
  if (order.paymentInfo.status !== 'success') {
    return next(new HandleError('Cannot refund unpaid order', 400));
  }

  // Check if already refunded or refund pending
  if (order.refundInfo && order.refundInfo.status !== 'none') {
    return next(new HandleError(`Refund already ${order.refundInfo.status}`, 400));
  }

  // Check refund deadline (30 days)
  if (order.daysUntilRefundDeadline <= 0) {
    return next(new HandleError('Refund period has expired (30 days from delivery/payment)', 400));
  }

  // Validate requested amount for partial refunds
  let refundAmount = order.amountPaid;
  if (refundType === 'partial') {
    if (!requestedAmount || requestedAmount <= 0 || requestedAmount > order.amountPaid) {
      return next(new HandleError('Invalid refund amount', 400));
    }
    refundAmount = requestedAmount;
  }

  // Initialize refund info
  order.refundInfo = {
    status: 'requested',
    reason,
    description,
    refundType,
    requestedAmount: refundAmount,
    requestedAt: new Date(),
    requestedBy: userId,
    messages: [],
    documents: [],
    timeline: []
  };

  // Add initial timeline event
  order.addRefundTimeline(
    'refund_requested',
    `Refund requested: ${reason}`,
    userId,
    { refundType, requestedAmount: refundAmount }
  );

  order.addStatusHistory('Refund Requested', userId, reason);
  order.addAuditEntry('refund_requested', userId, { 
    reason, 
    refundType, 
    requestedAmount: refundAmount 
  });

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Refund request submitted successfully. Our team will review your request.',
    refundInfo: order.refundInfo
  });
});

/**
 * Admin approves or rejects refund request
 * @route PUT /api/v1/admin/orders/:id/refund/review
 * @access Private (Admin only)
 */
export const reviewRefundRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { action, adminNote } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return next(new HandleError('Action must be approve or reject', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo.status !== 'requested') {
    return next(new HandleError('No pending refund request found', 400));
  }

  if (action === 'approve') {
    order.refundInfo.status = 'approved';
    order.refundInfo.approvedAt = new Date();
    order.refundInfo.approvedBy = req.user._id;
    if (adminNote) order.refundInfo.adminNote = adminNote;

    order.addRefundTimeline('refund_approved', 'Refund approved by admin', req.user._id);
    order.addAuditEntry('refund_approved', req.user._id, { adminNote });

    await order.save();
    await deleteCachePattern('admin_stats*');

    return res.status(200).json({
      success: true,
      message: 'Refund approved. Proceed to process payment.',
      order
    });
  } else {
    order.refundInfo.status = 'rejected';
    order.refundInfo.rejectedAt = new Date();
    order.refundInfo.rejectedBy = req.user._id;
    if (adminNote) order.refundInfo.adminNote = adminNote;

    order.addRefundTimeline('refund_rejected', 'Refund rejected by admin', req.user._id, { reason: adminNote });
    order.addAuditEntry('refund_rejected', req.user._id, { adminNote });

    await order.save();
    await deleteCachePattern('admin_stats*');

    return res.status(200).json({
      success: true,
      message: 'Refund request rejected',
      order
    });
  }
});

/**
 * Admin processes refund payment
 * @route POST /api/v1/admin/orders/:id/refund/process
 * @access Private (Admin only)
 */
export const processRefundPayment = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { refundAmount, merchantNote } = req.body;

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo.status !== 'approved') {
    return next(new HandleError('Refund must be approved before processing', 400));
  }

  // Validate refund amount
  const maxRefund = order.amountPaid - (order.refundInfo.refundAmount || 0);
  if (!refundAmount || refundAmount <= 0 || refundAmount > maxRefund) {
    return next(new HandleError(`Invalid refund amount. Maximum refundable: ${maxRefund}`, 400));
  }

  // Update status to processing
  order.refundInfo.status = 'processing';
  order.refundInfo.refundAmount = refundAmount;
  order.refundInfo.refundCurrency = order.paymentInfo.currency;
  order.refundInfo.processedAt = new Date();
  order.refundInfo.processedBy = req.user._id;
  if (merchantNote) order.refundInfo.adminNote = merchantNote;

  // Generate refund reference
  order.refundInfo.refundReference = `REF-${Date.now()}-${order._id.toString().slice(-6)}`;

  order.addRefundTimeline('refund_processing', 'Refund payment initiated', req.user._id, { refundAmount });

  // Here you would integrate with payment gateway to process actual refund
  // For now, we'll simulate it
  try {
    // PAYMENT GATEWAY INTEGRATION WOULD GO HERE
    // const gatewayResponse = await processPaymentGatewayRefund(order, refundAmount);
    
    // Simulate successful refund
    const gatewayResponse = {
      success: true,
      refundId: `rfnd_${Date.now()}`,
      amount: refundAmount,
      currency: order.paymentInfo.currency,
      status: 'succeeded'
    };

    order.refundInfo.status = 'completed';
    order.refundInfo.refundedAt = new Date();
    order.refundInfo.refundId = gatewayResponse.refundId;
    order.refundInfo.gatewayResponse = gatewayResponse;

    order.addRefundTimeline('refund_completed', 'Refund successfully processed', req.user._id, { 
      refundId: gatewayResponse.refundId,
      refundAmount 
    });
    order.addAuditEntry('refund_completed', req.user._id, { refundAmount });

  } catch (error) {
    order.refundInfo.status = 'failed';
    order.refundInfo.failureReason = error.message;

    order.addRefundTimeline('refund_failed', 'Refund processing failed', req.user._id, { 
      error: error.message 
    });

    await order.save();

    return next(new HandleError(`Refund processing failed: ${error.message}`, 500));
  }

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Refund processed successfully',
    order
  });
});

/**
 * Add message to refund conversation
 * @route POST /api/v1/admin/refunds/:id/messages
 * @access Private (Admin only)
 */
export const addRefundMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { message, attachments = [] } = req.body;

  if (!message || message.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  // Add message using instance method
  order.addRefundMessage(req.user._id, 'admin', message, attachments);

  await order.save();

  const newMessage = order.refundInfo.messages[order.refundInfo.messages.length - 1];

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
 * Customer adds message to refund conversation
 * @route POST /api/v1/orders/:id/refund/messages
 * @access Private (User who owns the order)
 */
export const addCustomerRefundMessage = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { message, attachments = [] } = req.body;
  const userId = req.user._id;

  if (!message || message.trim().length === 0) {
    return next(new HandleError('Message content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify ownership
  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  // Add message using instance method
  order.addRefundMessage(userId, 'customer', message, attachments);

  await order.save();

  const newMessage = order.refundInfo.messages[order.refundInfo.messages.length - 1];

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
 * Get refund messages/conversation
 * @route GET /api/v1/orders/:id/refund/messages
 * @access Private (User or Admin)
 */
export const getRefundMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.messages.sender', 'name email role')
    .select('refundInfo.messages user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || !order.refundInfo.messages) {
    return res.status(200).json({
      success: true,
      count: 0,
      messages: []
    });
  }

  // Mark messages as read
  const senderType = isAdmin ? 'admin' : 'customer';
  order.markRefundMessagesAsRead(senderType);
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({
    success: true,
    count: order.refundInfo.messages.length,
    messages: order.refundInfo.messages
  });
});

/**
 * Upload files/documents for refund
 * @route POST /api/v1/admin/refunds/:id/upload
 * @access Private (Admin only)
 */
export const uploadRefundFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  // Process uploaded files
  const uploadedFiles = [];
  
  for (const file of req.files) {
    // Here you would upload to cloud storage (S3, Cloudinary, etc.)
    // For now, we'll simulate it
    const fileUrl = `/uploads/refunds/${order._id}/${file.filename}`;
    
    order.addRefundDocument(
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
 * Customer uploads files/documents for refund
 * @route POST /api/v1/orders/:id/refund/upload
 * @access Private (User who owns the order)
 */
export const uploadCustomerRefundFiles = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!req.files || req.files.length === 0) {
    return next(new HandleError('No files uploaded', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify ownership
  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  // Process uploaded files
  const uploadedFiles = [];
  
  for (const file of req.files) {
    // Here you would upload to cloud storage (S3, Cloudinary, etc.)
    const fileUrl = `/uploads/refunds/${order._id}/${file.filename}`;
    
    order.addRefundDocument(
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
 * Get refund timeline/activity log
 * @route GET /api/v1/orders/:id/refund/timeline
 * @access Private (User or Admin)
 */
export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.timeline.performedBy', 'name email role')
    .select('refundInfo.timeline user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || !order.refundInfo.timeline) {
    return res.status(200).json({
      success: true,
      count: 0,
      timeline: []
    });
  }

  return res.status(200).json({
    success: true,
    count: order.refundInfo.timeline.length,
    timeline: order.refundInfo.timeline
  });
});

/**
 * Get refund documents/attachments
 * @route GET /api/v1/orders/:id/refund/documents
 * @access Private (User or Admin)
 */
export const getRefundDocuments = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('refundInfo.documents.uploadedBy', 'name email role')
    .select('refundInfo.documents user');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify access
  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || !order.refundInfo.documents) {
    return res.status(200).json({
      success: true,
      count: 0,
      documents: []
    });
  }

  return res.status(200).json({
    success: true,
    count: order.refundInfo.documents.length,
    documents: order.refundInfo.documents
  });
});

/**
 * Get orders with unread refund messages (Admin)
 * @route GET /api/v1/admin/refunds/unread
 * @access Private (Admin only)
 */
export const getRefundsWithUnreadMessages = handleAsyncError(async (req, res, next) => {
  const orders = await Order.getRefundsWithUnreadMessages();

  return res.status(200).json({
    success: true,
    count: orders.length,
    orders: orders.map(order => ({
      _id: order._id,
      user: order.user,
      refundInfo: {
        status: order.refundInfo.status,
        reason: order.refundInfo.reason,
        requestedAmount: order.refundInfo.requestedAmount,
        unreadCount: order.unreadRefundMessages
      },
      latestMessage: order.latestRefundMessage
    }))
  });
});

/**
 * Cancel refund request (Customer only, before admin review)
 * @route PUT /api/v1/orders/:id/refund/cancel
 * @access Private (User who owns the order)
 */
export const cancelRefundRequest = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  // Verify ownership
  if (order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.refundInfo || order.refundInfo.status === 'none') {
    return next(new HandleError('No refund request found', 404));
  }

  // Can only cancel if still in requested status
  if (order.refundInfo.status !== 'requested') {
    return next(new HandleError('Cannot cancel refund at this stage', 400));
  }

  order.refundInfo.status = 'none';
  order.addRefundTimeline('refund_cancelled', 'Refund cancelled by customer', userId);
  order.addAuditEntry('refund_cancelled', userId);

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Refund request cancelled successfully'
  });
});