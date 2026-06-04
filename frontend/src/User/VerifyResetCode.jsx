import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
    forgotPassword,
    verifyResetCode,
    clearCodeVerifiedState,
    removeErrors,
    removeSuccess,
} from '../features/products/userSlice';
import { toast } from 'react-toastify';
import '../UserStyles/Register.css';

/* ─── SLIDES ─────────────────────────────────────────────────────────────── */
const SLIDES = [
    {
        imageSrc: '/images/1.png',
        hint:     'Lifestyle / hero product shot',
        tag:      'New arrivals weekly',
        headline: 'Your next favourite store.',
        sub:      'Thousands of curated products, always a discovery away.',
        accent:   '#1D9E75',
    },
    {
        imageSrc: '/images/2.png',
        hint:     'Order tracking / mobile UX shot',
        tag:      'Real-time tracking',
        headline: 'Know where every order is.',
        sub:      'Live updates from warehouse to doorstep, no guesswork.',
        accent:   '#378ADD',
    },
    {
        imageSrc: '/images/3.png',
        hint:     'Security / encrypted payments',
        tag:      'Bank-grade security',
        headline: 'Shop with total confidence.',
        sub:      'End-to-end encryption keeps your data and payments safe.',
        accent:   '#8B5CF6',
    },
    {
        imageSrc: '/images/4.png',
        hint:     'Fast delivery lifestyle shot',
        tag:      'Smart shipping',
        headline: 'Delivered on your terms.',
        sub:      'Flexible shipping options and smart address defaults.',
        accent:   '#EF9F27',
    },
];

