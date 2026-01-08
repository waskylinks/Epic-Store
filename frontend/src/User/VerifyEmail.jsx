import React, { useEffect, useState, useRef } from 'react';
import '../UserStyles/Form.css';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { verifyEmail, resendVerificationCode, removeErrors, removeSuccess, clearVerificationState } from '../features/products/userSlice';
import { toast } from 'react-toastify';

function VerifyEmail() {
    const [code, setCode] = useState(['', '', '', '', '', '']);
    const [timeLeft, setTimeLeft] = useState(90); // 90 seconds
    const [canResend, setCanResend] = useState(false);
    const inputRefs = useRef([]);

    const { error, loading, success, message, verificationEmail, isAuthenticated } = useSelector(state => state.user);
    const location = useLocation();
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const email = verificationEmail || location.state?.email;

    // Countdown timer
    useEffect(() => {
        if (timeLeft > 0) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            setCanResend(true);
        }
    }, [timeLeft]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleChange = (index, value) => {
        if (isNaN(value)) return;
        const newCode = [...code];
        newCode[index] = value;
        setCode(newCode);
        if (value !== '' && index < 5) inputRefs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !code[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const pasteData = e.clipboardData.getData('text').slice(0, 6);
        if (/^\d+$/.test(pasteData)) {
            const newCode = pasteData.split('');
            setCode([...newCode, ...Array(6 - newCode.length).fill('')]);
            inputRefs.current[Math.min(pasteData.length, 5)]?.focus();
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const verificationCode = code.join('');
        if (verificationCode.length !== 6) {
            toast.error('Please enter the complete 6-digit code', { position: 'top-center', autoClose: 2000 });
            return;
        }
        if (!email) {
            toast.error('Email not found. Please register again.', { position: 'top-center', autoClose: 2000 });
            navigate('/register');
            return;
        }
        dispatch(verifyEmail({ email, code: verificationCode }));
    };

    const handleResend = () => {
        if (!canResend) return;
        if (!email) {
            toast.error('Email not found. Please register again.', { position: 'top-center', autoClose: 2000 });
            navigate('/register');
            return;
        }
        dispatch(resendVerificationCode(email));
        setTimeLeft(90);
        setCanResend(false);
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
    };

    // Handle errors
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    // Show success toast for resend only
    useEffect(() => {
        if (success && message?.includes('verification code sent')) {
            toast.success(message, { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
        }
    }, [success, message, dispatch]);

    // Auto redirect after successful verification (backend already logged user in)
    useEffect(() => {
        if (isAuthenticated && success && !message?.includes('verification code sent')) {
            toast.success('Email verified successfully! Redirecting...', { 
                position: 'top-center', 
                autoClose: 1500 
            });
            
            dispatch(clearVerificationState());
            
            const timer = setTimeout(() => {
                navigate('/');
            }, 1500);
            
            return () => clearTimeout(timer);
        }
    }, [isAuthenticated, success, message, dispatch, navigate]);

    // Redirect if no email
    useEffect(() => {
        if (!email) {
            toast.error('Please register first', { position: 'top-center', autoClose: 2000 });
            navigate('/register');
        }
    }, [email, navigate]);

    return (
        <div className="form-container container">
            <div className="form-content">
                <form className='form verification-form' onSubmit={handleSubmit}>
                    <div className="verification-header">
                        <div className="verification-icon">✉️</div>
                        <h2>Verify Your Email</h2>
                        <p className="verification-text">
                            We've sent a 6-digit code to<br />
                            <strong>{email}</strong>
                        </p>
                    </div>

                    <div className="code-input-group">
                        {code.map((digit, index) => (
                            <input
                                key={index}
                                ref={(el) => (inputRefs.current[index] = el)}
                                type="text"
                                maxLength="1"
                                value={digit}
                                onChange={(e) => handleChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                onPaste={handlePaste}
                                className="code-input"
                                disabled={loading}
                                autoFocus={index === 0}
                            />
                        ))}
                    </div>

                    <div className="timer-section">
                        <div className={`timer ${timeLeft <= 10 ? 'timer-warning' : ''}`}>
                            ⏱️ {formatTime(timeLeft)}
                        </div>
                        {timeLeft === 0 && (
                            <p className="timer-expired">Code expired!</p>
                        )}
                    </div>

                    <button 
                        type="submit" 
                        className="authBtn" 
                        disabled={loading || code.some(d => d === '')}
                    >
                        {loading ? 'Verifying...' : 'Verify Email'}
                    </button>

                    <div className="resend-section">
                        <p>Didn't receive the code?</p>
                        <button
                            type="button"
                            onClick={handleResend}
                            className="resend-btn"
                            disabled={!canResend || loading}
                        >
                            {canResend ? 'Resend Code' : `Resend in ${formatTime(timeLeft)}`}
                        </button>
                    </div>

                    <p className="form-links">
                        Wrong email? 
                        <button 
                            type="button"
                            onClick={() => {
                                dispatch(clearVerificationState());
                                navigate('/register');
                            }}
                            className="link-btn"
                        >
                            Register again
                        </button>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default VerifyEmail;