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

    // Short human-readable order reference — last 8 hex chars of _id, uppercased.
    // Generated once in pre('save'), never mutated after that.
    // Used for customer-facing display, support lookups, and admin search.
    // sparse: true so legacy documents without this field don't collide on
    // the unique index during a rolling deploy.
    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
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
      reference: { type: String, required: true, unique: true, sparse: true },
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
        enum: ['none', 'requested', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled'],
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
      reviewedAt: Date,
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
      // NOTE: 'amount' preserved for backwards compatibility with existing
      // documents. It is never written to by new code — refundAmount is the
      // canonical field. Do not use in new code.
      amount: { type: Number, default: 0 },
      notes: String,
      refundReference: String,
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
        // NOTE: field is intentionally named 'message' (not 'content') to
        // match existing stored documents. Renaming without a migration would
        // silently orphan all existing refund message data. This is known
        // technical debt — do not rename without a migration script.
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
    },

    // ============================================
    // RETURN INFORMATION (RMA)
    // ============================================
    returnInfo: {
      status: {
        type: String,
        enum: ['none', 'requested', 'approved', 'rejected', 'in_transit', 'received', 'inspected', 'completed', 'cancelled'],
        default: 'none'
      },
      rmaNumber: String,
      reason: String,
      description: String,
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

// Human-readable order reference — sparse because legacy documents won't
// have this field. The collation makes regex search case-insensitive at the
// index level without needing the 'i' flag at query time.
orderSchema.index(
  { orderNumber: 1 },
  { sparse: true, collation: { locale: 'en', strength: 2 } }
);

// Core pagination indexes
orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });

// Amount sort index
orderSchema.index({ totalPrice: -1 });

// Payment indexes
orderSchema.index({ 'paymentInfo.status': 1 });
orderSchema.index({ 'paymentInfo.method': 1 });
orderSchema.index({ 'paymentInfo.paidAt': -1 });

// Compound indexes covering status filter + requestedAt sort in one scan.
// Also used by getAllRefunds date range queries.
orderSchema.index({ 'refundInfo.status': 1, 'refundInfo.requestedAt': -1 });
orderSchema.index({ 'returnInfo.status': 1, 'returnInfo.requestedAt': -1 });

// Cancellation & fulfilment analytics
orderSchema.index({ cancelledAt: -1 });
orderSchema.index({ deliveredAt: -1 });

// Fraud indexes
orderSchema.index({ 'fraudCheck.riskLevel': 1 });
orderSchema.index({ 'fraudCheck.reviewRequired': 1 });

// Analytics indexes
orderSchema.index({ 'analytics.source': 1 });
orderSchema.index({ 'analytics.isFirstPurchase': 1 });

// NOTE: MongoDB cannot use a compound multikey index when both fields come
// from the same array. The indexes below are separate single-field indexes.
// The $elemMatch queries use the isRead index for initial scan and apply
// senderType as an in-memory filter.
orderSchema.index({ 'refundInfo.messages.isRead': 1 });
orderSchema.index({ 'refundInfo.messages.senderType': 1 });
orderSchema.index({ 'refundInfo.messages.createdAt': -1 });

orderSchema.index({ 'orderMessages.isRead': 1 });
orderSchema.index({ 'orderMessages.senderType': 1 });
orderSchema.index({ 'orderMessages.createdAt': -1 });

orderSchema.index({ 'returnInfo.messages.isRead': 1 });
orderSchema.index({ 'returnInfo.messages.senderType': 1 });
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
  return (this.amountPaid ?? 0) - (this.refundInfo?.refundAmount ?? 0);
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
    this.returnInfo?.status !== 'none' &&
    this.returnInfo?.status !== 'completed'
  );
});

orderSchema.virtual('needsFraudReview').get(function () {
  return (
    this.fraudCheck?.reviewRequired === true &&
    this.fraudCheck?.reviewDecision === 'Pending'
  );
});

orderSchema.virtual('totalShipments').get(function () {
  return this.shipments?.length ?? 0;
});

orderSchema.virtual('isFullyFulfilled').get(function () {
  if (!this.orderItems?.length) return false;
  return this.orderItems.every(
    (item) =>
      item.fulfillmentStatus === 'complete' ||
      item.quantityShipped === item.quantityOrdered
  );
});

