import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    // ============================================
    // CUSTOMER & SHIPPING INFORMATION
    // ============================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    shippingInfo: {
      address: String,
      city: String,
      state: String,
      country: String,
      pinCode: String,
      phoneNo: String
    },

    // ============================================
    // ORDER ITEMS
    // ============================================
    orderItems: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true
        },
        name: String,
        price: Number,
        quantity: Number,
        image: String,
        quantityOrdered: Number,
        quantityShipped: { type: Number, default: 0 },
        quantityBackordered: { type: Number, default: 0 },
        fulfillmentStatus: {
          type: String,
          enum: ['pending', 'partial', 'complete'],
          default: 'pending'
        }
      }
    ],

    // ============================================
    // PRICING & FINANCIAL
    // ============================================
    itemPrice: Number,
    taxPrice: Number,
    shippingPrice: Number,
    totalPrice: Number,
    amountPaid: Number,

    discounts: {
      codes: [{
        code: String,
        amount: Number,
        type: { type: String, enum: ['percentage', 'fixed'] }
      }],
      totalDiscount: { type: Number, default: 0 }
    },

    taxDetails: {
      breakdown: [{
        type: { type: String, enum: ['VAT', 'Sales Tax', 'GST', 'Custom Duty'] },
        rate: Number,
        amount: Number,
        jurisdiction: String,
        taxId: String
      }],
      totalTax: Number,
      isTaxExempt: { type: Boolean, default: false },
      exemptionCertificate: String,
      calculationMethod: String,
      calculatedAt: Date
    },

    profitAnalysis: {
      cogs: Number,
      shippingCost: Number,
      gatewayFees: Number,
      netProfit: Number,
      marginPercentage: Number
    },

    // ============================================
    // PAYMENT INFORMATION
    // ============================================
    paymentInfo: {
      reference: { type: String, required: true, unique: true },
      providerTxId: String,
      stripePaymentIntentId: String,
      status: {
        type: String,
        enum: ['pending', 'success', 'failed'],
        default: 'pending'
      },
      method: {
        type: String,
        enum: ['paystack', 'flutterwave', 'stripe', 'manual'],
        required: true
      },
      currency: { type: String, default: 'USD', uppercase: true },
      amount: Number,
      paidAt: Date
    },

    paymentMeta: {
      channel: String,
      ipAddress: String,
      customer: { type: mongoose.Schema.Types.Mixed },
      authorization: { type: mongoose.Schema.Types.Mixed },
      cardDetails: {
        last4: String,
        brand: String,
        expMonth: Number,
        expYear: Number
      },
      raw: { type: mongoose.Schema.Types.Mixed }
    },

    // ============================================
    // ORDER MESSAGES (Customer <-> Admin Chat)
    // ============================================
    orderMessages: [{
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      senderType: {
        type: String,
        enum: ['customer', 'admin', 'system'],
        required: true
      },
      content: { type: String, required: true },
      attachments: [{
        url: String,
        filename: String,
        fileType: String,
        fileSize: Number,
        uploadedAt: { type: Date, default: Date.now }
      }],
      isRead: { type: Boolean, default: false },
      readAt: Date,
      deliveredAt: Date,
      createdAt: { type: Date, default: Date.now },
      isEdited: Boolean,
      editedAt: Date,
      metadata: mongoose.Schema.Types.Mixed
    }],

    // ============================================
    // REFUND INFORMATION
    // ============================================
    refundInfo: {
      status: {
        type: String,
        enum: ['none', 'requested', 'approved', 'rejected', 'processing', 'completed', 'failed'],
        default: 'none'
      },
      reason: String,
      description: String,
      refundType: {
        type: String,
        enum: ['full', 'partial'],
        default: 'full'
      },
      requestedAmount: Number,
      requestedAt: Date,
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rejectedAt: Date,
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      adminNote: String,
      refundId: String,
      refundAmount: Number,
      refundCurrency: String,
      processedAt: Date,
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      refundedAt: Date,
      gatewayResponse: { type: mongoose.Schema.Types.Mixed },
      failureReason: String,
      messages: [{
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        senderType: {
          type: String,
          enum: ['customer', 'admin', 'system'],
          required: true
        },
        message: { type: String, required: true },
        attachments: [{
          url: String,
          filename: String,
          fileType: String,
          fileSize: Number,
          uploadedAt: { type: Date, default: Date.now }
        }],
        isRead: { type: Boolean, default: false },
        readAt: Date,
        createdAt: { type: Date, default: Date.now },
        metadata: mongoose.Schema.Types.Mixed
      }],
      documents: [{
        type: {
          type: String,
          enum: ['receipt', 'photo', 'video', 'screenshot', 'other'],
          required: true
        },
        url: { type: String, required: true },
        filename: String,
        description: String,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now },
        fileSize: Number,
        mimeType: String
      }],
      timeline: [{
        event: { type: String, required: true },
        description: String,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        metadata: mongoose.Schema.Types.Mixed
      }],
      amount: { type: Number, default: 0 },
      refundReference: String,
      notes: String
    },

    // ============================================
    // RETURN INFORMATION (RMA)
    // ============================================
    returnInfo: {
      status: {
        type: String,
        enum: ['none', 'requested', 'approved', 'rejected', 'in_transit', 'received', 'inspected', 'completed'],
        default: 'none'
      },
      rmaNumber: String,
      reason: String,
      itemsToReturn: [{
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: Number,
        condition: String,
        reason: String
      }],
      returnLabel: {
        url: String,
        carrier: String,
        trackingNumber: String
      },
      inspectionNotes: String,
      inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      inspectedAt: Date,
      restockFee: { type: Number, default: 0 },
      requestedAt: Date,
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      receivedAt: Date,
      completedAt: Date,
      adminNote: String,
      messages: [{
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        senderType: {
          type: String,
          enum: ['customer', 'admin', 'system'],
          required: true
        },
        content: { type: String, required: true },
        attachments: [{
          url: String,
          filename: String,
          fileType: String,
          fileSize: Number,
          uploadedAt: { type: Date, default: Date.now }
        }],
        isRead: { type: Boolean, default: false },
        readAt: Date,
        deliveredAt: Date,
        createdAt: { type: Date, default: Date.now },
        isEdited: Boolean,
        editedAt: Date
      }],
      timeline: [{
        event: { type: String, required: true },
        description: String,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        metadata: mongoose.Schema.Types.Mixed
      }],
      documents: [{
        type: {
          type: String,
          enum: ['photo', 'video', 'receipt', 'other'],
          required: true
        },
        url: { type: String, required: true },
        filename: String,
        description: String,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now },
        fileSize: Number,
        mimeType: String
      }]
    },

    // ============================================
    // ORDER STATUS & TIMELINE
    // ============================================
    orderStatus: {
      type: String,
      enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
      default: 'Processing'
    },

    statusHistory: [{
      status: String,
      timestamp: { type: Date, default: Date.now },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      note: String,
      location: String,
      metadata: mongoose.Schema.Types.Mixed
    }],

    deliveredAt: Date,
    cancelledAt: Date,
    cancellationReason: String,

    // ============================================
    // SHIPMENT & TRACKING
    // ============================================
    shipments: [{
      shipmentId: String,
      warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
      items: [{
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: Number,
        name: String
      }],
      carrier: String,
      trackingNumber: String,
      status: {
        type: String,
        enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
        default: 'Processing'
      },
      shippedAt: Date,
      deliveredAt: Date,
      weight: Number,
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: { type: String, default: 'cm' }
      }
    }],

    tracking: {
      carrier: { type: String, enum: ['DHL', 'FedEx', 'UPS', 'USPS', 'Other'] },
      trackingNumber: String,
      trackingUrl: String,
      estimatedDelivery: Date,
      currentLocation: String,
      trackingHistory: [{
        status: String,
        location: String,
        timestamp: Date,
        description: String
      }],
      lastUpdated: Date
    },

    // ============================================
    // INVOICE MANAGEMENT
    // ============================================
    invoiceInfo: {
      invoiceNumber: { type: String, unique: true, sparse: true },
      invoiceDate: Date,
      dueDate: Date,
      pdfData: String,
      generatedAt: Date,
      version: { type: Number, default: 1 },
      history: [{
        version: Number,
        pdfData: String,
        generatedAt: Date,
        reason: String
      }],
      billingAddress: mongoose.Schema.Types.Mixed,
      companyInfo: {
        name: String,
        taxId: String,
        registrationNumber: String
      }
    },

    // ============================================
    // NOTES & COMMUNICATION
    // ============================================
    notes: [{
      content: { type: String, required: true },
      type: { type: String, enum: ['internal', 'customer'], default: 'internal' },
      author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      createdAt: { type: Date, default: Date.now },
      attachments: [String],
      isEdited: Boolean,
      editedAt: Date
    }],

    // ============================================
    // ANALYTICS & ATTRIBUTION
    // ============================================
    analytics: {
      source: { type: String, enum: ['organic', 'paid', 'referral', 'email', 'social', 'direct'] },
      medium: String,
      campaign: String,
      referrer: String,
      landingPage: String,
      device: { type: String, enum: ['mobile', 'tablet', 'desktop'] },
      browser: String,
      customerSegment: String,
      isFirstPurchase: Boolean,
      purchaseNumber: Number
    },

    fulfillmentSLA: {
      promisedDelivery: Date,
      actualDelivery: Date,
      slaBreached: Boolean,
      delayInDays: Number
    },

    // ============================================
    // SECURITY & FRAUD PREVENTION
    // ============================================
    fraudCheck: {
      riskScore: { type: Number, min: 0, max: 100 },
      riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'] },
      flags: [String],
      reviewRequired: Boolean,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      reviewDecision: { type: String, enum: ['Approved', 'Rejected', 'Pending'] },
      ipAddress: String,
      deviceFingerprint: String,
      checks: {
        addressMatch: Boolean,
        cvvMatch: Boolean,
        velocityCheck: Boolean,
        geoCheck: Boolean
      }
    },

    auditLog: [{
      action: { type: String, required: true },
      performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      timestamp: { type: Date, default: Date.now },
      ipAddress: String,
      userAgent: String,
      changes: {
        field: String,
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed
      },
      metadata: mongoose.Schema.Types.Mixed
    }]
  },
  {
    timestamps: true,
    strict: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// INDEXES
// ============================================

// Core pagination indexes — required for Option A server-side pagination
// These two cover: (1) unfiltered list sorted by date, (2) status-filtered list sorted by date
orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });

