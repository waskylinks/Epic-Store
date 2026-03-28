import mongoose from "mongoose";
import { deleteCachePattern } from '../utils/redis.js';
import { generateRecoveryToken } from '../utils/recoveryToken.js';

// ============================================
// SHARED PRIORITY CALCULATION
// ============================================

/**
 * Calculate recovery priority score for a checkout.
 * Used by both the recoveryPriority virtual and analytics queries
 * to avoid duplication between JS and aggregation layers.
 */
export const calculatePriorityScore = (checkout) => {
  if (!checkout.abandonment?.isAbandoned) return 0;

  let score = 0;

  // Value scoring (40 points max)
  const total = checkout.pricing?.totalPrice || 0;
  if      (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50)  score += 10;

  // Shipping info completion (20 points)
  if (checkout.shippingInfo?.address) score += 20;

  // Cart size (20 points max)
  const items = checkout.items?.length || 0;
  if      (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else                  score += 5;

  // Recency scoring (20 points max)
  // FIX: use firstAbandonedAt when available so re-abandoned carts are scored
  // against their original abandonment time, not the most recent sweep time.
  const abandonedAt = checkout.abandonment?.firstAbandonedAt
    || checkout.abandonment?.abandonedAt;

  if (abandonedAt) {
    const hoursSince = Math.floor(
      (Date.now() - new Date(abandonedAt).getTime()) / (1000 * 60 * 60)
    );
    if      (hoursSince < 6)  score += 20;
    else if (hoursSince < 24) score += 15;
    else if (hoursSince < 48) score += 10;
    else if (hoursSince < 72) score += 5;
  }

  return Math.min(100, score);
};

// ============================================
// SCHEMA
// ============================================

const checkoutSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true
    },

    email: {
      type:     String,
      required: true,
      index:    true
    },

    items: [{
      product: {
        type:     mongoose.Schema.Types.ObjectId,
        ref:      "Product",
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
      firstAbandonedAt: Date,
      abandonedAt:     Date,
      abandonedAtStep: String,
      reAbandoned: { type: Boolean, default: false, index: true },
      failedRecoveries: { type: Number, default: 0 },
      
      // ── Recovery email audit ───────────────────────────────────────────
      recoveryEmailSent:   { type: Boolean, default: false },
      recoveryEmailSentAt: Date,
      recoveryEmailCount:  { type: Number, default: 0 },
      pendingEmailAck: { type: Boolean, default: false },


      lastRecoveryToken:           { type: String,  select: false },
      lastRecoveryTokenId:         { type: String,  select: false },
      lastRecoveryTokenIssuedAt:   Date,
      lastRecoveryTokenExpiredAt:  Date,


      recoveryLinkClickedAt:  Date,
      recoveryLinkClickCount: { type: Number, default: 0 },

      // ── Conversion attribution ─────────────────────────────────────────
      recovered:         { type: Boolean, default: false },
      recoveredAt:       Date,
      recoveryTimeframe: Number,   // hours between last email send and conversion
      likelyFromEmail:   Boolean   // true if converted within 72h of email send
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
    timestamps:  true,
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
    'abandonment.isAbandoned':       1,
    'abandonment.recoveryEmailSent': 1,
    'conversion.isConverted':        1,
    status:                          1
  },
  { name: 'recovery_email_idx' }
);


checkoutSchema.index(
  {
    'abandonment.reAbandoned':    1,
    'conversion.isConverted':     1,
    'abandonment.abandonedAt':    -1
  },
  { name: 're_abandonment_idx' }
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
    parseFloat(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;
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

        abandoned: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$abandonment.isAbandoned', true]  },
                  { $eq: ['$conversion.isConverted', false] }
                ]
              },
              1, 0
            ]
          }
        },

        converted: { $sum: { $cond: ['$conversion.isConverted', 1, 0] } },
        pending:   { $sum: { $cond: [{ $eq: ['$status', 'pending']  }, 1, 0] } },
        expired:   { $sum: { $cond: [{ $eq: ['$status', 'expired']  }, 1, 0] } },

        recoveredCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$abandonment.isAbandoned', true] },
                  { $eq: ['$conversion.isConverted',  true] }
                ]
              },
              1, 0
            ]
          }
        },

        totalEverAbandoned: {
          $sum: { $cond: ['$abandonment.isAbandoned', 1, 0] }
        }
      }
    }
  ]);

  const result = stats[0] || {
    total: 0, abandoned: 0, converted: 0, pending: 0, expired: 0,
    recoveredCount: 0, totalEverAbandoned: 0
  };

  const resolvedCheckouts  = result.abandoned + result.converted; // denominator for rates
  const completedCheckouts = result.converted;                    // paid orders only

  const abandonmentRate =
    resolvedCheckouts > 0
      ? (result.abandoned / resolvedCheckouts) * 100
      : 0;

  const conversionRate =
    resolvedCheckouts > 0
      ? (result.converted / resolvedCheckouts) * 100
      : 0;

  const recoveryRate =
    result.totalEverAbandoned > 0
      ? (result.recoveredCount / result.totalEverAbandoned) * 100
      : 0;

  return {
    totalCheckouts:      result.total,
    abandonedCheckouts:  result.abandoned,
    convertedCheckouts:  result.converted,
    pendingCheckouts:    result.pending,
    expiredCheckouts:    result.expired,
    completedCheckouts,                     // ← now means paid/converted only
    recoveredOrders:     result.recoveredCount,
    totalEverAbandoned:  result.totalEverAbandoned,
    abandonmentRate:     Math.round(abandonmentRate * 100) / 100,
    conversionRate:      Math.round(conversionRate  * 100) / 100,
    recoveryRate:        Math.round(recoveryRate    * 100) / 100
  };
};


