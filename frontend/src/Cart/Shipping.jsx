import React, { useEffect, useState } from 'react';
import '../CartStyles/Shipping.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CheckoutPath from './CheckoutPath';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { 
  FiMapPin, 
  FiCheck, 
  FiTrash2, 
  FiPlus,
  FiStar
} from 'react-icons/fi';

// Import shipping slice actions
import {
  getSavedAddresses,
  getDefaultAddress,
  saveAddress,
  deleteAddress,
  setDefaultAddress,
  validateShippingAddress,
  selectAddress,
  removeErrors,
  removeMessage,
  resetValidation
} from '../features/shipping/shippingSlice';

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

  const [formData, setFormData] = useState({
    address: '',
    city: '',
    state: '',
    country: 'Nigeria',
    pinCode: '',
    phoneNo: ''
  });
  
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [setAsDefaultCheck, setSetAsDefaultCheck] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch saved addresses on mount
  useEffect(() => {
    dispatch(getSavedAddresses());
    dispatch(getDefaultAddress());
  }, [dispatch]);

  // Auto-fill form from selected address
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
    }
  }, [selectedAddress]);

  // Handle errors
  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 3000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  // Handle success messages
  useEffect(() => {
    if (success && message) {
      toast.success(message, { position: 'top-center', autoClose: 2000 });
      dispatch(removeMessage());
    }
  }, [success, message, dispatch]);

  // Redirect if cart is empty
  useEffect(() => {
    if (cartItems.length === 0) {
      toast.warning('Your cart is empty', { position: 'top-center' });
      navigate('/cart');
    }
  }, [cartItems, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Reset validation on change
    dispatch(resetValidation());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validate address with backend
      await dispatch(validateShippingAddress(formData)).unwrap();

      // Save to account if checkbox is checked
      if (saveToAccount) {
        await dispatch(saveAddress({
          name: user?.name || `${user?.firstName} ${user?.lastName}` || 'User',
          ...formData,
          isDefault: setAsDefaultCheck
        })).unwrap();
      }

      // Navigate to order confirmation
      navigate('/order/confirm');
    } catch (err) {
      // Error already handled by useEffect
      console.error('Shipping validation failed:', err);
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

    try {
      await dispatch(deleteAddress(id)).unwrap();
    } catch (err) {
      // Error handled by useEffect
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await dispatch(setDefaultAddress(id)).unwrap();
    } catch (err) {
      // Error handled by useEffect
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
                          <FiCheck /> {selectedAddress?._id === addr._id ? 'Selected' : 'Select'}
                        </button>
                        {!addr.isDefault && (
                          <button 
                            className="es-saved-btn es-default-btn"
                            onClick={() => handleSetDefault(addr._id)}
                            disabled={actionLoading}
                          >
                            <FiStar /> Set Default
                          </button>
                        )}
                        <button 
                          className="es-saved-btn es-delete-btn"
                          onClick={() => handleDeleteAddress(addr._id)}
                          disabled={actionLoading}
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
                    className={`es-input ${validationErrors.length > 0 && validationErrors.some(e => e.includes('Address')) ? 'es-input-error' : ''}`}
                    placeholder="123 Main Street"
                    required
                  />
                  {validationErrors.length > 0 && validationErrors.filter(e => e.includes('Address')).map((err, i) => (
                    <span key={i} className="es-error">{err}</span>
                  ))}
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
                    className={`es-input ${validationErrors.length > 0 && validationErrors.some(e => e.includes('City')) ? 'es-input-error' : ''}`}
                    placeholder="Lagos"
                    required
                  />
                  {validationErrors.length > 0 && validationErrors.filter(e => e.includes('City')).map((err, i) => (
                    <span key={i} className="es-error">{err}</span>
                  ))}
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
                    className={`es-input ${validationErrors.length > 0 && validationErrors.some(e => e.includes('State')) ? 'es-input-error' : ''}`}
                    placeholder="Lagos State"
                    required
                  />
                  {validationErrors.length > 0 && validationErrors.filter(e => e.includes('State')).map((err, i) => (
                    <span key={i} className="es-error">{err}</span>
                  ))}
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
                    className={`es-input ${validationErrors.length > 0 && validationErrors.some(e => e.includes('code')) ? 'es-input-error' : ''}`}
                    placeholder="100001"
                    maxLength="6"
                    required
                  />
                  {validationErrors.length > 0 && validationErrors.filter(e => e.includes('code')).map((err, i) => (
                    <span key={i} className="es-error">{err}</span>
                  ))}
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
                    className={`es-input ${validationErrors.length > 0 && validationErrors.some(e => e.includes('Phone') || e.includes('phone')) ? 'es-input-error' : ''}`}
                    placeholder="+234 801 234 5678"
                    required
                  />
                  {validationErrors.length > 0 && validationErrors.filter(e => e.includes('Phone') || e.includes('phone')).map((err, i) => (
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