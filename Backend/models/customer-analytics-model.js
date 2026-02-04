import mongoose from "mongoose";

const customerAnalyticsSchema = new mongoose.Schema(
  {
    // ============================================
    // USER REFERENCE
    // ============================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
    },

    // ============================================
    // CUSTOMER LIFETIME VALUE (CLV)
    // ============================================
    clv: {
      // Total revenue from this customer (all completed orders)
      totalRevenue: {
        type: Number,
        default: 0,
        min: 0
      },

      // Total orders placed
      totalOrders: {
        type: Number,
        default: 0,
        min: 0
      },

      // Average order value
      averageOrderValue: {
        type: Number,
        default: 0,
        min: 0
      },

      // Predicted lifetime value (can be calculated with ML later)
      predictedLTV: {
        type: Number,
        default: 0
      },

      // Total items purchased
      totalItemsPurchased: {
        type: Number,
        default: 0,
        min: 0
      },

      // Total profit generated (revenue - costs)
      totalProfit: {
        type: Number,
        default: 0
      },

      // Gross margin percentage
      grossMarginPercent: {
        type: Number,
        default: 0
      }
    },

    // ============================================
    // RFM SEGMENTATION (Recency, Frequency, Monetary)
    // ============================================
    rfm: {
      // Days since last purchase
      recency: {
        type: Number,
        default: 0
      },

      // Total number of purchases
      frequency: {
        type: Number,
        default: 0
      },

      // Total money spent
      monetary: {
        type: Number,
        default: 0
      },

      // RFM Scores (1-5, 5 being best)
      recencyScore: {
        type: Number,
        min: 1,
        max: 5,
        default: 1
      },

      frequencyScore: {
        type: Number,
        min: 1,
        max: 5,
        default: 1
      },

      monetaryScore: {
        type: Number,
        min: 1,
        max: 5,
        default: 1
      },

      // Combined RFM Score (3-15)
      rfmScore: {
        type: Number,
        min: 3,
        max: 15,
        default: 3
      },

      // Customer segment based on RFM
      segment: {
        type: String,
        enum: [
          'Champions',           // 14-15: Best customers
          'Loyal Customers',     // 12-13: Regular buyers
          'Potential Loyalists', // 10-11: Recent customers with potential
          'New Customers',       // 8-9: Recent first-time buyers
          'Promising',           // 7-8: Recent, low spend
          'Need Attention',      // 6-7: Above average recency, frequency & monetary
          'About To Sleep',      // 5-6: Below average recency, frequency & monetary
          'At Risk',             // 4-5: Spent good money, purchased often but long ago
          'Cannot Lose Them',    // 3-4: Made big purchases, haven't returned
          'Hibernating',         // 3: Last purchase long ago, low spenders
          'Lost'                 // 3: Lowest recency, frequency & monetary
        ],
        default: 'New Customers',
        index: true
      },

      // Last calculated date
      lastCalculated: {
        type: Date,
        default: Date.now
      }
    },

    // ============================================
    // PURCHASE BEHAVIOR
    // ============================================
    purchaseBehavior: {
      // First purchase date
      firstPurchaseDate: Date,

      // Last purchase date
      lastPurchaseDate: Date,

      // Average days between purchases
      avgDaysBetweenPurchases: {
        type: Number,
        default: 0
      },

      // Purchase frequency (orders per month)
      purchaseFrequency: {
        type: Number,
        default: 0
      },

      // Repeat purchase rate (percentage)
      repeatPurchaseRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },

      // Favorite categories
      favoriteCategories: [{
        category: String,
        purchaseCount: Number,
        totalSpent: Number
      }],

      // Favorite products
      favoriteProducts: [{
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product'
        },
        purchaseCount: Number,
        totalSpent: Number,
        lastPurchased: Date
      }],

      // Preferred payment method
      preferredPaymentMethod: {
        type: String,
        enum: ['paystack', 'flutterwave', 'stripe', 'manual']
      },

      // Average cart size (items per order)
      avgCartSize: {
        type: Number,
        default: 0
      }
    },

    // ============================================
    // ENGAGEMENT METRICS
    // ============================================
    engagement: {
      // Total site visits
      totalVisits: {
        type: Number,
        default: 0
      },

      // Last visit date
      lastVisitDate: Date,

      // Total product views
      totalProductViews: {
        type: Number,
        default: 0
      },

      // Items added to wishlist
      wishlistItemsCount: {
        type: Number,
        default: 0
      },

      // Cart abandonment count
      cartAbandonments: {
        type: Number,
        default: 0
      },

      // Email engagement
      emailEngagement: {
        sent: { type: Number, default: 0 },
        opened: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        openRate: { type: Number, default: 0 },
        clickRate: { type: Number, default: 0 }
      },

      // Customer service interactions
      supportTickets: {
        total: { type: Number, default: 0 },
        resolved: { type: Number, default: 0 },
        avgResolutionTime: { type: Number, default: 0 } // in hours
      }
    },

    // ============================================
    // RETURNS & REFUNDS
    // ============================================
    returnsRefunds: {
      // Total returns
      totalReturns: {
        type: Number,
        default: 0
      },

      // Total refunds
      totalRefunds: {
        type: Number,
        default: 0
      },

      // Total refund amount
      totalRefundAmount: {
        type: Number,
        default: 0
      },

      // Return rate (percentage)
      returnRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },

      // Refund rate (percentage)
      refundRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    },

    // ============================================
    // ACQUISITION DATA
    // ============================================
    acquisition: {
      // How customer was acquired
      source: {
        type: String,
        enum: ['organic', 'paid', 'referral', 'email', 'social', 'direct'],
        index: true
      },

      medium: String,
      campaign: String,

      // Acquisition cost (if tracked)
      acquisitionCost: {
        type: Number,
        default: 0
      },

      // Referral information
      referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },

      // Number of successful referrals made
      referralsMade: {
        type: Number,
        default: 0
      }
    },

    // ============================================
    // RISK INDICATORS
    // ============================================
    risk: {
      // Churn risk score (0-100, higher = more likely to churn)
      churnRiskScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },

      // Churn prediction
      churnPrediction: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'low',
        index: true
      },

      // Days since last engagement
      daysSinceLastEngagement: {
        type: Number,
        default: 0
      },

      // Is customer at risk of churning
      isAtRisk: {
        type: Boolean,
        default: false,
        index: true
      },

      // Fraud risk indicators
      fraudFlags: {
        type: Number,
        default: 0
      },

      // Number of cancelled orders
      cancelledOrders: {
        type: Number,
        default: 0
      }
    },

    // ============================================
    // CUSTOMER VALUE TIER
    // ============================================
    valueTier: {
      type: String,
      enum: ['VIP', 'High Value', 'Medium Value', 'Low Value', 'New'],
      default: 'New',
      index: true
    },

    // ============================================
    // PREFERENCES & PERSONALIZATION
    // ============================================
    preferences: {
      // Preferred communication channel
      communicationChannel: {
        type: String,
        enum: ['email', 'sms', 'push', 'none'],
        default: 'email'
      },

      // Communication frequency preference
      communicationFrequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'rarely'],
        default: 'weekly'
      },

      // Opted in for marketing
      marketingOptIn: {
        type: Boolean,
        default: true
      },

      // Language preference
      language: {
        type: String,
        default: 'en'
      },

      // Currency preference
      currency: {
        type: String,
        default: 'USD'
      }
    },

    // ============================================
    // NOTES & FLAGS
    // ============================================
    notes: [{
      content: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      createdAt: {
        type: Date,
        default: Date.now
      },
      type: {
        type: String,
        enum: ['general', 'warning', 'opportunity', 'issue']
      }
    }],

    // VIP status
    isVIP: {
      type: Boolean,
      default: false,
      index: true
    },

    // Flagged for review
    flaggedForReview: {
      type: Boolean,
      default: false
    },

    // ============================================
    // LAST SYNC
    // ============================================
    lastSyncedAt: {
      type: Date,
      default: Date.now
    }
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
customerAnalyticsSchema.index({ user: 1 }, { unique: true });
customerAnalyticsSchema.index({ 'rfm.segment': 1, 'clv.totalRevenue': -1 });
customerAnalyticsSchema.index({ valueTier: 1, 'clv.totalRevenue': -1 });
customerAnalyticsSchema.index({ 'risk.churnPrediction': 1, 'risk.isAtRisk': 1 });
customerAnalyticsSchema.index({ 'acquisition.source': 1, 'clv.totalRevenue': -1 });
customerAnalyticsSchema.index({ isVIP: 1, 'clv.totalRevenue': -1 });
customerAnalyticsSchema.index({ 'rfm.rfmScore': -1 });
customerAnalyticsSchema.index({ lastSyncedAt: 1 });

