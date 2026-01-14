import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import '../UserStyles/OAuthButtons.css';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { login, removeErrors, removeSuccess, clearVerificationState } from '../features/products/userSlice';
import GoogleSignInButton from '../components/GoogleSignInButton';
import FacebookSignInButton from '../components/FacebookSignInButton';

function Login() {
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const { error, loading, isAuthenticated, needsVerification, verificationEmail } = useSelector(state => state.user);
    const location = useLocation();
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const redirect = new URLSearchParams(location.search).get('redirect') || '/';

    const logInSubmit = (e) => {
        e.preventDefault();
        
        // Clear any previous errors
        dispatch(removeErrors());
        
        // Basic validation
        if (!loginEmail.trim() || !loginPassword.trim()) {
            return;
        }

        dispatch(login({ email: loginEmail.trim(), password: loginPassword }));
    };

    const togglePasswordVisibility = () => setShowPassword(!showPassword);

    // Clear errors when user starts typing
    const handleEmailChange = (e) => {
        setLoginEmail(e.target.value);
        if (error) {
            dispatch(removeErrors());
        }
    };

    const handlePasswordChange = (e) => {
        setLoginPassword(e.target.value);
        if (error) {
            dispatch(removeErrors());
        }
    };

    // Redirect if login fails due to unverified email
    useEffect(() => {
        if (needsVerification && verificationEmail) {
            navigate('/verify-email', { state: { email: verificationEmail } });
            dispatch(clearVerificationState());
        }
    }, [needsVerification, verificationEmail, navigate, dispatch]);

    // Redirect after successful login
    useEffect(() => {
        if (isAuthenticated) {
            navigate(redirect);
        }
    }, [isAuthenticated, redirect, navigate]);

    // Cleanup on mount and unmount
    useEffect(() => {
        // Clear errors on mount
        dispatch(removeErrors());
        dispatch(removeSuccess());

        return () => {
            // Clear errors on unmount
            dispatch(removeErrors());
            dispatch(removeSuccess());
        };
    }, [dispatch]);

    return (
        <div className="form-container container">
            <div className="form-content">
                <form className='form' onSubmit={logInSubmit}>
                    {/* Brand Header */}
                    <div className="brand-header">
                        <h1 className="brand-name">
                            <span className="brand-epic">Epic</span>
                            <span className="brand-store">Store</span>
                        </h1>
                        <p className="brand-tagline">Welcome back</p>
                    </div>

                    {/* Error message */}
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

                    {/* OAuth Buttons */}
                    <div className="oauth-buttons-container">
                        <GoogleSignInButton text="Continue with Google" />
                        <FacebookSignInButton text="Continue with Facebook" />
                    </div>

                    {/* Divider */}
                    <div className="oauth-divider">
                        <span>or continue with email</span>
                    </div>

                    {/* Email/Password Login */}
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

                    <button className="authBtn" disabled={loading || !loginEmail.trim() || !loginPassword.trim()}>
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

                    <p className="form-links">
                        Forgot your password? 
                        <Link to='/password/forgot'>Reset here</Link>
                    </p>

                    <p className="form-links">
                        Don't have an account?
                        <Link to='/register'>Sign up</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default Login;