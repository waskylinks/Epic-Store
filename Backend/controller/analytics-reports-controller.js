import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { validateTimeframe } from "../utils/validateTimeframe.js";
import { getDateRanges } from "../utils/dateRanges.js";
import Order from "../models/order-model.js";
import Product from "../models/product-model.js";
import User from "../models/userModel.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";
import { ORDER_STATUSES } from "../constants/analytics.constants.js";

/**
 * Analytics Reports Controller
 * Generates comprehensive, exportable reports
 */

// ============================================
// COMPREHENSIVE BUSINESS REPORT
// ============================================

/**
 * Generate comprehensive business performance report
 * @route GET /api/v1/analytics/reports/business-performance
 * @access Admin
 */
export const generateBusinessPerformanceReport = handleAsyncError(async (req, res, next) => {
  const { 
    timeframe = "month",
    startDate,
    endDate 
  } = req.query;

  let periodStart, periodEnd;

  if (startDate && endDate) {
    periodStart = new Date(startDate);
    periodEnd = new Date(endDate);
  } else {
    validateTimeframe(timeframe, next);
    const ranges = getDateRanges(timeframe);
    periodStart = ranges.currentPeriodStart;
    periodEnd = new Date();
  }

  // Collect all report data
  const [
    executiveSummary,
    revenueAnalysis,
    salesAnalysis,
    customerAnalysis,
    productAnalysis,
    operationalMetrics
  ] = await Promise.all([
    getExecutiveSummary(periodStart, periodEnd),
    getRevenueAnalysis(periodStart, periodEnd),
    getSalesAnalysis(periodStart, periodEnd),
    getCustomerAnalysis(periodStart, periodEnd),
    getProductAnalysis(periodStart, periodEnd),
    getOperationalMetrics(periodStart, periodEnd)
  ]);

  const report = {
    reportType: 'Business Performance Report',
    period: {
      start: periodStart,
      end: periodEnd,
      label: timeframe
    },
    generatedAt: new Date(),
    sections: {
      executiveSummary,
      revenueAnalysis,
      salesAnalysis,
      customerAnalysis,
      productAnalysis,
      operationalMetrics
    }
  };

  res.status(200).json({
    success: true,
    report
  });
});

// ============================================
// SALES REPORT
// ============================================

/**
 * Generate detailed sales report
 * @route GET /api/v1/analytics/reports/sales
 * @access Admin
 */
export const generateSalesReport = handleAsyncError(async (req, res, next) => {
  const { 
    timeframe = "month",
    startDate,
    endDate,
    groupBy = "day"
  } = req.query;

  let periodStart, periodEnd;

  if (startDate && endDate) {
    periodStart = new Date(startDate);
    periodEnd = new Date(endDate);
  } else {
    validateTimeframe(timeframe, next);
    const ranges = getDateRanges(timeframe);
    periodStart = ranges.currentPeriodStart;
    periodEnd = new Date();
  }

  // Determine date grouping format
  const dateFormat = getDateFormat(groupBy);

  const salesData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: periodStart, $lte: periodEnd },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    {
      $group: {
        _id: dateFormat,
        revenue: { $sum: '$totalPrice' },
        orders: { $sum: 1 },
        avgOrderValue: { $avg: '$totalPrice' },
        totalItems: { $sum: { $size: '$orderItems' } },
        customers: { $addToSet: '$user' }
      }
    },
    {
      $project: {
        date: '$_id',
        revenue: { $round: ['$revenue', 2] },
        orders: 1,
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        totalItems: 1,
        uniqueCustomers: { $size: '$customers' }
      }
    },
    { $sort: { date: 1 } }
  ]);

  // Get payment method breakdown
  const paymentMethodBreakdown = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: periodStart, $lte: periodEnd },
        'paymentInfo.status': 'success'
      }
    },
    {
      $group: {
        _id: '$paymentInfo.method',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalPrice' }
      }
    },
    {
      $project: {
        method: '$_id',
        count: 1,
        totalAmount: { $round: ['$totalAmount', 2] }
      }
    }
  ]);

  // Get status breakdown
  const statusBreakdown = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: periodStart, $lte: periodEnd }
      }
    },
    {
      $group: {
        _id: '$orderStatus',
        count: { $sum: 1 },
        totalValue: { $sum: '$totalPrice' }
      }
    }
  ]);

  const report = {
    reportType: 'Sales Report',
    period: {
      start: periodStart,
      end: periodEnd,
      groupBy
    },
    generatedAt: new Date(),
    summary: {
      totalRevenue: salesData.reduce((sum, item) => sum + item.revenue, 0),
      totalOrders: salesData.reduce((sum, item) => sum + item.orders, 0),
      avgOrderValue: salesData.length > 0 
        ? salesData.reduce((sum, item) => sum + item.avgOrderValue, 0) / salesData.length 
        : 0,
      totalUniqueCustomers: new Set(salesData.flatMap(item => item.uniqueCustomers)).size
    },
    salesData,
    paymentMethodBreakdown,
    statusBreakdown
  };

  res.status(200).json({
    success: true,
    report
  });
});

