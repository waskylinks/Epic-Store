import mongoose from "mongoose";
import { deleteCachePattern } from '../utils/redis.js';
import { generateRecoveryToken } from '../utils/recoveryToken.js';

// ============================================
// SHARED PRIORITY CALCULATION
// ============================================

export const calculatePriorityScore = (checkout) => {
  if (!checkout.abandonment?.isAbandoned) return 0;

  let score = 0;

  const total = checkout.pricing?.totalPrice || 0;
  if      (total > 500) score += 40;
  else if (total > 200) score += 30;
  else if (total > 100) score += 20;
  else if (total > 50)  score += 10;

  if (checkout.shippingInfo?.address) score += 20;

  const items = checkout.items?.length || 0;
  if      (items >= 5) score += 20;
  else if (items >= 3) score += 15;
  else if (items >= 2) score += 10;
  else                  score += 5;

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

      firstAbandonedAt:     Date,
      firstAbandonedAtStep: String,

      abandonedAt:          Date,
      abandonedAtStep:      String,

      reAbandoned:        { type: Boolean, default: false, index: true },
      failedRecoveries:   { type: Number,  default: 0 },

      postRecoveryAbandonedAtStep: String,
      reAbandonedAt:      Date,

      // ── Recovery email audit (synced by recoveryEmailService after each send) ──
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

      recoverySessionActive: { type: Boolean, default: false },

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

      recoveryCartDiff: {
        itemsAdded:   Number,
        itemsRemoved: Number,
        qtyIncreased: Number,
        qtyDecreased: Number,
        valueDelta:   Number,
        discountChangedAfterRecovery: Boolean,
        computedAt:   Date,
      },

      recovered:         { type: Boolean, default: false },
      recoveredAt:       Date,
      recoveryTimeframe: Number,
      likelyFromEmail:   Boolean,
      organicRecovery:   Boolean,
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

checkoutSchema.index(
  {
    user:                                  1,
    'abandonment.recoveryLinkClickedAt':   1,
    'conversion.isConverted':              1,
    status:                                1
  },
  { name: 'recovery_link_clicked_idx' }
);

checkoutSchema.index(
  {
    'abandonment.reAbandoned':                 1,
    'abandonment.postRecoveryAbandonedAtStep': 1,
    'abandonment.reAbandonedAt':               -1
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


checkoutSchema.statics.getReAbandonmentAnalytics = async function (startDate, endDate) {
  const matchBase = {
    'abandonment.reAbandoned':    true,
    'conversion.isConverted':     false,
    ...(startDate && endDate && {
      'abandonment.reAbandonedAt': { $gte: startDate, $lte: endDate }
    })
  };

  const [stepBreakdown, summary] = await Promise.all([
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

    this.aggregate([
      { $match: matchBase },
      {
        $group: {
          _id:   null,
          total: { $sum: 1 },
          totalRevenueLost: { $sum: '$pricing.totalPrice' },
          avgCartValue:     { $avg: '$pricing.totalPrice' },
          avgFailedRecoveries: { $avg: '$abandonment.failedRecoveries' },

          withDiscountDuringRecovery: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$abandonment.recoveryInteractions', []] } }, 0] },
                1, 0
              ]
            }
          },

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
    total:               s.total,
    totalRevenueLost:    Math.round(s.totalRevenueLost   * 100) / 100,
    avgCartValue:        Math.round(s.avgCartValue        * 100) / 100,
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


/**
 * markAsAbandoned
 * Called by markStaleCheckouts sweep and abandonCheckout controller.
 *
 * FIX: On re-abandonment, resolveRecoveryOutcome is called here directly
 * so the RecoveryEmail outcome is guaranteed to update to 're_abandoned'
 * regardless of whether markStaleCheckouts.js calls it externally.
 * This makes the checkout model the single reliable trigger for that
 * outcome transition rather than depending on sweep implementation details.
 *
 * Dynamic import is used to avoid circular dependency:
 * checkout-model → recoveryEmailService → checkout-model
 */
checkoutSchema.methods.markAsAbandoned = function () {
  const actualAbandonmentTime = this.lastActivityAt || new Date();

  const isFailedRecovery =
    this.abandonment.recoveryEmailSent === true &&
    !!this.abandonment.recoveryLinkClickedAt;

  if (isFailedRecovery) {
    this.abandonment.failedRecoveries  = (this.abandonment.failedRecoveries || 0) + 1;
    this.abandonment.reAbandoned       = true;
    this.abandonment.reAbandonedAt     = actualAbandonmentTime;
    this.abandonment.postRecoveryAbandonedAtStep = this.currentStep;
    this.abandonment.recoverySessionActive = false;

    // Schedule RecoveryEmail outcome sync after save.
    // _pendingReAbandonmentSync is read by the post-save hook.
    this._pendingReAbandonmentSync = true;

  } else {
    if (!this.abandonment.firstAbandonedAt) {
      this.abandonment.firstAbandonedAt     = actualAbandonmentTime;
      this.abandonment.firstAbandonedAtStep = this.currentStep;
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
  }

  this._shouldInvalidateCache = true;
};


checkoutSchema.methods.recordRecoveryLinkClick = function () {
  if (!this.abandonment.recoveryLinkClickedAt) {
    this.abandonment.recoveryLinkClickedAt = new Date();
  }
  this.abandonment.recoveryLinkClickCount =
    (this.abandonment.recoveryLinkClickCount || 0) + 1;

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

  this.abandonment.recoverySessionActive = true;
};


checkoutSchema.methods.restoreFromRecovery = function () {
  if (this.status === 'abandoned') {
    this.status         = 'pending';
    this.lastActivityAt = new Date();
  }
};


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

  for (const [productId, newItem] of newMap) {
    const prev = prevMap.get(productId);

    if (!prev) {
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
    valueDelta:                   Math.round((finalTotal - snapTotal) * 100) / 100,
    discountChangedAfterRecovery: snapCode !== finalCode,
    computedAt:                   new Date(),
  };
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
  const tasks = [];

  if (this._shouldInvalidateCache) {
    tasks.push(
      Promise.all([
        deleteCachePattern('checkout_abandonment_*'),
        deleteCachePattern('checkout_recovery_*'),
        deleteCachePattern('abandoned_list:*'),
        deleteCachePattern('admin_stats*'),
        deleteCachePattern('analytics_*')
      ]).catch(err => console.error('Cache invalidation failed:', err))
    );
  }


  if (this._pendingReAbandonmentSync) {
    this._pendingReAbandonmentSync = false;
    tasks.push(
      import('../Services/recoveryEmailService.js')
        .then(({ resolveRecoveryOutcome }) => resolveRecoveryOutcome(doc._id, 're_abandoned'))
        .catch(err =>
          console.error(
            `[checkout-model] Failed to sync re_abandoned outcome for ${doc._id}:`,
            err.message
          )
        )
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
});

export default mongoose.model("Checkout", checkoutSchema);