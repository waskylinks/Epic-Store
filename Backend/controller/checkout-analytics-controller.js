import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout, { calculatePriorityScore } from "../models/checkout-model.js";
import RecoveryEmail from "../models/recovery-email-model.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getCache, setCache, deleteCachePattern } from "../utils/redis.js";
import { markStaleCheckouts } from '../utils/markStaleCheckouts.js';

const invalidateCheckoutCaches = () =>
  Promise.all([
    deleteCachePattern('checkout_abandonment_*'),
    deleteCachePattern('checkout_recovery_*'),
    deleteCachePattern('abandoned_list:*'),
    deleteCachePattern('admin_stats*'),
    deleteCachePattern('analytics_*'),
  ]);

// Canonical funnel step order — used to sort stepBreakdown arrays so the
// frontend always receives steps in the correct checkout sequence regardless
// of MongoDB aggregation sort order.
const FUNNEL_ORDER = [
  'shipping_info',
  'order_confirmation',
  'payment_selection',
  'payment_gateway',
  'payment_failed',
];

const STEP_LABELS = {
  'shipping_info':      'Shipping Information',
  'order_confirmation': 'Order Confirmation',
  'payment_selection':  'Payment Selection',
  'payment_gateway':    'Payment Gateway',
  'payment_failed':     'Payment Failed',
};

