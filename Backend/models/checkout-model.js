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
  // Use firstAbandonedAt when available so re-abandoned carts are scored
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
      discountCode:   String,
      grossItemPrice: Number,
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

      // ── First abandonment ──────────────────────────────────────────────
      firstAbandonedAt:   Date,
      firstAbandonedAtStep: String,   // preserved forever — never overwritten by re-abandonment

      // ── Current / most recent abandonment ─────────────────────────────
      abandonedAt:        Date,
      abandonedAtStep:    String,     // most recent abandonment step (may be re-abandonment)

      // ── Re-abandonment (failed recovery) ──────────────────────────────
      reAbandoned:        { type: Boolean, default: false, index: true },
      failedRecoveries:   { type: Number,  default: 0 },

      // Step at which the user left AFTER clicking the recovery link.
      // Distinct from abandonedAtStep so analytics can compare first vs
      // post-recovery drop-off behaviour without ambiguity.
      postRecoveryAbandonedAtStep: String,

      // Timestamp of each re-abandonment for time-series analysis
      reAbandonedAt:      Date,

      // ── Recovery email audit ───────────────────────────────────────────
      recoveryEmailSent:   { type: Boolean, default: false },
      recoveryEmailSentAt: Date,
      recoveryEmailCount:  { type: Number, default: 0 },
      pendingEmailAck:     { type: Boolean, default: false },

      lastRecoveryToken:           { type: String, select: false },
      lastRecoveryTokenId:         { type: String, select: false },
      lastRecoveryTokenIssuedAt:   Date,
      lastRecoveryTokenExpiredAt:  Date,

      recoveryLinkClickedAt:  Date,
      recoveryLinkClickCount: { type: Number, default: 0 },

      // ── Recovery session flag ──────────────────────────────────────────
      // Set to true when redeemRecoveryToken restores the cart.
      // Cleared when the session converts or is swept as abandoned again.
      // Allows createCheckout and the sweep to know this session originated
      // from a recovery link click so interactions can be attributed.
      recoverySessionActive: { type: Boolean, default: false },

      // ── Cart snapshot at recovery link click ───────────────────────────
      // Frozen copy of items, pricing and discount code at the moment the
      // user clicked the recovery link. Used to diff against the final
      // order to understand what changed during the recovery session.
      recoveryCartSnapshot: {
        items: [{
          product:  mongoose.Schema.Types.ObjectId,
          name:     String,
          price:    Number,
          quantity: Number,
        }],
        pricing: {
          itemPrice:      Number,
          taxPrice:       Number,
          shippingPrice:  Number,
          discountAmount: Number,
          discountCode:   String,
          totalPrice:     Number,
        },
        snapshotAt: Date,
      },

      // ── Post-recovery cart interactions ────────────────────────────────
      // Each entry records a discrete cart change that happened after the
      // recovery link was clicked: item added, removed, quantity changed,
      // or discount code applied/removed. Populated by createCheckout when
      // recoverySessionActive is true.
      recoveryInteractions: [{
        type: {
          type:   String,
          enum:   ['item_added', 'item_removed', 'quantity_changed', 'discount_applied', 'discount_removed'],
        },
        productId:    mongoose.Schema.Types.ObjectId,
        productName:  String,
        previousQty:  Number,
        newQty:       Number,
        priceAtEvent: Number,
        discountCode: String,
        recordedAt:   { type: Date, default: Date.now },
      }],

      // ── Cart diff result (written at conversion time) ──────────────────
      // Computed once in verifyPaymentController when markAsConverted runs.
      // Summarises what changed between recoveryCartSnapshot and the paid order.
      recoveryCartDiff: {
        itemsAdded:   Number,   // count of net-new products
        itemsRemoved: Number,   // count of products that were in snapshot but not paid
        qtyIncreased: Number,   // count of products with higher qty than snapshot
        qtyDecreased: Number,   // count of products with lower qty than snapshot
        valueDelta:   Number,   // finalTotal - snapshotTotal (negative = smaller cart)
        discountChangedAfterRecovery: Boolean,
        computedAt:   Date,
      },

      // ── Conversion attribution ─────────────────────────────────────────
      recovered:         { type: Boolean, default: false },
      recoveredAt:       Date,
      recoveryTimeframe: Number,    // hours between last email send and conversion
      likelyFromEmail:   Boolean,   // true if converted within 72h of email send
      organicRecovery:   Boolean,   // true if converted without clicking the link
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

// Supports fetching checkouts that had a recovery link clicked — used by
// verifyPaymentController to credit organic recoveries correctly.
checkoutSchema.index(
  {
    user:                                  1,
    'abandonment.recoveryLinkClickedAt':   1,
    'conversion.isConverted':              1,
    status:                                1
  },
  { name: 'recovery_link_clicked_idx' }
);

