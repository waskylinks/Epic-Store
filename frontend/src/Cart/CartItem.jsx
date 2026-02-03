import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { 
  removeItemFromCart, 
  updateItemQuantity,
  getCartDetails
} from '../features/cart/cartSlice';
import { 
  addToWishlist, 
  removeFromWishlist,
  getWishlist,
  optimisticAdd,
  optimisticRemove
} from '../features/products/wishlistSlice';
import { FiMinus, FiPlus, FiTrash2, FiHeart } from 'react-icons/fi';
import { toast } from 'react-toastify';

function CartItem({ item }) {
  const dispatch = useDispatch();
  
  // Use separate selectors to avoid memoization issues
  const wishlistItems = useSelector(state => state.wishlist.items);
  const itemLoading = useSelector(state => state.wishlist.itemLoading);
  
  const [quantity, setQuantity] = useState(item.quantity);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync quantity when item.quantity changes
  useEffect(() => {
    setQuantity(item.quantity);
    setHasChanges(false);
  }, [item.quantity]);

  // Check if item is in wishlist - check against product._id
  const isInWishlist = wishlistItems.some(
    wishItem => {
      const wishlistProductId = wishItem.product?._id || wishItem.product;
      return wishlistProductId === item.product;
    }
  );
  
  const isWishlistLoading = itemLoading[item.product] || false;

  // Handle quantity input change
  const handleQuantityChange = (e) => {
    const value = e.target.value;
    
    // Allow empty string while typing
    if (value === '') {
      setQuantity('');
      setHasChanges(true);
      return;
    }

    const numValue = parseInt(value);
    
    // Validate quantity
    if (numValue >= 1 && numValue <= item.stock) {
      setQuantity(numValue);
      setHasChanges(numValue !== item.quantity);
    }
  };

  // Handle quantity input blur (when user finishes editing)
  const handleQuantityBlur = () => {
    // If empty or invalid, reset to original quantity
    if (quantity === '' || quantity < 1) {
      setQuantity(item.quantity);
      setHasChanges(false);
      return;
    }
  };

  // Handle increment
  const handleIncrement = () => {
    if (quantity < item.stock) {
      const newQty = parseInt(quantity) + 1;
      setQuantity(newQty);
      setHasChanges(true);
    } else {
      toast.warning(`Only ${item.stock} items available in stock`, {
        position: 'top-center',
        autoClose: 2000
      });
    }
  };

  // Handle decrement
  const handleDecrement = () => {
    if (quantity > 1) {
      const newQty = parseInt(quantity) - 1;
      setQuantity(newQty);
      setHasChanges(true);
    }
  };

  // Handle update cart
  const handleUpdate = () => {
    if (hasChanges && quantity >= 1 && quantity <= item.stock) {
      dispatch(updateItemQuantity({ 
        productId: item.product, 
        quantity: parseInt(quantity) 
      }));
      setHasChanges(false);
      
      // Refresh cart details to update order summary immediately
      setTimeout(() => {
        dispatch(getCartDetails());
      }, 100);
    }
  };

  // Handle remove from cart
  const handleRemove = () => {
    dispatch(removeItemFromCart(item.product));
  };

  // Handle wishlist toggle - OPTIMISTIC UPDATE for instant feedback
  const handleWishlistToggle = async () => {
    if (isInWishlist) {
      // OPTIMISTIC: Remove immediately from UI
      dispatch(optimisticRemove(item.product));
      
      // Then sync with server in background
      try {
        await dispatch(removeFromWishlist(item.product)).unwrap();
      } catch (error) {
        // If server fails, add it back (rollback)
        dispatch(optimisticAdd({ 
          _id: item.product, 
          name: item.name, 
          image: item.image 
        }));
        toast.error('Failed to remove from wishlist', {
          position: 'top-center',
          autoClose: 2000
        });
      }
    } else {
      // OPTIMISTIC: Add immediately to UI
      dispatch(optimisticAdd({ 
        _id: item.product, 
        name: item.name, 
        images: [{ url: item.image }],
        price: item.price
      }));
      
      // Then sync with server in background
      try {
        await dispatch(addToWishlist(item.product)).unwrap();
      } catch (error) {
        // If server fails, remove it (rollback)
        dispatch(optimisticRemove(item.product));
        toast.error('Failed to add to wishlist', {
          position: 'top-center',
          autoClose: 2000
        });
      }
    }
  };

  // Format currency
  const formatUSD = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const itemTotal = item.price * quantity;

  return (
    <div className="ec-item">
      {/* Product Info */}
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
        </div>
      </div>

      {/* Quantity Controls */}
      <div className="ec-item-qty-controls">
        <button 
          className="ec-item-qty-btn"
          onClick={handleDecrement}
          disabled={quantity <= 1}
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
              if (hasChanges) {
                handleUpdate();
              }
            }
          }}
          min="1"
          max={item.stock}
          aria-label="Quantity"
        />
        
        <button 
          className="ec-item-qty-btn"
          onClick={handleIncrement}
          disabled={quantity >= item.stock}
          aria-label="Increase quantity"
        >
          <FiPlus />
        </button>
      </div>

      {/* Item Total */}
      <div className="ec-item-total">
        <span className="ec-item-total-price">
          {formatUSD(itemTotal)}
        </span>
      </div>

      {/* Actions */}
      <div className="ec-item-action">
        <button 
          className="ec-item-update-btn"
          onClick={handleUpdate}
          disabled={!hasChanges}
          aria-label="Update quantity"
        >
          Update Cart
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