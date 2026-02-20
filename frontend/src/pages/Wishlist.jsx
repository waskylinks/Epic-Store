import React, { useEffect, useState } from 'react';
import '../pageStyles/Wishlist.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import { useDispatch, useSelector } from 'react-redux';
import { 
  getWishlist, 
  removeFromWishlist, 
  clearWishlist,
  removeMessage,
  removeErrors 
} from '../features/products/wishlistSlice';
import { addItemsToCart } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { 
  FiHeart, 
  FiTrash2, 
  FiShoppingCart, 
  FiX,
  FiStar,
  FiPackage
} from 'react-icons/fi';

function Wishlist() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const { items, count, loading, error, success, message } = useSelector(
    state => state.wishlist
  );
  const { isAuthenticated } = useSelector(state => state.user);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    dispatch(getWishlist());
  }, [dispatch, isAuthenticated, navigate]);

  useEffect(() => {
    if (error) {
      toast.error(error, {
        position: 'top-center',
        autoClose: 3000
      });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  useEffect(() => {
    if (success && message) {
      toast.success(message, {
        position: 'top-center',
        autoClose: 2000
      });
      dispatch(removeMessage());
    }
  }, [success, message, dispatch]);

  // ==================== HANDLERS ====================

  const handleRemoveItem = async (productId) => {
    try {
      await dispatch(removeFromWishlist(productId)).unwrap();
      dispatch(getWishlist()); // Refresh list
    } catch (error) {
      toast.error(error.message || 'Failed to remove item', {
        position: 'top-center',
        autoClose: 3000
      });
    }
  };

  const handleMoveToCart = async (productId) => {
    try {
      // Add to cart first
      dispatch(addItemsToCart({ id: productId, quantity: 1 }));
      // Then remove from wishlist
      await dispatch(removeFromWishlist(productId)).unwrap();
      toast.success('Item moved to cart', {
        position: 'top-center',
        autoClose: 2000
      });
      dispatch(getWishlist()); // Refresh list
    } catch (error) {
      toast.error(error.message || 'Failed to move item', {
        position: 'top-center',
        autoClose: 3000
      });
    }
  };

  const handleClearAll = async () => {
    try {
      await dispatch(clearWishlist()).unwrap();
      setShowClearConfirm(false);
      dispatch(getWishlist()); // Refresh list
    } catch (error) {
      toast.error(error.message || 'Failed to clear wishlist', {
        position: 'top-center',
        autoClose: 3000
      });
    }
  };

  // ==================== HELPER FUNCTIONS ====================

  const formatPrice = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',        // ← USD
    minimumFractionDigits: 2
  }).format(amount);
};

  const getProductPrice = (product) => {
    return product.pricing?.sale || product.pricing?.regular || product.price || 0;
  };

  const getOriginalPrice = (product) => {
    if (product.pricing?.sale && product.pricing?.regular) {
      return product.pricing.regular;
    }
    return null;
  };

  const getDiscountPercentage = (product) => {
    const regular = product.pricing?.regular || product.price;
    const sale = product.pricing?.sale;
    if (sale && regular > sale) {
      return Math.round(((regular - sale) / regular) * 100);
    }
    return 0;
  };

  const getStockStatus = (product) => {
    const stock = product.inventory?.stock ?? product.stock ?? 0;
    return stock;
  };

  if (loading) {
    return <Loader />;
  }

  // ==================== RENDER ====================

  return (
    <>
      <PageTitle title="My Wishlist" />
      <Navbar />

      <div className="wishlist-container">
        {/* Header */}
        <div className="wishlist-header">
          <div className="wishlist-header-content">
            <div className="wishlist-title-section">
              <FiHeart className="wishlist-icon" />
              <h1 className="wishlist-title">My Wishlist</h1>
            </div>
            <p className="wishlist-count">
              {count} {count === 1 ? 'item' : 'items'}
            </p>
          </div>

          {count > 0 && (
            <button 
              className="clear-all-btn"
              onClick={() => setShowClearConfirm(true)}
            >
              <FiTrash2 /> Clear All
            </button>
          )}
        </div>

        {/* Content */}
        {count === 0 ? (
          // Empty State
          <div className="wishlist-empty">
            <FiHeart className="empty-icon" />
            <h2>Your wishlist is empty</h2>
            <p>Save your favorite items here for later</p>
            <button 
              className="shop-now-btn"
              onClick={() => navigate('/products')}
            >
              Start Shopping
            </button>
          </div>
        ) : (
          // Wishlist Items
          <div className="wishlist-items">
            {items.map((item) => {
              const product = item.product;
              const price = getProductPrice(product);
              const originalPrice = getOriginalPrice(product);
              const discount = getDiscountPercentage(product);
              const stock = getStockStatus(product);
              const image = product.images?.[0]?.url || '/placeholder-product.png';

              return (
                <div key={product._id} className="wishlist-item">
                  {/* Image */}
                  <div className="wishlist-item-image-wrapper">
                    <img 
                      src={image} 
                      alt={product.name}
                      className="wishlist-item-image"
                      onClick={() => navigate(`/product/${product._id}`)}
                    />
                    {discount > 0 && (
                      <span className="wishlist-discount-badge">
                        -{discount}%
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="wishlist-item-info">
                    <h3 
                      className="wishlist-item-name"
                      onClick={() => navigate(product.slug ? `/products/${product.slug}` : `/product/${product._id}`)}
                    >
                      {product.name}
                    </h3>
                    
                    <p className="wishlist-item-category">
                      {product.category}
                    </p>

                    <div className="wishlist-item-rating">
                      <div className="wishlist-stars">
                        {[...Array(5)].map((_, i) => (
                          <FiStar 
                            key={i}
                            className={i < Math.floor(product.ratings || 0) ? 'filled' : ''}
                          />
                        ))}
                      </div>
                      <span className="wishlist-rating-text">
                        ({product.numOfReviews || 0} reviews)
                      </span>
                    </div>

                    <div className="wishlist-item-price">
                      <span className="wishlist-price-current">
                        {formatPrice(price)}
                      </span>
                      {originalPrice && (
                        <span className="wishlist-price-original">
                          {formatPrice(originalPrice)}
                        </span>
                      )}
                    </div>

                    <div className="wishlist-item-stock">
                      {stock > 0 ? (
                        <span className="stock-in">In Stock ({stock} available)</span>
                      ) : (
                        <span className="stock-out">Out of Stock</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="wishlist-item-actions">
                    {stock > 0 ? (
                      <button 
                        className="move-to-cart-btn"
                        onClick={() => handleMoveToCart(product._id)}
                      >
                        <FiShoppingCart /> Move to Cart
                      </button>
                    ) : (
                      <button className="out-of-stock-btn" disabled>
                        <FiPackage /> Out of Stock
                      </button>
                    )}
                    
                    <button 
                      className="remove-item-btn"
                      onClick={() => handleRemoveItem(product._id)}
                    >
                      <FiTrash2 /> Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close"
              onClick={() => setShowClearConfirm(false)}
            >
              <FiX />
            </button>
            <h3>Clear Wishlist?</h3>
            <p>Are you sure you want to remove all items from your wishlist?</p>
            <div className="modal-actions">
              <button 
                className="modal-btn cancel"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
              <button 
                className="modal-btn confirm"
                onClick={handleClearAll}
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}

export default Wishlist;