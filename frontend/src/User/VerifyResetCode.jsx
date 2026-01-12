import React, { useEffect, useState, useRef } from 'react';
import '../UserStyles/Form.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { 
    removeErrors, 
    removeSuccess,
    forgotPassword, 
    verifyResetCode,
    clearCodeVerifiedState 
} from '../features/products/userSlice';
import { toast } from 'react-toastify';

function VerifyResetCode() {
    // ✅ Get all necessary state from Redux
    const { error, loading, success, message, codeVerified } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();

    const [code, setCode] = useState(['', '', '', '', '', '']);
    const [timeLeft, setTimeLeft] = useState(90);
    const [canResend, setCanResend] = useState(false);
    const inputRefs = useRef([]);

    const email = location.state?.email;

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

        if (value !== '' && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
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

    // ✅ FIXED: Use Redux action instead of direct axios
    const verifyCodeSubmit = (e) => {
        e.preventDefault();
        
        const resetCode = code.join('');
        
        if (resetCode.length !== 6) {
            toast.error('Please enter the complete 6-digit code', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            return;
        }

        if (!email) {
            toast.error('Email not found. Please request password reset again.', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            navigate('/password/forgot');
            return;
        }

        // ✅ Use Redux slice action
        dispatch(verifyResetCode({ email, code: resetCode }));
    };

    // ✅ FIXED: Proper resend with success handling
    const handleResend = () => {
        if (!canResend) return;
        
        if (!email) {
            toast.error('Email not found', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            navigate('/password/forgot');
            return;
        }

        dispatch(forgotPassword(email));
        setTimeLeft(90);
        setCanResend(false);
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
    };

    // ✅ Handle errors
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            // Reset code inputs on error
            setCode(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
        }
    }, [dispatch, error]);

    // ✅ Handle resend success (shows toast for password reset code sent)
    useEffect(() => {
        if (success && message && !codeVerified) {
            toast.success(message, { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
        }
    }, [success, message, codeVerified, dispatch]);

    // ✅ FIXED: Navigate when code is verified
    useEffect(() => {
        if (codeVerified) {
            toast.success('Code verified! Please enter your new password.', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            
            const resetCode = code.join('');
            
            // Small delay for toast to show before navigation
            const timer = setTimeout(() => {
                navigate('/password/new', { 
                    state: { 
                        email, 
                        code: resetCode,
                        verified: true 
                    } 
                });
                dispatch(clearCodeVerifiedState());
            }, 2000);
            
            return () => clearTimeout(timer);
        }
    }, [codeVerified, email, code, navigate, dispatch]);

    // Redirect if no email
    useEffect(() => {
        if (!email) {
            toast.error('Please request password reset first', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            navigate('/password/forgot');
        }
    }, [email, navigate]);

    return (
        <>
            <PageTitle title='Verify Reset Code'/>
            <Navbar />

            <div className="container update-container">
                <div className="form-content">
                    <form className="form" onSubmit={verifyCodeSubmit}>
                        <div className="verification-header">
                            <div className="verification-icon">🔐</div>
                            <h2>Verify Code</h2>
                            <p className="verification-text">
                                Enter the 6-digit code sent to<br />
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
                            {loading ? 'Verifying...' : 'Verify Code'}
                        </button>

                        <div className="resend-section">
                            <p>Didn't receive the code?</p>
                            <button
                                type="button"
                                onClick={handleResend}
                                className="resend-btn"
                                disabled={!canResend || loading}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: canResend ? '#667eea' : '#999',
                                    cursor: canResend ? 'pointer' : 'not-allowed',
                                    textDecoration: 'underline',
                                    fontSize: '14px',
                                    marginTop: '10px'
                                }}
                            >
                                {canResend ? 'Resend Code' : `Resend in ${formatTime(timeLeft)}`}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default VerifyResetCode;