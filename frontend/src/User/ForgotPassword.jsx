import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { forgotPassword, removeErrors, removeSuccess } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

function ForgotPassword() {
    const { loading, error, success, message } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [email, setEmail] = useState('');

    const validateEmail = (email) => {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };

    const forgotPasswordEmail = (e) => {
        e.preventDefault();
        
        // Clear any previous errors
        dispatch(removeErrors());

        if (!email.trim()) {
            return toast.error("Please enter your registered email", { 
                position: "top-center", 
                autoClose: 2000 
            });
        }

        if (!validateEmail(email.trim())) {
            return toast.error("Please enter a valid email address", { 
                position: "top-center", 
                autoClose: 2000 
            });
        }

        dispatch(forgotPassword(email.trim()));
    };

    // Clear error when user starts typing
    const handleEmailChange = (e) => {
        setEmail(e.target.value);
        if (error) {
            dispatch(removeErrors());
        }
    };

    // Handle error display
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [error, dispatch]);
    
    // Handle success and navigation
    useEffect(() => {
        if (success && message) {
            toast.success(message, { 
                position: 'top-center', 
                autoClose: 3000 
            });
            dispatch(removeSuccess());
            // Navigate to code verification page with email
            setTimeout(() => {
                navigate('/password/verify-code', { state: { email: email.trim() } });
            }, 500);
        }
    }, [success, message, navigate, email, dispatch]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            dispatch(removeErrors());
            dispatch(removeSuccess());
        };
    }, [dispatch]);

    return (
        <>
            <PageTitle title='Forgot Password'/>
            <Navbar />

            <div className="container forgot-container">
                <div className="form-content email-group">
                    <form className="form" onSubmit={forgotPasswordEmail}>
                        <div className="verification-header">
                            <div className="verification-icon">🔐</div>
                            <h2>Forgot Password</h2>
                            <p className="verification-text">
                                Enter your registered email address and<br />
                                we'll send you a verification code
                            </p>
                        </div>

                        <div className="input-group">
                            <input 
                                type="email" 
                                placeholder='Enter your registered email' 
                                name='email'
                                value={email}
                                onChange={handleEmailChange}
                                required
                                disabled={loading}
                                autoComplete="email"
                            />
                        </div>

                        <button 
                            className="authBtn" 
                            disabled={loading || !email.trim()}
                        >
                            {loading ? 'Sending...' : 'Send Reset Code'}
                        </button>

                        <p className="form-links">
                            Remember your password? 
                            <button 
                                type="button"
                                onClick={() => navigate('/login')}
                                className="link-btn"
                                disabled={loading}
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

export default ForgotPassword;