// ============================================
// CUSTOMER REPORT
// ============================================

/**
 * Generate customer analytics report
 * @route GET /api/v1/analytics/reports/customers
 * @access Admin
 */
export const generateCustomerReport = handleAsyncError(async (req, res, next) => {
  const { includeDetails = false } = req.query;

  // Get customer segments
  const segmentDistribution = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: '$rfm.segment',
        count: { $sum: 1 },
        totalRevenue: { $sum: '$clv.totalRevenue' },
        avgRevenue: { $avg: '$clv.totalRevenue' },
        avgOrders: { $avg: '$clv.totalOrders' }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ]);

  // Get value tier distribution
  const valueTierDistribution = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: '$valueTier',
        count: { $sum: 1 },
        totalRevenue: { $sum: '$clv.totalRevenue' }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ]);

  // Get churn risk distribution
  const churnRiskDistribution = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: '$risk.churnPrediction',
        count: { $sum: 1 }
      }
    }
  ]);

  // Get acquisition source performance
  const acquisitionSources = await CustomerAnalytics.aggregate([
    {
      $group: {
        _id: '$acquisition.source',
        customers: { $sum: 1 },
        totalRevenue: { $sum: '$clv.totalRevenue' },
        avgCLV: { $avg: '$clv.totalRevenue' }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ]);

  // Calculate overall metrics
  const overallMetrics = await CustomerAnalytics.aggregate([
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
  ]);

  let customerDetails = null;
  if (includeDetails === 'true') {
    // Get top 50 customers by revenue
    customerDetails = await CustomerAnalytics.find()
      .populate('user', 'firstName lastName email')
      .sort({ 'clv.totalRevenue': -1 })
      .limit(50)
      .select('user clv rfm valueTier risk');
  }

  const report = {
    reportType: 'Customer Analytics Report',
    generatedAt: new Date(),
    summary: overallMetrics[0] || {},
    segmentDistribution,
    valueTierDistribution,
    churnRiskDistribution,
    acquisitionSources,
    customerDetails
  };

  res.status(200).json({
    success: true,
    report
  });
});

// ============================================
// PRODUCT PERFORMANCE REPORT
// ============================================

/**
 * Generate product performance report
 * @route GET /api/v1/analytics/reports/products
 * @access Admin
 */