// Supports the new getReAbandonmentAnalytics endpoint.
checkoutSchema.index(
  {
    'abandonment.reAbandoned':              1,
    'abandonment.postRecoveryAbandonedAtStep': 1,
    'abandonment.reAbandonedAt':            -1
  },
  { name: 're_abandonment_step_idx' }
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
        _id:   null,
        total: { $sum: 1 },

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

        // Recovered = was abandoned AND was eventually converted.
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
        },

        // Re-abandoned: clicked link but abandoned again without converting.
        reAbandonedCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$abandonment.reAbandoned',      true]  },
                  { $eq: ['$conversion.isConverted',       false] }
                ]
              },
              1, 0
            ]
          }
        },

        // Revenue sitting in carts that failed recovery (re-abandoned, unconverted).
        failedRecoveryRevenue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$abandonment.reAbandoned',      true]  },
                  { $eq: ['$conversion.isConverted',       false] }
                ]
              },
              '$pricing.totalPrice',
              0
            ]
          }
        },

        // Organic recoveries: converted after a link was clicked but without
        // the link being the direct trigger (organicRecovery flag set by
        // verifyPaymentController when no recoverySessionActive at pay time).
        organicRecoveryCount: {
          $sum: {
            $cond: [
              { $eq: ['$abandonment.organicRecovery', true] },
              1, 0
            ]
          }
        }
      }
    }
  ]);

  const result = stats[0] || {
    total: 0, abandoned: 0, converted: 0, pending: 0, expired: 0,
    recoveredCount: 0, totalEverAbandoned: 0,
    reAbandonedCount: 0, failedRecoveryRevenue: 0, organicRecoveryCount: 0
  };

  // "Completed" = paid orders only. Denominator for rates = unrecovered
  // abandoned + converted (sessions that have resolved one way or another).
  const resolvedCheckouts  = result.abandoned + result.converted;
  const completedCheckouts = result.converted;

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
    totalCheckouts:         result.total,
    abandonedCheckouts:     result.abandoned,
    convertedCheckouts:     result.converted,
    pendingCheckouts:       result.pending,
    expiredCheckouts:       result.expired,
    completedCheckouts,
    recoveredOrders:        result.recoveredCount,
    totalEverAbandoned:     result.totalEverAbandoned,
    reAbandonedCount:       result.reAbandonedCount,
    failedRecoveryRevenue:  Math.round(result.failedRecoveryRevenue * 100) / 100,
    organicRecoveryCount:   result.organicRecoveryCount,
    abandonmentRate:        Math.round(abandonmentRate * 100) / 100,
    conversionRate:         Math.round(conversionRate  * 100) / 100,
    recoveryRate:           Math.round(recoveryRate    * 100) / 100
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

/**
 * getReAbandonmentAnalytics
 * Breakdown of carts that were contacted via email, clicked the link,
 * but abandoned again without converting. Returns step-level drop-off
 * for the post-recovery journey, revenue lost, and discount usage.
 */
