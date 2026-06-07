import { useState, useEffect } from 'react';
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
  FiArrowRight,
  FiShoppingBag,
} from 'react-icons/fi';
import '../pageStyles/Wishlist.css';

function Wishlist() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [removingId, setRemovingId]             = useState(null);
  const [movingId, setMovingId]                 = useState(null);

  // [FIX] Read items directly — derive count from items.length so it stays
  // in sync with instant add/remove updates. `count` in state is only
  // refreshed by getWishlist() round-trips and lags behind slice mutations.
  const { items, loading, error, success, message } = useSelector(s => s.wishlist);
  const count = items.length;

  const { isAuthenticated } = useSelector(s => s.user);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    // Fetch once on mount to get fully-populated product objects.
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleRemoveItem = async (productId) => {
    setRemovingId(productId);
    try {
      // [FIX] No getWishlist() after remove — slice filters state.items on
      // removeFromWishlist.fulfilled so the UI updates immediately.
      await dispatch(removeFromWishlist(productId)).unwrap();
    } catch (err) {
      toast.error(err?.message || 'Failed to remove item', {
        position: 'top-center',
        autoClose: 3000,
      });
    } finally {
      setRemovingId(null);
    }
  };

  const handleMoveToCart = async (productId) => {
    setMovingId(productId);
    try {
      // [FIX] Await cart add before removing from wishlist — previous version
      // was fire-and-forget on the cart dispatch, risking a remove without add.
      await dispatch(addItemsToCart({ id: productId, quantity: 1 })).unwrap();
      await dispatch(removeFromWishlist(productId)).unwrap();
      toast.success('Moved to cart!', { position: 'top-center', autoClose: 2000 });
    } catch (err) {
      toast.error(err?.message || 'Failed to move item to cart', {
        position: 'top-center',
        autoClose: 3000,
      });
    } finally {
      setMovingId(null);
    }
  };

  const handleClearAll = async () => {
    try {
      // [FIX] No getWishlist() after clear — slice zeroes state.items on
      // clearWishlist.fulfilled.
      await dispatch(clearWishlist()).unwrap();
      setShowClearConfirm(false);
    } catch (err) {
      toast.error(err?.message || 'Failed to clear wishlist', {
        position: 'top-center',
        autoClose: 3000,
      });
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatPrice = (amount, currency = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: ['USD', 'EUR', 'GBP', 'NGN'].includes(currency) ? currency : 'USD',
      minimumFractionDigits: 2,
    }).format(amount);

  const resolvePrice = (product) => ({
    current:  product.pricing?.sale || product.pricing?.regular || product.price || 0,
    original: product.pricing?.sale && product.pricing?.regular ? product.pricing.regular : null,
    currency: product.pricing?.currency || 'USD',
    discount:
      product.pricing?.sale && product.pricing?.regular && product.pricing.regular > product.pricing.sale
        ? Math.round(((product.pricing.regular - product.pricing.sale) / product.pricing.regular) * 100)
        : 0,
  });

  const resolveStock   = (product) => product.inventory?.stock ?? product.stock ?? 0;
  const resolveImage   = (product) => {
    const imgs = product.images || product.image || [];
    return (imgs.find(i => i.isPrimary) || imgs[0])?.url || '/placeholder-product.png';
  };
  const resolveUrl     = (product) =>
    product.slug ? `/products/${product.slug}` : `/product/${product._id}`;

  // ── Loader ────────────────────────────────────────────────────────────────
  if (loading && items.length === 0) {
    return (
      <>
        <PageTitle title="My Wishlist" />
        <Navbar />
        <Loader />
        <Footer />
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle title="My Wishlist" />
      <Navbar />

      <main className="wl-page">
        {/* ── Hero strip ── */}
        <div className="wl-hero">
          <div className="wl-hero-inner">
            <div className="wl-hero-left">
              <span className="wl-hero-eyebrow">Your Collection</span>
              <h1 className="wl-hero-title">
                Wish<span className="wl-hero-accent">list</span>
              </h1>
            </div>
            <div className="wl-hero-right">
              <div className="wl-hero-count-ring">
                <FiHeart className="wl-hero-heart" />
                <span className="wl-hero-count-num">{count}</span>
                <span className="wl-hero-count-label">{count === 1 ? 'item' : 'items'}</span>
              </div>
              {count > 0 && (
                <button
                  className="wl-clear-btn"
                  onClick={() => setShowClearConfirm(true)}
                >
                  <FiTrash2 />
                  <span>Clear all</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="wl-content">
          {count === 0 ? (
            <div className="wl-empty">
              <div className="wl-empty-icon-wrap">
                <FiHeart className="wl-empty-icon" />
              </div>
              <h2 className="wl-empty-title">Nothing saved yet</h2>
              <p className="wl-empty-sub">
                Tap the heart on any product to save it here for later.
              </p>
              <button className="wl-shop-btn" onClick={() => navigate('/products')}>
                <FiShoppingBag />
                Browse products
                <FiArrowRight />
              </button>
            </div>
          ) : (
            <ul className="wl-list" role="list">
              {items.map((item, idx) => {
                const product = item.product;
                // Guard: item may arrive with an unpopulated product ref
                if (!product || typeof product !== 'object' || !product._id) return null;

                const { current, original, currency, discount } = resolvePrice(product);
                const stock   = resolveStock(product);
                const image   = resolveImage(product);
                const url     = resolveUrl(product);
                const isRemoving = removingId === product._id;
                const isMoving   = movingId   === product._id;
                const busy       = isRemoving || isMoving;

                return (
                  <li
                    key={product._id}
                    className={`wl-item ${isRemoving ? 'wl-item--removing' : ''}`}
                    style={{ '--delay': `${idx * 60}ms` }}
                    role="listitem"
                  >
                    {/* Image */}
                    <div className="wl-item-img-wrap" onClick={() => navigate(url)}>
                      <img
                        src={image}
                        alt={product.name}
                        className="wl-item-img"
                        loading="lazy"
                        decoding="async"
                      />
                      {discount > 0 && (
                        <span className="wl-item-badge">−{discount}%</span>
                      )}
                    </div>

                    {/* Body */}
                    <div className="wl-item-body">
                      <div className="wl-item-meta">
                        {product.brand && (
                          <span className="wl-item-brand">{product.brand}</span>
                        )}
                        <span className="wl-item-category">{product.category}</span>
                      </div>

                      <h3
                        className="wl-item-name"
                        onClick={() => navigate(url)}
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && navigate(url)}
                        role="link"
                      >
                        {product.name}
                      </h3>

                      {/* Stars */}
                      <div
                        className="wl-item-rating"
                        aria-label={`Rated ${product.ratings || 0} out of 5`}
                      >
                        <div className="wl-stars" aria-hidden="true">
                          {[...Array(5)].map((_, i) => (
                            <FiStar
                              key={i}
                              className={i < Math.floor(Number(product.ratings) || 0) ? 'wl-star--filled' : ''}
                            />
                          ))}
                        </div>
                        <span className="wl-item-reviews">
                          ({product.numOfReviews || 0})
                        </span>
                      </div>

                      {/* Price */}
                      <div className="wl-item-price">
                        <span className="wl-price-current">
                          {formatPrice(current, currency)}
                        </span>
                        {original && (
                          <span className="wl-price-original">
                            {formatPrice(original, currency)}
                          </span>
                        )}
                      </div>

                      {/* Stock */}
                      <span className={`wl-item-stock ${stock > 0 ? 'wl-stock--in' : 'wl-stock--out'}`}>
                        {stock > 0 ? `In stock — ${stock} left` : 'Out of stock'}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="wl-item-actions">
                      {stock > 0 ? (
                        <button
                          className="wl-btn wl-btn--cart"
                          onClick={() => handleMoveToCart(product._id)}
                          disabled={busy}
                          aria-label={`Move ${product.name} to cart`}
                        >
                          <FiShoppingCart />
                          <span>{isMoving ? 'Moving…' : 'Move to cart'}</span>
                        </button>
                      ) : (
                        <button className="wl-btn wl-btn--oos" disabled>
                          <FiPackage />
                          <span>Out of stock</span>
                        </button>
                      )}

                      <button
                        className="wl-btn wl-btn--remove"
                        onClick={() => handleRemoveItem(product._id)}
                        disabled={busy}
                        aria-label={`Remove ${product.name} from wishlist`}
                      >
                        <FiTrash2 />
                        <span>{isRemoving ? 'Removing…' : 'Remove'}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      {/* ── Clear confirm modal ── */}
      {showClearConfirm && (
        <div
          className="wl-modal-overlay"
          onClick={() => setShowClearConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Clear wishlist confirmation"
        >
          <div className="wl-modal" onClick={e => e.stopPropagation()}>
            <button
              className="wl-modal-close"
              onClick={() => setShowClearConfirm(false)}
              aria-label="Close"
            >
              <FiX />
            </button>
            <div className="wl-modal-icon-wrap">
              <FiTrash2 className="wl-modal-icon" />
            </div>
            <h3 className="wl-modal-title">Clear your wishlist?</h3>
            <p className="wl-modal-body">
              All {count} saved {count === 1 ? 'item' : 'items'} will be removed.
              This cannot be undone.
            </p>
            <div className="wl-modal-actions">
              <button
                className="wl-modal-btn wl-modal-btn--cancel"
                onClick={() => setShowClearConfirm(false)}
              >
                Keep items
              </button>
              <button
                className="wl-modal-btn wl-modal-btn--confirm"
                onClick={handleClearAll}
              >
                Yes, clear all
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