export const generateProductReport = handleAsyncError(async (req, res, next) => {
  const { 
    timeframe = "month",
    startDate,
    endDate 
  } = req.query;

  let periodStart, periodEnd;

  if (startDate && endDate) {
    periodStart = new Date(startDate);
    periodEnd = new Date(endDate);
  } else {
    validateTimeframe(timeframe, next);
    const ranges = getDateRanges(timeframe);
    periodStart = ranges.currentPeriodStart;
    periodEnd = new Date();
  }

  // Get top products by revenue
  const topProductsByRevenue = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: periodStart, $lte: periodEnd },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    { $unwind: '$orderItems' },
    {
      $group: {
        _id: '$orderItems.product',
        productName: { $first: '$orderItems.name' },
        revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
        unitsSold: { $sum: '$orderItems.quantity' },
        orders: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 50 },
    {
      $project: {
        productName: 1,
        revenue: { $round: ['$revenue', 2] },
        unitsSold: 1,
        orders: 1,
        avgPricePerUnit: { $round: [{ $divide: ['$revenue', '$unitsSold'] }, 2] }
      }
    }
  ]);

  // Get category performance
  const categoryPerformance = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: periodStart, $lte: periodEnd },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    { $unwind: '$orderItems' },
    {
      $lookup: {
        from: 'products',
        localField: 'orderItems.product',
        foreignField: '_id',
        as: 'productDetails'
      }
    },
    { $unwind: '$productDetails' },
    {
      $group: {
        _id: '$productDetails.category',
        revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
        unitsSold: { $sum: '$orderItems.quantity' },
        uniqueProducts: { $addToSet: '$orderItems.product' }
      }
    },
    {
      $project: {
        category: '$_id',
        revenue: { $round: ['$revenue', 2] },
        unitsSold: 1,
        productCount: { $size: '$uniqueProducts' }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  // Get inventory status
  const inventoryStatus = await Product.aggregate([
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        publishedProducts: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ['$inventory.stock', 0] },
                  { $lte: ['$inventory.stock', '$inventory.lowStockThreshold'] }
                ]
              },
              1,
              0
            ]
          }
        },
        outOfStock: { $sum: { $cond: [{ $eq: ['$inventory.stock', 0] }, 1, 0] } }
      }
    }
  ]);

  const report = {
    reportType: 'Product Performance Report',
    period: {
      start: periodStart,
      end: periodEnd
    },
    generatedAt: new Date(),
    topProducts: topProductsByRevenue,
    categoryPerformance,
    inventoryStatus: inventoryStatus[0] || {},
    summary: {
      totalRevenue: topProductsByRevenue.reduce((sum, p) => sum + p.revenue, 0),
      totalUnitsSold: topProductsByRevenue.reduce((sum, p) => sum + p.unitsSold, 0)
    }
  };

  res.status(200).json({
    success: true,
    report
  });
});

// ============================================
// FINANCIAL REPORT
// ============================================

/**
 * Generate financial summary report
 * @route GET /api/v1/analytics/reports/financial
 * @access Admin
 */
export const generateFinancialReport = handleAsyncError(async (req, res, next) => {
  const { 
    timeframe = "month",
    startDate,
    endDate 
  } = req.query;

  let periodStart, periodEnd;

  if (startDate && endDate) {
    periodStart = new Date(startDate);
    periodEnd = new Date(endDate);
  } else {
    validateTimeframe(timeframe, next);
    const ranges = getDateRanges(timeframe);
    periodStart = ranges.currentPeriodStart;
    periodEnd = new Date();
  }

  // Get revenue and profit data
  const financialData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: periodStart, $lte: periodEnd },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalPrice' },
        totalProfit: { $sum: '$profitAnalysis.netProfit' },
        shippingRevenue: { $sum: '$shippingPrice' },
        taxCollected: { $sum: '$taxPrice' },
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  // Get refund data
  const refundData = await Order.aggregate([
    {
      $match: {
        'refundInfo.refundedAt': { $gte: periodStart, $lte: periodEnd },
        'refundInfo.status': 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalRefunded: { $sum: '$refundInfo.refundAmount' },
        refundCount: { $sum: 1 }
      }
    }
  ]);

  const financial = financialData[0] || {
    totalRevenue: 0,
    totalProfit: 0,
    shippingRevenue: 0,
    taxCollected: 0,
    totalOrders: 0
  };

  const refunds = refundData[0] || {
    totalRefunded: 0,
    refundCount: 0
  };

  // Calculate metrics
  const netRevenue = financial.totalRevenue - refunds.totalRefunded;
  const profitMargin = financial.totalRevenue > 0 
    ? (financial.totalProfit / financial.totalRevenue) * 100 
    : 0;

  const report = {
    reportType: 'Financial Report',
    period: {
      start: periodStart,
      end: periodEnd
    },
    generatedAt: new Date(),
    revenue: {
      gross: Math.round(financial.totalRevenue * 100) / 100,
      net: Math.round(netRevenue * 100) / 100,
      shipping: Math.round(financial.shippingRevenue * 100) / 100,
      tax: Math.round(financial.taxCollected * 100) / 100
    },
    profit: {
      total: Math.round(financial.totalProfit * 100) / 100,
      margin: Math.round(profitMargin * 100) / 100
    },
    refunds: {
      total: Math.round(refunds.totalRefunded * 100) / 100,
      count: refunds.refundCount,
      rate: financial.totalOrders > 0 
        ? Math.round((refunds.refundCount / financial.totalOrders) * 100 * 100) / 100 
        : 0
    },
    orderCount: financial.totalOrders
  };

  res.status(200).json({
    success: true,
    report
  });
});