checkoutSchema.statics.getRecoveryOpportunities = async function (limit = 50) {
  return this.find({
    'abandonment.isAbandoned':       true,
    'abandonment.recoveryEmailSent': false,
    'abandonment.recovered':         false,
    'conversion.isConverted':        false,
    status:                          'abandoned'
  })
    .populate('user',          'firstName lastName email')
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

  const existing = this.stepsCompleted.find(s => s.step === step);
  if (existing) {
    existing.completedAt = new Date();
  } else {
    this.stepsCompleted.push({ step, completedAt: new Date() });
  }

  this.lastActivityAt = new Date();
};


checkoutSchema.methods.markAsAbandoned = function () {
  // The actual inactivity start — not the sweep time.
  const actualAbandonmentTime = this.lastActivityAt || new Date();

  const isFailedRecovery =
    this.abandonment.recoveryEmailSent === true &&
    !!this.abandonment.recoveryLinkClickedAt;

  if (isFailedRecovery) {
    this.abandonment.failedRecoveries  = (this.abandonment.failedRecoveries || 0) + 1;
    this.abandonment.reAbandoned       = true;
  } else {
    if (!this.abandonment.firstAbandonedAt) {
      this.abandonment.firstAbandonedAt = actualAbandonmentTime;
    }
  }

  this.abandonment.isAbandoned     = true;
  this.abandonment.abandonedAt     = actualAbandonmentTime;
  this.abandonment.abandonedAtStep = this.currentStep;
  this.status                      = 'abandoned';
  this._shouldInvalidateCache      = true;
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
  const MAX_ATTEMPTS   = parseInt(process.env.MAX_RECOVERY_ATTEMPTS)  || 3;
  const COOLDOWN_HOURS = parseInt(process.env.RECOVERY_COOLDOWN_HOURS) || 24;
  const MAX_AGE_DAYS   = 7;

  if (this.conversion.isConverted) {
    return { canSend: false, reason: 'Checkout already converted' };
  }

  if (this.abandonment.recovered) {
    return { canSend: false, reason: 'Checkout already recovered' };
  }

  // FIX: a previous send incremented the count and set pendingEmailAck but
  // save() failed — block until the state is confirmed or rolled back.
  if (this.abandonment.pendingEmailAck) {
    return {
      canSend: false,
      reason:  'A previous send is pending confirmation. Please retry in a moment.'
    };
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

  // Signal that a send is in-flight — cleared only after confirmed save.
  this.abandonment.pendingEmailAck     = true;

  this.abandonment.recoveryEmailSent   = true;
  this.abandonment.recoveryEmailSentAt = new Date();
  this.abandonment.recoveryEmailCount += 1;
  this._shouldInvalidateCache          = true;
};


checkoutSchema.methods.acknowledgeEmailSent = function () {
  this.abandonment.pendingEmailAck = false;
};

checkoutSchema.methods.recordRecoveryLinkClick = function () {
  if (!this.abandonment.recoveryLinkClickedAt) {
    this.abandonment.recoveryLinkClickedAt = new Date();
  }
  this.abandonment.recoveryLinkClickCount =
    (this.abandonment.recoveryLinkClickCount || 0) + 1;
};


checkoutSchema.methods.generateRecoveryToken = function () {
  const canSend = this.canSendRecoveryEmail();
  if (!canSend.canSend) throw new Error(canSend.reason);

  const DEFAULT_TOKEN_TTL_SECONDS =
    parseInt(process.env.RECOVERY_TOKEN_TTL_SECONDS) || 72 * 60 * 60;

  let expiresInSeconds = DEFAULT_TOKEN_TTL_SECONDS;

  if (this.expiresAt) {
    const secondsUntilDocExpiry = Math.floor(
      (this.expiresAt.getTime() - Date.now()) / 1000
    );
    // Cap: never let the token outlive the document.
    if (secondsUntilDocExpiry > 0 && secondsUntilDocExpiry < expiresInSeconds) {
      expiresInSeconds = secondsUntilDocExpiry;
    }
    // If the document is already at or past its expiry, reject immediately.
    if (secondsUntilDocExpiry <= 0) {
      throw new Error('This checkout has expired and cannot issue a recovery token.');
    }
  }

  // ── Generate a stable jti for this token ──────────────────────────────
  // Using a simple timestamp+random string. If your recoveryToken utility
  // generates its own jti internally, extract and return it instead.
  const jti = `${this._id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const token = generateRecoveryToken(
    {
      checkoutId: this._id,
      userId:     this.user,
      email:      this.email,
    },
    {
      expiresIn: expiresInSeconds,
      jti,
    }
  );

  // ── Audit trail ───────────────────────────────────────────────────────
  this.abandonment.lastRecoveryToken          = token;
  this.abandonment.lastRecoveryTokenId        = jti;
  this.abandonment.lastRecoveryTokenIssuedAt  = new Date();

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