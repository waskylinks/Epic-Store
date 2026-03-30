import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
  applyDiscountCode, 
  clearDiscount 
} from '../features/cart/cartSlice';
import { FiTag, FiX, FiCheck, FiAlertCircle } from 'react-icons/fi';
import { toast } from 'react-toastify';
import '../CartStyles/DiscountCode.css';

function DiscountCodeSection() {
  const dispatch = useDispatch();

  const { discount, loading, cartDetails } = useSelector(state => state.cart);
  
  const [code, setCode]             = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const handleApplyDiscount = async (e) => {
    e.preventDefault();
    
    if (!code.trim()) {
      toast.error('Please enter a discount code', {
        position: 'top-center',
        autoClose: 2000
      });
      return;
    }

    setIsApplying(true);
    try {
      await dispatch(applyDiscountCode({ code: code.trim().toUpperCase() })).unwrap();
      setCode('');
    } catch (error) {
      console.error('Discount error:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleRemoveDiscount = () => {
    dispatch(clearDiscount());
    setCode('');
  };

  const categoryLabel = (() => {
    const cats = discount.eligibleProductCategories ?? [];
    if (cats.length === 0) return null;
    if (cats.length === 1) return `${cats[0]} only`;
    return `${cats.slice(0, -1).join(', ')} & ${cats[cats.length - 1]} only`;
  })();

  const formatUSD = (amount) => {
    if (amount == null) return '$0.00';
    return `$${Number(amount).toFixed(2)}`;
  };

  const liveBalanceAfterUse = (() => {
    if (!discount.applied) return null;
    if (discount.type !== 'fixed') return null;
    if (discount.remainingBalance === null || discount.remainingBalance === undefined) return null;

    if (Array.isArray(cartDetails) && cartDetails.length > 0) {
      const eligibleCats = discount.eligibleProductCategories ?? [];

      const currentCartTotal = cartDetails.reduce((sum, item) => {
        return sum + item.price * item.quantity;
      }, 0);

      // For category-restricted codes, base only on eligible items
      const currentBase =
        eligibleCats.length > 0
          ? cartDetails
              .filter(item => item.category && eligibleCats.includes(item.category))
              .reduce((sum, item) => sum + item.price * item.quantity, 0)
          : currentCartTotal;

      // Mirror server cap: Math.min(face value, cart total, remaining balance)
      const estimatedDiscount = Math.min(
        discount.value,
        currentBase,
        discount.remainingBalance
      );

      return Math.max(0, discount.remainingBalance - estimatedDiscount);
    }

    return discount.balanceAfterUse ?? null;
  })();

  const balanceIsStale =
    liveBalanceAfterUse !== null &&
    discount.balanceAfterUse !== null &&
    discount.balanceAfterUse !== undefined &&
    Math.abs(liveBalanceAfterUse - discount.balanceAfterUse) > 0.005;

  const shouldShowBalance = (() => {
    if (!discount.applied) return false;
    if (discount.type !== 'fixed') return false;
    if (liveBalanceAfterUse === null) return false;

  
    if (discount.remainingBalance === null || discount.remainingBalance === undefined) return false;


    if (discount.audience === 'specific') return true;
    if (discount.audience === 'all')      return false;


    const isFresh = discount.remainingBalance >= discount.value;
    if (isFresh) return false;

    return true;
  })();
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="discount-section">
      {!discount.applied ? (
        <form onSubmit={handleApplyDiscount} className="discount-form">
          <div className="discount-input-wrapper">
            <FiTag className="discount-icon" />
            <input
              type="text"
              className="discount-input"
              placeholder="Enter discount code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={isApplying || loading}
            />
          </div>
          <button
            type="submit"
            className="discount-apply-btn"
            disabled={isApplying || loading || !code.trim()}
          >
            {isApplying ? 'Applying...' : 'Apply'}
          </button>
        </form>
      ) : (
        <div className="discount-applied">
          <div className="discount-applied-info">
            <FiCheck className="discount-check-icon" />
            <div className="discount-applied-details">
              <span className="discount-applied-code">{discount.code}</span>

              {!categoryLabel && discount.description && (
                <span className="discount-applied-description">
                  {discount.description}
                </span>
              )}

              {categoryLabel && (
                <span className="discount-category-label">
                  <FiTag />
                  {categoryLabel}
                </span>
              )}
            </div>
          </div>

          <button
            className="discount-remove-btn"
            onClick={handleRemoveDiscount}
            disabled={loading}
            aria-label="Remove discount"
          >
            <FiX />
          </button>

          {shouldShowBalance && (
            <div className="discount-balance-row">
              <span className="discount-balance-label">
                Balance remaining after checkout:
              </span>
              <span className="discount-balance-value">
                {formatUSD(liveBalanceAfterUse)}
              </span>
              {/* FIX #19: stale notice when quantities changed post-apply */}
              {balanceIsStale && (
                <span className="discount-balance-stale-notice">
                  <FiAlertCircle />
                  Updated for current quantities
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DiscountCodeSection;