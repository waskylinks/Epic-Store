import React, { useEffect } from 'react';
import '../UserStyles/Profile.css';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import PageTitle from '../components/PageTitle';
import Loader from '../components/Loader';
import { User, Mail, Calendar, Package, Lock, Edit } from 'lucide-react';

function Profile() {
    const { loading, isAuthenticated, user } = useSelector((state) => state.user);
    const navigate = useNavigate();

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

    return (
        <>
            {loading ? (
                <Loader />
            ) : (
                <>
                    <Navbar />
                    <PageTitle title={`${user?.firstName || user?.name || 'User'} Profile`} />
                    
                    <div className="profile-container">
                        {/* Profile Header with Avatar */}
                        <div className="profile-image">
                            <h1 className="profile-heading">My Profile</h1>
                            <img 
                                src={user?.avatar?.url || './images/profile.webp'} 
                                alt="User profile" 
                            />
                            <Link to='/profile/update'>
                                <Edit size={18} />
                                <span>Edit Profile</span>
                            </Link>
                        </div>

                        {/* Profile Details Card */}
                        <div className="profile-details">
                            <div className="profile-detail">
                                <h2>
                                    <User size={16} style={{ display: 'inline', marginRight: '5px' }} />
                                    Full Name
                                </h2>
                                <p>
                                    {user?.firstName && user?.lastName 
                                        ? `${user.firstName} ${user.lastName}` 
                                        : user?.name || 'Not provided'}
                                </p>
                            </div>

                            <div className="profile-detail">
                                <h2>
                                    <Mail size={16} style={{ display: 'inline', marginRight: '5px' }} />
                                    Email Address
                                </h2>
                                <p>{user?.email || 'Not provided'}</p>
                            </div>

                            <div className="profile-detail">
                                <h2>
                                    <Calendar size={16} style={{ display: 'inline', marginRight: '5px' }} />
                                    Member Since
                                </h2>
                                <p>{formatDate(user?.createdAt)}</p>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="profile-buttons">
                            <Link to='/orders/user'>
                                <Package size={18} />
                                <span>My Orders</span>
                            </Link>
                            <Link to='/password/update'>
                                <Lock size={18} />
                                <span>Change Password</span>
                            </Link>
                        </div>
                    </div>

                    <Footer />
                </>
            )}
        </>
    );
}

export default Profile;