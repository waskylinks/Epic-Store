import mongoose from "mongoose";

const checkoutSchema = new mongoose.Schema(
  {
    // ============================================
    // USER & SESSION
    // ============================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    email: {
      type: String,
      required: true,
      index: true
    },

    // ============================================
    // CHECKOUT ITEMS
    // ============================================
    items: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true
      },
      name: String,
      price: Number,
      quantity: Number,
      image: String
    }],

    // ============================================
    // PRICING
    // ============================================
    pricing: {
      itemPrice: Number,
      taxPrice: Number,
      shippingPrice: Number,
      discountAmount: {
        type: Number,
        default: 0
      },
      totalPrice: Number,
      currency: {
        type: String,
        default: 'USD'
      }
    },

    // ============================================
    // SHIPPING INFO
    // ============================================
    shippingInfo: {
      firstName: String,
      lastName: String,
      address: String,
      city: String,
      state: String,
      pinCode: String,
      country: String,
      phoneNo: String
    },

    // ============================================
    // DISCOUNT APPLIED
    // ============================================
    discount: {
      code: String,
      discountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Discount"
      },
      discountAmount: Number
    },

    // ============================================
    // CHECKOUT STATUS
    // ============================================
    status: {
      type: String,
      enum: ['pending', 'completed', 'abandoned', 'expired'],
      default: 'pending',
      index: true
    },

    // ============================================
    // CHECKOUT STEP TRACKING
    // ============================================
    currentStep: {
      type: String,
      enum: ['shipping_info', 'payment_selection', 'payment_gateway', 'payment_failed'],
      default: 'shipping_info'
    },

    stepsCompleted: [{
      step: String,
      completedAt: Date
    }],

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
      abandonedAtStep: String,
      
      // Recovery attempts
      recoveryEmailSent: {
        type: Boolean,
        default: false
      },
      recoveryEmailSentAt: Date,
      recoveryEmailCount: {
        type: Number,
        default: 0
      },
      
      recovered: {
        type: Boolean,
        default: false
      },
      recoveredAt: Date
    },

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
      paymentReference: String
    },

    // ============================================
    // ANALYTICS
    // ============================================
    analytics: {
      source: {
        type: String,
        enum: ['organic', 'paid', 'referral', 'email', 'social', 'direct'],
        default: 'direct'
      },
      medium: String,
      campaign: String,
      referrer: String,
      landingPage: String,
      device: {
        type: String,
        enum: ['mobile', 'tablet', 'desktop']
      },
      browser: String
    },

    // ============================================
    // PAYMENT GATEWAY
    // ============================================
    selectedGateway: {
      type: String,
      enum: ['stripe', 'paystack', 'flutterwave']
    },

    paymentInitialized: {
      type: Boolean,
      default: false
    },

    paymentInitializedAt: Date,

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

    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// INDEXES
// ============================================
checkoutSchema.index({ createdAt: -1 });
checkoutSchema.index({ status: 1, lastActivityAt: -1 });
checkoutSchema.index({ 'abandonment.isAbandoned': 1, 'abandonment.abandonedAt': -1 });
checkoutSchema.index({ user: 1, status: 1 });
checkoutSchema.index({ email: 1, status: 1 });
checkoutSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-cleanup after 30 days

// ============================================
// VIRTUALS
// ============================================

// Minutes since last activity
checkoutSchema.virtual('minutesSinceLastActivity').get(function() {
  if (!this.lastActivityAt) return 0;
  return Math.floor((Date.now() - this.lastActivityAt.getTime()) / (1000 * 60));
});

// Should be marked as abandoned (24 hours of inactivity)
checkoutSchema.virtual('shouldBeAbandoned').get(function() {
  return this.status === 'pending' && this.minutesSinceLastActivity >= 1440; // 24 hours
});

// Recovery priority (0-100)
checkoutSchema.virtual('recoveryPriority').get(function() {
  if (!this.abandonment.isAbandoned) return 0;
  
  let score = 0;
  
  // Cart value (40 points)
  const total = this.pricing?.totalPrice || 0;
  if (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50) score += 10;
  
  // Has shipping info (20 points) - they were serious
  if (this.shippingInfo?.address) score += 20;
  
  // Item count (20 points)
  const items = this.items?.length || 0;
  if (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else score += 5;
  
  // Recency (20 points)
  const hoursSinceAbandoned = this.abandonment.abandonedAt 
    ? Math.floor((Date.now() - this.abandonment.abandonedAt.getTime()) / (1000 * 60 * 60))
    : 0;
  if (hoursSinceAbandoned < 6) score += 20;
  else if (hoursSinceAbandoned < 24) score += 15;
  else if (hoursSinceAbandoned < 48) score += 10;
  else if (hoursSinceAbandoned < 72) score += 5;
  
  return Math.min(100, score);
});

// ============================================
// STATIC METHODS
// ============================================

// Get abandonment rate for timeframe
checkoutSchema.statics.getAbandonmentRate = async function(startDate, endDate) {
  const totalCheckouts = await this.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate }
  });
  
  const abandonedCheckouts = await this.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    'abandonment.isAbandoned': true
  });
  
  const rate = totalCheckouts > 0 ? (abandonedCheckouts / totalCheckouts) * 100 : 0;
  
  return {
    totalCheckouts,
    abandonedCheckouts,
    convertedCheckouts: totalCheckouts - abandonedCheckouts,
    abandonmentRate: Math.round(rate * 100) / 100
  };
};

// Get recovery opportunities
checkoutSchema.statics.getRecoveryOpportunities = async function(limit = 50) {
  const checkouts = await this.find({
    'abandonment.isAbandoned': true,
    'abandonment.recoveryEmailSent': false,
    'conversion.isConverted': false,
    status: 'abandoned'
  })
    .populate('user', 'firstName lastName email')
    .populate('items.product', 'name images')
    .sort({ 'pricing.totalPrice': -1 })
    .limit(limit)
    .lean();
  
  return checkouts;
};

// ============================================
// INSTANCE METHODS
// ============================================

// Update checkout step
checkoutSchema.methods.updateStep = function(step) {
  this.currentStep = step;
  this.stepsCompleted.push({
    step,
    completedAt: new Date()
  });
  this.lastActivityAt = new Date();
};

// Mark as abandoned
checkoutSchema.methods.markAsAbandoned = function() {
  this.abandonment.isAbandoned = true;
  this.abandonment.abandonedAt = new Date();
  this.abandonment.abandonedAtStep = this.currentStep;
  this.status = 'abandoned';
};

// Mark as converted
checkoutSchema.methods.markAsConverted = function(orderId, paymentReference) {
  this.conversion.isConverted = true;
  this.conversion.convertedAt = new Date();
  this.conversion.orderId = orderId;
  this.conversion.paymentReference = paymentReference;
  this.status = 'completed';
};

// Mark recovery email sent
checkoutSchema.methods.markRecoveryEmailSent = function() {
  this.abandonment.recoveryEmailSent = true;
  this.abandonment.recoveryEmailSentAt = new Date();
  this.abandonment.recoveryEmailCount += 1;
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
checkoutSchema.pre('save', function(next) {
  // Set expiration date (30 days from last activity)
  if (this.isModified('lastActivityAt') || !this.expiresAt) {
    const expiryDate = new Date(this.lastActivityAt || Date.now());
    expiryDate.setDate(expiryDate.getDate() + 30);
    this.expiresAt = expiryDate;
  }
  
  next();
});

export default mongoose.model("Checkout", checkoutSchema);