/* ─── CAROUSEL ───────────────────────────────────────────────────────────── */
function LeftCarousel() {
    const [active, setActive] = useState(0);
    const [prev,   setPrev]   = useState(null);
    const [dir,    setDir]    = useState('next');
    const timerRef            = useRef(null);
    const count               = SLIDES.length;

    const goTo = (idx, direction = 'next') => {
        if (idx === active) return;
        setPrev(active);
        setDir(direction);
        setActive(idx);
    };

    const next  = () => goTo((active + 1) % count, 'next');
    const prev_ = () => goTo((active - 1 + count) % count, 'prev');

    useEffect(() => {
        timerRef.current = setInterval(next, 5000);
        return () => clearInterval(timerRef.current);
    }, [active]);

    const slide = SLIDES[active];

    return (
        <div className="reg-carousel" aria-label="Store highlights">
            <div className="reg-carousel-track">
                {SLIDES.map((s, i) => (
                    <div
                        key={i}
                        className={`reg-carousel-slide${i === active ? ' is-active' : ''}${i === prev ? ` is-leaving is-leaving--${dir}` : ''}`}
                        aria-hidden={i !== active}
                    >
                        {s.imageSrc ? (
                            <img src={s.imageSrc} alt={s.hint} className="reg-carousel-img" loading="lazy" />
                        ) : (
                            <div className="reg-carousel-placeholder">
                                <div className="reg-carousel-placeholder-inner">
                                    <i className="ti ti-photo" aria-hidden="true" />
                                    <span>{s.hint}</span>
                                </div>
                            </div>
                        )}
                        <div className="reg-carousel-overlay" />
                    </div>
                ))}
            </div>

            <div className="reg-carousel-brand">
                <span className="reg-brand-e">Epic</span>
                <span className="reg-brand-s">Store</span>
            </div>

            <div className="reg-carousel-copy" key={active}>
                <span className="reg-carousel-tag" style={{ '--slide-accent': slide.accent }}>
                    {slide.tag}
                </span>
                <h2 className="reg-carousel-headline">{slide.headline}</h2>
                <p  className="reg-carousel-sub">{slide.sub}</p>
            </div>

            <button className="reg-carousel-arrow reg-carousel-arrow--prev" onClick={prev_} aria-label="Previous slide">
                <i className="ti ti-chevron-left" aria-hidden="true" />
            </button>
            <button className="reg-carousel-arrow reg-carousel-arrow--next" onClick={next} aria-label="Next slide">
                <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>

            <div className="reg-carousel-dots" role="tablist" aria-label="Slide indicators">
                {SLIDES.map((_, i) => (
                    <button
                        key={i}
                        role="tab"
                        aria-selected={i === active}
                        aria-label={`Go to slide ${i + 1}`}
                        className={`reg-carousel-dot${i === active ? ' is-active' : ''}`}
                        onClick={() => goTo(i, i > active ? 'next' : 'prev')}
                    />
                ))}
            </div>

            <div className="reg-carousel-progress" key={`p-${active}`}>
                <div className="reg-carousel-progress-fill" />
            </div>
        </div>
    );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────────────────── */
const RESEND_SECONDS = 90;

export default function VerifyResetCode() {
    const [code,      setCode]      = useState(['', '', '', '', '', '']);
    const [timeLeft,  setTimeLeft]  = useState(RESEND_SECONDS);
    const [canResend, setCanResend] = useState(false);
    const [verified,  setVerified]  = useState(false);

    const inputRefs = useRef([]);

    const { error, loading, success, message, codeVerified } =
        useSelector(state => state.user);

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();

    const email = location.state?.email;

    /* ── Guard: must arrive from ForgotPassword ── */
    useEffect(() => {
        if (!email) {
            toast.error('Please request a password reset first', {
                position: 'top-center',
                autoClose: 2000,
            });
            navigate('/password/forgot');
        }
    }, [email, navigate]);

    /* ── Countdown ── */
    useEffect(() => {
        if (timeLeft > 0) {
            const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
            return () => clearTimeout(t);
        } else {
            setCanResend(true);
        }
    }, [timeLeft]);

    const formatTime = (s) =>
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    /* ── Code input handlers ── */
    const handleChange = (index, value) => {
        if (!/^\d?$/.test(value)) return;
        const next = [...code];
        next[index] = value;
        setCode(next);
        if (value && index < 5) inputRefs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !code[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (!pasted) return;
        const next = [...pasted.split(''), ...Array(6 - pasted.length).fill('')];
        setCode(next);
        inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    };

    /* ── Submit ── */
    const handleSubmit = (e) => {
        e.preventDefault();
        const joined = code.join('');
        if (joined.length !== 6) {
            toast.error('Please enter the complete 6-digit code', {
                position: 'top-center',
                autoClose: 2000,
            });
            return;
        }
        if (!email) {
            toast.error('Email not found. Please request a reset again.', {
                position: 'top-center',
                autoClose: 2000,
            });
            navigate('/password/forgot');
            return;
        }
        dispatch(verifyResetCode({ email, code: joined }));
    };

    /* ── Resend ── */
    const handleResend = () => {
        if (!canResend) return;
        if (!email) {
            navigate('/password/forgot');
            return;
        }
        dispatch(forgotPassword(email));
        setTimeLeft(RESEND_SECONDS);
        setCanResend(false);
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
    };

    /* ── Effects ── */
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setCode(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
        }
    }, [error, dispatch]);

    /* Resend success toast — only when not yet verified */
    useEffect(() => {
        if (success && message && !codeVerified) {
            toast.success(message, { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
        }
    }, [success, message, codeVerified, dispatch]);

    /* Code verified — show success card then navigate */
    useEffect(() => {
        if (codeVerified) {
            setVerified(true);
            const resetCode = code.join('');
            const t = setTimeout(() => {
                dispatch(clearCodeVerifiedState());
                navigate('/password/new', {
                    state: { email, code: resetCode, verified: true },
                });
            }, 2000);
            return () => clearTimeout(t);
        }
    }, [codeVerified, code, email, navigate, dispatch]);

    useEffect(() => () => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
    }, [dispatch]);

    const isComplete = code.every(d => d !== '');

    return (
        <div className="reg-page">

            {/* ── LEFT: carousel ── */}
            <aside className="reg-left" aria-label="Store highlights">
                <LeftCarousel />
            </aside>

            {/* ── RIGHT: form ── */}
            <main className="reg-right">
                <div className="reg-form-wrap">

                    {/* Mobile brand */}
                    <div className="reg-mobile-brand" aria-label="Epic Store">
                        <span className="reg-brand-e">Epic</span>
                        <span className="reg-brand-s">Store</span>
                    </div>

                    {/* Header */}
                    <div className="vrc-header">
                        <div className="vrc-icon-wrap" aria-hidden="true">
                            <i className="ti ti-shield-check" />
                        </div>
                        <h1 className="vrc-title">Enter your reset code</h1>
                        <p className="vrc-subtitle">
                            We sent a 6-digit code to<br />
                            <strong>{email}</strong>
                        </p>
                    </div>

                    {/* ── Success state ── */}
                    {verified ? (
                        <div className="vrc-success-card" role="status" aria-live="polite">
                            <div className="vrc-success-icon">
                                <i className="ti ti-circle-check" aria-hidden="true" />
                            </div>
                            <p className="vrc-success-title">Code verified!</p>
                            <p className="vrc-success-text">
                                Taking you to set your new password&hellip;
                            </p>
                            <span className="reg-spinner" aria-hidden="true" style={{ marginTop: 4 }} />
                        </div>
                    ) : (
                        <>
                            {/* Form card */}
                            <div className="reg-form-card">
                                <form onSubmit={handleSubmit} noValidate>

                                    {/* Code inputs */}
                                    <div
                                        className="code-input-group"
                                        role="group"
                                        aria-label="6-digit reset code"
                                    >
                                        {code.map((digit, i) => (
                                            <input
                                                key={i}
                                                ref={el => (inputRefs.current[i] = el)}
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={1}
                                                value={digit}
                                                placeholder="·"
                                                onChange={e => handleChange(i, e.target.value)}
                                                onKeyDown={e => handleKeyDown(i, e)}
                                                onPaste={handlePaste}
                                                className="code-input"
                                                disabled={loading}
                                                autoFocus={i === 0}
                                                aria-label={`Digit ${i + 1}`}
                                            />
                                        ))}
                                    </div>

                                    {/* Timer */}
                                    <div className="ver-timer-section">
                                        <div className={`ver-timer${timeLeft <= 10 && timeLeft > 0 ? ' is-warning' : ''}`}>
                                            <i className="ti ti-clock" aria-hidden="true" />
                                            {timeLeft > 0
                                                ? `Code expires in ${formatTime(timeLeft)}`
                                                : 'Code expired'}
                                        </div>
                                        {timeLeft === 0 && (
                                            <span className="ver-timer-expired">
                                                Request a new code below
                                            </span>
                                        )}
                                    </div>

                                    {/* Submit */}
                                    <div className="reg-actions" style={{ marginTop: 0 }}>
                                        <button
                                            type="submit"
                                            className="reg-btn-next"
                                            disabled={loading || !isComplete}
                                        >
                                            {loading ? (
                                                <>
                                                    <span className="reg-spinner" aria-hidden="true" />
                                                    Verifying&hellip;
                                                </>
                                            ) : (
                                                <>
                                                    <i className="ti ti-shield-check" aria-hidden="true" />
                                                    Verify Code
                                                </>
                                            )}
                                        </button>
                                    </div>

                                </form>
                            </div>

                            {/* Resend */}
                            <div className="ver-resend-section">
                                <p className="ver-resend-label">Didn't receive the code?</p>
                                <button
                                    type="button"
                                    onClick={handleResend}
                                    disabled={!canResend || loading}
                                    className={`ver-resend-btn${canResend ? ' is-ready' : ''}`}
                                >
                                    {canResend
                                        ? 'Resend Code'
                                        : `Resend available in ${formatTime(timeLeft)}`}
                                </button>
                            </div>

                            {/* Back link */}
                            <p className="ver-link-row">
                                Wrong email?
                                <button
                                    type="button"
                                    className="ver-link-btn"
                                    disabled={loading}
                                    onClick={() => navigate('/password/forgot')}
                                >
                                    Start over
                                </button>
                            </p>
                        </>
                    )}

                </div>
            </main>

        </div>
    );
}