checkoutSchema.statics.getReAbandonmentAnalytics = async function (startDate, endDate) {
  const matchBase = {
    'abandonment.reAbandoned':    true,
    'conversion.isConverted':     false,
    ...(startDate && endDate && {
      'abandonment.reAbandonedAt': { $gte: startDate, $lte: endDate }
    })
  };

  const [stepBreakdown, summary] = await Promise.all([
    // Which step did they leave at after clicking the recovery link?
    this.aggregate([
      { $match: matchBase },
      {
        $group: {
          _id:        '$abandonment.postRecoveryAbandonedAtStep',
          count:      { $sum: 1 },
          totalValue: { $sum: '$pricing.totalPrice' }
        }
      },
      { $sort: { count: -1 } }
    ]),

    // Summary stats
    this.aggregate([
      { $match: matchBase },
      {
        $group: {
          _id:   null,
          total: { $sum: 1 },
          totalRevenueLost: { $sum: '$pricing.totalPrice' },
          avgCartValue:     { $avg: '$pricing.totalPrice' },
          avgFailedRecoveries: { $avg: '$abandonment.failedRecoveries' },

          // How many had a discount code applied during the recovery session?
          withDiscountDuringRecovery: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$abandonment.recoveryInteractions', []] } }, 0] },
                1, 0
              ]
            }
          },

          // Average hours between link click and re-abandonment
          avgHoursToReAbandon: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$abandonment.recoveryLinkClickedAt', null] },
                    { $ne: ['$abandonment.reAbandonedAt',         null] }
                  ]
                },
                {
                  $divide: [
                    { $subtract: ['$abandonment.reAbandonedAt', '$abandonment.recoveryLinkClickedAt'] },
                    3600000
                  ]
                },
                null
              ]
            }
          }
        }
      }
    ])
  ]);

  const s = summary[0] || {
    total: 0, totalRevenueLost: 0, avgCartValue: 0,
    avgFailedRecoveries: 0, withDiscountDuringRecovery: 0, avgHoursToReAbandon: null
  };

  return {
    total:              s.total,
    totalRevenueLost:   Math.round(s.totalRevenueLost   * 100) / 100,
    avgCartValue:       Math.round(s.avgCartValue        * 100) / 100,
    avgFailedRecoveries: Math.round((s.avgFailedRecoveries || 0) * 10) / 10,
    withDiscountDuringRecovery: s.withDiscountDuringRecovery,
    avgHoursToReAbandon: s.avgHoursToReAbandon != null
      ? Math.round(s.avgHoursToReAbandon * 10) / 10
      : null,
    stepBreakdown: stepBreakdown.map(s => ({
      step:       s._id || 'unknown',
      count:      s.count,
      totalValue: Math.round(s.totalValue * 100) / 100
    }))
  };
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
  // Anchor abandonment time to the last real user activity, not the sweep time.
  const actualAbandonmentTime = this.lastActivityAt || new Date();

  const isFailedRecovery =
    this.abandonment.recoveryEmailSent === true &&
    !!this.abandonment.recoveryLinkClickedAt;

  if (isFailedRecovery) {
    // ── Re-abandonment path ───────────────────────────────────────────────
    this.abandonment.failedRecoveries  = (this.abandonment.failedRecoveries || 0) + 1;
    this.abandonment.reAbandoned       = true;
    this.abandonment.reAbandonedAt     = actualAbandonmentTime;

    // Record the step at which this specific recovery attempt failed.
    // abandonedAtStep is also updated below (most-recent pointer), but
    // postRecoveryAbandonedAtStep is the dedicated field for analytics
    // that compares first vs post-recovery funnel drop-off.
    this.abandonment.postRecoveryAbandonedAtStep = this.currentStep;

    // Recovery session is over — clear the active flag.
    this.abandonment.recoverySessionActive = false;

  } else {
    // ── First abandonment path ────────────────────────────────────────────
    if (!this.abandonment.firstAbandonedAt) {
      this.abandonment.firstAbandonedAt    = actualAbandonmentTime;
      // Preserve the original step permanently — never overwritten.
      this.abandonment.firstAbandonedAtStep = this.currentStep;
    }
  }

  // Always update the most-recent abandonment pointers.
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

  // Clear recovery session flag on conversion.
  this.abandonment.recoverySessionActive = false;

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

    // Mark as organic recovery if the user converted without an active
    // recovery session (i.e. they visited the site independently even
    // though a recovery email had been sent and the link had been clicked
    // at some earlier point — or they converted with no link interaction).
    // verifyPaymentController sets this flag before calling markAsConverted
    // when it detects the checkout has no active recovery session but was
    // previously abandoned and contacted.
    // The flag is not set here directly — it is set by the caller so the
    // controller has full context about the payment session.
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

  // ── Snapshot the cart at click time ───────────────────────────────────
  // This is the reference point for all post-recovery interaction diffs.
  // We always overwrite on subsequent clicks so the snapshot reflects the
  // most recent cart state presented to the user via the link.
  this.abandonment.recoveryCartSnapshot = {
    items: (this.items || []).map(item => ({
      product:  item.product,
      name:     item.name,
      price:    item.price,
      quantity: item.quantity,
    })),
    pricing: {
      itemPrice:      this.pricing?.itemPrice,
      taxPrice:       this.pricing?.taxPrice,
      shippingPrice:  this.pricing?.shippingPrice,
      discountAmount: this.pricing?.discountAmount,
      discountCode:   this.pricing?.discountCode,
      totalPrice:     this.pricing?.totalPrice,
    },
    snapshotAt: new Date(),
  };

  // Mark session as active so createCheckout can attribute interactions.
  this.abandonment.recoverySessionActive = true;
};


/**
 * recordRecoveryInteraction
 * Called by createCheckout when recoverySessionActive is true and the
 * user modifies the cart. Diffs the incoming items/pricing against the
 * recoveryCartSnapshot and appends discrete interaction records.
 *
 * @param {Array}  previousItems  - items array before this update
 * @param {Array}  newItems       - items array after this update
 * @param {Object} previousPricing
 * @param {Object} newPricing
 */
