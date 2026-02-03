import React, { useEffect, useState } from 'react';
import '../CartStyles/Cart.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CartItem from './CartItem';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { 
  getCartDetails,
  validateCheckout,
  removeErrors, 
  removeMessage
} from '../features/cart/cartSlice';
import { getWishlist } from '../features/products/wishlistSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { 
  FiShoppingCart, 
  FiAlertCircle, 
  FiCheckCircle,
  FiArrowLeft
} from 'react-icons/fi';

function Cart() {
  const { 
    cartItems,
    cartDetails,
    pricing,
    loading, 
    error, 
    success, 
    message
  } = useSelector(state => state.cart);
  
  const { isAuthenticated } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isValidating, setIsValidating] = useState(false);

  // Fetch fresh product data and wishlist on mount
  useEffect(() => {
    if (cartItems.length > 0) {
      dispatch(getCartDetails());
    }
    // Fetch wishlist to sync state
    if (isAuthenticated) {
      dispatch(getWishlist());
    }
  }, [dispatch, cartItems.length, isAuthenticated]);

  // Handle error messages
  useEffect(() => {
    if (error) {
      toast.error(error, { 
        position: 'top-center', 
        autoClose: 3000,
        toastId: 'cart-error'
      });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  // Handle success messages
  useEffect(() => {
    if (success && message) {
      toast.success(message, { 
        position: 'top-center', 
        autoClose: 2000,
        toastId: message
      });
      dispatch(removeMessage());
    }
  }, [success, message, dispatch]);

  // Format currency
  const formatUSD = (amount) => {
    if (!amount && amount !== 0) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Calculate local pricing for display
  const calculateLocalPricing = () => {
    const itemPrice = cartDetails.reduce((acc, item) => {
      return acc + (item.price * item.quantity);
    }, 0);
    
    const taxPrice = itemPrice * 0.18;
    const shippingPrice = itemPrice >= 500 ? 0 : 50;
    const totalPrice = itemPrice + taxPrice + shippingPrice;
    
    return { itemPrice, taxPrice, shippingPrice, totalPrice };
  };

  const displayPricing = cartDetails.length > 0 ? calculateLocalPricing() : pricing;

  // Validate and proceed to checkout
  const handleProceedToCheckout = async () => {
    setIsValidating(true);
    try {
      await dispatch(validateCheckout()).unwrap();
      
      // Validation passed, proceed to shipping
      if (isAuthenticated) {
        navigate('/shipping');
      } else {
        navigate('/login?redirect=/shipping');
      }
    } catch (err) {
      // Validation failed - error already handled by slice
      toast.error(err.message || 'Some items are no longer available', {
        position: 'top-center',
        autoClose: 3000,
        toastId: 'checkout-validation-error'
      });
    } finally {
      setIsValidating(false);
    }
  };

  if (loading && cartDetails.length === 0) {
    return (
      <>
        <PageTitle title='Shopping Cart' />
        <Navbar />
        <Loader />
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title='Shopping Cart' />
      <Navbar />

      {cartItems.length === 0 ? (
        <div className="ec-empty-container">
          <FiShoppingCart className="ec-empty-icon" />
          <p className="ec-empty-message">Your Cart is Empty</p>
          <p className="ec-empty-subtitle">Add some products to get started</p>
          <Link to='/products' className='ec-view-products'>
            Browse Products
          </Link>
        </div>
      ) : (
        <div className="ec-page">
          <div className="ec-content">
            {/* Cart Items Section */}
            <div className="ec-items-section">
              <div className="ec-items-header">
                <h2 className="ec-items-heading">
                  <FiShoppingCart />
                  Your Cart ({cartItems.length} {cartItems.length === 1 ? 'item' : 'items'})
                </h2>
              </div>

              <div className="ec-table">
                <div className="ec-table-header">
                  <div className="ec-header-product">Product</div>
                  <div className="ec-header-quantity">Quantity</div>
                  <div className="ec-header-total">Item Total</div>
                  <div className="ec-header-action">Actions</div>
                </div>

                <div className="ec-items-list">
                  {cartDetails.map(item => (
                    <CartItem item={item} key={item.product} />
                  ))}
                </div>
              </div>
            </div>

            {/* Price Summary Section */}
            <div className="ec-summary-section">
              <div className="ec-summary">
                <h3 className="ec-summary-heading">Order Summary</h3>

                <div className="ec-summary-item">
                  <span className="ec-summary-label">Subtotal:</span>
                  <span className="ec-summary-value">
                    {formatUSD(displayPricing.itemPrice || 0)}
                  </span>
                </div>

                <div className="ec-summary-item">
                  <span className="ec-summary-label">Tax (18%):</span>
                  <span className="ec-summary-value">
                    {formatUSD(displayPricing.taxPrice || 0)}
                  </span>
                </div>

                <div className="ec-summary-item">
                  <span className="ec-summary-label">Shipping:</span>
                  <span className="ec-summary-value">
                    {displayPricing.shippingPrice === 0 ? (
                      <span className="ec-free-shipping">FREE</span>
                    ) : (
                      formatUSD(displayPricing.shippingPrice || 0)
                    )}
                  </span>
                </div>

                {displayPricing.itemPrice > 0 && displayPricing.shippingPrice > 0 && (
                  <div className="ec-summary-note">
                    <FiAlertCircle />
                    <span>Add {formatUSD(Math.max(0, 500 - displayPricing.itemPrice))} more for free shipping</span>
                  </div>
                )}

                <div className="ec-summary-divider"></div>
                
                <div className="ec-summary-total">
                  <span className="ec-total-label">Total:</span>
                  <span className="ec-total-value">
                    {formatUSD(displayPricing.totalPrice || 0)}
                  </span>
                </div>

                <button 
                  className="ec-checkout-btn"
                  onClick={handleProceedToCheckout}
                  disabled={isValidating || loading}
                >
                  {isValidating ? 'Validating...' : 'Proceed to Checkout'}
                </button>

                <Link to="/products" className="ec-continue-shopping">
                  <FiArrowLeft />
                  Continue Shopping
                </Link>
              </div>

              {/* Trust Badges */}
              <div className="ec-trust-badges">
                <div className="ec-trust-item">
                  <FiCheckCircle />
                  <span>Prices are calculated securely on our servers</span>
                </div>
                <div className="ec-trust-item">
                  <FiCheckCircle />
                  <span>Secure Checkout</span>
                </div>
                <div className="ec-trust-item">
                  <FiCheckCircle />
                  <span>Free Returns</span>
                </div>
                <div className="ec-trust-item">
                  <FiCheckCircle />
                  <span>24/7 Support</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}

export default Cart;