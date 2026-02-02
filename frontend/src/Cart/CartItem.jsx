import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { 
  removeItemFromCart, 
  updateItemQuantity,
  removeErrors,
  getCartDetails
} from '../features/cart/cartSlice';
import { FiMinus, FiPlus, FiTrash2 } from 'react-icons/fi';
import CartModal from './CartModal';
import '../CartStyles/Cart.css';

function CartItem({ item }) {
  const { loading } = useSelector(state => state.cart);
  
  const [quantity, setQuantity] = useState(item.quantity || 1);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const dispatch = useDispatch();

  // Sync quantity when item changes
  useEffect(() => {
    setQuantity(item.quantity || 1);
  }, [item.quantity]);

  // Format currency
  const formatUSD = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Decrease quantity
  const decreaseQuantity = () => {
    if (quantity <= 1) {
      toast.error('Quantity cannot be less than 1', {
        position: 'top-center',
        autoClose: 2000,
        toastId: `qty-min-${item.product}`
      });
      return;
    }
    setQuantity(qty => qty - 1);
  };

  // Increase quantity
  const increaseQuantity = () => {
    const maxStock = item.stock || 0;
    
    if (maxStock <= quantity) {
      toast.error(`Only ${maxStock} available`, {
        position: 'top-center',
        autoClose: 2000,
        toastId: `qty-max-${item.product}`
      });
      return;
    }
    setQuantity(qty => qty + 1);
  };

  // Update quantity
  const handleUpdate = () => {
    if (quantity !== item.quantity) {
      dispatch(updateItemQuantity({
        productId: item.product,
        quantity
      }));
      
      // Refresh cart details to get updated prices
      setTimeout(() => {
        dispatch(getCartDetails());
      }, 100);
    }
  };

  // Open remove modal
  const handleRemoveClick = () => {
    setShowRemoveModal(true);
  };

  // Close remove modal
  const handleCloseModal = () => {
    setShowRemoveModal(false);
  };

  // Confirm removal
  const handleConfirmRemove = () => {
    setIsRemoving(true);
    dispatch(removeItemFromCart(item.product));
    setShowRemoveModal(false);
    setIsRemoving(false);
  };

  return (
    <>
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
              <strong>Price:</strong> {formatUSD(item.price || 0)}
            </p>

            <p className="ec-item-stock">
              {(() => {
                const stock = item.stock || 0;
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
            disabled={loading || quantity <= 1}
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
            max={item.stock || 0}
          />
          <button 
            className="ec-item-qty-btn ec-qty-increase"
            onClick={increaseQuantity}
            disabled={loading || quantity >= (item.stock || 0)}
            aria-label="Increase quantity"
          >
            <FiPlus />
          </button>
        </div>

        <div className="ec-item-total">
          <span className="ec-item-total-price">
            {formatUSD((item.price || 0) * quantity)}
          </span>
        </div>

        <div className="ec-item-action">
          <button 
            className="ec-item-update-btn"
            onClick={handleUpdate}
            disabled={loading || quantity === item.quantity}
          >
            Update
          </button>
          
          <div className="ec-item-secondary-actions">
            <button 
              className="ec-item-remove-btn"
              disabled={loading}
              onClick={handleRemoveClick}
              title="Remove from cart"
            >
              <FiTrash2 /> Remove
            </button>
          </div>
        </div>
      </div>

      {/* Remove Confirmation Modal */}
      <CartModal 
        isOpen={showRemoveModal}
        onClose={handleCloseModal}
        onConfirm={handleConfirmRemove}
        itemName={item.name}
        isLoading={isRemoving}
      />
    </>
  );
}

export default CartItem;