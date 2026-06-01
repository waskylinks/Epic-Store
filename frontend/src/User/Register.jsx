import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { register, removeErrors, removeSuccess } from '../features/products/userSlice';
import GoogleSignInButton from '../components/GoogleSignInButton';
import FacebookSignInButton from '../components/FacebookSignInButton';
import '../UserStyles/Register.css'
;

const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE   = /^\+?[\d\s\-(]{7,20}$/;
const NAME_RE    = /^[a-zA-Z\s'-]+$/;

const getPwReqs = (pw) => ({
    len:     pw.length >= 12,
    upper:   /[A-Z]/.test(pw),
    lower:   /[a-z]/.test(pw),
    num:     /[0-9]/.test(pw),
    special: SPECIAL_RE.test(pw),
});

const isPwValid = (pw) => {
    const r = getPwReqs(pw);
    return r.len && r.upper && r.lower && r.num && r.special;
};

const getPwStrength = (pw) => {
    if (!pw) return null;
    const met = Object.values(getPwReqs(pw)).filter(Boolean).length;
    if (met <= 2) return { level: 1, label: 'Weak',      color: '#E24B4A' };
    if (met <= 3) return { level: 2, label: 'Fair',      color: '#EF9F27' };
    if (met <= 4) return { level: 3, label: 'Good',      color: '#378ADD' };
    return           { level: 4, label: 'Strong',    color: '#1D9E75' };
};

const STEPS = [
    { id: 1, label: 'Account',  icon: 'ti-user'        },
    { id: 2, label: 'Personal', icon: 'ti-id-badge'    },
    { id: 3, label: 'Address',  icon: 'ti-map-pin'     },
    { id: 4, label: 'Security', icon: 'ti-shield-lock' },
];

function StepIndicator({ current }) {
    return (
        <div className="reg-steps">
            {STEPS.map((step, idx) => {
                const done   = current > step.id;
                const active = current === step.id;
                return (
                    <React.Fragment key={step.id}>
                        <div className={`reg-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                            <div className="reg-step-circle">
                                {done
                                    ? <i className="ti ti-check" aria-hidden="true" />
                                    : <i className={`ti ${step.icon}`} aria-hidden="true" />
                                }
                            </div>
                            <span className="reg-step-label">{step.label}</span>
                        </div>
                        {idx < STEPS.length - 1 && (
                            <div className={`reg-step-line ${done ? 'done' : ''}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function FieldError({ msg }) {
    return msg ? (
        <span className="reg-field-error">
            <i className="ti ti-alert-circle" aria-hidden="true" />
            {msg}
        </span>
    ) : null;
}

export default function Register() {
    const dispatch  = useDispatch();
    const navigate  = useNavigate();
    const { success, loading, error, needsVerification, verificationEmail } = useSelector(s => s.user);

    const [step, setStep]       = useState(1);
    const [touched, setTouched] = useState({});
    const [showPw, setShowPw]   = useState(false);
    const [errors, setErrors]   = useState({});

    const [form, setForm] = useState({
        firstName:   '',
        lastName:    '',
        email:       '',
        phone:       '',
        dateOfBirth: '',
        gender:      '',
        password:    '',
    });

    const [shipping, setShipping] = useState({
        address: '',
        city:    '',
        state:   '',
        country: '',
        pinCode: '',
    });

    const touch = (name) => setTouched(p => ({ ...p, [name]: true }));

    const onField = (e) => {
        const { name, value } = e.target;
        setForm(p => ({ ...p, [name]: value }));
        setErrors(p => ({ ...p, [name]: '' }));
        if (error) dispatch(removeErrors());
    };

    const onShipping = (e) => {
        const { name, value } = e.target;
        setShipping(p => ({ ...p, [name]: value }));
    };

    const validateStep = (n) => {
        const errs = {};
        if (n === 1) {
            if (!form.firstName.trim() || form.firstName.trim().length < 2) errs.firstName = 'At least 2 characters';
            else if (!NAME_RE.test(form.firstName))                          errs.firstName = 'Letters, spaces, hyphens only';
            if (!form.lastName.trim() || form.lastName.trim().length < 2)   errs.lastName  = 'At least 2 characters';
            else if (!NAME_RE.test(form.lastName))                           errs.lastName  = 'Letters, spaces, hyphens only';
            if (!form.email.trim() || !EMAIL_RE.test(form.email))           errs.email     = 'Valid email address required';
        }
        if (n === 2) {
            if (!form.phone.trim() || !PHONE_RE.test(form.phone)) errs.phone = 'Valid phone number required (include country code)';
            if (!form.dateOfBirth) {
                errs.dateOfBirth = 'Date of birth is required';
            } else {
                const age = (Date.now() - new Date(form.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
                if (age < 13)  errs.dateOfBirth = 'You must be at least 13 years old';
                if (age > 120) errs.dateOfBirth = 'Invalid date of birth';
            }
            if (!form.gender) errs.gender = 'Please select a gender';
        }
        if (n === 4) {
            if (!isPwValid(form.password)) errs.password = 'Password does not meet all requirements';
        }
        return errs;
    };

    const goNext = () => {
        const errs = validateStep(step);
        if (Object.keys(errs).length) {
            setErrors(errs);
            const allTouched = {};
            Object.keys(errs).forEach(k => { allTouched[k] = true; });
            setTouched(p => ({ ...p, ...allTouched }));
            return;
        }
        setStep(s => s + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const goBack = () => {
        setStep(s => s - 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const errs = validateStep(4);
        if (Object.keys(errs).length) { setErrors(errs); return; }

        const payload = {
            firstName:   form.firstName.trim(),
            lastName:    form.lastName.trim(),
            email:       form.email.trim().toLowerCase(),
            phone:       form.phone.trim(),
            dateOfBirth: form.dateOfBirth,
            gender:      form.gender,
            password:    form.password,
        };

        const hasShipping = Object.values(shipping).some(v => v.trim() !== '');
        if (hasShipping) payload.shippingAddress = shipping;

        dispatch(register(payload));
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3500 });
            dispatch(removeErrors());
        }
    }, [error, dispatch]);

    useEffect(() => {
        if (success && needsVerification && verificationEmail) {
            toast.success('Account created! Check your email for a verification code.', {
                position: 'top-center',
                autoClose: 3000,
            });
            dispatch(removeSuccess());
            setTimeout(() => navigate('/verify-email', { state: { email: verificationEmail } }), 500);
        }
    }, [success, needsVerification, verificationEmail, navigate, dispatch]);

    useEffect(() => () => { dispatch(removeErrors()); dispatch(removeSuccess()); }, [dispatch]);

    const pwStrength = getPwStrength(form.password);
    const pwReqs     = getPwReqs(form.password);

    return (
        <div className="reg-page">
            <div className="reg-left" aria-hidden="true">
                <div className="reg-left-content">
                    <div className="reg-brand-mark">
                        <span className="reg-brand-e">Epic</span>
                        <span className="reg-brand-s">Store</span>
                    </div>
                    <h2 className="reg-left-headline">Your next favourite store.</h2>
                    <p className="reg-left-sub">
                        Thousands of products, lightning-fast checkout, and a storefront built around you.
                    </p>
                    <ul className="reg-perks">
                        <li><i className="ti ti-bolt" aria-hidden="true" /><span>Instant order tracking</span></li>
                        <li><i className="ti ti-shield-check" aria-hidden="true" /><span>Secure &amp; encrypted</span></li>
                        <li><i className="ti ti-truck-delivery" aria-hidden="true" /><span>Smart shipping defaults</span></li>
                        <li><i className="ti ti-heart" aria-hidden="true" /><span>Personalised wishlist</span></li>
                    </ul>
                </div>
            </div>

            <div className="reg-right">
                <div className="reg-form-wrap">
                    <div className="reg-mobile-brand">
                        <span className="reg-brand-e">Epic</span><span className="reg-brand-s">Store</span>
                    </div>

                    <div className="reg-header">
                        <h1 className="reg-title">Create your account</h1>
                        <p className="reg-subtitle">
                            Step {step} of {STEPS.length} &mdash; {STEPS[step - 1].label}
                        </p>
                    </div>

                    <StepIndicator current={step} />

                    <div className="reg-oauth">
                        <GoogleSignInButton text="Continue with Google" />
                        <FacebookSignInButton text="Continue with Facebook" />
                    </div>

                    <div className="reg-divider"><span>or register with email</span></div>

                    <form onSubmit={handleSubmit} noValidate>

                        {step === 1 && (
                            <div className="reg-fields">
                                <div className="reg-row">
                                    <div className="reg-field">
                                        <label htmlFor="firstName">
                                            First name <span className="req-star">*</span>
                                        </label>
                                        <div className={`reg-input-wrap ${errors.firstName && touched.firstName ? 'has-error' : ''}`}>
                                            <i className="ti ti-user field-icon" aria-hidden="true" />
                                            <input
                                                id="firstName"
                                                name="firstName"
                                                type="text"
                                                placeholder="John"
                                                value={form.firstName}
                                                onChange={onField}
                                                onBlur={() => touch('firstName')}
                                                autoComplete="given-name"
                                                disabled={loading}
                                            />
                                        </div>
                                        {touched.firstName && <FieldError msg={errors.firstName} />}
                                    </div>
                                    <div className="reg-field">
                                        <label htmlFor="lastName">
                                            Last name <span className="req-star">*</span>
                                        </label>
                                        <div className={`reg-input-wrap ${errors.lastName && touched.lastName ? 'has-error' : ''}`}>
                                            <i className="ti ti-user field-icon" aria-hidden="true" />
                                            <input
                                                id="lastName"
                                                name="lastName"
                                                type="text"
                                                placeholder="Doe"
                                                value={form.lastName}
                                                onChange={onField}
                                                onBlur={() => touch('lastName')}
                                                autoComplete="family-name"
                                                disabled={loading}
                                            />
                                        </div>
                                        {touched.lastName && <FieldError msg={errors.lastName} />}
                                    </div>
                                </div>

                                <div className="reg-field">
                                    <label htmlFor="email">
                                        Email address <span className="req-star">*</span>
                                    </label>
                                    <div className={`reg-input-wrap ${errors.email && touched.email ? 'has-error' : ''}`}>
                                        <i className="ti ti-mail field-icon" aria-hidden="true" />
                                        <input
                                            id="email"
                                            name="email"
                                            type="email"
                                            placeholder="you@example.com"
                                            value={form.email}
                                            onChange={onField}
                                            onBlur={() => touch('email')}
                                            autoComplete="email"
                                            disabled={loading}
                                        />
                                    </div>
                                    {touched.email && <FieldError msg={errors.email} />}
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="reg-fields">
                                <div className="reg-field">
                                    <label htmlFor="phone">
                                        Phone number <span className="req-star">*</span>
                                    </label>
                                    <div className={`reg-input-wrap ${errors.phone && touched.phone ? 'has-error' : ''}`}>
                                        <i className="ti ti-phone field-icon" aria-hidden="true" />
                                        <input
                                            id="phone"
                                            name="phone"
                                            type="tel"
                                            placeholder="+1 555 000 0000"
                                            value={form.phone}
                                            onChange={onField}
                                            onBlur={() => touch('phone')}
                                            autoComplete="tel"
                                            disabled={loading}
                                        />
                                    </div>
                                    <span className="reg-hint">Include your country code, e.g. +1, +44, +234</span>
                                    {touched.phone && <FieldError msg={errors.phone} />}
                                </div>

                                <div className="reg-row">
                                    <div className="reg-field">
                                        <label htmlFor="dateOfBirth">
                                            Date of birth <span className="req-star">*</span>
                                        </label>
                                        <div className={`reg-input-wrap ${errors.dateOfBirth && touched.dateOfBirth ? 'has-error' : ''}`}>
                                            <i className="ti ti-calendar field-icon" aria-hidden="true" />
                                            <input
                                                id="dateOfBirth"
                                                name="dateOfBirth"
                                                type="date"
                                                value={form.dateOfBirth}
                                                onChange={onField}
                                                onBlur={() => touch('dateOfBirth')}
                                                autoComplete="bday"
                                                disabled={loading}
                                            />
                                        </div>
                                        {touched.dateOfBirth && <FieldError msg={errors.dateOfBirth} />}
                                    </div>
                                    <div className="reg-field">
                                        <label htmlFor="gender">
                                            Gender <span className="req-star">*</span>
                                        </label>
                                        <div className={`reg-input-wrap reg-select-wrap ${errors.gender && touched.gender ? 'has-error' : ''}`}>
                                            <i className="ti ti-gender-bigender field-icon" aria-hidden="true" />
                                            <select
                                                id="gender"
                                                name="gender"
                                                value={form.gender}
                                                onChange={onField}
                                                onBlur={() => touch('gender')}
                                                disabled={loading}
                                            >
                                                <option value="">Select gender</option>
                                                <option value="male">Male</option>
                                                <option value="female">Female</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <i className="ti ti-chevron-down select-chevron" aria-hidden="true" />
                                        </div>
                                        {touched.gender && <FieldError msg={errors.gender} />}
                                    </div>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            <div className="reg-fields">
                                <div className="reg-section-note">
                                    <i className="ti ti-info-circle" aria-hidden="true" />
                                    <span>Shipping address is optional — you can add or update it later from your profile.</span>
                                </div>

                                <div className="reg-field">
                                    <label htmlFor="address">Street address</label>
                                    <div className="reg-input-wrap">
                                        <i className="ti ti-home field-icon" aria-hidden="true" />
                                        <input
                                            id="address"
                                            name="address"
                                            type="text"
                                            placeholder="123 Main Street, Apt 4B"
                                            value={shipping.address}
                                            onChange={onShipping}
                                            disabled={loading}
                                            autoComplete="street-address"
                                        />
                                    </div>
                                </div>

                                <div className="reg-row">
                                    <div className="reg-field">
                                        <label htmlFor="city">City</label>
                                        <div className="reg-input-wrap">
                                            <i className="ti ti-building field-icon" aria-hidden="true" />
                                            <input
                                                id="city"
                                                name="city"
                                                type="text"
                                                placeholder="New York"
                                                value={shipping.city}
                                                onChange={onShipping}
                                                disabled={loading}
                                                autoComplete="address-level2"
                                            />
                                        </div>
                                    </div>
                                    <div className="reg-field">
                                        <label htmlFor="state">State / Province</label>
                                        <div className="reg-input-wrap">
                                            <i className="ti ti-map field-icon" aria-hidden="true" />
                                            <input
                                                id="state"
                                                name="state"
                                                type="text"
                                                placeholder="NY"
                                                value={shipping.state}
                                                onChange={onShipping}
                                                disabled={loading}
                                                autoComplete="address-level1"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="reg-row">
                                    <div className="reg-field">
                                        <label htmlFor="country">Country</label>
                                        <div className="reg-input-wrap">
                                            <i className="ti ti-world field-icon" aria-hidden="true" />
                                            <input
                                                id="country"
                                                name="country"
                                                type="text"
                                                placeholder="United States"
                                                value={shipping.country}
                                                onChange={onShipping}
                                                disabled={loading}
                                                autoComplete="country-name"
                                            />
                                        </div>
                                    </div>
                                    <div className="reg-field">
                                        <label htmlFor="pinCode">ZIP / Pin code</label>
                                        <div className="reg-input-wrap">
                                            <i className="ti ti-mailbox field-icon" aria-hidden="true" />
                                            <input
                                                id="pinCode"
                                                name="pinCode"
                                                type="text"
                                                placeholder="10001"
                                                value={shipping.pinCode}
                                                onChange={onShipping}
                                                disabled={loading}
                                                autoComplete="postal-code"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {step === 4 && (
                            <div className="reg-fields">
                                <div className="reg-field">
                                    <label htmlFor="password">
                                        Password <span className="req-star">*</span>
                                    </label>
                                    <div className={`reg-input-wrap ${errors.password && touched.password ? 'has-error' : ''}`}>
                                        <i className="ti ti-lock field-icon" aria-hidden="true" />
                                        <input
                                            id="password"
                                            name="password"
                                            type={showPw ? 'text' : 'password'}
                                            placeholder="Create a strong password"
                                            value={form.password}
                                            onChange={onField}
                                            onBlur={() => touch('password')}
                                            autoComplete="new-password"
                                            disabled={loading}
                                        />
                                        <button
                                            type="button"
                                            className="pw-toggle"
                                            onClick={() => setShowPw(p => !p)}
                                            aria-label={showPw ? 'Hide password' : 'Show password'}
                                        >
                                            <i className={`ti ${showPw ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                                        </button>
                                    </div>
                                    {touched.password && <FieldError msg={errors.password} />}

                                    {form.password && (
                                        <>
                                            <div className="pw-strength-bar">
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

                                            <ul className="pw-reqs">
                                                {[
                                                    [pwReqs.len,     '12+ characters'],
                                                    [pwReqs.upper,   'One uppercase letter'],
                                                    [pwReqs.lower,   'One lowercase letter'],
                                                    [pwReqs.num,     'One number'],
                                                    [pwReqs.special, 'One special character'],
                                                ].map(([met, label]) => (
                                                    <li key={label} className={met ? 'met' : ''}>
                                                        <i
                                                            className={`ti ${met ? 'ti-circle-check' : 'ti-circle'}`}
                                                            aria-hidden="true"
                                                        />
                                                        {label}
                                                    </li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                </div>

                                <p className="reg-legal">
                                    By creating an account you agree to our{' '}
                                    <Link to="/terms">Terms of Service</Link> and{' '}
                                    <Link to="/privacy">Privacy Policy</Link>.
                                </p>
                            </div>
                        )}

                        <div className="reg-actions">
                            {step > 1 && (
                                <button
                                    type="button"
                                    className="reg-btn-back"
                                    onClick={goBack}
                                    disabled={loading}
                                >
                                    <i className="ti ti-arrow-left" aria-hidden="true" />
                                    Back
                                </button>
                            )}
                            {step < STEPS.length ? (
                                <button
                                    type="button"
                                    className="reg-btn-next"
                                    onClick={goNext}
                                    disabled={loading}
                                >
                                    Continue
                                    <i className="ti ti-arrow-right" aria-hidden="true" />
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    className="reg-btn-next"
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <>
                                            <span className="reg-spinner" />
                                            Creating account&hellip;
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-check" aria-hidden="true" />
                                            Create account
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </form>

                    <p className="reg-signin">
                        Already have an account? <Link to="/login">Sign in</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}