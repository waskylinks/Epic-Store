import React, { useEffect, useState } from 'react';
import '../CartStyles/OrderConfirm.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useSelector, useDispatch } from 'react-redux';
import CheckoutPath from './CheckoutPath';
import { useNavigate } from 'react-router-dom';
import { getCartDetails } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { FiAlertCircle, FiCheckCircle, FiLock } from 'react-icons/fi';

function OrderConfirm() {
  const { shippingInfo, cartItems, cartDetails, loading } = useSelector(state => state.cart);
  const { user } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isProcessing, setIsProcessing] = useState(false);

  // Calculate pricing from cart details
  const calculatePricing = () => {
    const itemPrice = cartDetails.reduce((acc, item) => {
      return acc + (item.price * item.quantity);
    }, 0);
    
    const taxPrice = itemPrice * 0.18;
    const shippingPrice = itemPrice >= 500 ? 0 : 50;
    const totalPrice = itemPrice + taxPrice + shippingPrice;
    
    return { itemPrice, taxPrice, shippingPrice, totalPrice };
  };

  const displayPricing = cartDetails.length > 0 ? calculatePricing() : { itemPrice: 0, taxPrice: 0, shippingPrice: 0, totalPrice: 0 };

  // Get user's full name
  const getUserFullName = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user?.name || 'N/A';
  };

  // Fetch fresh cart details on mount
  useEffect(() => {
    if (cartItems.length > 0) {
      dispatch(getCartDetails());
    } else {
      navigate('/cart');
    }
  }, [cartItems.length, dispatch, navigate]);

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

  const formatUSD = (amount) => {
    if (!amount && amount !== 0) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const proceedToPayment = () => {
    setIsProcessing(true);
    
    // Store order data for payment page
    const orderData = {
      cartItems: cartDetails,
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

  if (loading && cartDetails.length === 0) {
    return (
      <>
        <PageTitle title='Order Confirmation' />
        <Navbar />
        <Loader />
        <Footer />
      </>
    );
  }

  if (cartItems.length === 0) {
    return null;
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
            Please review your order details carefully. All prices are fetched fresh from our servers.
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
                  {cartDetails.map(item => (
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
                      <td>{formatUSD(item.price)}</td>
                      <td>{item.quantity}</td>
                      <td className="eoc-item-total">
                        {formatUSD(item.price * item.quantity)}
                      </td>
                    </tr>
                  ))}
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
                    <td>{formatUSD(displayPricing.itemPrice || 0)}</td>
                    <td>
                      {displayPricing.shippingPrice === 0 ? (
                        <span className="eoc-free-shipping">FREE</span>
                      ) : (
                        formatUSD(displayPricing.shippingPrice || 0)
                      )}
                    </td>
                    <td>{formatUSD(displayPricing.taxPrice || 0)}</td>
                    <td className="eoc-total-amount">
                      {formatUSD(displayPricing.totalPrice || 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
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