/**
 * FIX 2: Shipping.jsx — mount-time step advancement
 *
 * ROOT CAUSE:
 *   markAsAbandoned() records `this.currentStep` from the DATABASE document.
 *   The DB step is only written when updateCheckoutStep() succeeds on the server.
 *   Shipping.jsx only called updateCheckoutStep('shipping_info') on SUCCESSFUL SUBMIT.
 *
 *   So if the user:
 *     1. Visited Payment page previously  →  DB step = 'payment_gateway'
 *     2. Came back to Shipping page
 *     3. Closed the tab without submitting
 *
 *   The abandonment hook dispatches abandonCheckout() → markAsAbandoned() reads
 *   currentStep = 'payment_gateway' → wrong step recorded.
 *
 * FIX:
 *   Add a useEffect that runs once on mount (when checkoutId is available) and
 *   advances the DB step to 'shipping_info' immediately — the same pattern used
 *   in Payment.jsx for 'payment_selection'. This guarantees the DB and the hook's
 *   currentStep argument stay in sync at all times.
 *
 * INTEGRATION:
 *   Add the useEffect block below into Shipping.jsx, right after the existing
 *   useCheckoutAbandonment line. No other changes needed.
 */

// ─── PASTE THIS BLOCK into Shipping.jsx ──────────────────────────────────────
// Place it directly after:
//   const { setIntentionalProceed } = useCheckoutAbandonment(checkoutId, 'shipping_info');

/*

  // ── FIX: Record shipping_info step on mount so the DB currentStep matches
  // the abandonment hook's step arg even when the user bails without submitting.
  // Non-fatal: a tracking failure must never block the shipping form.
  useEffect(() => {
    if (!checkoutId) return;
    (async () => {
      try {
        await dispatch(updateCheckoutStep({
          checkoutId,
          step: 'shipping_info',
        })).unwrap();
      } catch (err) {
        console.warn('[Shipping] Failed to record shipping_info step on mount:', err);
      }
    })();
    // Run once on mount — checkoutId is stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutId]);

*/

// ─── ALSO ensure the import includes updateCheckoutStep if not already there ─
// The existing Shipping.jsx already imports:
//   import { updateCheckoutStep, selectCheckoutId } from '../features/checkout/checkoutSlice';
// so no import change is needed.

// ─── FULL UPDATED Shipping.jsx (complete file with fix applied) ──────────────

import React, { useState, useEffect, useCallback } from 'react';
import '../CartStyles/Shipping.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CheckoutPath from './CheckoutPath';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Select from 'react-select';
import {
  FiMapPin,
  FiCheck,
  FiTrash2,
  FiPlus,
  FiStar
} from 'react-icons/fi';

import {
  getSavedAddresses,
  getDefaultAddress,
  saveAddress,
  deleteAddress,
  setDefaultAddress,
  selectAddress,
  removeErrors,
  removeMessage,
  resetValidation
} from '../features/shipping/shippingSlice';

import useCheckoutAbandonment from '../hooks/useCheckoutAbandonment';
import { updateCheckoutStep, selectCheckoutId } from '../features/checkout/checkoutSlice';

// ─── React Select custom styles to match .es-input ───────────────────────────
const buildSelectStyles = (hasError = false) => ({
  control: (base, state) => ({
    ...base,
    minHeight: '44px',
    borderColor: hasError
      ? state.isFocused ? '#ef4444' : '#fca5a5'
      : state.isFocused ? '#4f46e5' : '#d1d5db',
    borderRadius: '8px',
    boxShadow: state.isFocused
      ? hasError
        ? '0 0 0 3px rgba(239,68,68,0.15)'
        : '0 0 0 3px rgba(79,70,229,0.15)'
      : 'none',
    backgroundColor: '#fff',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:hover': { borderColor: hasError ? '#ef4444' : '#4f46e5' },
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    backgroundColor: state.isSelected
      ? '#4f46e5'
      : state.isFocused
      ? '#eef2ff'
      : '#fff',
    color: state.isSelected ? '#fff' : '#111827',
    cursor: 'pointer',
    padding: '10px 14px',
  }),
  placeholder: (base) => ({
    ...base,
    color: '#9ca3af',
    fontSize: '0.9rem',
  }),
  singleValue: (base) => ({
    ...base,
    color: '#111827',
    fontSize: '0.95rem',
  }),
  menu: (base) => ({
    ...base,
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
    zIndex: 9999,
  }),
  menuList: (base) => ({
    ...base,
    maxHeight: '220px',
    padding: '4px',
  }),
  loadingMessage: (base) => ({ ...base, fontSize: '0.9rem', color: '#6b7280' }),
  noOptionsMessage: (base) => ({ ...base, fontSize: '0.9rem', color: '#6b7280' }),
  indicatorSeparator: () => ({ display: 'none' }),
});

