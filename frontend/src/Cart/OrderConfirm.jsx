import React, { useEffect, useState } from 'react';
import '../CartStyles/OrderConfirm.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useSelector, useDispatch } from 'react-redux';
import CheckoutPath from './CheckoutPath';
import { useNavigate } from 'react-router-dom';
import { getCartDetails } from '../features/cart/cartSlice';
import { 
  createCheckoutSession,
  removeErrors,
  removeMessage
} from '../features/checkout/checkoutSlice';
import { selectSelectedAddress } from '../features/shipping/shippingSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { FiCheckCircle, FiLock } from 'react-icons/fi';
// FIX: removed unused FiAlertCircle import

function OrderConfirm() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { cartItems, cartDetails, loading: cartLoading } = useSelector(state => state.cart);
  const { user } = useSelector(state => state.user);
  const selectedShippingAddress = useSelector(selectSelectedAddress);
  const { 
    session,
    // FIX: removed unused checkoutPricing — local calculatePricing() is used instead
    loading: checkoutLoading,
    error: checkoutError,
    success: checkoutSuccess
  } = useSelector(state => state.checkout);

  const [isProcessing, setIsProcessing] = useState(false);

  // FIX: addressChecked defers the redirect guard by one tick so Redux state
  // has time to settle after navigation from Shipping page
  const [addressChecked, setAddressChecked] = useState(false);

  // Calculate local pricing for display
  const calculatePricing = () => {
    const itemPrice = cartDetails.reduce((acc, item) => {
      return acc + (item.price * item.quantity);
    }, 0);
    
    const taxPrice = itemPrice * 0.18;
    const shippingPrice = itemPrice >= 500 ? 0 : 50;
    const totalPrice = itemPrice + taxPrice + shippingPrice;
    
    return { itemPrice, taxPrice, shippingPrice, totalPrice };
  };

  const displayPricing = cartDetails.length > 0
    ? calculatePricing()
    : { itemPrice: 0, taxPrice: 0, shippingPrice: 0, totalPrice: 0 };

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

  // FIX: defer the address check by one tick so Redux state settles after
  // navigation. Without setTimeout(0), the effect runs before the store
  // update from Shipping's selectAddress dispatch is reflected here,
  // causing a false redirect even when the address is valid.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!selectedShippingAddress || !selectedShippingAddress.address) {
        toast.warning('Please select a shipping address', {
          position: 'top-center',
          autoClose: 2000
        });
        navigate('/shipping');
      }
      setAddressChecked(true);
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedShippingAddress, navigate]);

  // Handle checkout errors
  useEffect(() => {
    if (checkoutError) {
      toast.error(checkoutError, {
        position: 'top-center',
        autoClose: 3000
      });
      dispatch(removeErrors());
    }
  }, [checkoutError, dispatch]);

  // Handle checkout success — session ready, navigate to payment
  useEffect(() => {
    if (checkoutSuccess && session) {
      toast.success('Checkout session created', {
        position: 'top-center',
        autoClose: 2000
      });
      dispatch(removeMessage());
    }
  }, [checkoutSuccess, session, dispatch]);

  const formatUSD = (amount) => {
    if (!amount && amount !== 0) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const proceedToPayment = async () => {
    // Fallback guard (also covered by the useEffect above)
    if (!selectedShippingAddress) {
      toast.error('Please select a shipping address', {
        position: 'top-center',
        autoClose: 2000
      });
      navigate('/shipping');
      return;
    }

    setIsProcessing(true);

    try {
      const items = cartDetails.map(item => ({
        product: item.product,
        quantity: item.quantity
      }));

      const shippingInfo = {
        firstName: user?.firstName || user?.name?.split(' ')[0] || 'User',
        lastName: user?.lastName || user?.name?.split(' ').slice(1).join(' ') || '',
        address: selectedShippingAddress.address,
        city: selectedShippingAddress.city,
        state: selectedShippingAddress.state,
        pinCode: selectedShippingAddress.pinCode,
        country: selectedShippingAddress.country,
        phoneNo: selectedShippingAddress.phoneNo
      };

      await dispatch(createCheckoutSession({ items, shippingInfo })).unwrap();

      navigate('/process/payment');
    } catch (err) {
      toast.error(err.message || 'Failed to create checkout session', {
        position: 'top-center',
        autoClose: 3000
      });
      setIsProcessing(false);
    }
  };

  // Show loader while: cart data is loading, checkout is processing,
  // or the address check hasn't fired yet (prevents flash of redirect)
  if ((cartLoading && cartDetails.length === 0) || checkoutLoading || !addressChecked) {
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
            Please review your order details carefully. All prices are verified with our servers.
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
                    <td>{selectedShippingAddress?.phoneNo || 'N/A'}</td>
                    <td>
                      {selectedShippingAddress?.address}, {selectedShippingAddress?.city}, {selectedShippingAddress?.state}, {selectedShippingAddress?.country} - {selectedShippingAddress?.pinCode}
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
            {isProcessing ? 'Creating Session...' : 'Proceed to Payment'}
          </button>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default OrderConfirm;