// Compound indexes for complex queries
customerAnalyticsSchema.index({ 
  'rfm.segment': 1, 
  'risk.churnPrediction': 1, 
  'clv.totalRevenue': -1 
});

// ============================================
// VIRTUALS
// ============================================

// Customer age (days since first purchase)
customerAnalyticsSchema.virtual('customerAgeDays').get(function() {
  if (!this.purchaseBehavior.firstPurchaseDate) return 0;
  return Math.floor(
    (Date.now() - this.purchaseBehavior.firstPurchaseDate.getTime()) / (1000 * 60 * 60 * 24)
  );
});

// Is active customer (purchased in last 90 days)
customerAnalyticsSchema.virtual('isActive').get(function() {
  return this.rfm.recency <= 90;
});

// Customer status
customerAnalyticsSchema.virtual('status').get(function() {
  if (this.rfm.recency <= 30) return 'Active';
  if (this.rfm.recency <= 90) return 'Engaged';
  if (this.rfm.recency <= 180) return 'Dormant';
  return 'Inactive';
});

// ROI (Return on Investment)
customerAnalyticsSchema.virtual('roi').get(function() {
  if (this.acquisition.acquisitionCost === 0) return 0;
  return ((this.clv.totalRevenue - this.acquisition.acquisitionCost) / this.acquisition.acquisitionCost) * 100;
});

