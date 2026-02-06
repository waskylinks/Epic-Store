import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
  applyDiscountCode, 
  removeDiscountCode,
  clearDiscount,
  updateLastActivity
} from '../features/cart/cartSlice';
import { FiTag, FiX, FiCheck } from 'react-icons/fi';
import '../CartStyles/DiscountCode.css';

function DiscountCodeSection() {
  const dispatch = useDispatch();
  const { discount, loading } = useSelector(state => state.cart);
  
  const [code, setCode] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleApplyDiscount = async (e) => {
    e.preventDefault();
    
    if (!code.trim()) {
      return;
    }

    dispatch(updateLastActivity());
    
    try {
      await dispatch(applyDiscountCode({ code: code.trim() })).unwrap();
      setCode('');
      setIsExpanded(false);
      
      // Log analytics
      console.log('[Cart Analytics] Discount applied:', {
        code: code.trim(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Error is already handled by slice
      console.log('[Cart Analytics] Discount failed:', {
        code: code.trim(),
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleRemoveDiscount = () => {
    dispatch(clearDiscount());
    dispatch(updateLastActivity());
    
    // Log analytics
    console.log('[Cart Analytics] Discount removed:', {
      removedCode: discount.code,
      timestamp: new Date().toISOString()
    });
  };

  if (discount.applied) {
    return (
      <div className="ec-discount-applied-container">
        <div className="ec-discount-applied-badge">
          <FiCheck className="ec-discount-check-icon" />
          <span className="ec-discount-code-text">{discount.code}</span>
          <span className="ec-discount-type-text">
            ({discount.type === 'percentage' ? `${discount.discountAmount}%` : `$${discount.discountAmount}`} off)
          </span>
          <button
            className="ec-discount-remove-btn"
            onClick={handleRemoveDiscount}
            aria-label="Remove discount"
          >
            <FiX />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ec-discount-section">
      {!isExpanded ? (
        <button
          className="ec-discount-toggle-btn"
          onClick={() => setIsExpanded(true)}
        >
          <FiTag />
          Have a discount code?
        </button>
      ) : (
        <form onSubmit={handleApplyDiscount} className="ec-discount-form">
          <div className="ec-discount-input-group">
            <FiTag className="ec-discount-input-icon" />
            <input
              type="text"
              className="ec-discount-input"
              placeholder="Enter discount code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              className="ec-discount-apply-btn"
              disabled={loading || !code.trim()}
            >
              {loading ? 'Applying...' : 'Apply'}
            </button>
            <button
              type="button"
              className="ec-discount-cancel-btn"
              onClick={() => {
                setIsExpanded(false);
                setCode('');
              }}
              disabled={loading}
            >
              <FiX />
            </button>
          </div>
          
          <div className="ec-discount-hints">
            <p className="ec-discount-hint-text">Try: SAVE10, SAVE20, or FLAT50</p>
          </div>
        </form>
      )}
    </div>
  );
}

export default DiscountCodeSection;