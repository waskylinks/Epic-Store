import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';
import { uploadToCloudinary } from '../utils/cloudinaryUpload.js';

// ============================================
// SHARED CACHE INVALIDATION
// Fire-and-forget — never blocks responses.
// ============================================

const invalidateReturnCaches = () => {
  Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('return_overview*'),
    deleteCachePattern('returns_by_product*'),
    deleteCachePattern('returns_by_category*')
  ]).catch(() => {
    // Cache invalidation failure must never affect the primary response
  });
};

// ============================================
// GET ALL RETURN REQUESTS (Admin)
// ============================================

export const getAllReturns = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const query = { 'returnInfo.status': { $nin: ['none'] } };
  if (status) query['returnInfo.status'] = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // FIX: List view populate trimmed to fields needed for table rows only.
  // Heavy nested populate (messages.sender etc.) moved to getSingleReturn.
  // .lean() skips Mongoose document hydration for a faster read.
  const [orders, totalReturns, statCounts] = await Promise.all([
    Order.find(query)
      .populate('user', 'name email')
      .populate('returnInfo.requestedBy', 'name email')
      .select('-returnInfo.messages -returnInfo.documents -returnInfo.timeline -auditLog -orderMessages')
      .sort({ 'returnInfo.requestedAt': -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),

    Order.countDocuments(query),

    Promise.all([
      Order.countDocuments({ 'returnInfo.status': 'requested' }),
      Order.countDocuments({ 'returnInfo.status': 'approved' }),
      Order.countDocuments({ 'returnInfo.status': 'in_transit' }),
      Order.countDocuments({ 'returnInfo.status': 'received' }),
      Order.countDocuments({ 'returnInfo.status': 'inspected' }),
      Order.countDocuments({ 'returnInfo.status': 'completed' }),
      Order.countDocuments({ 'returnInfo.status': 'rejected' }),
      Order.countDocuments({ 'returnInfo.status': 'cancelled' }),
    ]),
  ]);

  const [requested, approved, in_transit, received, inspected, completed, rejected, cancelled] = statCounts;

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalReturns,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalReturns / parseInt(limit)),
    stats: { total: totalReturns, requested, approved, in_transit, received, inspected, completed, rejected, cancelled },
    returns: orders.map(order => ({
      orderId: order._id,
      user: order.user,
      returnInfo: order.returnInfo,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      // FIX: .lean() disables virtuals so compute unread count inline.
      unreadMessages: (order.returnInfo?.messages || []).filter(
        m => !m.isRead && m.senderType === 'customer'
      ).length,
      createdAt: order.createdAt
    }))
  });
});

// ============================================
// GET SINGLE RETURN (Admin)
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

  // FIX: Use model method (consistent with refund controller) instead of raw updateOne.
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

// ============================================
// CUSTOMER REQUESTS RETURN
// ============================================

export const requestReturn = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, description, items, attachments = [] } = req.body;
  const userId = req.user._id;

  if (!reason || !description || !items || items.length === 0) {
    return next(new HandleError('Reason, description, and items to return are required', 400));
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
    documents: []
  };

  order.addReturnTimeline('return_requested', `Return requested: ${reason}`, userId);
  order.addStatusHistory('Return Requested', userId, reason);
  order.addAuditEntry('return_requested', userId, { reason, description, itemsCount: items.length });

  await order.save();
  invalidateReturnCaches();

  return res.status(200).json({
    success: true,
    message: 'Return request submitted successfully',
    returnInfo: order.returnInfo
  });
});

// ============================================
// ADMIN APPROVES / REJECTS RETURN
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
    order.addAuditEntry('return_approved', req.user._id, { rmaNumber: order.returnInfo.rmaNumber });

    await order.save();
    invalidateReturnCaches();

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
    invalidateReturnCaches();

    return res.status(200).json({
      success: true,
      message: 'Return request rejected',
      returnInfo: order.returnInfo
    });
  }
});

