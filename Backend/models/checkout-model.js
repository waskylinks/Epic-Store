import mongoose from "mongoose";
import { deleteCachePattern } from '../utils/redis.js';
import { generateRecoveryToken } from '../utils/recoveryToken.js';

// ============================================
// SHARED PRIORITY CALCULATION
// ============================================

/**
 * Calculate recovery priority score for a checkout
 * Used by both virtual and analytics queries to avoid duplication
 */
export const calculatePriorityScore = (checkout) => {
  if (!checkout.abandonment?.isAbandoned) return 0;
  
  let score = 0;
  
  // Value scoring (40 points max)
  const total = checkout.pricing?.totalPrice || 0;
  if (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50) score += 10;
  
  // Shipping info completion (20 points)
  if (checkout.shippingInfo?.address) score += 20;
  
  // Cart size (20 points max)
  const items = checkout.items?.length || 0;
  if (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else score += 5;
  
  // Recency scoring (20 points max)
  const abandonedAt = checkout.abandonment?.abandonedAt;
  if (abandonedAt) {
    const hoursSince = Math.floor(
      (Date.now() - new Date(abandonedAt).getTime()) / (1000 * 60 * 60)
    );
    if (hoursSince < 6)       score += 20;
    else if (hoursSince < 24) score += 15;
    else if (hoursSince < 48) score += 10;
    else if (hoursSince < 72) score += 5;
  }
  
  return Math.min(100, score);
};

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
      name:     String,
      price:    Number,
      quantity: Number,
      image:    String
    }],

    pricing: {
      itemPrice:      Number,
      taxPrice:       Number,
      shippingPrice:  Number,
      discountAmount: { type: Number, default: 0 },
      totalPrice:     Number,
      currency:       { type: String, default: 'USD' }
    },

    shippingInfo: {
      firstName: String,
      lastName:  String,
      address:   String,
      city:      String,
      state:     String,
      pinCode:   String,
      country:   String,
      phoneNo:   String
    },

    discount: {
      code:           String,
      discountId:     { type: mongoose.Schema.Types.ObjectId, ref: "Discount" },
      discountAmount: Number
    },

    status: {
      type:    String,
      enum:    ['pending', 'completed', 'abandoned', 'expired'],
      default: 'pending',
      index:   true
    },

    currentStep: {
      type:    String,
      enum:    ['shipping_info', 'order_confirmation', 'payment_selection', 'payment_gateway', 'payment_failed'],
      default: 'shipping_info'
    },

    stepsCompleted: [{
      step:        String,
      completedAt: Date
    }],

    abandonment: {
      isAbandoned: {
        type:    Boolean,
        default: false,
        index:   true
      },
      abandonedAt:      Date,
      abandonedAtStep:  String,

      recoveryEmailSent:  { type: Boolean, default: false },
      recoveryEmailSentAt: Date,
      recoveryEmailCount: { type: Number, default: 0 },

      // ── NEW: last recovery token issued ─────────────────
      // Stored for audit/reference only — NOT used for verification.
      // Verification is done by JWT signature via recoveryToken.js.
      // Lets you see in the DB which token was last generated,
      // and lets the recovery route do a secondary ownership check
      // if you ever want to invalidate tokens early.
      lastRecoveryToken:       { type: String, select: false },
      lastRecoveryTokenIssuedAt: Date,
      // ────────────────────────────────────────────────────

      recovered:        { type: Boolean, default: false },
      recoveredAt:      Date,
      recoveryTimeframe: Number,
      likelyFromEmail:  Boolean
    },

    conversion: {
      isConverted: {
        type:    Boolean,
        default: false,
        index:   true
      },
      convertedAt:      Date,
      orderId:          { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
      paymentReference: String
    },

    analytics: {
      source: {
        type:    String,
        enum:    ['organic', 'paid', 'referral', 'email', 'social', 'direct'],
        default: 'direct'
      },
      medium:      String,
      campaign:    String,
      referrer:    String,
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

    paymentInitialized:   { type: Boolean, default: false },
    paymentInitializedAt: Date,

    lastActivityAt: {
      type:    Date,
      default: Date.now,
      index:   true
    },

    expiresAt: { type: Date }
  },
  {
    timestamps: true,
    toJSON:  { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// INDEXES
// ============================================

checkoutSchema.index({ createdAt: -1 });
checkoutSchema.index(
  { user: 1, status: 1, lastActivityAt: -1 },
  { name: 'user_active_checkout_idx' }
);
checkoutSchema.index({ status: 1, lastActivityAt: -1 });
checkoutSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

checkoutSchema.index(
  {
    'abandonment.isAbandoned':    1,
    'abandonment.abandonedAt':    -1,
    'conversion.isConverted':     1,
    'pricing.totalPrice':         -1
  },
  { name: 'abandonment_analytics_idx' }
);

checkoutSchema.index(
  {
    'abandonment.isAbandoned':     1,
    'abandonment.recoveryEmailSent': 1,
    'conversion.isConverted':      1,
    status:                        1
  },
  { name: 'recovery_email_idx' }
);

// ============================================
// VIRTUALS
// ============================================

checkoutSchema.virtual('minutesSinceLastActivity').get(function () {
  if (!this.lastActivityAt) return 0;
  return Math.floor((Date.now() - this.lastActivityAt.getTime()) / (1000 * 60));
});

checkoutSchema.virtual('shouldBeAbandoned').get(function () {
  const ABANDONMENT_THRESHOLD_HOURS =
    parseInt(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;
  return (
    this.status === 'pending' &&
    this.minutesSinceLastActivity >= ABANDONMENT_THRESHOLD_HOURS * 60
  );
});

checkoutSchema.virtual('recoveryPriority').get(function () {
  return calculatePriorityScore(this);
});

// ============================================
// STATIC METHODS
// ============================================

checkoutSchema.statics.getAbandonmentRate = async function (startDate, endDate) {
  const stats = await this.aggregate([
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    {
      $group: {
        _id:       null,
        total:     { $sum: 1 },
        abandoned: { $sum: { $cond: ['$abandonment.isAbandoned', 1, 0] } },
        converted: { $sum: { $cond: ['$conversion.isConverted', 1, 0] } },
        pending:   { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        expired:   { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }
      }
    }
  ]);

  const result = stats[0] || {
    total: 0, abandoned: 0, converted: 0, pending: 0, expired: 0
  };

  const completedCheckouts = result.abandoned + result.converted;
  const rate =
    completedCheckouts > 0
      ? (result.abandoned / completedCheckouts) * 100
      : 0;

  return {
    totalCheckouts:     result.total,
    abandonedCheckouts: result.abandoned,
    convertedCheckouts: result.converted,
    pendingCheckouts:   result.pending,
    expiredCheckouts:   result.expired,
    completedCheckouts,
    abandonmentRate: Math.round(rate * 100) / 100,
    conversionRate:
      completedCheckouts > 0
        ? Math.round((result.converted / completedCheckouts) * 10000) / 100
        : 0
  };
};

checkoutSchema.statics.getRecoveryOpportunities = async function (limit = 50) {
  return this.find({
    'abandonment.isAbandoned':      true,
    'abandonment.recoveryEmailSent': false,
    'conversion.isConverted':        false,
    status:                          'abandoned'
  })
    .populate('user', 'firstName lastName email')
    .populate('items.product', 'name images')
    .sort({ 'pricing.totalPrice': -1 })
    .limit(limit)
    .lean();
};

// ============================================
// INSTANCE METHODS
// ============================================

checkoutSchema.methods.updateStep = function (step) {
  this.currentStep = step;
  this.stepsCompleted.push({ step, completedAt: new Date() });
  this.lastActivityAt = new Date();
};

checkoutSchema.methods.markAsAbandoned = function () {
  this.abandonment.isAbandoned    = true;
  this.abandonment.abandonedAt    = new Date();
  this.abandonment.abandonedAtStep = this.currentStep;
  this.status                     = 'abandoned';
  this._shouldInvalidateCache     = true;
};

checkoutSchema.methods.markAsConverted = function (orderId, paymentReference) {
  this.conversion.isConverted      = true;
  this.conversion.convertedAt      = new Date();
  this.conversion.orderId          = orderId;
  this.conversion.paymentReference = paymentReference;
  this.status                      = 'completed';

  if (this.abandonment.isAbandoned) {
    this.abandonment.recovered   = true;
    this.abandonment.recoveredAt = new Date();

    if (this.abandonment.recoveryEmailSentAt) {
      const hoursAfterEmail =
        (this.conversion.convertedAt - this.abandonment.recoveryEmailSentAt) /
        (1000 * 60 * 60);

      this.abandonment.recoveryTimeframe = hoursAfterEmail;
      this.abandonment.likelyFromEmail   = hoursAfterEmail < 72;
    }
  }

  this._shouldInvalidateCache = true;
};

checkoutSchema.methods.canSendRecoveryEmail = function () {
  const MAX_ATTEMPTS  = parseInt(process.env.MAX_RECOVERY_ATTEMPTS)  || 3;
  const COOLDOWN_HOURS = parseInt(process.env.RECOVERY_COOLDOWN_HOURS) || 24;
  const MAX_AGE_DAYS  = 7;

  if (this.conversion.isConverted) {
    return { canSend: false, reason: 'Checkout already converted' };
  }

  if (this.abandonment.recovered) {
    return { canSend: false, reason: 'Checkout already recovered' };
  }

  if (this.abandonment.recoveryEmailCount >= MAX_ATTEMPTS) {
    return {
      canSend: false,
      reason:  `Maximum recovery attempts (${MAX_ATTEMPTS}) reached`
    };
  }

  if (this.abandonment.recoveryEmailSentAt) {
    const hoursSinceLastEmail =
      (Date.now() - this.abandonment.recoveryEmailSentAt.getTime()) /
      (1000 * 60 * 60);

    if (hoursSinceLastEmail < COOLDOWN_HOURS) {
      const hoursRemaining = Math.ceil(COOLDOWN_HOURS - hoursSinceLastEmail);
      return {
        canSend: false,
        reason:  `Cooldown active. ${hoursRemaining} hours remaining before next email`
      };
    }
  }

  const daysSinceAbandoned = this.abandonment.abandonedAt
    ? (Date.now() - this.abandonment.abandonedAt.getTime()) /
      (1000 * 60 * 60 * 24)
    : 0;

  if (daysSinceAbandoned > MAX_AGE_DAYS) {
    return {
      canSend: false,
      reason:  `Checkout abandoned ${Math.floor(daysSinceAbandoned)} days ago (max ${MAX_AGE_DAYS} days)`
    };
  }

  return { canSend: true };
};

checkoutSchema.methods.markRecoveryEmailSent = function () {
  const canSend = this.canSendRecoveryEmail();
  if (!canSend.canSend) throw new Error(canSend.reason);

  this.abandonment.recoveryEmailSent   = true;
  this.abandonment.recoveryEmailSentAt = new Date();
  this.abandonment.recoveryEmailCount += 1;
  this._shouldInvalidateCache          = true;
};

/**
 * Generate a signed JWT recovery token for this checkout and
 * store a reference on the document (select: false — never sent
 * to the client in normal queries).
 *
 * Call checkout.save() after this to persist the audit fields.
 *
 * @returns {string} signed JWT — pass this to recoveryEmailService
 */
checkoutSchema.methods.generateRecoveryToken = function () {
  // Reuse the canSendRecoveryEmail guard so we never issue a token
  // for a checkout that can't legally receive one
  const canSend = this.canSendRecoveryEmail();
  if (!canSend.canSend) throw new Error(canSend.reason);

  const token = generateRecoveryToken({
    checkoutId: this._id,
    userId:     this.user,
    email:      this.email,
  });

  // Audit trail — stored but never returned by default queries
  this.abandonment.lastRecoveryToken        = token;
  this.abandonment.lastRecoveryTokenIssuedAt = new Date();

  return token;
};

// ============================================
// MIDDLEWARE
// ============================================

checkoutSchema.pre('save', function (next) {
  if (this.isModified('lastActivityAt') || !this.expiresAt) {
    const expiryDate = new Date(this.lastActivityAt || Date.now());
    expiryDate.setDate(expiryDate.getDate() + 30);
    this.expiresAt = expiryDate;
  }
  next();
});

checkoutSchema.post('save', async function (doc, next) {
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