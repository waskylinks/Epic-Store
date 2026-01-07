import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import PageTitle from '../components/PageTitle';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { removeErrors, removeSuccess, updatePassword } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function UpdatePassword() {
    const { success, loading, error } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState('');

    // Calculate password strength
    const calculatePasswordStrength = (pass) => {
        if (!pass) return '';
        let strength = 0;
        
        if (pass.length >= 12) strength++;
        if (pass.length >= 16) strength++;
        if (/[a-z]/.test(pass)) strength++;
        if (/[A-Z]/.test(pass)) strength++;
        if (/[0-9]/.test(pass)) strength++;
        if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)) strength++;

        if (strength <= 2) return 'weak';
        if (strength <= 4) return 'medium';
        if (strength <= 5) return 'strong';
        return 'very-strong';
    };

    const updatePasswordSubmit = (e) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            toast.error('New passwords do not match', { position: 'top-center', autoClose: 2000 });
            return;
        }

        if (newPassword.length < 12) {
            toast.error('Password must be at least 12 characters', { position: 'top-center', autoClose: 2000 });
            return;
        }

        const myForm = new FormData();
        myForm.set('oldPassword', oldPassword);
        myForm.set('newPassword', newPassword);
        myForm.set('confirmPassword', confirmPassword);

        dispatch(updatePassword(myForm));
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 2000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (success) {
            toast.success('Password Updated Successfully', { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
            navigate('/profile');
        }
    }, [dispatch, success, navigate]);

    useEffect(() => {
        setPasswordStrength(calculatePasswordStrength(newPassword));
    }, [newPassword]);

    const getStrengthColor = () => {
        switch (passwordStrength) {
            case 'weak': return '#f44336';
            case 'medium': return '#ff9800';
            case 'strong': return '#2196f3';
            case 'very-strong': return '#4caf50';
            default: return '#ccc';
        }
    };

    const getStrengthText = () => {
        switch (passwordStrength) {
            case 'weak': return 'Weak';
            case 'medium': return 'Medium';
            case 'strong': return 'Strong';
            case 'very-strong': return 'Very Strong';
            default: return '';
        }
    };

    return (
        <>
            {loading ? (<Loader />) : (
                <>
                    <Navbar />
                    <PageTitle title='Update Password' />
                    
                    <div className="container update-container">
                        <div className="form-content">
                            <form className="form" onSubmit={updatePasswordSubmit}>
                                <h2>Update Password</h2>

                                <div className="input-group password-group">
                                    <input 
                                        type={showOldPassword ? "text" : "password"}
                                        name='oldPassword'
                                        placeholder='Old Password'
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowOldPassword(!showOldPassword)}
                                    >
                                        {showOldPassword ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>

                                <div className="input-group password-group">
                                    <input 
                                        type={showNewPassword ? "text" : "password"}
                                        name='newPassword'
                                        placeholder='New Password (min 12 characters)'
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                    >
                                        {showNewPassword ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>

                                {newPassword && (
                                    <div className="password-strength">
                                        <div className="strength-bar-container">
                                            <div 
                                                className="strength-bar"
                                                style={{
                                                    width: `${(passwordStrength === 'weak' ? 25 : passwordStrength === 'medium' ? 50 : passwordStrength === 'strong' ? 75 : 100)}%`,
                                                    backgroundColor: getStrengthColor()
                                                }}
                                            ></div>
                                        </div>
                                        <span className="strength-text" style={{ color: getStrengthColor() }}>
                                            {getStrengthText()}
                                        </span>
                                    </div>
                                )}

                                <div className="password-requirements">
                                    <p>New password must contain:</p>
                                    <ul>
                                        <li className={newPassword.length >= 12 ? 'valid' : ''}>
                                            {newPassword.length >= 12 ? '✓' : '○'} At least 12 characters
                                        </li>
                                        <li className={/[A-Z]/.test(newPassword) ? 'valid' : ''}>
                                            {/[A-Z]/.test(newPassword) ? '✓' : '○'} One uppercase letter
                                        </li>
                                        <li className={/[a-z]/.test(newPassword) ? 'valid' : ''}>
                                            {/[a-z]/.test(newPassword) ? '✓' : '○'} One lowercase letter
                                        </li>
                                        <li className={/[0-9]/.test(newPassword) ? 'valid' : ''}>
                                            {/[0-9]/.test(newPassword) ? '✓' : '○'} One number
                                        </li>
                                        <li className={/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword) ? 'valid' : ''}>
                                            {/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword) ? '✓' : '○'} One special character
                                        </li>
                                    </ul>
                                </div>

                                <div className="input-group password-group">
                                    <input 
                                        type={showConfirmPassword ? "text" : "password"}
                                        name='confirmPassword'
                                        placeholder='Confirm New Password'
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    >
                                        {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>

                                <button className="authBtn" disabled={loading}>
                                    {loading ? 'Updating...' : 'Update Password'}
                                </button>
                            </form>
                        </div>
                    </div>

                    <Footer />
                </>
            )}
        </>
    );
}

export default UpdatePassword;