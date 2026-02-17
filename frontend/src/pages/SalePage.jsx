import React, { useState, useEffect } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../pageStyles/SalePage.css';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { getProduct } from '../features/products/productSlice';
import { addItemsToCart } from '../features/cart/cartSlice';
import { 
    FiPercent, FiChevronRight, FiShoppingCart, FiHeart,
    FiTrendingUp, FiBarChart2, FiClock, FiTag,
    FiFilter, FiGrid, FiList, FiStar, FiPackage
} from 'react-icons/fi';
import { toast } from 'react-toastify';

function SalePage() {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const { products, loading } = useSelector(state => state.product);
    
    const [viewMode, setViewMode] = useState('grid');
    const [sortBy, setSortBy] = useState('discount');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [priceFilter, setPriceFilter] = useState('all');

    useEffect(() => {
        dispatch(getProduct({ keyword: '', page: 1, category: '' }));
    }, [dispatch]);

    const categories = [
        'All Categories',
        'Electronics',
        'Clothing & Apparel',
        'Home & Living',
        'Sports & Outdoors',
        'Beauty & Personal Care',
        'Books & Media',
        'Food & Beverages'
    ];

    // Get products with sales/discounts
    const getSaleProducts = () => {
        if (!products || products.length === 0) return [];
        
        return products.filter(product => {
            const hasDiscount = product.pricing?.sale && product.pricing.sale < product.pricing.regular;
            const isOnSale = product.isOnSale;
            return hasDiscount || isOnSale;
        }).map(product => {
            const regular = product.pricing?.regular || product.price || 0;
            const sale = product.pricing?.sale || product.price || 0;
            const discount = regular > sale ? Math.round(((regular - sale) / regular) * 100) : 0;
            
            return {
                ...product,
                discount,
                savings: regular - sale
            };
        });
    };

    const saleProducts = getSaleProducts();

    // Apply filters and sorting
    const getFilteredProducts = () => {
        let filtered = [...saleProducts];

        // Category filter
        if (categoryFilter && categoryFilter !== 'All Categories') {
            filtered = filtered.filter(p => p.category === categoryFilter);
        }

        // Price filter
        if (priceFilter !== 'all') {
            const [min, max] = priceFilter.split('-').map(Number);
            filtered = filtered.filter(p => {
                const price = p.pricing?.sale || p.price || 0;
                if (max) {
                    return price >= min && price <= max;
                }
                return price >= min;
            });
        }

        // Sort
        switch (sortBy) {
            case 'discount':
                filtered.sort((a, b) => b.discount - a.discount);
                break;
            case 'price-low':
                filtered.sort((a, b) => (a.pricing?.sale || a.price) - (b.pricing?.sale || b.price));
                break;
            case 'price-high':
                filtered.sort((a, b) => (b.pricing?.sale || b.price) - (a.pricing?.sale || a.price));
                break;
            case 'rating':
                filtered.sort((a, b) => (b.ratings || 0) - (a.ratings || 0));
                break;
            default:
                break;
        }

        return filtered;
    };

    const filteredProducts = getFilteredProducts();

    const handleQuickAdd = (productId) => {
        dispatch(addItemsToCart({ id: productId, quantity: 1 }));
        toast.success('Added to cart!', { position: 'top-center', autoClose: 2000 });
    };

    const formatPrice = (amount) => {
        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            minimumFractionDigits: 0
        }).format(amount);
    };

    // Calculate statistics
    const totalSavings = saleProducts.reduce((sum, p) => sum + p.savings, 0);
    const avgDiscount = saleProducts.length > 0
        ? (saleProducts.reduce((sum, p) => sum + p.discount, 0) / saleProducts.length).toFixed(0)
        : 0;
    const maxDiscount = saleProducts.length > 0
        ? Math.max(...saleProducts.map(p => p.discount))
        : 0;

    return (
        <>
            <PageTitle title="Sale & Discounts - Epic Store" />
            <Navbar />

            <div className="sale-page">
                {/* Breadcrumb & Header */}
                <div className="sale-breadcrumb">
                    <button onClick={() => navigate('/')}>Home</button>
                    <FiChevronRight />
                    <span>Sale & Discounts</span>
                </div>

                <div className="sale-header-section">
                    <div className="sale-header-content">
                        <div className="sale-header-badge">
                            <FiPercent /> ACTIVE SALES
                        </div>
                        <h1 className="sale-main-title">Current Sales & Discounts</h1>
                        <p className="sale-main-subtitle">
                            {saleProducts.length} products currently on sale with discounts up to {maxDiscount}%
                        </p>
                    </div>

                    {/* Sale Stats */}
                    <div className="sale-stats-grid">
                        <div className="sale-stat-card">
                            <div className="sale-stat-icon">
                                <FiTag />
                            </div>
                            <div className="sale-stat-content">
                                <h3>{saleProducts.length}</h3>
                                <p>Products on Sale</p>
                            </div>
                        </div>
                        <div className="sale-stat-card">
                            <div className="sale-stat-icon">
                                <FiPercent />
                            </div>
                            <div className="sale-stat-content">
                                <h3>Up to {maxDiscount}%</h3>
                                <p>Maximum Discount</p>
                            </div>
                        </div>
                        <div className="sale-stat-card">
                            <div className="sale-stat-icon">
                                <FiTrendingUp />
                            </div>
                            <div className="sale-stat-content">
                                <h3>{avgDiscount}%</h3>
                                <p>Average Savings</p>
                            </div>
                        </div>
                        <div className="sale-stat-card">
                            <div className="sale-stat-icon">
                                <FiBarChart2 />
                            </div>
                            <div className="sale-stat-content">
                                <h3>{formatPrice(totalSavings)}</h3>
                                <p>Total Savings Available</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="sale-container">
                    {/* Filters & Toolbar */}
                    <div className="sale-toolbar">
                        <div className="sale-filters">
                            <select
                                className="sale-filter-select"
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                            >
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>

                            <select
                                className="sale-filter-select"
                                value={priceFilter}
                                onChange={(e) => setPriceFilter(e.target.value)}
                            >
                                <option value="all">All Prices</option>
                                <option value="0-10000">Under ₦10,000</option>
                                <option value="10000-50000">₦10,000 - ₦50,000</option>
                                <option value="50000-100000">₦50,000 - ₦100,000</option>
                                <option value="100000">Above ₦100,000</option>
                            </select>

                            <select
                                className="sale-filter-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                            >
                                <option value="discount">Highest Discount</option>
                                <option value="price-low">Price: Low to High</option>
                                <option value="price-high">Price: High to Low</option>
                                <option value="rating">Highest Rated</option>
                            </select>
                        </div>

                        <div className="sale-view-toggle">
                            <button
                                className={`sale-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                                onClick={() => setViewMode('grid')}
                            >
                                <FiGrid />
                            </button>
                            <button
                                className={`sale-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                                onClick={() => setViewMode('list')}
                            >
                                <FiList />
                            </button>
                        </div>
                    </div>

                    {/* Products Display */}
                    {filteredProducts.length > 0 ? (
                        <div className={`sale-products ${viewMode}`}>
                            {filteredProducts.map((product) => {
                                const images = product.images || product.image || [];
                                const image = images[0]?.url || '/placeholder.png';
                                const regular = product.pricing?.regular || product.price || 0;
                                const sale = product.pricing?.sale || product.price || 0;
                                const stock = product.inventory?.stock ?? product.stock ?? 0;

                                return (
                                    <div key={product._id} className="sale-product-card">
                                        <div className="sale-product-image">
                                            <img src={image} alt={product.name} />
                                            <div className="sale-product-badges">
                                                <span className="sale-discount-badge">
                                                    -{product.discount}%
                                                </span>
                                                {product.isFeatured && (
                                                    <span className="sale-featured-badge">Featured</span>
                                                )}
                                            </div>
                                            <div className="sale-product-actions">
                                                <button
                                                    className="sale-action-btn"
                                                    onClick={() => navigate(product.slug ? `/products/${product.slug}` : `/product/${product._id}`)}
                                                    title="View Details"
                                                >
                                                    <FiPackage />
                                                </button>
                                                <button
                                                    className="sale-action-btn"
                                                    title="Add to Wishlist"
                                                >
                                                    <FiHeart />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="sale-product-info">
                                            <p className="sale-product-category">{product.category}</p>
                                            <h3 className="sale-product-name">{product.name}</h3>

                                            <div className="sale-product-rating">
                                                <div className="sale-stars">
                                                    {[...Array(5)].map((_, i) => (
                                                        <FiStar
                                                            key={i}
                                                            className={i < Math.floor(product.ratings || 0) ? 'filled' : ''}
                                                        />
                                                    ))}
                                                </div>
                                                <span>({product.numOfReviews || 0})</span>
                                            </div>

                                            <div className="sale-product-pricing">
                                                <div className="sale-prices">
                                                    <span className="sale-price">{formatPrice(sale)}</span>
                                                    <span className="sale-original">{formatPrice(regular)}</span>
                                                </div>
                                                <div className="sale-savings">
                                                    Save {formatPrice(product.savings)}
                                                </div>
                                            </div>

                                            <div className="sale-product-footer">
                                                <span className={`sale-stock ${stock > 0 ? 'in' : 'out'}`}>
                                                    {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                                                </span>
                                                {stock > 0 && (
                                                    <button
                                                        className="sale-add-cart"
                                                        onClick={() => handleQuickAdd(product._id)}
                                                    >
                                                        <FiShoppingCart /> Add
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="sale-empty">
                            <FiTag className="sale-empty-icon" />
                            <h3>
                                {saleProducts.length === 0 
                                    ? 'No Active Sales' 
                                    : 'No Products Match Your Filters'}
                            </h3>
                            <p>
                                {saleProducts.length === 0
                                    ? 'Check back soon for amazing deals and discounts'
                                    : 'Try adjusting your filters to see more products'}
                            </p>
                            <button
                                className="sale-empty-btn"
                                onClick={() => {
                                    setCategoryFilter('All Categories');
                                    setPriceFilter('all');
                                }}
                            >
                                Clear Filters
                            </button>
                        </div>
                    )}

                    {/* Discount Distribution Analytics */}
                    {saleProducts.length > 0 && (
                        <div className="sale-analytics">
                            <h2 className="sale-analytics-title">
                                <FiBarChart2 /> Discount Distribution
                            </h2>
                            <div className="sale-analytics-grid">
                                {categories.slice(1).map((category) => {
                                    const categoryProducts = saleProducts.filter(p => p.category === category);
                                    const avgCategoryDiscount = categoryProducts.length > 0
                                        ? (categoryProducts.reduce((sum, p) => sum + p.discount, 0) / categoryProducts.length).toFixed(0)
                                        : 0;
                                    const categorySavings = categoryProducts.reduce((sum, p) => sum + p.savings, 0);

                                    if (categoryProducts.length === 0) return null;

                                    return (
                                        <div key={category} className="sale-analytics-item">
                                            <h4>{category}</h4>
                                            <div className="sale-analytics-stats">
                                                <div className="sale-analytics-stat">
                                                    <span className="label">Products:</span>
                                                    <span className="value">{categoryProducts.length}</span>
                                                </div>
                                                <div className="sale-analytics-stat">
                                                    <span className="label">Avg Discount:</span>
                                                    <span className="value">{avgCategoryDiscount}%</span>
                                                </div>
                                                <div className="sale-analytics-stat">
                                                    <span className="label">Total Savings:</span>
                                                    <span className="value">{formatPrice(categorySavings)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Sale Information */}
                    <div className="sale-info-section">
                        <div className="sale-info-card">
                            <FiClock className="sale-info-icon" />
                            <h3>Limited Time Offers</h3>
                            <p>All sale prices are subject to availability and may end without notice. Shop now to secure the best deals.</p>
                        </div>
                        <div className="sale-info-card">
                            <FiTag className="sale-info-icon" />
                            <h3>Price Match Guarantee</h3>
                            <p>Found a lower price elsewhere? We'll match it. Our sale prices are already the best in the market.</p>
                        </div>
                        <div className="sale-info-card">
                            <FiPackage className="sale-info-icon" />
                            <h3>Free Shipping on Sale Items</h3>
                            <p>Get free shipping on all sale orders over ₦50,000. No code needed, discount applied at checkout.</p>
                        </div>
                    </div>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default SalePage;