import { useState, useCallback } from 'react';
import '../componentStyles/Product.css';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { addToWishlist, removeFromWishlist } from '../features/products/wishlistSlice';
import { trackWishlistAnalytics } from '../features/products/productSlice';
import { addItemsToCart } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import { FiEye, FiShoppingCart } from 'react-icons/fi';
import { FaHeart, FaRegHeart } from 'react-icons/fa';

// ── Pure helpers (outside component — no re-creation on render) ───────────────

const formatPrice = (amount, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: ['USD', 'EUR', 'GBP', 'NGN'].includes(currency) ? currency : 'USD',
    minimumFractionDigits: 2,
  }).format(amount);

const getPrimaryImage = (product) => {
  const arr = product.images || product.image || [];
  const primary = arr.find((img) => img.isPrimary) || arr[0];
  return {
    url: primary?.url || '/placeholder-product.png',
    alt: primary?.alt || product.name,
  };
};

const getStock = (product) => product.inventory?.stock ?? product.stock ?? 0;

const resolveSalePrice = (product) => {
  if (product.isOnSale && product.pricing?.sale != null) return product.pricing.sale;
  const regular = product.pricing?.regular || product.price || 0;
  const sale = product.pricing?.sale;
  return sale != null && sale < regular ? sale : null;
};

const getDiscountPct = (regular, sale) =>
  sale && regular > sale ? Math.round(((regular - sale) / regular) * 100) : 0;

const resolveStockState = (product) => {
  const status = product.inventory?.status;
  if (status === 'Discontinued') return 'discontinued';
  if (status === 'OutOfStock' || getStock(product) === 0) return 'out';
  if (status === 'LowStock') return 'low';
  return 'in';
};

// ── Component ─────────────────────────────────────────────────────────────────

