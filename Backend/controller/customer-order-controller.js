import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import User from '../models/userModel.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';
import generateInvoicePDF from '../utils/generateInvoicePDF.js';
import { syncCustomerAfterOrder } from '../Services/customer-analytics-service.js';
import { calculateFraudRisk } from '../utils/fraudCheck.js';
import { calculateFulfillmentSLA } from '../utils/fulfillmentSLA.js';

// ============================================
// ANALYTICS HELPER FUNCTIONS
// ============================================

const extractAnalyticsData = (req) => {
  const userAgent = req.get('user-agent') || '';
  const referrer  = req.get('referer') || req.get('referrer') || '';

  const isMobile = /mobile/i.test(userAgent);
  const isTablet = /tablet|ipad/i.test(userAgent);
  const device   = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  let browser = 'unknown';
  if (/chrome/i.test(userAgent))       browser = 'Chrome';
  else if (/safari/i.test(userAgent))  browser = 'Safari';
  else if (/firefox/i.test(userAgent)) browser = 'Firefox';
  else if (/edge/i.test(userAgent))    browser = 'Edge';

  return {
    device,
    browser,
    referrer:  referrer || null,
    userAgent: userAgent.substring(0, 200)
  };
};

const parseUTMParams = (data) => {
  // FIX: Normalise source to valid enum values only
  const rawSource = data.utm_source || data.source || 'direct';
  const validSources = ['organic', 'paid', 'referral', 'email', 'social', 'direct'];
  const source = validSources.includes(rawSource) ? rawSource : 'direct';

  return {
    source,
    medium:   data.utm_medium   || data.medium   || null,
    campaign: data.utm_campaign || data.campaign || null,
    term:     data.utm_term     || null,
    content:  data.utm_content  || null
  };
};

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
    // Non-critical — analytics failure must not abort an order
  }
};

// ============================================
// GET ALL MY ORDERS (customer)
// ============================================
export const getAllMyOrders = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const orders = await Order.find({ user: userId })
    .populate('orderItems.product', 'name images pricing')
    .sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    count:   orders.length,
    orders,
    message: orders.length === 0 ? 'No orders found' : undefined
  });
});

// ============================================
// GET ORDER DETAILS (customer or admin)
// ============================================
export const getOrderDetails = handleAsyncError(async (req, res, next) => {
  const { id }    = req.params;
  const userId    = req.user._id;
  const isAdmin   = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('user',                   'firstName lastName email')
    .populate('orderItems.product',     'name images pricing');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({ success: true, order });
});

// ============================================
// CREATE ORDER
// ============================================
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
  const utmParams       = clientAnalytics
    ? parseUTMParams(clientAnalytics)
    : parseUTMParams(req.query);

  const fullAnalytics = {
    source:          utmParams.source,
    medium:          utmParams.medium,
    campaign:        utmParams.campaign,
    term:            utmParams.term,
    content:         utmParams.content,
    device:          clientAnalytics?.device   || serverAnalytics.device,
    browser:         clientAnalytics?.browser  || serverAnalytics.browser,
    referrer:        clientAnalytics?.referrer || serverAnalytics.referrer,
    landingPage:     clientAnalytics?.landingPage  || null,
    sessionId:       clientAnalytics?.sessionId    || null,
    isFirstPurchase: clientAnalytics?.isFirstPurchase || false,
    capturedAt:      new Date()
  };

  const user        = await User.findById(req.user._id);
  const fraudCheck  = calculateFraudRisk({
    totalPrice,
    shippingInfo,
    orderItems,
    billingAddress: paymentInfo?.billingAddress
  }, user);

  const orderDate      = new Date();
  const fulfillmentSLA = calculateFulfillmentSLA(orderDate, 'Processing');

  const order = await Order.create({
    orderItems,
    shippingInfo,
    paymentInfo,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    user:        req.user._id,
    paidAt:      paymentInfo?.status === 'paid' ? Date.now() : null,
    analytics:   fullAnalytics,
    fraudCheck,
    fulfillmentSLA
  });

  // FIX: Use correct product fields — name/images/pricing (not firstName/lastName)
  await order.populate('orderItems.product', 'name images pricing');

  await updateProductAnalytics(orderItems);

  // Fire-and-forget — non-critical post-order sync
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

// ============================================
// GET ORDER TIMELINE (customer or admin)
// ============================================
export const getOrderTimeline = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('statusHistory.updatedBy', 'firstName lastName email')
    .select('statusHistory orderStatus user');

  if (!order) return next(new HandleError('Order not found', 404));

  if (!isAdmin && order.user.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized', 403));
  }

  return res.status(200).json({
    success:       true,
    timeline:      order.statusHistory,
    currentStatus: order.orderStatus
  });
});

// ============================================
// NOTES (customer-facing)
// ============================================
export const addOrderNote = handleAsyncError(async (req, res, next) => {
  const { id }              = req.params;
  const { content, type = 'customer' } = req.body;
  const userId              = req.user._id;
  const isAdmin             = req.user.role === 'admin';

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
  // FIX: Schema field is 'author', not 'createdBy'
  order.notes.push({ content, type, author: userId, createdAt: new Date() });
  await order.save();

  return res.status(200).json({
    success: true,
    message: 'Note added successfully',
    note:    order.notes[order.notes.length - 1]
  });
});

