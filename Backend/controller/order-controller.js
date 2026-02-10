import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import User from '../models/userModel.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';
import generateInvoicePDF from '../utils/generateInvoicePDF.js';
import fs from 'fs';
import path from 'path';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';

// ============================================
// ANALYTICS HELPER FUNCTIONS
// ============================================

/**
 * Extract analytics data from request
 */
const extractAnalyticsData = (req) => {
  const userAgent = req.get('user-agent') || '';
  const referrer = req.get('referer') || req.get('referrer') || '';
  
  // Parse user agent for device/browser
  const isMobile = /mobile/i.test(userAgent);
  const isTablet = /tablet|ipad/i.test(userAgent);
  const device = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
  
  // Extract browser
  let browser = 'unknown';
  if (/chrome/i.test(userAgent)) browser = 'Chrome';
  else if (/safari/i.test(userAgent)) browser = 'Safari';
  else if (/firefox/i.test(userAgent)) browser = 'Firefox';
  else if (/edge/i.test(userAgent)) browser = 'Edge';
  
  return {
    device,
    browser,
    referrer: referrer || null,
    userAgent: userAgent.substring(0, 200) // Truncate
  };
};

/**
 * Parse UTM parameters from query or body
 */
const parseUTMParams = (data) => {
  return {
    source: data.utm_source || data.source || 'direct',
    medium: data.utm_medium || data.medium || null,
    campaign: data.utm_campaign || data.campaign || null,
    term: data.utm_term || null,
    content: data.utm_content || null
  };
};

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

