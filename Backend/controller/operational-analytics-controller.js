import handleAsyncError from "../middleware/handleAsyncError.js";
import Order from "../models/order-model.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";

// ============================================
// FULFILLMENT ANALYTICS
// ============================================

export const getFulfillmentAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `fulfillment_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // FIX D: Exact today boundaries for "Delivered Today"
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const [
    fulfillmentTimes,
    deliveryTimes,
    endToEndTimes,
    statusBreakdown,
    deliveredTodayCount,
    onTimeDeliveries
  ] = await Promise.all([

    // Avg time: order created → shipped (hours)
    Order.aggregate([
      {
        $match: {
          orderStatus: { $in: ["Shipped", "Delivered"] },
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $addFields: {
          shippedDate: {
            $arrayElemAt: [
              { $filter: { input: "$statusHistory", as: "s", cond: { $eq: ["$$s.status", "Shipped"] } } },
              0
            ]
          }
        }
      },
      { $match: { shippedDate: { $ne: null } } },
      {
        $project: {
          fulfillmentTime: {
            $divide: [{ $subtract: ["$shippedDate.timestamp", "$createdAt"] }, 3600000]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgFulfillmentHours: { $avg: "$fulfillmentTime" },
          minFulfillmentHours: { $min: "$fulfillmentTime" },
          maxFulfillmentHours: { $max: "$fulfillmentTime" },
          totalOrders: { $sum: 1 }
        }
      }
    ]),

    // Avg time: shipped → delivered (days)
    Order.aggregate([
      {
        $match: {
          orderStatus: "Delivered",
          deliveredAt: { $gte: currentPeriodStart }
        }
      },
      {
        $addFields: {
          shippedDate: {
            $arrayElemAt: [
              { $filter: { input: "$statusHistory", as: "s", cond: { $eq: ["$$s.status", "Shipped"] } } },
              0
            ]
          }
        }
      },
      { $match: { shippedDate: { $ne: null } } },
      {
        $project: {
          deliveryTime: {
            $divide: [{ $subtract: ["$deliveredAt", "$shippedDate.timestamp"] }, 86400000]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgDeliveryDays: { $avg: "$deliveryTime" },
          minDeliveryDays: { $min: "$deliveryTime" },
          maxDeliveryDays: { $max: "$deliveryTime" },
          totalOrders: { $sum: 1 }
        }
      }
    ]),

    // End-to-end: created → delivered (days)
    Order.aggregate([
      { $match: { orderStatus: "Delivered", deliveredAt: { $gte: currentPeriodStart } } },
      {
        $project: {
          totalTime: {
            $divide: [{ $subtract: ["$deliveredAt", "$createdAt"] }, 86400000]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgTotalDays: { $avg: "$totalTime" },
          minTotalDays: { $min: "$totalTime" },
          maxTotalDays: { $max: "$totalTime" }
        }
      }
    ]),

    // Order status counts for the period (used for pendingShipments only)
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart } } },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
    ]),

    // FIX D: Count orders where deliveredAt falls within TODAY specifically.
    // Old approach used statusBreakdown.Delivered which counted ALL delivered orders
    // in the entire timeframe period — not just those delivered today.
    Order.countDocuments({
      orderStatus: "Delivered",
      deliveredAt: { $gte: startOfToday, $lte: endOfToday }
    }),

    // FIX C: Real on-time rate from fulfillmentSLA field.
    // Old approach: Delivered / (Processing + Shipped + Delivered) — this is a
    // "delivery completion rate", not an on-time rate. An order delivered 30 days
    // late would still count as "on-time" under the old formula.
    // Correct: orders where slaBreached === false / all orders with SLA data.
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: currentPeriodStart },
          "fulfillmentSLA.slaBreached": { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          onTime: { $sum: { $cond: [{ $eq: ["$fulfillmentSLA.slaBreached", false] }, 1, 0] } }
        }
      }
    ])
  ]);

  const sb = statusBreakdown.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  const slaRecord = onTimeDeliveries[0] || { total: 0, onTime: 0 };
  const onTimeRate =
    slaRecord.total > 0
      ? Math.round((slaRecord.onTime / slaRecord.total) * 100 * 100) / 100
      : 0;

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
    statusBreakdown: sb,
    // Pre-computed fields — slice reads these directly instead of re-deriving
    deliveredToday: deliveredTodayCount,
    onTimeRate
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// SLA BREACHES
// ============================================

export const getSLABreachAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `sla_breach_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const breaches = await Order.find({
    "fulfillmentSLA.slaBreached": true,
    createdAt: { $gte: currentPeriodStart }
  })
    .select("_id user totalPrice fulfillmentSLA orderStatus createdAt")
    .populate("user", "firstName lastName email")
    .sort({ "fulfillmentSLA.delayInDays": -1 })
    .limit(50);

  const [totalStats, avgDelayResult] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: currentPeriodStart } } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          breachedOrders: { $sum: { $cond: ["$fulfillmentSLA.slaBreached", 1, 0] } }
        }
      }
    ]),

    // FIX B: Average delay only across orders that actually breached.
    // Old approach averaged ALL orders including non-breached ones where delayInDays = 0,
    // making the avg artificially low. E.g., 1 breached order with 2-day delay among
    // 99 on-time orders was showing avgResolutionTime ≈ 0.02 days instead of 2 days.
    Order.aggregate([
      {
        $match: {
          "fulfillmentSLA.slaBreached": true,
          createdAt: { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id: null,
          avgDelayDays: { $avg: "$fulfillmentSLA.delayInDays" }
        }
      }
    ])
  ]);

  const stats = totalStats[0] || { totalOrders: 0, breachedOrders: 0 };
  const avgDelayDays = avgDelayResult[0]?.avgDelayDays || 0;

  const breachRate =
    stats.totalOrders > 0
      ? Math.round((stats.breachedOrders / stats.totalOrders) * 100 * 100) / 100
      : 0;

  const criticalBreaches = breaches.filter(
    (b) => (b.fulfillmentSLA?.delayInDays || 0) >= 2
  ).length;

  const response = {
    summary: {
      totalOrders: stats.totalOrders,
      breachedOrders: stats.breachedOrders,
      avgDelayDays,
      breachRate,
      criticalBreaches
    },
    breaches
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// SHIPPING ANALYTICS
// ============================================

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
        "tracking.carrier": { $exists: true, $ne: null },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$tracking.carrier",
        totalShipments: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ["$orderStatus", "Delivered"] }, 1, 0] } },
        avgShippingCost: { $avg: "$shippingPrice" }
      }
    },
    {
      $addFields: {
        deliveryRate: {
          $cond: [
            { $gt: ["$totalShipments", 0] },
            { $multiply: [{ $divide: ["$delivered", "$totalShipments"] }, 100] },
            0
          ]
        }
      }
    },
    { $sort: { totalShipments: -1 } }
  ]);

  const deliveryTimesByCarrier = await Order.aggregate([
    {
      $match: {
        "tracking.carrier": { $exists: true, $ne: null },
        orderStatus: "Delivered",
        deliveredAt: { $gte: currentPeriodStart }
      }
    },
    {
      $addFields: {
        shippedDate: {
          $arrayElemAt: [
            { $filter: { input: "$statusHistory", as: "s", cond: { $eq: ["$$s.status", "Shipped"] } } },
            0
          ]
        }
      }
    },
    { $match: { shippedDate: { $ne: null } } },
    {
      $project: {
        carrier: "$tracking.carrier",
        deliveryTime: {
          $divide: [{ $subtract: ["$deliveredAt", "$shippedDate.timestamp"] }, 86400000]
        }
      }
    },
    { $group: { _id: "$carrier", avgDeliveryDays: { $avg: "$deliveryTime" } } }
  ]);

  const deliveryMap = new Map(
    deliveryTimesByCarrier.map((item) => [item._id, item.avgDeliveryDays])
  );

  const enrichedCarrierPerformance = carrierPerformance.map((carrier) => ({
    ...carrier,
    avgDeliveryDays: Math.round((deliveryMap.get(carrier._id) || 0) * 100) / 100,
    deliveryRate: Math.round(carrier.deliveryRate * 100) / 100,
    avgShippingCost: Math.round(carrier.avgShippingCost * 100) / 100
  }));

  await setCache(cacheKey, { carriers: enrichedCarrierPerformance }, 300);
  res.status(200).json({ success: true, carriers: enrichedCarrierPerformance });
});

