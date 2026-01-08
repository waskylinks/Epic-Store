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

    const { error, loading, success, isAuthenticated, needsVerification, verificationEmail } = useSelector(state => state.user);
    const location = useLocation();
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const redirect = new URLSearchParams(location.search).get('redirect') || '/';

    const logInSubmit = (e) => {
        e.preventDefault();
        if (!loginEmail || !loginPassword) return;

        dispatch(login({ email: loginEmail, password: loginPassword }));
    };

    const togglePasswordVisibility = () => setShowPassword(!showPassword);

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

    // Clear errors on unmount
    useEffect(() => {
        return () => {
            dispatch(removeErrors());
        };
    }, [dispatch]);

    // Clear success on unmount
    useEffect(() => {
        return () => {
            dispatch(removeSuccess());
        };
    }, [dispatch]);

    return (
        <div className="form-container container">
            <div className="form-content">
                <form className='form' onSubmit={logInSubmit}>
                    <h2>Sign In</h2>

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
                            onChange={(e) => setLoginEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group password-group">
                        <input 
                            type={showPassword ? "text" : "password"} 
                            placeholder='Password' 
                            value={loginPassword} 
                            onChange={(e) => setLoginPassword(e.target.value)}
                            required
                        />
                        <button
                            type="button"
                            className="password-toggle"
                            onClick={togglePasswordVisibility}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                            {showPassword ? '👁️' : '👁️‍🗨️'}
                        </button>
                    </div>

                    <button className="authBtn" disabled={loading}>
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