// ─── CSC API key ──────────────────────────────────────────────────────────────
const CSC_KEY = import.meta.env.VITE_CSC_API_KEY || '';
const CSC_HEADERS = { 'X-CSCAPI-KEY': CSC_KEY };

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

function Shipping() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { user } = useSelector(state => state.user);
  const { cartItems } = useSelector(state => state.cart);
  const {
    addresses,
    selectedAddress,
    validationErrors,
    loading,
    actionLoading,
    error,
    success,
    message
  } = useSelector(state => state.shipping);

  const checkoutId = useSelector(selectCheckoutId);

  const { setIntentionalProceed } = useCheckoutAbandonment(checkoutId, 'shipping_info');

  // ── FIX 2: Advance DB currentStep to 'shipping_info' on mount ────────────
  // Without this, if the user previously reached 'payment_gateway' and returns
  // to the shipping page, the DB step stays at 'payment_gateway'. When the
  // abandonment hook fires on unmount it dispatches abandonCheckout(), and
  // markAsAbandoned() reads `this.currentStep` from the DB — recording
  // payment_gateway instead of shipping_info.
  // Non-fatal: a tracking failure must never block the shipping form UI.
  useEffect(() => {
    if (!checkoutId) return;
    (async () => {
      try {
        await dispatch(updateCheckoutStep({
          checkoutId,
          step: 'shipping_info',
        })).unwrap();
      } catch (err) {
        console.warn('[Shipping] Failed to record shipping_info step on mount:', err);
      }
    })();
    // Run once on mount — checkoutId is stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutId]);

  // ─── Form data ──────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    address: '',
    city: '',
    state: '',
    country: 'Nigeria',
    pinCode: '',
    phoneNo: ''
  });

  // ─── Dropdown options ────────────────────────────────────────────────────────
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);

  // ─── Loading states for cascading dropdowns ──────────────────────────────────
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  // ─── React Select controlled values ──────────────────────────────────────────
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);

  // ─── Form-level validation errors for React Select fields ────────────────────
  const [formErrors, setFormErrors] = useState({});

  const [saveToAccount, setSaveToAccount] = useState(false);
  const [setAsDefaultCheck, setSetAsDefaultCheck] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── fetchStates declared first so fetchCountries can reference it ───────────
  const fetchStates = useCallback(async (countryIso2) => {
    if (!countryIso2) return;
    setLoadingStates(true);
    setStates([]);
    setCities([]);
    setSelectedState(null);
    setSelectedCity(null);
    try {
      const res = await fetch(
        `https://api.countrystatecity.in/v1/countries/${countryIso2}/states`,
        { headers: CSC_HEADERS }
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
        setStates(sorted.map(s => ({
          value: s.name,
          label: s.name,
          iso2: s.iso2,
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
    try {
      const res = await fetch(
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

  // ─── fetchCountries depends on fetchStates (declared above) ──────────────────
  const fetchCountries = useCallback(async () => {
    setLoadingCountries(true);
    try {
      const res = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,flags');
      const data = await res.json();
      const sorted = data.sort((a, b) => a.name.common.localeCompare(b.name.common));
      const options = sorted.map(c => ({
        value: c.name.common,
        label: c.name.common,
        iso2: c.cca2,
        flag: c.flags?.svg || c.flags?.png || '',
      }));
      setCountries(options);

      const nigeria = options.find(o => o.iso2 === 'NG');
      if (nigeria) {
        setSelectedCountry(nigeria);
        fetchStates(nigeria.iso2);
      }
    } catch (err) {
      console.error('Failed to fetch countries:', err);
      toast.error('Could not load countries. Please refresh.', { position: 'top-center' });
    } finally {
      setLoadingCountries(false);
    }
  }, [fetchStates]);

  // ─── On mount: fetch saved addresses + all countries ─────────────────────────
  useEffect(() => {
    dispatch(getSavedAddresses());
    dispatch(getDefaultAddress());
    fetchCountries();
  }, [dispatch, fetchCountries]);

  useEffect(() => {
    if (!selectedAddress || countries.length === 0) return;

    setFormData({
      address: selectedAddress.address || '',
      city: selectedAddress.city || '',
      state: selectedAddress.state || '',
      country: selectedAddress.country || 'Nigeria',
      pinCode: selectedAddress.pinCode || '',
      phoneNo: selectedAddress.phoneNo || ''
    });

    const countryOpt = countries.find(c => c.value === selectedAddress.country);
    if (countryOpt) {
      setSelectedCountry(countryOpt);
      setSelectedState(null);
      setSelectedCity(null);
      fetchStates(countryOpt.iso2);
    }
  }, [selectedAddress, countries, fetchStates]);

  // FIX: selectedState and selectedCity are read inside these effects only to
  // compare against the newly resolved option — they are not drivers of the
  // effect. Including them as deps would cause infinite re-runs when the effect
  // itself calls setSelectedState/setSelectedCity. The exhaustive-deps warning
  // is intentionally suppressed here; the comparison is a guard, not a trigger.
  useEffect(() => {
    if (!formData.state || states.length === 0) return;
    const opt = states.find(s => s.value === formData.state);
    if (opt && (!selectedState || selectedState.value !== opt.value)) {
      setSelectedState(opt);
      fetchCities(opt.countryIso, opt.iso2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, formData.state, fetchCities]);

  useEffect(() => {
    if (!formData.city || cities.length === 0) return;
    const opt = cities.find(c => c.value === formData.city);
    if (opt && (!selectedCity || selectedCity.value !== opt.value)) {
      setSelectedCity(opt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities, formData.city]);

  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 3000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  useEffect(() => {
    if (success && message) {
      toast.success(message, { position: 'top-center', autoClose: 2000 });
      dispatch(removeMessage());
    }
  }, [success, message, dispatch]);

  useEffect(() => {
    if (cartItems.length === 0) {
      toast.warning('Your cart is empty', { position: 'top-center' });
      navigate('/cart');
    }
  }, [cartItems, navigate]);

  useEffect(() => {
    if (!saveToAccount) setSetAsDefaultCheck(false);
  }, [saveToAccount]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    dispatch(resetValidation());
    setFormErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleCountryChange = (selected) => {
    setSelectedCountry(selected);
    setSelectedState(null);
    setSelectedCity(null);
    setFormData(prev => ({ ...prev, country: selected?.value || '', state: '', city: '' }));
    dispatch(resetValidation());
    setFormErrors(prev => ({ ...prev, country: '', state: '', city: '' }));
    if (selected) fetchStates(selected.iso2);
    else { setStates([]); setCities([]); }
  };

  const handleStateChange = (selected) => {
    setSelectedState(selected);
    setSelectedCity(null);
    setFormData(prev => ({ ...prev, state: selected?.value || '', city: '' }));
    dispatch(resetValidation());
    setFormErrors(prev => ({ ...prev, state: '', city: '' }));
    if (selected) fetchCities(selected.countryIso, selected.iso2);
    else setCities([]);
  };

  const handleCityChange = (selected) => {
    setSelectedCity(selected);
    setFormData(prev => ({ ...prev, city: selected?.value || '' }));
    dispatch(resetValidation());
    setFormErrors(prev => ({ ...prev, city: '' }));
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.country) errors.country = 'Country is required';
    if (!formData.state) errors.state = 'State is required';
    if (!formData.city) errors.city = 'City is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const userName = user?.name || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'User';

      if (saveToAccount) {
        const saved = await dispatch(saveAddress({
          name: userName,
          ...formData,
          isDefault: setAsDefaultCheck
        })).unwrap();
        dispatch(selectAddress(saved));
      } else {
        dispatch(selectAddress({
          name: userName,
          ...formData
        }));
      }

      // The DB step is already 'shipping_info' (set on mount above).
      // This call just stamps the stepsCompleted array — still non-fatal.
      if (checkoutId) {
        try {
          await dispatch(updateCheckoutStep({
            checkoutId,
            step: 'shipping_info'
          })).unwrap();
        } catch (stepErr) {
          console.warn('[Shipping] Step update on submit failed (non-fatal):', stepErr);
        }
      }

      setIntentionalProceed();
      navigate('/order/confirm');
    } catch (err) {
      console.error('Shipping submission failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAddress = (addr) => {
    dispatch(selectAddress(addr));
    toast.success('Address selected', { position: 'top-center', autoClose: 2000 });
  };

  const handleDeleteAddress = async (id) => {
    if (!window.confirm('Delete this address?')) return;
    try { await dispatch(deleteAddress(id)).unwrap(); } catch { /* errors surfaced via Redux error state */ }
  };

  const handleSetDefault = async (id) => {
    try { await dispatch(setDefaultAddress(id)).unwrap(); } catch { /* errors surfaced via Redux error state */ }
  };

  const hasError = (kw) => validationErrors.length > 0 && validationErrors.some(e => e.includes(kw));
  const getErrors = (kw) => validationErrors.filter(e => e.includes(kw));

  return (
    <>
      <PageTitle title='Shipping Information' />
      <Navbar />
      <CheckoutPath activePath={0} />

      <div className="es-container">
        <h1 className="es-header">
          <FiMapPin />
          Shipping Information
        </h1>

        <div className="es-content">

          {addresses.length > 0 && (
            <div className="es-saved-section">
              <h2 className="es-saved-heading">
                <FiMapPin />
                Saved Addresses
              </h2>
              {loading ? (
                <div className="es-loading">Loading addresses...</div>
              ) : (
                <div className="es-saved-list">
                  {addresses.map(addr => (
                    <div
                      key={addr._id}
                      className={`es-saved-item ${addr.isDefault ? 'es-default' : ''} ${selectedAddress?._id === addr._id ? 'es-selected' : ''}`}
                    >
                      {addr.isDefault && (
                        <div className="es-default-badge">
                          <FiStar /> Default
                        </div>
                      )}
                      <div className="es-saved-info">
                        <p className="es-saved-name">{addr.name}</p>
                        <p className="es-saved-address">
                          {addr.address}, {addr.city}, {addr.state} — {addr.pinCode}
                        </p>
                        <p className="es-saved-phone">{addr.phoneNo}</p>
                      </div>
                      <div className="es-saved-actions">
                        <button className="es-saved-btn es-select-btn" onClick={() => handleSelectAddress(addr)}>
                          <FiCheck /> {selectedAddress?._id === addr._id ? 'Selected' : 'Select'}
                        </button>
                        {!addr.isDefault && (
                          <button className="es-saved-btn es-default-btn" onClick={() => handleSetDefault(addr._id)} disabled={actionLoading}>
                            <FiStar /> Set Default
                          </button>
                        )}
                        <button className="es-saved-btn es-delete-btn" onClick={() => handleDeleteAddress(addr._id)} disabled={actionLoading}>
                          <FiTrash2 />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="es-form-section">
            <h2 className="es-form-heading">
              <FiPlus />
              {addresses.length > 0 ? 'New Address' : 'Enter Address'}
            </h2>

            <form onSubmit={handleSubmit} className="es-form">

              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="address" className="es-label">
                    Street Address <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    className={`es-input ${hasError('Address') ? 'es-input-error' : ''}`}
                    placeholder="123 Main Street"
                    required
                  />
                  {getErrors('Address').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>
              </div>

              <div className="es-form-row">
                <div className="es-form-group">
                  <label className="es-label">
                    Country <span className="es-required">*</span>
                  </label>
                  <Select
                    inputId="country"
                    options={countries}
                    value={selectedCountry}
                    onChange={handleCountryChange}
                    isLoading={loadingCountries}
                    placeholder={loadingCountries ? 'Loading countries...' : 'Search country...'}
                    styles={buildSelectStyles(hasError('Country') || !!formErrors.country)}
                    formatOptionLabel={formatCountryOption}
                    noOptionsMessage={() => 'No country found'}
                    loadingMessage={() => 'Loading countries...'}
                    isClearable
                  />
                  {formErrors.country && <span className="es-error">{formErrors.country}</span>}
                  {getErrors('Country').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>
              </div>

              <div className="es-form-row">
                <div className="es-form-group">
                  <label className="es-label">
                    State <span className="es-required">*</span>
                  </label>
                  {(states.length > 0 || loadingStates || !selectedCountry) ? (
                    <Select
                      inputId="state"
                      options={states}
                      value={selectedState}
                      onChange={handleStateChange}
                      isLoading={loadingStates}
                      isDisabled={!selectedCountry || loadingStates}
                      placeholder={
                        !selectedCountry ? 'Select a country first'
                        : loadingStates ? 'Loading states...'
                        : 'Search state...'
                      }
                      styles={buildSelectStyles(hasError('State') || !!formErrors.state)}
                      noOptionsMessage={() => 'No states found'}
                      isClearable
                    />
                  ) : (
                    <input
                      type="text"
                      name="state"
                      value={formData.state}
                      onChange={handleChange}
                      className={`es-input ${hasError('State') || formErrors.state ? 'es-input-error' : ''}`}
                      placeholder="Enter your state"
                      required
                    />
                  )}
                  {formErrors.state && <span className="es-error">{formErrors.state}</span>}
                  {getErrors('State').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>

                <div className="es-form-group">
                  <label className="es-label">
                    City <span className="es-required">*</span>
                  </label>
                  {(cities.length > 0 || loadingCities || !selectedState) ? (
                    <Select
                      inputId="city"
                      options={cities}
                      value={selectedCity}
                      onChange={handleCityChange}
                      isLoading={loadingCities}
                      isDisabled={!selectedState || loadingCities}
                      placeholder={
                        !selectedState ? 'Select a state first'
                        : loadingCities ? 'Loading cities...'
                        : 'Search city...'
                      }
                      styles={buildSelectStyles(hasError('City') || !!formErrors.city)}
                      noOptionsMessage={() => 'No cities found'}
                      isClearable
                    />
                  ) : (
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      className={`es-input ${hasError('City') || formErrors.city ? 'es-input-error' : ''}`}
                      placeholder="Enter your city"
                      required
                    />
                  )}
                  {formErrors.city && <span className="es-error">{formErrors.city}</span>}
                  {getErrors('City').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>
              </div>

              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="pinCode" className="es-label">
                    Postal Code <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="pinCode"
                    name="pinCode"
                    value={formData.pinCode}
                    onChange={handleChange}
                    className={`es-input ${hasError('code') ? 'es-input-error' : ''}`}
                    placeholder="100001"
                    maxLength="10"
                    required
                  />
                  {getErrors('code').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>

                <div className="es-form-group">
                  <label htmlFor="phoneNo" className="es-label">
                    Phone Number <span className="es-required">*</span>
                  </label>
                  <input
                    type="tel"
                    id="phoneNo"
                    name="phoneNo"
                    value={formData.phoneNo}
                    onChange={handleChange}
                    className={`es-input ${hasError('Phone') || hasError('phone') ? 'es-input-error' : ''}`}
                    placeholder="+234 801 234 5678"
                    required
                  />
                  {[...getErrors('Phone'), ...getErrors('phone')].map((err, i) => (
                    <span key={i} className="es-error">{err}</span>
                  ))}
                </div>
              </div>

              <div className="es-checkbox-group">
                <label className="es-checkbox-label">
                  <input
                    type="checkbox"
                    checked={saveToAccount}
                    onChange={(e) => setSaveToAccount(e.target.checked)}
                    className="es-checkbox"
                  />
                  <span>Save this address to my account</span>
                </label>
                {saveToAccount && (
                  <label className="es-checkbox-label">
                    <input
                      type="checkbox"
                      checked={setAsDefaultCheck}
                      onChange={(e) => setSetAsDefaultCheck(e.target.checked)}
                      className="es-checkbox"
                    />
                    <span>Set as default address</span>
                  </label>
                )}
              </div>

              <button
                type="submit"
                className="es-submit-btn"
                disabled={isSubmitting || actionLoading}
              >
                {isSubmitting ? 'Processing...' : 'Continue to Order Confirmation'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default Shipping;