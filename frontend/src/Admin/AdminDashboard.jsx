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
    Close as CloseIcon
} from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdminStats } from '../features/admin/adminSlice';

function AdminDashboard() {
    const location = useLocation();
    const dispatch = useDispatch();
    const { stats, loading, error } = useSelector(state => state.admin);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [timeframe, setTimeframe] = useState('month');

    useEffect(() => {
        dispatch(fetchAdminStats());
    }, [dispatch]);

    const isActive = (path) => location.pathname === path;

    // Mock trends - replace with real backend data later
    const mockTrends = {
        revenue: 12,
        orders: 8,
        products: -3,
        users: 15
    };

    const statCards = [
        { 
            title: 'Total Revenue', 
            value: stats?.revenue ? `$${Number(stats.revenue).toFixed(2)}` : '$0.00', 
            icon: AttachMoney, 
            color: '#10b981',
            trend: mockTrends.revenue,
        },
        { 
            title: 'Total Orders', 
            value: stats?.orders ?? 0, 
            icon: ShoppingCart, 
            color: '#3b82f6',
            trend: mockTrends.orders,
        },
        { 
            title: 'Total Products', 
            value: stats?.products ?? 0, 
            icon: Inventory, 
            color: '#8b5cf6',
            trend: mockTrends.products,
        },
        { 
            title: 'Total Users', 
            value: stats?.users ?? 0, 
            icon: People, 
            color: '#f59e0b',
            trend: mockTrends.users,
        },
    ];

    const stockStats = [
        {
            title: 'In Stock',
            value: stats?.inStock ?? 0,
            icon: CheckCircle,
            color: '#10b981',
            percentage: stats?.products > 0 ? ((stats?.inStock / stats?.products) * 100).toFixed(1) : 0
        },
        {
            title: 'Out of Stock',
            value: stats?.outOfStock ?? 0,
            icon: Error,
            color: '#ef4444',
            percentage: stats?.products > 0 ? ((stats?.outOfStock / stats?.products) * 100).toFixed(1) : 0
        }
    ];

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
                                        style={{ 
                                            backgroundColor: `${stat.color}15`, 
                                            color: stat.color 
                                        }}
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
                                        {loading ? (
                                            <span className="loading-shimmer">Loading...</span>
                                        ) : (
                                            stat.value
                                        )}
                                    </p>
                                    <span className="stat-description">vs last {timeframe}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="secondary-stats">
                        <h2 className="section-title">Inventory Status</h2>
                        <div className="stock-grid">
                            {stockStats.map((stock, index) => (
                                <div key={index} className="stock-card">
                                    <div className="stock-header">
                                        <stock.icon style={{ color: stock.color, fontSize: '2rem' }} />
                                        <span className="stock-percentage" style={{ color: stock.color }}>
                                            {stock.percentage}%
                                        </span>
                                    </div>
                                    <h3>{stock.title}</h3>
                                    <p className="stock-value">{loading ? 'Loading...' : stock.value} Products</p>
                                    <div className="stock-bar">
                                        <div 
                                            className="stock-bar-fill" 
                                            style={{ 
                                                width: `${stock.percentage}%`, 
                                                backgroundColor: stock.color 
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="quick-actions-section">
                        <h2 className="section-title">Quick Actions</h2>
                        <div className="quick-actions-grid">
                            <Link to="/admin/products/create" className="quick-action-card">
                                <AddBox className="quick-action-icon" />
                                <h3>Add Product</h3>
                                <p>Create a new product listing</p>
                            </Link>
                            <Link to="/admin/orders" className="quick-action-card">
                                <ShoppingCart className="quick-action-icon" />
                                <h3>View Orders</h3>
                                <p>Manage customer orders</p>
                            </Link>
                            <Link to="/admin/users" className="quick-action-card">
                                <People className="quick-action-icon" />
                                <h3>User Management</h3>
                                <p>View and manage users</p>
                            </Link>
                            <Link to="/admin/reviews" className="quick-action-card">
                                <RateReview className="quick-action-icon" />
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