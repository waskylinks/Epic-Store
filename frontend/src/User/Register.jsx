import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { register, removeErrors, removeSuccess } from '../features/products/userSlice';
import GoogleSignInButton from '../components/GoogleSignInButton';
import FacebookSignInButton from '../components/FacebookSignInButton';
import Select from 'react-select';
import '../UserStyles/Register.css';

const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE   = /^\+?[\d\s\-(]{7,20}$/;
const NAME_RE    = /^[a-zA-Z\s'-]+$/;

// FIX: minimum password length reduced from 12 → 8
const getPwReqs = (pw) => ({
    len:     pw.length >= 8,
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
    if (met <= 2) return { level: 1, label: 'Weak',   color: '#E24B4A' };
    if (met <= 3) return { level: 2, label: 'Fair',   color: '#EF9F27' };
    if (met <= 4) return { level: 3, label: 'Good',   color: '#378ADD' };
    return           { level: 4, label: 'Strong', color: '#1D9E75' };
};

const STEPS = [
    { id: 1, label: 'Account',  icon: 'ti-user'        },
    { id: 2, label: 'Personal', icon: 'ti-id-badge'    },
    { id: 3, label: 'Address',  icon: 'ti-map-pin'     },
    { id: 4, label: 'Security', icon: 'ti-shield-lock' },
];

/* ─── CAROUSEL SLIDES ────────────────────────────────────────────────────────
   Replace `imageSrc` values with your actual image paths or URLs.
   Suggested image themes are in the `hint` field for reference.
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

// ─── CSC API ──────────────────────────────────────────────────────────────────
const CSC_KEY     = import.meta.env.VITE_CSC_API_KEY || '';
const CSC_HEADERS = { 'X-CSCAPI-KEY': CSC_KEY };

// ─── React Select styles — dark card context ──────────────────────────────────
const buildRegSelectStyles = (hasError = false) => ({
    control: (base, state) => ({
        ...base,
        minHeight: '48px',
        borderColor: hasError
            ? state.isFocused ? '#E24B4A' : 'rgba(226,75,74,0.6)'
            : state.isFocused ? 'rgba(224,85,85,0.35)' : 'rgba(255,255,255,0.09)',
        borderWidth: state.isFocused ? '1px' : '1.5px',
        borderRadius: '12px',
        boxShadow: state.isFocused
            ? hasError
                ? '0 0 0 3px rgba(226,75,74,0.10)'
                : '0 0 0 2px rgba(224,85,85,0.08)'
            : 'none',
        backgroundColor: state.isFocused
            ? 'rgba(224,85,85,0.03)'
            : 'rgba(255,255,255,0.055)',
        fontSize: '14px',
        fontFamily: 'var(--reg-font)',
        cursor: 'pointer',
        transition: 'border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
        '&:hover': {
            borderColor: hasError ? 'rgba(226,75,74,0.6)' : 'rgba(255,255,255,0.16)',
            backgroundColor: 'rgba(255,255,255,0.075)',
        },
    }),
    option: (base, state) => ({
        ...base,
        fontSize: '13px',
        fontFamily: 'var(--reg-font)',
        fontWeight: state.isSelected ? 600 : 400,
        backgroundColor: state.isSelected
            ? 'rgba(224,85,85,0.18)'
            : state.isFocused
            ? 'rgba(255,255,255,0.07)'
            : 'transparent',
        color: state.isSelected ? '#fff' : 'rgba(240,239,232,0.85)',
        cursor: 'pointer',
        padding: '10px 14px',
        borderRadius: '6px',
    }),
    placeholder: (base) => ({
        ...base,
        color: 'rgba(255,255,255,0.18)',
        fontSize: '14px',
        fontWeight: 400,
        fontFamily: 'var(--reg-font)',
    }),
    singleValue: (base) => ({
        ...base,
        color: 'rgba(240,239,232,0.92)',
        fontSize: '14px',
        fontWeight: 500,
        fontFamily: 'var(--reg-font)',
    }),
    input: (base) => ({
        ...base,
        color: 'rgba(240,239,232,0.92)',
        fontFamily: 'var(--reg-font)',
        fontSize: '14px',
    }),
    menu: (base) => ({
        ...base,
        backgroundColor: '#1e1e1e',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 9999,
        overflow: 'hidden',
    }),
    menuList: (base) => ({
        ...base,
        maxHeight: '200px',
        padding: '4px',
    }),
    loadingMessage: (base) => ({ ...base, fontSize: '13px', color: 'rgba(240,239,232,0.4)', fontFamily: 'var(--reg-font)' }),
    noOptionsMessage: (base) => ({ ...base, fontSize: '13px', color: 'rgba(240,239,232,0.4)', fontFamily: 'var(--reg-font)' }),
    indicatorSeparator: () => ({ display: 'none' }),
    dropdownIndicator: (base, state) => ({
        ...base,
        color: 'rgba(255,255,255,0.22)',
        transition: 'transform 0.18s ease, color 0.18s ease',
        transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        padding: '0 10px 0 4px',
        '&:hover': { color: 'rgba(255,255,255,0.5)' },
    }),
    clearIndicator: (base) => ({
        ...base,
        color: 'rgba(255,255,255,0.22)',
        padding: '0 4px',
        '&:hover': { color: 'rgba(255,255,255,0.5)' },
    }),
    valueContainer: (base) => ({
        ...base,
        padding: '0 14px',
    }),
});

// ─── Format country option with flag ─────────────────────────────────────────
const formatCountryOption = ({ label, flag }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {flag && (
            <img
                src={flag}
                alt=""
                style={{ width: '20px', height: '14px', objectFit: 'cover', borderRadius: '2px', flexShrink: 0 }}
            />
        )}
        <span>{label}</span>
    </div>
);

/* ─── CAROUSEL COMPONENT ───────────────────────────────────────────────────── */
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
        const tick = () => goTo((active + 1) % count, 'next');
        timerRef.current = setInterval(tick, 5000);
        return () => clearInterval(timerRef.current);
        // goTo is recreated each render but is referentially stable in effect
        // terms — its identity doesn't affect the interval logic, only active
        // and count do. Suppressing to avoid an infinite re-subscription loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, count]);

    const slide = SLIDES[active];

    return (
        <div className="reg-carousel" aria-label="Feature highlights">
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

            {/* ── Dot indicators ── */}
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

/* ─── STEP INDICATOR ───────────────────────────────────────────────────────── */
function StepIndicator({ current }) {
    return (
        <div className="reg-steps" role="list" aria-label="Registration steps">
            {STEPS.map((step, idx) => {
                const done   = current > step.id;
                const active = current === step.id;
                return (
                    <React.Fragment key={step.id}>
                        <div
                            className={`reg-step${active ? ' active' : ''}${done ? ' done' : ''}`}
                            role="listitem"
                            aria-current={active ? 'step' : undefined}
                        >
                            <div className="reg-step-circle">
                                {done
                                    ? <i className="ti ti-check" aria-hidden="true" />
                                    : <i className={`ti ${step.icon}`} aria-hidden="true" />
                                }
                            </div>
                            <span className="reg-step-label">{step.label}</span>
                        </div>
                        {idx < STEPS.length - 1 && (
                            <div className={`reg-step-line${done ? ' done' : ''}`} aria-hidden="true" />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

/* ─── FIELD ERROR ──────────────────────────────────────────────────────────── */
function FieldError({ msg }) {
    return msg ? (
        <span className="reg-field-error" role="alert">
            <i className="ti ti-alert-circle" aria-hidden="true" />
            {msg}
        </span>
    ) : null;
}

/* ─── MAIN COMPONENT ───────────────────────────────────────────────────────── */
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

    // ─── Step 3: shipping state ───────────────────────────────────────────────
    const [shipping, setShipping] = useState({
        address: '',
        city:    '',
        state:   '',
        country: '',
        pinCode: '',
    });

    // CSC dropdown data
    const [countries,       setCountries]       = useState([]);
    const [states,          setStates]          = useState([]);
    const [cities,          setCities]          = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(false);
    const [loadingStates,   setLoadingStates]   = useState(false);
    const [loadingCities,   setLoadingCities]   = useState(false);

    // Controlled React Select values
    const [selectedCountry, setSelectedCountry] = useState(null);
    const [selectedState,   setSelectedState]   = useState(null);
    const [selectedCity,    setSelectedCity]    = useState(null);

    // Whether the user has touched any shipping field (to decide if we skip or save)
    const [shippingTouched, setShippingTouched] = useState(false);
    const [setAsDefault,    setSetAsDefault]    = useState(false);

    // ─── CSC fetch helpers ────────────────────────────────────────────────────
    const fetchStates = useCallback(async (countryIso2) => {
        if (!countryIso2) return;
        setLoadingStates(true);
        setStates([]);
        setCities([]);
        setSelectedState(null);
        setSelectedCity(null);
        setShipping(p => ({ ...p, state: '', city: '' }));
        try {
            const res  = await fetch(
                `https://api.countrystatecity.in/v1/countries/${countryIso2}/states`,
                { headers: CSC_HEADERS }
            );
            const data = await res.json();
            if (Array.isArray(data)) {
                const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
                setStates(sorted.map(s => ({
                    value:      s.name,
                    label:      s.name,
                    iso2:       s.iso2,
                    countryIso: countryIso2,
                })));
            }
        } catch (err) {
            console.error('Failed to fetch states:', err);
        } finally {
            setLoadingStates(false);
        }
    }, []);

    const fetchCities = useCallback(async (countryIso2, stateIso2) => {
        if (!countryIso2 || !stateIso2) return;
        setLoadingCities(true);
        setCities([]);
        setSelectedCity(null);
        setShipping(p => ({ ...p, city: '' }));
        try {
            const res  = await fetch(
                `https://api.countrystatecity.in/v1/countries/${countryIso2}/states/${stateIso2}/cities`,
                { headers: CSC_HEADERS }
            );
            const data = await res.json();
            if (Array.isArray(data)) {
                const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
                setCities(sorted.map(c => ({ value: c.name, label: c.name })));
            }
        } catch (err) {
            console.error('Failed to fetch cities:', err);
        } finally {
            setLoadingCities(false);
        }
    }, []);

    const fetchCountries = useCallback(async () => {
        setLoadingCountries(true);
        try {
            const res    = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,flags');
            const data   = await res.json();
            const sorted = data.sort((a, b) => a.name.common.localeCompare(b.name.common));
            const opts   = sorted.map(c => ({
                value: c.name.common,
                label: c.name.common,
                iso2:  c.cca2,
                flag:  c.flags?.svg || c.flags?.png || '',
            }));
            setCountries(opts);

            // Pre-select Nigeria as default
            const nigeria = opts.find(o => o.iso2 === 'NG');
            if (nigeria) {
                setSelectedCountry(nigeria);
                setShipping(p => ({ ...p, country: nigeria.value }));
                fetchStates(nigeria.iso2);
            }
        } catch (err) {
            console.error('Failed to fetch countries:', err);
        } finally {
            setLoadingCountries(false);
        }
    }, [fetchStates]);

    // Fetch countries once when user reaches step 3
    const countriesLoadedRef = useRef(false);
    useEffect(() => {
        if (step === 3 && !countriesLoadedRef.current) {
            countriesLoadedRef.current = true;
            fetchCountries();
        }
    }, [step, fetchCountries]);

    // ─── CSC handlers ─────────────────────────────────────────────────────────
    const handleCountryChange = (selected) => {
        setSelectedCountry(selected);
        setSelectedState(null);
        setSelectedCity(null);
        setShipping(p => ({ ...p, country: selected?.value || '', state: '', city: '' }));
        setShippingTouched(true);
        if (selected) fetchStates(selected.iso2);
        else { setStates([]); setCities([]); }
    };

    const handleStateChange = (selected) => {
        setSelectedState(selected);
        setSelectedCity(null);
        setShipping(p => ({ ...p, state: selected?.value || '', city: '' }));
        setShippingTouched(true);
        if (selected) fetchCities(selected.countryIso, selected.iso2);
        else setCities([]);
    };

    const handleCityChange = (selected) => {
        setSelectedCity(selected);
        setShipping(p => ({ ...p, city: selected?.value || '' }));
        setShippingTouched(true);
    };

    // ─── Determine if enough shipping data was filled to save ─────────────────
    // We require at minimum: address + country + state.
    // city is optional for countries where CSC returns no cities.
    // pinCode is optional since some countries don't use postal codes.
    const hasMinShipping = () => {
        return (
            shipping.address.trim().length >= 5 &&
            shipping.country.trim().length  >  0 &&
            shipping.state.trim().length    >  0
        );
    };

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
        setShippingTouched(true);
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
        if (n === 3) {
            // Step 3 is optional overall, but if the user filled the address
            // field we enforce the minimum requirements so partial data isn't saved.
            if (shippingTouched && shipping.address.trim().length > 0) {
                if (shipping.address.trim().length < 5) errs.shippingAddress = 'Address must be at least 5 characters';
                if (!shipping.country) errs.shippingCountry = 'Please select a country';
                if (!shipping.state)  errs.shippingState   = 'Please select a state / province';
            }
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

        // Attach shipping if the user filled enough fields
        if (hasMinShipping()) {
            payload.shippingAddress = {
                address:   shipping.address.trim(),
                city:      shipping.city.trim(),
                state:     shipping.state.trim(),
                country:   shipping.country.trim(),
                pinCode:   shipping.pinCode.trim(),
                isDefault: setAsDefault,
            };
        }

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

    useEffect(() => () => {
        dispatch(removeErrors());
        dispatch(removeSuccess());
    }, [dispatch]);

    const pwStrength = getPwStrength(form.password);
    const pwReqs     = getPwReqs(form.password);

    return (
        <div className="reg-page">
            {/* ── LEFT: carousel (hidden on mobile) ── */}
            <aside className="reg-left" aria-label="Store highlights">
                <LeftCarousel />
            </aside>

            {/* ── RIGHT: registration form ── */}
            <main className="reg-right">
                <div className="reg-form-wrap">

                    {/* Mobile brand mark */}
                    <div className="reg-mobile-brand" aria-label="Epic Store">
                        <span className="reg-brand-e">Epic</span>
                        <span className="reg-brand-s">Store</span>
                    </div>

                    {/* Header */}
                    <div className="reg-header">
                        <h1 className="reg-title">Create your account</h1>
                        <p className="reg-subtitle">
                            Step {step} of {STEPS.length} &mdash; {STEPS[step - 1].label}
                        </p>
                    </div>

                    {/* Step indicator */}
                    <StepIndicator current={step} />

                    {/* OAuth buttons */}
                    <div className="reg-oauth-section">
                        <p className="reg-oauth-section-label">Quick sign-up</p>
                        <div className="reg-oauth">
                            <GoogleSignInButton text="Continue with Google" />
                            <FacebookSignInButton text="Continue with Facebook" />
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="reg-divider"><span>or register with email</span></div>

                    {/* Form card */}
                    <div className="reg-form-card">
                        <form onSubmit={handleSubmit} noValidate>

                            {/* ── Step 1: Account ── */}
                            {step === 1 && (
                                <div className="reg-fields">
                                    <div className="reg-row">
                                        <div className="reg-field">
                                            <label htmlFor="firstName">
                                                First name <span className="req-star" aria-hidden="true">*</span>
                                            </label>
                                            <div className={`reg-input-wrap${errors.firstName && touched.firstName ? ' has-error' : ''}`}>
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
                                                    aria-required="true"
                                                    aria-invalid={!!(errors.firstName && touched.firstName)}
                                                />
                                            </div>
                                            {touched.firstName && <FieldError msg={errors.firstName} />}
                                        </div>
                                        <div className="reg-field">
                                            <label htmlFor="lastName">
                                                Last name <span className="req-star" aria-hidden="true">*</span>
                                            </label>
                                            <div className={`reg-input-wrap${errors.lastName && touched.lastName ? ' has-error' : ''}`}>
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
                                                    aria-required="true"
                                                    aria-invalid={!!(errors.lastName && touched.lastName)}
                                                />
                                            </div>
                                            {touched.lastName && <FieldError msg={errors.lastName} />}
                                        </div>
                                    </div>

                                    <div className="reg-field">
                                        <label htmlFor="email">
                                            Email address <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${errors.email && touched.email ? ' has-error' : ''}`}>
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
                                                aria-required="true"
                                                aria-invalid={!!(errors.email && touched.email)}
                                            />
                                        </div>
                                        {touched.email && <FieldError msg={errors.email} />}
                                    </div>
                                </div>
                            )}

                            {/* ── Step 2: Personal ── */}
                            {step === 2 && (
                                <div className="reg-fields">
                                    <div className="reg-field">
                                        <label htmlFor="phone">
                                            Phone number <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${errors.phone && touched.phone ? ' has-error' : ''}`}>
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
                                                aria-required="true"
                                                aria-invalid={!!(errors.phone && touched.phone)}
                                            />
                                        </div>
                                        <span className="reg-hint">Include your country code, e.g. +1, +44, +234</span>
                                        {touched.phone && <FieldError msg={errors.phone} />}
                                    </div>

                                    <div className="reg-row">
                                        <div className="reg-field">
                                            <label htmlFor="dateOfBirth">
                                                Date of birth <span className="req-star" aria-hidden="true">*</span>
                                            </label>
                                            <div className={`reg-input-wrap${errors.dateOfBirth && touched.dateOfBirth ? ' has-error' : ''}`}>
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
                                                    aria-required="true"
                                                    aria-invalid={!!(errors.dateOfBirth && touched.dateOfBirth)}
                                                />
                                            </div>
                                            {touched.dateOfBirth && <FieldError msg={errors.dateOfBirth} />}
                                        </div>
                                        <div className="reg-field">
                                            <label htmlFor="gender">
                                                Gender <span className="req-star" aria-hidden="true">*</span>
                                            </label>
                                            <div className={`reg-input-wrap reg-select-wrap${errors.gender && touched.gender ? ' has-error' : ''}`}>
                                                <i className="ti ti-gender-bigender field-icon" aria-hidden="true" />
                                                <select
                                                    id="gender"
                                                    name="gender"
                                                    value={form.gender}
                                                    onChange={onField}
                                                    onBlur={() => touch('gender')}
                                                    disabled={loading}
                                                    aria-required="true"
                                                    aria-invalid={!!(errors.gender && touched.gender)}
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

                            {/* ── Step 3: Address ── */}
                            {step === 3 && (
                                <div className="reg-fields">
                                    <div className="reg-section-note">
                                        <i className="ti ti-info-circle" aria-hidden="true" />
                                        <span>Shipping address is optional — you can add or update it later. Fill at least your street address, country and state to save it now.</span>
                                    </div>

                                    {/* Street address — plain text input */}
                                    <div className="reg-field">
                                        <label htmlFor="reg-address">Street address</label>
                                        <div className={`reg-input-wrap${errors.shippingAddress ? ' has-error' : ''}`}>
                                            <i className="ti ti-home field-icon" aria-hidden="true" />
                                            <input
                                                id="reg-address"
                                                name="address"
                                                type="text"
                                                placeholder="123 Main Street, Apt 4B"
                                                value={shipping.address}
                                                onChange={onShipping}
                                                disabled={loading}
                                                autoComplete="street-address"
                                            />
                                        </div>
                                        {errors.shippingAddress && <FieldError msg={errors.shippingAddress} />}
                                    </div>

                                    {/* Country dropdown */}
                                    <div className="reg-field">
                                        <label>Country</label>
                                        <Select
                                            inputId="reg-country"
                                            options={countries}
                                            value={selectedCountry}
                                            onChange={handleCountryChange}
                                            isLoading={loadingCountries}
                                            isDisabled={loading}
                                            placeholder={loadingCountries ? 'Loading countries…' : 'Search country…'}
                                            styles={buildRegSelectStyles(!!errors.shippingCountry)}
                                            formatOptionLabel={formatCountryOption}
                                            noOptionsMessage={() => 'No country found'}
                                            loadingMessage={() => 'Loading countries…'}
                                            isClearable
                                        />
                                        {errors.shippingCountry && <FieldError msg={errors.shippingCountry} />}
                                    </div>

                                    {/* State + City row */}
                                    <div className="reg-row">
                                        <div className="reg-field">
                                            <label>State / Province</label>
                                            {/* Show dropdown when states loaded, otherwise plain input */}
                                            {(states.length > 0 || loadingStates || !selectedCountry) ? (
                                                <Select
                                                    inputId="reg-state"
                                                    options={states}
                                                    value={selectedState}
                                                    onChange={handleStateChange}
                                                    isLoading={loadingStates}
                                                    isDisabled={!selectedCountry || loadingStates || loading}
                                                    placeholder={
                                                        !selectedCountry ? 'Select country first'
                                                        : loadingStates  ? 'Loading…'
                                                        : 'Search state…'
                                                    }
                                                    styles={buildRegSelectStyles(!!errors.shippingState)}
                                                    noOptionsMessage={() => 'No states found'}
                                                    isClearable
                                                />
                                            ) : (
                                                <div className="reg-input-wrap">
                                                    <i className="ti ti-map field-icon" aria-hidden="true" />
                                                    <input
                                                        id="reg-state-text"
                                                        name="state"
                                                        type="text"
                                                        placeholder="Enter your state"
                                                        value={shipping.state}
                                                        onChange={onShipping}
                                                        disabled={loading}
                                                    />
                                                </div>
                                            )}
                                            {errors.shippingState && <FieldError msg={errors.shippingState} />}
                                        </div>

                                        <div className="reg-field">
                                            {/* City label gets "(optional)" when CSC returns no cities */}
                                            <label>
                                                City
                                                {selectedState && cities.length === 0 && !loadingCities && (
                                                    <span className="reg-optional-tag"> (optional)</span>
                                                )}
                                            </label>
                                            {(cities.length > 0 || loadingCities || !selectedState) ? (
                                                <Select
                                                    inputId="reg-city"
                                                    options={cities}
                                                    value={selectedCity}
                                                    onChange={handleCityChange}
                                                    isLoading={loadingCities}
                                                    isDisabled={!selectedState || loadingCities || loading}
                                                    placeholder={
                                                        !selectedState ? 'Select state first'
                                                        : loadingCities ? 'Loading…'
                                                        : 'Search city…'
                                                    }
                                                    styles={buildRegSelectStyles(false)}
                                                    noOptionsMessage={() => 'No cities found'}
                                                    isClearable
                                                />
                                            ) : (
                                                <div className="reg-input-wrap">
                                                    <i className="ti ti-building field-icon" aria-hidden="true" />
                                                    <input
                                                        id="reg-city-text"
                                                        name="city"
                                                        type="text"
                                                        placeholder="Enter your city"
                                                        value={shipping.city}
                                                        onChange={onShipping}
                                                        disabled={loading}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* PIN code — optional, with country-aware label */}
                                    <div className="reg-field">
                                        <label htmlFor="reg-pinCode">
                                            ZIP / Postal code
                                            <span className="reg-optional-tag"> (optional)</span>
                                        </label>
                                        <div className="reg-input-wrap">
                                            <i className="ti ti-mailbox field-icon" aria-hidden="true" />
                                            <input
                                                id="reg-pinCode"
                                                name="pinCode"
                                                type="text"
                                                placeholder="10001"
                                                value={shipping.pinCode}
                                                onChange={onShipping}
                                                disabled={loading}
                                                autoComplete="postal-code"
                                                maxLength={20}
                                            />
                                        </div>
                                    </div>

                                    {/* "Set as default" — only shown when address has been started */}
                                    {hasMinShipping() && (
                                        <label className="reg-checkbox-label">
                                            <input
                                                type="checkbox"
                                                className="reg-checkbox"
                                                checked={setAsDefault}
                                                onChange={e => setSetAsDefault(e.target.checked)}
                                                disabled={loading}
                                            />
                                            <span>Set as my default shipping address</span>
                                        </label>
                                    )}
                                </div>
                            )}

                            {/* ── Step 4: Security ── */}
                            {step === 4 && (
                                <div className="reg-fields">
                                    <div className="reg-field">
                                        <label htmlFor="password">
                                            Password <span className="req-star" aria-hidden="true">*</span>
                                        </label>
                                        <div className={`reg-input-wrap${errors.password && touched.password ? ' has-error' : ''}`}>
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
                                                aria-required="true"
                                                aria-invalid={!!(errors.password && touched.password)}
                                                aria-describedby="pw-reqs-list"
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
                                                {/* Strength bar */}
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
                                                        <span className="pw-strength-label" style={{ color: pwStrength.color }}>
                                                            {pwStrength.label}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Requirements list */}
                                                <ul className="pw-reqs" id="pw-reqs-list" aria-label="Password requirements">
                                                    {[
                                                        [pwReqs.len,     '8+ characters'],
                                                        [pwReqs.upper,   'One uppercase letter'],
                                                        [pwReqs.lower,   'One lowercase letter'],
                                                        [pwReqs.num,     'One number'],
                                                        [pwReqs.special, 'One special character'],
                                                    ].map(([met, label]) => (
                                                        <li key={label} className={met ? 'met' : ''} aria-label={`${label}: ${met ? 'met' : 'not met'}`}>
                                                            <i className={`ti ${met ? 'ti-circle-check' : 'ti-circle'}`} aria-hidden="true" />
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

                            {/* ── Actions ── */}
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
                                                <span className="reg-spinner" aria-hidden="true" />
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
                    </div>{/* .reg-form-card */}

                    <p className="reg-signin">
                        Already have an account? <Link to="/login">Sign in</Link>
                    </p>
                </div>
            </main>
        </div>
    );
}