export const getOrderNotes = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  // FIX: Schema field is 'author', not 'createdBy'
  const order = await Order.findById(id)
    .populate('notes.author', 'firstName lastName email role')
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
  const { content }    = req.body;
  const userId         = req.user._id;
  const isAdmin        = req.user.role === 'admin';

  if (!content || content.trim().length === 0) {
    return next(new HandleError('Note content is required', 400));
  }

  const order = await Order.findById(id);
  if (!order) return next(new HandleError('Order not found', 404));

  const note = order.notes.id(noteId);
  if (!note) return next(new HandleError('Note not found', 404));

  // FIX: Schema field is 'author', not 'createdBy'
  if (!isAdmin && note.author.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized to edit this note', 403));
  }

  note.content  = content;
  note.isEdited = true;
  note.editedAt = new Date();
  await order.save();

  return res.status(200).json({ success: true, message: 'Note updated successfully', note });
});

// ============================================
// TRACKING (customer read-only)
// ============================================
export const getTrackingInfo = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
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


// ============================================
// MESSAGES (customer side)
// ============================================
export const addOrderMessage = handleAsyncError(async (req, res, next) => {
  const { id }                    = req.params;
  const { content, attachments = [] } = req.body;
  const userId                    = req.user._id;
  const isAdmin                   = req.user.role === 'admin';

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
    success:      true,
    message:      'Message sent successfully',
    orderMessage: order.orderMessages[order.orderMessages.length - 1]
  });
});

export const getOrderMessages = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('orderMessages.sender', 'firstName lastName email role')
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
    success:  true,
    count:    order.orderMessages?.length || 0,
    messages: order.orderMessages || []
  });
});

export const markOrderMessagesRead = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
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

// ============================================
// INVOICE (customer download)
// ============================================
export const downloadInvoice = handleAsyncError(async (req, res, next) => {
  const { id }  = req.params;
  const userId  = req.user._id;
  const isAdmin = req.user.role === 'admin';

  const order = await Order.findById(id)
    .populate('user',               'firstName lastName email')
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
        name:    process.env.COMPANY_NAME    || 'EPIC STORE Inc.',
        address: process.env.COMPANY_ADDRESS || '123 Commerce Street',
        city:    process.env.COMPANY_CITY    || 'New York, NY 10001',
        country: process.env.COMPANY_COUNTRY || 'United States',
        taxId:   process.env.COMPANY_TAX_ID  || 'XX-XXXXXXX'
      };

      pdfBuffer = await generateInvoicePDF(order, companyInfo);

      if (!order.invoiceInfo) order.invoiceInfo = {};
      order.invoiceInfo.pdfData      = pdfBuffer.toString('base64');
      order.invoiceInfo.invoiceDate  = new Date();
      order.invoiceInfo.generatedAt  = new Date();
      await order.save({ validateBeforeSave: false });
    }

    const invoiceNumber = order.invoiceInfo?.invoiceNumber || order._id;
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Invoice-${invoiceNumber}.pdf`);
    res.setHeader('Content-Length',       pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch {
    return next(new HandleError('Failed to generate invoice', 500));
  }
});

// ============================================
// ORDER REFERENCE LOOKUP (customer or admin)
// ============================================
export const getOrderByReference = handleAsyncError(async (req, res, next) => {
  const { reference } = req.params;
  const userId        = req.user._id;

  if (!reference) return next(new HandleError('Reference number is required', 400));

  let order = await Order.findOne({ 'paymentInfo.reference': reference })
    .populate('user', 'firstName lastName email');

  if (!order && reference.match(/^[0-9a-fA-F]{24}$/)) {
    order = await Order.findById(reference)
      .populate('user', 'firstName lastName email');
  }

  if (!order) return next(new HandleError('Order not found with this reference', 404));

  if (req.user.role !== 'admin' && order.user._id.toString() !== userId.toString()) {
    return next(new HandleError('Unauthorized to view this order', 403));
  }

  return res.status(200).json({ success: true, order });
});

// ============================================
// ANALYTICS (customer-facing)
// ============================================
export const getCustomerOrderAnalytics = handleAsyncError(async (req, res, next) => {
  const { userId } = req.params;
  const orders     = await Order.find({ user: userId });
  const sorted     = [...orders].sort((a, b) => a.createdAt - b.createdAt);

  const analytics = {
    totalOrders:     orders.length,
    totalSpent:      orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0),
    averageOrderValue:
      orders.length > 0
        ? orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0) / orders.length
        : 0,
    firstOrderDate:  sorted.length > 0 ? sorted[0].createdAt              : null,
    lastOrderDate:   sorted.length > 0 ? sorted[sorted.length - 1].createdAt : null,
    refundedOrders:  orders.filter(o => o.refundInfo?.status  === 'completed').length,
    returnedOrders:  orders.filter(o => o.returnInfo?.status  === 'completed').length,
    cancelledOrders: orders.filter(o => o.orderStatus         === 'Cancelled').length
  };

  return res.status(200).json({ success: true, userId, analytics });
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
  requestReturn,
  addOrderMessage,
  getOrderMessages,
  markOrderMessagesRead,
  downloadInvoice,
  getOrderByReference,
  getCustomerOrderAnalytics
};