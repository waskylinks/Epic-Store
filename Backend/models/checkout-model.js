import mongoose from "mongoose";
import { deleteCachePattern } from '../utils/redis.js';

const checkoutSchema = new mongoose.Schema(
  {
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

    shippingInfo: {
      firstName: String,
      lastName: String,
      address: String,
      city: String,
      state: String,
      pinCode: String, // ✅ FIXED: Consistent field name
      country: String,
      phoneNo: String
    },

    discount: {
      code: String,
      discountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Discount"
      },
      discountAmount: Number
    },

    status: {
      type: String,
      enum: ['pending', 'completed', 'abandoned', 'expired'],
      default: 'pending',
      index: true
    },

    currentStep: {
      type: String,
      enum: ['shipping_info', 'payment_selection', 'payment_gateway', 'payment_failed'],
      default: 'shipping_info'
    },

    stepsCompleted: [{
      step: String,
      completedAt: Date
    }],

    abandonment: {
      isAbandoned: {
        type: Boolean,
        default: false,
        index: true
      },
      abandonedAt: Date,
      abandonedAtStep: String,
      
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
      recoveredAt: Date,
      recoveryTimeframe: Number,
      likelyFromEmail: Boolean
    },

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

    selectedGateway: {
      type: String,
      enum: ['stripe', 'paystack', 'flutterwave']
    },

    paymentInitialized: {
      type: Boolean,
      default: false
    },

    paymentInitializedAt: Date,

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
checkoutSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

checkoutSchema.index({
  'abandonment.isAbandoned': 1,
  'abandonment.abandonedAt': -1,
  'pricing.totalPrice': 1,
  'conversion.isConverted': 1
}, { 
  name: 'abandoned_checkout_query_idx'
});

checkoutSchema.index({
  'abandonment.isAbandoned': 1,
  'abandonment.recoveryEmailSent': 1,
  'conversion.isConverted': 1,
  status: 1,
  'pricing.totalPrice': -1
}, {
  name: 'recovery_opportunities_idx'
});

checkoutSchema.index({
  createdAt: -1,
  'analytics.source': 1,
  'analytics.device': 1,
  'abandonment.isAbandoned': 1
}, {
  name: 'analytics_segmentation_idx'
});

// ✅ NEW: Optimized index for active checkout queries
checkoutSchema.index({ 
  user: 1, 
  status: 1, 
  lastActivityAt: -1 
}, {
  name: 'user_active_checkout_idx'
});

// ============================================
// VIRTUALS
// ============================================

checkoutSchema.virtual('minutesSinceLastActivity').get(function() {
  if (!this.lastActivityAt) return 0;
  return Math.floor((Date.now() - this.lastActivityAt.getTime()) / (1000 * 60));
});

// ✅ FIXED: Use env variable instead of hardcoded 1440 minutes
checkoutSchema.virtual('shouldBeAbandoned').get(function() {
  const ABANDONMENT_THRESHOLD_HOURS = parseInt(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;
  const thresholdMinutes = ABANDONMENT_THRESHOLD_HOURS * 60;
  return this.status === 'pending' && this.minutesSinceLastActivity >= thresholdMinutes;
});

// ✅ IMPROVED: Centralized priority calculation (used by analytics controller)
checkoutSchema.virtual('recoveryPriority').get(function() {
  if (!this.abandonment.isAbandoned) return 0;
  
  let score = 0;
  
  // Value scoring (40 points max)
  const total = this.pricing?.totalPrice || 0;
  if (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50) score += 10;
  
  // Shipping info completion (20 points)
  if (this.shippingInfo?.address) score += 20;
  
  // Cart size (20 points max)
  const items = this.items?.length || 0;
  if (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else score += 5;
  
  // Recency scoring (20 points max)
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

checkoutSchema.statics.getAbandonmentRate = async function(startDate, endDate) {
  const stats = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        abandoned: {
          $sum: { $cond: ['$abandonment.isAbandoned', 1, 0] }
        },
        converted: {
          $sum: { $cond: ['$conversion.isConverted', 1, 0] }
        },
        pending: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
        },
        expired: {
          $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] }
        }
      }
    }
  ]);

  const result = stats[0] || { 
    total: 0, 
    abandoned: 0, 
    converted: 0, 
    pending: 0,
    expired: 0 
  };

  const completedCheckouts = result.abandoned + result.converted;
  const rate = completedCheckouts > 0 
    ? (result.abandoned / completedCheckouts) * 100 
    : 0;

  return {
    totalCheckouts: result.total,
    abandonedCheckouts: result.abandoned,
    convertedCheckouts: result.converted,
    pendingCheckouts: result.pending,
    expiredCheckouts: result.expired,
    completedCheckouts,
    abandonmentRate: Math.round(rate * 100) / 100,
    conversionRate: completedCheckouts > 0 
      ? Math.round((result.converted / completedCheckouts) * 10000) / 100
      : 0
  };
};

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

