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
import { FiCheckCircle, FiLock, FiTag, FiTruck } from 'react-icons/fi';

function OrderConfirm() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { cartItems, cartDetails, pricing, discount, loading: cartLoading } = useSelector(state => state.cart);
  const { user } = useSelector(state => state.user);
  const selectedShippingAddress = useSelector(selectSelectedAddress);
  const { 
    session,
    loading: checkoutLoading,
    error: checkoutError,
    success: checkoutSuccess
  } = useSelector(state => state.checkout);

  const [isProcessing, setIsProcessing] = useState(false);
  const [addressChecked, setAddressChecked] = useState(false);

  useEffect(() => {
    if (cartItems.length > 0) {
      dispatch(getCartDetails());
    } else {
      navigate('/cart');
    }
  }, [cartItems.length, dispatch, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!selectedShippingAddress || !selectedShippingAddress.address) {
        toast.warning('Please select a shipping address', { position: 'top-center', autoClose: 2000 });
        navigate('/shipping');
      }
      setAddressChecked(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedShippingAddress, navigate]);

  useEffect(() => {
    if (checkoutError) {
      toast.error(checkoutError, { position: 'top-center', autoClose: 3000 });
      dispatch(removeErrors());
    }
  }, [checkoutError, dispatch]);

  useEffect(() => {
    if (checkoutSuccess && session) {
      dispatch(removeMessage());
    }
  }, [checkoutSuccess, session, dispatch]);

  const formatUSD = (amount) => {
    if (!amount && amount !== 0) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2
    }).format(amount);
  };

  const getUserFullName = () => {
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`;
    return user?.name || 'N/A';
  };

  // ── Pricing ───────────────────────────────────────────────────────────────
  // Read directly from Redux pricing — set authoritatively by applyDiscountCode
  // (or validateCheckout when no discount is active). No local recalculation.
  // pricing.itemPrice is already the post-discount discounted subtotal.
  const displayPricing = pricing;

  // ── Discount context ──────────────────────────────────────────────────────
  const hasDiscount    = discount.applied && discount.discountAmount > 0;
  const eligibleCats   = discount.eligibleProductCategories ?? [];
  const isCategoryCode = eligibleCats.length > 0;

  const categoryLabel = isCategoryCode
    ? eligibleCats.length === 1
      ? `${eligibleCats[0]} only`
      : `${eligibleCats.slice(0, -1).join(', ')} & ${eligibleCats[eligibleCats.length - 1]} only`
    : null;
  // ─────────────────────────────────────────────────────────────────────────

  const proceedToPayment = async () => {
    if (!selectedShippingAddress) {
      toast.error('Please select a shipping address', { position: 'top-center', autoClose: 2000 });
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
        lastName:  user?.lastName  || user?.name?.split(' ').slice(1).join(' ') || '',
        address:   selectedShippingAddress.address,
        city:      selectedShippingAddress.city,
        state:     selectedShippingAddress.state,
        pinCode:   selectedShippingAddress.pinCode,
        country:   selectedShippingAddress.country,
        phoneNo:   selectedShippingAddress.phoneNo
      };

      await dispatch(createCheckoutSession({ items, shippingInfo })).unwrap();
      navigate('/process/payment');
    } catch (err) {
      toast.error(err.message || 'Failed to create checkout session', {
        position: 'top-center', autoClose: 3000
      });
      setIsProcessing(false);
    }
  };

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

  if (cartItems.length === 0) return null;

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

        <div className="eoc-info-banner">
          <FiLock />
          <p>Please review your order details carefully. All prices are verified with our servers.</p>
        </div>

        <div className="eoc-content">

          {/* ── Shipping Information ────────────────────────────────────── */}
          <div className="eoc-section">
            <h2 className="eoc-section-title">Shipping Information</h2>
            <div className="eoc-shipping-card">
              <div className="eoc-shipping-row">
                <span className="eoc-shipping-label">Name</span>
                <span className="eoc-shipping-value">{getUserFullName()}</span>
              </div>
              <div className="eoc-shipping-row">
                <span className="eoc-shipping-label">Phone</span>
                <span className="eoc-shipping-value">{selectedShippingAddress?.phoneNo || 'N/A'}</span>
              </div>
              <div className="eoc-shipping-row">
                <span className="eoc-shipping-label">Address</span>
                <span className="eoc-shipping-value">
                  {selectedShippingAddress?.address}, {selectedShippingAddress?.city},{' '}
                  {selectedShippingAddress?.state}, {selectedShippingAddress?.country}{' '}
                  — {selectedShippingAddress?.pinCode}
                </span>
              </div>
            </div>
          </div>

          {/* ── Order Items ─────────────────────────────────────────────── */}
          <div className="eoc-section">
            <h2 className="eoc-section-title">Order Items</h2>
            <div className="eoc-items-list">
              {cartDetails.map(item => {
                const isEligible =
                  hasDiscount &&
                  isCategoryCode &&
                  typeof item.category === 'string' &&
                  eligibleCats.includes(item.category);

                return (
                  <div key={item.product} className="eoc-item-row">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="eoc-item-image"
                      onError={(e) => { e.target.src = '/images/placeholder.png'; }}
                    />
                    <div className="eoc-item-info">
                      <span className="eoc-item-name">{item.name}</span>
                      {isEligible && (
                        <span className="eoc-item-discount-badge">
                          <FiTag /> {discount.code} applied
                        </span>
                      )}
                      <span className="eoc-item-meta">
                        {formatUSD(item.price)} × {item.quantity}
                      </span>
                    </div>
                    <span className="eoc-item-total">
                      {formatUSD(item.price * item.quantity)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Order Summary ────────────────────────────────────────────── */}
          <div className="eoc-section">
            <h2 className="eoc-section-title">Order Summary</h2>
            <div className="eoc-summary-rows">

              <div className="eoc-summary-row">
                <span className="eoc-summary-label">Subtotal</span>
                {/* Single clean value — no strikethrough.
                    pricing.itemPrice is already the post-discount subtotal.
                    The user processed the discount on the Cart page; this
                    page is for confirmation, not price discovery. */}
                <span className="eoc-summary-value">
                  {formatUSD(displayPricing.itemPrice || 0)}
                </span>
              </div>

              {hasDiscount && (
                <div className="eoc-summary-row eoc-summary-row--discount">
                  <span className="eoc-summary-label eoc-discount-label">
                    <span className="eoc-discount-pill">
                      <FiTag />
                      {discount.code}
                    </span>
                    {categoryLabel && (
                      <span className="eoc-discount-cat">{categoryLabel}</span>
                    )}
                  </span>
                  <span className="eoc-summary-value eoc-discount-value">
                    -{formatUSD(discount.discountAmount)}
                  </span>
                </div>
              )}

              <div className="eoc-summary-row">
                <span className="eoc-summary-label">Tax (18%)</span>
                <span className="eoc-summary-value">
                  {formatUSD(displayPricing.taxPrice || 0)}
                </span>
              </div>

              <div className="eoc-summary-row">
                <span className="eoc-summary-label">Shipping</span>
                <span className="eoc-summary-value">
                  {displayPricing.shippingPrice === 0 ? (
                    <span className="eoc-free-shipping">
                      <FiTruck /> FREE
                    </span>
                  ) : (
                    formatUSD(displayPricing.shippingPrice || 0)
                  )}
                </span>
              </div>

              <div className="eoc-summary-row eoc-summary-row--total">
                <span className="eoc-total-label">Total</span>
                <span className="eoc-total-value">
                  {formatUSD(displayPricing.totalPrice || 0)}
                </span>
              </div>

            </div>
          </div>

        </div>

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