import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { forgotPassword, removeErrors, removeSuccess } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import '../UserStyles/Register.css';

/* ─── INLINE SVG ICONS (no external library needed) ─────────────────────── */
const IconLock = () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" ry="2"/>
        <path d="M12 15v2"/>
        <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
        <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none"/>
    </svg>
);

const IconMailCheck = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
        <path d="m22 4-10 7L2 4"/>
        <path d="m8 13 2 2 4-4"/>
    </svg>
);

const IconInfo = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4"/>
        <path d="M12 8h.01"/>
    </svg>
);

const IconMail = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
        <path d="m22 4-10 7L2 4"/>
    </svg>
);

const IconSend = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
);

const IconAlert = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
);

/* ─── SLIDES (identical to Login / Register / VerifyEmail) ──────────────── */
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                                         stroke="rgba(255,255,255,0.18)" strokeWidth="1.5"
                                         strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                    </svg>
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                </svg>
            </button>
            <button className="reg-carousel-arrow reg-carousel-arrow--next" onClick={next} aria-label="Next slide">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
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
export default function ForgotPassword() {
    const [email,   setEmail]   = useState('');
    const [touched, setTouched] = useState(false);

    // FIX: Removed local `sent` state entirely.
    // The success card now renders directly from Redux `success && message`,
    // which eliminates the `setSent(true)` call that was causing the
    // react-hooks/set-state-in-effect lint error (cascading render warning).

    const { loading, error, success, message } = useSelector(state => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailErr  = touched && !EMAIL_RE.test(email.trim());
    const canSubmit = EMAIL_RE.test(email.trim());

    const handleSubmit = (e) => {
        e.preventDefault();
        setTouched(true);
        dispatch(removeErrors());
        if (!canSubmit) return;
        dispatch(forgotPassword(email.trim()));
    };

    const handleChange = (e) => {
        setEmail(e.target.value);
        if (error) dispatch(removeErrors());
    };

    /* ── Effects ── */
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [error, dispatch]);

    // FIX: No setState in effect body — success card renders from Redux state directly.
    // removeSuccess() is deferred inside the timeout so it never fires before
    // navigation, preventing the dep-change → cleanup → timer-cancel race condition.
    useEffect(() => {
        if (success && message) {
            const t = setTimeout(() => {
                dispatch(removeSuccess());
                navigate('/password/verify-code', { state: { email: email.trim() } });
            }, 2000);
            return () => clearTimeout(t);
        }
    }, [success, message, email, navigate, dispatch]);

    useEffect(() => () => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
    }, [dispatch]);

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
                    <div className="fp-header">
                        <div className="fp-icon-wrap" aria-hidden="true">
                            <IconLock />
                        </div>
                        <h1 className="fp-title">Forgot your password?</h1>
                        <p className="fp-subtitle">
                            No problem. Enter your registered email and we'll
                            send you a reset code right away.
                        </p>
                    </div>

                    {/* ── Success state — driven by Redux, no local `sent` state ── */}
                    {(success && message) ? (
                        <div className="fp-success-card" role="status" aria-live="polite">
                            <div className="fp-success-icon">
                                <IconMailCheck />
                            </div>
                            <p className="fp-success-title">Reset code sent!</p>
                            <p className="fp-success-text">
                                We've emailed a code to <strong>{email.trim()}</strong>.
                                Check your inbox — redirecting you now&hellip;
                            </p>
                            <span className="reg-spinner" aria-hidden="true" style={{ marginTop: 4 }} />
                        </div>
                    ) : (
                        <>
                            {/* Info note */}
                            <div className="fp-info-note">
                                <span className="fp-info-note-icon">
                                    <IconInfo />
                                </span>
                                <span>
                                    We'll send a one-time code to your inbox. The code
                                    expires after 15 minutes.
                                </span>
                            </div>

                            {/* Form card */}
                            <div className="reg-form-card">
                                <form onSubmit={handleSubmit} noValidate>
                                    <div className="reg-fields">

                                        {/* Server error banner */}
                                        {error && (
                                            <div className="lgn-error-banner" role="alert">
                                                <span className="lgn-error-banner-icon">
                                                    <IconAlert />
                                                </span>
                                                {error}
                                            </div>
                                        )}

                                        {/* Email field */}
                                        <div className="reg-field">
                                            <label htmlFor="fp-email">
                                                Email address{' '}
                                                <span className="req-star" aria-hidden="true">*</span>
                                            </label>
                                            <div className={`reg-input-wrap${emailErr ? ' has-error' : ''}`}>
                                                <span className="field-icon">
                                                    <IconMail />
                                                </span>
                                                <input
                                                    id="fp-email"
                                                    type="email"
                                                    placeholder="you@example.com"
                                                    value={email}
                                                    onChange={handleChange}
                                                    onBlur={() => setTouched(true)}
                                                    disabled={loading}
                                                    autoComplete="email"
                                                    aria-required="true"
                                                    aria-invalid={emailErr}
                                                />
                                            </div>
                                            {emailErr && (
                                                <span className="reg-field-error" role="alert">
                                                    <span className="reg-field-error-icon">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                                             stroke="currentColor" strokeWidth="2"
                                                             strokeLinecap="round" strokeLinejoin="round">
                                                            <circle cx="12" cy="12" r="10"/>
                                                            <line x1="12" y1="8" x2="12" y2="12"/>
                                                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                                                        </svg>
                                                    </span>
                                                    Please enter a valid email address
                                                </span>
                                            )}
                                        </div>

                                    </div>{/* .reg-fields */}

                                    {/* Submit */}
                                    <div className="reg-actions" style={{ marginTop: '20px' }}>
                                        <button
                                            type="submit"
                                            className="reg-btn-next"
                                            disabled={loading || !canSubmit}
                                        >
                                            {loading ? (
                                                <>
                                                    <span className="reg-spinner" aria-hidden="true" />
                                                    Sending&hellip;
                                                </>
                                            ) : (
                                                <>
                                                    <span className="reg-btn-icon">
                                                        <IconSend />
                                                    </span>
                                                    Send Reset Code
                                                </>
                                            )}
                                        </button>
                                    </div>

                                </form>
                            </div>

                            {/* Footer links */}
                            <p className="reg-signin" style={{ marginTop: '1.25rem' }}>
                                Remember your password?{' '}
                                <Link to="/login">Sign in</Link>
                            </p>
                        </>
                    )}

                </div>
            </main>

        </div>
    );
}