checkoutSchema.methods.updateStep = function(step) {
  this.currentStep = step;
  this.stepsCompleted.push({
    step,
    completedAt: new Date()
  });
  this.lastActivityAt = new Date();
};

checkoutSchema.methods.markAsAbandoned = function() {
  this.abandonment.isAbandoned = true;
  this.abandonment.abandonedAt = new Date();
  this.abandonment.abandonedAtStep = this.currentStep;
  this.status = 'abandoned';
  this._shouldInvalidateCache = true;
};

checkoutSchema.methods.markAsConverted = function(orderId, paymentReference) {
  this.conversion.isConverted = true;
  this.conversion.convertedAt = new Date();
  this.conversion.orderId = orderId;
  this.conversion.paymentReference = paymentReference;
  this.status = 'completed';
  
  if (this.abandonment.isAbandoned) {
    this.abandonment.recovered = true;
    this.abandonment.recoveredAt = new Date();
    
    if (this.abandonment.recoveryEmailSentAt) {
      const hoursAfterEmail = 
        (this.conversion.convertedAt - this.abandonment.recoveryEmailSentAt) / (1000 * 60 * 60);
      
      this.abandonment.recoveryTimeframe = hoursAfterEmail;
      this.abandonment.likelyFromEmail = hoursAfterEmail < 72;
    }
  }
  
  this._shouldInvalidateCache = true;
};

checkoutSchema.methods.canSendRecoveryEmail = function() {
  const MAX_ATTEMPTS = parseInt(process.env.MAX_RECOVERY_ATTEMPTS) || 3;
  const COOLDOWN_HOURS = parseInt(process.env.RECOVERY_COOLDOWN_HOURS) || 24;
  const MAX_AGE_DAYS = 7;

  if (this.conversion.isConverted) {
    return { canSend: false, reason: 'Checkout already converted' };
  }

  if (this.abandonment.recovered) {
    return { canSend: false, reason: 'Checkout already recovered' };
  }

  if (this.abandonment.recoveryEmailCount >= MAX_ATTEMPTS) {
    return { 
      canSend: false, 
      reason: `Maximum recovery attempts (${MAX_ATTEMPTS}) reached` 
    };
  }

  if (this.abandonment.recoveryEmailSentAt) {
    const hoursSinceLastEmail = 
      (Date.now() - this.abandonment.recoveryEmailSentAt.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceLastEmail < COOLDOWN_HOURS) {
      const hoursRemaining = Math.ceil(COOLDOWN_HOURS - hoursSinceLastEmail);
      return { 
        canSend: false, 
        reason: `Cooldown active. ${hoursRemaining} hours remaining before next email` 
      };
    }
  }

  const daysSinceAbandoned = this.abandonment.abandonedAt
    ? (Date.now() - this.abandonment.abandonedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  if (daysSinceAbandoned > MAX_AGE_DAYS) {
    return {
      canSend: false,
      reason: `Checkout abandoned ${Math.floor(daysSinceAbandoned)} days ago (max ${MAX_AGE_DAYS} days)`
    };
  }

  return { canSend: true };
};

checkoutSchema.methods.markRecoveryEmailSent = function() {
  const canSend = this.canSendRecoveryEmail();
  if (!canSend.canSend) {
    throw new Error(canSend.reason);
  }
  
  this.abandonment.recoveryEmailSent = true;
  this.abandonment.recoveryEmailSentAt = new Date();
  this.abandonment.recoveryEmailCount += 1;
  this._shouldInvalidateCache = true;
};

// ============================================
// MIDDLEWARE
// ============================================

checkoutSchema.pre('save', function(next) {
  if (this.isModified('lastActivityAt') || !this.expiresAt) {
    const expiryDate = new Date(this.lastActivityAt || Date.now());
    expiryDate.setDate(expiryDate.getDate() + 30);
    this.expiresAt = expiryDate;
  }
  
  next();
});

checkoutSchema.post('save', async function(doc, next) {
  if (this._shouldInvalidateCache) {
    try {
      await Promise.all([
        deleteCachePattern('checkout_abandonment_*'),
        deleteCachePattern('checkout_recovery_*'),
        deleteCachePattern('abandoned_list:*'),
        deleteCachePattern('admin_stats*'),
        deleteCachePattern('analytics_*')
      ]);
    } catch (error) {
      console.error('Cache invalidation failed:', error);
    }
  }
  next();
});

export default mongoose.model("Checkout", checkoutSchema);