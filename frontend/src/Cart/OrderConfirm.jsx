import React, { useEffect, useState } from 'react';
import '../CartStyles/OrderConfirm.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useSelector, useDispatch } from 'react-redux';
import CheckoutPath from './CheckoutPath';
import { useNavigate } from 'react-router-dom';
import { calculateCartPricing } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { FiAlertCircle, FiCheckCircle, FiLock } from 'react-icons/fi';

function OrderConfirm() {
  const { shippingInfo, cartItems, pricing = {}, pricingLoading } = useSelector(state => state.cart);
  const { user } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isProcessing, setIsProcessing] = useState(false);

  // Calculate local pricing as fallback
  const calculateLocalPricing = () => {
    const itemPrice = cartItems.reduce((acc, item) => {
      const itemQty = item.qty || item.quantity || 1;
      const itemPrice = item.price || 0;
      return acc + (itemPrice * itemQty);
    }, 0);
    
    const taxPrice = itemPrice * 0.18;
    const shippingPrice = itemPrice >= 500 ? 0 : 50;
    const totalPrice = itemPrice + taxPrice + shippingPrice;
    
    return { itemPrice, taxPrice, shippingPrice, totalPrice };
  };

  // Use server pricing if available, otherwise calculate locally
  const displayPricing = (pricing && typeof pricing.totalPrice === 'number') 
    ? pricing 
    : calculateLocalPricing();

  // Get user's full name
  const getUserFullName = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user?.name || 'N/A';
  };

  // Fetch server-calculated pricing on mount
  useEffect(() => {
    if (cartItems.length > 0) {
      const fetchPricing = async () => {
        try {
          await dispatch(calculateCartPricing({ 
            cartItems,
            currency: 'NGN' 
          })).unwrap();
        } catch (err) {
          console.error('Pricing calculation error:', err);
          // Fallback to local pricing will be used
        }
      };
      fetchPricing();
    } else {
      navigate('/cart');
    }
  }, [cartItems, dispatch, navigate]);

  // Redirect if no shipping info
  useEffect(() => {
    if (!shippingInfo.address) {
      toast.warning('Please fill in shipping information', {
        position: 'top-center',
        autoClose: 2000
      });
      navigate('/shipping');
    }
  }, [shippingInfo, navigate]);

  const formatNGN = (amount) => {
    if (!amount && amount !== 0) return '₦0.00';
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const proceedToPayment = () => {
    setIsProcessing(true);
    
    // Store order data for payment page (display only)
    const orderData = {
      cartItems,
      shippingInfo,
      pricing: displayPricing,
      user: {
        name: getUserFullName(),
        email: user.email
      }
    };
    
    sessionStorage.setItem('orderItem', JSON.stringify(orderData));
    navigate('/process/payment');
  };

  if (cartItems.length === 0) {
    return null; // Will redirect via useEffect
  }

  return (
    <>
      <PageTitle title='Order Confirmation' />
      <Navbar />
      <CheckoutPath activePath={1} />

      <div className="eoc-container">
        <h1 className="eoc-header">
          <FiCheckCircle />
          Confirm Your Order
        </h1>

        {/* Security Banner */}
        <div className="eoc-info-banner">
          <FiLock />
          <p>
            Please review your order details carefully. Final prices are calculated securely on our servers to ensure accuracy.
          </p>
        </div>

        <div className="eoc-content">
          {/* Shipping Information */}
          <div className="eoc-section">
            <h2 className="eoc-section-title">Shipping Information</h2>
            <div className="eoc-table-container">
              <table className="eoc-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{getUserFullName()}</td>
                    <td>{shippingInfo.phoneNo || 'N/A'}</td>
                    <td>
                      {shippingInfo.address}, {shippingInfo.city}, {shippingInfo.state}, {shippingInfo.country} - {shippingInfo.pinCode}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Cart Items */}
          <div className="eoc-section">
            <h2 className="eoc-section-title">Order Items</h2>
            <div className="eoc-table-container">
              <table className="eoc-table eoc-cart-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Product Name</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map(item => {
                    const itemQty = item.qty || item.quantity || 1;
                    return (
                      <tr key={item.product}>
                        <td>
                          <img 
                            src={item.image} 
                            alt={item.name} 
                            className='eoc-product-image'
                            onError={(e) => {
                              e.target.src = '/images/placeholder.png';
                            }}
                          />
                        </td>
                        <td className="eoc-product-name">{item.name}</td>
                        <td>{formatNGN(item.price)}</td>
                        <td>{itemQty}</td>
                        <td className="eoc-item-total">
                          {formatNGN(item.price * itemQty)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Order Summary */}
          <div className="eoc-section">
            <h2 className="eoc-section-title">Order Summary</h2>
            
            <div className="eoc-table-container">
              <table className="eoc-table eoc-summary-table">
                <thead>
                  <tr>
                    <th>Subtotal</th>
                    <th>Shipping</th>
                    <th>Tax (18%)</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatNGN(displayPricing.itemPrice || 0)}</td>
                    <td>
                      {displayPricing.shippingPrice === 0 ? (
                        <span className="eoc-free-shipping">FREE</span>
                      ) : (
                        formatNGN(displayPricing.shippingPrice || 0)
                      )}
                    </td>
                    <td>{formatNGN(displayPricing.taxPrice || 0)}</td>
                    <td className="eoc-total-amount">
                      {formatNGN(displayPricing.totalPrice || 0)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {pricing.lastUpdated && (
                <p className="eoc-summary-note">
                  <FiAlertCircle />
                  Server pricing calculated at {new Date(pricing.lastUpdated).toLocaleString()}
                </p>
              )}
              
              {!pricing.lastUpdated && (
                <p className="eoc-summary-note">
                  <FiAlertCircle />
                  Using local price calculation
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="eoc-actions">
          <button
            type="button"
            className="eoc-back-btn"
            onClick={() => navigate('/shipping')}
            disabled={isProcessing}
          >
            Back to Shipping
          </button>
          
          <button
            type="button"
            className="eoc-proceed-btn"
            onClick={proceedToPayment}
            disabled={isProcessing || cartItems.length === 0}
          >
            {isProcessing ? 'Processing...' : 'Proceed to Payment'}
          </button>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default OrderConfirm;