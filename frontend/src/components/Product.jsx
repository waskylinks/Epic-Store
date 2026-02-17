import React, { useState } from 'react';
import '../componentStyles/Product.css';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { addToWishlist, removeFromWishlist, getWishlist } from '../features/products/wishlistSlice';
import { addItemsToCart } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import { FiHeart, FiEye, FiShoppingCart, FiStar } from 'react-icons/fi';

function Product({ product, hideNewBadge = false, onQuickAdd, showQuickActions = true }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);

  const { items: wishlistItems, itemLoading } = useSelector(state => state.wishlist);
  const { isAuthenticated } = useSelector(state => state.user);

  if (!product) return null;

  // ── Helpers ──────────────────────────────────────────────
  const getProductPrice  = () => product.pricing?.regular || product.price || 0;
  const getSalePrice     = () => product.pricing?.sale || null;
  const getProductImage  = () => {
    const arr = product.images || product.image || [];
    const primary = arr.find(img => img.isPrimary) || arr[0];
    return primary?.url || '/placeholder-product.png';
  };
  const getDiscountPercentage = () => {
    const regular = getProductPrice();
    const sale = getSalePrice();
    return sale && regular > sale ? Math.round(((regular - sale) / regular) * 100) : 0;
  };
  const getStockStatus = () => {
    const stock = product.inventory?.stock ?? product.stock ?? 0;
    return stock > 0 ? 'In Stock' : 'Out of Stock';
  };

  const formatPrice = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',        // ← USD
    minimumFractionDigits: 2
  }).format(amount);
};

  // Prefer slug-based URL, fall back to ID for legacy products
  const productUrl = product.slug
    ? `/products/${product.slug}`
    : `/product/${product._id}`;

  const isInWishlist = wishlistItems.some(item => {
    const wid = item.product?._id || item.product;
    return wid === product._id;
  });
  const isWishlistLoading = itemLoading[product._id] || false;

  // ── Handlers ─────────────────────────────────────────────
  const handleWishlistToggle = async (e) => {
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
        toast.success('Removed from wishlist', { position: 'top-center', autoClose: 2000 });
      } else {
        await dispatch(addToWishlist(product._id)).unwrap();
        toast.success('Added to wishlist', { position: 'top-center', autoClose: 2000 });
      }
      dispatch(getWishlist());
    } catch (err) {
      toast.error(err.message || 'Something went wrong', { position: 'top-center', autoClose: 3000 });
    }
  };

  const handleQuickAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const stock = product.inventory?.stock ?? product.stock ?? 0;
    if (stock === 0) {
      toast.error('Product is out of stock', { position: 'top-center', autoClose: 2000 });
      return;
    }
    if (onQuickAdd) {
      onQuickAdd(product._id);
    } else {
      dispatch(addItemsToCart({ id: product._id, quantity: 1 }));
    }
  };

  // ── Derived values ───────────────────────────────────────
  const price    = getProductPrice();
  const salePrice = getSalePrice();
  const discount = getDiscountPercentage();
  const image    = getProductImage();
  const stock    = product.inventory?.stock ?? product.stock ?? 0;

  return (
    <Link to={productUrl} className="product_id">
      <div
        className="ep-product-card"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="ep-product-image-wrapper">
          <img src={image} alt={product.name} className="ep-product-image" />

          <div className="ep-product-badges">
            {discount > 0 && <span className="ep-badge discount">-{discount}%</span>}
            {product.isNewArrival && !hideNewBadge && <span className="ep-badge new">New</span>}
            {product.isFeatured && <span className="ep-badge featured">Featured</span>}
            {product.isBestseller && <span className="ep-badge bestseller">Bestseller</span>}
            {stock === 0 && <span className="ep-badge sold-out">Sold Out</span>}
          </div>

          {showQuickActions && (
            <div className={`ep-quick-actions ${isHovered ? 'show' : ''}`}>
              <button
                className="ep-action-btn"
                onClick={(e) => { e.preventDefault(); navigate(productUrl); }}
                title="View Details"
              >
                <FiEye />
              </button>
              <button
                className={`ep-action-btn ${isInWishlist ? 'active' : ''}`}
                onClick={handleWishlistToggle}
                disabled={isWishlistLoading}
                title={isInWishlist ? 'Remove from Wishlist' : 'Add to Wishlist'}
              >
                <FiHeart className={isInWishlist ? 'filled' : ''} />
              </button>
            </div>
          )}
        </div>

        <div className="ep-product-info">
          <h3 className="ep-product-name">{product.name}</h3>
          {product.brand && <p className="ep-product-brand">{product.brand}</p>}
          <p className="ep-product-category">{product.category}</p>

          <div className="ep-product-rating">
            <div className="ep-stars">
              {[...Array(5)].map((_, i) => (
                <FiStar key={i} className={i < Math.floor(product.ratings || 0) ? 'filled' : ''} />
              ))}
            </div>
            <span className="ep-rating-text">({product.numOfReviews || 0})</span>
          </div>

          <div className="ep-product-price">
            {salePrice ? (
              <>
                <span className="ep-price-sale">{formatPrice(salePrice)}</span>
                <span className="ep-price-original">{formatPrice(price)}</span>
              </>
            ) : (
              <span className="ep-price-current">{formatPrice(price)}</span>
            )}
          </div>

          <div className="ep-product-footer">
            <span className={`ep-stock-status ${stock > 0 ? 'in-stock' : 'out-stock'}`}>
              {getStockStatus()}
            </span>
            {stock > 0 && (
              <button className="ep-add-cart-btn" onClick={handleQuickAdd}>
                <FiShoppingCart /> Add
              </button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default Product;