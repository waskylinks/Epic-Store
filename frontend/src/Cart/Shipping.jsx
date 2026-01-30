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
  FiEdit2, 
  FiPlus,
  FiStar
} from 'react-icons/fi';

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
    phoneNo: shippingInfo.phoneNo || ''
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveAddress, setSaveAddress] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);

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

  const validateForm = () => {
    const newErrors = {};

    if (!formData.address || formData.address.trim().length < 5) {
      newErrors.address = 'Address must be at least 5 characters';
    }

    if (!formData.city || formData.city.trim().length < 2) {
      newErrors.city = 'City is required';
    }

    if (!formData.state || formData.state.trim().length < 2) {
      newErrors.state = 'State is required';
    }

    if (!formData.pinCode || !/^\d{6}$/.test(formData.pinCode)) {
      newErrors.pinCode = 'Postal code must be 6 digits';
    }

    if (!formData.phoneNo) {
      newErrors.phoneNo = 'Phone number is required';
    } else {
      const cleanPhone = formData.phoneNo.replace(/[\s\-\(\)]/g, '');
      const nigerianPattern = /^(\+234|234|0)[7-9][0-1]\d{8}$/;
      if (!nigerianPattern.test(cleanPhone)) {
        newErrors.phoneNo = 'Invalid Nigerian phone number';
      }
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
      // Validate address with backend
      const { data } = await axios.post('/api/v1/shipping/validate-address', formData);

      if (!data.isValid) {
        setErrors(data.errors);
        toast.error('Invalid address', {
          position: 'top-center',
          autoClose: 3000
        });
        setIsSubmitting(false);
        return;
      }

      // Save to Redux
      dispatch(saveShippingInfo(data.normalizedAddress || formData));

      // Save to database if checkbox is checked
      if (saveAddress) {
        await axios.post('/api/v1/shipping/address', {
          name: user?.name || 'User',
          ...formData,
          isDefault: setAsDefault
        });
        toast.success('Address saved successfully', {
          position: 'top-center',
          autoClose: 2000
        });
        fetchSavedAddresses();
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
                          {addr.address}, {addr.city}, {addr.state} - {addr.pinCode}
                        </p>
                        <p className="es-saved-phone">{addr.phoneNo}</p>
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
                    placeholder="123 Main Street"
                  />
                  {errors.address && (
                    <span className="es-error">{errors.address}</span>
                  )}
                </div>
              </div>

              <div className="es-form-row">
                <div className="es-form-group">
                  <label htmlFor="city" className="es-label">
                    City <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="city"
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    className={`es-input ${errors.city ? 'es-input-error' : ''}`}
                    placeholder="Lagos"
                  />
                  {errors.city && (
                    <span className="es-error">{errors.city}</span>
                  )}
                </div>

                <div className="es-form-group">
                  <label htmlFor="state" className="es-label">
                    State <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="state"
                    name="state"
                    value={formData.state}
                    onChange={handleChange}
                    className={`es-input ${errors.state ? 'es-input-error' : ''}`}
                    placeholder="Lagos State"
                  />
                  {errors.state && (
                    <span className="es-error">{errors.state}</span>
                  )}
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
                    className={`es-input ${errors.pinCode ? 'es-input-error' : ''}`}
                    placeholder="100001"
                    maxLength="6"
                  />
                  {errors.pinCode && (
                    <span className="es-error">{errors.pinCode}</span>
                  )}
                </div>

                <div className="es-form-group">
                  <label htmlFor="country" className="es-label">
                    Country <span className="es-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="country"
                    name="country"
                    value={formData.country}
                    onChange={handleChange}
                    className="es-input"
                    readOnly
                  />
                </div>
              </div>

              <div className="es-form-row">
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
                    className={`es-input ${errors.phoneNo ? 'es-input-error' : ''}`}
                    placeholder="+234 801 234 5678"
                  />
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
                  <span>Save this address</span>
                </label>

                {saveAddress && (
                  <label className="es-checkbox-label">
                    <input
                      type="checkbox"
                      checked={setAsDefault}
                      onChange={(e) => setSetAsDefault(e.target.checked)}
                      className="es-checkbox"
                    />
                    <span>Set as default address</span>
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