checkoutSchema.methods.recordRecoveryInteraction = function (
  previousItems,
  newItems,
  previousPricing,
  newPricing
) {
  if (!this.abandonment.recoverySessionActive) return;

  const now = new Date();

  const prevMap = new Map(
    (previousItems || []).map(i => [i.product?.toString(), i])
  );
  const newMap = new Map(
    (newItems || []).map(i => [i.product?.toString(), i])
  );

  // Detect additions and quantity changes
  for (const [productId, newItem] of newMap) {
    const prev = prevMap.get(productId);

    if (!prev) {
      // Brand new product added to cart
      this.abandonment.recoveryInteractions.push({
        type:         'item_added',
        productId:    newItem.product,
        productName:  newItem.name,
        newQty:       newItem.quantity,
        priceAtEvent: newItem.price,
        recordedAt:   now,
      });
    } else if (newItem.quantity !== prev.quantity) {
      this.abandonment.recoveryInteractions.push({
        type:         'quantity_changed',
        productId:    newItem.product,
        productName:  newItem.name,
        previousQty:  prev.quantity,
        newQty:       newItem.quantity,
        priceAtEvent: newItem.price,
        recordedAt:   now,
      });
    }
  }

  // Detect removals
  for (const [productId, prevItem] of prevMap) {
    if (!newMap.has(productId)) {
      this.abandonment.recoveryInteractions.push({
        type:         'item_removed',
        productId:    prevItem.product,
        productName:  prevItem.name,
        previousQty:  prevItem.quantity,
        priceAtEvent: prevItem.price,
        recordedAt:   now,
      });
    }
  }

  // Detect discount code changes
  const prevCode = previousPricing?.discountCode || null;
  const newCode  = newPricing?.discountCode      || null;

  if (newCode && newCode !== prevCode) {
    this.abandonment.recoveryInteractions.push({
      type:         'discount_applied',
      discountCode: newCode,
      recordedAt:   now,
    });
  } else if (!newCode && prevCode) {
    this.abandonment.recoveryInteractions.push({
      type:         'discount_removed',
      discountCode: prevCode,
      recordedAt:   now,
    });
  }
};


/**
 * computeRecoveryCartDiff
 * Called by verifyPaymentController after a successful payment on a
 * checkout that has a recoveryCartSnapshot. Computes the diff between
 * the snapshot and the final paid order items and stores it on the doc.
 *
 * @param {Array} finalOrderItems - the orderItems array from the created Order
 */
checkoutSchema.methods.computeRecoveryCartDiff = function (finalOrderItems) {
  const snapshot = this.abandonment?.recoveryCartSnapshot;
  if (!snapshot || !snapshot.items || snapshot.items.length === 0) return;

  const snapMap = new Map(
    snapshot.items.map(i => [i.product?.toString(), i])
  );
  const finalMap = new Map(
    (finalOrderItems || []).map(i => [i.product?.toString(), i])
  );

  let itemsAdded   = 0;
  let itemsRemoved = 0;
  let qtyIncreased = 0;
  let qtyDecreased = 0;

  for (const [id, finalItem] of finalMap) {
    const snap = snapMap.get(id);
    if (!snap) {
      itemsAdded++;
    } else if (finalItem.quantity > snap.quantity) {
      qtyIncreased++;
    } else if (finalItem.quantity < snap.quantity) {
      qtyDecreased++;
    }
  }

  for (const id of snapMap.keys()) {
    if (!finalMap.has(id)) itemsRemoved++;
  }

  const snapTotal  = snapshot.pricing?.totalPrice  || 0;
  const finalTotal = this.pricing?.totalPrice       || 0;

  const snapCode  = snapshot.pricing?.discountCode || null;
  const finalCode = this.pricing?.discountCode     || null;

  this.abandonment.recoveryCartDiff = {
    itemsAdded,
    itemsRemoved,
    qtyIncreased,
    qtyDecreased,
    valueDelta:                  Math.round((finalTotal - snapTotal) * 100) / 100,
    discountChangedAfterRecovery: snapCode !== finalCode,
    computedAt:                  new Date(),
  };
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
    if (secondsUntilDocExpiry > 0 && secondsUntilDocExpiry < expiresInSeconds) {
      expiresInSeconds = secondsUntilDocExpiry;
    }
    if (secondsUntilDocExpiry <= 0) {
      throw new Error('This checkout has expired and cannot issue a recovery token.');
    }
  }

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

  this.abandonment.lastRecoveryToken         = token;
  this.abandonment.lastRecoveryTokenId       = jti;
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

});

export default mongoose.model("Checkout", checkoutSchema);