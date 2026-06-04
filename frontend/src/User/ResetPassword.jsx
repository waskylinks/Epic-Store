import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { resetPassword, removeErrors, removeSuccess } from '../features/products/userSlice';
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

/* ─── PASSWORD HELPERS (aligned with Register — 8 char min) ─────────────── */
const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

const getPwReqs = (pw) => ({
    len:     pw.length >= 8,
    upper:   /[A-Z]/.test(pw),
    lower:   /[a-z]/.test(pw),
    num:     /[0-9]/.test(pw),
    special: SPECIAL_RE.test(pw),
});

const isPwValid = (pw) => Object.values(getPwReqs(pw)).every(Boolean);

const getPwStrength = (pw) => {
    if (!pw) return null;
    const met = Object.values(getPwReqs(pw)).filter(Boolean).length;
    if (met <= 2) return { level: 1, label: 'Weak',   color: '#E24B4A' };
    if (met <= 3) return { level: 2, label: 'Fair',   color: '#EF9F27' };
    if (met <= 4) return { level: 3, label: 'Good',   color: '#378ADD' };
    return           { level: 4, label: 'Strong', color: '#1D9E75' };
};

/* ─── MAIN COMPONENT ─────────────────────────────────────────────────────── */
export default function ResetPassword() {
    const [password,        setPassword]        = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPw,          setShowPw]          = useState(false);
    const [showConfirm,     setShowConfirm]     = useState(false);
    const [touched,         setTouched]         = useState({ pw: false, confirm: false });
    const [done,            setDone]            = useState(false);
    const [accessOk,        setAccessOk]        = useState(false);

    const { success, loading, error } = useSelector(state => state.user);
    const dispatch  = useDispatch();
    const navigate  = useNavigate();
    const location  = useLocation();

    const email    = location.state?.email;
    const code     = location.state?.code;
    const verified = location.state?.verified;

    /* ── Guard: must arrive via verify-code flow ── */
    useEffect(() => {
        if (!email || !code || !verified) {
            toast.error('Please verify your reset code first', { position: 'top-center', autoClose: 2000 });
            navigate('/password/forgot');
        } else {
            setAccessOk(true);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── Derived state ── */
    const pwReqs      = getPwReqs(password);
    const pwStrength  = getPwStrength(password);
    const pwValid     = isPwValid(password);
    const passwordsMatch = password === confirmPassword && confirmPassword !== '';
    const mismatch    = touched.confirm && confirmPassword !== '' && password !== confirmPassword;
    const canSubmit   = pwValid && passwordsMatch;

    /* ── Submit ── */
    const handleSubmit = (e) => {
        e.preventDefault();
        setTouched({ pw: true, confirm: true });
        dispatch(removeErrors());

        if (!pwValid) return;
        if (password !== confirmPassword) return;

        dispatch(resetPassword({ email, code, password, confirmPassword }));
    };

    /* ── Effects ── */
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [error, dispatch]);

    useEffect(() => {
        if (success) {
            setDone(true);
            dispatch(removeSuccess());
            const t = setTimeout(() => navigate('/login'), 2500);
            return () => clearTimeout(t);
        }
    }, [success, dispatch, navigate]);

    useEffect(() => () => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
    }, [dispatch]);

    if (!accessOk) return null;

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
                    <div className="rp-header">
                        <div className="rp-icon-wrap" aria-hidden="true">
                            <i className="ti ti-shield-lock" />
                        </div>
                        <h1 className="rp-title">Set a new password</h1>
                        <p className="rp-subtitle">
                            Creating a new password for{' '}
                            <strong>{email}</strong>
                        </p>
                    </div>

                    {/* ── Success state ── */}
                    {done ? (
                        <div className="rp-success-card" role="status" aria-live="polite">
                            <div className="rp-success-icon">
                                <i className="ti ti-circle-check" aria-hidden="true" />
                            </div>
                            <p className="rp-success-title">Password reset!</p>
                            <p className="rp-success-text">
                                Your password has been updated. Redirecting you to sign in&hellip;
                            </p>
                            <span className="reg-spinner" aria-hidden="true" style={{ marginTop: 4 }} />
                        </div>
                    ) : (
                        <div className="reg-form-card">
                            <form onSubmit={handleSubmit} noValidate>
                                <div className="reg-fields">

                                    {/* Server error banner */}
                                    {error && (
                                        <div className="lgn-error-banner" role="alert">
                                            <i className="ti ti-alert-circle" aria-hidden="true" />
                                            {error}
                                        </div>
                                    )}

                                    {/* New password */}
                                    <div className="reg-field">
                                        <label htmlFor="rp-password">
                                            New password{' '}
                                            <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${touched.pw && !pwValid ? ' has-error' : ''}`}>
                                            <i className="ti ti-lock field-icon" aria-hidden="true" />
                                            <input
                                                id="rp-password"
                                                type={showPw ? 'text' : 'password'}
                                                placeholder="Create a strong password"
                                                value={password}
                                                onChange={e => {
                                                    setPassword(e.target.value);
                                                    if (error) dispatch(removeErrors());
                                                }}
                                                onBlur={() => setTouched(p => ({ ...p, pw: true }))}
                                                disabled={loading}
                                                autoComplete="new-password"
                                                aria-required="true"
                                                aria-describedby="rp-reqs-list"
                                            />
                                            <button
                                                type="button"
                                                className="pw-toggle"
                                                onClick={() => setShowPw(p => !p)}
                                                disabled={loading}
                                                aria-label={showPw ? 'Hide password' : 'Show password'}
                                            >
                                                <i className={`ti ${showPw ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                                            </button>
                                        </div>

                                        {/* Strength bar */}
                                        {password && (
                                            <div className="rp-strength-wrap">
                                                <div className="pw-strength-bar" aria-hidden="true">
                                                    {[1, 2, 3, 4].map(i => (
                                                        <div
                                                            key={i}
                                                            className="pw-strength-seg"
                                                            style={{
                                                                background: pwStrength && i <= pwStrength.level
                                                                    ? pwStrength.color
                                                                    : undefined,
                                                            }}
                                                        />
                                                    ))}
                                                    {pwStrength && (
                                                        <span
                                                            className="pw-strength-label"
                                                            style={{ color: pwStrength.color }}
                                                        >
                                                            {pwStrength.label}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Requirements */}
                                                <ul className="pw-reqs" id="rp-reqs-list" aria-label="Password requirements">
                                                    {[
                                                        [pwReqs.len,     '8+ characters'],
                                                        [pwReqs.upper,   'One uppercase letter'],
                                                        [pwReqs.lower,   'One lowercase letter'],
                                                        [pwReqs.num,     'One number'],
                                                        [pwReqs.special, 'One special character'],
                                                    ].map(([met, label]) => (
                                                        <li
                                                            key={label}
                                                            className={met ? 'met' : ''}
                                                            aria-label={`${label}: ${met ? 'met' : 'not met'}`}
                                                        >
                                                            <i className={`ti ${met ? 'ti-circle-check' : 'ti-circle'}`} aria-hidden="true" />
                                                            {label}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>

                                    {/* Confirm password */}
                                    <div className="reg-field">
                                        <label htmlFor="rp-confirm">
                                            Confirm new password{' '}
                                            <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${mismatch ? ' has-error' : ''}`}>
                                            <i className="ti ti-lock-check field-icon" aria-hidden="true" />
                                            <input
                                                id="rp-confirm"
                                                type={showConfirm ? 'text' : 'password'}
                                                placeholder="Re-enter your password"
                                                value={confirmPassword}
                                                onChange={e => {
                                                    setConfirmPassword(e.target.value);
                                                    if (error) dispatch(removeErrors());
                                                }}
                                                onBlur={() => setTouched(p => ({ ...p, confirm: true }))}
                                                disabled={loading}
                                                autoComplete="new-password"
                                                aria-required="true"
                                            />
                                            <button
                                                type="button"
                                                className="pw-toggle"
                                                onClick={() => setShowConfirm(p => !p)}
                                                disabled={loading}
                                                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                                            >
                                                <i className={`ti ${showConfirm ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                                            </button>
                                        </div>

                                        {/* Match indicator */}
                                        {confirmPassword && (
                                            <div className={`rp-match ${passwordsMatch ? 'is-ok' : 'is-err'}`}>
                                                <i className={`ti ${passwordsMatch ? 'ti-circle-check' : 'ti-circle-x'}`} aria-hidden="true" />
                                                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                                            </div>
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
                                                Resetting&hellip;
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-lock-check" aria-hidden="true" />
                                                Reset Password
                                            </>
                                        )}
                                    </button>
                                </div>

                            </form>
                        </div>
                    )}

                    {/* Footer link */}
                    {!done && (
                        <p className="reg-signin" style={{ marginTop: '1.25rem' }}>
                            Remember your password?{' '}
                            <Link to="/login">Sign in</Link>
                        </p>
                    )}

                </div>
            </main>

        </div>
    );
}