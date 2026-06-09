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
        category: String,
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
    // ============================================
    returnInfo: {
      type: {

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
        itemsToReturn: [
          {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            quantity: Number,
            condition: String,
            reason: String,
            // FIX BUG-17 — unit price at the time the return was requested.
            // Stamped by requestReturn controller from order.orderItems[].price.
            price: { type: Number, default: 0 },
            // NEW — per-item admin decision
            adminDecision: {
              type: String,
              enum: ['approved', 'rejected', 'pending'],
              default: 'pending',
            },
            
            adminRejectionReason: { type: String, default: '' },
            approvedQuantity: { type: Number, default: null },
            pleaQuantity:           { type: Number, default: null },
            silentAcceptedQuantity: { type: Number, default: 0    },
            pleaApprovedQty:        { type: Number, default: null },
            pleaRejectedQty:        { type: Number, default: null },
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

        // restockFee kept for backwards compatibility only. Never written
        // to by new code paths.
        restockFee: { type: Number, default: 0 },

        requestedAmount: Number,
        requestedAt: Date,
        requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        approvedAt: Date,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        receivedAt: Date,
        completedAt: Date,
        adminNote: String,

        // NEW — records when the customer acknowledged the return policy
        policyAcknowledgedAt: { type: Date, default: null },

        pleaDeadline: { type: Date, default: null },

        acceptanceDeadline: { type: Date, default: null },

        pleaAttempts: { type: Number, default: 0 },

        discountValue: { type: Number, default: 0 },

        requestedGross:  { type: Number, default: 0 }, // all requested items × quantity × price
        approvedGross:   { type: Number, default: 0 }, // approved items × approvedQuantity × price
        rejectedGross:   { type: Number, default: 0 }, // rejected items × quantity × price
        approvedDiscount: { type: Number, default: 0 }, // proportional discount deducted from approvedGross
        shippingDeducted: { type: Number, default: 0 },

        // NEW — customer's plea submission.
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
      // ── Existing fields ─────────────────────────────────────────────────
source: {
  type: String,
  enum: [
    // ── Channel categories ────────────────────────
    'direct',
    'organic',
    'paid',
    'referral',
    'email',
    'social',

    // ── Search engines ────────────────────────────
    'google',
    'bing',
    'yahoo',
    'duckduckgo',
    'baidu',
    'yandex',

    // ── Social platforms ──────────────────────────
    'facebook',
    'instagram',
    'meta',
    'twitter',
    'x',
    'tiktok',
    'snapchat',
    'pinterest',
    'linkedin',
    'youtube',
    'reddit',
    'whatsapp',
    'telegram',
    'threads',
    'discord',

    // ── Ad networks ───────────────────────────────
    'google_ads',
    'meta_ads',
    'tiktok_ads',
    'bing_ads',
    'twitter_ads',
    'linkedin_ads',
    'pinterest_ads',
    'snapchat_ads',
    'amazon_ads',
    'taboola',
    'outbrain',
    'criteo',

    // ── Email platforms ───────────────────────────
    'klaviyo',
    'mailchimp',
    'sendgrid',
    'hubspot',
    'newsletter',

    // ── Affiliate / referral ──────────────────────
    'affiliate',
    'influencer',
    'partner',

    // ── Reconstruction values (Phase 3) ───────────
    'dark_social',
    'returning_direct',
    'likely_email_or_social',
    'likely_retargeting',
    'likely_organic',

    // ── Fallback for unrecognized sources ─────────
    'other',
  ],
  default: 'direct',
},

      medium:          { type: String, default: null },
      campaign:        { type: String, default: null },
      referrer:        { type: String, default: null },
      landingPage:     { type: String, default: null },
      device:          { type: String, enum: ['mobile', 'tablet', 'desktop'], default: null },
      browser:         { type: String, default: null },
      customerSegment: { type: String, default: null },
      isFirstPurchase: { type: Boolean, default: false },
      purchaseNumber:  { type: Number,  default: 1 },

      // ── Phase 2 additions ────────────────────────────────────────────────

      // Deduplication key — UUID generated by browser SDK, passed in request body,
      // reused identically for GA4 Measurement Protocol and Meta CAPI event_id.
      // Null for orders created before Phase 1 was deployed.
      eventId: {
        type:    String,
        default: null,
        
      },

      // Anonymous ID from epicstore_anon cookie (identityMiddleware.js).
      // Enables BigQuery JOIN: pre-auth browsing events → authenticated purchase.
      // Null for orders placed before Phase 2 was deployed.
      anonymousId: {
        type:    String,
        default: null,
       
      },

      // Click IDs — stored permanently on the order even after cookie windows expire.
      gclid:   { type: String, default: null }, // Google Ads — 90-day attribution window
      fbclid:  { type: String, default: null }, // Meta/Facebook — 7-day attribution window
      ttclid:  { type: String, default: null }, // TikTok — 7-day attribution window
      msclkid: { type: String, default: null }, // Microsoft Ads — 90-day attribution window

      // Attribution confidence — computed by attributionMiddleware.js (Phase 3).
      // Range: 0.0 → 1.0. Null for orders before Phase 3 deployment.
      confidenceScore: {
        type:    Number,
        default: null,
        min:     0,
        max:     1,
      },
      // Human-readable confidence tier derived from confidenceScore.
      confidenceLevel: {
        type:    String,
        enum:    ['HIGH', 'MEDIUM', 'LOW', null],
        default: null,
      },

      // Reconstruction flag — true when source was inferred by the referrer
      // reconstruction engine (Phase 4) rather than captured from UTMs/click IDs.
      // Query { isReconstructed: true } to get orders with directional attribution.
      isReconstructed: {
        type:    Boolean,
        default: false,
      },
      // The specific reconstruction rule that fired. Null when isReconstructed is false.
      reconstructionRule: {
        type:    String,
        default: null,
      },
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
// Phase 2 — analytics attribution indexes
orderSchema.index({ 'analytics.eventId': 1 });
orderSchema.index({ 'analytics.anonymousId': 1 });
orderSchema.index({ 'analytics.confidenceLevel': 1 });
orderSchema.index({ 'analytics.isReconstructed': 1 });

orderSchema.index({ 'refundInfo.messages.isRead': 1 });
orderSchema.index({ 'refundInfo.messages.senderType': 1 });
orderSchema.index({ 'refundInfo.messages.createdAt': -1 });

orderSchema.index({ 'orderMessages.isRead': 1 });
orderSchema.index({ 'orderMessages.senderType': 1 });
orderSchema.index({ 'orderMessages.createdAt': -1 });

orderSchema.index({ 'returnInfo.messages.isRead': 1 });
orderSchema.index({ 'returnInfo.messages.senderType': 1 });
orderSchema.index({ 'returnInfo.messages.createdAt': -1 });

orderSchema.index({ "discounts.codes.code": 1 },{ sparse: true });

// Index on pleaDeadline for efficient lazy timer-expiry queries
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

orderSchema.virtual('canSubmitPlea').get(function () {
  if (this.returnInfo?.status !== 'items_reviewed') return false;
  if ((this.returnInfo?.pleaAttempts ?? 0) >= 1) return false;
  const deadline = this.returnInfo?.pleaDeadline;
  if (!deadline) return false;
  return new Date() < new Date(deadline);
});

orderSchema.virtual('pleaDeadlineMs').get(function () {
  const deadline = this.returnInfo?.pleaDeadline;
  if (!deadline) return 0;
  return Math.max(0, new Date(deadline) - new Date());
});


orderSchema.virtual('approvedItemsValue').get(function () {
  return (this.returnInfo?.itemsToReturn ?? [])
    .filter((item) => (item.approvedQuantity ?? 0) > 0)
    .reduce((sum, item) => sum + (item.price ?? 0) * (item.approvedQuantity ?? 0), 0);
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });
orderSchema.set('strictQuery', true);

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
orderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    this.orderNumber = this._id.toString().slice(-8).toUpperCase();
  }

  if (!this.invoiceInfo?.invoiceNumber && this.paymentInfo?.status === 'success') {
    const now     = new Date();
    const year    = now.getFullYear();
    const month   = String(now.getMonth() + 1).padStart(2, '0');
    const entropy = Date.now().toString(36).toUpperCase() + process.pid.toString(36).toUpperCase();
    this.invoiceInfo               = this.invoiceInfo || {};
    this.invoiceInfo.invoiceNumber = `INV-${year}${month}-${entropy}`;
    this.invoiceInfo.invoiceDate   = now;
  }

  const triggerStatuses = ['approved', 'items_reviewed'];
  if (
    triggerStatuses.includes(this.returnInfo?.status) &&
    !this.returnInfo.rmaNumber
  ) {
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

// UPDATED: added new statuses to the $in list
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

orderSchema.statics.getReturnsWithUnreadMessages = async function () {
  return this.aggregate([
    {
      $match: {
        'returnInfo.status': {
          $nin: ['none', 'completed', 'cancelled', 'rejected'],
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
    sender, senderType, message, attachments,
    isRead: false, createdAt: new Date(),
  });
  this.addRefundTimeline('message_sent', `New message from ${senderType}`, sender);
};

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

// Semantics: pass the READER's role.
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

// adds evidence to the plea documents array specifically.
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