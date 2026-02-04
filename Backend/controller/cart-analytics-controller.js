import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Cart from "../models/cart-model.js";
import { getDateRanges } from "../utils/dateRanges.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getCache, setCache } from "../utils/redis.js";

// ============================================
// CART ABANDONMENT ANALYTICS
// ============================================

/**
 * Get cart abandonment statistics
 * @route GET /api/v1/analytics/cart/abandonment
 * @access Admin
 */
export const getCartAbandonmentStats = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `cart_abandonment_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart, previousPeriodStart, previousPeriodEnd } = getDateRanges(timeframe);

  // Current period stats
  const [currentStats, previousStats] = await Promise.all([
    Cart.getAbandonmentRate(currentPeriodStart, new Date()),
    Cart.getAbandonmentRate(previousPeriodStart, previousPeriodEnd)
  ]);

  // Calculate trend
  const trend = previousStats.abandonmentRate > 0
    ? ((currentStats.abandonmentRate - previousStats.abandonmentRate) / previousStats.abandonmentRate) * 100
    : 0;

  // Get abandoned cart value
  const abandonedValue = await Cart.aggregate([
    {
      $match: {
        'abandonment.isAbandoned': true,
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: null,
        totalValue: { $sum: '$pricing.total' },
        avgValue: { $avg: '$pricing.total' },
        count: { $sum: 1 }
      }
    }
  ]);

  // Get abandonment by funnel step
  const abandonmentByStep = await Cart.aggregate([
    {
      $match: {
        'abandonment.isAbandoned': true,
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$abandonment.abandonedAtStep',
        count: { $sum: 1 },
        totalValue: { $sum: '$pricing.total' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  // Get abandonment reasons breakdown
  const abandonmentReasons = await Cart.aggregate([
    {
      $match: {
        'abandonment.isAbandoned': true,
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $unwind: '$abandonment.possibleReasons'
    },
    {
      $group: {
        _id: '$abandonment.possibleReasons',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  const response = {
    currentPeriod: {
      ...currentStats,
      abandonedValue: abandonedValue[0]?.totalValue || 0,
      avgAbandonedCartValue: abandonedValue[0]?.avgValue || 0
    },
    previousPeriod: previousStats,
    trend: Math.round(trend * 100) / 100,
    abandonmentByStep,
    abandonmentReasons
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// ABANDONED CARTS LIST
// ============================================

/**
 * Get list of abandoned carts with recovery priority
 * @route GET /api/v1/analytics/cart/abandoned-list
 * @access Admin
 */
export const getAbandonedCartsList = handleAsyncError(async (req, res, next) => {
  const {
    hours = 24,
    minValue = 0,
    limit = 50,
    page = 1,
    sortBy = 'priority' // priority, value, date
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get abandoned carts
  const carts = await Cart.find({
    'abandonment.isAbandoned': true,
    'abandonment.abandonedAt': {
      $gte: new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000)
    },
    'pricing.total': { $gte: parseFloat(minValue) },
    'conversion.isConverted': false
  })
    .populate('user', 'firstName lastName email')
    .populate('items.product', 'name images pricing')
    .lean();

  // Calculate priority for each cart
  const cartsWithPriority = carts.map(cart => ({
    ...cart,
    priority: Cart.calculatePriority(cart),
    minutesSinceAbandoned: Math.floor(
      (Date.now() - new Date(cart.abandonment.abandonedAt).getTime()) / (1000 * 60)
    )
  }));

  // Sort based on sortBy parameter
  let sortedCarts = cartsWithPriority;
  if (sortBy === 'priority') {
    sortedCarts.sort((a, b) => b.priority - a.priority);
  } else if (sortBy === 'value') {
    sortedCarts.sort((a, b) => b.pricing.total - a.pricing.total);
  } else if (sortBy === 'date') {
    sortedCarts.sort((a, b) => 
      new Date(b.abandonment.abandonedAt) - new Date(a.abandonment.abandonedAt)
    );
  }

  // Paginate
  const paginatedCarts = sortedCarts.slice(skip, skip + parseInt(limit));
  const totalCarts = sortedCarts.length;
  const totalPages = Math.ceil(totalCarts / parseInt(limit));

  res.status(200).json({
    success: true,
    abandonedCarts: paginatedCarts,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalCarts,
      hasNextPage: parseInt(page) < totalPages,
      hasPrevPage: parseInt(page) > 1
    },
    summary: {
      totalValue: sortedCarts.reduce((sum, cart) => sum + cart.pricing.total, 0),
      avgValue: sortedCarts.length > 0 
        ? sortedCarts.reduce((sum, cart) => sum + cart.pricing.total, 0) / sortedCarts.length 
        : 0,
      highPriorityCarts: sortedCarts.filter(cart => cart.priority >= 70).length
    }
  });
});

// ============================================
// RECOVERY OPPORTUNITIES
// ============================================

/**
 * Get top cart recovery opportunities (high priority abandoned carts)
 * @route GET /api/v1/analytics/cart/recovery-opportunities
 * @access Admin
 */
export const getRecoveryOpportunities = handleAsyncError(async (req, res, next) => {
  const { limit = 50 } = req.query;

  const cacheKey = `recovery_opportunities_${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const opportunities = await Cart.getRecoveryOpportunities(parseInt(limit));

  const response = {
    opportunities,
    summary: {
      totalOpportunities: opportunities.length,
      totalPotentialRevenue: opportunities.reduce((sum, cart) => sum + cart.pricing.total, 0),
      avgCartValue: opportunities.length > 0
        ? opportunities.reduce((sum, cart) => sum + cart.pricing.total, 0) / opportunities.length
        : 0,
      criticalPriority: opportunities.filter(cart => cart.priority >= 80).length,
      highPriority: opportunities.filter(cart => cart.priority >= 60 && cart.priority < 80).length,
      mediumPriority: opportunities.filter(cart => cart.priority >= 40 && cart.priority < 60).length
    }
  };

  await setCache(cacheKey, response, 180); // 3 minutes cache

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// CONVERSION FUNNEL ANALYTICS
// ============================================

/**
 * Get conversion funnel analytics
 * @route GET /api/v1/analytics/cart/funnel
 * @access Admin
 */
export const getConversionFunnel = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `conversion_funnel_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Get funnel step counts
  const funnelData = await Cart.getFunnelAnalytics(currentPeriodStart, new Date());

  // Calculate conversion rates between steps
  const stepOrder = [
    'cart_view',
    'checkout_start',
    'shipping_info',
    'payment_info',
    'review_order',
    'order_complete'
  ];

  const funnelSteps = stepOrder.map(step => {
    const stepData = funnelData.find(d => d._id === step);
    return {
      step,
      count: stepData?.count || 0
    };
  });

  // Calculate drop-off rates
  const funnelWithDropoff = funnelSteps.map((step, index) => {
    const nextStep = funnelSteps[index + 1];
    const dropoffCount = nextStep ? step.count - nextStep.count : 0;
    const dropoffRate = step.count > 0 ? (dropoffCount / step.count) * 100 : 0;
    const conversionRate = nextStep && step.count > 0 
      ? (nextStep.count / step.count) * 100 
      : 0;

    return {
      ...step,
      dropoffCount,
      dropoffRate: Math.round(dropoffRate * 100) / 100,
      conversionRate: Math.round(conversionRate * 100) / 100
    };
  });

  // Overall conversion rate (cart_view to order_complete)
  const cartViews = funnelSteps[0]?.count || 0;
  const completedOrders = funnelSteps[funnelSteps.length - 1]?.count || 0;
  const overallConversionRate = cartViews > 0 
    ? (completedOrders / cartViews) * 100 
    : 0;

  const response = {
    funnel: funnelWithDropoff,
    overallConversionRate: Math.round(overallConversionRate * 100) / 100,
    totalCartViews: cartViews,
    totalCompletedOrders: completedOrders,
    biggestDropoff: funnelWithDropoff.reduce((max, step) => 
      step.dropoffRate > max.dropoffRate ? step : max
    , { step: null, dropoffRate: 0 })
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// CART VALUE ANALYTICS
// ============================================

/**
 * Get cart value analytics (average cart value, distribution, etc.)
 * @route GET /api/v1/analytics/cart/value
 * @access Admin
 */
export const getCartValueAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `cart_value_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Get cart value statistics
  const valueStats = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart },
        status: { $in: ['abandoned', 'converted'] }
      }
    },
    {
      $group: {
        _id: null,
        avgCartValue: { $avg: '$pricing.total' },
        minCartValue: { $min: '$pricing.total' },
        maxCartValue: { $max: '$pricing.total' },
        totalCarts: { $sum: 1 }
      }
    }
  ]);

  // Get cart value distribution
  const valueDistribution = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart },
        status: { $in: ['abandoned', 'converted'] }
      }
    },
    {
      $bucket: {
        groupBy: '$pricing.total',
        boundaries: [0, 50, 100, 200, 500, 1000, 10000],
        default: '1000+',
        output: {
          count: { $sum: 1 },
          avgValue: { $avg: '$pricing.total' },
          converted: {
            $sum: {
              $cond: [{ $eq: ['$conversion.isConverted', true] }, 1, 0]
            }
          }
        }
      }
    }
  ]);

  // Format distribution with labels
  const formattedDistribution = valueDistribution.map((bucket, index) => {
    const ranges = ['$0-$49', '$50-$99', '$100-$199', '$200-$499', '$500-$999', '$1000+'];
    return {
      range: ranges[index] || '$1000+',
      ...bucket,
      conversionRate: bucket.count > 0 
        ? Math.round((bucket.converted / bucket.count) * 100 * 100) / 100 
        : 0
    };
  });

  // Compare converted vs abandoned cart values
  const comparisonStats = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart },
        status: { $in: ['abandoned', 'converted'] }
      }
    },
    {
      $group: {
        _id: '$status',
        avgValue: { $avg: '$pricing.total' },
        count: { $sum: 1 }
      }
    }
  ]);

  const response = {
    overall: valueStats[0] || {
      avgCartValue: 0,
      minCartValue: 0,
      maxCartValue: 0,
      totalCarts: 0
    },
    distribution: formattedDistribution,
    comparison: {
      converted: comparisonStats.find(s => s._id === 'converted') || { avgValue: 0, count: 0 },
      abandoned: comparisonStats.find(s => s._id === 'abandoned') || { avgValue: 0, count: 0 }
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// DEVICE & SOURCE ANALYTICS
// ============================================

/**
 * Get cart analytics by device, source, and channel
 * @route GET /api/v1/analytics/cart/attribution
 * @access Admin
 */
export const getCartAttributionAnalytics = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `cart_attribution_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Device performance
  const deviceStats = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$analytics.device',
        totalCarts: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $eq: ['$conversion.isConverted', true] }, 1, 0] }
        },
        abandoned: {
          $sum: { $cond: [{ $eq: ['$abandonment.isAbandoned', true] }, 1, 0] }
        },
        avgCartValue: { $avg: '$pricing.total' }
      }
    },
    {
      $project: {
        _id: 1,
        totalCarts: 1,
        converted: 1,
        abandoned: 1,
        avgCartValue: 1,
        conversionRate: {
          $cond: [
            { $gt: ['$totalCarts', 0] },
            { $multiply: [{ $divide: ['$converted', '$totalCarts'] }, 100] },
            0
          ]
        },
        abandonmentRate: {
          $cond: [
            { $gt: ['$totalCarts', 0] },
            { $multiply: [{ $divide: ['$abandoned', '$totalCarts'] }, 100] },
            0
          ]
        }
      }
    }
  ]);

  // Source performance
  const sourceStats = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$analytics.source',
        totalCarts: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $eq: ['$conversion.isConverted', true] }, 1, 0] }
        },
        avgCartValue: { $avg: '$pricing.total' }
      }
    },
    {
      $project: {
        _id: 1,
        totalCarts: 1,
        converted: 1,
        avgCartValue: 1,
        conversionRate: {
          $cond: [
            { $gt: ['$totalCarts', 0] },
            { $multiply: [{ $divide: ['$converted', '$totalCarts'] }, 100] },
            0
          ]
        }
      }
    },
    {
      $sort: { totalCarts: -1 }
    }
  ]);

  // Browser performance
  const browserStats = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: '$analytics.browser',
        totalCarts: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $eq: ['$conversion.isConverted', true] }, 1, 0] }
        }
      }
    },
    {
      $sort: { totalCarts: -1 }
    },
    {
      $limit: 5
    }
  ]);

  const response = {
    byDevice: deviceStats,
    bySource: sourceStats,
    byBrowser: browserStats
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// CART TIMELINE ANALYTICS
// ============================================

/**
 * Get cart creation and conversion timeline (hourly/daily breakdown)
 * @route GET /api/v1/analytics/cart/timeline
 * @access Admin
 */
export const getCartTimeline = handleAsyncError(async (req, res, next) => {
  const { timeframe = "week", groupBy = "day" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `cart_timeline_${timeframe}_${groupBy}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  // Determine date format based on groupBy
  const dateFormat = groupBy === "hour" 
    ? { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } }
    : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };

  const timeline = await Cart.aggregate([
    {
      $match: {
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: dateFormat,
        totalCarts: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $eq: ['$conversion.isConverted', true] }, 1, 0] }
        },
        abandoned: {
          $sum: { $cond: [{ $eq: ['$abandonment.isAbandoned', true] }, 1, 0] }
        },
        totalValue: { $sum: '$pricing.total' },
        avgCartValue: { $avg: '$pricing.total' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  const response = {
    timeline,
    summary: {
      totalCarts: timeline.reduce((sum, t) => sum + t.totalCarts, 0),
      totalConverted: timeline.reduce((sum, t) => sum + t.converted, 0),
      totalAbandoned: timeline.reduce((sum, t) => sum + t.abandoned, 0),
      totalValue: timeline.reduce((sum, t) => sum + t.totalValue, 0)
    }
  };

  await setCache(cacheKey, response, 300);

  res.status(200).json({
    success: true,
    ...response
  });
});

// ============================================
// MARK CART FOR RECOVERY EMAIL
// ============================================

/**
 * Mark cart as having recovery email sent
 * @route POST /api/v1/analytics/cart/:cartId/mark-recovery-sent
 * @access Admin
 */
export const markRecoveryEmailSent = handleAsyncError(async (req, res, next) => {
  const { cartId } = req.params;

  const cart = await Cart.findById(cartId);

  if (!cart) {
    return next(new HandleError('Cart not found', 404));
  }

  cart.markRecoveryEmailSent();
  await cart.save();

  res.status(200).json({
    success: true,
    message: 'Recovery email marked as sent',
    cart
  });
});