// ============================================
// EXPORT REPORT DATA (CSV FORMAT)
// ============================================

/**
 * Export report data in CSV format
 * @route GET /api/v1/analytics/reports/export/csv
 * @access Admin
 */
export const exportReportCSV = handleAsyncError(async (req, res, next) => {
  const { 
    reportType,
    timeframe = "month",
    startDate,
    endDate 
  } = req.query;

  if (!reportType) {
    return next(new HandleError('Report type is required', 400));
  }

  let periodStart, periodEnd;

  if (startDate && endDate) {
    periodStart = new Date(startDate);
    periodEnd = new Date(endDate);
  } else {
    validateTimeframe(timeframe, next);
    const ranges = getDateRanges(timeframe);
    periodStart = ranges.currentPeriodStart;
    periodEnd = new Date();
  }

  let csvData;
  let filename;

  switch (reportType) {
    case 'sales':
      csvData = await generateSalesCSV(periodStart, periodEnd);
      filename = `sales-report-${periodStart.toISOString().split('T')[0]}.csv`;
      break;
    case 'products':
      csvData = await generateProductsCSV(periodStart, periodEnd);
      filename = `products-report-${periodStart.toISOString().split('T')[0]}.csv`;
      break;
    case 'customers':
      csvData = await generateCustomersCSV();
      filename = `customers-report-${new Date().toISOString().split('T')[0]}.csv`;
      break;
    default:
      return next(new HandleError('Invalid report type', 400));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csvData);
});

// ============================================
// HELPER FUNCTIONS
// ============================================

const getExecutiveSummary = async (startDate, endDate) => {
  const [revenue, orders, customers] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
          'paymentInfo.status': 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPrice' },
          totalProfit: { $sum: '$profitAnalysis.netProfit' }
        }
      }
    ]),
    Order.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    }),
    Order.distinct('user', {
      createdAt: { $gte: startDate, $lte: endDate },
      'paymentInfo.status': 'success'
    })
  ]);

  return {
    totalRevenue: Math.round((revenue[0]?.totalRevenue || 0) * 100) / 100,
    totalProfit: Math.round((revenue[0]?.totalProfit || 0) * 100) / 100,
    totalOrders: orders,
    uniqueCustomers: customers.length,
    avgOrderValue: orders > 0 ? Math.round(((revenue[0]?.totalRevenue || 0) / orders) * 100) / 100 : 0
  };
};

const getRevenueAnalysis = async (startDate, endDate) => {
  const analysis = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalPrice' },
        shippingRevenue: { $sum: '$shippingPrice' },
        taxRevenue: { $sum: '$taxPrice' },
        productRevenue: { $sum: '$itemsPrice' }
      }
    }
  ]);

  return analysis[0] || {
    totalRevenue: 0,
    shippingRevenue: 0,
    taxRevenue: 0,
    productRevenue: 0
  };
};

const getSalesAnalysis = async (startDate, endDate) => {
  const [ordersByStatus, ordersByPaymentMethod] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$orderStatus',
          count: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          'paymentInfo.status': 'success'
        }
      },
      {
        $group: {
          _id: '$paymentInfo.method',
          count: { $sum: 1 },
          revenue: { $sum: '$totalPrice' }
        }
      }
    ])
  ]);

  return {
    byStatus: ordersByStatus,
    byPaymentMethod: ordersByPaymentMethod
  };
};

