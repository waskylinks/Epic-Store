import mongoose from 'mongoose';
import crypto from 'crypto';

const orderSchema = new mongoose.Schema(
  {
    // ============================================
    // CUSTOMER & SHIPPING INFORMATION
    // ============================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

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
      phoneNo: String,
    },

    // ============================================
    // ORDER ITEMS
    // ============================================
    orderItems: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
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
          default: 'pending',
        },
      },
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
      codes: [
        {
          code: String,
          amount: Number,
          type: { type: String, enum: ['percentage', 'fixed'] },
        },
      ],
      totalDiscount: { type: Number, default: 0 },
    },

    taxDetails: {
      breakdown: [
        {
          type: { type: String, enum: ['VAT', 'Sales Tax', 'GST', 'Custom Duty'] },
          rate: Number,
          amount: Number,
          jurisdiction: String,
          taxId: String,
        },
      ],
      totalTax: Number,
      isTaxExempt: { type: Boolean, default: false },
      exemptionCertificate: String,
      calculationMethod: String,
      calculatedAt: Date,
    },

    profitAnalysis: {
      cogs: Number,
      shippingCost: Number,
      gatewayFees: Number,
      netProfit: Number,
      marginPercentage: Number,
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
        default: 'pending',
      },
      method: {
        type: String,
        enum: ['paystack', 'flutterwave', 'stripe', 'manual'],
        required: true,
      },
      currency: { type: String, default: 'USD', uppercase: true },
      amount: Number,
      paidAt: Date,
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
        expYear: Number,
      },
      raw: { type: mongoose.Schema.Types.Mixed },
    },

    // ============================================
    // ORDER MESSAGES (Customer <-> Admin Chat)
    // ============================================
    orderMessages: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        senderType: {
          type: String,
          enum: ['customer', 'admin', 'system'],
          required: true,
        },
        content: { type: String, required: true },
        attachments: [
          {
            url: String,
            filename: String,
            fileType: String,
            fileSize: Number,
            uploadedAt: { type: Date, default: Date.now },
          },
        ],
        isRead: { type: Boolean, default: false },
        readAt: Date,
        deliveredAt: Date,
        createdAt: { type: Date, default: Date.now },
        isEdited: Boolean,
        editedAt: Date,
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],

    // ============================================
    // REFUND INFORMATION
    // ============================================
    refundInfo: {
      status: {
        type: String,
        enum: [
          'none', 'requested', 'approved', 'rejected',
          'processing', 'completed', 'failed', 'cancelled',
        ],
        default: 'none',
      },
      reason: String,
      description: String,
      refundType: {
        type: String,
        enum: ['full', 'partial'],
        default: 'full',
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
      // documents. Never written to by new code — refundAmount is canonical.
      amount: { type: Number, default: 0 },
      notes: String,
      refundReference: String,
      messages: [
        {
          sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
          },
          senderType: {
            type: String,
            enum: ['customer', 'admin', 'system'],
            required: true,
          },
          // NOTE: field is intentionally named 'message' (not 'content') to
          // match existing stored documents. Renaming without a migration would
          // silently orphan all existing refund message data.
          message: { type: String, required: true },
          attachments: [
            {
              url: String,
              filename: String,
              fileType: String,
              fileSize: Number,
              uploadedAt: { type: Date, default: Date.now },
            },
          ],
          isRead: { type: Boolean, default: false },
          readAt: Date,
          createdAt: { type: Date, default: Date.now },
          metadata: mongoose.Schema.Types.Mixed,
        },
      ],
      documents: [
        {
          type: {
            type: String,
            enum: ['receipt', 'photo', 'video', 'screenshot', 'other'],
            required: true,
          },
          url: { type: String, required: true },
          filename: String,
          description: String,
          uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          uploadedAt: { type: Date, default: Date.now },
          fileSize: Number,
          mimeType: String,
        },
      ],
      timeline: [
        {
          event: { type: String, required: true },
          description: String,
          performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          timestamp: { type: Date, default: Date.now },
          metadata: mongoose.Schema.Types.Mixed,
        },
      ],
    },

    // ============================================
    // RETURN INFORMATION (RMA)
    // FIX M-02: returnInfo now has a top-level default so order.returnInfo
    // is never undefined on new documents. Previously the parent object had
    // no default, meaning order.returnInfo was undefined (not { status:'none' })
    // for any order that had never had a return — causing TypeErrors on any
    // direct property access without optional chaining.
    // ============================================
    returnInfo: {
      type: {
        // UPDATED: added items_reviewed, plea_submitted, awaiting_discount
        // to support the new return flow states. Existing statuses unchanged.
        status: {
          type: String,
          enum: [
            'none',
            'requested',
            'approved',
            'rejected',
            'items_reviewed',
            'plea_submitted',
            'awaiting_discount',
            'in_transit',
            'received',
            'inspected',
            'completed',
            'cancelled',
          ],
          default: 'none',
        },
        rmaNumber: String,
        reason: String,
        description: String,

        // UPDATED: added adminDecision and adminRejectionReason per item
        // so the admin can approve or reject individual items rather than
        // the whole return in one shot. All existing fields preserved.
        itemsToReturn: [
          {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            quantity: Number,
            condition: String,
            reason: String,
            // NEW — per-item admin decision set during reviewReturnRequest
            // and resolveAfterPlea. Default 'pending' so existing documents
            // without this field are treated as not yet reviewed.
            adminDecision: {
              type: String,
              enum: ['approved', 'rejected', 'pending'],
              default: 'pending',
            },
            // NEW — required when adminDecision is 'rejected'.
            // Stored so the customer can see exactly why each item was rejected.
            adminRejectionReason: { type: String, default: '' },
          },
        ],

        returnLabel: {
          url: String,
          carrier: String,
          trackingNumber: String,
        },
        inspectionNotes: String,
        inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        inspectedAt: Date,

        // restockFee kept for backwards compatibility with existing documents.
        // New code paths must never write to this field — all returns are now
        // handled via discount code only and no fee is charged.
        restockFee: { type: Number, default: 0 },

        requestedAmount: Number,
        requestedAt: Date,
        requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        approvedAt: Date,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        receivedAt: Date,
        completedAt: Date,
        adminNote: String,

        // NEW — records the date/time the customer explicitly acknowledged
        // the return policy (discount-code-only, non-refundable items) on
        // the policy screen before submitting their return request.
        policyAcknowledgedAt: { type: Date, default: null },

        // NEW — the 48-hour window within which the customer can submit a
        // plea after the admin posts per-item decisions. Set by the controller
        // when status transitions to items_reviewed. Auto-expires to
        // awaiting_discount if the customer does not act within 48 hours.
        pleaDeadline: { type: Date, default: null },

        // NEW — the 48-hour window for any pending customer action after
        // the plea round resolves and the process moves toward discount
        // generation. Currently used as a safety expiry gate.
        acceptanceDeadline: { type: Date, default: null },

        // NEW — tracks how many plea attempts the customer has made.
        // Maximum of 1 plea is allowed. Once pleaAttempts reaches 1 the
        // plea option is permanently locked regardless of status.
        pleaAttempts: { type: Number, default: 0 },

        // NEW — the calculated total value of all admin-approved items.
        // Set by reviewReturnRequest and recalculated by resolveAfterPlea.
        // Passed to the discount creation page so the admin can pre-populate
        // the discount value without manually summing approved items.
        discountValue: { type: Number, default: 0 },

        // NEW — stores the customer's plea submission.
        // pleaDescription: the customer's written argument for reconsidering
        //   rejected items.
        // pleaSubmittedAt: timestamp of submission.
        // pleaDocuments: additional evidence uploaded alongside the plea,
        //   using the same structure as the top-level documents array so
        //   existing upload helpers work without modification.
        pleaInfo: {
          pleaDescription: { type: String, default: '' },
          pleaSubmittedAt: { type: Date, default: null },
          pleaDocuments: [
            {
              type: {
                type: String,
                enum: ['photo', 'video', 'receipt', 'other'],
                required: true,
              },
              url: { type: String, required: true },
              filename: String,
              description: String,
              uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
              uploadedAt: { type: Date, default: Date.now },
              fileSize: Number,
              mimeType: String,
            },
          ],
        },

        messages: [
          {
            sender: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            senderType: {
              type: String,
              enum: ['customer', 'admin', 'system'],
              required: true,
            },
            content: { type: String, required: true },
            attachments: [
              {
                url: String,
                filename: String,
                fileType: String,
                fileSize: Number,
                uploadedAt: { type: Date, default: Date.now },
              },
            ],
            isRead: { type: Boolean, default: false },
            readAt: Date,
            deliveredAt: Date,
            createdAt: { type: Date, default: Date.now },
            isEdited: Boolean,
            editedAt: Date,
          },
        ],
        timeline: [
          {
            event: { type: String, required: true },
            description: String,
            performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            timestamp: { type: Date, default: Date.now },
            metadata: mongoose.Schema.Types.Mixed,
          },
        ],
        documents: [
          {
            type: {
              type: String,
              enum: ['photo', 'video', 'receipt', 'other'],
              required: true,
            },
            url: { type: String, required: true },
            filename: String,
            description: String,
            uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            uploadedAt: { type: Date, default: Date.now },
            fileSize: Number,
            mimeType: String,
          },
        ],
      },
      // FIX M-02: guarantees order.returnInfo is always { status: 'none' }
      // on new documents, never undefined.
      default: () => ({ status: 'none' }),
    },

    // ============================================
    // ORDER STATUS & TIMELINE
    // ============================================
    orderStatus: {
      type: String,
      enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
      default: 'Processing',
    },

    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
        location: String,
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],

    deliveredAt: Date,
    cancelledAt: Date,
    cancellationReason: String,

    // ============================================
    // SHIPMENT & TRACKING
    // ============================================
    shipments: [
      {
        shipmentId: String,
        warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
        items: [
          {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            quantity: Number,
            name: String,
          },
        ],
        carrier: String,
        trackingNumber: String,
        status: {
          type: String,
          enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
          default: 'Processing',
        },
        shippedAt: Date,
        deliveredAt: Date,
        weight: Number,
        dimensions: {
          length: Number,
          width: Number,
          height: Number,
          unit: { type: String, default: 'cm' },
        },
      },
    ],

    tracking: {
      carrier: { type: String, enum: ['DHL', 'FedEx', 'UPS', 'USPS', 'Other'] },
      trackingNumber: String,
      trackingUrl: String,
      estimatedDelivery: Date,
      currentLocation: String,
      trackingHistory: [
        {
          status: String,
          location: String,
          timestamp: Date,
          description: String,
        },
      ],
      lastUpdated: Date,
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
      history: [
        {
          version: Number,
          pdfData: String,
          generatedAt: Date,
          reason: String,
        },
      ],
      billingAddress: mongoose.Schema.Types.Mixed,
      companyInfo: {
        name: String,
        taxId: String,
        registrationNumber: String,
      },
    },

    // ============================================
    // NOTES & COMMUNICATION
    // ============================================
    notes: [
      {
        content: { type: String, required: true },
        type: { type: String, enum: ['internal', 'customer'], default: 'internal' },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
        attachments: [String],
        isEdited: Boolean,
        editedAt: Date,
      },
    ],

    // ============================================
    // ANALYTICS & ATTRIBUTION
    // ============================================
    analytics: {
      source: {
        type: String,
        enum: ['organic', 'paid', 'referral', 'email', 'social', 'direct'],
      },
      medium: String,
      campaign: String,
      referrer: String,
      landingPage: String,
      device: { type: String, enum: ['mobile', 'tablet', 'desktop'] },
      browser: String,
      customerSegment: String,
      isFirstPurchase: Boolean,
      purchaseNumber: Number,
    },

    fulfillmentSLA: {
      promisedDelivery: Date,
      actualDelivery: Date,
      slaBreached: Boolean,
      delayInDays: Number,
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
        geoCheck: Boolean,
      },
    },

    auditLog: [
      {
        action: { type: String, required: true },
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        timestamp: { type: Date, default: Date.now },
        ipAddress: String,
        userAgent: String,
        changes: {
          field: String,
          oldValue: mongoose.Schema.Types.Mixed,
          newValue: mongoose.Schema.Types.Mixed,
        },
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  {
    timestamps: true,
    strict: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================

orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ totalPrice: -1 });

orderSchema.index({ 'paymentInfo.status': 1 });
orderSchema.index({ 'paymentInfo.method': 1 });
orderSchema.index({ 'paymentInfo.paidAt': -1 });

orderSchema.index({ 'refundInfo.status': 1, 'refundInfo.requestedAt': -1 });
orderSchema.index({ 'returnInfo.status': 1, 'returnInfo.requestedAt': -1 });

orderSchema.index({ cancelledAt: -1 });
orderSchema.index({ deliveredAt: -1 });

orderSchema.index({ 'fraudCheck.riskLevel': 1 });
orderSchema.index({ 'fraudCheck.reviewRequired': 1 });

orderSchema.index({ 'analytics.source': 1 });
orderSchema.index({ 'analytics.isFirstPurchase': 1 });

// NOTE: MongoDB cannot use a compound multikey index when both fields come
// from the same array. These are separate single-field indexes; senderType
// is applied as an in-memory filter after the isRead index scan.
orderSchema.index({ 'refundInfo.messages.isRead': 1 });
orderSchema.index({ 'refundInfo.messages.senderType': 1 });
orderSchema.index({ 'refundInfo.messages.createdAt': -1 });

orderSchema.index({ 'orderMessages.isRead': 1 });
orderSchema.index({ 'orderMessages.senderType': 1 });
orderSchema.index({ 'orderMessages.createdAt': -1 });

orderSchema.index({ 'returnInfo.messages.isRead': 1 });
orderSchema.index({ 'returnInfo.messages.senderType': 1 });
orderSchema.index({ 'returnInfo.messages.createdAt': -1 });

// NEW — index on pleaDeadline so the lazy timer-expiry check in the
// controller can efficiently find returns with an expired plea window
// without scanning the entire collection.
orderSchema.index({ 'returnInfo.pleaDeadline': 1 });

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
// Directionally asymmetric by design. Do not rename without updating callers.
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

// NEW — convenience virtual: true when the customer still has time and
// eligibility to submit a plea. Checks status, pleaAttempts cap, and
// whether the pleaDeadline has not yet passed.
orderSchema.virtual('canSubmitPlea').get(function () {
  if (this.returnInfo?.status !== 'items_reviewed') return false;
  if ((this.returnInfo?.pleaAttempts ?? 0) >= 1) return false;
  const deadline = this.returnInfo?.pleaDeadline;
  if (!deadline) return false;
  return new Date() < new Date(deadline);
});

// NEW — milliseconds remaining on the plea deadline. Returns 0 if expired
// or not set. Useful for rendering the countdown timer on the frontend
// without extra arithmetic.
orderSchema.virtual('pleaDeadlineMs').get(function () {
  const deadline = this.returnInfo?.pleaDeadline;
  if (!deadline) return 0;
  return Math.max(0, new Date(deadline) - new Date());
});

// NEW — total value of items the admin has individually approved.
// Calculated from itemsToReturn where adminDecision === 'approved'.
// Used as a cross-check against the stored discountValue field.
orderSchema.virtual('approvedItemsValue').get(function () {
  return (this.returnInfo?.itemsToReturn ?? [])
    .filter((item) => item.adminDecision === 'approved')
    .reduce((sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1), 0);
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });
orderSchema.set('strictQuery', true);

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
orderSchema.pre('save', function (next) {
  // Generate orderNumber once on first save from the tail of the ObjectId.
  // _id is always assigned before pre('save') fires so this is always safe.
  if (!this.orderNumber) {
    this.orderNumber = this._id.toString().slice(-8).toUpperCase();
  }

  // Generate invoice number when payment succeeds, if not already set.
  // NOTE: Date.now() + process.pid entropy can collide under concurrent saves
  // at millisecond resolution. The unique index will catch it. For production
  // at scale replace with an atomic counter or UUID.
  if (!this.invoiceInfo?.invoiceNumber && this.paymentInfo?.status === 'success') {
    const now     = new Date();
    const year    = now.getFullYear();
    const month   = String(now.getMonth() + 1).padStart(2, '0');
    const entropy = Date.now().toString(36).toUpperCase() + process.pid.toString(36).toUpperCase();
    this.invoiceInfo               = this.invoiceInfo || {};
    this.invoiceInfo.invoiceNumber = `INV-${year}${month}-${entropy}`;
    this.invoiceInfo.invoiceDate   = now;
  }

  // FIX M-01: this is now the ONLY place rmaNumber is generated.
  // The controller (reviewReturnRequest) previously also generated it with a
  // different format (`RMA-${Date.now()}`), creating two divergent formats.
  // That assignment has been removed from the controller.
  // Format: RMA-YYYYMM-<8 uppercase hex chars> — human-readable and consistent.
  if (this.returnInfo?.status === 'approved' && !this.returnInfo.rmaNumber) {
    const now     = new Date();
    const year    = now.getFullYear();
    const month   = String(now.getMonth() + 1).padStart(2, '0');
    const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
    this.returnInfo.rmaNumber = `RMA-${year}${month}-${entropy}`;
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

// UPDATED: added new statuses to the $in list so these returns surface
// in the active returns query used by admin dashboards.
orderSchema.statics.getActiveReturns = async function () {
  return this.find({
    'returnInfo.status': {
      $in: [
        'requested',
        'approved',
        'items_reviewed',
        'plea_submitted',
        'awaiting_discount',
        'in_transit',
        'received',
        'inspected',
      ],
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

// FIX P-03: rewritten as an aggregation so full message arrays are never
// loaded into memory. The previous .find() implementation hydrated every
// message for every matching order — for a 500-message order that was
// 500 objects loaded just to extract one count and one preview.
// This aggregation computes the unread count and extracts the latest
// message entirely within MongoDB, sending only what the controller needs.
//
// UPDATED: items_reviewed, plea_submitted, awaiting_discount removed from
// the $nin exclusion list so these active statuses correctly appear in the
// unread messages queue. Only truly closed statuses are excluded.
orderSchema.statics.getReturnsWithUnreadMessages = async function () {
  return this.aggregate([
    {
      $match: {
        'returnInfo.status': {
          $nin: ['none', 'completed', 'cancelled'],
          // NOTE: 'rejected' intentionally removed from $nin here compared
          // to the original. A rejection followed by a plea means the return
          // is still active and messages should surface. The canAddReturnMessage
          // middleware is the enforcement gate for who can write; this query
          // is read-only and should be inclusive of all active returns.
        },
        'returnInfo.messages': { $elemMatch: { isRead: false, senderType: 'customer' } },
      },
    },
    {
      $lookup: {
        from:         'users',
        localField:   'user',
        foreignField: '_id',
        pipeline:     [{ $project: { firstName: 1, lastName: 1, email: 1 } }],
        as:           'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        user:        1,
        orderNumber: 1,
        'returnInfo.status':    1,
        'returnInfo.rmaNumber': 1,
        'returnInfo.reason':    1,
        // Compute unread count without loading the full messages array
        unreadReturnMessages: {
          $size: {
            $filter: {
              input: { $ifNull: ['$returnInfo.messages', []] },
              as:    'm',
              cond: {
                $and: [
                  { $eq: ['$$m.isRead',     false] },
                  { $eq: ['$$m.senderType', 'customer'] },
                ],
              },
            },
          },
        },
        // Latest message preview only — never loads the full array
        latestReturnMessage: { $arrayElemAt: ['$returnInfo.messages', -1] },
      },
    },
    { $sort: { 'latestReturnMessage.createdAt': -1 } },
    { $limit: 50 },
  ]);
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
    sender,
    senderType,
    message, // stored field name is 'message' — see schema comment above
    attachments,
    isRead: false,
    createdAt: new Date(),
  });
  this.addRefundTimeline('message_sent', `New message from ${senderType}`, sender);
};

// Semantics: pass the READER's role.
// Marks messages FROM the other party as read.
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

// Semantics: pass the READER's role (same convention as markRefundMessagesAsRead).
// Marks messages FROM the other party as read.
// e.g. markReturnMessagesAsRead('admin') marks customer messages as read.
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

// NEW — adds a document to the plea evidence array specifically.
// Keeps plea evidence separate from the main return documents array
// so the admin can distinguish original submission evidence from
// plea evidence at a glance.
orderSchema.methods.addPleaDocument = function (type, url, filename, uploadedBy, description = '') {
  if (!this.returnInfo) this.returnInfo = { status: 'none' };
  if (!this.returnInfo.pleaInfo) this.returnInfo.pleaInfo = {};
  if (!this.returnInfo.pleaInfo.pleaDocuments) this.returnInfo.pleaInfo.pleaDocuments = [];
  this.returnInfo.pleaInfo.pleaDocuments.push({
    type, url, filename, description, uploadedBy, uploadedAt: new Date(),
  });
  this.addReturnTimeline('plea_document_uploaded', `Plea evidence uploaded: ${filename}`, uploadedBy);
};

export default mongoose.model('Order', orderSchema);