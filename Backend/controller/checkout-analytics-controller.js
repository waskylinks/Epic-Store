import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout, { calculatePriorityScore } from "../models/checkout-model.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getCache, setCache } from "../utils/redis.js";

// ============================================
// CHECKOUT ABANDONMENT STATS - FIXED
// ============================================

export const getCheckoutAbandonmentStats = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `checkout_abandonment_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [currentStats, previousStats] = await Promise.all([
    Checkout.getAbandonmentRate(currentPeriodStart, new Date()),
    Checkout.getAbandonmentRate(previousPeriodStart, previousPeriodEnd)
  ]);

  const trend =
    previousStats.abandonmentRate > 0
      ? ((currentStats.abandonmentRate - previousStats.abandonmentRate) /
          previousStats.abandonmentRate) *
        100
      : 0;

  const [abandonedValue, abandonmentByStep, recoveryStats] = await Promise.all([
    Checkout.aggregate([
      {
        $match: {
          "abandonment.isAbandoned": true,
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id: null,
          totalValue: { $sum: "$pricing.totalPrice" },
          avgValue: { $avg: "$pricing.totalPrice" },
          count: { $sum: 1 }
        }
      }
    ]),
    Checkout.aggregate([
      {
        $match: {
          "abandonment.isAbandoned": true,
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id: "$abandonment.abandonedAtStep",
          count: { $sum: 1 },
          totalValue: { $sum: "$pricing.totalPrice" }
        }
      },
      { $sort: { count: -1 } }
    ]),
    // Get recovery statistics
    Checkout.aggregate([
      {
        $match: {
          "abandonment.isAbandoned": true,
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id: null,
          totalAbandoned: { $sum: 1 },
          emailsSent: { $sum: "$abandonment.recoveryEmailCount" },
          recovered: {
            $sum: { $cond: ["$conversion.isConverted", 1, 0] }
          },
          recoveredValue: {
            $sum: {
              $cond: ["$conversion.isConverted", "$pricing.totalPrice", 0]
            }
          },
          highPriority: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$pricing.totalPrice", 100] },
                    { $eq: ["$conversion.isConverted", false] }
                  ]
                },
                1,
                0
              ]
            }
          },
          recoverableValue: {
            $sum: {
              $cond: [
                { $eq: ["$conversion.isConverted", false] },
                "$pricing.totalPrice",
                0
              ]
            }
          }
        }
      }
    ])
  ]);

  const recoveryData = recoveryStats[0] || {
    totalAbandoned: 0,
    emailsSent: 0,
    recovered: 0,
    recoveredValue: 0,
    highPriority: 0,
    recoverableValue: 0
  };

  // Transform abandonmentByStep to match frontend expectations
  const totalAbandonedCheckouts = currentStats.abandonedCheckouts || 1; // Avoid division by zero
  
  // Only create stepBreakdown if there are abandoned checkouts with step data
  const stepBreakdown = abandonmentByStep.length > 0 ? abandonmentByStep.map(step => {
    const stepName = step._id || 'unknown';
    const dropOffRate = (step.count / totalAbandonedCheckouts) * 100;
    
    // Convert step names to readable format
    const stepLabels = {
      'shipping_info': 'Shipping Information',
      'payment_selection': 'Payment Selection',
      'payment_gateway': 'Payment Gateway',
      'payment_failed': 'Payment Failed',
      'order_confirmation': 'Order Confirmation'
    };

    return {
      step: stepLabels[stepName] || stepName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      count: step.count,
      dropOffRate: Math.round(dropOffRate * 10) / 10, // Returns number with 1 decimal
      value: Math.round(step.totalValue * 100) / 100
    };
  }) : []; // Return empty array if no steps recorded

  const response = {
    // Main stats for the overview cards
    abandonmentRate: Math.round(currentStats.abandonmentRate * 10) / 10,
    completedCheckouts: currentStats.completedCheckouts || 0,
    abandonedCheckouts: currentStats.abandonedCheckouts || 0,
    totalCheckouts: currentStats.totalCheckouts || 0,
    lostRevenue: Math.round((abandonedValue[0]?.totalValue || 0) * 100) / 100,
    recoveryRate: Math.round(currentStats.recoveryRate * 10) / 10,
    
    // Step breakdown for the chart
    stepBreakdown,
    
    // Recovery opportunities data
    recoverableRevenue: Math.round(recoveryData.recoverableValue * 100) / 100,
    highPriority: recoveryData.highPriority,
    emailsSent: recoveryData.emailsSent,
    recoveredOrders: recoveryData.recovered,
    recoveredValue: Math.round(recoveryData.recoveredValue * 100) / 100,
    
    // Additional metrics
    avgAbandonedCheckoutValue: Math.round((abandonedValue[0]?.avgValue || 0) * 100) / 100,
    
    // Trend data
    trend: Math.round(trend * 100) / 100,
    previousPeriod: {
      abandonmentRate: Math.round(previousStats.abandonmentRate * 10) / 10,
      completedCheckouts: previousStats.completedCheckouts || 0,
      abandonedCheckouts: previousStats.abandonedCheckouts || 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ABANDONED CHECKOUTS LIST
// ============================================

export const getAbandonedCheckoutsList = handleAsyncError(async (req, res, next) => {
  const {
    hours = 24,
    minValue = 0,
    limit = 50,
    page = 1,
    sortBy = "priority"
  } = req.query;

  const cacheKey = `abandoned_list:${hours}_${minValue}_${limit}_${page}_${sortBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const checkouts = await Checkout.find({
    "abandonment.isAbandoned": true,
    "abandonment.abandonedAt": {
      $gte: new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000)
    },
    "pricing.totalPrice": { $gte: parseFloat(minValue) },
    "conversion.isConverted": false
  })
    .populate("user", "firstName lastName email")
    .populate("items.product", "name images pricing")
    .lean();

  const checkoutsWithPriority = checkouts.map((checkout) => {
    const hoursSinceAbandoned = checkout.abandonment?.abandonedAt
      ? Math.floor(
          (Date.now() - new Date(checkout.abandonment.abandonedAt).getTime()) /
            (1000 * 60 * 60)
        )
      : 0;

    return {
      ...checkout,
      priority: calculatePriorityScore(checkout),
      hoursSinceAbandoned
    };
  });

  let sortedCheckouts = checkoutsWithPriority;
  if (sortBy === "priority") {
    sortedCheckouts.sort((a, b) => b.priority - a.priority);
  } else if (sortBy === "value") {
    sortedCheckouts.sort((a, b) => b.pricing.totalPrice - a.pricing.totalPrice);
  } else if (sortBy === "date") {
    sortedCheckouts.sort(
      (a, b) =>
        new Date(b.abandonment.abandonedAt) - new Date(a.abandonment.abandonedAt)
    );
  }

  const paginatedCheckouts = sortedCheckouts.slice(skip, skip + parseInt(limit));
  const totalCheckouts = sortedCheckouts.length;
  const totalPages = Math.ceil(totalCheckouts / parseInt(limit));

  const response = {
    abandonedCheckouts: paginatedCheckouts,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalCheckouts,
      hasNextPage: parseInt(page) < totalPages,
      hasPrevPage: parseInt(page) > 1
    },
    summary: {
      totalValue: sortedCheckouts.reduce(
        (sum, checkout) => sum + checkout.pricing.totalPrice,
        0
      ),
      avgValue:
        sortedCheckouts.length > 0
          ? sortedCheckouts.reduce(
              (sum, checkout) => sum + checkout.pricing.totalPrice,
              0
            ) / sortedCheckouts.length
          : 0,
      highPriorityCheckouts: sortedCheckouts.filter(
        (checkout) => checkout.priority >= 70
      ).length
    }
  };

  await setCache(cacheKey, response, 180);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// RECOVERY OPPORTUNITIES
