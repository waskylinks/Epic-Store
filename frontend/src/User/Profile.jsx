import React, { useEffect, useState } from 'react';
import '../UserStyles/Profile.css';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import PageTitle from '../components/PageTitle';
import Loader from '../components/Loader';
import { User, Mail, Calendar, Package, Lock, Edit, X, Phone, MapPin, Users } from 'lucide-react';

function Profile() {
    const { loading, isAuthenticated, user } = useSelector((state) => state.user);
    const navigate = useNavigate();
    const [showImageModal, setShowImageModal] = useState(false);

    useEffect(() => {
        if (isAuthenticated === false) {
            navigate('/login');
        }
    }, [isAuthenticated, navigate]);

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const formatGender = (gender) => {
        if (!gender) return 'Not provided';
        return gender.charAt(0).toUpperCase() + gender.slice(1);
    };

    const formatShippingAddress = (addr) => {
        if (!addr) return null;
        const parts = [addr.address, addr.city, addr.state, addr.pinCode, addr.country].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
    };

    const shippingDisplay = formatShippingAddress(user?.shippingAddress);

    return (
        <>
            {loading ? (
                <Loader />
            ) : (
                <>
                    <Navbar />
                    <PageTitle title={`${user?.firstName || user?.name || 'User'} Profile`} />

                    <div className="profile-container">
                        <div className="profile-wrapper">
                            {/* Sidebar */}
                            <div className="profile-sidebar">
                                <div className="profile-image-section">
                                    <img
                                        src={user?.avatar?.url || './images/profile.webp'}
                                        alt="User profile"
                                        onClick={() => setShowImageModal(true)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    <h1 className="profile-name">
                                        {user?.firstName && user?.lastName
                                            ? `${user.firstName} ${user.lastName}`
                                            : user?.name || 'User'}
                                    </h1>
                                    <p className="profile-email">{user?.email || 'Not provided'}</p>
                                    <Link to='/profile/update' className="edit-profile-btn">
                                        <Edit size={18} />
                                        <span>Edit Profile</span>
                                    </Link>
                                </div>
                            </div>

                            {/* Main */}
                            <div className="profile-main">
                                <h2 className="section-title">Profile Information</h2>

                                <div className="profile-details-grid">
                                    <div className="profile-detail-card">
                                        <div className="detail-icon"><User size={20} /></div>
                                        <div className="detail-content">
                                            <h3>Full Name</h3>
                                            <p>
                                                {user?.firstName && user?.lastName
                                                    ? `${user.firstName} ${user.lastName}`
                                                    : user?.name || 'Not provided'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="profile-detail-card">
                                        <div className="detail-icon"><Mail size={20} /></div>
                                        <div className="detail-content">
                                            <h3>Email Address</h3>
                                            <p>{user?.email || 'Not provided'}</p>
                                        </div>
                                    </div>

                                    <div className="profile-detail-card">
                                        <div className="detail-icon"><Phone size={20} /></div>
                                        <div className="detail-content">
                                            <h3>Phone Number</h3>
                                            <p>{user?.phone || 'Not provided'}</p>
                                        </div>
                                    </div>

                                    <div className="profile-detail-card">
                                        <div className="detail-icon"><Calendar size={20} /></div>
                                        <div className="detail-content">
                                            <h3>Date of Birth</h3>
                                            <p>{formatDate(user?.dateOfBirth)}</p>
                                        </div>
                                    </div>

                                    <div className="profile-detail-card">
                                        <div className="detail-icon"><Users size={20} /></div>
                                        <div className="detail-content">
                                            <h3>Gender</h3>
                                            <p>{formatGender(user?.gender)}</p>
                                        </div>
                                    </div>

                                    <div className="profile-detail-card">
                                        <div className="detail-icon"><Calendar size={20} /></div>
                                        <div className="detail-content">
                                            <h3>Member Since</h3>
                                            <p>{formatDate(user?.createdAt)}</p>
                                        </div>
                                    </div>

                                    {shippingDisplay && (
                                        <div className="profile-detail-card" style={{ gridColumn: '1 / -1' }}>
                                            <div className="detail-icon"><MapPin size={20} /></div>
                                            <div className="detail-content">
                                                <h3>Shipping Address</h3>
                                                <p>{shippingDisplay}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <h2 className="section-title" style={{ marginTop: '2.5rem' }}>Quick Actions</h2>

                                <div className="profile-actions">
                                    <Link to='/orders/user' className="action-card orders-card">
                                        <div className="action-icon"><Package size={24} /></div>
                                        <div className="action-content">
                                            <h3>My Orders</h3>
                                            <p>View and track your orders</p>
                                        </div>
                                    </Link>

                                    <Link to='/password/update' className="action-card password-card">
                                        <div className="action-icon"><Lock size={24} /></div>
                                        <div className="action-content">
                                            <h3>Change Password</h3>
                                            <p>Update your security credentials</p>
                                        </div>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>

                    {showImageModal && (
                        <div className="image-modal" onClick={() => setShowImageModal(false)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <button className="modal-close" onClick={() => setShowImageModal(false)}>
                                    <X size={24} />
                                </button>
                                <img
                                    src={user?.avatar?.url || './images/profile.webp'}
                                    alt="User profile enlarged"
                                />
                            </div>
                        </div>
                    )}

                    <Footer />
                </>
            )}
        </>
    );
}

export default Profile;