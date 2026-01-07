import React, { useEffect, useState, useRef } from 'react';
import '../UserStyles/Form.css';
import PageTitle from '../components/PageTitle';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { removeErrors, removeSuccess, resetPassword, forgotPassword } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function ResetPassword() {
    const { success, loading, error } = useSelector((state) => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();

    const [code, setCode] = useState(['', '', '', '', '', '']);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [timeLeft, setTimeLeft] = useState(90); // 90 seconds
    const [canResend, setCanResend] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState('');
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

    // Format time
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

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

    // Handle code input
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

    const resetPasswordSubmit = (e) => {
        e.preventDefault();
        
        const resetCode = code.join('');
        
        if (resetCode.length !== 6) {
            toast.error('Please enter the complete 6-digit code', { position: 'top-center', autoClose: 2000 });
            return;
        }

        if (!email) {
            toast.error('Email not found. Please request password reset again.', { position: 'top-center', autoClose: 2000 });
            navigate('/password/forgot');
            return;
        }

        if (password !== confirmPassword) {
            toast.error('Passwords do not match', { position: 'top-center', autoClose: 2000 });
            return;
        }

        if (password.length < 12) {
            toast.error('Password must be at least 12 characters', { position: 'top-center', autoClose: 2000 });
            return;
        }

        dispatch(resetPassword({
            email,
            code: resetCode,
            password,
            confirmPassword
        }));
    };

    // Resend code
    const handleResend = () => {
        if (!canResend) return;
        
        if (!email) {
            toast.error('Email not found', { position: 'top-center', autoClose: 2000 });
            navigate('/password/forgot');
            return;
        }

        dispatch(forgotPassword({ email }));
        setTimeLeft(90);
        setCanResend(false);
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (success) {
            toast.success('Password reset successful! Please login with your new password.', { 
                position: 'top-center', 
                autoClose: 2000 
            });
            dispatch(removeSuccess());
            navigate('/login');
        }
    }, [dispatch, success, navigate]);

    useEffect(() => {
        if (!email) {
            toast.error('Please request password reset first', { position: 'top-center', autoClose: 2000 });
            navigate('/password/forgot');
        }
    }, [email, navigate]);

    useEffect(() => {
        setPasswordStrength(calculatePasswordStrength(password));
    }, [password]);

    const getStrengthColor = () => {
        switch (passwordStrength) {
            case 'weak': return '#f44336';
            case 'medium': return '#ff9800';
            case 'strong': return '#2196f3';
            case 'very-strong': return '#4caf50';
            default: return '#ccc';
        }
    };

    return (
        <>
            {loading ? (<Loader />) : (
                <>
                    <PageTitle title='Reset Password'/>
                    <div className="container update-container">
                        <div className="form-content">
                            <form className="form" onSubmit={resetPasswordSubmit}>
                                <div className="verification-header">
                                    <div className="verification-icon">🔐</div>
                                    <h2>Reset Password</h2>
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

                                <div className="input-group password-group">
                                    <input 
                                        type={showPassword ? "text" : "password"}
                                        name='password'
                                        placeholder='Enter New Password (min 12 characters)'
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>

                                {password && (
                                    <div className="password-strength">
                                        <div className="strength-bar-container">
                                            <div 
                                                className="strength-bar"
                                                style={{
                                                    width: `${passwordStrength === 'weak' ? 25 : passwordStrength === 'medium' ? 50 : passwordStrength === 'strong' ? 75 : 100}%`,
                                                    backgroundColor: getStrengthColor()
                                                }}
                                            ></div>
                                        </div>
                                        <span className="strength-text" style={{ color: getStrengthColor() }}>
                                            {passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1).replace('-', ' ')}
                                        </span>
                                    </div>
                                )}

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

                                <button className="authBtn" disabled={loading || code.some(d => d === '')}>
                                    {loading ? 'Resetting...' : 'Reset Password'}
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
                            </form>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

export default ResetPassword;