import CustomerAnalytics from "../models/customer-analytics-model.js";
import Order from "../models/order-model.js";
import User from "../models/userModel.js";
import Checkout from "../models/checkout-model.js";
import Discount from "../models/discount-model.js";

/**
 * Customer Analytics Service
 * Syncs customer data and calculates metrics
 */

// ============================================
// NORMALIZE ACQUISITION SOURCE
// ============================================

const normalizeAcquisitionSource = (source) => {
  if (!source) return 'direct';
  const s = source.toLowerCase();
  if (['organic', 'likely_organic', 'google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex'].includes(s)) return 'organic';
  if (['paid', 'google_ads', 'meta_ads', 'tiktok_ads', 'bing_ads', 'twitter_ads', 'linkedin_ads', 'pinterest_ads', 'snapchat_ads', 'amazon_ads', 'taboola', 'outbrain', 'criteo', 'likely_retargeting'].includes(s)) return 'paid';
  if (['social', 'facebook', 'instagram', 'meta', 'twitter', 'x', 'tiktok', 'snapchat', 'pinterest', 'linkedin', 'youtube', 'reddit', 'whatsapp', 'telegram', 'threads', 'discord', 'dark_social'].includes(s)) return 'social';
  if (['email', 'klaviyo', 'mailchimp', 'sendgrid', 'hubspot', 'newsletter', 'likely_email_or_social'].includes(s)) return 'email';
  if (['referral', 'affiliate', 'influencer', 'partner'].includes(s)) return 'referral';
  return 'direct';
};

// ============================================
// SYNC CUSTOMER ANALYTICS
// ============================================

export const syncCustomerAnalytics = async (userId) => {
  try {
    let customerAnalytics = await CustomerAnalytics.findOne({ user: userId });
 
    if (!customerAnalytics) {
      customerAnalytics = new CustomerAnalytics({
        user:        userId,
        lastSyncedAt: new Date(),
      });
    }
 
    const user = await User.findById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
 
    // FIX: Include all non-cancelled/non-returned orders for accurate CLV calculation
    // Excluding only "Cancelled" and "Returned" as these represent truly lost revenue
    const orders = await Order.find({
      user:              userId,
      orderStatus:       { $nin: ["Cancelled", "Returned"] },
      "paymentInfo.status": "success",
    }).sort({ createdAt: 1 });
 
    const cancelledOrders = await Order.countDocuments({
      user:        userId,
      orderStatus: "Cancelled",
    });
 
    const returnsRefunds = await getReturnsRefundsData(userId);
 
    // FIX S1: calculatePurchaseBehavior MUST run before calculateCLVMetrics.
    await calculatePurchaseBehavior(customerAnalytics, orders);
    calculateCLVMetrics(customerAnalytics, orders);
    calculateRFMMetrics(customerAnalytics, orders);
 
    await calculateEngagementMetrics(customerAnalytics, userId);
 
    // ── NEW: populate discountEngagement from order history ───────────────
    await calculateDiscountEngagement(customerAnalytics, orders);
 
    customerAnalytics.returnsRefunds = returnsRefunds;
 
    if (orders.length > 0 && !customerAnalytics.acquisition.source) {
      const firstOrder = orders[0];
      customerAnalytics.acquisition.source   = normalizeAcquisitionSource(firstOrder.analytics?.source);
      customerAnalytics.acquisition.medium   = firstOrder.analytics?.medium   || null;
      customerAnalytics.acquisition.campaign = firstOrder.analytics?.campaign || null;
    }
 
    customerAnalytics.risk.cancelledOrders          = cancelledOrders;
    customerAnalytics.risk.daysSinceLastEngagement  =
      calculateDaysSinceLastEngagement(user);
 
    customerAnalytics.calculateRFMScores();
    customerAnalytics.calculateValueTier();
    customerAnalytics.calculateChurnRisk();
 
    customerAnalytics.lastSyncedAt = new Date();
 
    await customerAnalytics.save();
 
    return customerAnalytics;
  } catch (error) {
    throw error;
  }
};

