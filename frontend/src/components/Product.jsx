import React, { useState } from 'react';
import '../componentStyles/Product.css';
import { Link, useNavigate } from 'react-router-dom';
import Rating from './Rating';
import { useDispatch, useSelector } from 'react-redux';
import { addToWishlist, removeFromWishlist, getWishlist } from '../features/wishlist/wishlistSlice';
import { addItemsToCart } from '../features/cart/cartSlice';
import { toast } from 'react-toastify';
import { FiHeart, FiEye, FiShoppingCart, FiStar } from 'react-icons/fi';

function Product({ product, hideNewBadge = false, onQuickAdd, showQuickActions = true }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);
  
  const { items: wishlistItems, itemLoading } = useSelector(state => state.wishlist);
  const { isAuthenticated } = useSelector(state => state.user);

  // Add safety check for product
  if (!product) {
    return null;
  }

  // ==================== HELPER FUNCTIONS ====================
  
  const getProductPrice = () => {
    return product.pricing?.regular || product.price || 0;
  };

  const getSalePrice = () => {
    return product.pricing?.sale || null;
  };

  const getProductImage = () => {
    const imageArray = product.images || product.image || [];
    return imageArray[0]?.url || '/placeholder-product.png';
  };

  const getDiscountPercentage = () => {
    const regular = getProductPrice();
    const sale = getSalePrice();
    if (sale && regular > sale) {
      return Math.round(((regular - sale) / regular) * 100);
    }
    return 0;
  };

  const getStockStatus = () => {
    const stock = product.inventory?.stock ?? product.stock ?? 0;
    return stock > 0 ? 'In Stock' : 'Out of Stock';
  };

  const formatPrice = (amount) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0
    }).format(amount);
  };

  // Check if product is in wishlist
  const isInWishlist = wishlistItems.some(
    item => item.product._id === product._id
  );

  const isWishlistLoading = itemLoading[product._id] || false;

  // ==================== HANDLERS ====================

  const handleWishlistToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      toast.info('Please login to add items to wishlist', {
        position: 'top-center',
        autoClose: 2000
      });
      navigate('/login');
      return;
    }

    try {
      if (isInWishlist) {
        await dispatch(removeFromWishlist(product._id)).unwrap();
        toast.success('Removed from wishlist', {
          position: 'top-center',
          autoClose: 2000
        });
      } else {
        await dispatch(addToWishlist(product._id)).unwrap();
        toast.success('Added to wishlist', {
          position: 'top-center',
          autoClose: 2000
        });
      }
      // Refresh wishlist to get updated data
      dispatch(getWishlist());
    } catch (error) {
      toast.error(error.message || 'Something went wrong', {
        position: 'top-center',
        autoClose: 3000
      });
    }
  };

  const handleQuickAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const stock = product.inventory?.stock ?? product.stock ?? 0;
    if (stock === 0) {
      toast.error('Product is out of stock', {
        position: 'top-center',
        autoClose: 2000
      });
      return;
    }

    if (onQuickAdd) {
      onQuickAdd(product._id);
    } else {
      dispatch(addItemsToCart({ id: product._id, quantity: 1 }));
    }
  };

  // ==================== RENDER ====================

  const price = getProductPrice();
  const salePrice = getSalePrice();
  const discount = getDiscountPercentage();
  const image = getProductImage();
  const stock = product.inventory?.stock ?? product.stock ?? 0;

  return (
    <Link to={`/product/${product._id}`} className="product_id">
      <div 
        className="ep-product-card"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Image Wrapper */}
        <div className="ep-product-image-wrapper">
          <img 
            src={image} 
            alt={product.name}
            className="ep-product-image"
          />
          
          {/* Badges */}
          <div className="ep-product-badges">
            {discount > 0 && (
              <span className="ep-badge discount">-{discount}%</span>
            )}
            {product.isNewArrival && !hideNewBadge && (
              <span className="ep-badge new">New</span>
            )}
            {product.isFeatured && (
              <span className="ep-badge featured">Featured</span>
            )}
            {stock === 0 && (
              <span className="ep-badge sold-out">Sold Out</span>
            )}
          </div>

          {/* Quick Actions */}
          {showQuickActions && (
            <div className={`ep-quick-actions ${isHovered ? 'show' : ''}`}>
              <button 
                className="ep-action-btn"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/product/${product._id}`);
                }}
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

        {/* Product Info */}
        <div className="ep-product-info">
          <h3 className="ep-product-name">{product.name}</h3>
          
          <p className="ep-product-category">{product.category}</p>

          <div className="ep-product-rating">
            <div className="ep-stars">
              {[...Array(5)].map((_, i) => (
                <FiStar 
                  key={i}
                  className={i < Math.floor(product.ratings || 0) ? 'filled' : ''}
                />
              ))}
            </div>
            <span className="ep-rating-text">
              ({product.numOfReviews || 0})
            </span>
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
              <button 
                className="ep-add-cart-btn"
                onClick={handleQuickAdd}
              >
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