// Amount sort index — covers ?sort=amount_hi and ?sort=amount_lo
orderSchema.index({ totalPrice: -1 });

// Payment indexes
orderSchema.index({ 'paymentInfo.status': 1 });
orderSchema.index({ 'paymentInfo.method': 1 });
// Revenue-by-period reporting (e.g. "revenue in March 2025")
orderSchema.index({ 'paymentInfo.paidAt': -1 });

// Refund / return indexes
orderSchema.index({ 'refundInfo.status': 1 });
orderSchema.index({ 'returnInfo.status': 1 });

// Cancellation analytics (e.g. "cancellations this month")
orderSchema.index({ cancelledAt: -1 });

// Fulfillment SLA reporting
orderSchema.index({ deliveredAt: -1 });

// Fraud indexes
orderSchema.index({ 'fraudCheck.riskLevel': 1 });
orderSchema.index({ 'fraudCheck.reviewRequired': 1 });

// Analytics indexes
orderSchema.index({ 'analytics.source': 1 });
orderSchema.index({ 'analytics.isFirstPurchase': 1 });

// Message unread indexes (multikey on array sub-docs)
orderSchema.index({ 'refundInfo.messages.isRead': 1 });
orderSchema.index({ 'refundInfo.messages.createdAt': -1 });
orderSchema.index({ 'orderMessages.isRead': 1 });
orderSchema.index({ 'orderMessages.createdAt': -1 });
orderSchema.index({ 'returnInfo.messages.isRead': 1 });
orderSchema.index({ 'returnInfo.messages.createdAt': -1 });

