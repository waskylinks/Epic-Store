import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import '../UserStyles/OAuthButtons.css';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { login, removeErrors, removeSuccess, clearVerificationState } from '../features/products/userSlice';
import { syncServerCart } from '../features/cart/cartSlice';
import GoogleSignInButton from '../components/GoogleSignInButton';
import FacebookSignInButton from '../components/FacebookSignInButton';
import {
  Storefront as StorefrontIcon,
  LocalShipping,
  Security,
  Star,
  VerifiedUser,
  CardGiftcard
} from '@mui/icons-material';

function Login() {
    const [loginEmail, setLoginEmail]       = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [showPassword, setShowPassword]   = useState(false);

    const { error, loading, isAuthenticated, needsVerification, verificationEmail } =
        useSelector(state => state.user);

    const location = useLocation();
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const redirect = new URLSearchParams(location.search).get('redirect') || '/';

    const logInSubmit = (e) => {
        e.preventDefault();
        dispatch(removeErrors());
        if (!loginEmail.trim() || !loginPassword.trim()) return;
        dispatch(login({ email: loginEmail.trim(), password: loginPassword }));
    };

    const togglePasswordVisibility = () => setShowPassword(!showPassword);

    const handleEmailChange = (e) => {
        setLoginEmail(e.target.value);
        if (error) dispatch(removeErrors());
    };

    const handlePasswordChange = (e) => {
        setLoginPassword(e.target.value);
        if (error) dispatch(removeErrors());
    };

    // Redirect if login fails due to unverified email
    useEffect(() => {
        if (needsVerification && verificationEmail) {
            navigate('/verify-email', { state: { email: verificationEmail } });
            dispatch(clearVerificationState());
        }
    }, [needsVerification, verificationEmail, navigate, dispatch]);

    // After successful login: sync the server cart THEN redirect.
    // This ensures User B never sees User A's stale localStorage cart.
    useEffect(() => {
        if (isAuthenticated) {
            dispatch(syncServerCart()).finally(() => {
                navigate(redirect);
            });
        }
    }, [isAuthenticated, redirect, navigate, dispatch]);

    // Cleanup on mount and unmount
    useEffect(() => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
        return () => {
            dispatch(removeErrors());
            dispatch(removeSuccess());
        };
    }, [dispatch]);

    const benefits = [
        { icon: <LocalShipping />, text: 'Free shipping on orders over $50' },
        { icon: <Security />,      text: 'Secure & encrypted payments' },
        { icon: <CardGiftcard />,  text: 'Exclusive member discounts' },
        { icon: <VerifiedUser />,  text: '24/7 customer support' },
    ];

    return (
        <div className="auth-page">
            <div className="auth-container">

                {/* LEFT SIDE - Brand & Visual Content (Hidden on Mobile) */}
                <div className="auth-visual-side">
                    <div className="visual-background">
                        <div className="gradient-overlay"></div>
                    </div>

                    <div className="visual-content">
                        <div className="visual-logo">
                            <StorefrontIcon className="visual-logo-icon" />
                            <span className="visual-logo-text">
                                Epic <span className="visual-logo-accent">Store</span>
                            </span>
                        </div>

                        <div className="visual-heading">
                            <h1>Welcome Back to Your Shopping Paradise</h1>
                            <p>Sign in to access exclusive deals, track your orders, and enjoy a personalized shopping experience.</p>
                        </div>

                        <div className="visual-carousel">
                            <div className="carousel-placeholder">
                                <div className="carousel-item active">
                                    <div className="carousel-content">
                                        <Star className="carousel-icon" />
                                        <p className="carousel-text">"Amazing products and fast delivery! Best shopping experience ever."</p>
                                        <p className="carousel-author">- Sarah M.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="visual-benefits">
                            {benefits.map((benefit, index) => (
                                <div key={index} className="benefit-item">
                                    <div className="benefit-icon">{benefit.icon}</div>
                                    <p className="benefit-text">{benefit.text}</p>
                                </div>
                            ))}
                        </div>

                        <div className="visual-social-proof">
                            <div className="social-proof-stats">
                                <div className="stat-item">
                                    <span className="stat-number">50K+</span>
                                    <span className="stat-label">Happy Customers</span>
                                </div>
                                <div className="stat-item">
                                    <span className="stat-number">4.9</span>
                                    <span className="stat-label">Rating</span>
                                </div>
                                <div className="stat-item">
                                    <span className="stat-number">10K+</span>
                                    <span className="stat-label">Products</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT SIDE - Login Form */}
                <div className="auth-form-side">
                    <div className="auth-form-wrapper">

                        <div className="mobile-logo">
                            <StorefrontIcon className="mobile-logo-icon" />
                            <span className="mobile-logo-text">
                                Epic <span className="mobile-logo-accent">Store</span>
                            </span>
                        </div>

                        <form className='auth-form' onSubmit={logInSubmit}>
                            <div className="form-header">
                                <h2>Sign in to your account</h2>
                                <p>Welcome back! Please enter your details.</p>
                            </div>

                            {error && (
                                <div className="error-message">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="12" y1="8" x2="12" y2="12"/>
                                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                                    </svg>
                                    {error}
                                </div>
                            )}

                            <div className="oauth-buttons-container">
                                <GoogleSignInButton text="Continue with Google" />
                                <FacebookSignInButton text="Continue with Facebook" />
                            </div>

                            <div className="oauth-divider">
                                <span>or continue with email</span>
                            </div>

                            <div className="input-group">
                                <label>Email address</label>
                                <input
                                    type="email"
                                    placeholder='you@example.com'
                                    value={loginEmail}
                                    onChange={handleEmailChange}
                                    disabled={loading}
                                    required
                                />
                            </div>

                            <div className="input-group password-group">
                                <label>Password</label>
                                <div className="password-input-wrapper">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        placeholder='Enter your password'
                                        value={loginPassword}
                                        onChange={handlePasswordChange}
                                        disabled={loading}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={togglePasswordVisibility}
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
                            </div>

                            <button
                                className="auth-submit-btn"
                                disabled={loading || !loginEmail.trim() || !loginPassword.trim()}
                            >
                                {loading ? (
                                    <span className="button-loading">
                                        <svg className="spinner" viewBox="0 0 24 24">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25"/>
                                            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"/>
                                        </svg>
                                        Signing in...
                                    </span>
                                ) : 'Sign in'}
                            </button>

                            <div className="form-footer">
                                <p className="form-link">
                                    <Link to='/password/forgot'>Forgot your password?</Link>
                                </p>
                                <p className="form-link">
                                    Don't have an account?{' '}
                                    <Link to='/register' className="highlight-link">Sign up</Link>
                                </p>
                            </div>
                        </form>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default Login;