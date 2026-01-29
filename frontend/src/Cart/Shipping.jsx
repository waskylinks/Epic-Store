import React, { useEffect, useState } from 'react';
import '../CartStyles/Shipping.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CheckoutPath from './CheckoutPath';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { saveShippingInfo } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import axios from 'axios';
import { 
  FiMapPin, 
  FiCheck, 
  FiTrash2, 
  FiPlus,
  FiStar,
  FiPhone,
  FiGlobe
} from 'react-icons/fi';

// Country data with states/cities
const COUNTRIES_DATA = {
  Nigeria: {
    code: '+234',
    phonePattern: /^(\+234|234|0)[7-9][0-1]\d{8}$/,
    postalCodeRequired: true,
    postalCodePattern: /^\d{6}$/,
    states: {
      'Lagos': ['Ikeja', 'Victoria Island', 'Lekki', 'Surulere', 'Yaba', 'Ikoyi', 'Ajah', 'Festac'],
      'Abuja': ['Garki', 'Wuse', 'Maitama', 'Asokoro', 'Gwarinpa', 'Kubwa', 'Karu'],
      'Rivers': ['Port Harcourt', 'Obio-Akpor', 'Eleme', 'Ikwerre'],
      'Kano': ['Kano Municipal', 'Nassarawa', 'Fagge', 'Dala'],
      'Oyo': ['Ibadan', 'Ogbomoso', 'Oyo', 'Iseyin'],
      'Delta': ['Warri', 'Asaba', 'Sapele', 'Ughelli'],
      'Edo': ['Benin City', 'Auchi', 'Ekpoma', 'Uromi'],
      'Ogun': ['Abeokuta', 'Ijebu Ode', 'Sagamu', 'Ota'],
      'Kaduna': ['Kaduna', 'Zaria', 'Kafanchan', 'Kagoro'],
      'Anambra': ['Awka', 'Onitsha', 'Nnewi', 'Ekwulobia']
    }
  },
  'United States': {
    code: '+1',
    phonePattern: /^(\+1|1)?\d{10}$/,
    postalCodeRequired: true,
    postalCodePattern: /^\d{5}(-\d{4})?$/,
    states: {
      'California': ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento'],
      'New York': ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse'],
      'Texas': ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth'],
      'Florida': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale'],
      'Illinois': ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford']
    }
  },
  'United Kingdom': {
    code: '+44',
    phonePattern: /^(\+44|44|0)?[1-9]\d{9,10}$/,
    postalCodeRequired: true,
    postalCodePattern: /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i,
    states: {
      'England': ['London', 'Manchester', 'Birmingham', 'Liverpool', 'Leeds'],
      'Scotland': ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee'],
      'Wales': ['Cardiff', 'Swansea', 'Newport', 'Wrexham'],
      'Northern Ireland': ['Belfast', 'Derry', 'Lisburn', 'Newry']
    }
  },
  'Canada': {
    code: '+1',
    phonePattern: /^(\+1|1)?\d{10}$/,
    postalCodeRequired: true,
    postalCodePattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
    states: {
      'Ontario': ['Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton'],
      'Quebec': ['Montreal', 'Quebec City', 'Laval', 'Gatineau'],
      'British Columbia': ['Vancouver', 'Surrey', 'Burnaby', 'Richmond'],
      'Alberta': ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge']
    }
  },
  'Ghana': {
    code: '+233',
    phonePattern: /^(\+233|233|0)?[2-9]\d{8}$/,
    postalCodeRequired: false,
    postalCodePattern: null,
    states: {
      'Greater Accra': ['Accra', 'Tema', 'Madina', 'Kasoa'],
      'Ashanti': ['Kumasi', 'Obuasi', 'Mampong', 'Konongo'],
      'Western': ['Sekondi-Takoradi', 'Tarkwa', 'Prestea'],
      'Central': ['Cape Coast', 'Winneba', 'Kasoa', 'Swedru']
    }
  },
  'South Africa': {
    code: '+27',
    phonePattern: /^(\+27|27|0)?[1-9]\d{8}$/,
    postalCodeRequired: true,
    postalCodePattern: /^\d{4}$/,
    states: {
      'Gauteng': ['Johannesburg', 'Pretoria', 'Soweto', 'Benoni'],
      'Western Cape': ['Cape Town', 'Stellenbosch', 'Paarl', 'George'],
      'KwaZulu-Natal': ['Durban', 'Pietermaritzburg', 'Richards Bay'],
      'Eastern Cape': ['Port Elizabeth', 'East London', 'Mthatha']
    }
  },
  'Kenya': {
    code: '+254',
    phonePattern: /^(\+254|254|0)?[17]\d{8}$/,
    postalCodeRequired: true,
    postalCodePattern: /^\d{5}$/,
    states: {
      'Nairobi': ['Nairobi Central', 'Westlands', 'Kasarani', 'Embakasi'],
      'Mombasa': ['Mombasa Island', 'Nyali', 'Bamburi', 'Likoni'],
      'Kisumu': ['Kisumu Central', 'Kondele', 'Migosi'],
      'Nakuru': ['Nakuru Town', 'Naivasha', 'Gilgil']
    }
  }
};

