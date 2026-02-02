import React, { useEffect, useState } from 'react';
import '../CartStyles/Cart.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CartItem from './CartItem';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { 
  calculateCartPricing, 
  validateCart, 
  removeErrors, 
  removeMessage,
  batchValidateItems,
  removeInvalidItems,
  checkCartExpiry
} from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { 
  FiShoppingCart, 
  FiAlertCircle, 
  FiCheckCircle,
  FiRefreshCw 
} from 'react-icons/fi';

function Cart() {
  const { 
    cartItems, 
    pricing = {}, 
    validation,
    loading, 
    pricingLoading,
    validationLoading,
    error, 
    success, 
    message 
  } = useSelector(state => state.cart);
  
  const { isAuthenticated } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isValidating, setIsValidating] = useState(false);

  // Calculate local pricing as fallback - handles both qty and quantity
  const calculateLocalPricing = () => {
    const itemPrice = cartItems.reduce((acc, item) => {
        const itemQty = item.qty || item.quantity || 1;
        // ✅ FIXED: Use pricing.sale or pricing.regular, fallback to legacy price
        const itemPrice = item.pricing?.sale || item.pricing?.regular || item.price || 0;
        return acc + (itemPrice * itemQty);
    }, 0);
    
    const taxPrice = itemPrice * 0.18;
    const shippingPrice = itemPrice >= 500 ? 0 : 50;
    const totalPrice = itemPrice + taxPrice + shippingPrice;
    
    return { itemPrice, taxPrice, shippingPrice, totalPrice };
};

  // Use server pricing if available and valid, otherwise use local calculation
  const displayPricing = (pricing && typeof pricing.totalPrice === 'number') 
    ? pricing 
    : calculateLocalPricing();

  // Check cart expiry on mount
  useEffect(() => {
    dispatch(checkCartExpiry());
  }, [dispatch]);

  // Fetch server-calculated pricing when cart changes
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
          // Fallback to local calculation will be used automatically
        }
      };
      fetchPricing();
    }
  }, [cartItems, dispatch]);

  // Handle error messages
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

  // Format currency
  const formatNGN = (amount) => {
    if (!amount && amount !== 0) return '₦0.00';
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Validate cart before checkout
  const handleValidateCart = async () => {
    setIsValidating(true);
    try {
      const result = await dispatch(validateCart({ cartItems })).unwrap();
      
      if (!result.isValid) {
        toast.warning('Some items in your cart are no longer available', {
          position: 'top-center',
          autoClose: 3000
        });
        
        // Auto-remove invalid items
        if (result.invalidItems && result.invalidItems.length > 0) {
          dispatch(removeInvalidItems());
          toast.info('Invalid items removed from cart', {
            position: 'top-center',
            autoClose: 2000
          });
        }
      } else {
        // Cart is valid, proceed to shipping
        if (isAuthenticated) {
          navigate('/shipping');
        } else {
          navigate('/login?redirect=/shipping');
        }
      }
    } catch (err) {
      toast.error(err.message || 'Cart validation failed', {
        position: 'top-center',
        autoClose: 3000
      });
    } finally {
      setIsValidating(false);
    }
  };

  // Batch validate all items
  const handleBatchValidate = async () => {
    try {
      await dispatch(batchValidateItems({ cartItems })).unwrap();
      toast.success('Cart validated', { position: 'top-center', autoClose: 2000 });
    } catch (err) {
      toast.error('Validation failed', { position: 'top-center', autoClose: 2000 });
    }
  };

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
          {/* Validation Status Banner */}
          {validation.invalidItems && validation.invalidItems.length > 0 && (
            <div className="ec-validation-banner ec-validation-error">
              <FiAlertCircle />
              <span>
                {validation.invalidItems.length} item(s) in your cart are no longer available
              </span>
              <button 
                className="ec-validation-action"
                onClick={handleBatchValidate}
                disabled={validationLoading}
              >
                {validationLoading ? 'Checking...' : 'Remove Invalid Items'}
              </button>
            </div>
          )}

          {validation.isValid && validation.lastChecked && (
            <div className="ec-validation-banner ec-validation-success">
              <FiCheckCircle />
              <span>Cart validated - All items available</span>
            </div>
          )}

          <div className="ec-content">
            {/* Cart Items Section */}
            <div className="ec-items-section">
              <div className="ec-items-header">
                <h2 className="ec-items-heading">
                  <FiShoppingCart />
                  Your Cart ({cartItems.length} {cartItems.length === 1 ? 'item' : 'items'})
                </h2>
                {cartItems.length > 0 && (
                  <button 
                    className="ec-validate-btn"
                    onClick={handleBatchValidate}
                    disabled={validationLoading}
                  >
                    <FiRefreshCw className={validationLoading ? 'ec-spinning' : ''} />
                    {validationLoading ? 'Validating..' : 'Validate Cart'}
                  </button>
                )}
              </div>

              <div className="ec-table">
                <div className="ec-table-header">
                  <div className="ec-header-product">Product</div>
                  <div className="ec-header-quantity">Quantity</div>
                  <div className="ec-header-total">Item Total</div>
                  <div className="ec-header-action">Actions</div>
                </div>

                {/* Cart Items */}
                <div className="ec-items-list">
                  {cartItems.map(item => (
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
                    {formatNGN(displayPricing.itemPrice || 0)}
                  </span>
                </div>

                <div className="ec-summary-item">
                  <span className="ec-summary-label">Tax (18%):</span>
                  <span className="ec-summary-value">
                    {formatNGN(displayPricing.taxPrice || 0)}
                  </span>
                </div>

                <div className="ec-summary-item">
                  <span className="ec-summary-label">Shipping:</span>
                  <span className="ec-summary-value">
                    {displayPricing.shippingPrice === 0 ? (
                      <span className="ec-free-shipping">FREE</span>
                    ) : (
                      formatNGN(displayPricing.shippingPrice || 0)
                    )}
                  </span>
                </div>

                {displayPricing.itemPrice > 0 && displayPricing.shippingPrice > 0 && (
                  <div className="ec-summary-note">
                    <FiAlertCircle />
                    <span>Add {formatNGN(Math.max(0, 500 - displayPricing.itemPrice))} more for free shipping</span>
                  </div>
                )}

                <div className="ec-summary-divider"></div>

                <div className="ec-summary-total">
                  <span className="ec-total-label">Total:</span>
                  <span className="ec-total-value">
                    {formatNGN(displayPricing.totalPrice || 0)}
                  </span>
                </div>

                <p className="ec-summary-disclaimer">
                  <FiAlertCircle />
                  Prices are calculated securely on our servers
                </p>

                <button 
                  className="ec-checkout-btn"
                  onClick={handleValidateCart}
                  disabled={isValidating || validationLoading}
                >
                  {isValidating ? 'Validating...' : 'Proceed to Checkout'}
                </button>

                <Link to="/products" className="ec-continue-shopping">
                  Continue Shopping
                </Link>
              </div>

              {/* Trust Badges */}
              <div className="ec-trust-badges">
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