// Months to payback acquisition cost
customerAnalyticsSchema.virtual('monthsToPayback').get(function() {
  if (this.clv.averageOrderValue === 0) return 0;
  return this.acquisition.acquisitionCost / this.clv.averageOrderValue;
});

// ============================================
// STATIC METHODS
// ============================================

// Get customers by segment
customerAnalyticsSchema.statics.getBySegment = async function(segment, limit = 100) {
  return this.find({ 'rfm.segment': segment })
    .populate('user', 'firstName lastName email')
    .sort({ 'clv.totalRevenue': -1 })
    .limit(limit);
};

// Get VIP customers
customerAnalyticsSchema.statics.getVIPCustomers = async function(limit = 50) {
  return this.find({ isVIP: true })
    .populate('user', 'firstName lastName email')
    .sort({ 'clv.totalRevenue': -1 })
    .limit(limit);
};

// Get at-risk customers
customerAnalyticsSchema.statics.getAtRiskCustomers = async function(limit = 100) {
  return this.find({ 'risk.isAtRisk': true })
    .populate('user', 'firstName lastName email')
    .sort({ 'clv.totalRevenue': -1, 'risk.churnRiskScore': -1 })
    .limit(limit);
};

// Get high-value customers
customerAnalyticsSchema.statics.getHighValueCustomers = async function(minRevenue = 1000, limit = 100) {
  return this.find({ 'clv.totalRevenue': { $gte: minRevenue } })
    .populate('user', 'firstName lastName email')
    .sort({ 'clv.totalRevenue': -1 })
    .limit(limit);
};

// Get customers needing attention
customerAnalyticsSchema.statics.getNeedingAttention = async function() {
  return this.find({
    $or: [
      { 'risk.isAtRisk': true },
      { 'rfm.segment': { $in: ['At Risk', 'Cannot Lose Them', 'About To Sleep'] } },
      { flaggedForReview: true }
    ]
  })
    .populate('user', 'firstName lastName email')
    .sort({ 'clv.totalRevenue': -1 });
};

// Calculate segment distribution
customerAnalyticsSchema.statics.getSegmentDistribution = async function() {
  return this.aggregate([
    {
      $group: {
        _id: '$rfm.segment',
        count: { $sum: 1 },
        totalRevenue: { $sum: '$clv.totalRevenue' },
        avgRevenue: { $avg: '$clv.totalRevenue' }
      }
    },
    {
      $sort: { totalRevenue: -1 }
    }
  ]);
};

// ============================================
// INSTANCE METHODS
// ============================================