// ============================================
// VIRTUALS
// ============================================

orderSchema.virtual('isRefundable').get(function () {
  return (
    this.paymentInfo?.status === 'success' &&
    this.refundInfo?.status === 'none' &&
    this.orderStatus !== 'Cancelled'
  );
});

orderSchema.virtual('refundableAmount').get(function () {
  return this.amountPaid - (this.refundInfo?.refundAmount || 0);
});

orderSchema.virtual('daysUntilRefundDeadline').get(function () {
  const REFUND_WINDOW_DAYS = 30;
  const baseDate = this.deliveredAt || this.paymentInfo?.paidAt;
  if (!baseDate) return null;
  const deadline = new Date(baseDate);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  const daysRemaining = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysRemaining);
});

orderSchema.virtual('hasActiveReturn').get(function () {
  return (
    this.returnInfo &&
    this.returnInfo.status !== 'none' &&
    this.returnInfo.status !== 'completed'
  );
});

orderSchema.virtual('needsFraudReview').get(function () {
  return (
    this.fraudCheck &&
    this.fraudCheck.reviewRequired &&
    this.fraudCheck.reviewDecision === 'Pending'
  );
});

orderSchema.virtual('totalShipments').get(function () {
  return this.shipments ? this.shipments.length : 0;
});

