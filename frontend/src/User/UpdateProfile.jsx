import React, { useEffect, useLayoutEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { removeErrors, removeSuccess, updateProfile } from '../features/products/userSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import { User, Mail, Camera, ArrowLeft, Save } from 'lucide-react';
import '../UserStyles/UpdateProfile.css';

function UpdateProfile() {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [avatar, setAvatar] = useState('');
    const [avatarPreview, setAvatarPreview] = useState('./images/profile.webp');
    const [isDragging, setIsDragging] = useState(false);

    const { user, error, success, message, loading } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const profileImageUpdate = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file');
            return;
        }

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image size should be less than 5MB');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            if (reader.readyState === 2) {
                setAvatarPreview(reader.result);
                setAvatar(reader.result);
            }
        };
        reader.onerror = () => {
            toast.error('Error reading file');
        };
        reader.readAsDataURL(file);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const fakeEvent = { target: { files: [file] } };
            profileImageUpdate(fakeEvent);
        } else {
            toast.error('Please drop an image file');
        }
    };

    const updateSubmit = (e) => {
        e.preventDefault();

        // Validation
        if (!firstName.trim()) {
            toast.error('First name is required');
            return;
        }

        if (!lastName.trim()) {
            toast.error('Last name is required');
            return;
        }

        if (!email.trim()) {
            toast.error('Email is required');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            toast.error('Please enter a valid email');
            return;
        }

        // Create update object
        const updateData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim()
        };

        // Only include avatar if it was changed
        if (avatar && avatar !== '') {
            updateData.avatar = avatar;
        }
        
        console.log('📤 Updating profile with:', updateData);
        dispatch(updateProfile(updateData));
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 2000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (success) {
            toast.success(message || 'Profile updated successfully', { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
            navigate('/profile');
        }
    }, [dispatch, success, message, navigate]);

    useLayoutEffect(() => {
        if (user) {
            console.log('👤 Current user data:', user);
            setFirstName(user.firstName || '');
            setLastName(user.lastName || '');
            setEmail(user.email || '');
            setAvatarPreview(user?.avatar?.url || './images/profile.webp');
        }
    }, [user]);

    return (
        <>
            {loading ? (
                <Loader />
            ) : (
                <>
                    <Navbar />

                    <div className="update-profile-page">
                        <div className="update-profile-container">
                            {/* Header */}
                            <div className="update-profile-header">
                                <button 
                                    className="back-button"
                                    onClick={() => navigate('/profile')}
                                    type="button"
                                >
                                    <ArrowLeft />
                                    <span>Back to Profile</span>
                                </button>
                                <h1>Update Your Profile</h1>
                                <p>Keep your information up to date</p>
                            </div>

                            {/* Form Card */}
                            <div className="update-profile-card">
                                <div className="update-profile-form-wrapper">
                                    {/* Avatar Upload Section */}
                                    <div className="avatar-upload-section">
                                        <div 
                                            className={`avatar-upload-wrapper ${isDragging ? 'dragging' : ''}`}
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onDrop={handleDrop}
                                        >
                                            <div className="avatar-preview-container">
                                                <img 
                                                    src={avatarPreview} 
                                                    alt="Profile preview" 
                                                    className="avatar-preview" 
                                                />
                                                <div className="avatar-overlay">
                                                    <Camera />
                                                    <span>Change Photo</span>
                                                </div>
                                                <input 
                                                    type="file" 
                                                    className="avatar-input" 
                                                    accept="image/*" 
                                                    onChange={profileImageUpdate}
                                                    name="avatar"
                                                    id="avatar-input"
                                                />
                                            </div>
                                        </div>
                                        <div className="avatar-upload-hint">
                                            <p className="hint-title">Profile Picture</p>
                                            <p className="hint-text">Click to upload or drag and drop</p>
                                            <p className="hint-subtext">PNG, JPG or WEBP (max. 5MB)</p>
                                        </div>
                                    </div>

                                    {/* Form Fields */}
                                    <div className="form-fields">
                                        {/* First Name Field */}
                                        <div className="form-group">
                                            <label htmlFor="firstName">First Name</label>
                                            <div className="input-wrapper">
                                                <User className="input-icon" />
                                                <input 
                                                    type="text" 
                                                    id="firstName"
                                                    value={firstName} 
                                                    onChange={(e) => setFirstName(e.target.value)}
                                                    name="firstName"
                                                    placeholder="Enter your first name"
                                                    required
                                                />
                                            </div>
                                        </div>

                                        {/* Last Name Field */}
                                        <div className="form-group">
                                            <label htmlFor="lastName">Last Name</label>
                                            <div className="input-wrapper">
                                                <User className="input-icon" />
                                                <input 
                                                    type="text" 
                                                    id="lastName"
                                                    value={lastName} 
                                                    onChange={(e) => setLastName(e.target.value)}
                                                    name="lastName"
                                                    placeholder="Enter your last name"
                                                    required
                                                />
                                            </div>
                                        </div>

                                        {/* Email Field */}
                                        <div className="form-group">
                                            <label htmlFor="email">Email Address</label>
                                            <div className="input-wrapper">
                                                <Mail className="input-icon" />
                                                <input 
                                                    type="email" 
                                                    id="email"
                                                    value={email} 
                                                    onChange={(e) => setEmail(e.target.value)}
                                                    name="email"
                                                    placeholder="Enter your email"
                                                    required
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="form-actions">
                                        <button 
                                            type="button" 
                                            className="cancel-button"
                                            onClick={() => navigate('/profile')}
                                        >
                                            Cancel
                                        </button>
                                        <button 
                                            type="button" 
                                            className="save-button"
                                            onClick={updateSubmit}
                                        >
                                            <Save />
                                            <span>Save Changes</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Footer />
                </>
            )}
        </>
    );
}

export default UpdateProfile;