const getCustomerAnalysis = async (startDate, endDate) => {
  const [newCustomers, returningCustomers] = await Promise.all([
    User.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    }),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          'paymentInfo.status': 'success'
        }
      },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 }
        }
      },
      {
        $match: {
          orderCount: { $gt: 1 }
        }
      },
      {
        $count: 'returning'
      }
    ])
  ]);

  return {
    newCustomers,
    returningCustomers: returningCustomers[0]?.returning || 0
  };
};

const getProductAnalysis = async (startDate, endDate) => {
  const topProducts = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    { $unwind: '$orderItems' },
    {
      $group: {
        _id: '$orderItems.product',
        revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
        unitsSold: { $sum: '$orderItems.quantity' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 }
  ]);

  return { topProducts };
};

const getOperationalMetrics = async (startDate, endDate) => {
  const [fulfillment, returns] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          orderStatus: 'Delivered',
          deliveredAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $project: {
          fulfillmentTime: {
            $divide: [
              { $subtract: ['$deliveredAt', '$createdAt'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgFulfillmentDays: { $avg: '$fulfillmentTime' }
        }
      }
    ]),
    Order.countDocuments({
      'returnInfo.requestedAt': { $gte: startDate, $lte: endDate },
      'returnInfo.status': { $ne: 'none' }
    })
  ]);

  return {
    avgFulfillmentDays: Math.round((fulfillment[0]?.avgFulfillmentDays || 0) * 10) / 10,
    totalReturns: returns
  };
};

const getDateFormat = (groupBy) => {
  switch (groupBy) {
    case 'hour':
      return { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } };
    case 'week':
      return { $dateToString: { format: "%Y-W%V", date: "$createdAt" } };
    case 'month':
      return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
    default:
      return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  }
};

const generateSalesCSV = async (startDate, endDate) => {
  const orders = await Order.find({
    createdAt: { $gte: startDate, $lte: endDate }
  })
    .populate('user', 'firstName lastName email')
    .select('_id user totalPrice orderStatus paymentInfo createdAt')
    .lean();

  let csv = 'Order ID,Customer Name,Email,Total,Status,Payment Method,Date\n';
  
  orders.forEach(order => {
    const customerName = order.user ? `${order.user.firstName} ${order.user.lastName}` : 'N/A';
    const email = order.user?.email || 'N/A';
    csv += `${order._id},"${customerName}","${email}",${order.totalPrice},${order.orderStatus},${order.paymentInfo?.method || 'N/A'},${order.createdAt.toISOString()}\n`;
  });

  return csv;
};

const generateProductsCSV = async (startDate, endDate) => {
  const products = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        orderStatus: { $ne: ORDER_STATUSES.CANCELLED },
        'paymentInfo.status': 'success'
      }
    },
    { $unwind: '$orderItems' },
    {
      $group: {
        _id: '$orderItems.product',
        productName: { $first: '$orderItems.name' },
        revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
        unitsSold: { $sum: '$orderItems.quantity' }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  let csv = 'Product ID,Product Name,Revenue,Units Sold\n';
  
  products.forEach(product => {
    csv += `${product._id},"${product.productName}",${product.revenue.toFixed(2)},${product.unitsSold}\n`;
  });

  return csv;
};

const generateCustomersCSV = async () => {
  const customers = await CustomerAnalytics.find()
    .populate('user', 'firstName lastName email')
    .select('user clv rfm valueTier')
    .lean();

  let csv = 'Customer Name,Email,Total Revenue,Total Orders,AOV,RFM Segment,Value Tier\n';
  
  customers.forEach(customer => {
    const name = customer.user ? `${customer.user.firstName} ${customer.user.lastName}` : 'N/A';
    const email = customer.user?.email || 'N/A';
    csv += `"${name}","${email}",${customer.clv?.totalRevenue || 0},${customer.clv?.totalOrders || 0},${customer.clv?.averageOrderValue || 0},"${customer.rfm?.segment || 'N/A'}","${customer.valueTier || 'N/A'}"\n`;
  });

  return csv;
};

export default {
  generateBusinessPerformanceReport,
  generateSalesReport,
  generateCustomerReport,
  generateProductReport,
  generateFinancialReport,
  exportReportCSV
};