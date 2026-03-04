import React, { useEffect, useState } from 'react';
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
// Add to your .env file: REACT_APP_CSC_API_KEY=your_key_here
const CSC_KEY = process.env.REACT_APP_CSC_API_KEY || '';
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

  // ─── Form data (same shape as before — nothing changes in Redux/backend) ────
  const [formData, setFormData] = useState({
    address: '',
    city: '',
    state: '',
    country: 'Nigeria',
    pinCode: '',
    phoneNo: ''
  });

  // ─── Dropdown options ───────────────────────────────────────────────────────
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);

  // ─── Loading states for cascading dropdowns ─────────────────────────────────
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  // ─── React Select controlled values ─────────────────────────────────────────
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);

  const [saveToAccount, setSaveToAccount] = useState(false);
  const [setAsDefaultCheck, setSetAsDefaultCheck] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── On mount: fetch saved addresses + all countries ───────────────────────
  useEffect(() => {
    dispatch(getSavedAddresses());
    dispatch(getDefaultAddress());
    fetchCountries();
  }, [dispatch]);

  const fetchCountries = async () => {
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

      // Pre-select Nigeria
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
  };

  const fetchStates = async (countryIso2) => {
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
  };

  const fetchCities = async (countryIso2, stateIso2) => {
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
  };

  // ─── Auto-fill when user selects a saved address ────────────────────────────
  useEffect(() => {
    if (selectedAddress) {
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
        fetchStates(countryOpt.iso2);
      }
    }
  }, [selectedAddress]);

  // Sync state dropdown after states load (for saved address re-hydration)
  useEffect(() => {
    if (formData.state && states.length > 0 && !selectedState) {
      const opt = states.find(s => s.value === formData.state);
      if (opt) {
        setSelectedState(opt);
        fetchCities(opt.countryIso, opt.iso2);
      }
    }
  }, [states]);

  // Sync city dropdown after cities load (for saved address re-hydration)
  useEffect(() => {
    if (formData.city && cities.length > 0 && !selectedCity) {
      const opt = cities.find(c => c.value === formData.city);
      if (opt) setSelectedCity(opt);
    }
  }, [cities]);

  // ─── Toasts ─────────────────────────────────────────────────────────────────
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

  // ─── Change handlers ─────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    dispatch(resetValidation());
  };

  const handleCountryChange = (selected) => {
    setSelectedCountry(selected);
    setSelectedState(null);
    setSelectedCity(null);
    setFormData(prev => ({ ...prev, country: selected?.value || '', state: '', city: '' }));
    dispatch(resetValidation());
    if (selected) fetchStates(selected.iso2);
    else { setStates([]); setCities([]); }
  };

  const handleStateChange = (selected) => {
    setSelectedState(selected);
    setSelectedCity(null);
    setFormData(prev => ({ ...prev, state: selected?.value || '', city: '' }));
    dispatch(resetValidation());
    if (selected) fetchCities(selected.countryIso, selected.iso2);
    else setCities([]);
  };

  const handleCityChange = (selected) => {
    setSelectedCity(selected);
    setFormData(prev => ({ ...prev, city: selected?.value || '' }));
    dispatch(resetValidation());
  };

  // ─── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (saveToAccount) {
        await dispatch(saveAddress({
          name: user?.name || `${user?.firstName} ${user?.lastName}` || 'User',
          ...formData,
          isDefault: setAsDefaultCheck
        })).unwrap();
      }
      navigate('/order/confirm');
    } catch (err) {
      console.error('Shipping submission failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAddress = (address) => {
    dispatch(selectAddress(address));
    toast.success('Address selected', { position: 'top-center', autoClose: 2000 });
  };

  const handleDeleteAddress = async (id) => {
    if (!window.confirm('Delete this address?')) return;
    try { await dispatch(deleteAddress(id)).unwrap(); } catch (err) {}
  };

  const handleSetDefault = async (id) => {
    try { await dispatch(setDefaultAddress(id)).unwrap(); } catch (err) {}
  };

  // ─── Validation helpers ──────────────────────────────────────────────────────
  const hasError = (kw) => validationErrors.length > 0 && validationErrors.some(e => e.includes(kw));
  const getErrors = (kw) => validationErrors.filter(e => e.includes(kw));

  // ─── Render ──────────────────────────────────────────────────────────────────
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

          {/* ── Saved Addresses ── */}
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

          {/* ── Shipping Form ── */}
          <div className="es-form-section">
            <h2 className="es-form-heading">
              <FiPlus />
              {addresses.length > 0 ? 'New Address' : 'Enter Address'}
            </h2>

            <form onSubmit={handleSubmit} className="es-form">

              {/* Street Address */}
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

              {/* Country */}
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
                    styles={buildSelectStyles(hasError('Country'))}
                    formatOptionLabel={formatCountryOption}
                    noOptionsMessage={() => 'No country found'}
                    loadingMessage={() => 'Loading countries...'}
                    isClearable
                  />
                  {getErrors('Country').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>
              </div>

              {/* State + City */}
              <div className="es-form-row">
                {/* State */}
                <div className="es-form-group">
                  <label className="es-label">
                    State <span className="es-required">*</span>
                  </label>
                  {/* Show dropdown if states exist or still loading */}
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
                      styles={buildSelectStyles(hasError('State'))}
                      noOptionsMessage={() => 'No states found'}
                      isClearable
                    />
                  ) : (
                    /* Fallback: plain text input if API returned no states */
                    <input
                      type="text"
                      name="state"
                      value={formData.state}
                      onChange={handleChange}
                      className={`es-input ${hasError('State') ? 'es-input-error' : ''}`}
                      placeholder="Enter your state"
                      required
                    />
                  )}
                  {getErrors('State').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>

                {/* City */}
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
                      styles={buildSelectStyles(hasError('City'))}
                      noOptionsMessage={() => 'No cities found'}
                      isClearable
                    />
                  ) : (
                    /* Fallback: plain text input if API returned no cities */
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      className={`es-input ${hasError('City') ? 'es-input-error' : ''}`}
                      placeholder="Enter your city"
                      required
                    />
                  )}
                  {getErrors('City').map((err, i) => <span key={i} className="es-error">{err}</span>)}
                </div>
              </div>

              {/* Postal Code + Phone */}
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

              {/* Save to account checkboxes */}
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