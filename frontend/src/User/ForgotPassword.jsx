import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { forgotPassword, removeErrors, removeSuccess } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { useNavigate } from 'react-router-dom';

function ForgotPassword() {
    const { loading, error, success, message } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [email, setEmail] = useState('');

    const forgotPasswordEmail = (e) => {
        e.preventDefault();
        if (!email) {
            return toast.error("Please enter your registered email", { position: "top-center", autoClose: 2000 });
        }

        dispatch(forgotPassword({ email }));
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);
    
    useEffect(() => {
        if (success) {
            toast.success(message || "Reset code sent to your email", { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            // Navigate to reset password page with email
            navigate('/password/reset', { state: { email } });
        }
    }, [dispatch, success, message, navigate, email]);

    return (
        <>
            {loading ? (<Loader />) : (
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
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>

                                <button className="authBtn" disabled={loading}>
                                    {loading ? 'Sending...' : 'Send Reset Code'}
                                </button>

                                <p className="form-links">
                                    Remember your password? 
                                    <button 
                                        type="button"
                                        onClick={() => navigate('/login')}
                                        className="link-btn"
                                    >
                                        Sign in here
                                    </button>
                                </p>
                            </form>
                        </div>
                    </div>

                    <Footer />
                </>
            )}
        </>
    );
}

export default ForgotPassword;