// ============================================
// HELPER: Calculate CLV Metrics
// ============================================

const calculateCLVMetrics = (customerAnalytics, orders) => {
  if (orders.length === 0) {
    customerAnalytics.clv.totalRevenue = 0;
    customerAnalytics.clv.totalOrders = 0;
    customerAnalytics.clv.averageOrderValue = 0;
    customerAnalytics.clv.totalItemsPurchased = 0;
    customerAnalytics.clv.totalProfit = 0;
    return;
  }

  let totalRevenue = 0;
  let totalProfit = 0;
  let totalItems = 0;

  orders.forEach((order) => {
    totalRevenue += order.totalPrice || 0;
    totalProfit += order.profitAnalysis?.netProfit || 0;
    if (order.orderItems) {
      totalItems += order.orderItems.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0
      );
    }
  });

  customerAnalytics.clv.totalRevenue = Math.round(totalRevenue * 100) / 100;
  customerAnalytics.clv.totalOrders = orders.length;
  customerAnalytics.clv.averageOrderValue =
    Math.round((totalRevenue / orders.length) * 100) / 100;
  customerAnalytics.clv.totalItemsPurchased = totalItems;
  customerAnalytics.clv.totalProfit = Math.round(totalProfit * 100) / 100;

  if (totalRevenue > 0) {
    customerAnalytics.clv.grossMarginPercent =
      Math.round((totalProfit / totalRevenue) * 100 * 100) / 100;
  }

  // FIX S2: Use actual first order date instead of non-existent customerAgeDays field
  const firstOrderDate = orders[0].createdAt;
  const customerAgeDays = Math.floor(
    (Date.now() - firstOrderDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // FIX S1 (continued): avgDaysBetweenPurchases is now reliably populated
  const avgDaysBetweenPurchases =
    customerAnalytics.purchaseBehavior?.avgDaysBetweenPurchases || 90;

  const estimatedLifespanYears = 3;
  const purchasesPerYear =
    avgDaysBetweenPurchases > 0 ? 365 / avgDaysBetweenPurchases : 1;

  customerAnalytics.clv.predictedLTV =
    Math.round(
      customerAnalytics.clv.averageOrderValue *
        purchasesPerYear *
        estimatedLifespanYears *
        100
    ) / 100;
};

// ============================================
// HELPER: Calculate RFM Metrics
// ============================================

const calculateRFMMetrics = (customerAnalytics, orders) => {
  if (orders.length === 0) {
    customerAnalytics.rfm.recency = 999;
    customerAnalytics.rfm.frequency = 0;
    customerAnalytics.rfm.monetary = 0;
    return;
  }

  const lastOrder = orders[orders.length - 1];
  const daysSinceLastPurchase = Math.floor(
    (Date.now() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  customerAnalytics.rfm.recency = daysSinceLastPurchase;
  customerAnalytics.rfm.frequency = orders.length;

  const totalSpent = orders.reduce(
    (sum, order) => sum + (order.totalPrice || 0),
    0
  );
  customerAnalytics.rfm.monetary = Math.round(totalSpent * 100) / 100;
};

// ============================================
// HELPER: Calculate Purchase Behavior
// ============================================

const calculatePurchaseBehavior = async (customerAnalytics, orders) => {
  if (orders.length === 0) return;

  customerAnalytics.purchaseBehavior.firstPurchaseDate = orders[0].createdAt;
  customerAnalytics.purchaseBehavior.lastPurchaseDate =
    orders[orders.length - 1].createdAt;

  if (orders.length > 1) {
    const daysBetween = [];
    for (let i = 1; i < orders.length; i++) {
      const days = Math.floor(
        (orders[i].createdAt.getTime() - orders[i - 1].createdAt.getTime()) /
          (1000 * 60 * 60 * 24)
      );
      daysBetween.push(days);
    }
    const avgDays =
      daysBetween.reduce((sum, days) => sum + days, 0) / daysBetween.length;
    customerAnalytics.purchaseBehavior.avgDaysBetweenPurchases =
      Math.round(avgDays);
  }

  const customerAgeDays = Math.floor(
    (Date.now() - orders[0].createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  // FIX S3: Prevent division by zero for new customers
  const customerAgeMonths = Math.max(customerAgeDays / 30, 1);
  customerAnalytics.purchaseBehavior.purchaseFrequency =
    Math.round((orders.length / customerAgeMonths) * 100) / 100;

  if (orders.length > 1) {
    customerAnalytics.purchaseBehavior.repeatPurchaseRate =
      Math.round(
        ((orders.length - 1) / orders.length) * 100 * 100
      ) / 100;
  }

  // NOTE: favoriteCategories tracks product names, not categories
  // Replace with Product model lookup if true category data is needed
  const categoryMap = new Map();
  orders.forEach((order) => {
    order.orderItems?.forEach((item) => {
      const key = item.name || "Unknown";
      if (!categoryMap.has(key)) {
        categoryMap.set(key, { purchaseCount: 0, totalSpent: 0 });
      }
      const data = categoryMap.get(key);
      data.purchaseCount += 1;
      data.totalSpent += (item.price || 0) * (item.quantity || 0);
    });
  });

  customerAnalytics.purchaseBehavior.favoriteCategories = Array.from(
    categoryMap.entries()
  )
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.purchaseCount - a.purchaseCount)
    .slice(0, 5);

  const productMap = new Map();
  orders.forEach((order) => {
    order.orderItems?.forEach((item) => {
      const productId = item.product?.toString();
      if (!productId) return;

      if (!productMap.has(productId)) {
        productMap.set(productId, {
          product: item.product,
          purchaseCount: 0,
          totalSpent: 0,
          lastPurchased: order.createdAt
        });
      }
      const data = productMap.get(productId);
      data.purchaseCount += 1;
      data.totalSpent += (item.price || 0) * (item.quantity || 0);
      if (order.createdAt > data.lastPurchased) {
        data.lastPurchased = order.createdAt;
      }
    });
  });

  customerAnalytics.purchaseBehavior.favoriteProducts = Array.from(
    productMap.values()
  )
    .sort((a, b) => b.purchaseCount - a.purchaseCount)
    .slice(0, 10);

  // FIX S4: Properly handle empty payment methods object
  const paymentMethods = {};
  orders.forEach((order) => {
    const method = order.paymentInfo?.method;
    if (method) {
      paymentMethods[method] = (paymentMethods[method] || 0) + 1;
    }
  });
  const methodKeys = Object.keys(paymentMethods);
  customerAnalytics.purchaseBehavior.preferredPaymentMethod =
    methodKeys.length > 0
      ? methodKeys.reduce((a, b) =>
          paymentMethods[a] >= paymentMethods[b] ? a : b
        )
      : null;

  const totalItems = orders.reduce(
    (sum, order) => sum + (order.orderItems?.length || 0),
    0
  );
  customerAnalytics.purchaseBehavior.avgCartSize =
    Math.round((totalItems / orders.length) * 100) / 100;
};

// ============================================
// HELPER: Calculate Engagement Metrics
// ============================================

const calculateEngagementMetrics = async (customerAnalytics, userId) => {
  const user = await User.findById(userId).select("wishlist");
  customerAnalytics.engagement.wishlistItemsCount = user?.wishlist?.length || 0;

  const [abandonedCheckouts, totalCheckouts] = await Promise.all([
    Checkout.countDocuments({ user: userId, "abandonment.isAbandoned": true }),
    Checkout.countDocuments({ user: userId })
  ]);

  customerAnalytics.engagement.checkoutAbandonments = abandonedCheckouts;
  customerAnalytics.engagement.checkoutAbandonmentRate =
    totalCheckouts > 0
      ? Math.round((abandonedCheckouts / totalCheckouts) * 100 * 100) / 100
      : 0;

  const abandonedCheckoutsData = await Checkout.find({
    user: userId,
    "abandonment.isAbandoned": true,
    "conversion.isConverted": false
  }).select("pricing.totalPrice");

  const totalAbandonedValue = abandonedCheckoutsData.reduce(
    (sum, checkout) => sum + (checkout.pricing?.totalPrice || 0),
    0
  );
  customerAnalytics.engagement.abandonedCheckoutValue =
    Math.round(totalAbandonedValue * 100) / 100;

  const lastCheckout = await Checkout.findOne({ user: userId })
    .sort({ lastActivityAt: -1 })
    .select("lastActivityAt");

  if (lastCheckout) {
    const daysSinceLastCheckout = Math.floor(
      (Date.now() - lastCheckout.lastActivityAt.getTime()) /
        (1000 * 60 * 60 * 24)
    );
    customerAnalytics.engagement.daysSinceLastCheckout = daysSinceLastCheckout;
  }
};

// ============================================
// HELPER: Get Returns/Refunds Data
// ============================================

const getReturnsRefundsData = async (userId) => {
  const orders = await Order.find({
    user: userId,
    "paymentInfo.status": "success"
  });

  const totalOrders = orders.length;
  let totalReturns = 0;
  let totalRefunds = 0;
  let totalRefundAmount = 0;

  orders.forEach((order) => {
    if (
      order.returnInfo?.status &&
      order.returnInfo.status !== "none" &&
      order.returnInfo.status !== "rejected"
    ) {
      totalReturns += 1;
    }

    if (
      order.refundInfo?.status &&
      order.refundInfo.status !== "none" &&
      order.refundInfo.status !== "rejected" &&
      order.refundInfo.status !== "failed"
    ) {
      totalRefunds += 1;
      totalRefundAmount += order.refundInfo.refundAmount || 0;
    }
  });

  return {
    totalReturns,
    totalRefunds,
    totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
    returnRate:
      totalOrders > 0
        ? Math.round((totalReturns / totalOrders) * 100 * 100) / 100
        : 0,
    refundRate:
      totalOrders > 0
        ? Math.round((totalRefunds / totalOrders) * 100 * 100) / 100
        : 0
  };
};

// ============================================
// HELPER: Calculate Days Since Last Engagement
// ============================================

const calculateDaysSinceLastEngagement = (user) => {
  const lastLogin = user?.lastLogin;
  if (!lastLogin) return 999;
  return Math.floor(
    (Date.now() - lastLogin.getTime()) / (1000 * 60 * 60 * 24)
  );
};

// ============================================
// BULK SYNC ALL CUSTOMERS
// ============================================

export const syncAllCustomerAnalytics = async () => {
  const userIds = await Order.distinct("user", {
    "paymentInfo.status": "success"
  });

  let successCount = 0;
  let errorCount = 0;

  const batchSize = 50;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (userId) => {
        try {
          await syncCustomerAnalytics(userId);
          successCount++;
        } catch {
          // Individual failures are counted but don't abort the batch.
          errorCount++;
        }
      })
    );
  }

  return {
    total: userIds.length,
    successful: successCount,
    errors: errorCount
  };
};

// ============================================
// SYNC CUSTOMER AFTER ORDER
// ============================================

export const syncCustomerAfterOrder = async (orderId) => {
  const order = await Order.findById(orderId);

  if (!order || !order.user) {
    throw new Error("Order or user not found");
  }

  // Throws on failure — callers decide how to handle.
  await syncCustomerAnalytics(order.user);
};

// ============================================
// GET CUSTOMER ANALYTICS SUMMARY
// ============================================

export const getCustomerAnalyticsSummary = async () => {
  const summary = await CustomerAnalytics.aggregate([
    {
      $facet: {
        segments: [
          {
            $group: {
              _id: "$rfm.segment",
              count: { $sum: 1 },
              totalRevenue: { $sum: "$clv.totalRevenue" },
              avgRevenue: { $avg: "$clv.totalRevenue" }
            }
          },
          { $sort: { totalRevenue: -1 } }
        ],
        valueTiers: [
          {
            $group: {
              _id: "$valueTier",
              count: { $sum: 1 },
              totalRevenue: { $sum: "$clv.totalRevenue" }
            }
          },
          { $sort: { totalRevenue: -1 } }
        ],
        churnRisk: [
          {
            $group: {
              _id: "$risk.churnPrediction",
              count: { $sum: 1 }
            }
          }
        ],
        overall: [
          {
            $group: {
              _id: null,
              totalCustomers: { $sum: 1 },
              totalRevenue: { $sum: "$clv.totalRevenue" },
              avgCLV: { $avg: "$clv.totalRevenue" },
              avgOrders: { $avg: "$clv.totalOrders" },
              avgAOV: { $avg: "$clv.averageOrderValue" },
              vipCount: { $sum: { $cond: ["$isVIP", 1, 0] } },
              atRiskCount: { $sum: { $cond: ["$risk.isAtRisk", 1, 0] } }
            }
          }
        ]
      }
    }
  ]);

  return summary[0];
};

// ============================================
// HELPER: Calculate Discount Engagement
// ============================================

const calculateDiscountEngagement = async (customerAnalytics, orders) => {
  if (orders.length === 0) {
    customerAnalytics.discountEngagement = {
      totalDiscountsUsed:        0,
      totalDiscountSavings:      0,
      avgDiscountAmount:         0,
      discountDependencyRate:    null,
      favouriteDiscountCategory: null,
      firstDiscountUsedAt:       null,
      lastDiscountUsedAt:        null,
    };
    return;
  }

  const discountedOrders = orders.filter(
    (o) => (o.discounts?.codes ?? []).length > 0
  );

  const totalDiscountsUsed   = discountedOrders.length;
  const totalDiscountSavings = Math.round(
    discountedOrders.reduce(
      (sum, o) => sum + (Number(o.discounts?.totalDiscount) || 0),
      0
    ) * 100
  ) / 100;

  const avgDiscountAmount =
    totalDiscountsUsed > 0
      ? Math.round((totalDiscountSavings / totalDiscountsUsed) * 100) / 100
      : 0;

  const discountDependencyRate =
    orders.length > 0
      ? Math.round((totalDiscountsUsed / orders.length) * 100 * 100) / 100
      : null;

  let favouriteDiscountCategory = null;
  if (discountedOrders.length > 0) {
    // Collect every code string used across all discounted orders
    const allCodes = discountedOrders.flatMap(
      (o) => (o.discounts?.codes ?? []).map((c) => c.code).filter(Boolean)
    );

    if (allCodes.length > 0) {
      const discountDocs = await Discount.find(
        { code: { $in: allCodes.map((c) => c.toUpperCase()) } },
        { code: 1, category: 1 }
      ).lean();

      // Map code → category
      const codeToCategory = new Map(
        discountDocs.map((d) => [d.code.toUpperCase(), d.category])
      );

      // Count occurrences per category across all usage
      const categoryCount = new Map();
      allCodes.forEach((code) => {
        const cat = codeToCategory.get(code.toUpperCase());
        if (cat) categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
      });

      if (categoryCount.size > 0) {
        favouriteDiscountCategory = [...categoryCount.entries()].reduce(
          (best, [cat, count]) => (count > best[1] ? [cat, count] : best),
          ['', 0]
        )[0] || null;
      }
    }
  }

  const firstDiscountUsedAt =
    discountedOrders.length > 0 ? discountedOrders[0].createdAt : null;
  const lastDiscountUsedAt  =
    discountedOrders.length > 0
      ? discountedOrders[discountedOrders.length - 1].createdAt
      : null;

  customerAnalytics.discountEngagement = {
    totalDiscountsUsed,
    totalDiscountSavings,
    avgDiscountAmount,
    discountDependencyRate,
    favouriteDiscountCategory,
    firstDiscountUsedAt,
    lastDiscountUsedAt,
  };
};

export default {
  syncCustomerAnalytics,
  syncAllCustomerAnalytics,
  syncCustomerAfterOrder,
  getCustomerAnalyticsSummary
};