// ============================================

export const getRecoveryOpportunities = handleAsyncError(async (req, res, next) => {
  const { limit = 50 } = req.query;

  const cacheKey = `checkout_recovery_opportunities_${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const opportunities = await Checkout.getRecoveryOpportunities(parseInt(limit));

  const response = {
    opportunities,
    summary: {
      totalOpportunities: opportunities.length,
      totalPotentialRevenue: opportunities.reduce(
        (sum, checkout) => sum + checkout.pricing.totalPrice,
        0
      ),
      avgCheckoutValue:
        opportunities.length > 0
          ? opportunities.reduce(
              (sum, checkout) => sum + checkout.pricing.totalPrice,
              0
            ) / opportunities.length
          : 0
    }
  };

  await setCache(cacheKey, response, 180);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// MARK RECOVERY EMAIL SENT
// ============================================

export const markRecoveryEmailSent = handleAsyncError(async (req, res, next) => {
  const { checkoutId } = req.params;

  const checkout = await Checkout.findById(checkoutId);
  if (!checkout) {
    return next(new HandleError("Checkout not found", 404));
  }

  try {
    checkout.markRecoveryEmailSent();
    await checkout.save();

    res.status(200).json({
      success: true,
      message: "Recovery email marked as sent",
      checkout: {
        id: checkout._id,
        recoveryEmailCount: checkout.abandonment.recoveryEmailCount,
        recoveryEmailSentAt: checkout.abandonment.recoveryEmailSentAt,
        canSendNext: checkout.canSendRecoveryEmail()
      }
    });
  } catch (error) {
    return next(new HandleError(error.message, 400));
  }
});

export default {
  getCheckoutAbandonmentStats,
  getAbandonedCheckoutsList,
  getRecoveryOpportunities,
  markRecoveryEmailSent
};