function Shipping() {
  const { shippingInfo } = useSelector(state => state.cart);
  const { user } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [savedAddresses, setSavedAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [formData, setFormData] = useState({
    address: shippingInfo.address || '',
    city: shippingInfo.city || '',
    state: shippingInfo.state || '',
    country: shippingInfo.country || 'Nigeria',
    pinCode: shippingInfo.pinCode || '',
    phoneNo: shippingInfo.phoneNo || '',
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || ''
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveAddress, setSaveAddress] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);

  // Search states
  const [countrySearch, setCountrySearch] = useState('');
  const [stateSearch, setStateSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showStateDropdown, setShowStateDropdown] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);

  const countries = Object.keys(COUNTRIES_DATA);
  const selectedCountryData = COUNTRIES_DATA[formData.country];
  const states = selectedCountryData ? Object.keys(selectedCountryData.states) : [];
  const cities = selectedCountryData && formData.state ? selectedCountryData.states[formData.state] || [] : [];

  // Filter options based on search
  const filteredCountries = countries.filter(c => 
    c.toLowerCase().includes(countrySearch.toLowerCase())
  );
  const filteredStates = states.filter(s => 
    s.toLowerCase().includes(stateSearch.toLowerCase())
  );
  const filteredCities = cities.filter(c => 
    c.toLowerCase().includes(citySearch.toLowerCase())
  );

  // Fetch saved addresses on mount
  useEffect(() => {
    fetchSavedAddresses();
  }, []);

  const fetchSavedAddresses = async () => {
    setLoadingAddresses(true);
    try {
      const { data } = await axios.get('/api/v1/shipping/addresses');
      setSavedAddresses(data.addresses || []);
    } catch (err) {
      console.error('Failed to fetch addresses:', err);
    } finally {
      setLoadingAddresses(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handleCountrySelect = (country) => {
    setFormData(prev => ({
      ...prev,
      country,
      state: '',
      city: '',
      pinCode: '',
      phoneNo: ''
    }));
    setCountrySearch('');
    setShowCountryDropdown(false);
    setStateSearch('');
    setCitySearch('');
  };

  const handleStateSelect = (state) => {
    setFormData(prev => ({
      ...prev,
      state,
      city: ''
    }));
    setStateSearch('');
    setShowStateDropdown(false);
    setCitySearch('');
  };

  const handleCitySelect = (city) => {
    setFormData(prev => ({
      ...prev,
      city
    }));
    setCitySearch('');
    setShowCityDropdown(false);
  };

  const validateForm = () => {
    const newErrors = {};
    const countryData = COUNTRIES_DATA[formData.country];

    if (!formData.firstName || formData.firstName.trim().length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters';
    }

    if (!formData.lastName || formData.lastName.trim().length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters';
    }

    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Valid email is required';
    }

    if (!formData.address || formData.address.trim().length < 10) {
      newErrors.address = 'Address must be at least 10 characters';
    }

    if (!formData.country) {
      newErrors.country = 'Country is required';
    }

    if (!formData.state) {
      newErrors.state = 'State/Region is required';
    }

    if (!formData.city || formData.city.trim().length < 2) {
      newErrors.city = 'City is required';
    }

    if (countryData?.postalCodeRequired) {
      if (!formData.pinCode) {
        newErrors.pinCode = 'Postal code is required';
      } else if (countryData.postalCodePattern && !countryData.postalCodePattern.test(formData.pinCode)) {
        newErrors.pinCode = 'Invalid postal code format';
      }
    }

    if (!formData.phoneNo) {
      newErrors.phoneNo = 'Phone number is required';
    } else if (countryData && !countryData.phonePattern.test(formData.phoneNo)) {
      newErrors.phoneNo = `Invalid phone number for ${formData.country}`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form', {
        position: 'top-center',
        autoClose: 3000
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Save to Redux
      dispatch(saveShippingInfo(formData));

      // Save to database if checkbox is checked
      if (saveAddress) {
        try {
          await axios.post('/api/v1/shipping/address', {
            name: `${formData.firstName} ${formData.lastName}`,
            ...formData,
            isDefault: setAsDefault
          });
          toast.success('Address saved successfully', {
            position: 'top-center',
            autoClose: 2000
          });
          fetchSavedAddresses();
        } catch (err) {
          console.error('Failed to save address:', err);
        }
      }

      // Navigate to order confirmation
      navigate('/order/confirm');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save shipping info', {
        position: 'top-center',
        autoClose: 3000
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAddress = (address) => {
    setFormData({
      ...formData,
      address: address.address,
      city: address.city,
      state: address.state,
      country: address.country,
      pinCode: address.pinCode,
      phoneNo: address.phoneNo
    });
    toast.success('Address loaded', {
      position: 'top-center',
      autoClose: 2000
    });
  };

  const handleDeleteAddress = async (id) => {
    if (!window.confirm('Delete this address?')) return;

    try {
      await axios.delete(`/api/v1/shipping/address/${id}`);
      toast.success('Address deleted', {
        position: 'top-center',
        autoClose: 2000
      });
      fetchSavedAddresses();
    } catch (err) {
      toast.error('Failed to delete address', {
        position: 'top-center',
        autoClose: 2000
      });
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await axios.put(`/api/v1/shipping/address/${id}/default`);
      toast.success('Default address updated', {
        position: 'top-center',
        autoClose: 2000
      });
      fetchSavedAddresses();
    } catch (err) {
      toast.error('Failed to update default', {
        position: 'top-center',
        autoClose: 2000
      });
    }
  };

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
          {/* Saved Addresses Section */}
          {savedAddresses.length > 0 && (
            <div className="es-saved-section">
              <h2 className="es-saved-heading">
                <FiMapPin />
                Saved Addresses
              </h2>
              
              {loadingAddresses ? (
                <div className="es-loading">Loading addresses...</div>
              ) : (
                <div className="es-saved-list">
                  {savedAddresses.map(addr => (
                    <div 
                      key={addr._id} 
                      className={`es-saved-item ${addr.isDefault ? 'es-default' : ''}`}
                    >
                      {addr.isDefault && (
                        <div className="es-default-badge">
                          <FiStar />
                          Default
                        </div>
                      )}
                      
                      <div className="es-saved-info">
                        <p className="es-saved-name">{addr.name}</p>
                        <p className="es-saved-address">
                          {addr.address}, {addr.city}, {addr.state}, {addr.country} {addr.pinCode && `- ${addr.pinCode}`}
                        </p>
                        <p className="es-saved-phone">
                          <FiPhone /> {addr.phoneNo}
                        </p>
                      </div>

                      <div className="es-saved-actions">
                        <button 
                          className="es-saved-btn es-select-btn"
                          onClick={() => handleSelectAddress(addr)}
                        >
                          <FiCheck /> Select
                        </button>
                        {!addr.isDefault && (
                          <button 
                            className="es-saved-btn es-default-btn"
                            onClick={() => handleSetDefault(addr._id)}
                          >
                            <FiStar /> Set Default
                          </button>
                        )}
                        <button 
                          className="es-saved-btn es-delete-btn"
                          onClick={() => handleDeleteAddress(addr._id)}
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shipping Form */}
          <div className="es-form-section">
            <h2 className="es-form-heading">
              <FiPlus />
              {savedAddresses.length > 0 ? 'New Address' : 'Enter Address'}
            </h2>

            <form onSubmit={handleSubmit} className="es-form">
              {/* Personal Information */}
              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="firstName" className="es-label">
                    First Name <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    className={`es-input ${errors.firstName ? 'es-input-error' : ''}`}
                    placeholder="John"
                  />
                  {errors.firstName && (
                    <span className="es-error">{errors.firstName}</span>
                  )}
                </div>

                <div className="es-form-group">
                  <label htmlFor="lastName" className="es-label">
                    Last Name <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    className={`es-input ${errors.lastName ? 'es-input-error' : ''}`}
                    placeholder="Doe"
                  />
                  {errors.lastName && (
                    <span className="es-error">{errors.lastName}</span>
                  )}
                </div>
              </div>

              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="email" className="es-label">
                    Email Address <span className="es-required">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className={`es-input ${errors.email ? 'es-input-error' : ''}`}
                    placeholder="john.doe@example.com"
                  />
                  {errors.email && (
                    <span className="es-error">{errors.email}</span>
                  )}
                </div>
              </div>

              {/* Address */}
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
                    className={`es-input ${errors.address ? 'es-input-error' : ''}`}
                    placeholder="123 Main Street, Apartment 4B"
                  />
                  {errors.address && (
                    <span className="es-error">{errors.address}</span>
                  )}
                </div>
              </div>

              {/* Country Selection */}
              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="country" className="es-label">
                    <FiGlobe /> Country <span className="es-required">*</span>
                  </label>
                  <div className="es-dropdown-wrapper">
                    <input
                      type="text"
                      value={showCountryDropdown ? countrySearch : formData.country}
                      onChange={(e) => {
                        setCountrySearch(e.target.value);
                        setShowCountryDropdown(true);
                      }}
                      onFocus={() => setShowCountryDropdown(true)}
                      className={`es-input ${errors.country ? 'es-input-error' : ''}`}
                      placeholder="Search country..."
                    />
                    {showCountryDropdown && filteredCountries.length > 0 && (
                      <div className="es-dropdown">
                        {filteredCountries.map(country => (
                          <div
                            key={country}
                            className="es-dropdown-item"
                            onClick={() => handleCountrySelect(country)}
                          >
                            {country}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {errors.country && (
                    <span className="es-error">{errors.country}</span>
                  )}
                </div>
              </div>

              {/* State & City */}
              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="state" className="es-label">
                    State/Region <span className="es-required">*</span>
                  </label>
                  <div className="es-dropdown-wrapper">
                    <input
                      type="text"
                      value={showStateDropdown ? stateSearch : formData.state}
                      onChange={(e) => {
                        setStateSearch(e.target.value);
                        setShowStateDropdown(true);
                      }}
                      onFocus={() => setShowStateDropdown(true)}
                      className={`es-input ${errors.state ? 'es-input-error' : ''}`}
                      placeholder="Search state..."
                      disabled={!formData.country}
                    />
                    {showStateDropdown && filteredStates.length > 0 && (
                      <div className="es-dropdown">
                        {filteredStates.map(state => (
                          <div
                            key={state}
                            className="es-dropdown-item"
                            onClick={() => handleStateSelect(state)}
                          >
                            {state}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {errors.state && (
                    <span className="es-error">{errors.state}</span>
                  )}
                </div>

                <div className="es-form-group">
                  <label htmlFor="city" className="es-label">
                    City <span className="es-required">*</span>
                  </label>
                  <div className="es-dropdown-wrapper">
                    <input
                      type="text"
                      value={showCityDropdown ? citySearch : formData.city}
                      onChange={(e) => {
                        setCitySearch(e.target.value);
                        setShowCityDropdown(true);
                      }}
                      onFocus={() => setShowCityDropdown(true)}
                      className={`es-input ${errors.city ? 'es-input-error' : ''}`}
                      placeholder="Search city or type custom..."
                      disabled={!formData.state}
                    />
                    {showCityDropdown && filteredCities.length > 0 && (
                      <div className="es-dropdown">
                        {filteredCities.map(city => (
                          <div
                            key={city}
                            className="es-dropdown-item"
                            onClick={() => handleCitySelect(city)}
                          >
                            {city}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {errors.city && (
                    <span className="es-error">{errors.city}</span>
                  )}
                </div>
              </div>

              {/* Postal Code & Phone */}
              <div className="es-form-row">
                {selectedCountryData?.postalCodeRequired && (
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
                      className={`es-input ${errors.pinCode ? 'es-input-error' : ''}`}
                      placeholder={formData.country === 'Nigeria' ? '100001' : 'Enter postal code'}
                    />
                    {errors.pinCode && (
                      <span className="es-error">{errors.pinCode}</span>
                    )}
                  </div>
                )}

                <div className="es-form-group">
                  <label htmlFor="phoneNo" className="es-label">
                    <FiPhone /> Phone Number <span className="es-required">*</span>
                  </label>
                  <div className="es-phone-input">
                    <span className="es-country-code">
                      {selectedCountryData?.code || '+234'}
                    </span>
                    <input
                      type="tel"
                      id="phoneNo"
                      name="phoneNo"
                      value={formData.phoneNo}
                      onChange={handleChange}
                      className={`es-input es-phone-field ${errors.phoneNo ? 'es-input-error' : ''}`}
                      placeholder="801 234 5678"
                    />
                  </div>
                  {errors.phoneNo && (
                    <span className="es-error">{errors.phoneNo}</span>
                  )}
                </div>
              </div>

              <div className="es-checkbox-group">
                <label className="es-checkbox-label">
                  <input
                    type="checkbox"
                    checked={saveAddress}
                    onChange={(e) => setSaveAddress(e.target.checked)}
                    className="es-checkbox"
                  />
                  <span>Save this address for future orders</span>
                </label>

                {saveAddress && (
                  <label className="es-checkbox-label">
                    <input
                      type="checkbox"
                      checked={setAsDefault}
                      onChange={(e) => setSetAsDefault(e.target.checked)}
                      className="es-checkbox"
                    />
                    <span>Set as my default shipping address</span>
                  </label>
                )}
              </div>

              <button 
                type="submit" 
                className="es-submit-btn"
                disabled={isSubmitting}
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