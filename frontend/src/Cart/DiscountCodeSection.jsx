import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
  applyDiscountCode, 
  clearDiscount 
} from '../features/cart/cartSlice';
import { FiTag, FiX, FiCheck } from 'react-icons/fi';
import { toast } from 'react-toastify';
import '../CartStyles/DiscountCode.css';

function DiscountCodeSection() {
  const dispatch = useDispatch();
  const { discount, loading } = useSelector(state => state.cart);
  
  const [code, setCode] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  // Handle apply discount
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
      // Success message is handled by the cart slice
      setCode('');
    } catch (error) {
      // Error message is handled by the cart slice
      console.error('Discount error:', error);
    } finally {
      setIsApplying(false);
    }
  };

  // Handle remove discount
  const handleRemoveDiscount = () => {
    dispatch(clearDiscount());
    setCode('');
  };

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
              {discount.description && (
                <span className="discount-applied-description">
                  {discount.description}
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
        </div>
      )}
    </div>
  );
}

export default DiscountCodeSection;