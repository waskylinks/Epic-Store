import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { removeErrors, removeSuccess, resetPassword } from '../features/products/userSlice';
import { toast } from 'react-toastify';

function ResetPassword() {
    const { success, loading, error } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState('');
    const [hasValidatedAccess, setHasValidatedAccess] = useState(false);

    const email = location.state?.email;
    const code = location.state?.code;
    const verified = location.state?.verified;

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

    // Check if password meets all requirements
    const isPasswordValid = (pass) => {
        return pass.length >= 12 &&
               /[A-Z]/.test(pass) &&
               /[a-z]/.test(pass) &&
               /[0-9]/.test(pass) &&
               /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass);
    };

    const handlePasswordChange = (e) => {
        const newPassword = e.target.value;
        setPassword(newPassword);
        setPasswordStrength(calculatePasswordStrength(newPassword));
        
        // Clear errors when user starts typing
        if (error) {
            dispatch(removeErrors());
        }
    };

    const handleConfirmPasswordChange = (e) => {
        setConfirmPassword(e.target.value);
        
        // Clear errors when user starts typing
        if (error) {
            dispatch(removeErrors());
        }
    };

    const resetPasswordSubmit = (e) => {
        e.preventDefault();

        // Clear previous errors
        dispatch(removeErrors());

        if (!email || !code) {
            toast.error('Invalid session. Please start the password reset process again.', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            navigate('/password/forgot');
            return;
        }

        if (password !== confirmPassword) {
            toast.error('Passwords do not match', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            return;
        }

        if (!isPasswordValid(password)) {
            toast.error('Password must meet all requirements', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            return;
        }

        dispatch(resetPassword({
            email,
            code,
            password,
            confirmPassword
        }));
    };

    // Validate access on mount (only once)
    useEffect(() => {
        if (!email || !code || !verified) {
            toast.error('Please verify your reset code first', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            navigate('/password/forgot');
        } else {
            setHasValidatedAccess(true);
        }
    }, []); // Empty dependency array - only run once on mount

    // Handle errors
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    // Handle success
    useEffect(() => {
        if (success) {
            toast.success('Password reset successful! Please login with your new password.', { 
                position: 'top-center', 
                autoClose: 3000 
            });
            dispatch(removeSuccess());
            setTimeout(() => {
                navigate('/login');
            }, 1000);
        }
    }, [dispatch, success, navigate]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            dispatch(removeErrors());
            dispatch(removeSuccess());
        };
    }, [dispatch]);

    const getStrengthColor = () => {
        switch (passwordStrength) {
            case 'weak': return '#f44336';
            case 'medium': return '#ff9800';
            case 'strong': return '#2196f3';
            case 'very-strong': return '#4caf50';
            default: return '#ccc';
        }
    };

    const getStrengthWidth = () => {
        switch (passwordStrength) {
            case 'weak': return '25%';
            case 'medium': return '50%';
            case 'strong': return '75%';
            case 'very-strong': return '100%';
            default: return '0%';
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

    const isFormValid = () => {
        return password && 
               confirmPassword && 
               password === confirmPassword && 
               isPasswordValid(password);
    };

    // Don't render until access is validated
    if (!hasValidatedAccess) {
        return null;
    }

    return (
        <>
            <PageTitle title='Set New Password'/>
            <Navbar />

            <div className="container update-container">
                <div className="form-content">
                    <form className="form" onSubmit={resetPasswordSubmit}>
                        <div className="verification-header">
                            <div className="verification-icon">🔒</div>
                            <h2>Set New Password</h2>
                            <p className="verification-text">
                                Create a strong password for<br />
                                <strong>{email}</strong>
                            </p>
                        </div>

                        <div className="input-group password-group">
                            <input 
                                type={showPassword ? "text" : "password"}
                                name='password'
                                placeholder='Enter New Password (min 12 characters)'
                                value={password}
                                onChange={handlePasswordChange}
                                required
                                disabled={loading}
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                disabled={loading}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                )}
                            </button>
                        </div>

                        {password && (
                            <div className="password-strength">
                                <div className="strength-bar-container" style={{
                                    width: '100%',
                                    height: '6px',
                                    backgroundColor: '#e0e0e0',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                    marginBottom: '8px'
                                }}>
                                    <div 
                                        className="strength-bar"
                                        style={{
                                            width: getStrengthWidth(),
                                            height: '100%',
                                            backgroundColor: getStrengthColor(),
                                            transition: 'all 0.3s ease'
                                        }}
                                    ></div>
                                </div>
                                <span 
                                    className="strength-text" 
                                    style={{ 
                                        color: getStrengthColor(),
                                        fontSize: '14px',
                                        fontWeight: '500'
                                    }}
                                >
                                    {getStrengthText()}
                                </span>
                            </div>
                        )}

                        <div className="password-requirements" style={{
                            fontSize: '12px',
                            color: '#666',
                            marginBottom: '15px',
                            padding: '10px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '6px'
                        }}>
                            <p style={{ margin: '0 0 5px 0', fontWeight: '600' }}>Password must contain:</p>
                            <ul style={{ margin: 0, paddingLeft: '20px' }}>
                                <li style={{ color: password.length >= 12 ? '#4caf50' : '#999' }}>
                                    {password.length >= 12 ? '✓' : '○'} At least 12 characters
                                </li>
                                <li style={{ color: /[A-Z]/.test(password) ? '#4caf50' : '#999' }}>
                                    {/[A-Z]/.test(password) ? '✓' : '○'} One uppercase letter
                                </li>
                                <li style={{ color: /[a-z]/.test(password) ? '#4caf50' : '#999' }}>
                                    {/[a-z]/.test(password) ? '✓' : '○'} One lowercase letter
                                </li>
                                <li style={{ color: /[0-9]/.test(password) ? '#4caf50' : '#999' }}>
                                    {/[0-9]/.test(password) ? '✓' : '○'} One number
                                </li>
                                <li style={{ color: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) ? '#4caf50' : '#999' }}>
                                    {/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) ? '✓' : '○'} One special character
                                </li>
                            </ul>
                        </div>

                        <div className="input-group password-group">
                            <input 
                                type={showConfirmPassword ? "text" : "password"}
                                name='confirmPassword'
                                placeholder='Confirm New Password'
                                value={confirmPassword}
                                onChange={handleConfirmPasswordChange}
                                required
                                disabled={loading}
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                disabled={loading}
                                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            >
                                {showConfirmPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                )}
                            </button>
                        </div>

                        {confirmPassword && password !== confirmPassword && (
                            <p style={{
                                color: '#f44336',
                                fontSize: '14px',
                                marginTop: '-10px',
                                marginBottom: '10px'
                            }}>
                                ✗ Passwords do not match
                            </p>
                        )}

                        {confirmPassword && password === confirmPassword && (
                            <p style={{
                                color: '#4caf50',
                                fontSize: '14px',
                                marginTop: '-10px',
                                marginBottom: '10px'
                            }}>
                                ✓ Passwords match
                            </p>
                        )}

                        <button 
                            className="authBtn" 
                            disabled={loading || !isFormValid()}
                        >
                            {loading ? 'Resetting...' : 'Reset Password'}
                        </button>

                        <p className="form-links">
                            Remember your password? 
                            <button 
                                type="button"
                                onClick={() => navigate('/login')}
                                disabled={loading}
                                className="link-btn"
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: loading ? '#ccc' : '#667eea',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    textDecoration: 'underline',
                                    marginLeft: '5px'
                                }}
                            >
                                Sign in here
                            </button>
                        </p>
                    </form>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default ResetPassword;