// sortStepBreakdown: sorts an array of { step, ... } objects by FUNNEL_ORDER.
// stepKeyFn extracts the raw snake_case step key from each element.
const sortStepBreakdown = (arr, stepKeyFn = (s) => s.step) =>
  [...arr].sort((a, b) => {
    const ai = FUNNEL_ORDER.indexOf(stepKeyFn(a));
    const bi = FUNNEL_ORDER.indexOf(stepKeyFn(b));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

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

  // Coerce -0 to 0 to prevent "-0%" rendering in TrendBadge.
  const rawTrend =
    previousStats.abandonmentRate > 0
      ? ((currentStats.abandonmentRate - previousStats.abandonmentRate) /
          previousStats.abandonmentRate) * 100
      : 0;
  const trend = Math.round((rawTrend || 0) * 100) / 100;

  // Fetch terminal-outcome checkout IDs so recoverable figures exclude carts
  // whose recovery campaign is already definitively over.
  const terminalRecoveryCheckoutIds = await RecoveryEmail.distinct('checkout', {
    outcome: { $in: ['expired', 're_abandoned', 'failed'] },
  });

  const [
    abandonedValue,
    abandonmentByStep,
    reachCountByStep,
    recoveryStats,
    expiredRecoveryStats,
    recoverableCountResult,
  ] = await Promise.all([

    // Total / avg value of all unconverted abandoned carts this period.
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

    // Numerator: group by the step where the user FIRST abandoned.
    // FIX: uses firstAbandonedAtStep (the step recorded on the very first
    // abandonment event) rather than abandonedAtStep (which can be overwritten
    // on re-abandonment), so the funnel correctly reflects where users first
    // dropped off rather than where they last dropped off.
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
      }
      // NOTE: intentionally no $sort here — we sort by FUNNEL_ORDER in JS below
      // to guarantee the canonical step sequence rather than count-descending.
    ]),

    // Denominator: furthest step ever reached per checkout (advance-only
    // high-water mark) — used to compute the true per-step drop-off rate.
    Checkout.aggregate([
      {
        $match: {
          "abandonment.isAbandoned": true,
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id:   "$furthestStepReached",
          count: { $sum: 1 }
        }
      }
    ]),

    // Recovery aggregation — email, revenue, and re-abandonment counters.
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
          // recoverableValue: excludes carts whose recovery campaign is terminal.
          recoverableValue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$conversion.isConverted", false] },
                    { $not: { $in: ["$_id", terminalRecoveryCheckoutIds] } }
                  ]
                },
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
                    { $eq: ["$abandonment.reAbandoned",  true]  },
                    { $eq: ["$conversion.isConverted",   false] }
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
                    { $eq: ["$abandonment.reAbandoned",  true]  },
                    { $eq: ["$conversion.isConverted",   false] }
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
    ]),

    // Expired recovery campaigns: all emails sent, all tokens elapsed, never clicked.
    RecoveryEmail.aggregate([
      {
        $match: {
          outcome:   'expired',
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $lookup: {
          from:         'checkouts',
          localField:   'checkout',
          foreignField: '_id',
          as:           'checkoutDoc',
        }
      },
      { $unwind: { path: '$checkoutDoc', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id:                  null,
          expiredRecoveryCount: { $sum: 1 },
          expiredRevenueLost:   { $sum: '$checkoutDoc.pricing.totalPrice' },
        }
      }
    ]),

    // recoverableCount: unconverted abandoned carts with a live recovery path.
    Checkout.countDocuments({
      "abandonment.isAbandoned": true,
      "conversion.isConverted":  false,
      createdAt: { $gte: currentPeriodStart },
      _id: { $nin: terminalRecoveryCheckoutIds },
    }),
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

  const expiredData = expiredRecoveryStats[0] || {
    expiredRecoveryCount: 0,
    expiredRevenueLost:   0,
  };

  // Build reach map from furthestStepReached aggregation.
  const reachMap = {};
  for (const row of reachCountByStep) {
    if (row._id) reachMap[row._id] = row.count;
  }

  // Build stepBreakdown and sort by canonical funnel order.
  // FIX: Previously sorted by count DESC (MongoDB default after $group),
  // which placed high-count steps first. This caused shipping_info to
  // appear later in the UI than payment_gateway when fewer users abandoned
  // at the first step — the opposite of the correct funnel sequence.
  const unsortedStepBreakdown = abandonmentByStep.length > 0
    ? abandonmentByStep.map(step => {
        const stepName    = step._id || 'unknown';
        const reachCount  = reachMap[stepName] ?? step.count;
        const dropOffRate = reachCount > 0
          ? (step.count / reachCount) * 100
          : 0;

        return {
          step:        STEP_LABELS[stepName] || stepName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          _rawKey:     stepName, // kept for sorting, stripped before response
          count:       step.count,
          reachCount,
          dropOffRate: Math.round(dropOffRate * 10) / 10,
          value:       Math.round(step.totalValue * 100) / 100
        };
      })
    : [];

  // Sort by FUNNEL_ORDER using the raw key, then strip the internal _rawKey.
  const stepBreakdown = sortStepBreakdown(unsortedStepBreakdown, (s) => s._rawKey)
    .map(({ _rawKey, ...rest }) => rest);

  const totalFailedRecoveries  = recoveryData.reAbandonedCount + expiredData.expiredRecoveryCount;
  const totalFailedRevenueLost = Math.round(
    (recoveryData.failedRecoveryRevenue + expiredData.expiredRevenueLost) * 100
  ) / 100;

  const response = {
    abandonmentRate:    Math.round(currentStats.abandonmentRate * 10) / 10,
    completedCheckouts: currentStats.completedCheckouts || 0,
    abandonedCheckouts: currentStats.abandonedCheckouts || 0,
    totalCheckouts:     currentStats.totalCheckouts     || 0,
    lostRevenue:        Math.round((abandonedValue[0]?.totalValue || 0) * 100) / 100,
    recoveryRate:       Math.round(currentStats.recoveryRate * 10) / 10,
    stepBreakdown,
    recoverableRevenue: Math.round(recoveryData.recoverableValue    * 100) / 100,
    recoverableCount:   recoverableCountResult || 0,
    highPriority:       recoveryData.highPriority,
    emailsSent:         recoveryData.emailsSent,
    recoveredOrders:    recoveryData.recovered,
    recoveredValue:     Math.round(recoveryData.recoveredValue      * 100) / 100,
    // FIX: avgAbandonedCheckoutValue — average across ALL abandoned carts in the
    // period, not just the recovery-opportunities subset. Previously the Recovery
    // tab read from recoveryOpportunities.summary.avgCheckoutValue which was the
    // average of only carts where recoveryEmailSent=false, producing a biased
    // figure that changed as more emails were sent.
    avgAbandonedCheckoutValue: Math.round((abandonedValue[0]?.avgValue || 0) * 100) / 100,
    trend,

    reAbandonedCount:      recoveryData.reAbandonedCount,
    failedRecoveryRevenue: Math.round(recoveryData.failedRecoveryRevenue * 100) / 100,

    expiredRecoveryCount: expiredData.expiredRecoveryCount,
    expiredRevenueLost:   Math.round(expiredData.expiredRevenueLost * 100) / 100,

    totalFailedRecoveries,
    totalFailedRevenueLost,

    organicRecoveryCount: recoveryData.organicRecoveryCount,

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

  // FIX: Join RecoveryEmail records to surface recoveryOutcome on each checkout.
  // The Flags column in the frontend needs to show "Expired" for carts whose
  // recovery campaign reached outcome='expired'. Without this join the flag
  // could not be determined client-side because the checkout document itself
  // only stores lastRecoveryTokenExpiredAt (not the campaign outcome).
  const checkoutIds = checkouts.map(c => c._id);
  const recoveryRecords = await RecoveryEmail.find(
    { checkout: { $in: checkoutIds } },
    { checkout: 1, outcome: 1 }
  ).lean();

  const recoveryOutcomeMap = new Map(
    recoveryRecords.map(r => [r.checkout.toString(), r.outcome])
  );

  const checkoutsWithOutcome = checkouts.map(c => ({
    ...c,
    recoveryOutcome: recoveryOutcomeMap.get(c._id.toString()) || null,
  }));

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
    abandonedCheckouts: checkoutsWithOutcome,
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
      // NOTE: avgCheckoutValue here is the average of uncontacted carts only
      // (recoveryEmailSent=false). Do not use this for the global "avg abandoned
      // cart value" KPI — use stats.avgAbandonedCheckoutValue from the
      // abandonment stats endpoint instead.
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

  // Coerce -0 to 0 before Math.round to prevent "-0%" in TrendBadge.
  const rawTotalChange =
    previous.total > 0
      ? ((current.total - previous.total) / previous.total) * 10000 / 100
      : 0;

  const rawRevenueLostChange =
    previous.totalRevenueLost > 0
      ? ((current.totalRevenueLost - previous.totalRevenueLost) / previous.totalRevenueLost) * 10000 / 100
      : 0;

  // FIX: Sort re-abandonment stepBreakdown by canonical funnel order so the
  // "Post-Recovery Drop-Off" bar chart and comparison table render in the
  // correct sequence rather than count-descending.
  const sortedStepBreakdown = sortStepBreakdown(
    current.stepBreakdown.map(s => ({
      ...s,
      stepLabel: STEP_LABELS[s.step] || s.step.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      _rawKey:   s.step,
    })),
    (s) => s._rawKey
  ).map(({ _rawKey, ...rest }) => rest);

  const response = {
    current: {
      ...current,
      stepBreakdown: sortedStepBreakdown,
    },
    previous: {
      total:            previous.total,
      totalRevenueLost: previous.totalRevenueLost,
      avgCartValue:     previous.avgCartValue
    },
    trend: {
      totalChange:       Math.round((rawTotalChange       || 0) * 100) / 100,
      revenueLostChange: Math.round((rawRevenueLostChange || 0) * 100) / 100,
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getCheckoutAbandonmentStats,
  getAbandonedCheckoutsList,
  getRecoveryOpportunities,
  getReAbandonmentAnalytics,
};