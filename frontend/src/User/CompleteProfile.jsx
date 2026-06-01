import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { updateProfile, loadUser, removeErrors, removeSuccess } from '../features/products/userSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import { Save, CheckCircle } from 'lucide-react';
import '../UserStyles/CompleteProfile.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-(]{7,20}$/;

const STEPS = [
    { id: 1, label: 'Your Details' },
    { id: 2, label: 'Shipping'     },
];

function StepIndicator({ current, total }) {
    return (
        <div className="cp-steps">
            {Array.from({ length: total }, (_, i) => {
                const n     = i + 1;
                const done  = current > n;
                const active= current === n;
                return (
                    <React.Fragment key={n}>
                        <div className={`cp-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                            <div className="cp-step-circle">
                                {done ? <CheckCircle size={14} /> : n}
                            </div>
                            <span className="cp-step-label">{STEPS[i].label}</span>
                        </div>
                        {i < total - 1 && (
                            <div className={`cp-step-line ${done ? 'done' : ''}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function FieldError({ msg }) {
    return msg
        ? <span className="cp-field-error">{msg}</span>
        : null;
}

export default function CompleteProfile() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user, loading, error, success, message } = useSelector(s => s.user);

    const [step, setStep]       = useState(1);
    const [touched, setTouched] = useState({});
    const [errors, setErrors]   = useState({});

    const [form, setForm] = useState({
        email:       '',
        phone:       '',
        dateOfBirth: '',
        gender:      '',
    });

    const [shipping, setShipping] = useState({
        address: '',
        city:    '',
        state:   '',
        country: '',
        pinCode: '',
    });

    // Derive which fields are missing
    const needsEmail  = !user?.email;
    const needsPhone  = !user?.phone;
    const needsDob    = !user?.dateOfBirth;
    const needsGender = !user?.gender;

    // Guard — already complete or local user → redirect away
    useEffect(() => {
        if (!user) return;
        if (user.profileCompleted || user.authProvider === 'local') {
            navigate('/', { replace: true });
        }
    }, [user, navigate]);

    const touch = (name) => setTouched(p => ({ ...p, [name]: true }));

    const onField = (e) => {
        const { name, value } = e.target;
        setForm(p => ({ ...p, [name]: value }));
        setErrors(p => ({ ...p, [name]: '' }));
    };

    const onShipping = (e) => {
        const { name, value } = e.target;
        setShipping(p => ({ ...p, [name]: value }));
    };

    const validateStep1 = () => {
        const errs = {};
        if (needsEmail) {
            if (!form.email.trim())         errs.email = 'Email address is required';
            else if (!EMAIL_RE.test(form.email)) errs.email = 'Please enter a valid email address';
        }
        if (needsPhone) {
            if (!form.phone.trim())              errs.phone = 'Phone number is required';
            else if (!PHONE_RE.test(form.phone)) errs.phone = 'Include country code, e.g. +1, +44, +234';
        }
        if (needsDob) {
            if (!form.dateOfBirth) {
                errs.dateOfBirth = 'Date of birth is required';
            } else {
                const age = (Date.now() - new Date(form.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
                if (age < 13)  errs.dateOfBirth = 'You must be at least 13 years old';
                if (age > 120) errs.dateOfBirth = 'Invalid date of birth';
            }
        }
        if (needsGender && !form.gender) errs.gender = 'Please select your gender';
        return errs;
    };

    const goNext = () => {
        const errs = validateStep1();
        if (Object.keys(errs).length) {
            setErrors(errs);
            const allTouched = {};
            Object.keys(errs).forEach(k => { allTouched[k] = true; });
            setTouched(p => ({ ...p, ...allTouched }));
            return;
        }
        setStep(2);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const updateData = {};
        if (needsEmail  && form.email)       updateData.email       = form.email.trim().toLowerCase();
        if (needsPhone  && form.phone)       updateData.phone       = form.phone.trim();
        if (needsDob    && form.dateOfBirth) updateData.dateOfBirth = form.dateOfBirth;
        if (needsGender && form.gender)      updateData.gender      = form.gender;

        const hasShipping = Object.values(shipping).some(v => v.trim() !== '');
        if (hasShipping) updateData.shippingAddress = shipping;

        try {
            await dispatch(updateProfile(updateData)).unwrap();
            // If we collected a new email, user needs to verify it
            if (needsEmail && form.email) {
                toast.success('Profile saved! Please verify your email to continue.', {
                    position: 'top-center',
                    autoClose: 3000,
                });
                dispatch(removeSuccess());
                navigate('/verify-email', { state: { email: form.email.trim().toLowerCase() } });
            } else {
                await dispatch(loadUser());
            }
        } catch {
            // handled by error useEffect
        }
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 2500 });
            dispatch(removeErrors());
        }
    }, [error, dispatch]);

    useEffect(() => {
        if (success && !needsEmail) {
            toast.success(message || 'Profile completed!', { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
            navigate('/');
        }
    }, [success, message, needsEmail, navigate, dispatch]);

    useEffect(() => () => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
    }, [dispatch]);

    if (loading) return <Loader />;

    const providerName = user?.authProvider === 'google' ? 'Google' : 'Facebook';
    const providerColor = user?.authProvider === 'google' ? '#4285F4' : '#1877F2';

    return (
        <>
            <Navbar />

            <div className="cp-page">
                <div className="cp-left" aria-hidden="true">
                    <div className="cp-left-inner">
                        <div className="cp-left-brand">
                            <span className="cp-brand-e">Epic</span>
                            <span className="cp-brand-s">Store</span>
                        </div>

                        <div className="cp-provider-badge" style={{ '--provider-color': providerColor }}>
                            {user?.authProvider === 'google' ? (
                                <svg width="18" height="18" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                </svg>
                            )}
                            <span>Signed in with {providerName}</span>
                        </div>

                        <h2 className="cp-left-headline">Almost there.</h2>
                        <p className="cp-left-sub">
                            We just need a few more details to personalise your experience and keep your account secure.
                        </p>

                        <ul className="cp-perks">
                            {needsEmail && (
                                <li>
                                    <div className="cp-perk-dot" />
                                    <span>Verify your email to receive order updates</span>
                                </li>
                            )}
                            <li>
                                <div className="cp-perk-dot" />
                                <span>Phone number for delivery coordination</span>
                            </li>
                            <li>
                                <div className="cp-perk-dot" />
                                <span>Save your shipping address for faster checkout</span>
                            </li>
                            <li>
                                <div className="cp-perk-dot" />
                                <span>Unlock personalised offers and discounts</span>
                            </li>
                        </ul>

                        <div className="cp-progress-wrap">
                            <div className="cp-progress-label">
                                <span>Profile completion</span>
                                <span>{step === 1 ? '50%' : '100%'}</span>
                            </div>
                            <div className="cp-progress-bar">
                                <div
                                    className="cp-progress-fill"
                                    style={{ width: step === 1 ? '50%' : '100%' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="cp-right">
                    <div className="cp-form-wrap">
                        <div className="cp-mobile-brand">
                            <span className="cp-brand-e">Epic</span>
                            <span className="cp-brand-s">Store</span>
                        </div>

                        <div className="cp-header">
                            <h1 className="cp-title">Complete your profile</h1>
                            <p className="cp-subtitle">Step {step} of {STEPS.length} — {STEPS[step - 1].label}</p>
                        </div>

                        <StepIndicator current={step} total={STEPS.length} />

                        <form onSubmit={handleSubmit} noValidate>

                            {step === 1 && (
                                <div className="cp-fields">
                                    {needsEmail && (
                                        <div className="cp-field">
                                            <label htmlFor="email">
                                                Email address <span className="cp-req">*</span>
                                            </label>
                                            <input
                                                id="email"
                                                name="email"
                                                type="email"
                                                placeholder="you@example.com"
                                                value={form.email}
                                                onChange={onField}
                                                onBlur={() => touch('email')}
                                                className={`cp-input ${errors.email && touched.email ? 'cp-input-error' : ''}`}
                                                autoComplete="email"
                                                disabled={loading}
                                            />
                                            {touched.email && <FieldError msg={errors.email} />}
                                            <span className="cp-hint">
                                                You'll need to verify this email before continuing.
                                            </span>
                                        </div>
                                    )}

                                    {needsPhone && (
                                        <div className="cp-field">
                                            <label htmlFor="phone">
                                                Phone number <span className="cp-req">*</span>
                                            </label>
                                            <input
                                                id="phone"
                                                name="phone"
                                                type="tel"
                                                placeholder="+1 555 000 0000"
                                                value={form.phone}
                                                onChange={onField}
                                                onBlur={() => touch('phone')}
                                                className={`cp-input ${errors.phone && touched.phone ? 'cp-input-error' : ''}`}
                                                autoComplete="tel"
                                                disabled={loading}
                                            />
                                            {touched.phone && <FieldError msg={errors.phone} />}
                                            <span className="cp-hint">Include your country code</span>
                                        </div>
                                    )}

                                    <div className="cp-row">
                                        {needsDob && (
                                            <div className="cp-field">
                                                <label htmlFor="dateOfBirth">
                                                    Date of birth <span className="cp-req">*</span>
                                                </label>
                                                <input
                                                    id="dateOfBirth"
                                                    name="dateOfBirth"
                                                    type="date"
                                                    value={form.dateOfBirth}
                                                    onChange={onField}
                                                    onBlur={() => touch('dateOfBirth')}
                                                    className={`cp-input ${errors.dateOfBirth && touched.dateOfBirth ? 'cp-input-error' : ''}`}
                                                    autoComplete="bday"
                                                    disabled={loading}
                                                />
                                                {touched.dateOfBirth && <FieldError msg={errors.dateOfBirth} />}
                                            </div>
                                        )}

                                        {needsGender && (
                                            <div className="cp-field">
                                                <label htmlFor="gender">
                                                    Gender <span className="cp-req">*</span>
                                                </label>
                                                <div className="cp-select-wrap">
                                                    <select
                                                        id="gender"
                                                        name="gender"
                                                        value={form.gender}
                                                        onChange={onField}
                                                        onBlur={() => touch('gender')}
                                                        className={`cp-input ${errors.gender && touched.gender ? 'cp-input-error' : ''}`}
                                                        disabled={loading}
                                                    >
                                                        <option value="">Select gender</option>
                                                        <option value="male">Male</option>
                                                        <option value="female">Female</option>
                                                        <option value="other">Other</option>
                                                    </select>
                                                    <i className="cp-chevron">▾</i>
                                                </div>
                                                {touched.gender && <FieldError msg={errors.gender} />}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="cp-fields">
                                    <div className="cp-info-note">
                                        <CheckCircle size={15} />
                                        <span>
                                            Shipping address is optional — you can skip this and add it later from your profile.
                                        </span>
                                    </div>

                                    <div className="cp-field">
                                        <label htmlFor="address">Street address</label>
                                        <input
                                            id="address"
                                            name="address"
                                            type="text"
                                            placeholder="123 Main Street, Apt 4B"
                                            value={shipping.address}
                                            onChange={onShipping}
                                            className="cp-input"
                                            autoComplete="street-address"
                                            disabled={loading}
                                        />
                                    </div>

                                    <div className="cp-row">
                                        <div className="cp-field">
                                            <label htmlFor="city">City</label>
                                            <input
                                                id="city"
                                                name="city"
                                                type="text"
                                                placeholder="New York"
                                                value={shipping.city}
                                                onChange={onShipping}
                                                className="cp-input"
                                                autoComplete="address-level2"
                                                disabled={loading}
                                            />
                                        </div>
                                        <div className="cp-field">
                                            <label htmlFor="state">State / Province</label>
                                            <input
                                                id="state"
                                                name="state"
                                                type="text"
                                                placeholder="NY"
                                                value={shipping.state}
                                                onChange={onShipping}
                                                className="cp-input"
                                                autoComplete="address-level1"
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>

                                    <div className="cp-row">
                                        <div className="cp-field">
                                            <label htmlFor="country">Country</label>
                                            <input
                                                id="country"
                                                name="country"
                                                type="text"
                                                placeholder="United States"
                                                value={shipping.country}
                                                onChange={onShipping}
                                                className="cp-input"
                                                autoComplete="country-name"
                                                disabled={loading}
                                            />
                                        </div>
                                        <div className="cp-field">
                                            <label htmlFor="pinCode">ZIP / Pin code</label>
                                            <input
                                                id="pinCode"
                                                name="pinCode"
                                                type="text"
                                                placeholder="10001"
                                                value={shipping.pinCode}
                                                onChange={onShipping}
                                                className="cp-input"
                                                autoComplete="postal-code"
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="cp-actions">
                                {step === 1 ? (
                                    <button type="button" className="cp-btn-next" onClick={goNext} disabled={loading}>
                                        Continue
                                        <span className="cp-btn-arrow">→</span>
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            className="cp-btn-back"
                                            onClick={() => setStep(1)}
                                            disabled={loading}
                                        >
                                            Back
                                        </button>
                                        <button type="submit" className="cp-btn-next" disabled={loading}>
                                            {loading ? (
                                                <>
                                                    <span className="cp-spinner" />
                                                    Saving…
                                                </>
                                            ) : (
                                                <>
                                                    <Save size={16} />
                                                    {needsEmail ? 'Save & Verify Email' : 'Complete Profile'}
                                                </>
                                            )}
                                        </button>
                                    </>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <Footer />
        </>
    );
}