// Granular unread virtuals — named from the reader's perspective.
orderSchema.virtual('unreadRefundMessagesFromCustomer').get(function () {
  return (this.refundInfo?.messages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadRefundMessagesFromAdmin').get(function () {
  return (this.refundInfo?.messages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'admin'
  ).length;
});

// Alias — admin dashboard unread count (customer→admin direction).
// NOTE: directionally asymmetric by design — counts only unread customer
// messages. Do not rename without updating all callers.
orderSchema.virtual('unreadRefundMessages').get(function () {
  return (this.refundInfo?.messages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadOrderMessagesFromCustomer').get(function () {
  return (this.orderMessages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadOrderMessagesFromAdmin').get(function () {
  return (this.orderMessages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'admin'
  ).length;
});

orderSchema.virtual('unreadReturnMessagesFromCustomer').get(function () {
  return (this.returnInfo?.messages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'customer'
  ).length;
});

orderSchema.virtual('unreadReturnMessagesFromAdmin').get(function () {
  return (this.returnInfo?.messages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'admin'
  ).length;
});

// Alias — consistent with unreadRefundMessages naming convention.
orderSchema.virtual('unreadReturnMessages').get(function () {
  return (this.returnInfo?.messages ?? []).filter(
    (m) => !m.isRead && m.senderType === 'customer'
  ).length;
});

orderSchema.virtual('latestRefundMessage').get(function () {
  const msgs = this.refundInfo?.messages;
  return msgs?.length ? msgs[msgs.length - 1] : null;
});

orderSchema.virtual('latestOrderMessage').get(function () {
  const msgs = this.orderMessages;
  return msgs?.length ? msgs[msgs.length - 1] : null;
});

orderSchema.virtual('latestReturnMessage').get(function () {
  const msgs = this.returnInfo?.messages;
  return msgs?.length ? msgs[msgs.length - 1] : null;
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });
orderSchema.set('strictQuery', true);

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
orderSchema.pre('save', function (next) {
  // Generate orderNumber once on first save from the tail of the ObjectId.
  // _id is always assigned by Mongoose before pre('save') fires so this
  // is always safe. slice(-8) uses the high-entropy counter/random portion
  // of the ObjectId rather than the timestamp prefix.
  if (!this.orderNumber) {
    this.orderNumber = this._id.toString().slice(-8).toUpperCase();
  }

  // Generate invoice number when payment succeeds, if not already set.
  // NOTE: Date.now() + process.pid entropy can collide under concurrent saves
  // at millisecond resolution across multiple instances. The unique index will
  // catch it. For production at scale replace with an atomic counter or UUID.
  if (!this.invoiceInfo?.invoiceNumber && this.paymentInfo?.status === 'success') {
    const year    = new Date().getFullYear();
    const month   = String(new Date().getMonth() + 1).padStart(2, '0');
    const entropy = Date.now().toString(36).toUpperCase() + process.pid.toString(36).toUpperCase();
    this.invoiceInfo               = this.invoiceInfo || {};
    this.invoiceInfo.invoiceNumber = `INV-${year}${month}-${entropy}`;
    this.invoiceInfo.invoiceDate   = new Date();
  }

  if (this.returnInfo?.status === 'approved' && !this.returnInfo.rmaNumber) {
    const entropy = Date.now().toString(36).toUpperCase() + process.pid.toString(36).toUpperCase();
    this.returnInfo.rmaNumber = `RMA-${entropy}`;
  }

  if (this.orderItems) {
    this.orderItems.forEach((item) => {
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
    'fraudCheck.reviewDecision': 'Pending',
  })
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 });
};

orderSchema.statics.getActiveReturns = async function () {
  return this.find({
    'returnInfo.status': {
      $in: ['requested', 'approved', 'in_transit', 'received', 'inspected'],
    },
  })
    .populate('user', 'firstName lastName email')
    .populate('returnInfo.requestedBy', 'firstName lastName email')
    .sort({ 'returnInfo.requestedAt': -1 });
};

orderSchema.statics.getRefundsWithUnreadMessages = async function () {
  return this.find({
    'refundInfo.status': { $nin: ['none', 'completed', 'rejected'] },
    'refundInfo.messages': {
      $elemMatch: { isRead: false, senderType: 'customer' },
    },
  })
    .select({
      user: 1,
      orderNumber: 1,
      'refundInfo.status': 1,
      'refundInfo.reason': 1,
      'refundInfo.requestedAmount': 1,
      'refundInfo.messages': 1,
    })
    .populate('user', 'firstName lastName email')
    .populate('refundInfo.messages.sender', 'firstName lastName email')
    .sort({ 'refundInfo.messages.createdAt': -1 })
    .limit(50);
};

orderSchema.statics.getOrdersWithUnreadMessages = async function () {
  return this.find({
    orderMessages: {
      $elemMatch: { isRead: false, senderType: 'customer' },
    },
  })
    .populate('user', 'firstName lastName email')
    .populate('orderMessages.sender', 'firstName lastName email')
    .sort({ 'orderMessages.createdAt': -1 });
};

orderSchema.statics.getReturnsWithUnreadMessages = async function () {
  return this.find({
    'returnInfo.status': { $nin: ['none', 'completed', 'rejected'] },
    'returnInfo.messages': {
      $elemMatch: { isRead: false, senderType: 'customer' },
    },
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

// ── Order Messages ──────────────────────────────────────────────────────────

orderSchema.methods.addOrderMessage = function (sender, senderType, content, attachments = []) {
  if (!this.orderMessages) this.orderMessages = [];
  this.orderMessages.push({
    sender, senderType, content, attachments,
    isRead: false, deliveredAt: null, createdAt: new Date(),
  });
};

orderSchema.methods.markOrderMessagesDelivered = function (senderType) {
  (this.orderMessages ?? []).forEach((msg) => {
    if (msg.senderType !== senderType && !msg.deliveredAt) {
      msg.deliveredAt = new Date();
    }
  });
};

orderSchema.methods.markOrderMessagesAsRead = function (senderType) {
  (this.orderMessages ?? []).forEach((msg) => {
    if (msg.senderType !== senderType && !msg.isRead) {
      msg.isRead = true;
      msg.readAt = new Date();
    }
  });
};

// ── Refund Messages ─────────────────────────────────────────────────────────

orderSchema.methods.addRefundMessage = function (sender, senderType, message, attachments = []) {
  if (!this.refundInfo) this.refundInfo = { status: 'none' };
  if (!this.refundInfo.messages) this.refundInfo.messages = [];
  this.refundInfo.messages.push({
    sender, senderType,
    message,   // stored field name is 'message' — see schema comment above
    attachments,
    isRead: false,
    createdAt: new Date(),
  });
  this.addRefundTimeline('message_sent', `New message from ${senderType}`, sender);
};

// Parameter name is 'senderType' but semantics are: pass the READER's role.
// Marks messages from the OTHER party as read.
// e.g. markRefundMessagesAsRead('admin') marks customer messages as read.
orderSchema.methods.markRefundMessagesAsRead = function (senderType) {
  (this.refundInfo?.messages ?? []).forEach((msg) => {
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
    type, url, filename, description, uploadedBy, uploadedAt: new Date(),
  });
  this.addRefundTimeline('document_uploaded', `${type} document uploaded`, uploadedBy);
};

orderSchema.methods.addRefundTimeline = function (event, description, performedBy, metadata = {}) {
  if (!this.refundInfo) this.refundInfo = { status: 'none' };
  if (!this.refundInfo.timeline) this.refundInfo.timeline = [];
  this.refundInfo.timeline.push({
    event, description, performedBy, timestamp: new Date(), metadata,
  });
};

// ── Return Messages ─────────────────────────────────────────────────────────

orderSchema.methods.addReturnMessage = function (sender, senderType, content, attachments = []) {
  if (!this.returnInfo) this.returnInfo = { status: 'none' };
  if (!this.returnInfo.messages) this.returnInfo.messages = [];
  this.returnInfo.messages.push({
    sender, senderType, content, attachments,
    isRead: false, deliveredAt: null, createdAt: new Date(),
  });
};

orderSchema.methods.markReturnMessagesDelivered = function (senderType) {
  (this.returnInfo?.messages ?? []).forEach((msg) => {
    if (msg.senderType !== senderType && !msg.deliveredAt) {
      msg.deliveredAt = new Date();
    }
  });
};

orderSchema.methods.markReturnMessagesAsRead = function (senderType) {
  (this.returnInfo?.messages ?? []).forEach((msg) => {
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
    event, description, performedBy, timestamp: new Date(), metadata,
  });
};

orderSchema.methods.addReturnDocument = function (type, url, filename, uploadedBy, description = '') {
  if (!this.returnInfo) this.returnInfo = { status: 'none' };
  if (!this.returnInfo.documents) this.returnInfo.documents = [];
  this.returnInfo.documents.push({
    type, url, filename, description, uploadedBy, uploadedAt: new Date(),
  });
  this.addReturnTimeline('document_uploaded', `${type} document uploaded`, uploadedBy);
};

export default mongoose.model('Order', orderSchema);