import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import User from '../models/userModel.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';
import generateInvoicePDF from '../utils/generateInvoicePDF.js';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
// FIX OC1: Removed duplicate calculateFraudRisk and calculateFulfillmentSLA —
// both were copy-pasted from paymentController with the orderController copy missing
// 4 risk checks. Canonical versions now live in utils.
import { calculateFraudRisk } from '../utils/fraudCheck.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';

// ============================================
// ANALYTICS HELPER FUNCTIONS
// ============================================

const extractAnalyticsData = (req) => {
  const userAgent = req.get('user-agent') || '';
  const referrer = req.get('referer') || req.get('referrer') || '';

  const isMobile = /mobile/i.test(userAgent);
  const isTablet = /tablet|ipad/i.test(userAgent);
  const device = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  let browser = 'unknown';
  if (/chrome/i.test(userAgent)) browser = 'Chrome';
  else if (/safari/i.test(userAgent)) browser = 'Safari';
  else if (/firefox/i.test(userAgent)) browser = 'Firefox';
  else if (/edge/i.test(userAgent)) browser = 'Edge';

  return {
    device,
    browser,
    referrer: referrer || null,
    userAgent: userAgent.substring(0, 200)
  };
};

const parseUTMParams = (data) => ({
  source: data.utm_source || data.source || 'direct',
  medium: data.utm_medium || data.medium || null,
  campaign: data.utm_campaign || data.campaign || null,
  term: data.utm_term || null,
  content: data.utm_content || null
});

const updateProductAnalytics = async (orderItems) => {
  try {
    for (const item of orderItems) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { 'analytics.purchases': item.quantity } },
        { new: false }
      );
    }
  } catch {
    // Non-critical — analytics update failure must not abort an order
  }
};

// ============================================
// BASIC ORDER OPERATIONS
// ============================================

export const getAllMyOrders = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const orders = await Order.find({ user: userId })
    .populate('orderItems.product', 'name images price')
    .sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    count: orders.length,
    orders,
    message: orders.length === 0 ? 'No orders found' : undefined
  });
});

export const getOrderDetails = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('user', 'name email')
    .populate('orderItems.product', 'name images price');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({ success: true, order });
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
    analytics: clientAnalytics
  } = req.body;

  if (!orderItems || orderItems.length === 0) {
    return next(new HandleError('No order items provided', 400));
  }

  const serverAnalytics = extractAnalyticsData(req);
  const utmParams = clientAnalytics
    ? parseUTMParams(clientAnalytics)
    : parseUTMParams(req.query);

  const fullAnalytics = {
    source: utmParams.source,
    medium: utmParams.medium,
    campaign: utmParams.campaign,
    term: utmParams.term,
    content: utmParams.content,
    device: clientAnalytics?.device || serverAnalytics.device,
    browser: clientAnalytics?.browser || serverAnalytics.browser,
    referrer: clientAnalytics?.referrer || serverAnalytics.referrer,
    landingPage: clientAnalytics?.landingPage || null,
    sessionId: clientAnalytics?.sessionId || null,
    isFirstPurchase: clientAnalytics?.isFirstPurchase || false,
    capturedAt: new Date()
  };

  const user = await User.findById(req.user._id);

  // FIX OC1 (continued): calculateFraudRisk now takes { billingAddress } not { paymentInfo }
  const fraudCheck = calculateFraudRisk({
    totalPrice,
    shippingInfo,
    orderItems,
    billingAddress: paymentInfo?.billingAddress
  }, user);

  const orderDate = new Date();
  const fulfillmentSLA = calculateFulfillmentSLA(orderDate, 'Processing');

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
    analytics: fullAnalytics,
    fraudCheck,
    fulfillmentSLA
  });

  await order.populate('orderItems.product', 'name images price');

  await updateProductAnalytics(orderItems);

  // FIX OC2: Changed from blocking await to fire-and-forget.
  // Customer analytics sync is non-critical post-order work; blocking here
  // delays the order confirmation response by the full sync duration.
  if (paymentInfo?.status === 'success' || paymentInfo?.status === 'paid') {
    syncCustomerAfterOrder(order._id).catch(() => {});
  }

  await deleteCachePattern('admin_stats*');
  await deleteCachePattern('product_performance*');
  await deleteCachePattern('customer_analytics*');

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

  if (!order) return next(new HandleError('Order not found', 404));

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
  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (type === 'internal' && !isAdmin) {
    return next(new HandleError('Only admins can add internal notes', 403));
  }

  if (!order.notes) order.notes = [];
  order.notes.push({ content, type, author: userId, createdAt: new Date() });

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

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  const notes = isAdmin
    ? order.notes
    : order.notes?.filter(note => note.type === 'customer') || [];

  return res.status(200).json({ success: true, count: notes.length, notes });
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
  if (!order) return next(new HandleError('Order not found', 404));

  const note = order.notes.id(noteId);
  if (!note) return next(new HandleError('Note not found', 404));

  if (!isAdmin && note.author.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized to edit this note', 403));
  }

  note.content = content;
  note.isEdited = true;
  note.editedAt = new Date();

  await order.save();

  return res.status(200).json({ success: true, message: 'Note updated successfully', note });
});

