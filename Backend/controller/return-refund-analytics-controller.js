import handleAsyncError from "../middleware/handleAsyncError.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { calculateTrend } from "../utils/calculateTrend.js";

// ============================================
// RETURN ANALYTICS
// ============================================

const PLEA_STATUSES = ['plea_submitted', 'approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed'];
const POST_REVIEW_STATUSES = ['items_reviewed', 'plea_submitted', 'approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed'];
const FINALISED_RETURN_STATUSES = ['approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed'];

// ============================================
// UPDATED: getReturnOverview — adds plea fields
// @route GET /api/v1/analytics/returns/overview
// ============================================
export const getReturnOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = 'month' } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `return_overview_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...JSON.parse(cached) });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [currentReturns, previousReturns, totalDeliveredOrders] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          'returnInfo.requestedAt': { $gte: currentPeriodStart },
          'returnInfo.status': { $nin: ['none'] },
        },
      },
      {
        $group: {
          _id: null,
          totalReturns:     { $sum: 1 },
          requested:        { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'requested'] },        1, 0] } },
          items_reviewed:   { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'items_reviewed'] },   1, 0] } },
          plea_submitted:   { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'plea_submitted'] },   1, 0] } },
          approved:         { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'approved'] },         1, 0] } },
          in_transit:       { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'in_transit'] },       1, 0] } },
          received:         { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'received'] },         1, 0] } },
          inspected:        { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'inspected'] },        1, 0] } },
          awaiting_discount:{ $sum: { $cond: [{ $eq: ['$returnInfo.status', 'awaiting_discount'] },1, 0] } },
          completed:        { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'completed'] },        1, 0] } },
          rejected:         { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'rejected'] },         1, 0] } },
          cancelled:        { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'cancelled'] },        1, 0] } },

          // Credit metrics — only meaningful for finalised returns
          totalRequestedGross:  { $sum: { $ifNull: ['$returnInfo.requestedGross',  0] } },
          totalApprovedGross:   { $sum: { $ifNull: ['$returnInfo.approvedGross',   0] } },
          totalRejectedGross:   { $sum: { $ifNull: ['$returnInfo.rejectedGross',   0] } },
          totalDiscountValue:   { $sum: { $ifNull: ['$returnInfo.discountValue',   0] } },
          totalShippingDeducted:{ $sum: { $ifNull: ['$returnInfo.shippingDeducted',0] } },

          // Plea metrics
          withPlea:       { $sum: { $cond: [{ $gte: ['$returnInfo.pleaAttempts', 1] }, 1, 0] } },
          pleaApproved:   { $sum: { $cond: [{ $and: [{ $gte: ['$returnInfo.pleaAttempts', 1] }, { $in: ['$returnInfo.status', FINALISED_RETURN_STATUSES] }] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          'returnInfo.requestedAt': { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          'returnInfo.status': { $nin: ['none'] },
        },
      },
      { $group: { _id: null, totalReturns: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$returnInfo.status', 'completed'] }, 1, 0] } } } },
    ]),
    Order.countDocuments({ orderStatus: 'Delivered', deliveredAt: { $gte: currentPeriodStart } }),
  ]);

  const current  = currentReturns[0]  ?? {};
  const previous = previousReturns[0] ?? { totalReturns: 0, completed: 0 };

  const totalReturns = current.totalReturns ?? 0;

  const returnRate = totalDeliveredOrders > 0
    ? Math.round((totalReturns / totalDeliveredOrders) * 100 * 100) / 100
    : 0;

  const approvalRate = totalReturns > 0
    ? Math.round(((current.completed ?? 0) / totalReturns) * 100 * 100) / 100
    : 0;

  // Plea rate: what % of returns triggered a plea
  const pleaRate = totalReturns > 0
    ? Math.round(((current.withPlea ?? 0) / totalReturns) * 100 * 100) / 100
    : 0;

  const [returnReasons, processingTimes] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          'returnInfo.requestedAt': { $gte: currentPeriodStart },
          'returnInfo.status': { $nin: ['none'] },
        },
      },
      { $group: { _id: '$returnInfo.reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Avg days from requested → completed
    Order.aggregate([
      {
        $match: {
          'returnInfo.status': 'completed',
          'returnInfo.requestedAt': { $gte: currentPeriodStart },
          'returnInfo.completedAt': { $exists: true },
        },
      },
      {
        $project: {
          totalDays: {
            $divide: [
              { $subtract: ['$returnInfo.completedAt', '$returnInfo.requestedAt'] },
              1000 * 60 * 60 * 24,
            ],
          },
          reviewDays: {
            $cond: [
              { $and: [{ $ifNull: ['$returnInfo.approvedAt', false] }, { $ifNull: ['$returnInfo.requestedAt', false] }] },
              { $divide: [{ $subtract: ['$returnInfo.approvedAt', '$returnInfo.requestedAt'] }, 1000 * 60 * 60 * 24] },
              null,
            ],
          },
        },
      },
      { $match: { totalDays: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          avgProcessingDays: { $avg: '$totalDays' },
          avgReviewDays:     { $avg: '$reviewDays' },
        },
      },
    ]),
  ]);

  const response = {
    currentPeriod: {
      totalReturns,
      returnRate,
      approvalRate,
      pleaRate,
      byStatus: {
        requested:         current.requested          ?? 0,
        items_reviewed:    current.items_reviewed     ?? 0,
        plea_submitted:    current.plea_submitted     ?? 0,
        approved:          current.approved           ?? 0,
        in_transit:        current.in_transit         ?? 0,
        received:          current.received           ?? 0,
        inspected:         current.inspected          ?? 0,
        awaiting_discount: current.awaiting_discount  ?? 0,
        completed:         current.completed          ?? 0,
        rejected:          current.rejected           ?? 0,
        cancelled:         current.cancelled          ?? 0,
      },
      creditMetrics: {
        totalRequestedGross:   Math.round((current.totalRequestedGross   ?? 0) * 100) / 100,
        totalApprovedGross:    Math.round((current.totalApprovedGross    ?? 0) * 100) / 100,
        totalRejectedGross:    Math.round((current.totalRejectedGross    ?? 0) * 100) / 100,
        totalDiscountValue:    Math.round((current.totalDiscountValue    ?? 0) * 100) / 100,
        totalShippingDeducted: Math.round((current.totalShippingDeducted ?? 0) * 100) / 100,
      },
      pleaMetrics: {
        withPlea:     current.withPlea     ?? 0,
        pleaRate,
      },
      avgProcessingDays: Math.round((processingTimes[0]?.avgProcessingDays ?? 0) * 10) / 10,
      avgReviewDays:     Math.round((processingTimes[0]?.avgReviewDays     ?? 0) * 10) / 10,
    },
    previousPeriod: {
      totalReturns: previous.totalReturns,
      completed:    previous.completed,
    },
    trend:     calculateTrend(totalReturns, previous.totalReturns),
    byReason:  returnReasons,
  };

  await setCache(cacheKey, JSON.stringify(response), 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// NEW: getReturnPleaAnalytics
// Plea-specific intelligence — the metrics no other system has
// @route GET /api/v1/analytics/returns/plea
// ============================================
export const getReturnPleaAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = 'month' } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `return_plea_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...JSON.parse(cached) });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  // All returns that went through R1 review (have item decisions)
  const [pleaStats, itemLevelPleaStats, previousPleaStats] = await Promise.all([

    // Return-level plea stats
    Order.aggregate([
      {
        $match: {
          'returnInfo.requestedAt': { $gte: currentPeriodStart },
          'returnInfo.status': { $nin: ['none', 'requested'] },
        },
      },
      {
        $group: {
          _id: null,
          totalReviewed:     { $sum: 1 },

          // Returns where customer submitted a plea
          withPlea:          { $sum: { $cond: [{ $gte: ['$returnInfo.pleaAttempts', 1] }, 1, 0] } },

          // Returns where plea was submitted and now finalised (can assess outcome)
          pleaFinalised: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$returnInfo.pleaAttempts', 1] },
                    { $in: ['$returnInfo.status', ['completed', 'approved', 'in_transit', 'received', 'inspected', 'awaiting_discount']] },
                  ],
                },
                1, 0,
              ],
            },
          },

          // Returns where plea resulted in higher credit than R1
          // approvedGross > 0 and plea happened = plea resulted in some approval
          pleaResultedInMoreCredit: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$returnInfo.pleaAttempts', 1] },
                    { $gt:  ['$returnInfo.approvedGross', 0] },
                    { $in:  ['$returnInfo.status', ['completed', 'in_transit', 'received', 'inspected', 'awaiting_discount']] },
                  ],
                },
                1, 0,
              ],
            },
          },

          // Plea deadline expired without admin response
          pleaDeadlineExpired: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$returnInfo.pleaAttempts', 1] },
                    { $eq:  ['$returnInfo.pleaDeadline', null] },
                    { $in:  ['$returnInfo.status', ['approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed']] },
                  ],
                },
                1, 0,
              ],
            },
          },

          // Credit delta — how much extra credit was issued after plea vs R1
          totalApprovedGross:  { $sum: { $ifNull: ['$returnInfo.approvedGross',  0] } },
          totalRejectedGross:  { $sum: { $ifNull: ['$returnInfo.rejectedGross',  0] } },
          totalDiscountValue:  { $sum: { $ifNull: ['$returnInfo.discountValue',  0] } },
          totalRequestedGross: { $sum: { $ifNull: ['$returnInfo.requestedGross', 0] } },
        },
      },
    ]),

    // Item-level plea pool breakdown — unwind itemsToReturn
    Order.aggregate([
      {
        $match: {
          'returnInfo.requestedAt': { $gte: currentPeriodStart },
          'returnInfo.status': { $in: ['completed', 'in_transit', 'received', 'inspected', 'awaiting_discount'] },
        },
      },
      { $unwind: '$returnInfo.itemsToReturn' },
      {
        $group: {
          _id: null,
          totalItems:            { $sum: 1 },
          totalQuantity:         { $sum: { $ifNull: ['$returnInfo.itemsToReturn.quantity',             0] } },
          totalApprovedQty:      { $sum: { $ifNull: ['$returnInfo.itemsToReturn.approvedQuantity',     0] } },
          totalPleaQty:          { $sum: { $ifNull: ['$returnInfo.itemsToReturn.pleaQuantity',         0] } },
          totalPleaApprovedQty:  { $sum: { $ifNull: ['$returnInfo.itemsToReturn.pleaApprovedQty',      0] } },
          totalPleaRejectedQty:  { $sum: { $ifNull: ['$returnInfo.itemsToReturn.pleaRejectedQty',      0] } },
          totalSilentAccepted:   { $sum: { $ifNull: ['$returnInfo.itemsToReturn.silentAcceptedQuantity', 0] } },

          // Items that went through plea (pleaQuantity is set)
          itemsWithPlea: {
            $sum: {
              $cond: [{ $gt: [{ $ifNull: ['$returnInfo.itemsToReturn.pleaQuantity', 0] }, 0] }, 1, 0],
            },
          },

          // Items fully approved (approvedQuantity === quantity)
          itemsFullyApproved: {
            $sum: {
              $cond: [
                { $eq: ['$returnInfo.itemsToReturn.approvedQuantity', '$returnInfo.itemsToReturn.quantity'] },
                1, 0,
              ],
            },
          },

          // Items fully rejected (approvedQuantity === 0)
          itemsFullyRejected: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ['$returnInfo.itemsToReturn.approvedQuantity', 0] }, 0] },
                1, 0,
              ],
            },
          },

          // Items partially approved
          itemsPartiallyApproved: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $ifNull: ['$returnInfo.itemsToReturn.approvedQuantity', 0] }, 0] },
                    { $lt: ['$returnInfo.itemsToReturn.approvedQuantity', '$returnInfo.itemsToReturn.quantity'] },
                  ],
                },
                1, 0,
              ],
            },
          },
        },
      },
    ]),

    // Previous period plea stats for trend
    Order.aggregate([
      {
        $match: {
          'returnInfo.requestedAt': { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          'returnInfo.status': { $nin: ['none', 'requested'] },
        },
      },
      {
        $group: {
          _id: null,
          totalReviewed: { $sum: 1 },
          withPlea:      { $sum: { $cond: [{ $gte: ['$returnInfo.pleaAttempts', 1] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const stats         = pleaStats[0]         ?? {};
  const itemStats     = itemLevelPleaStats[0] ?? {};
  const prevStats     = previousPleaStats[0]  ?? { totalReviewed: 0, withPlea: 0 };

  const totalReviewed       = stats.totalReviewed       ?? 0;
  const withPlea            = stats.withPlea            ?? 0;
  const pleaFinalised       = stats.pleaFinalised       ?? 0;
  const totalRequestedGross = stats.totalRequestedGross ?? 0;
  const totalApprovedGross  = stats.totalApprovedGross  ?? 0;

  // Plea submission rate
  const pleaSubmissionRate = totalReviewed > 0
    ? Math.round((withPlea / totalReviewed) * 100 * 100) / 100
    : 0;

  // Plea success rate — of those that went through plea, how many got more credit
  const pleaSuccessRate = pleaFinalised > 0
    ? Math.round(((stats.pleaResultedInMoreCredit ?? 0) / pleaFinalised) * 100 * 100) / 100
    : 0;

  // Silent acceptance rate — units customer chose not to contest / total contestable
  const totalContestable    = (itemStats.totalPleaQty ?? 0) + (itemStats.totalSilentAccepted ?? 0);
  const silentAcceptanceRate = totalContestable > 0
    ? Math.round(((itemStats.totalSilentAccepted ?? 0) / totalContestable) * 100 * 100) / 100
    : 0;

  // Unit approval rate
  const totalQty    = itemStats.totalQuantity    ?? 0;
  const approvedQty = itemStats.totalApprovedQty ?? 0;
  const unitApprovalRate = totalQty > 0
    ? Math.round((approvedQty / totalQty) * 100 * 100) / 100
    : 0;

  // Plea unit approval rate — of contested units, how many were approved
  const pleaQty         = itemStats.totalPleaQty         ?? 0;
  const pleaApprovedQty = itemStats.totalPleaApprovedQty ?? 0;
  const pleaUnitApprovalRate = pleaQty > 0
    ? Math.round((pleaApprovedQty / pleaQty) * 100 * 100) / 100
    : 0;

  // Credit recovery rate — approved / requested
  const creditRecoveryRate = totalRequestedGross > 0
    ? Math.round((totalApprovedGross / totalRequestedGross) * 100 * 100) / 100
    : 0;

  // Admin deadline expiry rate
  const pleaDeadlineExpiredRate = pleaFinalised > 0
    ? Math.round(((stats.pleaDeadlineExpired ?? 0) / pleaFinalised) * 100 * 100) / 100
    : 0;

  const response = {
    returnLevel: {
      totalReviewed,
      withPlea,
      pleaSubmissionRate,
      pleaFinalised,
      pleaSuccessRate,
      pleaDeadlineExpired:     stats.pleaDeadlineExpired     ?? 0,
      pleaDeadlineExpiredRate,
      pleaResultedInMoreCredit: stats.pleaResultedInMoreCredit ?? 0,
    },
    unitLevel: {
      totalItems:              itemStats.totalItems             ?? 0,
      totalQuantity:           totalQty,
      totalApprovedQty:        approvedQty,
      unitApprovalRate,
      itemsFullyApproved:      itemStats.itemsFullyApproved     ?? 0,
      itemsPartiallyApproved:  itemStats.itemsPartiallyApproved ?? 0,
      itemsFullyRejected:      itemStats.itemsFullyRejected     ?? 0,
      itemsWithPlea:           itemStats.itemsWithPlea          ?? 0,
      pleaQty,
      pleaApprovedQty,
      pleaRejectedQty:         itemStats.totalPleaRejectedQty   ?? 0,
      silentAcceptedQty:       itemStats.totalSilentAccepted    ?? 0,
      silentAcceptanceRate,
      pleaUnitApprovalRate,
    },
    creditMetrics: {
      totalRequestedGross:  Math.round((stats.totalRequestedGross ?? 0) * 100) / 100,
      totalApprovedGross:   Math.round((stats.totalApprovedGross  ?? 0) * 100) / 100,
      totalRejectedGross:   Math.round((stats.totalRejectedGross  ?? 0) * 100) / 100,
      totalDiscountValue:   Math.round((stats.totalDiscountValue  ?? 0) * 100) / 100,
      creditRecoveryRate,
    },
    trends: {
      pleaSubmissionRate: calculateTrend(
        withPlea,
        prevStats.withPlea
      ),
      totalReviewed: calculateTrend(
        totalReviewed,
        prevStats.totalReviewed
      ),
    },
  };

  await setCache(cacheKey, JSON.stringify(response), 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// NEW: getReturnCreditAnalytics
// Store-credit ROI intelligence
// @route GET /api/v1/analytics/returns/credit
// ============================================
export const getReturnCreditAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = 'month' } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `return_credit_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...JSON.parse(cached) });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [creditStats, discountRedemptions, previousCreditStats] = await Promise.all([

    // Credit issued per completed return
    Order.aggregate([
      {
        $match: {
          'returnInfo.status': { $in: ['completed', 'awaiting_discount'] },
          'returnInfo.requestedAt': { $gte: currentPeriodStart },
          'returnInfo.discountValue': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          count:                 { $sum: 1 },
          totalCreditIssued:     { $sum: '$returnInfo.discountValue' },
          totalApprovedGross:    { $sum: '$returnInfo.approvedGross' },
          totalRejectedGross:    { $sum: '$returnInfo.rejectedGross' },
          totalRequestedGross:   { $sum: '$returnInfo.requestedGross' },
          totalShippingDeducted: { $sum: '$returnInfo.shippingDeducted' },
          totalApprovedDiscount: { $sum: '$returnInfo.approvedDiscount' },
          avgCreditIssued:       { $avg: '$returnInfo.discountValue' },
          avgApprovedGross:      { $avg: '$returnInfo.approvedGross' },
          maxCreditIssued:       { $max: '$returnInfo.discountValue' },
          minCreditIssued:       { $min: '$returnInfo.discountValue' },
        },
      },
    ]),

    // How much return credit has been redeemed (via discount usage on orders)
    // Joins discount model — category='return' discounts used on orders
    Order.aggregate([
      {
        $match: {
          'paymentInfo.status': 'success',
          'discounts.codes': { $exists: true, $ne: [] },
          createdAt: { $gte: currentPeriodStart },
        },
      },
      { $unwind: '$discounts.codes' },
      // Only count fixed discounts that came from returns (joined via relatedReturn)
      // We can approximate this by matching discount codes used in the period
      {
        $group: {
          _id: null,
          totalOrdersWithReturnCredit: { $sum: 1 },
          totalCreditRedeemed:         { $sum: '$discounts.codes.amount' },
          avgCreditRedeemed:           { $avg: '$discounts.codes.amount' },
        },
      },
    ]),

    // Previous period for trend
    Order.aggregate([
      {
        $match: {
          'returnInfo.status': { $in: ['completed', 'awaiting_discount'] },
          'returnInfo.requestedAt': { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          'returnInfo.discountValue': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalCreditIssued: { $sum: '$returnInfo.discountValue' },
          count:             { $sum: 1 },
        },
      },
    ]),
  ]);

  const credit   = creditStats[0]         ?? {};
  const redemp   = discountRedemptions[0] ?? {};
  const prevCredit = previousCreditStats[0] ?? { totalCreditIssued: 0, count: 0 };

  const totalCreditIssued   = credit.totalCreditIssued   ?? 0;
  const totalCreditRedeemed = redemp.totalCreditRedeemed ?? 0;
  const totalRequestedGross = credit.totalRequestedGross ?? 0;
  const totalApprovedGross  = credit.totalApprovedGross  ?? 0;

  // Credit retention rate — credit issued / requested gross
  // High = store is issuing a lot relative to what was requested (generous)
  // Low = store is retaining most revenue through partial approvals
  const creditRetentionRate = totalRequestedGross > 0
    ? Math.round((totalCreditIssued / totalRequestedGross) * 100 * 100) / 100
    : 0;

  // Credit redemption rate — of credit issued, how much was actually spent back
  // This is the key ROI metric for the store-credit model
  const creditRedemptionRate = totalCreditIssued > 0
    ? Math.round((totalCreditRedeemed / totalCreditIssued) * 100 * 100) / 100
    : 0;

  // Revenue recovery — credit redeemed brings revenue back into the store
  // Net cost = credit issued - credit redeemed (unredeemed credit is pure cost)
  const netCreditCost = Math.round((totalCreditIssued - totalCreditRedeemed) * 100) / 100;

  // Approval efficiency — approved gross / requested gross
  const approvalEfficiency = totalRequestedGross > 0
    ? Math.round((totalApprovedGross / totalRequestedGross) * 100 * 100) / 100
    : 0;

  const response = {
    creditIssued: {
      count:                 credit.count                 ?? 0,
      totalCreditIssued:     Math.round(totalCreditIssued           * 100) / 100,
      avgCreditIssued:       Math.round((credit.avgCreditIssued     ?? 0) * 100) / 100,
      maxCreditIssued:       Math.round((credit.maxCreditIssued     ?? 0) * 100) / 100,
      minCreditIssued:       Math.round((credit.minCreditIssued     ?? 0) * 100) / 100,
      totalApprovedGross:    Math.round((credit.totalApprovedGross  ?? 0) * 100) / 100,
      totalRejectedGross:    Math.round((credit.totalRejectedGross  ?? 0) * 100) / 100,
      totalRequestedGross:   Math.round(totalRequestedGross                * 100) / 100,
      totalShippingDeducted: Math.round((credit.totalShippingDeducted ?? 0) * 100) / 100,
      totalApprovedDiscount: Math.round((credit.totalApprovedDiscount ?? 0) * 100) / 100,
    },
    creditRedeemed: {
      totalOrdersWithReturnCredit: redemp.totalOrdersWithReturnCredit ?? 0,
      totalCreditRedeemed:         Math.round(totalCreditRedeemed      * 100) / 100,
      avgCreditRedeemed:           Math.round((redemp.avgCreditRedeemed ?? 0) * 100) / 100,
    },
    roiMetrics: {
      creditRetentionRate,
      creditRedemptionRate,
      approvalEfficiency,
      netCreditCost,
      // Revenue kept through rejections
      revenueProtected: Math.round((credit.totalRejectedGross ?? 0) * 100) / 100,
    },
    trends: {
      creditIssued: calculateTrend(totalCreditIssued, prevCredit.totalCreditIssued),
      count:        calculateTrend(credit.count ?? 0, prevCredit.count),
    },
  };

  await setCache(cacheKey, JSON.stringify(response), 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// NEW: getReturnLifecycleTiming
// Stage-by-stage timing intelligence
// @route GET /api/v1/analytics/returns/lifecycle
// ============================================
export const getReturnLifecycleTiming = handleAsyncError(async (req, res, next) => {
  const { timeframe = 'month' } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `return_lifecycle_timing_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...JSON.parse(cached) });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const timingStats = await Order.aggregate([
    {
      $match: {
        'returnInfo.requestedAt': { $gte: currentPeriodStart },
        'returnInfo.status': { $nin: ['none', 'requested', 'cancelled'] },
      },
    },
    {
      $project: {
        status: '$returnInfo.status',

        // Requested → R1 review (how fast admin reviews)
        requestedToReview: {
          $cond: [
            { $and: [{ $ifNull: ['$returnInfo.approvedAt', false] }, { $ifNull: ['$returnInfo.requestedAt', false] }] },
            { $divide: [{ $subtract: ['$returnInfo.approvedAt', '$returnInfo.requestedAt'] }, 1000 * 60 * 60] },
            null,
          ],
        },

        // R1 review → plea submitted (how fast customer responds)
        reviewToPlea: {
          $cond: [
            { $and: [{ $ifNull: ['$returnInfo.pleaInfo.pleaSubmittedAt', false] }, { $ifNull: ['$returnInfo.approvedAt', false] }] },
            { $divide: [{ $subtract: ['$returnInfo.pleaInfo.pleaSubmittedAt', '$returnInfo.approvedAt'] }, 1000 * 60 * 60] },
            null,
          ],
        },

        // Approved → customer ships (how fast customer ships)
        approvedToShipped: {
          $cond: [
            {
              $and: [
                { $ifNull: ['$returnInfo.requestedAt', false] },
                { $ifNull: ['$returnInfo.approvedAt',  false] },
                { $in: ['$returnInfo.status', ['in_transit', 'received', 'inspected', 'awaiting_discount', 'completed']] },
              ],
            },
            // Use approvedAt as proxy — actual shippedAt not stored on returnInfo
            { $divide: [{ $subtract: ['$returnInfo.approvedAt', '$returnInfo.requestedAt'] }, 1000 * 60 * 60 * 24] },
            null,
          ],
        },

        // Total lifecycle: requested → completed
        totalLifecycleDays: {
          $cond: [
            { $and: [{ $ifNull: ['$returnInfo.completedAt', false] }, { $ifNull: ['$returnInfo.requestedAt', false] }] },
            { $divide: [{ $subtract: ['$returnInfo.completedAt', '$returnInfo.requestedAt'] }, 1000 * 60 * 60 * 24] },
            null,
          ],
        },

        // Requested → inspected
        requestedToInspected: {
          $cond: [
            { $and: [{ $ifNull: ['$returnInfo.inspectedAt', false] }, { $ifNull: ['$returnInfo.requestedAt', false] }] },
            { $divide: [{ $subtract: ['$returnInfo.inspectedAt', '$returnInfo.requestedAt'] }, 1000 * 60 * 60 * 24] },
            null,
          ],
        },

        hasPlea: { $gte: ['$returnInfo.pleaAttempts', 1] },
      },
    },
    {
      $group: {
        _id: null,
        avgRequestedToReviewHrs:    { $avg: '$requestedToReview' },
        avgReviewToPleaHrs:         { $avg: '$reviewToPlea' },
        avgApprovedToShippedDays:   { $avg: '$approvedToShipped' },
        avgTotalLifecycleDays:      { $avg: '$totalLifecycleDays' },
        avgRequestedToInspectedDays:{ $avg: '$requestedToInspected' },

        // With vs without plea lifecycle comparison
        avgLifecycleWithPlea: {
          $avg: {
            $cond: [{ $eq: ['$hasPlea', true] }, '$totalLifecycleDays', null],
          },
        },
        avgLifecycleWithoutPlea: {
          $avg: {
            $cond: [{ $eq: ['$hasPlea', false] }, '$totalLifecycleDays', null],
          },
        },

        // Count returns with plea for context
        countWithPlea:    { $sum: { $cond: [{ $eq: ['$hasPlea', true] },  1, 0] } },
        countWithoutPlea: { $sum: { $cond: [{ $eq: ['$hasPlea', false] }, 1, 0] } },
        total:            { $sum: 1 },
      },
    },
  ]);

  const timing = timingStats[0] ?? {};

  const round1 = (v) => v != null ? Math.round(v * 10) / 10 : null;

  const response = {
    stageTiming: {
      avgRequestedToReviewHrs:     round1(timing.avgRequestedToReviewHrs),
      avgReviewToPleaHrs:          round1(timing.avgReviewToPleaHrs),
      avgApprovedToShippedDays:    round1(timing.avgApprovedToShippedDays),
      avgRequestedToInspectedDays: round1(timing.avgRequestedToInspectedDays),
      avgTotalLifecycleDays:       round1(timing.avgTotalLifecycleDays),
    },
    pleaImpactOnTiming: {
      avgLifecycleWithPlea:    round1(timing.avgLifecycleWithPlea),
      avgLifecycleWithoutPlea: round1(timing.avgLifecycleWithoutPlea),
      pleaAddsApproxDays:      timing.avgLifecycleWithPlea != null && timing.avgLifecycleWithoutPlea != null
        ? round1(timing.avgLifecycleWithPlea - timing.avgLifecycleWithoutPlea)
        : null,
      countWithPlea:    timing.countWithPlea    ?? 0,
      countWithoutPlea: timing.countWithoutPlea ?? 0,
      total:            timing.total            ?? 0,
    },
  };

  await setCache(cacheKey, JSON.stringify(response), 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// UPDATED: getReturnsByProduct — adds plea rate
// @route GET /api/v1/analytics/returns/by-product
// ============================================
export const getReturnsByProduct = handleAsyncError(async (req, res, next) => {
  const { limit = 20, sortBy = 'returnRate' } = req.query;

  const cacheKey = `returns_by_product_${limit}_${sortBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...JSON.parse(cached) });

  const [returnsByProduct, productSales] = await Promise.all([
    Order.aggregate([
      { $match: { 'returnInfo.status': { $nin: ['none', 'cancelled'] } } },
      { $unwind: '$returnInfo.itemsToReturn' },
      {
        $group: {
          _id:              '$returnInfo.itemsToReturn.product',
          totalReturns:     { $sum: 1 },
          totalQuantity:    { $sum: { $ifNull: ['$returnInfo.itemsToReturn.quantity',         0] } },
          totalApprovedQty: { $sum: { $ifNull: ['$returnInfo.itemsToReturn.approvedQuantity', 0] } },
          totalPleaQty:     { $sum: { $ifNull: ['$returnInfo.itemsToReturn.pleaQuantity',     0] } },
          totalSilentQty:   { $sum: { $ifNull: ['$returnInfo.itemsToReturn.silentAcceptedQuantity', 0] } },
          totalPleaApproved:{ $sum: { $ifNull: ['$returnInfo.itemsToReturn.pleaApprovedQty', 0] } },
          totalPleaRejected:{ $sum: { $ifNull: ['$returnInfo.itemsToReturn.pleaRejectedQty', 0] } },
          // Items that went to plea for this product
          withPlea: {
            $sum: {
              $cond: [{ $gt: [{ $ifNull: ['$returnInfo.itemsToReturn.pleaQuantity', 0] }, 0] }, 1, 0],
            },
          },
          totalCreditIssued: { $sum: 0 }, // placeholder — credit is at return level not item level
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          orderStatus: { $in: ['Delivered', 'Shipped'] },
          'paymentInfo.status': 'success',
        },
      },
      { $unwind: '$orderItems' },
      {
        $group: {
          _id:               '$orderItems.product',
          totalSales:        { $sum: 1 },
          totalQuantitySold: { $sum: { $ifNull: ['$orderItems.quantity', 0] } },
        },
      },
    ]),
  ]);

  const salesMap = new Map(productSales.map((s) => [s._id.toString(), s]));

  const enriched = await Promise.all(
    returnsByProduct.map(async (item) => {
      const pid   = item._id?.toString();
      const sales = salesMap.get(pid) ?? { totalSales: 0, totalQuantitySold: 0 };

      const product = await Product.findById(item._id).select('name images category pricing').lean();

      const returnRate = sales.totalSales > 0
        ? Math.round((item.totalReturns / sales.totalSales) * 100 * 100) / 100
        : 0;

      const unitApprovalRate = item.totalQuantity > 0
        ? Math.round((item.totalApprovedQty / item.totalQuantity) * 100 * 100) / 100
        : 0;

      const pleaRate = item.totalReturns > 0
        ? Math.round((item.withPlea / item.totalReturns) * 100 * 100) / 100
        : 0;

      const silentAcceptanceRate = (item.totalPleaQty + item.totalSilentQty) > 0
        ? Math.round((item.totalSilentQty / (item.totalPleaQty + item.totalSilentQty)) * 100 * 100) / 100
        : 0;

      return {
        product: product ? {
          _id:      product._id,
          name:     product.name,
          image:    product.images?.[0]?.url,
          category: product.category,
          price:    product.pricing?.regular ?? 0,
        } : null,
        returns: {
          totalReturns:  item.totalReturns,
          totalQuantity: item.totalQuantity,
          totalApprovedQty: item.totalApprovedQty,
        },
        sales: {
          totalSales:        sales.totalSales,
          totalQuantitySold: sales.totalQuantitySold,
        },
        pleaMetrics: {
          withPlea:             item.withPlea,
          pleaRate,
          totalPleaQty:         item.totalPleaQty,
          totalPleaApproved:    item.totalPleaApproved,
          totalPleaRejected:    item.totalPleaRejected,
          totalSilentQty:       item.totalSilentQty,
          silentAcceptanceRate,
        },
        returnRate,
        unitApprovalRate,
      };
    })
  );

  let sorted = enriched.filter((p) => p.product !== null);
  if (sortBy === 'returnRate')   sorted.sort((a, b) => b.returnRate   - a.returnRate);
  if (sortBy === 'totalReturns') sorted.sort((a, b) => b.returns.totalReturns - a.returns.totalReturns);
  if (sortBy === 'pleaRate')     sorted.sort((a, b) => b.pleaMetrics.pleaRate - a.pleaMetrics.pleaRate);

  const limited = sorted.slice(0, parseInt(limit));

  const response = {
    products: limited,
    summary: {
      totalProductsWithReturns: sorted.length,
      avgReturnRate: sorted.length > 0
        ? Math.round((sorted.reduce((s, p) => s + p.returnRate, 0) / sorted.length) * 100) / 100
        : 0,
      avgPleaRate: sorted.length > 0
        ? Math.round((sorted.reduce((s, p) => s + p.pleaMetrics.pleaRate, 0) / sorted.length) * 100) / 100
        : 0,
    },
  };

  await setCache(cacheKey, JSON.stringify(response), 300);
  res.status(200).json({ success: true, ...response });
});

export const getReturnsByCategory = handleAsyncError(async (req, res, next) => {
  const cacheKey = "returns_by_category";
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const [returnsByCategory, salesByCategory] = await Promise.all([
    Order.aggregate([
      { $match: { "returnInfo.status": { $nin: ["none", "rejected"] } } },
      { $unwind: "$returnInfo.itemsToReturn" },
      {
        $lookup: {
          from:         "products",
          localField:   "returnInfo.itemsToReturn.product",
          foreignField: "_id",
          as:           "productDetails"
        }
      },
      { $unwind: "$productDetails" },
      { $group: { _id: "$productDetails.category", totalReturns: { $sum: 1 } } },
      { $sort: { totalReturns: -1 } }
    ]),
    Order.aggregate([
      {
        $match: {
          orderStatus: { $in: ["Delivered", "Shipped"] },
          "paymentInfo.status": "success"
        }
      },
      { $unwind: "$orderItems" },
      {
        $lookup: {
          from:         "products",
          localField:   "orderItems.product",
          foreignField: "_id",
          as:           "productDetails"
        }
      },
      { $unwind: "$productDetails" },
      { $group: { _id: "$productDetails.category", totalSales: { $sum: 1 } } }
    ])
  ]);

  const salesMap = new Map(salesByCategory.map((item) => [item._id, item.totalSales]));

  const categoriesWithReturnRate = returnsByCategory.map((item) => {
    const totalSales = salesMap.get(item._id) || 0;
    const returnRate =
      totalSales > 0
        ? Math.round((item.totalReturns / totalSales) * 100 * 100) / 100
        : 0;
    return { category: item._id, totalReturns: item.totalReturns, totalSales, returnRate };
  });

  const response = { categories: categoriesWithReturnRate };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// REFUND ANALYTICS
// ============================================

export const getRefundOverview = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `refund_overview_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  const [currentRefunds, previousRefunds] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "refundInfo.requestedAt": { $gte: currentPeriodStart },
          "refundInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id: null,
          totalRefunds:      { $sum: 1 },
          requested:         { $sum: { $cond: [{ $eq: ["$refundInfo.status", "requested"] },  1, 0] } },
          approved:          { $sum: { $cond: [{ $eq: ["$refundInfo.status", "approved"] },   1, 0] } },
          processing:        { $sum: { $cond: [{ $eq: ["$refundInfo.status", "processing"] }, 1, 0] } },
          completed:         { $sum: { $cond: [{ $eq: ["$refundInfo.status", "completed"] },  1, 0] } },
          rejected:          { $sum: { $cond: [{ $eq: ["$refundInfo.status", "rejected"] },   1, 0] } },
          failed:            { $sum: { $cond: [{ $eq: ["$refundInfo.status", "failed"] },     1, 0] } },
          totalRefundAmount: { $sum: "$refundInfo.refundAmount" },
          avgRefundAmount:   { $avg: "$refundInfo.refundAmount" }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          "refundInfo.requestedAt": { $gte: previousPeriodStart, $lt: previousPeriodEnd },
          "refundInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id: null,
          totalRefunds:      { $sum: 1 },
          totalRefundAmount: { $sum: "$refundInfo.refundAmount" }
        }
      }
    ])
  ]);

  const current = currentRefunds[0] || {
    totalRefunds:      0,
    requested:         0,
    approved:          0,
    processing:        0,
    completed:         0,
    rejected:          0,
    failed:            0,
    totalRefundAmount: 0,
    avgRefundAmount:   0
  };
  const previous = previousRefunds[0] || { totalRefunds: 0, totalRefundAmount: 0 };

  const [refundReasons, processingTimes, totalSuccessfulOrders] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "refundInfo.requestedAt": { $gte: currentPeriodStart },
          "refundInfo.status": { $ne: "none" }
        }
      },
      {
        $group: {
          _id:         "$refundInfo.reason",
          count:       { $sum: 1 },
          totalAmount: { $sum: "$refundInfo.refundAmount" }
        }
      },
      { $sort: { count: -1 } }
    ]),
    Order.aggregate([
      {
        $match: {
          "refundInfo.status": "completed",
          "refundInfo.requestedAt": { $exists: true, $ne: null },
          $or: [
            { "refundInfo.refundedAt":  { $gte: currentPeriodStart } },
            { "refundInfo.processedAt": { $gte: currentPeriodStart } },
            { "updatedAt":              { $gte: currentPeriodStart } }
          ]
        }
      },
      {
        $project: {
          processingTime: {
            $divide: [
              {
                $subtract: [
                  {
                    $ifNull: [
                      "$refundInfo.refundedAt",
                      "$refundInfo.processedAt",
                      "$updatedAt"
                    ]
                  },
                  "$refundInfo.requestedAt"
                ]
              },
              1000 * 60 * 60 // hours directly
            ]
          }
        }
      },
      { $match: { processingTime: { $gte: 0 } } }, // include instant dev completions
      { $group: { _id: null, avgProcessingHrs: { $avg: "$processingTime" } } }
    ]),
    Order.countDocuments({
      "paymentInfo.status": "success",
      $or: [
        { "paymentInfo.paidAt": { $gte: currentPeriodStart } },
        { createdAt:            { $gte: currentPeriodStart } }
      ]
    })
  ]);

  const byStatus = {
    requested:  current.requested,
    approved:   current.approved,
    processing: current.processing,
    completed:  current.completed,
    rejected:   current.rejected,
    failed:     current.failed,
  };

  const refundRate =
  totalSuccessfulOrders > 0
    ? Math.round((current.completed / totalSuccessfulOrders) * 100 * 100) / 100
    : 0;

  const avgProcessingHrs = Math.round((processingTimes[0]?.avgProcessingHrs || 0) * 10) / 10;

  const response = {
    currentPeriod: {
      ...current,
      refundRate,          // FIX 1: was missing from currentPeriod
      avgProcessingHrs,    // FIX 4: renamed from avgProcessingDays, now in hours directly
    },
    previousPeriod: {
      totalRefunds:      previous.totalRefunds,
      totalRefundAmount: previous.totalRefundAmount,
    },
    trends: {
      refunds: calculateTrend(current.totalRefunds,      previous.totalRefunds),
      amount:  calculateTrend(current.totalRefundAmount, previous.totalRefundAmount),
    },
    breakdown: {
      byStatus,
      byReason: refundReasons,
    },

    // ── Flat fields for dashboard consumption ────────────────────────────
    totalRefunds:      current.totalRefunds,
    refundRate,
    pending:           (current.requested || 0) + (current.approved || 0) + (current.processing || 0),
    totalAmount:       Math.round((current.totalRefundAmount || 0) * 100) / 100,
    avgAmount:         Math.round((current.avgRefundAmount   || 0) * 100) / 100,
    avgProcessingTime: avgProcessingHrs, // FIX 4: no longer needs * 24 multiplication
    statusBreakdown: Object.entries(byStatus).map(([status, count]) => ({
      status,
      count,
      percentage: current.totalRefunds > 0
        ? Math.round((count / current.totalRefunds) * 100 * 10) / 10
        : 0,
    })),
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getRefundsByPaymentMethod = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `refunds_by_payment_method_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const [refundsByMethod, ordersByMethod] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          "refundInfo.status":     "completed",
          "refundInfo.refundedAt": { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id:               "$paymentInfo.method",
          totalRefunds:      { $sum: 1 },
          totalRefundAmount: { $sum: "$refundInfo.refundAmount" },
          avgRefundAmount:   { $avg: "$refundInfo.refundAmount" }
        }
      },
      { $sort: { totalRefunds: -1 } }
    ]),
    // FIX: fall back to createdAt when paidAt is not set — same as getRefundOverview.
    Order.aggregate([
      {
        $match: {
          "paymentInfo.status": "success",
          $or: [
            { "paymentInfo.paidAt": { $gte: currentPeriodStart } },
            { createdAt:            { $gte: currentPeriodStart } }
          ]
        }
      },
      {
        $group: {
          _id:         "$paymentInfo.method",
          totalOrders: { $sum: 1 }
        }
      }
    ])
  ]);

  const ordersMap = new Map(ordersByMethod.map((item) => [item._id, item.totalOrders]));

  const methodsWithRefundRate = refundsByMethod.map((item) => {
    const totalOrders = ordersMap.get(item._id) || 0;
    const refundRate =
      totalOrders > 0
        ? Math.round((item.totalRefunds / totalOrders) * 100 * 100) / 100
        : 0;

    return {
      paymentMethod:     item._id,
      totalRefunds:      item.totalRefunds,
      totalRefundAmount: Math.round((item.totalRefundAmount || 0) * 100) / 100,
      avgRefundAmount:   Math.round((item.avgRefundAmount   || 0) * 100) / 100,
      totalOrders,
      refundRate,
    };
  });

  const totalRefunded = methodsWithRefundRate.reduce((sum, m) => sum + m.totalRefundAmount, 0);

  const response = {
    byPaymentMethod: methodsWithRefundRate,
    summary: {
      totalRefunds:      methodsWithRefundRate.reduce((sum, m) => sum + m.totalRefunds, 0),
      totalRefundAmount: Math.round(totalRefunded * 100) / 100,
      avgRefundAmount:   methodsWithRefundRate.length > 0
        ? Math.round(
            (methodsWithRefundRate.reduce((sum, m) => sum + m.avgRefundAmount, 0) /
              methodsWithRefundRate.length) * 100
          ) / 100
        : 0,
      topMethod: methodsWithRefundRate[0]?.paymentMethod || null,
    },
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getRefundTimeline = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", groupBy = "day" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `refund_timeline_${timeframe}_${groupBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const dateFormat =
    groupBy === "hour"
      ? { $dateToString: { format: "%Y-%m-%d %H:00", date: "$refundInfo.requestedAt" } }
      : { $dateToString: { format: "%Y-%m-%d", date: "$refundInfo.requestedAt" } };

  const timeline = await Order.aggregate([
    {
      $match: {
        "refundInfo.requestedAt": { $gte: currentPeriodStart },
        "refundInfo.status": { $ne: "none" }
      }
    },
    {
      $group: {
        _id:          dateFormat,
        totalRefunds: { $sum: 1 },
        totalAmount:  { $sum: "$refundInfo.refundAmount" },
        completed: {
          $sum: { $cond: [{ $eq: ["$refundInfo.status", "completed"] }, 1, 0] }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const response = {
    timeline,
    summary: {
      totalRefunds:   timeline.reduce((sum, t) => sum + t.totalRefunds, 0),
      totalAmount:    timeline.reduce((sum, t) => sum + t.totalAmount,  0),
      totalCompleted: timeline.reduce((sum, t) => sum + t.completed,    0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getReturnOverview,
  getReturnsByProduct,
  getReturnsByCategory,
  getRefundOverview,
  getRefundsByPaymentMethod,
  getRefundTimeline
};