export const createOrder = handleAsyncError(async (req, res, next) => {
  const {
    orderItems,
    shippingInfo,
    paymentInfo,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    analytics: clientAnalytics // Analytics from frontend
  } = req.body;

  if (!orderItems || orderItems.length === 0) {
    return next(new HandleError('No order items provided', 400));
  }

  // Extract server-side analytics
  const serverAnalytics = extractAnalyticsData(req);
  
  // Parse UTM parameters from client or query
  const utmParams = clientAnalytics 
    ? parseUTMParams(clientAnalytics)
    : parseUTMParams(req.query);

  // Merge analytics data
  const fullAnalytics = {
    // UTM tracking
    source: utmParams.source,
    medium: utmParams.medium,
    campaign: utmParams.campaign,
    term: utmParams.term,
    content: utmParams.content,
    
    // Device & browser
    device: clientAnalytics?.device || serverAnalytics.device,
    browser: clientAnalytics?.browser || serverAnalytics.browser,
    
    // Referrer & landing page
    referrer: clientAnalytics?.referrer || serverAnalytics.referrer,
    landingPage: clientAnalytics?.landingPage || null,
    
    // Session tracking
    sessionId: clientAnalytics?.sessionId || null,
    
    // First purchase flag (will be calculated in customer analytics)
    isFirstPurchase: clientAnalytics?.isFirstPurchase || false,
    
    // Timestamp
    capturedAt: new Date()
  };

  // Create order with complete analytics
  const order = await Order.create({
    orderItems,
    shippingInfo,
    paymentInfo,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    user: req.user._id,
    paidAt: paymentInfo?.status === 'paid' ? Date.now() : null,
    analytics: fullAnalytics
  });

  await order.populate('orderItems.product', 'name images price');

  // Sync customer analytics after successful order creation
  if (paymentInfo?.status === 'success' || paymentInfo?.status === 'paid') {
    try {
      await syncCustomerAfterOrder(order._id);
      console.log(`Customer analytics synced for user ${req.user._id} after order ${order._id}`);
    } catch (error) {
      console.error('Failed to sync customer analytics:', error);
    }
  }

  return res.status(201).json({
    success: true,
    message: 'Order created successfully',
    order
  });
});



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

  if (order.paymentInfo?.status !== 'success') {
    return res.status(400).json({
      success: false,
      message: 'Invoice can only be generated for paid orders'
    });
  }

  try {
    let pdfBuffer;

    if (order.invoiceInfo?.pdfData) {
      pdfBuffer = Buffer.from(order.invoiceInfo.pdfData, 'base64');
      console.log('Serving existing invoice from database');
    } else {
      console.log('Generating new invoice');
      
      const companyInfo = {
        name: process.env.COMPANY_NAME || 'EPIC STORE Inc.',
        address: process.env.COMPANY_ADDRESS || '123 Commerce Street',
        city: process.env.COMPANY_CITY || 'New York, NY 10001',
        country: process.env.COMPANY_COUNTRY || 'United States',
        taxId: process.env.COMPANY_TAX_ID || 'XX-XXXXXXX'
      };

      pdfBuffer = await generateInvoicePDF(order, companyInfo);
      const base64PDF = pdfBuffer.toString('base64');

      if (!order.invoiceInfo) {
        order.invoiceInfo = {};
      }
      
      order.invoiceInfo.pdfData = base64PDF;
      order.invoiceInfo.invoiceDate = new Date();
      order.invoiceInfo.generatedAt = new Date();
      
      await order.save({ validateBeforeSave: false });
    }

    const invoiceNumber = order.invoiceInfo?.invoiceNumber || order._id;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Invoice-${invoiceNumber}.pdf`
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);

  } catch (error) {
    console.error('Invoice generation error:', error);
    return next(new HandleError('Failed to generate invoice', 500));
  }
});

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

export const getAllOrders = handleAsyncError(async (req, res, next) => {
  const { status, page = 1, limit = 20, from, to } = req.query;

  const query = {};

  if (status && status !== 'all') {
    query.orderStatus = status;
  }

  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const orders = await Order.find(query)
    .populate('user', 'name email phone')
    .populate('orderItems.product', 'name images price')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const totalOrders = await Order.countDocuments(query);

  const stats = {
    total: totalOrders,
    processing: await Order.countDocuments({ orderStatus: 'Processing' }),
    shipped: await Order.countDocuments({ orderStatus: 'Shipped' }),
    delivered: await Order.countDocuments({ orderStatus: 'Delivered' }),
    cancelled: await Order.countDocuments({ orderStatus: 'Cancelled' }),
  };

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalOrders,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalOrders / parseInt(limit)),
    stats,
    orders
  });
});

export const getSingleOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('user', 'name email phone')
    .populate('orderItems.product', 'name images price stock')
    .populate('statusHistory.updatedBy', 'name email')
    .populate('notes.createdBy', 'name email role')
    .populate('refundInfo.requestedBy', 'name email')
    .populate('refundInfo.approvedBy', 'name email')
    .populate('returnInfo.requestedBy', 'name email')
    .populate('returnInfo.approvedBy', 'name email');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  return res.status(200).json({
    success: true,
    order
  });
});

export const updateOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { status, note } = req.body;

  if (!status) {
    return next(new HandleError('Order status is required', 400));
  }

  const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid order status', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.orderStatus === 'Cancelled' && status !== 'Cancelled') {
    return next(new HandleError('Cannot update a cancelled order', 400));
  }

  const oldStatus = order.orderStatus;
  order.orderStatus = status;

  if (status === 'Delivered' && !order.deliveredAt) {
    order.deliveredAt = new Date();
  }

  order.addStatusHistory(status, req.user._id, note || `Status updated from ${oldStatus} to ${status}`);
  order.addAuditEntry('status_updated', req.user._id, { oldStatus, newStatus: status, note });

  if (status === 'Delivered' && oldStatus !== 'Delivered') {
    for (const item of order.orderItems) {
      const product = await Product.findById(item.product);
      if (product) {
        if (product.inventory?.stock !== undefined) {
          product.inventory.stock -= item.quantity;
        } else {
          product.stock -= item.quantity;
        }
        await product.save({ validateBeforeSave: false });
      }
    }

    try {
      await syncCustomerAfterOrder(order._id);
      console.log(`Customer analytics synced after delivery of order ${order._id}`);
    } catch (error) {
      console.error('Failed to sync customer analytics on delivery:', error);
    }
  }

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    order
  });
});

export const deleteOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.orderStatus === 'Delivered') {
    return next(new HandleError('Cannot delete delivered orders', 400));
  }

  if (order.refundInfo && order.refundInfo.status === 'completed') {
    return next(new HandleError('Cannot delete orders with completed refunds', 400));
  }

  await order.deleteOne();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: 'Order deleted successfully'
  });
});

export const addAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, type = 'admin' } = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  const note = {
    content: content.trim(),
    type,
    createdBy: req.user._id,
    createdAt: new Date(),
    attachments: []
  };

  if (req.files && req.files.length > 0) {
    note.attachments = req.files.map(file => ({
      url: `/uploads/orders/${order._id}/${file.filename}`,
      filename: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size
    }));
  }

  order.notes.push(note);
  order.addAuditEntry('note_added', req.user._id, { noteType: type });

  await order.save();

  const populatedOrder = await Order.findById(id).populate('notes.createdBy', 'name email role');
  const addedNote = populatedOrder.notes[populatedOrder.notes.length - 1];

  return res.status(200).json({
    success: true,
    message: 'Note added successfully',
    note: addedNote
  });
});

export const getAdminOrderNotes = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('notes.createdBy', 'name email role')
    .select('notes');

  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  return res.status(200).json({
    success: true,
    count: order.notes.length,
    notes: order.notes
  });
});

export const editAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;
  const { content } = req.body;

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

  if (note.createdBy.toString() !== req.user._id.toString()) {
    return next(new HandleError('You can only edit your own notes', 403));
  }

  note.content = content.trim();
  note.editedAt = new Date();
  note.isEdited = true;

  await order.save();

  const populatedOrder = await Order.findById(id).populate('notes.createdBy', 'name email role');
  const updatedNote = populatedOrder.notes.id(noteId);

  return res.status(200).json({
    success: true,
    message: 'Note updated successfully',
    note: updatedNote
  });
});

export const deleteAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  const note = order.notes.id(noteId);
  if (!note) {
    return next(new HandleError('Note not found', 404));
  }

  if (note.createdBy.toString() !== req.user._id.toString()) {
    return next(new HandleError('You can only delete your own notes', 403));
  }

  note.deleteOne();
  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Note deleted successfully'
  });
});

export const getAdminStats = handleAsyncError(async (req, res, next) => {
  const totalOrders = await Order.countDocuments();
  
  const revenueResult = await Order.aggregate([
    { $match: { orderStatus: 'Delivered' } },
    { $group: { _id: null, total: { $sum: '$amountPaid' } } }
  ]);
  const totalRevenue = revenueResult[0]?.total || 0;

  const orderStatusBreakdown = {
    processing: await Order.countDocuments({ orderStatus: 'Processing' }),
    shipped: await Order.countDocuments({ orderStatus: 'Shipped' }),
    delivered: await Order.countDocuments({ orderStatus: 'Delivered' }),
    cancelled: await Order.countDocuments({ orderStatus: 'Cancelled' })
  };

  const totalProducts = await Product.countDocuments();
  const outOfStock = await Product.countDocuments({ stock: 0 });
  const inStock = await Product.countDocuments({ stock: { $gt: 0 } });

  const totalUsers = await User.countDocuments();
  const adminCount = await User.countDocuments({ role: 'admin' });

  const recentOrders = await Order.find()
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(5)
    .select('_id orderStatus totalPrice createdAt user');

  const pendingRefunds = await Order.countDocuments({ 'refundInfo.status': 'requested' });
  const pendingReturns = await Order.countDocuments({ 'returnInfo.status': 'requested' });
  const fraudReviews = await Order.countDocuments({ requiresFraudReview: true });

  return res.status(200).json({
    success: true,
    stats: {
      orders: totalOrders,
      revenue: totalRevenue,
      products: totalProducts,
      users: totalUsers,
      outOfStock,
      inStock,
      adminCount,
      orderStatusBreakdown,
      pendingRefunds,
      pendingReturns,
      fraudReviews
    },
    recentOrders
  });
});

export const getAdminAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = 'month' } = req.query;

  const now = new Date();
  let currentPeriodStart, previousPeriodStart, previousPeriodEnd;

  switch (timeframe) {
    case 'week':
      currentPeriodStart = new Date(now.setDate(now.getDate() - 7));
      previousPeriodStart = new Date(now.setDate(now.getDate() - 14));
      previousPeriodEnd = currentPeriodStart;
      break;
    case 'year':
      currentPeriodStart = new Date(now.setFullYear(now.getFullYear() - 1));
      previousPeriodStart = new Date(now.setFullYear(now.getFullYear() - 2));
      previousPeriodEnd = currentPeriodStart;
      break;
    case 'month':
    default:
      currentPeriodStart = new Date(now.setMonth(now.getMonth() - 1));
      previousPeriodStart = new Date(now.setMonth(now.getMonth() - 2));
      previousPeriodEnd = currentPeriodStart;
  }

  const currentOrders = await Order.countDocuments({
    createdAt: { $gte: currentPeriodStart }
  });

  const currentRevenueResult = await Order.aggregate([
    { 
      $match: { 
        orderStatus: 'Delivered',
        createdAt: { $gte: currentPeriodStart }
      } 
    },
    { $group: { _id: null, total: { $sum: '$amountPaid' } } }
  ]);
  const currentRevenue = currentRevenueResult[0]?.total || 0;

  const previousOrders = await Order.countDocuments({
    createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
  });

  const previousRevenueResult = await Order.aggregate([
    { 
      $match: { 
        orderStatus: 'Delivered',
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
      } 
    },
    { $group: { _id: null, total: { $sum: '$amountPaid' } } }
  ]);
  const previousRevenue = previousRevenueResult[0]?.total || 0;

  const ordersTrend = previousOrders > 0 
    ? ((currentOrders - previousOrders) / previousOrders * 100).toFixed(2)
    : 100;
  
  const revenueTrend = previousRevenue > 0
    ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(2)
    : 100;

  const topProducts = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    { $unwind: '$orderItems' },
    { 
      $group: {
        _id: '$orderItems.product',
        totalQuantity: { $sum: '$orderItems.quantity' },
        totalRevenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } }
      }
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 }
  ]);

  const populatedTopProducts = await Promise.all(
    topProducts.map(async (item) => {
      const product = await Product.findById(item._id).select('name images');
      return {
        product,
        totalQuantity: item.totalQuantity,
        totalRevenue: item.totalRevenue
      };
    })
  );

  return res.status(200).json({
    success: true,
    timeframe,
    currentPeriod: {
      orders: currentOrders,
      revenue: currentRevenue
    },
    previousPeriod: {
      orders: previousOrders,
      revenue: previousRevenue
    },
    trends: {
      orders: parseFloat(ordersTrend),
      revenue: parseFloat(revenueTrend)
    },
    topProducts: populatedTopProducts
  });
});

export const cancelOrderWithRefund = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, skipRefund = false } = req.body;

  if (!reason) {
    return next(new HandleError('Cancellation reason is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) {
    return next(new HandleError('Order not found', 404));
  }

  if (order.orderStatus === 'Delivered') {
    return next(new HandleError('Cannot cancel delivered orders. Use refund process instead.', 400));
  }

  if (order.orderStatus === 'Cancelled') {
    return next(new HandleError('Order is already cancelled', 400));
  }

  order.orderStatus = 'Cancelled';
  order.cancelledAt = new Date();
  order.cancelledBy = req.user._id;
  order.cancellationReason = reason;

  order.addStatusHistory('Cancelled', req.user._id, reason);
  order.addAuditEntry('order_cancelled', req.user._id, { reason, skipRefund });

  if (!skipRefund && order.paymentInfo.status === 'success' && order.amountPaid > 0) {
    order.refundInfo = {
      status: 'requested',
      reason: 'Order Cancellation',
      description: `Order cancelled by admin. Reason: ${reason}`,
      refundType: 'full',
      requestedAmount: order.amountPaid,
      requestedAt: new Date(),
      requestedBy: req.user._id,
      messages: [],
      documents: [],
      timeline: []
    };

    order.addRefundTimeline(
      'refund_requested',
      'Automatic refund initiated due to order cancellation',
      req.user._id,
      { refundType: 'full', requestedAmount: order.amountPaid }
    );

    order.refundInfo.status = 'approved';
    order.refundInfo.approvedAt = new Date();
    order.refundInfo.approvedBy = req.user._id;
    order.refundInfo.adminNote = 'Auto-approved due to admin order cancellation';

    order.addRefundTimeline('refund_approved', 'Refund auto-approved', req.user._id);
  }

  await order.save();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({
    success: true,
    message: skipRefund 
      ? 'Order cancelled successfully' 
      : 'Order cancelled and refund initiated successfully',
    order: {
      _id: order._id,
      orderStatus: order.orderStatus,
      cancelledAt: order.cancelledAt,
      cancellationReason: order.cancellationReason,
      refundInfo: order.refundInfo
    }
  });
});

export const getOrderByReference = handleAsyncError(async (req, res, next) => {
  const { reference } = req.params;
  const userId = req.user._id;

  if (!reference) {
    return next(new HandleError('Reference number is required', 400));
  }

  let order = await Order.findOne({
    'paymentInfo.reference': reference
  }).populate('user', 'name email');

  if (!order && reference.match(/^[0-9a-fA-F]{24}$/)) {
    order = await Order.findById(reference).populate('user', 'name email');
  }

  if (!order) {
    return next(new HandleError('Order not found with this reference', 404));
  }

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized to view this order', 403));
  }

  return res.status(200).json({
    success: true,
    order
  });
});