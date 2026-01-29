import React, { useEffect, useState } from 'react';
import '../CartStyles/EnterpriseOrderConfirm.css';
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
  const { shippingInfo, cartItems, pricing, pricingLoading } = useSelector(state => state.cart);
  const { user } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isProcessing, setIsProcessing] = useState(false);

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
          toast.error('Failed to calculate prices', {
            position: 'top-center',
            autoClose: 3000
          });
          navigate('/cart');
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
      pricing,
      user: {
        name: user.name,
        email: user.email
      }
    };
    
    sessionStorage.setItem('orderItem', JSON.stringify(orderData));
    navigate('/process/payment');
  };

  if (pricingLoading && !pricing.lastUpdated) {
    return (
      <>
        <Navbar />
        <Loader />
        <Footer />
      </>
    );
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
                    <td>{user?.name || 'N/A'}</td>
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
                  {cartItems.map(item => (
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
                      <td>{item.quantity}</td>
                      <td className="eoc-item-total">
                        {formatNGN(item.price * item.quantity)}
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
            
            {pricingLoading ? (
              <div className="eoc-loading">
                <p>Calculating final prices...</p>
              </div>
            ) : (
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
                      <td>{formatNGN(pricing.itemPrice)}</td>
                      <td>
                        {pricing.shippingPrice === 0 ? (
                          <span className="eoc-free-shipping">FREE</span>
                        ) : (
                          formatNGN(pricing.shippingPrice)
                        )}
                      </td>
                      <td>{formatNGN(pricing.taxPrice)}</td>
                      <td className="eoc-total-amount">
                        {formatNGN(pricing.totalPrice)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p className="eoc-summary-note">
                  <FiAlertCircle />
                  Final amount calculated at {new Date(pricing.lastUpdated).toLocaleString()}
                </p>
              </div>
            )}
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
            disabled={isProcessing || pricingLoading || cartItems.length === 0}
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