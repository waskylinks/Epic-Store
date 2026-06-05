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
  removeErrors,
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
  FiPackage,
} from 'react-icons/fi';

function Wishlist() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // loading  → getWishlist (initial fetch only — don't use for action-level ops)
  // actionLoading → clearWishlist
  // itemLoading   → per-product add/remove/move
  const {
    items,
    count,
    loading,
    actionLoading,
    itemLoading,
    error,
    success,
    message,
  } = useSelector(state => state.wishlist);

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
      toast.error(error, { position: 'top-center', autoClose: 3000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  useEffect(() => {
    if (success && message) {
      toast.success(message, { position: 'top-center', autoClose: 2000 });
      dispatch(removeMessage());
    }
  }, [success, message, dispatch]);

  // ==================== HANDLERS ====================

  const handleRemoveItem = async (productId) => {
    try {
      await dispatch(removeFromWishlist(productId)).unwrap();
      // State is already patched in the slice; no full refetch needed.
      // Only refetch if the server count and local count could diverge
      // (e.g. a concurrent session added items). Optional — remove if
      // the extra network call is undesirable.
      // dispatch(getWishlist());
    } catch (err) {
      toast.error(err?.message || 'Failed to remove item', {
        position: 'top-center',
        autoClose: 3000,
      });
    }
  };

  const handleMoveToCart = async (productId) => {
    try {
      // Fire both in parallel — cart add doesn't depend on wishlist remove
      await Promise.all([
        dispatch(addItemsToCart({ id: productId, quantity: 1 })).unwrap(),
        dispatch(removeFromWishlist(productId)).unwrap(),
      ]);
      toast.success('Item moved to cart', { position: 'top-center', autoClose: 2000 });
    } catch (err) {
      toast.error(err?.message || 'Failed to move item', {
        position: 'top-center',
        autoClose: 3000,
      });
    }
  };

  const handleClearAll = async () => {
    try {
      await dispatch(clearWishlist()).unwrap();
      setShowClearConfirm(false);
      // State is reset in the slice (items: [], count: 0)
    } catch (err) {
      toast.error(err?.message || 'Failed to clear wishlist', {
        position: 'top-center',
        autoClose: 3000,
      });
    }
  };

  // ==================== HELPERS ====================

  const formatPrice = (amount) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);

  const getProductPrice = (product) =>
    product.pricing?.sale || product.pricing?.regular || product.price || 0;

  const getOriginalPrice = (product) => {
    if (product.pricing?.sale && product.pricing?.regular) return product.pricing.regular;
    return null;
  };

  const getDiscountPercentage = (product) => {
    const regular = product.pricing?.regular || product.price;
    const sale = product.pricing?.sale;
    if (sale && regular > sale) return Math.round(((regular - sale) / regular) * 100);
    return 0;
  };

  const getStockStatus = (product) =>
    product.inventory?.stock ?? product.stock ?? 0;

  // ── Full-page loader only on the initial data fetch ───────────────────────
  // BUG WAS HERE: the old code used `if (loading) return <Loader />;` which
  // re-triggered on every getWishlist() dispatch inside action handlers,
  // hiding the entire page mid-interaction. Now only shown when items haven't
  // loaded yet (first mount).
  if (loading && items.length === 0) {
    return (
      <>
        <PageTitle title="My Wishlist" />
        <Navbar />
        {/* Inline snake loader — does not hide the entire page */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <Loader type="snake" size="md" />
        </div>
        <Footer />
      </>
    );
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
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader type="snake" size="sm" />
              ) : (
                <><FiTrash2 /> Clear All</>
              )}
            </button>
          )}
        </div>

        {/* Content */}
        {count === 0 ? (
          <div className="wishlist-empty">
            <FiHeart className="empty-icon" />
            <h2>Your wishlist is empty</h2>
            <p>Save your favorite items here for later</p>
            <button className="shop-now-btn" onClick={() => navigate('/products')}>
              Start Shopping
            </button>
          </div>
        ) : (
          <div className="wishlist-items">
            {items.map((item) => {
              // Guard: item.product can be a plain id string (after optimisticAdd
              // from a non-populated source) or a full populated object.
              const product = item.product;
              if (!product || typeof product !== 'object') return null;

              const price = getProductPrice(product);
              const originalPrice = getOriginalPrice(product);
              const discount = getDiscountPercentage(product);
              const stock = getStockStatus(product);
              const image = product.images?.[0]?.url || '/placeholder-product.png';
              const productId = product._id;
              const isItemLoading = itemLoading[productId] || false;

              return (
                <div key={productId} className={`wishlist-item${isItemLoading ? ' wishlist-item--loading' : ''}`}>
                  {/* Image */}
                  <div className="wishlist-item-image-wrapper">
                    <img
                      src={image}
                      alt={product.name}
                      className="wishlist-item-image"
                      onClick={() =>
                        navigate(
                          product.slug ? `/products/${product.slug}` : `/product/${productId}`
                        )
                      }
                    />
                    {discount > 0 && (
                      <span className="wishlist-discount-badge">-{discount}%</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="wishlist-item-info">
                    <h3
                      className="wishlist-item-name"
                      onClick={() =>
                        navigate(
                          product.slug ? `/products/${product.slug}` : `/product/${productId}`
                        )
                      }
                    >
                      {product.name}
                    </h3>

                    {product.category && (
                      <p className="wishlist-item-category">{product.category}</p>
                    )}

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
                      <span className="wishlist-price-current">{formatPrice(price)}</span>
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
                        onClick={() => handleMoveToCart(productId)}
                        disabled={isItemLoading}
                      >
                        {isItemLoading ? (
                          <Loader type="snake" size="sm" />
                        ) : (
                          <><FiShoppingCart /> Move to Cart</>
                        )}
                      </button>
                    ) : (
                      <button className="out-of-stock-btn" disabled>
                        <FiPackage /> Out of Stock
                      </button>
                    )}

                    <button
                      className="remove-item-btn"
                      onClick={() => handleRemoveItem(productId)}
                      disabled={isItemLoading}
                    >
                      {isItemLoading ? (
                        <Loader type="snake" size="sm" />
                      ) : (
                        <><FiTrash2 /> Remove</>
                      )}
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
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={handleClearAll}
                disabled={actionLoading}
              >
                {actionLoading ? 'Clearing...' : 'Clear All'}
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