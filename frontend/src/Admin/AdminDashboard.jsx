import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import Footer from '../components/footer';
import Navbar from '../components/Navbar';
import '../AdminStyles/Dashboard.css';
import { 
    AddBox, 
    AttachMoney, 
    CheckCircle, 
    Dashboard as DashboardIcon, 
    Error, 
    Inventory, 
    People, 
    RateReview,
    ShoppingCart,
    TrendingUp,
    TrendingDown,
    Menu as MenuIcon,
    Close as CloseIcon,
    LocalShipping,
    Cancel,
    HourglassEmpty,
    MoneyOff
} from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdminStats, fetchAnalytics } from '../features/admin/adminSlice';
import { 
    AreaChart, Area, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';

function AdminDashboard() {
    const location = useLocation();
    const dispatch = useDispatch();
    const { stats, analytics, loading, error, analyticsLoading } = useSelector(state => state.admin);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [timeframe, setTimeframe] = useState('month');

    useEffect(() => {
        dispatch(fetchAdminStats());
        dispatch(fetchAnalytics(timeframe));
    }, [dispatch, timeframe]);

    const isActive = (path) => location.pathname === path;

    const statCards = [
        { title: 'Total Revenue', value: stats?.revenue ? `${Number(stats.revenue).toFixed(2)}` : '$0.00', icon: AttachMoney, color: '#10b981', trend: analytics?.trends?.revenue || 0 },
        { title: 'Total Orders', value: stats?.orders ?? 0, icon: ShoppingCart, color: '#3b82f6', trend: analytics?.trends?.orders || 0 },
        { title: 'Total Products', value: stats?.products ?? 0, icon: Inventory, color: '#7c3aed', trend: analytics?.trends?.products || 0 },
        { title: 'Total Users', value: stats?.users ?? 0, icon: People, color: '#f59e0b', trend: analytics?.trends?.users || 0 },
    ];

    const stockStats = [
        { title: 'In Stock', value: stats?.inStock ?? 0, icon: CheckCircle, color: '#d4af37', percentage: stats?.products > 0 ? ((stats?.inStock / stats?.products) * 100).toFixed(1) : 0 },
        { title: 'Out of Stock', value: stats?.outOfStock ?? 0, icon: Error, color: '#ef4444', percentage: stats?.products > 0 ? ((stats?.outOfStock / stats?.products) * 100).toFixed(1) : 0 }
    ];

    const orderStatusStats = [
        { status: 'Processing', count: analytics?.orderStatusBreakdown?.processing ?? 0, icon: HourglassEmpty, color: '#d4af37' },
        { status: 'Shipped', count: analytics?.orderStatusBreakdown?.shipped ?? 0, icon: LocalShipping, color: '#6b7280' },
        { status: 'Delivered', count: analytics?.orderStatusBreakdown?.delivered ?? 0, icon: CheckCircle, color: '#d4af37' },
        { status: 'Cancelled', count: analytics?.orderStatusBreakdown?.cancelled ?? 0, icon: Cancel, color: '#ef4444' },
    ];

    const categoryColors = ['#d4af37', '#3b82f6', '#7c3aed', '#10b981', '#ef4444'];
    const categorySalesData =
        analytics?.topProducts?.slice(0, 5).map((product, index) => ({
            name: product.name || 'Product',
            value: Number(product.revenue) || 0,
            color: categoryColors[index % categoryColors.length],
    })) || [];

    const revenueData = analytics?.recentOrders?.slice(0, 7).map((order) => ({
        date: new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: parseFloat(order.totalPrice) || 0,
        orders: 1
    })) || [];

    const renderCustomLabel = ({ cx, cy, midAngle,outerRadius, name, percent }) => {
        const RADIAN = Math.PI / 180;
        const radius = outerRadius + 30;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        return (
            <text 
                x={x} 
                y={y} 
                fill="#1a1a1a" 
                textAnchor={x > cx ? 'start' : 'end'} 
                dominantBaseline="central"
                style={{ fontSize: '13px', fontWeight: '600' }}
            >
                {`${name.length > 20 ? name.substring(0, 20) + '...' : name} (${(percent * 100).toFixed(0)}%)`}
            </text>
        );
    };

    return (
    <>
    <PageTitle title="Admin Dashboard" />
    <Navbar />

    <button className="mobile-menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? <CloseIcon /> : <MenuIcon />}
    </button>

    <div className="dashboard-wrapper">
        <div className={`dashboard-sidebar ${sidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <DashboardIcon className="sidebar-logo-icon" />
                <span>Admin Panel</span>
            </div>

            <nav className="sidebar-nav">
                <div className="nav-group">
                    <h4>Overview</h4>
                    <Link 
                        to="/admin/dashboard" 
                        className={isActive('/admin/dashboard') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <DashboardIcon className="nav-item-icon" />
                        <span>Dashboard</span>
                    </Link>
                </div>

                <div className="nav-group">
                    <h4>Products</h4>
                    <Link 
                        to="/admin/products" 
                        className={isActive('/admin/products') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <Inventory className="nav-item-icon" />
                        <span>All Products</span>
                    </Link>
                    <Link 
                        to="/admin/products/create" 
                        className={isActive('/admin/products/create') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <AddBox className="nav-item-icon" />
                        <span>Create Product</span>
                    </Link>
                </div>

                <div className="nav-group">
                    <h4>Orders</h4>
                    <Link 
                        to="/admin/orders" 
                        className={isActive('/admin/orders') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <ShoppingCart className="nav-item-icon" />
                        <span>All Orders</span>
                    </Link>
                </div>

                <div className="nav-group">
                    <h4>Users</h4>
                    <Link 
                        to="/admin/users" 
                        className={isActive('/admin/users') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <People className="nav-item-icon" />
                        <span>All Users</span>
                    </Link>
                </div>

                <div className="nav-group">
                    <h4>Refunds</h4>
                    <Link 
                        to="/admin/refunds" 
                        className={isActive('/admin/refunds') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <MoneyOff className="nav-item-icon" />
                        <span>Manage Refunds</span>
                    </Link>
                </div>

                <div className="nav-group">
                    <h4>Reviews</h4>
                    <Link 
                        to="/admin/reviews" 
                        className={isActive('/admin/reviews') ? 'nav-item active' : 'nav-item'}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <RateReview className="nav-item-icon" />
                        <span>All Reviews</span>
                    </Link>
                </div>
            </nav>
        </div>

        <main className="dashboard-main">
            <div className="dashboard-header">
                <div>
                    <h1 className="dashboard-title">Dashboard Overview</h1>
                    <p className="dashboard-subtitle">Welcome back! Here&apos;s what&apos;s happening today.</p>
                </div>
                
                <div className="timeframe-selector">
                    <button 
                        className={timeframe === 'day' ? 'active' : ''} 
                        onClick={() => setTimeframe('day')}
                    >
                        Day
                    </button>
                    
                    <button 
                        className={timeframe === 'week' ? 'active' : ''} 
                        onClick={() => setTimeframe('week')}
                    >
                        Week
                    </button>
                    <button 
                        className={timeframe === 'month' ? 'active' : ''} 
                        onClick={() => setTimeframe('month')}
                    >
                        Month
                    </button>
                    <button 
                        className={timeframe === 'year' ? 'active' : ''} 
                        onClick={() => setTimeframe('year')}
                    >
                        Year
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-banner">
                    <Error /> Error loading stats: {error}
                </div>
            )}

            <div className="stats-grid">
                {statCards.map((stat, index) => (
                    <div key={index} className="stat-card modern">
                        <div className="stat-card-header">
                            <div 
                                className="stat-icon" 
                                style={{ backgroundColor: `${stat.color}20`, color: stat.color }}
                            >
                                <stat.icon className="icon" />
                            </div>
                            <div className={`trend-badge ${stat.trend >= 0 ? 'positive' : 'negative'}`}>
                                {stat.trend >= 0 ? <TrendingUp fontSize="small" /> : <TrendingDown fontSize="small" />}
                                {Math.abs(stat.trend)}%
                            </div>
                        </div>
                        <div className="stat-info">
                            <h3>{stat.title}</h3>
                            <p className="stat-value">
                                {loading ? <span className="loading-shimmer">Loading...</span> : stat.value}
                            </p>
                            <span className="stat-description">vs last {timeframe}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts Section */}
            <div className="charts-container">
                <div className="chart-card">
                    <div className="chart-header">
                        <div>
                            <h3 className="chart-title">Revenue Overview</h3>
                            <p className="chart-subtitle">Track your sales performance</p>
                        </div>
                    </div>
                    {analyticsLoading ? (
                        <div className="chart-loading">Loading chart...</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={350}>
                            <AreaChart data={revenueData}>
                                <defs>
                                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#d4af37" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#d4af37" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="date" stroke="#64748b" style={{fontSize: 12}} />
                                <YAxis stroke="#64748b" style={{fontSize: 12}} />
                                <Tooltip 
                                    contentStyle={{
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: 8,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="revenue" 
                                    stroke="#d4af37" 
                                    strokeWidth={3}
                                    fillOpacity={1} 
                                    fill="url(#colorRevenue)" 
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                <div className="chart-card">
                    <div className="chart-header">
                        <div>
                            <h3 className="chart-title">Top Products</h3>
                            <p className="chart-subtitle">Best selling items</p>
                        </div>
                    </div>
                    {analyticsLoading ? (
                        <div className="chart-loading">Loading chart...</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={350}>
                            <PieChart>
                                <Pie
                                    data={categorySalesData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={{ stroke: '#1a1a1a', strokeWidth: 1 }}
                                    label={renderCustomLabel}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {categorySalesData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    contentStyle={{
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: 8,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            <div className="secondary-stats">
                <h2 className="section-title">Inventory Status</h2>
                <div className="stock-grid">
                    {stockStats.map((stock, index) => (
                        <div key={index} className="stock-card">
                            <div className="stock-header">
                                <div className="stock-icon-wrapper" style={{backgroundColor: `${stock.color}20`}}>
                                    <stock.icon style={{ color: stock.color, fontSize: '2rem' }} />
                                </div>
                                <span className="stock-percentage" style={{ color: stock.color }}>
                                    {stock.percentage}%
                                </span>
                            </div>
                            <h3>{stock.title}</h3>
                            <p className="stock-value">{loading ? 'Loading...' : stock.value} Products</p>
                            <div className="stock-bar">
                                <div className="stock-bar-fill" style={{ width: `${stock.percentage}%`, backgroundColor: stock.color }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="secondary-stats">
                <h2 className="section-title">Order Status Breakdown</h2>
                <div className="order-status-grid">
                    {orderStatusStats.map((order, index) => (
                        <div key={index} className="order-status-card">
                            <div className="order-icon" style={{backgroundColor: `${order.color}20`}}>
                                <order.icon style={{color: order.color, fontSize: 28}} />
                            </div>
                            <div className="order-info">
                                <p className="order-status-label">{order.status}</p>
                                <p className="order-count">{analyticsLoading ? '...' : order.count}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="quick-actions-section">
                <h2 className="section-title">Quick Actions</h2>
                <div className="quick-actions-grid">
                    <Link to="/admin/products/create" className="quick-action-card">
                        <div className="quick-action-icon-wrapper">
                            <AddBox className="quick-action-icon" />
                        </div>
                        <h3>Add Product</h3>
                        <p>Create a new product listing</p>
                    </Link>
                    <Link to="/admin/orders" className="quick-action-card">
                        <div className="quick-action-icon-wrapper">
                            <ShoppingCart className="quick-action-icon" />
                        </div>
                        <h3>View Orders</h3>
                        <p>Manage customer orders</p>
                    </Link>
                    <Link to="/admin/users" className="quick-action-card">
                        <div className="quick-action-icon-wrapper">
                            <People className="quick-action-icon" />
                        </div>
                        <h3>User Management</h3>
                        <p>View and manage users</p>
                    </Link>
                    <Link to="/admin/refunds" className="quick-action-card">
                        <div className="quick-action-icon-wrapper">
                            <MoneyOff className="quick-action-icon" />
                        </div>
                        <h3>Refunds</h3>
                        <p>Review refund requests</p>
                    </Link>
                    <Link to="/admin/reviews" className="quick-action-card">
                        <div className="quick-action-icon-wrapper">
                            <RateReview className="quick-action-icon" />
                        </div>
                        <h3>Reviews</h3>
                        <p>Moderate product reviews</p>
                    </Link>
                </div>
            </div>
        </main>
    </div>

    <Footer />
    </>
    );
}

export default AdminDashboard;