// Calculate RFM scores
customerAnalyticsSchema.methods.calculateRFMScores = function() {
  // Recency score (1-5, lower days = higher score)
  if (this.rfm.recency <= 30) this.rfm.recencyScore = 5;
  else if (this.rfm.recency <= 60) this.rfm.recencyScore = 4;
  else if (this.rfm.recency <= 90) this.rfm.recencyScore = 3;
  else if (this.rfm.recency <= 180) this.rfm.recencyScore = 2;
  else this.rfm.recencyScore = 1;

  // Frequency score (1-5, more orders = higher score)
  if (this.rfm.frequency >= 10) this.rfm.frequencyScore = 5;
  else if (this.rfm.frequency >= 7) this.rfm.frequencyScore = 4;
  else if (this.rfm.frequency >= 4) this.rfm.frequencyScore = 3;
  else if (this.rfm.frequency >= 2) this.rfm.frequencyScore = 2;
  else this.rfm.frequencyScore = 1;

  // Monetary score (1-5, more spent = higher score)
  if (this.rfm.monetary >= 1000) this.rfm.monetaryScore = 5;
  else if (this.rfm.monetary >= 500) this.rfm.monetaryScore = 4;
  else if (this.rfm.monetary >= 200) this.rfm.monetaryScore = 3;
  else if (this.rfm.monetary >= 100) this.rfm.monetaryScore = 2;
  else this.rfm.monetaryScore = 1;

  // Combined RFM score
  this.rfm.rfmScore = this.rfm.recencyScore + this.rfm.frequencyScore + this.rfm.monetaryScore;

  // Determine segment
  this.rfm.segment = this.determineSegment();

  this.rfm.lastCalculated = new Date();
};

// Determine customer segment based on RFM scores
customerAnalyticsSchema.methods.determineSegment = function() {
  const { recencyScore: R, frequencyScore: F, monetaryScore: M } = this.rfm;

  if (R >= 4 && F >= 4 && M >= 4) return 'Champions';
  if (R >= 3 && F >= 4 && M >= 4) return 'Loyal Customers';
  if (R >= 4 && F <= 3 && M <= 3) return 'New Customers';
  if (R >= 4 && F >= 2 && M >= 2) return 'Potential Loyalists';
  if (R >= 3 && F <= 2 && M <= 2) return 'Promising';
  if (R <= 3 && F >= 3 && M >= 3) return 'Cannot Lose Them';
  if (R <= 2 && F >= 2 && M >= 2) return 'At Risk';
  if (R <= 2 && F <= 2 && M >= 3) return 'Hibernating';
  if (R >= 3 && F <= 3 && M <= 3) return 'About To Sleep';
  if (R <= 3 && F >= 1 && M >= 1) return 'Need Attention';
  return 'Lost';
};

// Calculate value tier
customerAnalyticsSchema.methods.calculateValueTier = function() {
  const revenue = this.clv.totalRevenue;

  if (revenue >= 5000) this.valueTier = 'VIP';
  else if (revenue >= 2000) this.valueTier = 'High Value';
  else if (revenue >= 500) this.valueTier = 'Medium Value';
  else if (revenue >= 100) this.valueTier = 'Low Value';
  else this.valueTier = 'New';

  // Auto-set VIP flag
  this.isVIP = this.valueTier === 'VIP';
};

// Calculate churn risk
customerAnalyticsSchema.methods.calculateChurnRisk = function() {
  let riskScore = 0;

  // Recency factor (40 points)
  if (this.rfm.recency > 180) riskScore += 40;
  else if (this.rfm.recency > 120) riskScore += 30;
  else if (this.rfm.recency > 90) riskScore += 20;
  else if (this.rfm.recency > 60) riskScore += 10;

  // Frequency factor (30 points)
  if (this.rfm.frequency === 1) riskScore += 30;
  else if (this.rfm.frequency === 2) riskScore += 20;
  else if (this.rfm.frequency <= 4) riskScore += 10;

  // Engagement factor (20 points)
  if (this.risk.daysSinceLastEngagement > 90) riskScore += 20;
  else if (this.risk.daysSinceLastEngagement > 60) riskScore += 15;
  else if (this.risk.daysSinceLastEngagement > 30) riskScore += 10;

  // Return/refund factor (10 points)
  if (this.returnsRefunds.returnRate > 50) riskScore += 10;
  else if (this.returnsRefunds.returnRate > 30) riskScore += 5;

  this.risk.churnRiskScore = Math.min(100, riskScore);

  // Set churn prediction
  if (this.risk.churnRiskScore >= 70) this.risk.churnPrediction = 'critical';
  else if (this.risk.churnRiskScore >= 50) this.risk.churnPrediction = 'high';
  else if (this.risk.churnRiskScore >= 30) this.risk.churnPrediction = 'medium';
  else this.risk.churnPrediction = 'low';

  // Set at-risk flag
  this.risk.isAtRisk = this.risk.churnRiskScore >= 50;
};

// Add note
customerAnalyticsSchema.methods.addNote = function(content, type, addedBy) {
  this.notes.push({
    content,
    type,
    addedBy,
    createdAt: new Date()
  });
};

customerAnalyticsSchema.set("strictQuery", true);

export default mongoose.model("CustomerAnalytics", customerAnalyticsSchema);