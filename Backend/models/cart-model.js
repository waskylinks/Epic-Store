import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    // ============================================
    // SESSION & USER IDENTIFICATION
    // ============================================
    sessionId: {
      type: String,
      required: true,
      index: true,
      unique: true
    },
    
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
      // Optional - can be null for guest carts
    },

    // ============================================
    // CART ITEMS
    // ============================================
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true
        },
        name: String,
        price: Number,
        quantity: {
          type: Number,
          required: true,
          min: 1
        },
        image: String,
        addedAt: {
          type: Date,
          default: Date.now
        },
        // Track modifications to this item
        modifiedAt: Date,
        removedAt: Date // Soft delete for analytics
      }
    ],

    // ============================================
    // CART STATUS
    // ============================================
    status: {
      type: String,
      enum: ['active', 'abandoned', 'converted', 'expired'],
      default: 'active',
      index: true
    },

    // ============================================
    // FINANCIAL TRACKING
    // ============================================
    pricing: {
      subtotal: {
        type: Number,
        default: 0
      },
      tax: {
        type: Number,
        default: 0
      },
      shipping: {
        type: Number,
        default: 0
      },
      discount: {
        type: Number,
        default: 0
      },
      total: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'USD'
      }
    },

    // Applied discount codes
    discountCodes: [{
      code: String,
      amount: Number,
      type: {
        type: String,
        enum: ['percentage', 'fixed']
      },
      appliedAt: {
        type: Date,
        default: Date.now
      }
    }],

    // ============================================
    // CONVERSION TRACKING
    // ============================================
    conversion: {
      isConverted: {
        type: Boolean,
        default: false,
        index: true
      },
      convertedAt: Date,
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order"
      },
      // Time from cart creation to conversion
      conversionTimeMinutes: Number
    },

    // ============================================
    // ABANDONMENT TRACKING
    // ============================================
    abandonment: {
      isAbandoned: {
        type: Boolean,
        default: false,
        index: true
      },
      abandonedAt: Date,
      abandonedAtStep: {
        type: String,
        enum: ['cart', 'checkout', 'payment', 'review'],
        default: 'cart'
      },
      // Reasons for abandonment (from exit surveys or behavior)
      possibleReasons: [{
        type: String,
        enum: [
          'high_shipping_cost',
          'unexpected_costs',
          'long_checkout',
          'payment_issues',
          'out_of_stock',
          'comparison_shopping',
          'trust_concerns',
          'other'
        ]
      }],
      // Recovery attempts
      recoveryEmailSent: {
        type: Boolean,
        default: false
      },
      recoveryEmailSentAt: Date,
      recovered: {
        type: Boolean,
        default: false
      },
      recoveredAt: Date
    },

    // ============================================
    // FUNNEL TRACKING
    // ============================================
    funnelSteps: [{
      step: {
        type: String,
        enum: ['cart_view', 'checkout_start', 'shipping_info', 'payment_info', 'review_order', 'order_complete'],
        required: true
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      // Additional metadata for each step
      metadata: mongoose.Schema.Types.Mixed
    }],

    // Last funnel step reached
    lastFunnelStep: {
      type: String,
      enum: ['cart_view', 'checkout_start', 'shipping_info', 'payment_info', 'review_order', 'order_complete']
    },

    // ============================================
    // SESSION ANALYTICS
    // ============================================
    analytics: {
      // Marketing attribution
      source: {
        type: String,
        enum: ['organic', 'paid', 'referral', 'email', 'social', 'direct'],
        index: true
      },
      medium: String,
      campaign: String,
      referrer: String,
      landingPage: String,

      // Device information
      device: {
        type: String,
        enum: ['mobile', 'tablet', 'desktop']
      },
      browser: String,
      os: String,

      // Geographic
      country: String,
      city: String,
      region: String,
      ipAddress: String,

      // Engagement metrics
      pageViews: {
        type: Number,
        default: 0
      },
      sessionDuration: Number, // in seconds
      
      // Cart-specific metrics
      itemsAddedCount: {
        type: Number,
        default: 0
      },
      itemsRemovedCount: {
        type: Number,
        default: 0
      },
      cartModifications: {
        type: Number,
        default: 0
      }
    },

    // ============================================
    // TIMESTAMPS
    // ============================================
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    expiresAt: {
      type: Date,
      index: true
      // Auto-set to 30 days from last activity
    },

    // ============================================
    // NOTES & FLAGS
    // ============================================
    notes: [{
      content: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Flag for admin attention (e.g., high-value abandoned cart)
    flaggedForReview: {
      type: Boolean,
      default: false
    },

    // ============================================
    // CUSTOMER COMMUNICATION
    // ============================================
    communicationLog: [{
      type: {
        type: String,
        enum: ['email', 'sms', 'push_notification'],
        required: true
      },
      template: String,
      sentAt: {
        type: Date,
        default: Date.now
      },
      opened: Boolean,
      openedAt: Date,
      clicked: Boolean,
      clickedAt: Date
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
cartSchema.index({ createdAt: -1 });
cartSchema.index({ status: 1, lastActivityAt: -1 });
cartSchema.index({ 'abandonment.isAbandoned': 1, 'abandonment.abandonedAt': -1 });
cartSchema.index({ 'conversion.isConverted': 1, 'conversion.convertedAt': -1 });
cartSchema.index({ 'analytics.source': 1, status: 1 });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup
cartSchema.index({ sessionId: 1, status: 1 });
cartSchema.index({ user: 1, status: 1, createdAt: -1 });

// Compound indexes for analytics queries
cartSchema.index({ status: 1, createdAt: -1, 'pricing.total': -1 });
cartSchema.index({ 'abandonment.isAbandoned': 1, 'abandonment.recoveryEmailSent': 1 });

// ============================================
// VIRTUALS
// ============================================

// Total number of items in cart
cartSchema.virtual('itemCount').get(function() {
  if (!this.items) return 0;
  return this.items
    .filter(item => !item.removedAt)
    .reduce((sum, item) => sum + item.quantity, 0);
});

// Check if cart is empty
cartSchema.virtual('isEmpty').get(function() {
  return this.itemCount === 0;
});

// Time since last activity (in minutes)
cartSchema.virtual('minutesSinceLastActivity').get(function() {
  if (!this.lastActivityAt) return 0;
  return Math.floor((Date.now() - this.lastActivityAt.getTime()) / (1000 * 60));
});

// Time since creation (in minutes)
cartSchema.virtual('ageInMinutes').get(function() {
  return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60));
});

// Is cart stale (no activity in 30 minutes)
cartSchema.virtual('isStale').get(function() {
  return this.minutesSinceLastActivity > 30;
});

// Should cart be considered abandoned (no activity in 60 minutes)
cartSchema.virtual('shouldBeAbandoned').get(function() {
  return this.status === 'active' && this.minutesSinceLastActivity >= 60;
});

// Cart value category
cartSchema.virtual('valueCategory').get(function() {
  const total = this.pricing?.total || 0;
  if (total === 0) return 'empty';
  if (total < 50) return 'low';
  if (total < 200) return 'medium';
  if (total < 500) return 'high';
  return 'very_high';
});

// Recovery priority score (0-100)
cartSchema.virtual('recoveryPriority').get(function() {
  if (!this.abandonment.isAbandoned) return 0;
  
  let score = 0;
  
  // Cart value weight (40 points max)
  const total = this.pricing?.total || 0;
  if (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50) score += 10;
  
  // Registered user weight (20 points)
  if (this.user) score += 20;
  
  // Item count weight (20 points max)
  const items = this.itemCount;
  if (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else score += 5;
  
  // Recency weight (20 points max)
  const hoursSinceAbandoned = this.abandonment.abandonedAt 
    ? Math.floor((Date.now() - this.abandonment.abandonedAt.getTime()) / (1000 * 60 * 60))
    : 0;
  if (hoursSinceAbandoned < 2) score += 20;
  else if (hoursSinceAbandoned < 6) score += 15;
  else if (hoursSinceAbandoned < 24) score += 10;
  else if (hoursSinceAbandoned < 48) score += 5;
  
  return Math.min(100, score);
});

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
cartSchema.pre('save', function(next) {
  // Calculate pricing totals
  if (this.items && this.items.length > 0) {
    const subtotal = this.items
      .filter(item => !item.removedAt)
      .reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    this.pricing.subtotal = Math.round(subtotal * 100) / 100;
    
    // Calculate tax (18%)
    this.pricing.tax = Math.round(this.pricing.subtotal * 0.18 * 100) / 100;
    
    // Calculate shipping (free over $500)
    this.pricing.shipping = this.pricing.subtotal >= 500 ? 0 : 50;
    
    // Calculate total
    const total = this.pricing.subtotal + this.pricing.tax + this.pricing.shipping - this.pricing.discount;
    this.pricing.total = Math.round(total * 100) / 100;
  }
  
  // Set expiration date (30 days from last activity)
  if (this.isModified('lastActivityAt') || !this.expiresAt) {
    const expiryDate = new Date(this.lastActivityAt || Date.now());
    expiryDate.setDate(expiryDate.getDate() + 30);
    this.expiresAt = expiryDate;
  }
  
  // Auto-mark as abandoned if criteria met
  if (this.shouldBeAbandoned && !this.abandonment.isAbandoned) {
    this.abandonment.isAbandoned = true;
    this.abandonment.abandonedAt = new Date();
    this.abandonment.abandonedAtStep = this.lastFunnelStep || 'cart';
    this.status = 'abandoned';
  }
  
  next();
});

// ============================================
// STATIC METHODS
// ============================================

// Get abandoned carts within timeframe
cartSchema.statics.getAbandonedCarts = async function(hours = 24, minValue = 0) {
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return this.find({
    'abandonment.isAbandoned': true,
    'abandonment.abandonedAt': { $gte: cutoffTime },
    'pricing.total': { $gte: minValue },
    'conversion.isConverted': false
  })
    .populate('user', 'firstName lastName email')
    .sort({ 'pricing.total': -1 })
    .lean();
};

// Get high-priority recovery opportunities
cartSchema.statics.getRecoveryOpportunities = async function(limit = 50) {
  const carts = await this.find({
    'abandonment.isAbandoned': true,
    'abandonment.recoveryEmailSent': false,
    'conversion.isConverted': false,
    status: 'abandoned'
  })
    .populate('user', 'firstName lastName email')
    .lean();
  
  // Calculate priority and sort
  return carts
    .map(cart => ({
      ...cart,
      // Recalculate priority client-side since virtuals don't work with lean()
      priority: this.calculatePriority(cart)
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
};

// Helper to calculate priority
cartSchema.statics.calculatePriority = function(cart) {
  let score = 0;
  const total = cart.pricing?.total || 0;
  
  if (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50) score += 10;
  
  if (cart.user) score += 20;
  
  const items = cart.items?.filter(i => !i.removedAt).length || 0;
  if (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else score += 5;
  
  const hoursSinceAbandoned = cart.abandonment?.abandonedAt 
    ? Math.floor((Date.now() - new Date(cart.abandonment.abandonedAt).getTime()) / (1000 * 60 * 60))
    : 0;
  if (hoursSinceAbandoned < 2) score += 20;
  else if (hoursSinceAbandoned < 6) score += 15;
  else if (hoursSinceAbandoned < 24) score += 10;
  else if (hoursSinceAbandoned < 48) score += 5;
  
  return Math.min(100, score);
};

// Get abandonment rate for a time period
cartSchema.statics.getAbandonmentRate = async function(startDate, endDate) {
  const totalCarts = await this.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $in: ['abandoned', 'converted'] }
  });
  
  const abandonedCarts = await this.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    'abandonment.isAbandoned': true
  });
  
  const rate = totalCarts > 0 ? (abandonedCarts / totalCarts) * 100 : 0;
  
  return {
    totalCarts,
    abandonedCarts,
    convertedCarts: totalCarts - abandonedCarts,
    abandonmentRate: Math.round(rate * 100) / 100
  };
};

// Get conversion funnel analytics
cartSchema.statics.getFunnelAnalytics = async function(startDate, endDate) {
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $unwind: { path: '$funnelSteps', preserveNullAndEmptyArrays: true }
    },
    {
      $group: {
        _id: '$funnelSteps.step',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ];
  
  return this.aggregate(pipeline);
};

// ============================================
// INSTANCE METHODS
// ============================================

// Add item to cart
cartSchema.methods.addItem = function(product, quantity = 1, price, name, image) {
  const existingItem = this.items.find(
    item => item.product.toString() === product.toString() && !item.removedAt
  );
  
  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.modifiedAt = new Date();
  } else {
    this.items.push({
      product,
      name,
      price,
      quantity,
      image,
      addedAt: new Date()
    });
    this.analytics.itemsAddedCount += 1;
  }
  
  this.lastActivityAt = new Date();
  this.analytics.cartModifications += 1;
};

// Remove item from cart
cartSchema.methods.removeItem = function(productId) {
  const item = this.items.find(
    item => item.product.toString() === productId.toString() && !item.removedAt
  );
  
  if (item) {
    item.removedAt = new Date();
    this.analytics.itemsRemovedCount += 1;
    this.analytics.cartModifications += 1;
  }
  
  this.lastActivityAt = new Date();
};

// Update item quantity
cartSchema.methods.updateItemQuantity = function(productId, quantity) {
  const item = this.items.find(
    item => item.product.toString() === productId.toString() && !item.removedAt
  );
  
  if (item) {
    item.quantity = quantity;
    item.modifiedAt = new Date();
    this.analytics.cartModifications += 1;
  }
  
  this.lastActivityAt = new Date();
};

// Add funnel step
cartSchema.methods.addFunnelStep = function(step, metadata = {}) {
  this.funnelSteps.push({
    step,
    timestamp: new Date(),
    metadata
  });
  
  this.lastFunnelStep = step;
  this.lastActivityAt = new Date();
};

// Mark as converted
cartSchema.methods.markAsConverted = function(orderId) {
  this.conversion.isConverted = true;
  this.conversion.convertedAt = new Date();
  this.conversion.orderId = orderId;
  this.conversion.conversionTimeMinutes = Math.floor(
    (Date.now() - this.createdAt.getTime()) / (1000 * 60)
  );
  this.status = 'converted';
};

// Mark recovery email sent
cartSchema.methods.markRecoveryEmailSent = function() {
  this.abandonment.recoveryEmailSent = true;
  this.abandonment.recoveryEmailSentAt = new Date();
  
  this.communicationLog.push({
    type: 'email',
    template: 'cart_abandonment',
    sentAt: new Date()
  });
};

// Mark as recovered
cartSchema.methods.markAsRecovered = function() {
  this.abandonment.recovered = true;
  this.abandonment.recoveredAt = new Date();
};

cartSchema.set("strictQuery", true);

export default mongoose.model("Cart", cartSchema);

