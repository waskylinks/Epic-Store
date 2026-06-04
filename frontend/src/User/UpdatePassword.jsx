import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { updatePassword, removeErrors, removeSuccess } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import '../UserStyles/Register.css';

/* ─── PASSWORD HELPERS (same as Register / ResetPassword) ────────────────── */
const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

const getPwReqs = (pw) => ({
    len:     pw.length >= 8,
    upper:   /[A-Z]/.test(pw),
    lower:   /[a-z]/.test(pw),
    num:     /[0-9]/.test(pw),
    special: SPECIAL_RE.test(pw),
});

const isPwValid   = (pw) => Object.values(getPwReqs(pw)).every(Boolean);

const getPwStrength = (pw) => {
    if (!pw) return null;
    const met = Object.values(getPwReqs(pw)).filter(Boolean).length;
    if (met <= 2) return { level: 1, label: 'Weak',   color: '#E24B4A' };
    if (met <= 3) return { level: 2, label: 'Fair',   color: '#EF9F27' };
    if (met <= 4) return { level: 3, label: 'Good',   color: '#378ADD' };
    return           { level: 4, label: 'Strong', color: '#1D9E75' };
};

/* ─── MAIN COMPONENT ─────────────────────────────────────────────────────── */
export default function UpdatePassword() {
    const [oldPassword,     setOldPassword]     = useState('');
    const [newPassword,     setNewPassword]     = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOld,         setShowOld]         = useState(false);
    const [showNew,         setShowNew]         = useState(false);
    const [showConfirm,     setShowConfirm]     = useState(false);
    const [touched,         setTouched]         = useState({ old: false, new: false, confirm: false });
    const [done,            setDone]            = useState(false);

    const { success, loading, error } = useSelector(state => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    /* ── Derived ── */
    const pwReqs         = getPwReqs(newPassword);
    const pwStrength     = getPwStrength(newPassword);
    const newPwValid     = isPwValid(newPassword);
    const passwordsMatch = newPassword === confirmPassword && confirmPassword !== '';
    const mismatch       = touched.confirm && confirmPassword !== '' && newPassword !== confirmPassword;
    const oldMissing     = touched.old && !oldPassword.trim();
    const canSubmit      = oldPassword.trim() && newPwValid && passwordsMatch;

    /* ── Submit ── */
    const handleSubmit = (e) => {
        e.preventDefault();
        setTouched({ old: true, new: true, confirm: true });
        dispatch(removeErrors());

        if (!oldPassword.trim() || !newPwValid || newPassword !== confirmPassword) return;

        const myForm = new FormData();
        myForm.set('oldPassword',     oldPassword);
        myForm.set('newPassword',     newPassword);
        myForm.set('confirmPassword', confirmPassword);
        dispatch(updatePassword(myForm));
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
            const t = setTimeout(() => navigate('/profile'), 2500);
            return () => clearTimeout(t);
        }
    }, [success, dispatch, navigate]);

    useEffect(() => () => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
    }, [dispatch]);

    return (
        <div className="reg-page">

            {/* ── LEFT: static branded panel ── */}
            <aside className="up-left" aria-hidden="true">
                <div className="up-left-inner">
                    <div className="up-left-brand">
                        <span className="up-brand-e">Epic</span>
                        <span className="up-brand-s">Store</span>
                    </div>

                    <div className="up-left-icon">
                        <i className="ti ti-shield-lock" aria-hidden="true" />
                    </div>

                    <h2 className="up-left-headline">
                        Keep your account secure.
                    </h2>
                    <p className="up-left-sub">
                        A strong password is your first line of defence.
                        Update it regularly and never reuse old ones.
                    </p>

                    <ul className="up-tips">
                        <li>
                            <div className="up-tip-dot" />
                            <span>Use at least 8 characters with a mix of letters, numbers and symbols</span>
                        </li>
                        <li>
                            <div className="up-tip-dot" />
                            <span>Avoid using your name, email or common words</span>
                        </li>
                        <li>
                            <div className="up-tip-dot" />
                            <span>Never reuse a password across multiple accounts</span>
                        </li>
                        <li>
                            <div className="up-tip-dot" />
                            <span>Consider using a password manager to stay safe</span>
                        </li>
                    </ul>
                </div>
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
                    <div className="up-header">
                        <div className="up-icon-wrap" aria-hidden="true">
                            <i className="ti ti-lock-cog" />
                        </div>
                        <h1 className="up-title">Update your password</h1>
                        <p className="up-subtitle">
                            Enter your current password, then choose a new one.
                        </p>
                    </div>

                    {/* ── Success state ── */}
                    {done ? (
                        <div className="up-success-card" role="status" aria-live="polite">
                            <div className="up-success-icon">
                                <i className="ti ti-circle-check" aria-hidden="true" />
                            </div>
                            <p className="up-success-title">Password updated!</p>
                            <p className="up-success-text">
                                Your password has been changed. Redirecting to your profile&hellip;
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

                                    {/* Current password */}
                                    <div className="reg-field">
                                        <label htmlFor="up-old">
                                            Current password{' '}
                                            <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${oldMissing ? ' has-error' : ''}`}>
                                            <i className="ti ti-lock field-icon" aria-hidden="true" />
                                            <input
                                                id="up-old"
                                                type={showOld ? 'text' : 'password'}
                                                placeholder="Enter your current password"
                                                value={oldPassword}
                                                onChange={e => {
                                                    setOldPassword(e.target.value);
                                                    if (error) dispatch(removeErrors());
                                                }}
                                                onBlur={() => setTouched(p => ({ ...p, old: true }))}
                                                disabled={loading}
                                                autoComplete="current-password"
                                                aria-required="true"
                                            />
                                            <button
                                                type="button"
                                                className="pw-toggle"
                                                onClick={() => setShowOld(p => !p)}
                                                disabled={loading}
                                                aria-label={showOld ? 'Hide password' : 'Show password'}
                                            >
                                                <i className={`ti ${showOld ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                                            </button>
                                        </div>
                                        {oldMissing && (
                                            <span className="reg-field-error" role="alert">
                                                <i className="ti ti-alert-circle" aria-hidden="true" />
                                                Current password is required
                                            </span>
                                        )}
                                        <p className="reg-hint">
                                            Forgot your password?{' '}
                                            <button
                                                type="button"
                                                className="ver-link-btn"
                                                onClick={() => navigate('/password/forgot')}
                                                disabled={loading}
                                            >
                                                Reset it here
                                            </button>
                                        </p>
                                    </div>

                                    {/* New password */}
                                    <div className="reg-field">
                                        <label htmlFor="up-new">
                                            New password{' '}
                                            <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${touched.new && !newPwValid ? ' has-error' : ''}`}>
                                            <i className="ti ti-lock-plus field-icon" aria-hidden="true" />
                                            <input
                                                id="up-new"
                                                type={showNew ? 'text' : 'password'}
                                                placeholder="Create a new strong password"
                                                value={newPassword}
                                                onChange={e => {
                                                    setNewPassword(e.target.value);
                                                    if (error) dispatch(removeErrors());
                                                }}
                                                onBlur={() => setTouched(p => ({ ...p, new: true }))}
                                                disabled={loading}
                                                autoComplete="new-password"
                                                aria-required="true"
                                                aria-describedby="up-reqs-list"
                                            />
                                            <button
                                                type="button"
                                                className="pw-toggle"
                                                onClick={() => setShowNew(p => !p)}
                                                disabled={loading}
                                                aria-label={showNew ? 'Hide password' : 'Show password'}
                                            >
                                                <i className={`ti ${showNew ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                                            </button>
                                        </div>

                                        {/* Strength bar + requirements */}
                                        {newPassword && (
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

                                                <ul className="pw-reqs" id="up-reqs-list" aria-label="Password requirements">
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

                                    {/* Confirm new password */}
                                    <div className="reg-field">
                                        <label htmlFor="up-confirm">
                                            Confirm new password{' '}
                                            <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${mismatch ? ' has-error' : ''}`}>
                                            <i className="ti ti-lock-check field-icon" aria-hidden="true" />
                                            <input
                                                id="up-confirm"
                                                type={showConfirm ? 'text' : 'password'}
                                                placeholder="Re-enter your new password"
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

                                {/* Actions */}
                                <div className="reg-actions" style={{ marginTop: '20px' }}>
                                    <button
                                        type="button"
                                        className="reg-btn-back"
                                        onClick={() => navigate('/profile')}
                                        disabled={loading}
                                    >
                                        <i className="ti ti-arrow-left" aria-hidden="true" />
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="reg-btn-next"
                                        disabled={loading || !canSubmit}
                                    >
                                        {loading ? (
                                            <>
                                                <span className="reg-spinner" aria-hidden="true" />
                                                Updating&hellip;
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-lock-check" aria-hidden="true" />
                                                Update Password
                                            </>
                                        )}
                                    </button>
                                </div>

                            </form>
                        </div>
                    )}

                </div>
            </main>

        </div>
    );
}