orderSchema.virtual('isFullyFulfilled').get(function () {
  if (!this.orderItems || this.orderItems.length === 0) return false;
  return this.orderItems.every(
    item =>
      item.fulfillmentStatus === 'complete' ||
      item.quantityShipped === item.quantityOrdered
  );
});

orderSchema.virtual('unreadRefundMessagesFromCustomer').get(function () {
  if (!this.refundInfo?.messages) return 0;
  return this.refundInfo.messages.filter(
    msg => !msg.isRead && msg.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadRefundMessagesFromAdmin').get(function () {
  if (!this.refundInfo?.messages) return 0;
  return this.refundInfo.messages.filter(
    msg => !msg.isRead && msg.senderType === 'admin'
  ).length;
});

orderSchema.virtual('unreadOrderMessagesFromCustomer').get(function () {
  if (!this.orderMessages) return 0;
  return this.orderMessages.filter(
    msg => !msg.isRead && msg.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadOrderMessagesFromAdmin').get(function () {
  if (!this.orderMessages) return 0;
  return this.orderMessages.filter(
    msg => !msg.isRead && msg.senderType === 'admin'
  ).length;
});

orderSchema.virtual('unreadReturnMessagesFromCustomer').get(function () {
  if (!this.returnInfo?.messages) return 0;
  return this.returnInfo.messages.filter(
    msg => !msg.isRead && msg.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadReturnMessagesFromAdmin').get(function () {
  if (!this.returnInfo?.messages) return 0;
  return this.returnInfo.messages.filter(
    msg => !msg.isRead && msg.senderType === 'admin'
  ).length;
});

orderSchema.virtual('latestRefundMessage').get(function () {
  if (!this.refundInfo?.messages?.length) return null;
  return this.refundInfo.messages[this.refundInfo.messages.length - 1];
});

orderSchema.virtual('latestOrderMessage').get(function () {
  if (!this.orderMessages?.length) return null;
  return this.orderMessages[this.orderMessages.length - 1];
});

orderSchema.virtual('latestReturnMessage').get(function () {
  if (!this.returnInfo?.messages?.length) return null;
  return this.returnInfo.messages[this.returnInfo.messages.length - 1];
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });
orderSchema.set('strictQuery', true);

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
orderSchema.pre('save', function (next) {
  if (!this.invoiceInfo?.invoiceNumber && this.paymentInfo?.status === 'success') {
    const year    = new Date().getFullYear();
    const month   = String(new Date().getMonth() + 1).padStart(2, '0');
    const entropy = Date.now().toString(36).toUpperCase() + process.pid.toString(36).toUpperCase();
    this.invoiceInfo         = this.invoiceInfo || {};
    this.invoiceInfo.invoiceNumber = `INV-${year}${month}-${entropy}`;
    this.invoiceInfo.invoiceDate   = new Date();
  }

  if (this.returnInfo?.status === 'approved' && !this.returnInfo.rmaNumber) {
    const entropy = Date.now().toString(36).toUpperCase() + process.pid.toString(36).toUpperCase();
    this.returnInfo.rmaNumber = `RMA-${entropy}`;
  }

  if (this.orderItems) {
    this.orderItems.forEach(item => {
      if (item.quantityOrdered == null) {
        item.quantityOrdered = item.quantity;
      }
    });
  }

  next();
});

// ============================================
// STATIC METHODS
// ============================================

orderSchema.statics.getOrdersByStatus = async function (status) {
  return this.find({ orderStatus: status })
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 });
};

orderSchema.statics.getPendingFraudReviews = async function () {
  return this.find({
    'fraudCheck.reviewRequired': true,
    'fraudCheck.reviewDecision': 'Pending'
  })
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 });
};

