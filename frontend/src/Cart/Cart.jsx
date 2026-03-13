import React, { useEffect, useState } from 'react';
import '../CartStyles/Cart.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CartItem from './CartItem';
import DiscountCodeSection from './DiscountCodeSection';
import ClearCartModal from './ClearCartModal';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { 
  getCartDetails,
  validateCheckout,
  clearEntireCart,
  removeErrors, 
  removeMessage
} from '../features/cart/cartSlice';
import { getWishlist } from '../features/products/wishlistSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { 
  FiShoppingCart, 
  FiArrowLeft,
  FiTruck,
  FiShield,
  FiHeadphones,
  FiRefreshCw,
  FiTrash2,
  FiCheckCircle
} from 'react-icons/fi';

function Cart() {
  const { 
    cartItems,
    cartDetails,
    pricing,
    discount,
    loading, 
    error, 
    success, 
    message
  } = useSelector(state => state.cart);
  
  const { isAuthenticated } = useSelector(state => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isValidating, setIsValidating] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    if (cartItems.length > 0) {
      dispatch(getCartDetails());
    }
    if (isAuthenticated) {
      dispatch(getWishlist());
    }
  }, [dispatch, isAuthenticated, cartItems.length]);

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

  const formatUSD = (amount) => {
    if (!amount && amount !== 0) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Build display pricing from server state when available, falling back to
  // a local calculation only when cartDetails are loaded but no server pricing
  // has arrived yet (e.g. on first mount before validateCheckout or
  // applyDiscountCode has been called).
  //
  // IMPORTANT: once the slice has real server pricing (pricing.totalPrice > 0,
  // which is set by applyDiscountCode or validateCheckout), we always prefer
  // it — it is the authoritative source. The local calc is only a display
  // fallback so the summary isn't blank while items are visible.
  //
  // The local calc derives originalItemPrice from cartDetails so the
  // strikethrough subtotal works even before a server round-trip.
  const getDisplayPricing = () => {
    const localItemPrice = cartDetails.reduce(
      (acc, item) => acc + item.price * item.quantity, 0
    );

    // If server pricing is populated, use it directly.
    // Augment with originalItemPrice for the strikethrough display when a
    // discount is active (server pricing.itemPrice is the discounted value).
    if (pricing.totalPrice > 0) {
      return {
        ...pricing,
        originalItemPrice: discount.applied
          ? localItemPrice
          : pricing.itemPrice,
        discountAmount: discount.applied ? discount.discountAmount : 0,
      };
    }

    // Fallback: derive everything locally from cartDetails.
    const discountAmount   = discount.applied ? discount.discountAmount : 0;
    const discountedItemPrice = Math.max(0, localItemPrice - discountAmount);
    const taxPrice         = discountedItemPrice * 0.18;
    const shippingPrice    = discountedItemPrice >= 500 ? 0 : 50;
    const totalPrice       = discountedItemPrice + taxPrice + shippingPrice;

    return {
      originalItemPrice: localItemPrice,
      itemPrice:         discountedItemPrice,
      discountAmount,
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: 'USD',
    };
  };

  const displayPricing = cartDetails.length > 0 ? getDisplayPricing() : pricing;

  const handleProceedToCheckout = async () => {
    setIsValidating(true);
    try {
      await dispatch(validateCheckout()).unwrap();
      if (isAuthenticated) {
        navigate('/shipping');
      } else {
        navigate('/login?redirect=/shipping');
      }
    } catch (err) {
      toast.error(err.message || 'Some items are no longer available', {
        position: 'top-center',
        autoClose: 3000,
        toastId: 'checkout-validation-error'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleOpenClearModal = () => {
    setShowClearModal(true);
  };

  const handleCloseClearModal = () => {
    if (!isClearing) {
      setShowClearModal(false);
    }
  };

  const handleConfirmClearCart = async () => {
    setIsClearing(true);
    try {
      await dispatch(clearEntireCart()).unwrap();
      setShowClearModal(false);
    } catch (err) {
      toast.error(err.message || 'Failed to clear cart', {
        position: 'top-center',
        autoClose: 2000
      });
    } finally {
      setIsClearing(false);
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
            <div className="ec-items-section">
              <div className="ec-items-header">
                <h2 className="ec-items-heading">
                  <FiShoppingCart />
                  Your Cart ({cartItems.reduce((sum, item) => sum + item.quantity, 0)}{' '}
                  {cartItems.reduce((sum, item) => sum + item.quantity, 0) === 1 ? 'item' : 'items'})
                </h2>
                
                <button 
                  className="ec-clear-cart-btn"
                  onClick={handleOpenClearModal}
                  disabled={loading}
                >
                  <FiTrash2 />
                  Clear Cart
                </button>
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

            <div className="ec-summary-section">
              <div className="ec-summary">
                <h3 className="ec-summary-heading">Order Summary</h3>

                <div className="ec-summary-item">
                  <span className="ec-summary-label">Subtotal:</span>
                  <span className="ec-summary-value">
                    {discount.applied && displayPricing.originalItemPrice > displayPricing.itemPrice ? (
                      <>
                        <span style={{ textDecoration: 'line-through', marginRight: '8px', color: '#999' }}>
                          {formatUSD(displayPricing.originalItemPrice || 0)}
                        </span>
                        {formatUSD(displayPricing.itemPrice || 0)}
                      </>
                    ) : (
                      formatUSD(displayPricing.itemPrice || 0)
                    )}
                  </span>
                </div>

                <DiscountCodeSection />

                {discount.applied && (
                  <div className="ec-summary-item ec-discount-applied">
                    <span className="ec-summary-label" style={{ color: '#10b981' }}>
                      Discount ({discount.code}):
                    </span>
                    <span className="ec-summary-value" style={{ color: '#10b981' }}>
                      -{formatUSD(displayPricing.discountAmount || 0)}
                    </span>
                  </div>
                )}

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
                    <FiTruck />
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
                  {isValidating ? (
                    <>
                      <FiRefreshCw className="ec-btn-spinner" />
                      Validating...
                    </>
                  ) : (
                    'Proceed to Checkout'
                  )}
                </button>

                <Link to="/products" className="ec-continue-shopping">
                  <FiArrowLeft />
                  Continue Shopping
                </Link>
              </div>

              <div className="ec-trust-badges">
                <div className="ec-trust-item">
                  <FiCheckCircle />
                  <span>Secure Checkout</span>
                </div>
                <div className="ec-trust-item">
                  <FiShield />
                  <span>Buyer Protection</span>
                </div>
                <div className="ec-trust-item">
                  <FiRefreshCw />
                  <span>Free Returns</span>
                </div>
                <div className="ec-trust-item">
                  <FiHeadphones />
                  <span>24/7 Support</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ClearCartModal
        isOpen={showClearModal}
        onClose={handleCloseClearModal}
        onConfirm={handleConfirmClearCart}
        isClearing={isClearing}
      />

      <Footer />
    </>
  );
}

export default Cart;