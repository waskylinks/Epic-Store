import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { 
  removeItemFromCart, 
  updateItemQuantity,
  moveToSavedForLater,
  removeErrors, 
} from '../features/cart/cartSlice';
import { FiMinus, FiPlus, FiTrash2, FiHeart } from 'react-icons/fi';
import '../CartStyles/Cart.css';

function CartItem({ item }) {
  const { success, loading, error, message } = useSelector(state => state.cart);
  
  // Handle both qty and quantity properties
  const currentQty = item.qty || item.quantity || 1;
  const [quantity, setQuantity] = useState(currentQty);
  const [isUpdating, setIsUpdating] = useState(false);
  const dispatch = useDispatch();

  // Sync quantity when item changes
  useEffect(() => {
    setQuantity(item.qty || item.quantity || 1);
  }, [item.qty, item.quantity]);

  // Format currency
  const formatNGN = (amount) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Decrease quantity
  const decreaseQuantity = () => {
    if (quantity <= 1) {
      toast.error('Quantity cannot be less than 1', {
        position: 'top-center',
        autoClose: 2000
      });
      return;
    }
    setQuantity(qty => qty - 1);
  };

  // Increase quantity
  const increaseQuantity = () => {
    const maxStock = item.inventory?.stock ?? item.stock ?? 0;
    
    if (maxStock <= quantity) {
        toast.error(`Only ${maxStock} available`, {
            position: 'top-center',
            autoClose: 2000
        });
        return;
    }
    setQuantity(qty => qty + 1);
};

  // Update quantity
  const handleUpdate = async () => {
    const itemQty = item.qty || item.quantity || 1;
    if (quantity !== itemQty) {
      setIsUpdating(true);
      try {
        dispatch(updateItemQuantity({
          productId: item.product,
          quantity
        }));
        toast.success('Quantity updated', {
          position: 'top-center',
          autoClose: 2000
        });
      } catch (err) {
        toast.error('Failed to update quantity', {
          position: 'top-center',
          autoClose: 2000
        });
      } finally {
        setIsUpdating(false);
      }
    }
  };

  // Remove item
  const handleRemove = () => {
    if (window.confirm(`Remove ${item.name} from cart?`)) {
      dispatch(removeItemFromCart(item.product));
      toast.success('Item removed from cart', {
        position: 'top-center',
        autoClose: 2000
      });
    }
  };

  // Save for later
  const handleSaveForLater = () => {
    dispatch(moveToSavedForLater(item.product));
    toast.success('Moved to saved for later', {
      position: 'top-center',
      autoClose: 2000
    });
  };

  // Handle errors
  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 2000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  return (
    <div className="ec-item">
      <div className="ec-item-info">
        <img 
          src={item.image} 
          alt={item.name} 
          className='ec-item-image'
          onError={(e) => {
            e.target.src = '/images/placeholder.png';
          }}
        />
        <div className="ec-item-details">
          <h3 className="ec-item-name">{item.name}</h3>
          <p className="ec-item-price">
            <strong>Price:</strong> {formatNGN(item.pricing?.sale || item.pricing?.regular || item.price || 0)}
        </p>

          <p className="ec-item-stock">
            {(() => {
                const stock = item.inventory?.stock ?? item.stock ?? 0;
                return stock > 0 ? (
                    <span className="ec-in-stock">
                        {stock <= 5 ? `Only ${stock} left` : 'In Stock'}
                    </span>
                ) : (
                    <span className="ec-out-stock">Out of Stock</span>
                );
            })()}
        </p>
        </div>
      </div>

      <div className="ec-item-qty-controls">
        <button 
          className="ec-item-qty-btn ec-qty-decrease"
          onClick={decreaseQuantity} 
          disabled={loading || isUpdating || quantity <= 1}
          aria-label="Decrease quantity"
        >
          <FiMinus />
        </button>
        <input 
            type="number" 
            value={quantity}
            className='ec-item-qty-input'
            readOnly
            min={1}
            max={item.inventory?.stock ?? item.stock ?? 0}
        />
        <button 
            className="ec-item-qty-btn ec-qty-increase"
            onClick={increaseQuantity}
            disabled={loading || isUpdating || quantity >= (item.inventory?.stock ?? item.stock ?? 0)}
            aria-label="Increase quantity"
        >
            <FiPlus />
        </button>
      </div>

      <div className="ec-item-total">
          <span className="ec-item-total-price">
              {formatNGN((item.pricing?.sale || item.pricing?.regular || item.price || 0) * quantity)}
          </span>
      </div>


      <div className="ec-item-action">
        <button 
          className="ec-item-update-btn"
          onClick={handleUpdate}
          disabled={loading || isUpdating || quantity === currentQty}
        >
          {isUpdating ? 'Updating...' : 'Update'}
        </button>
        
        <div className="ec-item-secondary-actions">
          <button 
            className="ec-item-save-btn"
            onClick={handleSaveForLater}
            disabled={loading}
            title="Save for later"
          >
            <FiHeart /> Save
          </button>
          <button 
            className="ec-item-remove-btn"
            disabled={loading}
            onClick={handleRemove}
            title="Remove from cart"
          >
            <FiTrash2 /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default CartItem;