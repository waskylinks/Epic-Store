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
                    <h2>Sign In</h2>

                    {/* Error message */}
                    {error && (
                        <div className="error-message" style={{
                            padding: '12px',
                            marginBottom: '15px',
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            borderRadius: '6px',
                            border: '1px solid #fecaca',
                            fontSize: '14px'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* OAuth Buttons */}
                    <div className="oauth-buttons-container">
                        <GoogleSignInButton text="Sign in with Google" />
                        <FacebookSignInButton text="Sign in with Facebook" />
                    </div>

                    {/* Divider */}
                    <div className="oauth-divider">
                        <span>OR</span>
                    </div>

                    {/* Email/Password Login */}
                    <div className="input-group">
                        <input 
                            type="email" 
                            placeholder='Email' 
                            value={loginEmail} 
                            onChange={handleEmailChange}
                            disabled={loading}
                            required
                        />
                    </div>

                    <div className="input-group password-group">
                        <input 
                            type={showPassword ? "text" : "password"} 
                            placeholder='Password' 
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
                        {loading ? 'Signing In...' : 'Sign In'}
                    </button>

                    <p className="form-links">
                        Forgot your password? 
                        <Link to='/password/forgot'> Reset Here</Link>
                    </p>

                    <p className="form-links">
                        Don't have an account?
                        <Link to='/register'> Sign up Here</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default Login;