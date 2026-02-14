import handleAsyncError from "../middleware/handleAsyncError.js";
// FIX ATTR1: Removed unused HandleError import — was imported but never called in this file.
import Order from "../models/order-model.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";
import { getCache, setCache } from "../utils/redis.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";

// ============================================
// CHANNEL PERFORMANCE
// ============================================

export const getChannelPerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `channel_performance_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const channelPerformance = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$analytics.source",
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPrice" },
        customers: { $addToSet: "$user" }
      }
    },
    {
      $project: {
        source: "$_id",
        orders: 1,
        revenue: 1,
        uniqueCustomers: { $size: "$customers" },
        avgOrderValue: { $divide: ["$revenue", "$orders"] }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  const customerAcquisition = await CustomerAnalytics.aggregate([
    {
      $match: {
        "purchaseBehavior.firstPurchaseDate": { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$acquisition.source",
        newCustomers: { $sum: 1 },
        totalCLV: { $sum: "$clv.totalRevenue" },
        avgCLV: { $avg: "$clv.totalRevenue" }
      }
    }
  ]);

  const acquisitionMap = new Map(
    customerAcquisition.map((item) => [item._id, item])
  );

  const enrichedChannels = channelPerformance.map((channel) => {
    const acquisition = acquisitionMap.get(channel.source) || {
      newCustomers: 0,
      totalCLV: 0,
      avgCLV: 0
    };

    return {
      source: channel.source || "direct",
      orders: channel.orders,
      revenue: Math.round(channel.revenue * 100) / 100,
      uniqueCustomers: channel.uniqueCustomers,
      newCustomers: acquisition.newCustomers,
      avgOrderValue: Math.round(channel.avgOrderValue * 100) / 100,
      avgCLV: Math.round(acquisition.avgCLV * 100) / 100,
      customerLTV: Math.round(acquisition.totalCLV * 100) / 100
    };
  });

  const response = {
    channels: enrichedChannels,
    summary: {
      totalRevenue: enrichedChannels.reduce((sum, ch) => sum + ch.revenue, 0),
      totalOrders: enrichedChannels.reduce((sum, ch) => sum + ch.orders, 0),
      totalCustomers: enrichedChannels.reduce((sum, ch) => sum + ch.uniqueCustomers, 0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// CAMPAIGN PERFORMANCE
// ============================================

export const getCampaignPerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `campaign_performance_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const campaignPerformance = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        "analytics.campaign": { $exists: true, $ne: null },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: {
          campaign: "$analytics.campaign",
          source: "$analytics.source",
          medium: "$analytics.medium"
        },
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPrice" },
        customers: { $addToSet: "$user" }
      }
    },
    {
      $project: {
        campaign: "$_id.campaign",
        source: "$_id.source",
        medium: "$_id.medium",
        orders: 1,
        revenue: 1,
        uniqueCustomers: { $size: "$customers" },
        avgOrderValue: { $divide: ["$revenue", "$orders"] }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  const formattedCampaigns = campaignPerformance.map((camp) => ({
    campaign: camp.campaign,
    source: camp.source,
    medium: camp.medium,
    orders: camp.orders,
    revenue: Math.round(camp.revenue * 100) / 100,
    uniqueCustomers: camp.uniqueCustomers,
    avgOrderValue: Math.round(camp.avgOrderValue * 100) / 100
  }));

  const response = {
    campaigns: formattedCampaigns,
    summary: {
      totalCampaigns: formattedCampaigns.length,
      totalRevenue: formattedCampaigns.reduce((sum, c) => sum + c.revenue, 0),
      totalOrders: formattedCampaigns.reduce((sum, c) => sum + c.orders, 0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// DEVICE & BROWSER ANALYTICS
// ============================================

export const getDevicePerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `device_performance_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const devicePerformance = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$analytics.device",
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPrice" },
        avgOrderValue: { $avg: "$totalPrice" }
      }
    },
    { $sort: { orders: -1 } }
  ]);

  const formattedDevices = devicePerformance.map((device) => ({
    device: device._id || "unknown",
    orders: device.orders,
    revenue: Math.round(device.revenue * 100) / 100,
    avgOrderValue: Math.round(device.avgOrderValue * 100) / 100
  }));

  const totalOrders = formattedDevices.reduce((sum, d) => sum + d.orders, 0);
  const devicesWithPercentage = formattedDevices.map((device) => ({
    ...device,
    orderPercentage:
      totalOrders > 0
        ? Math.round((device.orders / totalOrders) * 100 * 100) / 100
        : 0
  }));

  const response = {
    devices: devicesWithPercentage,
    summary: {
      totalOrders,
      totalRevenue: formattedDevices.reduce((sum, d) => sum + d.revenue, 0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export const getBrowserPerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `browser_performance_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const browserPerformance = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        "analytics.browser": { $exists: true },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$analytics.browser",
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPrice" }
      }
    },
    { $sort: { orders: -1 } },
    { $limit: 10 }
  ]);

  const formattedBrowsers = browserPerformance.map((browser) => ({
    browser: browser._id,
    orders: browser.orders,
    revenue: Math.round(browser.revenue * 100) / 100
  }));

  const response = { browsers: formattedBrowsers };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// REFERRER ANALYTICS
// ============================================

export const getReferrerPerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", limit = 20 } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `referrer_performance_${timeframe}_${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const referrerPerformance = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        "analytics.referrer": { $exists: true, $ne: null },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$analytics.referrer",
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPrice" },
        customers: { $addToSet: "$user" }
      }
    },
    {
      $project: {
        referrer: "$_id",
        orders: 1,
        revenue: 1,
        uniqueCustomers: { $size: "$customers" }
      }
    },
    { $sort: { orders: -1 } },
    { $limit: parseInt(limit) }
  ]);

  const formattedReferrers = referrerPerformance.map((ref) => ({
    referrer: ref.referrer,
    orders: ref.orders,
    revenue: Math.round(ref.revenue * 100) / 100,
    uniqueCustomers: ref.uniqueCustomers
  }));

  const response = {
    referrers: formattedReferrers,
    summary: {
      totalReferrers: formattedReferrers.length,
      totalOrders: formattedReferrers.reduce((sum, r) => sum + r.orders, 0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// ATTRIBUTION MODELS
// ============================================

export const getAttributionModels = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month" } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `attribution_models_${timeframe}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const [firstTouch, lastTouch] = await Promise.all([
    CustomerAnalytics.aggregate([
      {
        $match: {
          "purchaseBehavior.firstPurchaseDate": { $gte: currentPeriodStart }
        }
      },
      {
        $group: {
          _id: "$acquisition.source",
          customers: { $sum: 1 },
          totalRevenue: { $sum: "$clv.totalRevenue" }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]),
    Order.aggregate([
      {
        $match: {
          "paymentInfo.status": "success",
          orderStatus: { $ne: "Cancelled" },
          createdAt: { $gte: currentPeriodStart }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { user: "$user", source: "$analytics.source" },
          lastOrder: { $first: "$$ROOT" }
        }
      },
      {
        $group: {
          _id: "$_id.source",
          orders: { $sum: 1 },
          revenue: { $sum: "$lastOrder.totalPrice" }
        }
      },
      { $sort: { revenue: -1 } }
    ])
  ]);

  const response = {
    firstTouch: firstTouch.map((item) => ({
      source: item._id || "direct",
      customers: item.customers,
      totalRevenue: Math.round(item.totalRevenue * 100) / 100
    })),
    lastTouch: lastTouch.map((item) => ({
      source: item._id || "direct",
      orders: item.orders,
      revenue: Math.round(item.revenue * 100) / 100
    })),
    note: "First-touch shows customer acquisition sources. Last-touch shows conversion sources."
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

// ============================================
// LANDING PAGE PERFORMANCE
// ============================================

export const getLandingPagePerformance = handleAsyncError(async (req, res, next) => {
  const { timeframe = "month", limit = 20 } = req.query;
  validateTimeframe(timeframe, next);

  const cacheKey = `landing_pages_${timeframe}_${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const { currentPeriodStart } = getDateRanges(timeframe);

  const landingPagePerformance = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        "analytics.landingPage": { $exists: true, $ne: null },
        createdAt: { $gte: currentPeriodStart }
      }
    },
    {
      $group: {
        _id: "$analytics.landingPage",
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPrice" },
        customers: { $addToSet: "$user" }
      }
    },
    {
      $project: {
        landingPage: "$_id",
        orders: 1,
        revenue: 1,
        uniqueCustomers: { $size: "$customers" }
      }
    },
    { $sort: { orders: -1 } },
    { $limit: parseInt(limit) }
  ]);

  const formattedPages = landingPagePerformance.map((page) => ({
    landingPage: page.landingPage,
    orders: page.orders,
    revenue: Math.round(page.revenue * 100) / 100,
    uniqueCustomers: page.uniqueCustomers
  }));

  const response = {
    landingPages: formattedPages,
    summary: {
      totalPages: formattedPages.length,
      totalOrders: formattedPages.reduce((sum, p) => sum + p.orders, 0),
      totalRevenue: formattedPages.reduce((sum, p) => sum + p.revenue, 0)
    }
  };

  await setCache(cacheKey, response, 300);
  res.status(200).json({ success: true, ...response });
});

export default {
  getChannelPerformance,
  getCampaignPerformance,
  getDevicePerformance,
  getBrowserPerformance,
  getReferrerPerformance,
  getAttributionModels,
  getLandingPagePerformance
};