export const getTrackingInfo = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id).select('tracking orderStatus user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  if (!order.tracking?.trackingNumber) {
    return res.status(200).json({
      success: true,
      message: 'No tracking information available yet',
      tracking: null
    });
  }

  return res.status(200).json({ success: true, tracking: order.tracking });
});

export const addTrackingInfo = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { carrier, trackingNumber, estimatedDelivery } = req.body;

  if (!carrier || !trackingNumber) {
    return next(new HandleError('Carrier and tracking number are required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const trackingUrls = {
    DHL: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
    UPS: `https://www.ups.com/track?tracknum=${trackingNumber}`,
    USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
  };

  order.tracking = {
    carrier,
    trackingNumber,
    trackingUrl: trackingUrls[carrier] || '',
    estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
    lastUpdated: new Date()
  };

  order.orderStatus = 'Shipped';
  order.fulfillmentSLA = calculateFulfillmentSLA(order.createdAt, 'Shipped');

  await order.save();
  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('fulfillment_analytics*'),
    deleteCachePattern('shipping_carriers*')
  ]);

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
  if (!order) return next(new HandleError('Order not found', 404));

  const shipment = {
    shipmentId: `SHP-${Date.now()}`,
    warehouse,
    items,
    carrier,
    status: 'pending',
    weight,
    dimensions,
    createdAt: new Date()
  };

  if (!order.shipments) order.shipments = [];
  order.shipments.push(shipment);

  await order.save();
  await deleteCachePattern('fulfillment_analytics*');

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
  if (!order) return next(new HandleError('Order not found', 404));

  const shipment = order.shipments?.find(s => s.shipmentId === shipmentId);
  if (!shipment) return next(new HandleError('Shipment not found', 404));

  shipment.status = status;
  if (trackingNumber) shipment.trackingNumber = trackingNumber;
  if (status === 'shipped') shipment.shippedAt = new Date();
  if (status === 'delivered') shipment.deliveredAt = new Date();

  await order.save();
  await Promise.all([
    deleteCachePattern('fulfillment_analytics*'),
    deleteCachePattern('shipping_carriers*')
  ]);

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
  if (!order) return next(new HandleError('Order not found', 404));

  if (!order.returnInfo || order.returnInfo.status === 'none') {
    return next(new HandleError('No return request found', 400));
  }

  order.returnInfo.status = status;

  if (status === 'received') order.returnInfo.receivedAt = new Date();

  if (status === 'inspected') {
    order.returnInfo.inspectedAt = new Date();
    order.returnInfo.inspectedBy = req.user._id;
    if (inspectionNotes) order.returnInfo.inspectionNotes = inspectionNotes;
  }

  if (status === 'completed') {
    order.returnInfo.completedAt = new Date();

    for (const item of order.returnInfo.itemsToReturn) {
      const product = await Product.findById(item.product);
      if (product && item.condition !== 'damaged') {
        // FIX OC3 (orderController copy): Use correct inventory field path.
        // returnController already had this check; this orderController copy didn't.
        if (product.inventory?.stock !== undefined) {
          product.inventory.stock += item.quantity;
        } else {
          product.stock += item.quantity;
        }
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

// FIX OC4: getAllReturns REMOVED from orderController.
// The returnController version is canonical (has pagination, full stats breakdown,
// and unreadMessages). Routes should import from returnController.
// Keeping the function would create a silent split-brain where two endpoints
// return different shapes for the same resource.

export const downloadInvoice = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('user', 'name email')
    .populate('orderItems.product', 'name');

  if (!order) return next(new HandleError('Order not found', 404));

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
    } else {
      const companyInfo = {
        name: process.env.COMPANY_NAME || 'EPIC STORE Inc.',
        address: process.env.COMPANY_ADDRESS || '123 Commerce Street',
        city: process.env.COMPANY_CITY || 'New York, NY 10001',
        country: process.env.COMPANY_COUNTRY || 'United States',
        taxId: process.env.COMPANY_TAX_ID || 'XX-XXXXXXX'
      };

      pdfBuffer = await generateInvoicePDF(order, companyInfo);

      if (!order.invoiceInfo) order.invoiceInfo = {};
      order.invoiceInfo.pdfData = pdfBuffer.toString('base64');
      order.invoiceInfo.invoiceDate = new Date();
      order.invoiceInfo.generatedAt = new Date();

      await order.save({ validateBeforeSave: false });
    }

    const invoiceNumber = order.invoiceInfo?.invoiceNumber || order._id;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Invoice-${invoiceNumber}.pdf`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (error) {
    return next(new HandleError('Failed to generate invoice', 500));
  }
});

export const getPendingFraudReviews = handleAsyncError(async (req, res, next) => {
  const orders = await Order.find({
    'fraudCheck.reviewRequired': true,
    'fraudCheck.reviewDecision': 'Pending'
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
  order.fraudCheck.reviewedBy = req.user._id;
  order.fraudCheck.reviewedAt = new Date();
  order.fraudCheck.reviewRequired = false;
  if (note) order.fraudCheck.reviewNote = note;

  if (decision === 'Rejected') {
    order.orderStatus = 'Cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'Fraud risk - order rejected';
  }

  await order.save();
  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('fraud_analytics*')
  ]);

  return res.status(200).json({ success: true, message: `Order ${decision}`, order });
});

export const getAuditLog = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('auditLog.performedBy', 'name email role')
    .select('auditLog');

  if (!order) return next(new HandleError('Order not found', 404));

  return res.status(200).json({
    success: true,
    count: order.auditLog?.length || 0,
    auditLog: order.auditLog || []
  });
});

export const getCustomerOrderAnalytics = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;

  const orders = await Order.find({ user: userId });

  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt);

  const analytics = {
    totalOrders: orders.length,
    totalSpent: orders.reduce((sum, o) => sum + o.totalPrice, 0),
    averageOrderValue:
      orders.length > 0
        ? orders.reduce((sum, o) => sum + o.totalPrice, 0) / orders.length
        : 0,
    firstOrderDate: sorted.length > 0 ? sorted[0].createdAt : null,
    lastOrderDate: sorted.length > 0 ? sorted[sorted.length - 1].createdAt : null,
    refundedOrders: orders.filter(o => o.refundInfo?.status === 'completed').length,
    returnedOrders: orders.filter(o => o.returnInfo?.status === 'completed').length,
    cancelledOrders: orders.filter(o => o.orderStatus === 'Cancelled').length
  };

  return res.status(200).json({ success: true, userId, analytics });
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
  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  order.addOrderMessage(userId, isAdmin ? 'admin' : 'customer', content, attachments);
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

  if (!order) return next(new HandleError('Order not found', 404));

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
  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  order.markOrderMessagesAsRead(isAdmin ? 'admin' : 'customer');
  await order.save({ validateBeforeSave: false });

  return res.status(200).json({ success: true, message: 'Messages marked as read' });
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

  if (status && status !== 'all') query.orderStatus = status;

  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [orders, totalOrders] = await Promise.all([
    Order.find(query)
      .populate('user', 'name email phone')
      .populate('orderItems.product', 'name images price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Order.countDocuments(query)
  ]);

  const [processing, shipped, delivered, cancelled] = await Promise.all([
    Order.countDocuments({ orderStatus: 'Processing' }),
    Order.countDocuments({ orderStatus: 'Shipped' }),
    Order.countDocuments({ orderStatus: 'Delivered' }),
    Order.countDocuments({ orderStatus: 'Cancelled' })
  ]);

  return res.status(200).json({
    success: true,
    count: orders.length,
    totalOrders,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalOrders / parseInt(limit)),
    stats: { total: totalOrders, processing, shipped, delivered, cancelled },
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

  if (!order) return next(new HandleError('Order not found', 404));

  return res.status(200).json({ success: true, order });
});

export const updateOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { status, note } = req.body;

  if (!status) return next(new HandleError('Order status is required', 400));

  const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return next(new HandleError('Invalid order status', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.orderStatus === 'Cancelled' && status !== 'Cancelled') {
    return next(new HandleError('Cannot update a cancelled order', 400));
  }

  const oldStatus = order.orderStatus;
  order.orderStatus = status;

  if (status === 'Delivered' && !order.deliveredAt) order.deliveredAt = new Date();

  order.fulfillmentSLA = calculateFulfillmentSLA(order.createdAt, status);
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

    // FIX OC2: Fire-and-forget — same as createOrder fix above
    syncCustomerAfterOrder(order._id).catch(() => {});
  }

  await order.save();

  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('fulfillment_analytics*'),
    deleteCachePattern('customer_analytics*')
  ]);

  return res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    order
  });
});

export const deleteOrder = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  if (order.orderStatus === 'Delivered') {
    return next(new HandleError('Cannot delete delivered orders', 400));
  }

  if (order.refundInfo && order.refundInfo.status === 'completed') {
    return next(new HandleError('Cannot delete orders with completed refunds', 400));
  }

  await order.deleteOne();
  await deleteCachePattern('admin_stats*');

  return res.status(200).json({ success: true, message: 'Order deleted successfully' });
});

export const addAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { content, type = 'admin' } = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

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

  return res.status(200).json({ success: true, message: 'Note added successfully', note: addedNote });
});

export const getAdminOrderNotes = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('notes.createdBy', 'name email role')
    .select('notes');

  if (!order) return next(new HandleError('Order not found', 404));

  return res.status(200).json({ success: true, count: order.notes.length, notes: order.notes });
});

export const editAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;
  const { content } = req.body;

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const note = order.notes.id(noteId);
  if (!note) return next(new HandleError('Note not found', 404));

  if (note.createdBy.toString() !== req.user._id.toString()) {
    return next(new HandleError('You can only edit your own notes', 403));
  }

  note.content = content.trim();
  note.editedAt = new Date();
  note.isEdited = true;

  await order.save();

  const populatedOrder = await Order.findById(id).populate('notes.createdBy', 'name email role');
  const updatedNote = populatedOrder.notes.id(noteId);

  return res.status(200).json({ success: true, message: 'Note updated successfully', note: updatedNote });
});

export const deleteAdminOrderNote = handleAsyncError(async (req, res, next) => {
  const { id, noteId } = req.params;

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const note = order.notes.id(noteId);
  if (!note) return next(new HandleError('Note not found', 404));

  if (note.createdBy.toString() !== req.user._id.toString()) {
    return next(new HandleError('You can only delete your own notes', 403));
  }

  note.deleteOne();
  await order.save();
  return res.status(200).json({ success: true, message: 'Note deleted successfully' });
});

export const cancelOrderWithRefund = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { reason, skipRefund = false } = req.body;

  if (!reason) return next(new HandleError('Cancellation reason is required', 400));

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

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

  await Promise.all([
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('cancellation_analytics*')
  ]);

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

  if (!reference) return next(new HandleError('Reference number is required', 400));

  let order = await Order.findOne({ 'paymentInfo.reference': reference }).populate('user', 'name email');

  if (!order && reference.match(/^[0-9a-fA-F]{24}$/)) {
    order = await Order.findById(reference).populate('user', 'name email');
  }

  if (!order) return next(new HandleError('Order not found with this reference', 404));

  if (req.user.role !== 'admin' && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized to view this order', 403));
  }

  return res.status(200).json({ success: true, order });
});

export default {
  getAllMyOrders,
  getOrderDetails,
  createOrder,
  getOrderTimeline,
  addOrderNote,
  getOrderNotes,
  editOrderNote,
  getTrackingInfo,
  addTrackingInfo,
  createShipment,
  updateShipmentStatus,
  requestReturn,
  reviewReturnRequest,
  updateReturnStatus,
  downloadInvoice,
  getPendingFraudReviews,
  reviewFraudCheck,
  getAuditLog,
  getCustomerOrderAnalytics,
  addOrderMessage,
  getOrderMessages,
  markOrderMessagesRead,
  getOrdersWithUnreadMessages,
  getAllOrders,
  getSingleOrder,
  updateOrder,
  deleteOrder,
  addAdminOrderNote,
  getAdminOrderNotes,
  editAdminOrderNote,
  deleteAdminOrderNote,
  cancelOrderWithRefund,
  getOrderByReference
};