import React, { useEffect, useState } from 'react';
import '../pageStyles/ProductDetails.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';
import { createReviews, getProductDetails, removeErrors, removeSuccess } from '../features/products/productSlice';
import { 
    addToWishlist, 
    removeFromWishlist, 
    getWishlist,
    optimisticAdd,
    optimisticRemove
} from '../features/products/wishlistSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { addItemsToCart, removeMessage } from '../features/cart/cartSlice';
import { 
    FiStar, FiShoppingCart, FiHeart, FiShare2, 
    FiCheck, FiX, FiTruck, FiShield, FiRefreshCw,
    FiPackage, FiMinus, FiPlus, FiChevronRight,
    FiClock, FiAward, FiMessageSquare
} from 'react-icons/fi';

function ProductDetails() {
    const [userRating, setUserRating] = useState(0);
    const [comment, setComment] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [selectedImage, setSelectedImage] = useState('');
    const [selectedVariants, setSelectedVariants] = useState({});
    const [activeTab, setActiveTab] = useState('description');

    const { loading, error, product, reviewSuccess, reviewLoading } = useSelector((state) => state.product);
    const { loading: cartLoading, error: cartError, success, message } = useSelector((state) => state.cart);
    const { items: wishlistItems, itemLoading } = useSelector(state => state.wishlist);
    const { isAuthenticated } = useSelector(state => state.user);

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { id } = useParams();

    // Fetch wishlist on mount
    useEffect(() => {
        if (isAuthenticated) {
            dispatch(getWishlist());
        }
    }, [dispatch, isAuthenticated]);

    // Check if current product is in wishlist
    const isInWishlist = wishlistItems.some(
        wishItem => {
            const wishlistProductId = wishItem.product?._id || wishItem.product;
            return wishlistProductId === id;
        }
    );

    const isWishlistLoading = itemLoading[id] || false;

    const formatPrice = (amount) => {
        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const handleReviewSubmit = (e) => {
        e.preventDefault();
        if (!userRating) {
            toast.error('Please select a rating', { position: 'top-center', autoClose: 2000 });
            return;
        }
        dispatch(createReviews({
            rating: userRating,
            comment,
            productID: id
        }));
    };

    // Handle wishlist toggle - OPTIMISTIC UPDATE for instant feedback
    const handleWishlistToggle = async () => {
        if (!isAuthenticated) {
            toast.info('Please login to add to wishlist', {
                position: 'top-center',
                autoClose: 2000
            });
            navigate('/login');
            return;
        }

        if (isInWishlist) {
            // OPTIMISTIC: Remove immediately from UI
            dispatch(optimisticRemove(id));
            
            // Then sync with server in background
            try {
                await dispatch(removeFromWishlist(id)).unwrap();
            } catch (error) {
                // If server fails, add it back (rollback)
                dispatch(optimisticAdd({ 
                    _id: id,
                    name: product.name,
                    images: product.images || product.image || [],
                    price: product.price,
                    pricing: product.pricing,
                    category: product.category
                }));
                toast.error('Failed to remove from wishlist', {
                    position: 'top-center',
                    autoClose: 2000
                });
            }
        } else {
            // OPTIMISTIC: Add immediately to UI
            dispatch(optimisticAdd({ 
                _id: id,
                name: product.name,
                images: product.images || product.image || [],
                price: product.price,
                pricing: product.pricing,
                category: product.category,
                ratings: product.ratings,
                numOfReviews: product.numOfReviews,
                inventory: product.inventory,
                stock: product.stock
            }));
            
            // Then sync with server in background
            try {
                await dispatch(addToWishlist(id)).unwrap();
            } catch (error) {
                // If server fails, remove it (rollback)
                dispatch(optimisticRemove(id));
                toast.error('Failed to add to wishlist', {
                    position: 'top-center',
                    autoClose: 2000
                });
            }
        }
    };

    useEffect(() => {
        if (reviewSuccess) {
            toast.success('Review Submitted Successfully', { position: 'top-center', autoClose: 2000 });
            setUserRating(0);
            setComment('');
            dispatch(removeSuccess());
            dispatch(getProductDetails(id));
        }
    }, [reviewSuccess, id, dispatch]);

    useEffect(() => {
        if (id) {
            dispatch(getProductDetails(id));
        }
        return () => {
            dispatch(removeErrors());
        };
    }, [dispatch, id]);

    useEffect(() => {
        if (error) {
            toast.error(error.message, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (cartError) {
            toast.error(cartError.message, { position: 'top-center', autoClose: 3000 });
        }
    }, [dispatch, cartError]);

    useEffect(() => {
        if (success) {
            toast.success(message, { position: 'top-center', autoClose: 3000 });
            dispatch(removeMessage());
        }
    }, [dispatch, success, message]);

    useEffect(() => {
        if (product) {
            const images = product.images || product.image || [];
            if (images.length > 0) {
                setSelectedImage(images[0].url);
            }
        }
    }, [product]);

    if (loading) {
        return (
            <>
                <Navbar />
                <Loader />
                <Footer />
            </>
        );
    }

    if (error || !product) {
        return (
            <>
                <PageTitle title='Product Details' />
                <Navbar />
                <div className="epd-error">
                    <FiPackage className="epd-error-icon" />
                    <h2>Product Not Found</h2>
                    <p>The product you're looking for doesn't exist or has been removed.</p>
                    <button onClick={() => navigate('/products')} className="epd-error-btn">
                        Browse Products
                    </button>
                </div>
                <Footer />
            </>
        );
    }

    const decreaseQuantity = () => {
        if (quantity <= 1) {
            toast.error('Quantity cannot be less than 1', { position: 'top-center', autoClose: 2000 });
            return;
        }
        setQuantity(qty => qty - 1);
    };

    const increaseQuantity = () => {
        const stock = product.inventory?.stock ?? product.stock ?? 0;
        if (stock <= quantity) {
            toast.error('Cannot exceed available stock', { position: 'top-center', autoClose: 2000 });
            return;
        }
        setQuantity(qty => qty + 1);
    };

    const addToCart = () => {
        dispatch(addItemsToCart({ id, quantity }));
    };

    const getProductPrice = () => product.pricing?.regular || product.price || 0;
    const getSalePrice = () => product.pricing?.sale || null;
    const getStock = () => product.inventory?.stock ?? product.stock ?? 0;
    const images = product.images || product.image || [];
    const regularPrice = getProductPrice();
    const salePrice = getSalePrice();
    const stock = getStock();
    const discount = salePrice && regularPrice > salePrice 
        ? Math.round(((regularPrice - salePrice) / regularPrice) * 100)
        : 0;

    return (
        <>
            <PageTitle title={`${product.name} - Product Details`} />
            <Navbar />

            <div className="epd-container">
                {/* Breadcrumb */}
                <div className="epd-breadcrumb">
                    <button onClick={() => navigate('/')}>Home</button>
                    <FiChevronRight />
                    <button onClick={() => navigate('/products')}>Products</button>
                    <FiChevronRight />
                    <button onClick={() => navigate(`/products?category=${product.category}`)}>
                        {product.category}
                    </button>
                    <FiChevronRight />
                    <span>{product.name}</span>
                </div>

                <div className="epd-content">
                    {/* Image Gallery */}
                    <div className="epd-gallery">
                        <div className="epd-main-image">
                            <img src={selectedImage} alt={product.name} />
                            {discount > 0 && (
                                <div className="epd-discount-badge">-{discount}%</div>
                            )}
                        </div>
                        {images.length > 1 && (
                            <div className="epd-thumbnails">
                                {images.map((img, index) => (
                                    <div
                                        key={index}
                                        className={`epd-thumbnail ${selectedImage === img.url ? 'active' : ''}`}
                                        onClick={() => setSelectedImage(img.url)}
                                    >
                                        <img src={img.url} alt={`${product.name} ${index + 1}`} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Product Info */}
                    <div className="epd-info">
                        <div className="epd-header">
                            {product.isFeatured && <span className="epd-badge featured">Featured</span>}
                            {product.isNewArrival && <span className="epd-badge new">New Arrival</span>}
                            {product.isBestseller && <span className="epd-badge bestseller">Bestseller</span>}
                        </div>

                        <h1 className="epd-title">{product.name}</h1>
                        
                        {product.brand && (
                            <p className="epd-brand">Brand: <span>{product.brand}</span></p>
                        )}

                        <div className="epd-rating-section">
                            <div className="epd-stars">
                                {[...Array(5)].map((_, i) => (
                                    <FiStar
                                        key={i}
                                        className={i < Math.floor(product.ratings || 0) ? 'filled' : ''}
                                    />
                                ))}
                            </div>
                            <span className="epd-rating-text">
                                {product.ratings?.toFixed(1) || '0.0'} ({product.numOfReviews || 0} {product.numOfReviews === 1 ? 'review' : 'reviews'})
                            </span>
                        </div>

                        {product.shortDescription && (
                            <p className="epd-short-description">{product.shortDescription}</p>
                        )}

                        <div className="epd-price-section">
                            {salePrice ? (
                                <>
                                    <span className="epd-price-sale">{formatPrice(salePrice)}</span>
                                    <span className="epd-price-original">{formatPrice(regularPrice)}</span>
                                    <span className="epd-save">You save {formatPrice(regularPrice - salePrice)}</span>
                                </>
                            ) : (
                                <span className="epd-price-current">{formatPrice(regularPrice)}</span>
                            )}
                        </div>

                        <div className="epd-stock-section">
                            <span className={`epd-stock-status ${stock > 0 ? 'in-stock' : 'out-stock'}`}>
                                {stock > 0 ? (
                                    <><FiCheck /> In Stock ({stock} available)</>
                                ) : (
                                    <><FiX /> Out of Stock</>
                                )}
                            </span>
                            {product.inventory?.sku && (
                                <span className="epd-sku">SKU: {product.inventory.sku}</span>
                            )}
                        </div>

                        {/* Variants */}
                        {product.variants && product.variants.length > 0 && (
                            <div className="epd-variants">
                                {product.variants.map((variant, vIdx) => (
                                    <div key={vIdx} className="epd-variant-group">
                                        <label className="epd-variant-label">{variant.name}</label>
                                        <div className="epd-variant-options">
                                            {variant.options.map((option, oIdx) => (
                                                <button
                                                    key={oIdx}
                                                    className={`epd-variant-btn ${selectedVariants[variant.name] === option.value ? 'active' : ''}`}
                                                    onClick={() => setSelectedVariants({ ...selectedVariants, [variant.name]: option.value })}
                                                >
                                                    {option.value}
                                                    {option.priceModifier > 0 && ` (+${formatPrice(option.priceModifier)})`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {stock > 0 && (
                            <>
                                <div className="epd-quantity">
                                    <label className="epd-quantity-label">Quantity</label>
                                    <div className="epd-quantity-controls">
                                        <button className="epd-qty-btn" onClick={decreaseQuantity}>
                                            <FiMinus />
                                        </button>
                                        <input type="text" value={quantity} readOnly className="epd-qty-input" />
                                        <button className="epd-qty-btn" onClick={increaseQuantity}>
                                            <FiPlus />
                                        </button>
                                    </div>
                                </div>

                                <div className="epd-actions">
                                    <button
                                        className="epd-btn epd-btn-primary"
                                        onClick={addToCart}
                                        disabled={cartLoading}
                                    >
                                        <FiShoppingCart /> {cartLoading ? 'Adding...' : 'Add to Cart'}
                                    </button>
                                    <button 
                                        className="epd-btn epd-btn-secondary"
                                        onClick={handleWishlistToggle}
                                        disabled={isWishlistLoading}
                                    >
                                        <FiHeart 
                                            style={{ 
                                                fill: isInWishlist ? '#ff3c3c' : 'none',
                                                color: isInWishlist ? '#ff3c3c' : 'currentColor'
                                            }}
                                        /> 
                                        {isInWishlist ? 'Saved' : 'Wishlist'}
                                    </button>
                                    <button className="epd-btn epd-btn-icon">
                                        <FiShare2 />
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Features */}
                        <div className="epd-features">
                            <div className="epd-feature">
                                <FiTruck className="epd-feature-icon" />
                                <div>
                                    <h4>Free Delivery</h4>
                                    <p>On orders over ₦50,000</p>
                                </div>
                            </div>
                            <div className="epd-feature">
                                <FiShield className="epd-feature-icon" />
                                <div>
                                    <h4>Secure Payment</h4>
                                    <p>100% secure transactions</p>
                                </div>
                            </div>
                            <div className="epd-feature">
                                <FiRefreshCw className="epd-feature-icon" />
                                <div>
                                    <h4>Easy Returns</h4>
                                    <p>30-day return policy</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Product Details Tabs */}
                <div className="epd-tabs-section">
                    <div className="epd-tabs">
                        <button
                            className={`epd-tab ${activeTab === 'description' ? 'active' : ''}`}
                            onClick={() => setActiveTab('description')}
                        >
                            Description
                        </button>
                        {product.specifications && product.specifications.length > 0 && (
                            <button
                                className={`epd-tab ${activeTab === 'specifications' ? 'active' : ''}`}
                                onClick={() => setActiveTab('specifications')}
                            >
                                Specifications
                            </button>
                        )}
                        <button
                            className={`epd-tab ${activeTab === 'reviews' ? 'active' : ''}`}
                            onClick={() => setActiveTab('reviews')}
                        >
                            Reviews ({product.numOfReviews || 0})
                        </button>
                    </div>

                    <div className="epd-tab-content">
                        {activeTab === 'description' && (
                            <div className="epd-description">
                                <h3>Product Description</h3>
                                <p>{product.description}</p>
                            </div>
                        )}

                        {activeTab === 'specifications' && product.specifications && (
                            <div className="epd-specifications">
                                <h3>Technical Specifications</h3>
                                <table className="epd-specs-table">
                                    <tbody>
                                        {product.specifications.map((spec, idx) => (
                                            <tr key={idx}>
                                                <td className="epd-spec-key">{spec.key}</td>
                                                <td className="epd-spec-value">{spec.value}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'reviews' && (
                            <div className="epd-reviews-section">
                                <div className="epd-review-summary">
                                    <div className="epd-review-score">
                                        <h2>{product.ratings?.toFixed(1) || '0.0'}</h2>
                                        <div className="epd-stars-large">
                                            {[...Array(5)].map((_, i) => (
                                                <FiStar
                                                    key={i}
                                                    className={i < Math.floor(product.ratings || 0) ? 'filled' : ''}
                                                />
                                            ))}
                                        </div>
                                        <p>{product.numOfReviews || 0} {product.numOfReviews === 1 ? 'review' : 'reviews'}</p>
                                    </div>
                                </div>

                                <div className="epd-review-form">
                                    <h3><FiMessageSquare /> Write a Review</h3>
                                    <form onSubmit={handleReviewSubmit}>
                                        <div className="epd-rating-input">
                                            <label>Your Rating</label>
                                            <div className="epd-stars-input">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <FiStar
                                                        key={star}
                                                        className={star <= userRating ? 'filled' : ''}
                                                        onClick={() => setUserRating(star)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                        <div className="epd-comment-input">
                                            <label>Your Review</label>
                                            <textarea
                                                placeholder="Share your experience with this product..."
                                                value={comment}
                                                onChange={(e) => setComment(e.target.value)}
                                                required
                                                rows={5}
                                            />
                                        </div>
                                        <button
                                            type="submit"
                                            className="epd-submit-review"
                                            disabled={reviewLoading}
                                        >
                                            {reviewLoading ? 'Submitting...' : 'Submit Review'}
                                        </button>
                                    </form>
                                </div>

                                <div className="epd-reviews-list">
                                    <h3>Customer Reviews</h3>
                                    {product.reviews && product.reviews.length > 0 ? (
                                        product.reviews.map((review, index) => (
                                            <div key={index} className="epd-review-item">
                                                <div className="epd-review-header">
                                                    <div className="epd-review-author">
                                                        <h4>{review.name}</h4>
                                                        {review.verified && (
                                                            <span className="epd-verified">
                                                                <FiAward /> Verified Purchase
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="epd-review-date">
                                                        <FiClock /> {new Date(review.createdAt).toLocaleDateString()}
                                                    </span>
                                                </div>
                                                <div className="epd-review-rating">
                                                    {[...Array(5)].map((_, i) => (
                                                        <FiStar
                                                            key={i}
                                                            className={i < review.rating ? 'filled' : ''}
                                                        />
                                                    ))}
                                                </div>
                                                <p className="epd-review-comment">{review.comment}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="epd-no-reviews">No reviews yet. Be the first to review this product!</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default ProductDetails;