export const getShipmentTrackingAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `shipment_tracking_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const trackingStats = await Order.aggregate([
    {
      $match: {
        orderStatus: { $in: ["Shipped", "Delivered"] },
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
              {
                $and: [
                  { $ne: ["$tracking.trackingNumber", null] },
                  { $ne: ["$tracking.trackingNumber", ""] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    }
  ]);

  const stats = trackingStats[0] || { totalOrders: 0, withTracking: 0 };
  const trackingCoverage =
    stats.totalOrders > 0
      ? Math.round((stats.withTracking / stats.totalOrders) * 100 * 100) / 100
      : 0;

  const response = {
    totalShippedOrders: stats.totalOrders,
    ordersWithTracking: stats.withTracking,
    ordersWithoutTracking: stats.totalOrders - stats.withTracking,
    trackingCoverage
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// FRAUD ANALYTICS
// ============================================

export const getFraudAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `fraud_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const [riskDistribution, pendingReviews, reviewDecisions, fraudFlags, preventedFraudValue] =
    await Promise.all([
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: currentPeriodStart },
            "fraudCheck.riskLevel": { $exists: true }
          }
        },
        {
          $group: {
            _id: "$fraudCheck.riskLevel",
            count: { $sum: 1 },
            totalValue: { $sum: "$totalPrice" },
            avgRiskScore: { $avg: "$fraudCheck.riskScore" }
          }
        },
        { $sort: { count: -1 } }
      ]),
      Order.countDocuments({
        "fraudCheck.reviewRequired": true,
        "fraudCheck.reviewDecision": "Pending",
        createdAt: { $gte: currentPeriodStart }
      }),
      Order.aggregate([
        {
          $match: {
            "fraudCheck.reviewedAt": { $gte: currentPeriodStart },
            "fraudCheck.reviewDecision": { $ne: "Pending" }
          }
        },
        {
          $group: {
            _id: "$fraudCheck.reviewDecision",
            count: { $sum: 1 },
            avgRiskScore: { $avg: "$fraudCheck.riskScore" }
          }
        }
      ]),
      Order.aggregate([
        {
          $match: {
            "fraudCheck.flags": { $exists: true, $ne: [] },
            createdAt: { $gte: currentPeriodStart }
          }
        },
        { $unwind: "$fraudCheck.flags" },
        { $group: { _id: "$fraudCheck.flags", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Order.aggregate([
        {
          $match: {
            "fraudCheck.reviewDecision": "Rejected",
            createdAt: { $gte: currentPeriodStart }
          }
        },
        { $group: { _id: null, totalValue: { $sum: "$totalPrice" }, count: { $sum: 1 } } }
      ])
    ]);

  const response = {
    riskDistribution,
    pendingReviews,
    reviewDecisions,
    commonFlags: fraudFlags,
    fraudPrevention: preventedFraudValue[0] || { totalValue: 0, count: 0 }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getHighRiskOrders = handleAsyncError(async (req, res, next) => {
  const { limit = 50, minRiskScore = 70 } = req.query;

  const highRiskOrders = await Order.find({
    "fraudCheck.riskScore": { $gte: parseInt(minRiskScore) },
    orderStatus: { $ne: "Cancelled" }
  })
    .select("_id user totalPrice fraudCheck orderStatus createdAt")
    .populate("user", "firstName lastName email")
    .sort({ "fraudCheck.riskScore": -1 })
    .limit(parseInt(limit));

  res.status(200).json({ success: true, count: highRiskOrders.length, orders: highRiskOrders });
});

// ============================================
// CANCELLATION ANALYTICS
// ============================================

export const getCancellationAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `cancellation_analytics_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const cancellationStats = await Order.aggregate([
    { $match: { createdAt: { $gte: currentPeriodStart } } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        cancelled: { $sum: { $cond: [{ $eq: ["$orderStatus", "Cancelled"] }, 1, 0] } },
        cancelledValue: {
          $sum: { $cond: [{ $eq: ["$orderStatus", "Cancelled"] }, "$totalPrice", 0] }
        }
      }
    }
  ]);

  const stats = cancellationStats[0] || { totalOrders: 0, cancelled: 0, cancelledValue: 0 };
  const cancellationRate =
    stats.totalOrders > 0
      ? Math.round((stats.cancelled / stats.totalOrders) * 100 * 100) / 100
      : 0;

  const reasons = await Order.aggregate([
    { $match: { orderStatus: "Cancelled", cancelledAt: { $gte: currentPeriodStart } } },
    {
      $group: {
        _id: "$cancellationReason",
        count: { $sum: 1 },
        totalValue: { $sum: "$totalPrice" }
      }
    },
    { $sort: { count: -1 } }
  ]);

  const response = { summary: { ...stats, cancellationRate }, reasonsBreakdown: reasons };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
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