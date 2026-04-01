import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout, { calculatePriorityScore } from "../models/checkout-model.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getCache, setCache, deleteCachePattern } from "../utils/redis.js";
import { sendRecoveryEmail } from "../Services/recoveryEmailService.js";
import { markStaleCheckouts } from '../utils/markStaleCheckouts.js';


const invalidateCheckoutCaches = () =>
  Promise.all([
    deleteCachePattern('checkout_abandonment_*'),
    deleteCachePattern('checkout_recovery_*'),
    deleteCachePattern('abandoned_list:*'),
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('analytics_*'),
  ]);

// ============================================
// CHECKOUT ABANDONMENT STATS
// ============================================

export const getCheckoutAbandonmentStats = handleAsyncError(async (req, res, next) => {
  try {
    await markStaleCheckouts();
  } catch (sweepErr) {
    console.error('[getCheckoutAbandonmentStats] Sweep failed:', sweepErr.message);
  }

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
          "conversion.isConverted":  false,
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id:        null,
          totalValue: { $sum: "$pricing.totalPrice" },
          avgValue:   { $avg: "$pricing.totalPrice" },
          count:      { $sum: 1 }
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
          _id: {
            $ifNull: ["$abandonment.firstAbandonedAtStep", "$abandonment.abandonedAtStep"]
          },
          count:      { $sum: 1 },
          totalValue: { $sum: "$pricing.totalPrice" }
        }
      },
      { $sort: { count: -1 } }
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
          _id:            null,
          totalAbandoned: { $sum: 1 },
          emailsSent:     { $sum: "$abandonment.recoveryEmailCount" },

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
                    { $eq:  ["$conversion.isConverted", false] }
                  ]
                },
                1, 0
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
          },

          reAbandonedCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$abandonment.reAbandoned",      true]  },
                    { $eq: ["$conversion.isConverted",       false] }
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
                    { $eq: ["$abandonment.reAbandoned",      true]  },
                    { $eq: ["$conversion.isConverted",       false] }
                  ]
                },
                "$pricing.totalPrice",
                0
              ]
            }
          },

          organicRecoveryCount: {
            $sum: {
              $cond: [{ $eq: ["$abandonment.organicRecovery", true] }, 1, 0]
            }
          }
        }
      }
    ])
  ]);

  const recoveryData = recoveryStats[0] || {
    totalAbandoned:        0,
    emailsSent:            0,
    recovered:             0,
    recoveredValue:        0,
    highPriority:          0,
    recoverableValue:      0,
    reAbandonedCount:      0,
    failedRecoveryRevenue: 0,
    organicRecoveryCount:  0
  };

  const totalAbandonedCheckouts = currentStats.abandonedCheckouts || 1;

  const stepLabels = {
    'shipping_info':      'Shipping Information',
    'order_confirmation': 'Order Confirmation',
    'payment_selection':  'Payment Selection',
    'payment_gateway':    'Payment Gateway',
    'payment_failed':     'Payment Failed',
  };

  const stepBreakdown = abandonmentByStep.length > 0
    ? abandonmentByStep.map(step => {
        const stepName    = step._id || 'unknown';
        const dropOffRate = (step.count / totalAbandonedCheckouts) * 100;
        return {
          step:        stepLabels[stepName] || stepName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          count:       step.count,
          dropOffRate: Math.round(dropOffRate * 10) / 10,
          value:       Math.round(step.totalValue * 100) / 100
        };
      })
    : [];

  const response = {
    abandonmentRate:    Math.round(currentStats.abandonmentRate * 10) / 10,
    completedCheckouts: currentStats.completedCheckouts || 0,
    abandonedCheckouts: currentStats.abandonedCheckouts || 0,
    totalCheckouts:     currentStats.totalCheckouts     || 0,
    lostRevenue:        Math.round((abandonedValue[0]?.totalValue || 0) * 100) / 100,
    recoveryRate:       Math.round(currentStats.recoveryRate * 10) / 10,
    stepBreakdown,
    recoverableRevenue: Math.round(recoveryData.recoverableValue    * 100) / 100,
    highPriority:       recoveryData.highPriority,
    emailsSent:         recoveryData.emailsSent,
    recoveredOrders:    recoveryData.recovered,
    recoveredValue:     Math.round(recoveryData.recoveredValue      * 100) / 100,
    avgAbandonedCheckoutValue: Math.round((abandonedValue[0]?.avgValue || 0) * 100) / 100,
    trend:              Math.round(trend * 100) / 100,

    reAbandonedCount:       recoveryData.reAbandonedCount,
    failedRecoveryRevenue:  Math.round(recoveryData.failedRecoveryRevenue * 100) / 100,
    organicRecoveryCount:   recoveryData.organicRecoveryCount,

    previousPeriod: {
      abandonmentRate:    Math.round(previousStats.abandonmentRate * 10) / 10,
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
  try {
    await markStaleCheckouts();
  } catch (sweepErr) {
    console.error('[getAbandonedCheckoutsList] Sweep failed:', sweepErr.message);
  }

  const {
    hours       = 24,
    minValue    = 0,
    limit       = 50,
    page        = 1,
    sortBy      = "priority",
    emailSent,
    recovered,
    reAbandoned,
  } = req.query;

  const cacheKey = `abandoned_list:${hours}_${minValue}_${limit}_${page}_${sortBy}_es${emailSent ?? ''}_rec${recovered ?? ''}_rea${reAbandoned ?? ''}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {
    'abandonment.isAbandoned': true,
    'abandonment.abandonedAt': {
      $gte: new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000),
    },
    'pricing.totalPrice':     { $gte: parseFloat(minValue) },
    'conversion.isConverted': false,
  };

  if (emailSent === 'true')  query['abandonment.recoveryEmailSent'] = true;
  if (emailSent === 'false') query['abandonment.recoveryEmailSent'] = false;

  if (recovered === 'true') {
    query['abandonment.recovered'] = true;
    delete query['conversion.isConverted'];
  }

  if (reAbandoned === 'true')  query['abandonment.reAbandoned'] = true;
  if (reAbandoned === 'false') query['abandonment.reAbandoned'] = { $ne: true };

  const DB_SORT_MAP = {
    value: { 'pricing.totalPrice':      -1 },
    date:  { 'abandonment.abandonedAt': -1 },
  };

  const PRIORITY_FETCH_CAP = 500;

  let checkouts;
  let totalCheckouts;

  if (sortBy === 'priority') {
    const [raw, count] = await Promise.all([
      Checkout.find(query)
        .populate('user',          'firstName lastName email')
        .populate('items.product', 'name images pricing')
        .limit(PRIORITY_FETCH_CAP)
        .lean(),
      Checkout.countDocuments(query)
    ]);

    const withPriority = raw.map(checkout => ({
      ...checkout,
      priority: calculatePriorityScore(checkout),
      hoursSinceAbandoned: checkout.abandonment?.abandonedAt
        ? Math.floor(
            (Date.now() - new Date(checkout.abandonment.abandonedAt).getTime()) /
            (1000 * 60 * 60)
          )
        : 0
    }));

    withPriority.sort((a, b) => b.priority - a.priority);

    checkouts      = withPriority.slice(skip, skip + parseInt(limit));
    totalCheckouts = count;

  } else {
    const dbSort = DB_SORT_MAP[sortBy] || { 'abandonment.abandonedAt': -1 };

    const [raw, count] = await Promise.all([
      Checkout.find(query)
        .populate('user',          'firstName lastName email')
        .populate('items.product', 'name images pricing')
        .sort(dbSort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Checkout.countDocuments(query)
    ]);

    checkouts = raw.map(checkout => ({
      ...checkout,
      priority: calculatePriorityScore(checkout),
      hoursSinceAbandoned: checkout.abandonment?.abandonedAt
        ? Math.floor(
            (Date.now() - new Date(checkout.abandonment.abandonedAt).getTime()) /
            (1000 * 60 * 60)
          )
        : 0
    }));

    totalCheckouts = count;
  }

  const [summaryResult] = await Checkout.aggregate([
    { $match: query },
    {
      $group: {
        _id:         null,
        totalValue:  { $sum: '$pricing.totalPrice' },
        avgValue:    { $avg: '$pricing.totalPrice' },
        highPriority: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$pricing.totalPrice', 100] },
                  { $eq:  ['$conversion.isConverted', false] }
                ]
              },
              1, 0
            ]
          }
        },
        reAbandonedCount: {
          $sum: {
            $cond: [{ $eq: ['$abandonment.reAbandoned', true] }, 1, 0]
          }
        }
      }
    }
  ]);

  const summary    = summaryResult || { totalValue: 0, avgValue: 0, highPriority: 0, reAbandonedCount: 0 };
  const totalPages = Math.ceil(totalCheckouts / parseInt(limit));

  const response = {
    abandonedCheckouts: checkouts,
    pagination: {
      currentPage:    parseInt(page),
      totalPages,
      totalCheckouts,
      hasNextPage:    parseInt(page) < totalPages,
      hasPrevPage:    parseInt(page) > 1
    },
    summary: {
      totalValue:             Math.round(summary.totalValue * 100) / 100,
      avgValue:               Math.round(summary.avgValue   * 100) / 100,
      highPriorityCheckouts:  summary.highPriority,
      reAbandonedCount:       summary.reAbandonedCount
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
      totalOpportunities:    opportunities.length,
      totalPotentialRevenue: opportunities.reduce(
        (sum, c) => sum + c.pricing.totalPrice, 0
      ),
      avgCheckoutValue:
        opportunities.length > 0
          ? opportunities.reduce((sum, c) => sum + c.pricing.totalPrice, 0) /
            opportunities.length
          : 0
    }
  };

  await setCache(cacheKey, response, 180);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// RE-ABANDONMENT ANALYTICS
// ============================================

export const getReAbandonmentAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `checkout_re_abandonment_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } =
    getDateRanges(timeframe);

  const [current, previous] = await Promise.all([
    Checkout.getReAbandonmentAnalytics(currentPeriodStart, new Date()),
    Checkout.getReAbandonmentAnalytics(previousPeriodStart, previousPeriodEnd)
  ]);

  const stepLabels = {
    'shipping_info':      'Shipping Information',
    'order_confirmation': 'Order Confirmation',
    'payment_selection':  'Payment Selection',
    'payment_gateway':    'Payment Gateway',
    'payment_failed':     'Payment Failed',
  };

  const response = {
    current: {
      ...current,
      stepBreakdown: current.stepBreakdown.map(s => ({
        ...s,
        stepLabel: stepLabels[s.step] || s.step.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      }))
    },
    previous: {
      total:            previous.total,
      totalRevenueLost: previous.totalRevenueLost,
      avgCartValue:     previous.avgCartValue
    },
    trend: {
      totalChange: previous.total > 0
        ? Math.round(((current.total - previous.total) / previous.total) * 10000) / 100
        : 0,
      revenueLostChange: previous.totalRevenueLost > 0
        ? Math.round(((current.totalRevenueLost - previous.totalRevenueLost) / previous.totalRevenueLost) * 10000) / 100
        : 0
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// MARK RECOVERY EMAIL SENT (legacy)
// ============================================





export default {
  getCheckoutAbandonmentStats,
  getAbandonedCheckoutsList,
  getRecoveryOpportunities,
  getReAbandonmentAnalytics,
};