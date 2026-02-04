import CustomerAnalytics from "../models/customer-analytics-model.js";
import Order from "../models/order-model.js";
import User from "../models/userModel.js";
import Cart from "../models/cart-model.js";

/**
 * Customer Analytics Service
 * Syncs customer data and calculates metrics
 */

// ============================================
// SYNC CUSTOMER ANALYTICS
// ============================================

/**
 * Sync or create customer analytics for a user
 * Call this after order completion or periodically
 */
export const syncCustomerAnalytics = async (userId) => {
  try {
    // Find or create customer analytics record
    let customerAnalytics = await CustomerAnalytics.findOne({ user: userId });

    if (!customerAnalytics) {
      customerAnalytics = new CustomerAnalytics({
        user: userId,
        lastSyncedAt: new Date()
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    // Get all completed orders for this customer
    const orders = await Order.find({
      user: userId,
      orderStatus: { $in: ['Delivered', 'Shipped'] },
      'paymentInfo.status': 'success'
    }).sort({ createdAt: 1 });

    // Get cancelled orders count
    const cancelledOrders = await Order.countDocuments({
      user: userId,
      orderStatus: 'Cancelled'
    });

    // Get returns and refunds
    const returnsRefunds = await getReturnsRefundsData(userId);

    // Calculate CLV metrics
    calculateCLVMetrics(customerAnalytics, orders);

    // Calculate RFM metrics
    calculateRFMMetrics(customerAnalytics, orders);

    // Calculate purchase behavior
    await calculatePurchaseBehavior(customerAnalytics, orders);

    // Calculate engagement metrics
    await calculateEngagementMetrics(customerAnalytics, userId);

    // Set returns/refunds data
    customerAnalytics.returnsRefunds = returnsRefunds;

    // Set acquisition data (from first order or user registration)
    if (orders.length > 0 && !customerAnalytics.acquisition.source) {
      const firstOrder = orders[0];
      customerAnalytics.acquisition.source = firstOrder.analytics?.source || 'direct';
      customerAnalytics.acquisition.medium = firstOrder.analytics?.medium;
      customerAnalytics.acquisition.campaign = firstOrder.analytics?.campaign;
    }

    // Set risk indicators
    customerAnalytics.risk.cancelledOrders = cancelledOrders;
    customerAnalytics.risk.daysSinceLastEngagement = calculateDaysSinceLastEngagement(user);

    // Calculate RFM scores and segment
    customerAnalytics.calculateRFMScores();

    // Calculate value tier
    customerAnalytics.calculateValueTier();

    // Calculate churn risk
    customerAnalytics.calculateChurnRisk();

    // Update last synced timestamp
    customerAnalytics.lastSyncedAt = new Date();

    await customerAnalytics.save();

    return customerAnalytics;
  } catch (error) {
    console.error(`Error syncing customer analytics for user ${userId}:`, error);
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

  orders.forEach(order => {
    totalRevenue += order.totalPrice || 0;
    totalProfit += order.profitAnalysis?.netProfit || 0;
    
    // Count total items
    if (order.orderItems) {
      totalItems += order.orderItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    }
  });

  customerAnalytics.clv.totalRevenue = Math.round(totalRevenue * 100) / 100;
  customerAnalytics.clv.totalOrders = orders.length;
  customerAnalytics.clv.averageOrderValue = Math.round((totalRevenue / orders.length) * 100) / 100;
  customerAnalytics.clv.totalItemsPurchased = totalItems;
  customerAnalytics.clv.totalProfit = Math.round(totalProfit * 100) / 100;
  
  // Calculate gross margin percentage
  if (totalRevenue > 0) {
    customerAnalytics.clv.grossMarginPercent = Math.round((totalProfit / totalRevenue) * 100 * 100) / 100;
  }

  // Simple predicted LTV (can be enhanced with ML)
  // Formula: AOV * Purchase Frequency * Customer Lifespan
  const avgDaysBetweenPurchases = customerAnalytics.purchaseBehavior?.avgDaysBetweenPurchases || 90;
  const customerAgeDays = customerAnalytics.customerAgeDays || 365;
  const estimatedLifespanYears = 3; // Assume 3 year customer lifespan
  const purchasesPerYear = avgDaysBetweenPurchases > 0 ? 365 / avgDaysBetweenPurchases : 1;
  
  customerAnalytics.clv.predictedLTV = Math.round(
    customerAnalytics.clv.averageOrderValue * purchasesPerYear * estimatedLifespanYears * 100
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

  // Recency: Days since last purchase
  const lastOrder = orders[orders.length - 1];
  const daysSinceLastPurchase = Math.floor(
    (Date.now() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  customerAnalytics.rfm.recency = daysSinceLastPurchase;

  // Frequency: Total number of orders
  customerAnalytics.rfm.frequency = orders.length;

  // Monetary: Total amount spent
  const totalSpent = orders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);
  customerAnalytics.rfm.monetary = Math.round(totalSpent * 100) / 100;
};

// ============================================
// HELPER: Calculate Purchase Behavior
// ============================================
const calculatePurchaseBehavior = async (customerAnalytics, orders) => {
  if (orders.length === 0) return;

  // First and last purchase dates
  customerAnalytics.purchaseBehavior.firstPurchaseDate = orders[0].createdAt;
  customerAnalytics.purchaseBehavior.lastPurchaseDate = orders[orders.length - 1].createdAt;

  // Calculate average days between purchases
  if (orders.length > 1) {
    const daysBetween = [];
    for (let i = 1; i < orders.length; i++) {
      const days = Math.floor(
        (orders[i].createdAt.getTime() - orders[i - 1].createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      daysBetween.push(days);
    }
    const avgDays = daysBetween.reduce((sum, days) => sum + days, 0) / daysBetween.length;
    customerAnalytics.purchaseBehavior.avgDaysBetweenPurchases = Math.round(avgDays);
  }

  // Calculate purchase frequency (orders per month)
  const customerAgeDays = Math.floor(
    (Date.now() - orders[0].createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  const customerAgeMonths = customerAgeDays / 30;
  customerAnalytics.purchaseBehavior.purchaseFrequency = 
    Math.round((orders.length / customerAgeMonths) * 100) / 100;

  // Repeat purchase rate
  if (orders.length > 1) {
    customerAnalytics.purchaseBehavior.repeatPurchaseRate = 
      Math.round(((orders.length - 1) / orders.length) * 100 * 100) / 100;
  }

  // Favorite categories
  const categoryMap = new Map();
  orders.forEach(order => {
    order.orderItems?.forEach(item => {
      // Note: You'll need to populate product to get category
      // For now, we'll track by product name
      const key = item.name || 'Unknown';
      if (!categoryMap.has(key)) {
        categoryMap.set(key, { purchaseCount: 0, totalSpent: 0 });
      }
      const data = categoryMap.get(key);
      data.purchaseCount += 1;
      data.totalSpent += (item.price || 0) * (item.quantity || 0);
    });
  });

  // Convert to array and sort by purchase count
  customerAnalytics.purchaseBehavior.favoriteCategories = Array.from(categoryMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.purchaseCount - a.purchaseCount)
    .slice(0, 5);

  // Favorite products
  const productMap = new Map();
  orders.forEach(order => {
    order.orderItems?.forEach(item => {
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

  customerAnalytics.purchaseBehavior.favoriteProducts = Array.from(productMap.values())
    .sort((a, b) => b.purchaseCount - a.purchaseCount)
    .slice(0, 10);

  // Preferred payment method
  const paymentMethods = {};
  orders.forEach(order => {
    const method = order.paymentInfo?.method;
    if (method) {
      paymentMethods[method] = (paymentMethods[method] || 0) + 1;
    }
  });
  const preferredMethod = Object.keys(paymentMethods).reduce((a, b) => 
    paymentMethods[a] > paymentMethods[b] ? a : b
  , null);
  customerAnalytics.purchaseBehavior.preferredPaymentMethod = preferredMethod;

  // Average cart size
  const totalItems = orders.reduce((sum, order) => {
    return sum + (order.orderItems?.length || 0);
  }, 0);
  customerAnalytics.purchaseBehavior.avgCartSize = 
    Math.round((totalItems / orders.length) * 100) / 100;
};

// ============================================
// HELPER: Calculate Engagement Metrics
// ============================================
const calculateEngagementMetrics = async (customerAnalytics, userId) => {
  // Get user's wishlist count
  const user = await User.findById(userId).select('wishlist');
  customerAnalytics.engagement.wishlistItemsCount = user?.wishlist?.length || 0;

  // Get cart abandonment count
  const abandonedCarts = await Cart.countDocuments({
    user: userId,
    'abandonment.isAbandoned': true
  });
  customerAnalytics.engagement.cartAbandonments = abandonedCarts;

  // Note: For product views and site visits, you'd need to track these
  // in a separate sessions/events collection. For now, we'll use placeholders
  // that can be populated from your actual tracking system
};

// ============================================
// HELPER: Get Returns/Refunds Data
// ============================================
const getReturnsRefundsData = async (userId) => {
  const orders = await Order.find({
    user: userId,
    'paymentInfo.status': 'success'
  });

  const totalOrders = orders.length;
  let totalReturns = 0;
  let totalRefunds = 0;
  let totalRefundAmount = 0;

  orders.forEach(order => {
    // Count returns
    if (order.returnInfo?.status && 
        order.returnInfo.status !== 'none' && 
        order.returnInfo.status !== 'rejected') {
      totalReturns += 1;
    }

    // Count refunds
    if (order.refundInfo?.status && 
        order.refundInfo.status !== 'none' && 
        order.refundInfo.status !== 'rejected' &&
        order.refundInfo.status !== 'failed') {
      totalRefunds += 1;
      totalRefundAmount += order.refundInfo.refundAmount || 0;
    }
  });

  return {
    totalReturns,
    totalRefunds,
    totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
    returnRate: totalOrders > 0 ? Math.round((totalReturns / totalOrders) * 100 * 100) / 100 : 0,
    refundRate: totalOrders > 0 ? Math.round((totalRefunds / totalOrders) * 100 * 100) / 100 : 0
  };
};

// ============================================
// HELPER: Calculate Days Since Last Engagement
// ============================================
const calculateDaysSinceLastEngagement = (user) => {
  const lastLogin = user?.lastLogin;
  if (!lastLogin) return 999;

  return Math.floor((Date.now() - lastLogin.getTime()) / (1000 * 60 * 60 * 24));
};

// ============================================
// BULK SYNC ALL CUSTOMERS
// ============================================

/**
 * Sync analytics for all customers
 * Run this periodically (e.g., daily cron job)
 */
export const syncAllCustomerAnalytics = async () => {
  try {
    console.log('Starting bulk customer analytics sync...');

    // Get all users who have placed orders
    const userIds = await Order.distinct('user', {
      'paymentInfo.status': 'success'
    });

    console.log(`Found ${userIds.length} customers to sync`);

    let successCount = 0;
    let errorCount = 0;

    // Sync in batches to avoid overwhelming the system
    const batchSize = 50;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (userId) => {
          try {
            await syncCustomerAnalytics(userId);
            successCount++;
          } catch (error) {
            console.error(`Failed to sync customer ${userId}:`, error.message);
            errorCount++;
          }
        })
      );

      console.log(`Processed ${Math.min(i + batchSize, userIds.length)}/${userIds.length} customers`);
    }

    console.log(`Bulk sync completed: ${successCount} successful, ${errorCount} errors`);

    return {
      total: userIds.length,
      successful: successCount,
      errors: errorCount
    };
  } catch (error) {
    console.error('Error in bulk customer analytics sync:', error);
    throw error;
  }
};

// ============================================
// SYNC CUSTOMER AFTER ORDER
// ============================================

/**
 * Sync customer analytics after an order is completed
 * Call this in your order completion workflow
 */
export const syncCustomerAfterOrder = async (orderId) => {
  try {
    const order = await Order.findById(orderId);
    
    if (!order || !order.user) {
      throw new Error('Order or user not found');
    }

    await syncCustomerAnalytics(order.user);
    
    console.log(`Customer analytics synced for user ${order.user} after order ${orderId}`);
  } catch (error) {
    console.error(`Error syncing customer after order ${orderId}:`, error);
    throw error;
  }
};

// ============================================
// GET CUSTOMER ANALYTICS SUMMARY
// ============================================

/**
 * Get overall customer analytics summary
 */
export const getCustomerAnalyticsSummary = async () => {
  try {
    const summary = await CustomerAnalytics.aggregate([
      {
        $facet: {
          // Segment distribution
          segments: [
            {
              $group: {
                _id: '$rfm.segment',
                count: { $sum: 1 },
                totalRevenue: { $sum: '$clv.totalRevenue' },
                avgRevenue: { $avg: '$clv.totalRevenue' }
              }
            },
            { $sort: { totalRevenue: -1 } }
          ],

          // Value tier distribution
          valueTiers: [
            {
              $group: {
                _id: '$valueTier',
                count: { $sum: 1 },
                totalRevenue: { $sum: '$clv.totalRevenue' }
              }
            },
            { $sort: { totalRevenue: -1 } }
          ],

          // Churn risk distribution
          churnRisk: [
            {
              $group: {
                _id: '$risk.churnPrediction',
                count: { $sum: 1 }
              }
            }
          ],

          // Overall metrics
          overall: [
            {
              $group: {
                _id: null,
                totalCustomers: { $sum: 1 },
                totalRevenue: { $sum: '$clv.totalRevenue' },
                avgCLV: { $avg: '$clv.totalRevenue' },
                avgOrders: { $avg: '$clv.totalOrders' },
                avgAOV: { $avg: '$clv.averageOrderValue' },
                vipCount: { $sum: { $cond: ['$isVIP', 1, 0] } },
                atRiskCount: { $sum: { $cond: ['$risk.isAtRisk', 1, 0] } }
              }
            }
          ]
        }
      }
    ]);

    return summary[0];
  } catch (error) {
    console.error('Error getting customer analytics summary:', error);
    throw error;
  }
};

export default {
  syncCustomerAnalytics,
  syncAllCustomerAnalytics,
  syncCustomerAfterOrder,
  getCustomerAnalyticsSummary
};