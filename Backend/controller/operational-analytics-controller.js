import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Order from "../models/order-model.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";

// ============================================
// FULFILLMENT ANALYTICS
// ============================================

/**
 * Get fulfillment performance overview
 * @route GET /api/v1/analytics/operations/fulfillment
 * @access Admin
 */
export const getFulfillmentAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `fulfillment_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Average fulfillment time (Processing → Shipped)
  const fulfillmentTimes = await Order.aggregate([
    {
      $match: {
        orderStatus: { $in: ['Shipped', 'Delivered'] },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $addFields: {
        shippedDate: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$statusHistory',
                as: 'status',
                cond: { $eq: ['$$status.status', 'Shipped'] }
              }
            },
            0
          ]
        }
      }
    },
    {
      $match: {
        shippedDate: { $ne: null }
      }
    },
    {
      $project: {
        fulfillmentTime: {
          $divide: [
            { $subtract: ['$shippedDate.timestamp', '$createdAt'] },
            1000 * 60 * 60 // Convert to hours
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        avgFulfillmentHours: { $avg: '$fulfillmentTime' },
        minFulfillmentHours: { $min: '$fulfillmentTime' },
        maxFulfillmentHours: { $max: '$fulfillmentTime' },
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  // Average delivery time (Shipped → Delivered)
  const deliveryTimes = await Order.aggregate([
    {
      $match: {
        orderStatus: 'Delivered',
        deliveredAt: { $gte: currentPeriodStart }
      }
    },
    {
      $addFields: {
        shippedDate: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$statusHistory',
                as: 'status',
                cond: { $eq: ['$$status.status', 'Shipped'] }
              }
            },
            0
          ]
        }
      }
    },
    {
      $match: {
        shippedDate: { $ne: null }
      }
    },
    {
      $project: {
        deliveryTime: {
          $divide: [
            { $subtract: ['$deliveredAt', '$shippedDate.timestamp'] },
            1000 * 60 * 60 * 24 // Convert to days
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        avgDeliveryDays: { $avg: '$deliveryTime' },
        minDeliveryDays: { $min: '$deliveryTime' },
        maxDeliveryDays: { $max: '$deliveryTime' },
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  // Total end-to-end time (Order → Delivered)
  const endToEndTimes = await Order.aggregate([
    {
      $match: {
        orderStatus: 'Delivered',
        deliveredAt: { $gte: currentPeriodStart }
      }
    },
    {
      $project: {
        totalTime: {
          $divide: [
            { $subtract: ['$deliveredAt', '$createdAt'] },
            1000 * 60 * 60 * 24 // Convert to days
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        avgTotalDays: { $avg: '$totalTime' },
        minTotalDays: { $min: '$totalTime' },
        maxTotalDays: { $max: '$totalTime' }
      }
    }
  ]);

  // Fulfillment status breakdown
  const statusBreakdown = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$orderStatus',
        count: { $sum: 1 }
      }
    }
  ]);

  const response = {
    fulfillmentMetrics: fulfillmentTimes[0] || {
      avgFulfillmentHours: 0,
      minFulfillmentHours: 0,
      maxFulfillmentHours: 0,
      totalOrders: 0
    },
    deliveryMetrics: deliveryTimes[0] || {
      avgDeliveryDays: 0,
      minDeliveryDays: 0,
      maxDeliveryDays: 0,
      totalOrders: 0
    },
    endToEndMetrics: endToEndTimes[0] || {
      avgTotalDays: 0,
      minTotalDays: 0,
      maxTotalDays: 0
    },
    statusBreakdown: statusBreakdown.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {})
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

/**
 * Get SLA breach analytics
 * @route GET /api/v1/analytics/operations/sla-breaches
 * @access Admin
 */
export const getSLABreachAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `sla_breach_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Get SLA breaches
  const breaches = await Order.find({
    'fulfillmentSLA.slaBreached': true,
    createdAt: { $gte: currentPeriodStart }
  })
    .select('_id user totalPrice fulfillmentSLA orderStatus createdAt')
    .populate('user', 'firstName lastName email')
    .sort({ 'fulfillmentSLA.delayInDays': -1 })
    .limit(50);

  // Summary statistics
  const breachStats = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        breachedOrders: {
          $sum: { $cond: ['$fulfillmentSLA.slaBreached', 1, 0] }
        },
        avgDelayDays: { $avg: '$fulfillmentSLA.delayInDays' }
      }
    }
  ]);

  const stats = breachStats[0] || {
    totalOrders: 0,
    breachedOrders: 0,
    avgDelayDays: 0
  };

  const breachRate = stats.totalOrders > 0
    ? Math.round((stats.breachedOrders / stats.totalOrders) * 100 * 100) / 100
    : 0;

  const response = {
    summary: {
      ...stats,
      breachRate
    },
    breaches
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// SHIPPING ANALYTICS
// ============================================

/**
 * Get shipping carrier performance
 * @route GET /api/v1/analytics/operations/shipping-carriers
 * @access Admin
 */
export const getShippingCarrierPerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `shipping_carriers_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const carrierPerformance = await Order.aggregate([
    {
      $match: {
        'tracking.carrier': { $exists: true, $ne: null },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$tracking.carrier',
        totalShipments: { $sum: 1 },
        delivered: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'Delivered'] }, 1, 0] }
        },
        avgShippingCost: { $avg: '$shippingPrice' }
      }
    },
    {
      $addFields: {
        deliveryRate: {
          $cond: [
            { $gt: ['$totalShipments', 0] },
            { $multiply: [{ $divide: ['$delivered', '$totalShipments'] }, 100] },
            0
          ]
        }
      }
    },
    {
      $sort: { totalShipments: -1 }
    }
  ]);

  // Calculate average delivery time by carrier
  const deliveryTimesByCarrier = await Order.aggregate([
    {
      $match: {
        'tracking.carrier': { $exists: true, $ne: null },
        orderStatus: 'Delivered',
        deliveredAt: { $gte: currentPeriodStart }
      }
    },
    {
      $addFields: {
        shippedDate: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$statusHistory',
                as: 'status',
                cond: { $eq: ['$$status.status', 'Shipped'] }
              }
            },
            0
          ]
        }
      }
    },
    {
      $match: {
        shippedDate: { $ne: null }
      }
    },
    {
      $project: {
        carrier: '$tracking.carrier',
        deliveryTime: {
          $divide: [
            { $subtract: ['$deliveredAt', '$shippedDate.timestamp'] },
            1000 * 60 * 60 * 24
          ]
        }
      }
    },
    {
      $group: {
        _id: '$carrier',
        avgDeliveryDays: { $avg: '$deliveryTime' }
      }
    }
  ]);

  // Merge delivery times into carrier performance
  const deliveryMap = new Map(
    deliveryTimesByCarrier.map(item => [item._id, item.avgDeliveryDays])
  );

  const enrichedCarrierPerformance = carrierPerformance.map(carrier => ({
    ...carrier,
    avgDeliveryDays: Math.round((deliveryMap.get(carrier._id) || 0) * 100) / 100,
    deliveryRate: Math.round(carrier.deliveryRate * 100) / 100,
    avgShippingCost: Math.round(carrier.avgShippingCost * 100) / 100
  }));

  const response = {
    carriers: enrichedCarrierPerformance
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

/**
 * Get shipment tracking analytics
 * @route GET /api/v1/analytics/operations/shipment-tracking
 * @access Admin
 */
export const getShipmentTrackingAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `shipment_tracking_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Orders with vs without tracking
  const trackingStats = await Order.aggregate([
    {
      $match: {
        orderStatus: { $in: ['Shipped', 'Delivered'] },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        withTracking: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$tracking.trackingNumber', null] },
                { $ne: ['$tracking.trackingNumber', ''] }
              ]},
              1,
              0
            ]
          }
        }
      }
    }
  ]);

  const stats = trackingStats[0] || { totalOrders: 0, withTracking: 0 };

  const trackingCoverage = stats.totalOrders > 0
    ? Math.round((stats.withTracking / stats.totalOrders) * 100 * 100) / 100
    : 0;

  const response = {
    totalShippedOrders: stats.totalOrders,
    ordersWithTracking: stats.withTracking,
    ordersWithoutTracking: stats.totalOrders - stats.withTracking,
    trackingCoverage
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// FRAUD ANALYTICS
// ============================================

/**
 * Get fraud detection analytics
 * @route GET /api/v1/analytics/operations/fraud
 * @access Admin
 */
export const getFraudAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `fraud_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Fraud risk distribution
  const riskDistribution = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart },
        'fraudCheck.riskLevel': { $exists: true }
      }
    },
    {
      $group: {
        _id: '$fraudCheck.riskLevel',
        count: { $sum: 1 },
        totalValue: { $sum: '$totalPrice' },
        avgRiskScore: { $avg: '$fraudCheck.riskScore' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  // Orders requiring review
  const pendingReviews = await Order.countDocuments({
    'fraudCheck.reviewRequired': true,
    'fraudCheck.reviewDecision': 'Pending',
    createdAt: { $gte: currentPeriodStart }
  });

  // Review decisions
  const reviewDecisions = await Order.aggregate([
    {
      $match: {
        'fraudCheck.reviewedAt': { $gte: currentPeriodStart },
        'fraudCheck.reviewDecision': { $ne: 'Pending' }
      }
    },
    {
      $group: {
        _id: '$fraudCheck.reviewDecision',
        count: { $sum: 1 },
        avgRiskScore: { $avg: '$fraudCheck.riskScore' }
      }
    }
  ]);

  // Common fraud flags
  const fraudFlags = await Order.aggregate([
    {
      $match: {
        'fraudCheck.flags': { $exists: true, $ne: [] },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $unwind: '$fraudCheck.flags'
    },
    {
      $group: {
        _id: '$fraudCheck.flags',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  // Fraud prevention rate
  const preventedFraudValue = await Order.aggregate([
    {
      $match: {
        'fraudCheck.reviewDecision': 'Rejected',
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: null,
        totalValue: { $sum: '$totalPrice' },
        count: { $sum: 1 }
      }
    }
  ]);

  const response = {
    riskDistribution,
    pendingReviews,
    reviewDecisions,
    commonFlags: fraudFlags,
    fraudPrevention: preventedFraudValue[0] || { totalValue: 0, count: 0 }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

/**
 * Get high-risk orders
 * @route GET /api/v1/analytics/operations/high-risk-orders
 * @access Admin
 */
export const getHighRiskOrders = handleAsyncError(async (req, res, next) => {
  const { limit = 50, minRiskScore = 70 } = req.query;

  const highRiskOrders = await Order.find({
    'fraudCheck.riskScore': { $gte: parseInt(minRiskScore) },
    orderStatus: { $ne: 'Cancelled' }
  })
    .select('_id user totalPrice fraudCheck orderStatus createdAt')
    .populate('user', 'firstName lastName email')
    .sort({ 'fraudCheck.riskScore': -1 })
    .limit(parseInt(limit));

  res.status(200).json({
    success: true,
    count: highRiskOrders.length,
    orders: highRiskOrders
  });
});

// ============================================
// CANCELLATION ANALYTICS
// ============================================

/**
 * Get order cancellation analytics
 * @route GET /api/v1/analytics/operations/cancellations
 * @access Admin
 */
export const getCancellationAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `cancellation_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Cancellation stats
  const cancellationStats = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        cancelled: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'Cancelled'] }, 1, 0] }
        },
        cancelledValue: {
          $sum: { $cond: [{ $eq: ['$orderStatus', 'Cancelled'] }, '$totalPrice', 0] }
        }
      }
    }
  ]);

  const stats = cancellationStats[0] || {
    totalOrders: 0,
    cancelled: 0,
    cancelledValue: 0
  };

  const cancellationRate = stats.totalOrders > 0
    ? Math.round((stats.cancelled / stats.totalOrders) * 100 * 100) / 100
    : 0;

  // Cancellation reasons
  const reasons = await Order.aggregate([
    {
      $match: {
        orderStatus: 'Cancelled',
        cancelledAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$cancellationReason',
        count: { $sum: 1 },
        totalValue: { $sum: '$totalPrice' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  const response = {
    summary: {
      ...stats,
      cancellationRate
    },
    reasonsBreakdown: reasons
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

export default {
  getFulfillmentAnalytics,
  getSLABreachAnalytics,
  getShippingCarrierPerformance,
  getShipmentTrackingAnalytics,
  getFraudAnalytics,
  getHighRiskOrders,
  getCancellationAnalytics
};