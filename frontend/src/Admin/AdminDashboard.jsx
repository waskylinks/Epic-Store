import React, { useEffect } from 'react';
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
    ShoppingCart 
} from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdminStats } from '../features/admin/adminSlice';

function AdminDashboard() {
    const location = useLocation();
    const dispatch = useDispatch();
    const { stats, loading, error } = useSelector(state => state.admin);

    useEffect(() => {
        dispatch(fetchAdminStats());
    }, [dispatch]);

    const isActive = (path) => location.pathname === path;

    const statCards = [
        { 
            title: 'Total Products', 
            value: stats?.products ?? 0, 
            icon: Inventory, 
            color: '#1976d2' 
        },
        { 
            title: 'Total Orders', 
            value: stats?.orders ?? 0, 
            icon: ShoppingCart, 
            color: '#388e3c' 
        },
        { 
            title: 'Total Revenue', 
            value: stats?.revenue ? `$${Number(stats.revenue).toFixed(2)}` : '$0.00', 
            icon: AttachMoney, 
            color: '#f57c00' 
        },
        { 
            title: 'Total Users', 
            value: stats?.users ?? 0, 
            icon: People, 
            color: '#7b1fa2' 
        },
        { 
            title: 'Out of Stock', 
            value: stats?.outOfStock ?? 0, 
            icon: Error, 
            color: '#d32f2f' 
        },
        { 
            title: 'In Stock', 
            value: stats?.inStock ?? 0, 
            icon: CheckCircle, 
            color: '#388e3c' 
        },
    ];

    return (
        <>
            <PageTitle title="Admin Dashboard" />
            <Navbar />

            <div className="dashboard-wrapper">
                <div className="dashboard-sidebar">
                    <div className="sidebar-header">
                        <DashboardIcon className="sidebar-logo-icon" />
                        <span>Admin Panel</span>
                    </div>

                    <nav className="sidebar-nav">
                        <div className="nav-group">
                            <h4>Products</h4>
                            <Link 
                                to="/admin/products" 
                                className={isActive('/admin/products') ? 'nav-item active' : 'nav-item'}
                            >
                                <Inventory className="nav-item-icon" />
                                <span>All Products</span>
                            </Link>
                            <Link 
                                to="/admin/products/create" 
                                className={isActive('/admin/products/create') ? 'nav-item active' : 'nav-item'}
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
                            >
                                <RateReview className="nav-item-icon" />
                                <span>All Reviews</span>
                            </Link>
                        </div>
                    </nav>
                </div>

                <main className="dashboard-main">
                    <h1 className="dashboard-title">Dashboard Overview</h1>

                    {error && (
                        <div className="error-message" style={{ color: '#d32f2f', marginBottom: '20px' }}>
                            Error loading stats: {error}
                        </div>
                    )}

                    <div className="stats-grid">
                        {statCards.map((stat, index) => (
                            <div key={index} className="stat-card">
                                <div 
                                    className="stat-icon" 
                                    style={{ 
                                        backgroundColor: `${stat.color}20`, 
                                        color: stat.color 
                                    }}
                                >
                                    <stat.icon className="icon" />
                                </div>
                                <div className="stat-info">
                                    <h3>{stat.title}</h3>
                                    <p className="stat-value">
                                        {loading ? 'Loading...' : stat.value}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </main>
            </div>

            <Footer />
        </>
    );
}

export default AdminDashboard;