// ============================================
// UPDATE RETURN STATUS
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
    order.addReturnTimeline('return_inspected', 'Return inspected', req.user._id, { inspectionNotes });
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();

    const stockUpdates = order.returnInfo.itemsToReturn
      .filter(item => item.condition !== 'damaged')
      .map(async (item) => {
        const product = await Product.findById(item.product);
        if (!product) return;

        if (product.inventory?.stock !== undefined) {
          product.inventory.stock += item.quantity;
        } else {
          product.stock += item.quantity;
        }
        await product.save({ validateBeforeSave: false });
      });

    await Promise.all(stockUpdates);
    order.addReturnTimeline('return_completed', 'Return process completed', req.user._id);
  }

  order.addAuditEntry('return_status_updated', req.user._id, { status });
  await order.save();
  invalidateReturnCaches();

  return res.status(200).json({
    success: true,
    message: `Return status updated to ${status}`,
    returnInfo: order.returnInfo
  });
});

// ============================================
// ADD MESSAGE TO RETURN (Admin)
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
    data: { orderId: order._id, message: newMessage }
  });
});

// ============================================
// ADD MESSAGE TO RETURN (Customer)
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
    data: { orderId: order._id, message: newMessage }
  });
});

// ============================================
// GET RETURN MESSAGES
// ============================================

export const getReturnMessages = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('returnInfo.messages.sender', 'name email role')
    .select('returnInfo user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.returnInfo?.messages) {
    return res.status(200).json({ success: true, count: 0, messages: [] });
  }

  // FIX: Replaced raw updateOne+arrayFilters with the model's markReturnMessagesAsRead
  // method for consistency with how refund and order message read-receipts work.
  // Admin reading → mark customer messages read. Customer reading → mark admin messages read.
  const readerType = isAdmin ? 'customer' : 'admin';
  order.markReturnMessagesAsRead(readerType);
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({
    success: true,
    count: order.returnInfo.messages.length,
    messages: order.returnInfo.messages
  });
});

// ============================================
// GET RETURN TIMELINE
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
    timeline: order.returnInfo.timeline
  });
});

// ============================================
// GET RETURN DOCUMENTS
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
    documents: order.returnInfo.documents
  });
});

// ============================================
// UPLOAD FILES FOR RETURN (Admin)
// FIX: Replaced local disk storage with Cloudinary (consistent with refund controller).
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

  const uploadedFiles = [];
  const folder = `ecommerce/returns/${order._id}/admin`;

  for (const file of req.files) {
    const result = await uploadToCloudinary(file.buffer, {
      folder,
      resource_type: 'auto',
    });

    order.addReturnDocument('other', result.secure_url, file.originalname, req.user._id, '');

    uploadedFiles.push({
      url: result.secure_url,
      filename: file.originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    });
  }

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles
  });
});

// ============================================
// UPLOAD FILES FOR RETURN (Customer)
// FIX: Replaced local disk storage with Cloudinary (consistent with refund controller).
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

  const uploadedFiles = [];
  const folder = `ecommerce/returns/${order._id}/customer`;

  for (const file of req.files) {
    const result = await uploadToCloudinary(file.buffer, {
      folder,
      resource_type: 'auto',
    });

    const docType =
      result.resource_type === 'image' ? 'photo' :
      result.resource_type === 'video' ? 'video' :
      'document';

    order.addReturnDocument(docType, result.secure_url, file.originalname, userId, '');

    uploadedFiles.push({
      url: result.secure_url,
      filename: file.originalname,
      fileType: result.resource_type,
      fileSize: result.bytes,
    });
  }

  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles
  });
});

// ============================================
// GET RETURN STATUS (Customer)
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
      : { status: 'none', hasReturn: false }
  });
});

// ============================================
// GET RETURNS WITH UNREAD MESSAGES (Admin)
// ============================================

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
        unreadCount: order.unreadReturnMessages,
      },
      latestMessage: order.latestReturnMessage
    }))
  });
});

// ============================================
// CANCEL RETURN REQUEST (Customer)
// FIX: Changed status from 'none' → 'cancelled' so the record remains visible
// to admins in the returns list and audit history is preserved.
// The 'cancelled' value has been added to the returnInfo.status enum in the model.
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
    message: 'Return request cancelled successfully'
  });
});