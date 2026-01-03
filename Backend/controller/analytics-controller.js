import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import User from '../models/user-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';

// Get Admin Dashboard Stats with Analytics
export const getAdminStats = handleAsyncError(async (req, res, next) => {
    // Get all products
    const products = await Product.find();
    const totalProducts = products.length;

    // Get stock counts
    const outOfStock = products.filter(product => product.stock === 0).length;
    const inStock = totalProducts - outOfStock;

    // Get all orders
    const orders = await Order.find();
    const totalOrders = orders.length;

    // Calculate total revenue
    const totalRevenue = orders
        .filter(order => order.orderStatus !== 'Cancelled')
        .reduce((sum, order) => sum + order.totalPrice, 0);

    // Get all users
    const users = await User.find();
    const totalUsers = users.length;

    // Get admin count
    const adminCount = users.filter(user => user.role === 'admin').length;

    res.status(200).json({
        success: true,
        products: totalProducts,
        orders: totalOrders,
        revenue: totalRevenue,
        users: totalUsers,
        outOfStock,
        inStock,
        adminCount
    });
});

// Get Advanced Analytics with Trends
export const getAnalytics = handleAsyncError(async (req, res, next) => {
    const { timeframe = 'month' } = req.query;

    // Calculate date ranges
    const now = new Date();
    let currentPeriodStart, previousPeriodStart, previousPeriodEnd;

    switch (timeframe) {
        case 'week':
            currentPeriodStart = new Date(now.setDate(now.getDate() - 7));
            previousPeriodStart = new Date(now.setDate(now.getDate() - 14));
            previousPeriodEnd = new Date(currentPeriodStart);
            break;
        case 'year':
            currentPeriodStart = new Date(now.setFullYear(now.getFullYear() - 1));
            previousPeriodStart = new Date(now.setFullYear(now.getFullYear() - 2));
            previousPeriodEnd = new Date(currentPeriodStart);
            break;
        case 'month':
        default:
            currentPeriodStart = new Date(now.setMonth(now.getMonth() - 1));
            previousPeriodStart = new Date(now.setMonth(now.getMonth() - 2));
            previousPeriodEnd = new Date(currentPeriodStart);
            break;
    }

    // Get current period data
    const currentOrders = await Order.find({
        createdAt: { $gte: currentPeriodStart }
    });

    const currentRevenue = currentOrders
        .filter(order => order.orderStatus !== 'Cancelled')
        .reduce((sum, order) => sum + order.totalPrice, 0);

    const currentUsers = await User.countDocuments({
        createdAt: { $gte: currentPeriodStart }
    });

    const currentProducts = await Product.countDocuments({
        createdAt: { $gte: currentPeriodStart }
    });

    // Get previous period data
    const previousOrders = await Order.find({
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    });

    const previousRevenue = previousOrders
        .filter(order => order.orderStatus !== 'Cancelled')
        .reduce((sum, order) => sum + order.totalPrice, 0);

    const previousUsers = await User.countDocuments({
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    });

    const previousProducts = await Product.countDocuments({
        createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
    });

    // Calculate percentage changes
    const calculateTrend = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
    };

    const trends = {
        revenue: calculateTrend(currentRevenue, previousRevenue),
        orders: calculateTrend(currentOrders.length, previousOrders.length),
        users: calculateTrend(currentUsers, previousUsers),
        products: calculateTrend(currentProducts, previousProducts)
    };

    // Get order status breakdown
    const allOrders = await Order.find();
    const orderStatusBreakdown = {
        processing: allOrders.filter(o => o.orderStatus === 'Processing').length,
        shipped: allOrders.filter(o => o.orderStatus === 'Shipped').length,
        delivered: allOrders.filter(o => o.orderStatus === 'Delivered').length,
        cancelled: allOrders.filter(o => o.orderStatus === 'Cancelled').length
    };

    // Get top products by revenue
    const productRevenue = {};
    allOrders.forEach(order => {
        if (order.orderStatus !== 'Cancelled') {
            order.orderItems.forEach(item => {
                const productId = item.product.toString();
                if (!productRevenue[productId]) {
                    productRevenue[productId] = {
                        name: item.name,
                        revenue: 0,
                        quantity: 0
                    };
                }
                productRevenue[productId].revenue += item.price * item.quantity;
                productRevenue[productId].quantity += item.quantity;
            });
        }
    });

    const topProducts = Object.values(productRevenue)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

    // Get recent activity (last 5 orders)
    const recentOrders = await Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name email');

    res.status(200).json({
        success: true,
        trends,
        orderStatusBreakdown,
        topProducts,
        recentOrders,
        currentPeriod: {
            orders: currentOrders.length,
            revenue: currentRevenue,
            users: currentUsers,
            products: currentProducts
        },
        previousPeriod: {
            orders: previousOrders.length,
            revenue: previousRevenue,
            users: previousUsers,
            products: previousProducts
        }
    });
});

// Get Revenue Chart Data (last 7 days, 30 days, or 12 months)
export const getRevenueChartData = handleAsyncError(async (req, res, next) => {
    const { timeframe = 'week' } = req.query;
    const now = new Date();
    let startDate, groupBy;

    switch (timeframe) {
        case 'week':
            startDate = new Date(now.setDate(now.getDate() - 7));
            groupBy = 'day';
            break;
        case 'year':
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
            groupBy = 'month';
            break;
        case 'month':
        default:
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            groupBy = 'day';
            break;
    }

    const orders = await Order.find({
        createdAt: { $gte: startDate },
        orderStatus: { $ne: 'Cancelled' }
    });

    // Group revenue by time period
    const revenueData = {};
    orders.forEach(order => {
        let key;
        const date = new Date(order.createdAt);

        if (groupBy === 'day') {
            key = date.toISOString().split('T')[0]; // YYYY-MM-DD
        } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        }

        if (!revenueData[key]) {
            revenueData[key] = 0;
        }
        revenueData[key] += order.totalPrice;
    });

    // Convert to array and sort
    const chartData = Object.entries(revenueData)
        .map(([date, revenue]) => ({
            date,
            revenue: Number(revenue.toFixed(2))
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({
        success: true,
        chartData
    });
});