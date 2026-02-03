import React, { useEffect, useState } from 'react';
import '../UserStyles/Profile.css';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import PageTitle from '../components/PageTitle';
import Loader from '../components/Loader';
import { User, Mail, Calendar, Package, Lock, Edit, X } from 'lucide-react';

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

    const handleImageClick = () => {
        setShowImageModal(true);
    };

    const closeModal = () => {
        setShowImageModal(false);
    };

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
                            {/* Left Section - Profile Image & Basic Info */}
                            <div className="profile-sidebar">
                                <div className="profile-image-section">
                                    <img 
                                        src={user?.avatar?.url || './images/profile.webp'} 
                                        alt="User profile"
                                        onClick={handleImageClick}
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

                            {/* Right Section - Profile Details & Actions */}
                            <div className="profile-main">
                                <h2 className="section-title">Profile Information</h2>
                                
                                <div className="profile-details-grid">
                                    <div className="profile-detail-card">
                                        <div className="detail-icon">
                                            <User size={20} />
                                        </div>
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
                                        <div className="detail-icon">
                                            <Mail size={20} />
                                        </div>
                                        <div className="detail-content">
                                            <h3>Email Address</h3>
                                            <p>{user?.email || 'Not provided'}</p>
                                        </div>
                                    </div>

                                    <div className="profile-detail-card">
                                        <div className="detail-icon">
                                            <Calendar size={20} />
                                        </div>
                                        <div className="detail-content">
                                            <h3>Member Since</h3>
                                            <p>{formatDate(user?.createdAt)}</p>
                                        </div>
                                    </div>
                                </div>

                                <h2 className="section-title" style={{ marginTop: '2.5rem' }}>Quick Actions</h2>
                                
                                <div className="profile-actions">
                                    <Link to='/orders/user' className="action-card orders-card">
                                        <div className="action-icon">
                                            <Package size={24} />
                                        </div>
                                        <div className="action-content">
                                            <h3>My Orders</h3>
                                            <p>View and track your orders</p>
                                        </div>
                                    </Link>

                                    <Link to='/password/update' className="action-card password-card">
                                        <div className="action-icon">
                                            <Lock size={24} />
                                        </div>
                                        <div className="action-content">
                                            <h3>Change Password</h3>
                                            <p>Update your security credentials</p>
                                        </div>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Image Modal */}
                    {showImageModal && (
                        <div className="image-modal" onClick={closeModal}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <button className="modal-close" onClick={closeModal}>
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