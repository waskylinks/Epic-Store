import React, { useEffect, useState, useCallback } from 'react';
import '../pageStyles/ProductDetails.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';
import {
    createReviews,
    getProductDetails,
    getProductBySlug,
    removeErrors,
    removeSuccess,
    clearRedirectInfo,
    clearProduct,
} from '../features/products/productSlice';
import {
    addToWishlist,
    removeFromWishlist,
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
    const [comment, setComment]       = useState('');
    const [quantity, setQuantity]     = useState(1);
    const [userSelectedImage, setUserSelectedImage] = useState(null);
    const [selectedVariants, setSelectedVariants] = useState({});
    const [activeTab, setActiveTab]   = useState('description');

    const { loading, error, product, seo, reviewSuccess, reviewLoading, redirectInfo } = useSelector((state) => state.product);
    const { loading: cartLoading, error: cartError, success, message } = useSelector((state) => state.cart);
    const { items: wishlistItems, itemLoading } = useSelector(state => state.wishlist);
    const { isAuthenticated } = useSelector(state => state.user);

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const { id, slug } = useParams();
    const isSlugRoute = !!slug;

    // ─── Fetch product ────────────────────────────────────────────────────────
    useEffect(() => {
        if (slug) {
            dispatch(getProductBySlug(slug));
        } else if (id) {
            dispatch(getProductDetails(id));
        }
        return () => {
            dispatch(removeErrors());
            dispatch(clearProduct());
        };
    }, [dispatch, id, slug]);

    // ─── Handle 301 slug redirects ────────────────────────────────────────────
    useEffect(() => {
        if (redirectInfo?.newSlug) {
            navigate(`/products/${redirectInfo.newSlug}`, { replace: true });
            dispatch(clearRedirectInfo());
        }
    }, [redirectInfo, navigate, dispatch]);

    // ─── Inject SEO meta tags ─────────────────────────────────────────────────
    useEffect(() => {
        if (!isSlugRoute || !seo) return;

        const setMeta = (name, content, attr = 'name') => {
            if (!content) return;
            let el = document.querySelector(`meta[${attr}="${name}"]`);
            if (!el) {
                el = document.createElement('meta');
                el.setAttribute(attr, name);
                document.head.appendChild(el);
            }
            el.setAttribute('content', content);
        };

        let canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.setAttribute('rel', 'canonical');
            document.head.appendChild(canonical);
        }
        if (seo.canonical) canonical.setAttribute('href', seo.canonical);

        setMeta('robots', seo.robots?.join(', '));
        seo.openGraph?.forEach(tag => setMeta(tag.property, tag.content, 'property'));
        seo.twitter?.forEach(tag => setMeta(tag.name, tag.content));

        return () => {
            document.querySelector('link[rel="canonical"]')?.remove();
            document.querySelector('meta[name="robots"]')?.remove();
        };
    }, [seo, isSlugRoute]);

    // ─── Error / success side-effects ────────────────────────────────────────
    useEffect(() => {
        if (error) {
            toast.error(error.message || error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (cartError) {
            toast.error(cartError.message || cartError, { position: 'top-center', autoClose: 3000 });
        }
    }, [cartError]);

    useEffect(() => {
        if (success) {
            toast.success(message, { position: 'top-center', autoClose: 3000 });
            dispatch(removeMessage());
        }
    }, [dispatch, success, message]);

    // ─── Review success ───────────────────────────────────────────────────────
    useEffect(() => {
        if (reviewSuccess) {
            toast.success('Review Submitted Successfully', { position: 'top-center', autoClose: 2000 });
            dispatch(removeSuccess());
            if (slug) {
                dispatch(getProductBySlug(slug));
            } else {
                dispatch(getProductDetails(id));
            }
        }
    }, [reviewSuccess, id, slug, dispatch]);

    // ─── Wishlist derived state ───────────────────────────────────────────────
    const productId = product?._id || id;

    const isInWishlist = wishlistItems.some(wishItem => {
        const wid = wishItem.product?._id || wishItem.product;
        return wid === productId;
    });

    const isWishlistBusy = itemLoading[productId] || false;

    // ─── Handlers ─────────────────────────────────────────────────────────────
    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        if (!userRating) {
            toast.error('Please select a rating', { position: 'top-center', autoClose: 2000 });
            return;
        }
        try {
            await dispatch(createReviews({ rating: userRating, comment, productID: productId })).unwrap();
            setUserRating(0);
            setComment('');
        } catch {
            // error handled by error effect
        }
    };

    const handleWishlistToggle = useCallback(async () => {
        if (!isAuthenticated) {
            toast.info('Please login to add to wishlist', { position: 'top-center', autoClose: 2000 });
            navigate('/login');
            return;
        }
        try {
            if (isInWishlist) {
                await dispatch(removeFromWishlist(productId)).unwrap();
            } else {
                await dispatch(addToWishlist(productId)).unwrap();
            }
        } catch (err) {
            toast.error(err?.message || 'Something went wrong', { position: 'top-center', autoClose: 2000 });
        }
    }, [isAuthenticated, isInWishlist, productId, dispatch, navigate]);

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

    const addToCart = () => dispatch(addItemsToCart({ id: productId, quantity }));

    // ─── Derived image ────────────────────────────────────────────────────────
    const images        = product?.images || product?.image || [];
    const defaultImage  = images[0]?.url || '';
    const selectedImage = userSelectedImage ?? defaultImage;

    // ─── Render guards ────────────────────────────────────────────────────────
    if (loading) {
        return (<><Navbar /><Loader /><Footer /></>);
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

    // ─── Derived values ───────────────────────────────────────────────────────
    const regularPrice = product.pricing?.regular || product.price || 0;
    const salePrice    = product.pricing?.sale || null;
    const stock        = product.inventory?.stock ?? product.stock ?? 0;
    const discount     = salePrice && regularPrice > salePrice
        ? Math.round(((regularPrice - salePrice) / regularPrice) * 100) : 0;
    const pageTitle    = seo?.title || `${product.name} - Product Details`;

    const formatPrice = (amount) =>
        new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
        }).format(amount);

    return (
        <>
            <PageTitle title={pageTitle} />
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

                {/* Main grid */}
                <div className="epd-content">

                    {/* Gallery — sticky on desktop */}
                    <div className="epd-gallery">
                        <div className="epd-main-image">
                            <img src={selectedImage} alt={product.name} />
                            {discount > 0 && (
                                <div className="epd-discount-badge">−{discount}%</div>
                            )}
                        </div>
                        {images.length > 1 && (
                            <div className="epd-thumbnails">
                                {images.map((img, index) => (
                                    <div
                                        key={index}
                                        className={`epd-thumbnail ${selectedImage === img.url ? 'active' : ''}`}
                                        onClick={() => setUserSelectedImage(img.url)}
                                    >
                                        <img src={img.url} alt={`${product.name} ${index + 1}`} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Info panel */}
                    <div className="epd-info">

                        {/* Badges */}
                        {(product.isFeatured || product.isNewArrival || product.isBestseller) && (
                            <div className="epd-header">
                                {product.isFeatured   && <span className="epd-badge featured">Featured</span>}
                                {product.isNewArrival  && <span className="epd-badge new">New Arrival</span>}
                                {product.isBestseller  && <span className="epd-badge bestseller">Bestseller</span>}
                            </div>
                        )}

                        {/* Title + brand */}
                        <div>
                            <h1 className="epd-title">{product.name}</h1>
                            {product.brand && (
                                <p className="epd-brand">by <span>{product.brand}</span></p>
                            )}
                        </div>

                        {/* Rating */}
                        <div className="epd-rating-section">
                            <div className="epd-stars">
                                {[...Array(5)].map((_, i) => (
                                    <FiStar key={i} className={i < Math.floor(product.ratings || 0) ? 'filled' : ''} />
                                ))}
                            </div>
                            <span className="epd-rating-text">
                                {product.ratings?.toFixed(1) || '0.0'} &middot; {product.numOfReviews || 0}{' '}
                                {product.numOfReviews === 1 ? 'review' : 'reviews'}
                            </span>
                        </div>

                        {product.shortDescription && (
                            <p className="epd-short-description">{product.shortDescription}</p>
                        )}

                        <div className="epd-divider" />

                        {/* Price */}
                        <div className="epd-price-section">
                            {salePrice ? (
                                <>
                                    <span className="epd-price-sale">{formatPrice(salePrice)}</span>
                                    <span className="epd-price-original">{formatPrice(regularPrice)}</span>
                                    <span className="epd-save">Save {formatPrice(regularPrice - salePrice)}</span>
                                </>
                            ) : (
                                <span className="epd-price-current">{formatPrice(regularPrice)}</span>
                            )}
                        </div>

                        {/* Stock + SKU */}
                        <div className="epd-stock-section">
                            <span className={`epd-stock-status ${stock > 0 ? 'in-stock' : 'out-stock'}`}>
                                {stock > 0
                                    ? <><FiCheck /> In Stock ({stock} available)</>
                                    : <><FiX /> Out of Stock</>
                                }
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
                                                    {option.priceModifier > 0 && ` +${formatPrice(option.priceModifier)}`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Quantity + CTA */}
                        {stock > 0 && (
                            <>
                                <div className="epd-quantity">
                                    <label className="epd-quantity-label">Quantity</label>
                                    <div className="epd-quantity-controls">
                                        <button className="epd-qty-btn" onClick={decreaseQuantity}><FiMinus /></button>
                                        <input type="text" value={quantity} readOnly className="epd-qty-input" />
                                        <button className="epd-qty-btn" onClick={increaseQuantity}><FiPlus /></button>
                                    </div>
                                </div>

                                <div className="epd-actions">
                                    <button
                                        className="epd-btn epd-btn-primary"
                                        onClick={addToCart}
                                        disabled={cartLoading}
                                    >
                                        <FiShoppingCart />
                                        {cartLoading ? 'Adding…' : 'Add to Cart'}
                                    </button>
                                    <button
                                        className="epd-btn epd-btn-secondary"
                                        onClick={handleWishlistToggle}
                                        disabled={isWishlistBusy}
                                    >
                                        <FiHeart style={{
                                            fill:  isInWishlist ? '#FF6B6B' : 'none',
                                            color: isInWishlist ? '#FF6B6B' : 'currentColor',
                                        }} />
                                        {isInWishlist ? 'Saved' : 'Wishlist'}
                                    </button>
                                    <button className="epd-btn epd-btn-icon" aria-label="Share">
                                        <FiShare2 />
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Feature strip */}
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

                {/* Tabs */}
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
                                                <FiStar key={i} className={i < Math.floor(product.ratings || 0) ? 'filled' : ''} />
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
                                                placeholder="Share your experience with this product…"
                                                value={comment}
                                                onChange={(e) => setComment(e.target.value)}
                                                required
                                                rows={5}
                                            />
                                        </div>
                                        <button type="submit" className="epd-submit-review" disabled={reviewLoading}>
                                            {reviewLoading ? 'Submitting…' : 'Submit Review'}
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
                                                        <FiClock />
                                                        {new Date(review.createdAt).toLocaleDateString()}
                                                    </span>
                                                </div>
                                                <div className="epd-review-rating">
                                                    {[...Array(5)].map((_, i) => (
                                                        <FiStar key={i} className={i < review.rating ? 'filled' : ''} />
                                                    ))}
                                                </div>
                                                <p className="epd-review-comment">{review.comment}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="epd-no-reviews">
                                            No reviews yet. Be the first to review this product!
                                        </p>
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