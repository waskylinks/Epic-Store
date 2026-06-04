import React, { useEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { login, removeErrors, removeSuccess, clearVerificationState } from '../features/products/userSlice';
import { syncServerCart } from '../features/cart/cartSlice';
import GoogleSignInButton from '../components/GoogleSignInButton';
import FacebookSignInButton from '../components/FacebookSignInButton';
import '../UserStyles/Register.css';

/* ─── CAROUSEL SLIDES ────────────────────────────────────────────────────────
   Same slide config as Register — swap imageSrc for your actual paths.
   Keep in sync with Register.jsx SLIDES if you centralise them later.
────────────────────────────────────────────────────────────────────────────── */
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

/* ─── CAROUSEL (identical logic to Register) ───────────────────────────────── */
function LeftCarousel() {
    const [active, setActive] = useState(0);
    const [prev, setPrev]     = useState(null);
    const [dir, setDir]       = useState('next');
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
            {/* ── Image layer ── */}
            <div className="reg-carousel-track">
                {SLIDES.map((s, i) => (
                    <div
                        key={i}
                        className={`reg-carousel-slide${i === active ? ' is-active' : ''}${i === prev ? ` is-leaving is-leaving--${dir}` : ''}`}
                        aria-hidden={i !== active}
                    >
                        {s.imageSrc ? (
                            <img
                                src={s.imageSrc}
                                alt={s.hint}
                                className="reg-carousel-img"
                                loading="lazy"
                            />
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

            {/* ── Brand mark ── */}
            <div className="reg-carousel-brand">
                <span className="reg-brand-e">Epic</span>
                <span className="reg-brand-s">Store</span>
            </div>

            {/* ── Copy block ── */}
            <div className="reg-carousel-copy" key={active}>
                <span className="reg-carousel-tag" style={{ '--slide-accent': slide.accent }}>
                    {slide.tag}
                </span>
                <h2 className="reg-carousel-headline">{slide.headline}</h2>
                <p  className="reg-carousel-sub">{slide.sub}</p>
            </div>

            {/* ── Arrow nav ── */}
            <button className="reg-carousel-arrow reg-carousel-arrow--prev" onClick={prev_} aria-label="Previous slide">
                <i className="ti ti-chevron-left" aria-hidden="true" />
            </button>
            <button className="reg-carousel-arrow reg-carousel-arrow--next" onClick={next} aria-label="Next slide">
                <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>

            {/* ── Dots ── */}
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

            {/* ── Progress bar ── */}
            <div className="reg-carousel-progress" key={`p-${active}`}>
                <div className="reg-carousel-progress-fill" />
            </div>
        </div>
    );
}

/* ─── MAIN COMPONENT ───────────────────────────────────────────────────────── */
export default function Login() {
    const [loginEmail,    setLoginEmail]    = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [showPassword,  setShowPassword]  = useState(false);
    const [touched,       setTouched]       = useState({ email: false, password: false });

    const { error, loading, isAuthenticated, needsVerification, verificationEmail } =
        useSelector(state => state.user);

    const location = useLocation();
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const redirect = new URLSearchParams(location.search).get('redirect') || '/';

    const canSubmit = loginEmail.trim() !== '' && loginPassword.trim() !== '';

    const logInSubmit = (e) => {
        e.preventDefault();
        dispatch(removeErrors());
        if (!canSubmit) return;
        dispatch(login({ email: loginEmail.trim(), password: loginPassword }));
    };

    const handleEmailChange = (e) => {
        setLoginEmail(e.target.value);
        if (error) dispatch(removeErrors());
    };

    const handlePasswordChange = (e) => {
        setLoginPassword(e.target.value);
        if (error) dispatch(removeErrors());
    };

    /* Redirect to email verification if account is unverified */
    useEffect(() => {
        if (needsVerification && verificationEmail) {
            navigate('/verify-email', { state: { email: verificationEmail } });
            dispatch(clearVerificationState());
        }
    }, [needsVerification, verificationEmail, navigate, dispatch]);

    /* After login: sync server cart then redirect */
    useEffect(() => {
        if (isAuthenticated) {
            dispatch(syncServerCart()).finally(() => navigate(redirect));
        }
    }, [isAuthenticated, redirect, navigate, dispatch]);

    /* Cleanup on mount/unmount */
    useEffect(() => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
        return () => {
            dispatch(removeErrors());
            dispatch(removeSuccess());
        };
    }, [dispatch]);

    return (
        <div className="reg-page">

            {/* ── LEFT: carousel (hidden on mobile) ── */}
            <aside className="reg-left" aria-label="Store highlights">
                <LeftCarousel />
            </aside>

            {/* ── RIGHT: login form ── */}
            <main className="reg-right">
                <div className="reg-form-wrap">

                    {/* Mobile brand */}
                    <div className="reg-mobile-brand" aria-label="Epic Store">
                        <span className="reg-brand-e">Epic</span>
                        <span className="reg-brand-s">Store</span>
                    </div>

                    {/* Header */}
                    <div className="reg-header">
                        <h1 className="reg-title">Sign in to your account</h1>
                        <p className="reg-subtitle">Welcome back — enter your details below.</p>
                    </div>

                    {/* OAuth section */}
                    <div className="reg-oauth-section">
                        <p className="reg-oauth-section-label">Quick sign-in</p>
                        <div className="reg-oauth">
                            <GoogleSignInButton text="Continue with Google" />
                            <FacebookSignInButton text="Continue with Facebook" />
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="reg-divider"><span>or continue with email</span></div>

                    {/* Form card */}
                    <div className="reg-form-card">
                        <form onSubmit={logInSubmit} noValidate>
                            <div className="reg-fields">

                                {/* Server-side error banner */}
                                {error && (
                                    <div className="lgn-error-banner" role="alert">
                                        <i className="ti ti-alert-circle" aria-hidden="true" />
                                        {error}
                                    </div>
                                )}

                                {/* Email */}
                                <div className="reg-field">
                                    <label htmlFor="lgn-email">
                                        Email address <span className="req-star" aria-hidden="true">*</span>
                                    </label>
                                    <div className={`reg-input-wrap${touched.email && !loginEmail.trim() ? ' has-error' : ''}`}>
                                        <i className="ti ti-mail field-icon" aria-hidden="true" />
                                        <input
                                            id="lgn-email"
                                            type="email"
                                            placeholder="you@example.com"
                                            value={loginEmail}
                                            onChange={handleEmailChange}
                                            onBlur={() => setTouched(p => ({ ...p, email: true }))}
                                            disabled={loading}
                                            autoComplete="email"
                                            aria-required="true"
                                        />
                                    </div>
                                    {touched.email && !loginEmail.trim() && (
                                        <span className="reg-field-error" role="alert">
                                            <i className="ti ti-alert-circle" aria-hidden="true" />
                                            Email address is required
                                        </span>
                                    )}
                                </div>

                                {/* Password */}
                                <div className="reg-field">
                                    <div className="lgn-label-row">
                                        <label htmlFor="lgn-password">
                                            Password <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <Link to="/password/forgot" className="lgn-forgot-link">
                                            Forgot password?
                                        </Link>
                                    </div>
                                    <div className={`reg-input-wrap${touched.password && !loginPassword.trim() ? ' has-error' : ''}`}>
                                        <i className="ti ti-lock field-icon" aria-hidden="true" />
                                        <input
                                            id="lgn-password"
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter your password"
                                            value={loginPassword}
                                            onChange={handlePasswordChange}
                                            onBlur={() => setTouched(p => ({ ...p, password: true }))}
                                            disabled={loading}
                                            autoComplete="current-password"
                                            aria-required="true"
                                        />
                                        <button
                                            type="button"
                                            className="pw-toggle"
                                            onClick={() => setShowPassword(p => !p)}
                                            disabled={loading}
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                                        </button>
                                    </div>
                                    {touched.password && !loginPassword.trim() && (
                                        <span className="reg-field-error" role="alert">
                                            <i className="ti ti-alert-circle" aria-hidden="true" />
                                            Password is required
                                        </span>
                                    )}
                                </div>

                            </div>{/* .reg-fields */}

                            {/* Submit */}
                            <div className="reg-actions lgn-actions">
                                <button
                                    type="submit"
                                    className="reg-btn-next"
                                    disabled={loading || !canSubmit}
                                >
                                    {loading ? (
                                        <>
                                            <span className="reg-spinner" aria-hidden="true" />
                                            Signing in&hellip;
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-login" aria-hidden="true" />
                                            Sign in
                                        </>
                                    )}
                                </button>
                            </div>

                        </form>
                    </div>{/* .reg-form-card */}

                    {/* Footer links */}
                    <p className="reg-signin lgn-register-link">
                        Don&rsquo;t have an account?{' '}
                        <Link to="/register">Sign up</Link>
                    </p>

                </div>
            </main>

        </div>
    );
}