import React, { useEffect, useLayoutEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { removeErrors, removeSuccess, updateProfile, loadUser } from '../features/products/userSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import { Camera, ArrowLeft, Save } from 'lucide-react';
import '../UserStyles/UpdateProfile.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-(]{7,20}$/;

function UpdateProfile() {
    const [form, setForm] = useState({
        firstName:   '',
        lastName:    '',
        email:       '',
        phone:       '',
        dateOfBirth: '',
        gender:      '',
    });

    const [shipping, setShipping] = useState({
        address: '',
        city:    '',
        state:   '',
        country: '',
        pinCode: '',
    });

    const [avatar,        setAvatar]        = useState('');
    const [avatarPreview, setAvatarPreview] = useState('./images/profile.webp');
    const [isDragging,    setIsDragging]    = useState(false);

    const { firstName, lastName, email, phone, dateOfBirth, gender } = form;

    const { user, error, success, message, loading } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const onField = (e) => {
        const { name, value } = e.target;
        setForm(p => ({ ...p, [name]: value }));
    };

    const onShipping = (e) => {
        const { name, value } = e.target;
        setShipping(p => ({ ...p, [name]: value }));
    };

    const profileImageUpdate = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
        if (file.size > 5 * 1024 * 1024)    { toast.error('Image size should be less than 5MB'); return; }

        const reader = new FileReader();
        reader.onload = () => {
            if (reader.readyState === 2) {
                setAvatarPreview(reader.result);
                setAvatar(reader.result);
            }
        };
        reader.onerror = () => toast.error('Error reading file');
        reader.readAsDataURL(file);
    };

    const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop      = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            profileImageUpdate({ target: { files: [file] } });
        } else {
            toast.error('Please drop an image file');
        }
    };

    const updateSubmit = async (e) => {
        e.preventDefault();

        if (!firstName.trim())              { toast.error('First name is required');            return; }
        if (!lastName.trim())               { toast.error('Last name is required');             return; }
        if (!email.trim())                  { toast.error('Email is required');                 return; }
        if (!EMAIL_RE.test(email.trim()))   { toast.error('Please enter a valid email');        return; }
        if (phone && !PHONE_RE.test(phone)) { toast.error('Please enter a valid phone number'); return; }

        if (dateOfBirth) {
            const age = (Date.now() - new Date(dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
            if (age < 13 || age > 120) { toast.error('Invalid date of birth'); return; }
        }

        const updateData = {
            firstName: firstName.trim(),
            lastName:  lastName.trim(),
            email:     email.trim(),
        };

        if (phone)       updateData.phone       = phone.trim();
        if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;
        if (gender)      updateData.gender      = gender;
        if (avatar)      updateData.avatar      = avatar;

        const hasShipping = Object.values(shipping).some(v => v.trim() !== '');
        if (hasShipping) updateData.shippingAddress = shipping;

        try {
            await dispatch(updateProfile(updateData)).unwrap();
            await dispatch(loadUser());
        } catch {
            // handled by useEffect
        }
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

    // Single setState call avoids cascading renders flagged by react-hooks/set-state-in-effect
    useLayoutEffect(() => {
        if (user) {
            setForm({
                firstName:   user.firstName || '',
                lastName:    user.lastName  || '',
                email:       user.email     || '',
                phone:       user.phone     || '',
                gender:      user.gender    || '',
                dateOfBirth: user.dateOfBirth
                    ? new Date(user.dateOfBirth).toISOString().split('T')[0]
                    : '',
            });
            setShipping({
                address: user.shippingAddress?.address || '',
                city:    user.shippingAddress?.city    || '',
                state:   user.shippingAddress?.state   || '',
                country: user.shippingAddress?.country || '',
                pinCode: user.shippingAddress?.pinCode || '',
            });
            setAvatarPreview(user?.avatar?.url || './images/profile.webp');
            setAvatar('');
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

                            <div className="update-profile-card">
                                <form className="update-profile-form-wrapper" onSubmit={updateSubmit}>

                                    {/* ── Avatar ── */}
                                    <div className="avatar-upload-section">
                                        <div
                                            className={`avatar-upload-wrapper ${isDragging ? 'dragging' : ''}`}
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onDrop={handleDrop}
                                        >
                                            <label htmlFor="avatar-input" className="avatar-preview-container">
                                                <img src={avatarPreview} alt="Profile preview" className="avatar-preview" />
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
                                            </label>
                                        </div>
                                        <div className="avatar-upload-hint">
                                            <p className="hint-title">Profile Picture</p>
                                            <p className="hint-text">Click to upload or drag and drop</p>
                                            <p className="hint-subtext">PNG, JPG or WEBP (max. 5MB)</p>
                                        </div>
                                    </div>

                                    {/* ── Personal Info ── */}
                                    <div className="form-fields">
                                        <div className="form-group">
                                            <label htmlFor="firstName">First Name</label>
                                            <input
                                                type="text"
                                                id="firstName"
                                                name="firstName"
                                                value={firstName}
                                                onChange={onField}
                                                placeholder="Enter your first name"
                                                className="form-input"
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="lastName">Last Name</label>
                                            <input
                                                type="text"
                                                id="lastName"
                                                name="lastName"
                                                value={lastName}
                                                onChange={onField}
                                                placeholder="Enter your last name"
                                                className="form-input"
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="email">Email Address</label>
                                            <input
                                                type="email"
                                                id="email"
                                                name="email"
                                                value={email}
                                                onChange={onField}
                                                placeholder="Enter your email"
                                                className="form-input"
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="phone">Phone Number</label>
                                            <input
                                                type="tel"
                                                id="phone"
                                                name="phone"
                                                value={phone}
                                                onChange={onField}
                                                placeholder="+1 555 000 0000"
                                                className="form-input"
                                                autoComplete="tel"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="dateOfBirth">Date of Birth</label>
                                            <input
                                                type="date"
                                                id="dateOfBirth"
                                                name="dateOfBirth"
                                                value={dateOfBirth}
                                                onChange={onField}
                                                className="form-input"
                                                autoComplete="bday"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="gender">Gender</label>
                                            <select
                                                id="gender"
                                                name="gender"
                                                value={gender}
                                                onChange={onField}
                                                className="form-input"
                                            >
                                                <option value="">Select gender</option>
                                                <option value="male">Male</option>
                                                <option value="female">Female</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* ── Shipping Address ── */}
                                    <div className="form-fields">
                                        <p style={{ fontWeight: 600, fontSize: '1rem', color: '#1a1a1a', marginBottom: '-0.5rem' }}>
                                            Shipping Address
                                        </p>

                                        <div className="form-group">
                                            <label htmlFor="address">Street Address</label>
                                            <input
                                                type="text"
                                                id="address"
                                                name="address"
                                                value={shipping.address}
                                                onChange={onShipping}
                                                placeholder="123 Main Street"
                                                className="form-input"
                                                autoComplete="street-address"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="city">City</label>
                                            <input
                                                type="text"
                                                id="city"
                                                name="city"
                                                value={shipping.city}
                                                onChange={onShipping}
                                                placeholder="New York"
                                                className="form-input"
                                                autoComplete="address-level2"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="state">State / Province</label>
                                            <input
                                                type="text"
                                                id="state"
                                                name="state"
                                                value={shipping.state}
                                                onChange={onShipping}
                                                placeholder="NY"
                                                className="form-input"
                                                autoComplete="address-level1"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="country">Country</label>
                                            <input
                                                type="text"
                                                id="country"
                                                name="country"
                                                value={shipping.country}
                                                onChange={onShipping}
                                                placeholder="United States"
                                                className="form-input"
                                                autoComplete="country-name"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="pinCode">ZIP / Pin Code</label>
                                            <input
                                                type="text"
                                                id="pinCode"
                                                name="pinCode"
                                                value={shipping.pinCode}
                                                onChange={onShipping}
                                                placeholder="10001"
                                                className="form-input"
                                                autoComplete="postal-code"
                                            />
                                        </div>
                                    </div>

                                    {/* ── Actions ── */}
                                    <div className="form-actions">
                                        <button
                                            type="button"
                                            className="cancel-button"
                                            onClick={() => navigate('/profile')}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            className="save-button"
                                            disabled={loading}
                                        >
                                            <Save />
                                            <span>{loading ? 'Saving...' : 'Save Changes'}</span>
                                        </button>
                                    </div>
                                </form>
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