orderSchema.statics.getActiveReturns = async function () {
  return this.find({
    'returnInfo.status': {
      $in: ['requested', 'approved', 'in_transit', 'received', 'inspected']
    }
  })
    .populate('user', 'firstName lastName email')
    .populate('returnInfo.requestedBy', 'firstName lastName email')
    .sort({ 'returnInfo.requestedAt': -1 });
};

orderSchema.statics.getRefundsWithUnreadMessages = async function () {
  return this.find({
    'refundInfo.status': { $nin: ['none', 'completed', 'rejected'] },
    'refundInfo.messages': {
      $elemMatch: { isRead: false, senderType: 'customer' }
    }
  })
    .populate('user', 'firstName lastName email')
    .populate('refundInfo.messages.sender', 'firstName lastName email')
    .sort({ 'refundInfo.messages.createdAt': -1 });
};

orderSchema.statics.getOrdersWithUnreadMessages = async function () {
  return this.find({
    orderMessages: {
      $elemMatch: { isRead: false, senderType: 'customer' }
    }
  })
    .populate('user', 'firstName lastName email')
    .populate('orderMessages.sender', 'firstName lastName email')
    .sort({ 'orderMessages.createdAt': -1 });
};

orderSchema.statics.getReturnsWithUnreadMessages = async function () {
  return this.find({
    'returnInfo.status': { $nin: ['none', 'completed', 'rejected'] },
    'returnInfo.messages': {
      $elemMatch: { isRead: false, senderType: 'customer' }
    }
  })
    .populate('user', 'firstName lastName email')
    .populate('returnInfo.messages.sender', 'firstName lastName email')
    .sort({ 'returnInfo.messages.createdAt': -1 });
};

// ============================================
// INSTANCE METHODS
// ============================================
orderSchema.methods.addStatusHistory = function (status, updatedBy, note = '', metadata = {}) {
  this.statusHistory.push({ status, timestamp: new Date(), updatedBy, note, metadata });
};

orderSchema.methods.addAuditEntry = function (action, performedBy, changes = {}, metadata = {}) {
  this.auditLog.push({ action, performedBy, timestamp: new Date(), changes, metadata });
};

orderSchema.methods.addNote = function (content, type, author) {
  this.notes.push({ content, type, author, createdAt: new Date() });
};

// ============================================
// ORDER MESSAGES METHODS
// ============================================
orderSchema.methods.addOrderMessage = function (sender, senderType, content, attachments = []) {
  if (!this.orderMessages) this.orderMessages = [];
  this.orderMessages.push({
    sender, senderType, content, attachments,
    isRead: false, deliveredAt: null, createdAt: new Date()
  });
};

