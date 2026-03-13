import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { 
  removeCartItem,
  updateCartItemQuantity,
  getCartDetails
} from '../features/cart/cartSlice';
import { 
  addToWishlist, 
  removeFromWishlist,
  optimisticAdd,
  optimisticRemove
} from '../features/products/wishlistSlice';
import { FiMinus, FiPlus, FiTrash2, FiHeart, FiTag } from 'react-icons/fi';
import { toast } from 'react-toastify';

function CartItem({ item }) {
  const dispatch = useDispatch();
  
  const wishlistItems = useSelector(state => state.wishlist.items);
  const itemLoading   = useSelector(state => state.wishlist.itemLoading);
  const discount      = useSelector(state => state.cart.discount);
  
  const [quantity, setQuantity]     = useState(item.quantity);
  const [hasChanges, setHasChanges] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setQuantity(item.quantity);
    setHasChanges(false);
  }, [item.quantity]);

  // ── Discount eligibility ───────────────────────────────────────────────────
  // A category restriction is active when:
  //   1. A discount is applied
  //   2. eligibleProductCategories is a non-empty array (meaning the code is
  //      not a blanket discount — it targets specific product categories)
  //
  // When the restriction is active, each item is checked against the list.
  // If eligibleProductCategories is empty the discount applies to all items
  // and no badge is needed — the summary line already communicates the saving.
  //
  // We deliberately do NOT show a per-item discounted price here.
  // The authoritative discount amount comes from the server. Reproducing that
  // math per-item on the frontend risks drift (e.g. maxDiscountAmount caps,
  // future conditions) and would create a trust gap right before payment.
  // The badge tells the user WHICH items qualified; the Order Summary tells
  // them HOW MUCH was saved — clean separation of concerns.
  const isCategoryRestricted =
    discount.applied &&
    Array.isArray(discount.eligibleProductCategories) &&
    discount.eligibleProductCategories.length > 0;

  const isEligible =
    isCategoryRestricted &&
    typeof item.category === 'string' &&
    discount.eligibleProductCategories.includes(item.category);

  const isIneligible = isCategoryRestricted && !isEligible;
  // ──────────────────────────────────────────────────────────────────────────

  const isInWishlist = wishlistItems.some(wishItem => {
    const wishlistProductId = wishItem.product?._id || wishItem.product;
    return wishlistProductId === item.product;
  });
  
  const isWishlistLoading = itemLoading[item.product] || false;

  const handleQuantityChange = (e) => {
    const value = e.target.value;
    
    if (value === '') {
      setQuantity('');
      setHasChanges(true);
      return;
    }

    const numValue = parseInt(value);
    
    if (numValue >= 1 && numValue <= item.stock) {
      setQuantity(numValue);
      setHasChanges(numValue !== item.quantity);
    }
  };

  const handleQuantityBlur = () => {
    if (quantity === '' || quantity < 1) {
      setQuantity(item.quantity);
      setHasChanges(false);
    }
  };

  const handleIncrement = () => {
    if (quantity < item.stock) {
      setQuantity(prev => parseInt(prev) + 1);
      setHasChanges(true);
    } else {
      toast.warning(`Only ${item.stock} items available in stock`, {
        position: 'top-center',
        autoClose: 2000
      });
    }
  };

  const handleDecrement = () => {
    if (quantity > 1) {
      setQuantity(prev => parseInt(prev) - 1);
      setHasChanges(true);
    }
  };

  const handleUpdate = async () => {
    if (!hasChanges || quantity < 1 || quantity > item.stock) return;

    setIsUpdating(true);
    try {
      await dispatch(updateCartItemQuantity({ 
        productId: item.product, 
        quantity: parseInt(quantity) 
      })).unwrap();
      
      setHasChanges(false);
      
      setTimeout(() => {
        dispatch(getCartDetails());
      }, 100);
    } catch (err) {
      toast.error(err.message || 'Failed to update cart', {
        position: 'top-center',
        autoClose: 2000
      });
      setQuantity(item.quantity);
      setHasChanges(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemove = async () => {
    try {
      await dispatch(removeCartItem(item.product)).unwrap();
      
      setTimeout(() => {
        dispatch(getCartDetails());
      }, 100);
    } catch (err) {
      toast.error(err.message || 'Failed to remove item', {
        position: 'top-center',
        autoClose: 2000
      });
    }
  };

  const handleWishlistToggle = async () => {
    if (isInWishlist) {
      dispatch(optimisticRemove(item.product));
      try {
        await dispatch(removeFromWishlist(item.product)).unwrap();
      } catch {
        dispatch(optimisticAdd({ 
          _id: item.product, 
          name: item.name, 
          images: [{ url: item.image }],
          price: item.price
        }));
        toast.error('Failed to remove from wishlist', {
          position: 'top-center',
          autoClose: 2000
        });
      }
    } else {
      dispatch(optimisticAdd({ 
        _id: item.product, 
        name: item.name, 
        images: [{ url: item.image }],
        price: item.price
      }));
      try {
        await dispatch(addToWishlist(item.product)).unwrap();
      } catch {
        dispatch(optimisticRemove(item.product));
        toast.error('Failed to add to wishlist', {
          position: 'top-center',
          autoClose: 2000
        });
      }
    }
  };

  const formatUSD = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const itemTotal = item.price * quantity;

  return (
    <div className={`ec-item${isIneligible ? ' ec-item--ineligible' : ''}`}>
      <div className="ec-item-info">
        <Link to={`/product/${item.product}`}>
          <img 
            src={item.image} 
            alt={item.name}
            className="ec-item-image"
          />
        </Link>
        <div className="ec-item-details">
          <Link to={`/product/${item.product}`} style={{ textDecoration: 'none' }}>
            <h4 className="ec-item-name">{item.name}</h4>
          </Link>
          <p className="ec-item-price">
            <strong>{formatUSD(item.price)}</strong> each
          </p>
          <p className={`ec-item-stock ${item.stock > 0 ? 'ec-in-stock' : 'ec-out-stock'}`}>
            {item.stock > 0 ? `${item.stock} in stock` : 'Out of stock'}
          </p>

          {/* ── Discount eligibility badge ─────────────────────────────── */}
          {isEligible && (
            <span className="ec-item-discount-badge">
              <FiTag />
              {discount.code} applied
            </span>
          )}
          {isIneligible && (
            <span className="ec-item-ineligible-badge">
              Not eligible for {discount.code}
            </span>
          )}
          {/* ─────────────────────────────────────────────────────────────── */}
        </div>
      </div>

      <div className="ec-item-qty-controls">
        <button 
          className="ec-item-qty-btn"
          onClick={handleDecrement}
          disabled={quantity <= 1 || isUpdating}
          aria-label="Decrease quantity"
        >
          <FiMinus />
        </button>
        
        <input
          type="number"
          className="ec-item-qty-input"
          value={quantity}
          onChange={handleQuantityChange}
          onBlur={handleQuantityBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.target.blur();
              if (hasChanges) handleUpdate();
            }
          }}
          min="1"
          max={item.stock}
          disabled={isUpdating}
          aria-label="Quantity"
        />
        
        <button 
          className="ec-item-qty-btn"
          onClick={handleIncrement}
          disabled={quantity >= item.stock || isUpdating}
          aria-label="Increase quantity"
        >
          <FiPlus />
        </button>
      </div>

      {/* Item total — always shows original undiscounted price.
          The per-item discounted price is intentionally NOT shown here.
          See discount eligibility comment above for rationale. */}
      <div className="ec-item-total">
        <span className="ec-item-total-price">
          {formatUSD(itemTotal)}
        </span>
      </div>

      <div className="ec-item-action">
        <button 
          className="ec-item-update-btn"
          onClick={handleUpdate}
          disabled={!hasChanges || isUpdating}
          aria-label="Update quantity"
        >
          {isUpdating ? 'Updating...' : 'Update Cart'}
        </button>

        <div className="ec-item-secondary-actions">
          <button 
            className="ec-item-save-btn"
            onClick={handleWishlistToggle}
            disabled={isWishlistLoading}
            aria-label={isInWishlist ? "Remove from wishlist" : "Add to wishlist"}
          >
            <FiHeart 
              className={isWishlistLoading ? 'ec-heart-filling' : ''}
              style={{ 
                fill: isInWishlist ? '#ff3c3c' : 'none',
                color: isInWishlist ? '#ff3c3c' : 'currentColor'
              }}
            />
            {isInWishlist ? 'Saved' : 'Save'}
          </button>
          
          <button 
            className="ec-item-remove-btn"
            onClick={handleRemove}
            disabled={isUpdating}
            aria-label="Remove from cart"
          >
            <FiTrash2 />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default CartItem;