function Product({
  product,
  hideNewBadge = false,
  onQuickAdd,
  showQuickActions = true,
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isHovered, setIsHovered] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);

  const { items: wishlistItems, itemLoading } = useSelector((s) => s.wishlist);
  const { isAuthenticated } = useSelector((s) => s.user);

  const currency    = product?.pricing?.currency || 'USD';
  const regular     = product?.pricing?.regular || product?.price || 0;
  const salePrice   = product ? resolveSalePrice(product) : null;
  const discount    = getDiscountPct(regular, salePrice);
  const primaryImg  = product ? getPrimaryImage(product) : { url: '/placeholder-product.png', alt: '' };
  const stockState  = product ? resolveStockState(product) : 'out';
  const stock       = product ? getStock(product) : 0;
  const isAddable   = stockState === 'in' || stockState === 'low';

  const productUrl = product?.slug
    ? `/products/${product.slug}`
    : `/product/${product?._id}`;

  // [FIX] Normalise both populated ({ product: { _id } }) and unpopulated
  // ({ product: <string id> }) wishlist item shapes when checking membership.
  const isInWishlist = wishlistItems.some((item) => {
    const wid = item.product?._id || item.product;
    return wid === product?._id;
  });

  const isWishlistBusy = itemLoading[product?._id] || false;

  const stockLabel = {
    in:           'In Stock',
    low:          `Only ${stock} left`,
    out:          'Out of Stock',
    discontinued: 'Discontinued',
  }[stockState];

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleWishlistToggle = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      toast.info('Please login to add items to wishlist', { position: 'top-center', autoClose: 2000 });
      navigate('/login');
      return;
    }

    try {
      if (isInWishlist) {
        await dispatch(removeFromWishlist(product._id)).unwrap();
      } else {
        await dispatch(addToWishlist(product._id)).unwrap();
        // [FIX] Fire analytics after confirmed server add — no getWishlist()
        // needed; the slice now pushes the item into state.items on fulfilled
        // so isInWishlist flips immediately without a round-trip.
        dispatch(trackWishlistAnalytics({ id: product._id, increment: true }));
      }
    // eslint-disable-next-line no-unused-vars
    } catch (err) {
      // Silent — only surface cart errors to avoid double-toast confusion.
      // Uncomment if you want error feedback:
      // toast.error(err?.message || 'Something went wrong', { position: 'top-center', autoClose: 3000 });
    }
  }, [isAuthenticated, isInWishlist, product, dispatch, navigate]);

  const handleQuickAdd = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAddable) {
      toast.error('This product is unavailable', { position: 'top-center', autoClose: 2000 });
      return;
    }

    if (onQuickAdd) {
      onQuickAdd(product._id);
      return;
    }

    try {
      setCartLoading(true);
      await dispatch(addItemsToCart({ id: product._id, quantity: 1 })).unwrap();
      toast.success('Added to cart', { position: 'top-center', autoClose: 2000 });
    } catch (err) {
      toast.error(err?.message || 'Could not add to cart', {
        position: 'top-center',
        autoClose: 3000,
      });
    } finally {
      setCartLoading(false);
    }
  }, [isAddable, onQuickAdd, product, dispatch]);

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!product) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Link to={productUrl} className="pc-link" aria-label={`View ${product.name}`}>
      <article
        className={`pc-card ${isHovered ? 'pc-card--hovered' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* ── Image ── */}
        <div className="pc-image-wrap">
          <img
            src={primaryImg.url}
            alt={primaryImg.alt}
            className="pc-image"
            loading="lazy"
            decoding="async"
          />

          {/* Badges */}
          <div className="pc-badges" aria-label="Product labels">
            {discount > 0 && (
              <span className="pc-badge pc-badge--discount">−{discount}%</span>
            )}
            {product.isNewArrival && !hideNewBadge && (
              <span className="pc-badge pc-badge--new">New</span>
            )}
            {product.isFeatured && (
              <span className="pc-badge pc-badge--featured">Featured</span>
            )}
            {product.isBestseller && (
              <span className="pc-badge pc-badge--bestseller">Bestseller</span>
            )}
            {stockState === 'out' && (
              <span className="pc-badge pc-badge--soldout">Sold Out</span>
            )}
            {stockState === 'discontinued' && (
              <span className="pc-badge pc-badge--discontinued">Discontinued</span>
            )}
          </div>

          {/* Quick actions overlay */}
          {showQuickActions && (
            <div
              className={`pc-actions ${isHovered ? 'pc-actions--visible' : ''}`}
              role="group"
              aria-label="Quick actions"
            >
              <button
                className="pc-action-btn"
                onClick={(e) => { e.preventDefault(); navigate(productUrl); }}
                title="View Details"
                aria-label="View product details"
              >
                <FiEye aria-hidden="true" />
              </button>

              <button
                className={`pc-action-btn pc-action-btn--wish ${isInWishlist ? 'pc-action-btn--wish-active' : ''}`}
                onClick={handleWishlistToggle}
                disabled={isWishlistBusy}
                title={isInWishlist ? 'Remove from wishlist' : 'Save to wishlist'}
                aria-label={isInWishlist ? 'Remove from wishlist' : 'Save to wishlist'}
                aria-pressed={isInWishlist}
              >
                {isInWishlist ? (
                  <FaHeart aria-hidden="true" />
                ) : (
                  <FaRegHeart aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* ── Info ── */}
        <div className="pc-info">
          {/* Brand + Category */}
          <div className="pc-meta">
            {product.brand && <span className="pc-brand">{product.brand}</span>}
            <span className="pc-category">{product.category}</span>
          </div>

          {/* Name */}
          <h3 className="pc-name">{product.name}</h3>

          {/* Rating */}
          <div className="pc-rating" aria-label={`Rated ${product.ratings || 0} out of 5`}>
            <div className="pc-stars" aria-hidden="true">
              {[...Array(5)].map((_, i) => (
                <span
                  key={i}
                  className={`pc-star ${i < Math.floor(Number(product.ratings) || 0) ? 'pc-star--filled' : ''}`}
                >
                  ★
                </span>
              ))}
            </div>
            <span className="pc-review-count">({product.numOfReviews || 0})</span>
          </div>

          {/* Price */}
          <div className="pc-price">
            {salePrice != null ? (
              <>
                <span className="pc-price-sale">{formatPrice(salePrice, currency)}</span>
                <span className="pc-price-regular">{formatPrice(regular, currency)}</span>
              </>
            ) : (
              <span className="pc-price-current">{formatPrice(regular, currency)}</span>
            )}
          </div>

          {/* Footer: stock status + add to cart */}
          <div className="pc-footer">
            <span className={`pc-stock pc-stock--${stockState}`} aria-live="polite">
              {stockState === 'low' && <span className="pc-stock-dot" aria-hidden="true" />}
              {stockLabel}
            </span>

            {isAddable && (
              <button
                className={`pc-cart-btn ${cartLoading ? 'pc-cart-btn--loading' : ''}`}
                onClick={handleQuickAdd}
                disabled={cartLoading}
                aria-label={`Add ${product.name} to cart`}
              >
                {cartLoading ? (
                  <span className="pc-spinner" aria-hidden="true" />
                ) : (
                  <>
                    <FiShoppingCart aria-hidden="true" />
                    <span>Add</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}

export default Product;