orderSchema.methods.markOrderMessagesDelivered = function (senderType) {
  if (!this.orderMessages) return;
  this.orderMessages.forEach(msg => {
    if (msg.senderType !== senderType && !msg.deliveredAt) {
      msg.deliveredAt = new Date();
    }
  });
};

orderSchema.methods.markOrderMessagesAsRead = function (senderType) {
  if (!this.orderMessages) return;
  this.orderMessages.forEach(msg => {
    if (msg.senderType !== senderType && !msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
    }
  });
};

// ============================================
// REFUND MESSAGES METHODS
// ============================================
orderSchema.methods.addRefundMessage = function (sender, senderType, message, attachments = []) {
  if (!this.refundInfo) this.refundInfo = { status: 'none' };
  if (!this.refundInfo.messages) this.refundInfo.messages = [];
  this.refundInfo.messages.push({
    sender, senderType, message, attachments,
    isRead: false, createdAt: new Date()
  });
  this.addRefundTimeline('message_sent', `New message from ${senderType}`, sender);
};

orderSchema.methods.markRefundMessagesAsRead = function (senderType) {
  if (!this.refundInfo?.messages) return;
  this.refundInfo.messages.forEach(msg => {
    if (msg.senderType !== senderType && !msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
    }
  });
};

orderSchema.methods.addRefundDocument = function (type, url, filename, uploadedBy, description = '') {
  if (!this.refundInfo) this.refundInfo = { status: 'none' };
  if (!this.refundInfo.documents) this.refundInfo.documents = [];
  this.refundInfo.documents.push({
    type, url, filename, description, uploadedBy, uploadedAt: new Date()
  });
  this.addRefundTimeline('document_uploaded', `${type} document uploaded`, uploadedBy);
};

orderSchema.methods.addRefundTimeline = function (event, description, performedBy, metadata = {}) {
  if (!this.refundInfo) this.refundInfo = { status: 'none' };
  if (!this.refundInfo.timeline) this.refundInfo.timeline = [];
  this.refundInfo.timeline.push({
    event, description, performedBy, timestamp: new Date(), metadata
  });
};

// ============================================
// RETURN MESSAGES METHODS
// ============================================
orderSchema.methods.addReturnMessage = function (sender, senderType, content, attachments = []) {
  if (!this.returnInfo) this.returnInfo = { status: 'none' };
  if (!this.returnInfo.messages) this.returnInfo.messages = [];
  this.returnInfo.messages.push({
    sender, senderType, content, attachments,
    isRead: false, deliveredAt: null, createdAt: new Date()
  });
};

orderSchema.methods.markReturnMessagesDelivered = function (senderType) {
  if (!this.returnInfo?.messages) return;
  this.returnInfo.messages.forEach(msg => {
    if (msg.senderType !== senderType && !msg.deliveredAt) {
      msg.deliveredAt = new Date();
    }
  });
};

orderSchema.methods.markReturnMessagesAsRead = function (senderType) {
  if (!this.returnInfo?.messages) return;
  this.returnInfo.messages.forEach(msg => {
    if (msg.senderType !== senderType && !msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
    }
  });
};

orderSchema.methods.addReturnTimeline = function (event, description, performedBy, metadata = {}) {
  if (!this.returnInfo) this.returnInfo = { status: 'none' };
  if (!this.returnInfo.timeline) this.returnInfo.timeline = [];
  this.returnInfo.timeline.push({
    event, description, performedBy, timestamp: new Date(), metadata
  });
};

orderSchema.methods.addReturnDocument = function (type, url, filename, uploadedBy, description = '') {
  if (!this.returnInfo) this.returnInfo = { status: 'none' };
  if (!this.returnInfo.documents) this.returnInfo.documents = [];
  this.returnInfo.documents.push({
    type, url, filename, description, uploadedBy, uploadedAt: new Date()
  });
  this.addReturnTimeline('document_uploaded', `${type} document uploaded`, uploadedBy);
};

export default mongoose.model('Order', orderSchema);