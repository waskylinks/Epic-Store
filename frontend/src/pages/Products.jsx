import React, { useEffect, useState } from 'react';
import '../pageStyles/Products.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { getProduct, removeErrors } from '../features/products/productSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
    FiGrid, FiList, FiFilter, FiX, FiChevronDown, 
    FiStar, FiShoppingCart, FiHeart, FiEye,
    FiPackage, FiTrendingUp, FiDollarSign, FiTag
} from 'react-icons/fi';
import { addItemsToCart, removeMessage } from '../features/cart/cartSlice';

function Products() {
    const { loading, error, products, resultsPerPage, productCount, totalPages } = useSelector(state => state.product);
    const { success: cartSuccess, message: cartMessage } = useSelector(state => state.cart);
    const dispatch = useDispatch();

    const location = useLocation();
    const navigate = useNavigate();
    const searchParams = new URLSearchParams(location.search);
    
    const keyword = searchParams.get('keyword');
    const pageFromURL = parseInt(searchParams.get('page'), 10) || 1;
    const categoryFromURL = searchParams.get('category');

    const [currentPage, setCurrentPage] = useState(pageFromURL);
    const [viewMode, setViewMode] = useState('grid');
    const [selectedCategory, setSelectedCategory] = useState(categoryFromURL || '');
    const [sortBy, setSortBy] = useState('newest');
    const [priceRange, setPriceRange] = useState({ min: '', max: '' });
    const [showFilters, setShowFilters] = useState(false);
    const [hoveredProduct, setHoveredProduct] = useState(null);

    const categories = [
        { id: 'all', name: 'All Products', icon: <FiPackage /> },
        { id: 'Electronics', name: 'Electronics', icon: <FiPackage /> },
        { id: 'Clothing & Apparel', name: 'Clothing & Apparel', icon: <FiTag /> },
        { id: 'Home & Living', name: 'Home & Living', icon: <FiPackage /> },
        { id: 'Sports & Outdoors', name: 'Sports & Outdoors', icon: <FiTrendingUp /> },
        { id: 'Beauty & Personal Care', name: 'Beauty & Personal Care', icon: <FiPackage /> },
        { id: 'Books & Media', name: 'Books & Media', icon: <FiPackage /> },
        { id: 'Food & Beverages', name: 'Food & Beverages', icon: <FiPackage /> }
    ];

    const sortOptions = [
        { value: 'newest', label: 'Newest First' },
        { value: 'price-low', label: 'Price: Low to High' },
        { value: 'price-high', label: 'Price: High to Low' },
        { value: 'rating', label: 'Highest Rated' },
        { value: 'popular', label: 'Most Popular' }
    ];

    useEffect(() => {
        dispatch(getProduct({ keyword, page: currentPage, category: selectedCategory }));
    }, [dispatch, keyword, currentPage, selectedCategory]);

    useEffect(() => {
        if (error) {
            toast.error(error.message, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (cartSuccess) {
            toast.success(cartMessage, { position: 'top-center', autoClose: 2000 });
            dispatch(removeMessage());
        }
    }, [cartSuccess, cartMessage, dispatch]);

    const handleCategoryClick = (category) => {
        const catId = category === 'all' ? '' : category;
        setSelectedCategory(catId);
        setCurrentPage(1);
        
        const newSearchParams = new URLSearchParams(location.search);
        if (catId) {
            newSearchParams.set('category', catId);
        } else {
            newSearchParams.delete('category');
        }
        newSearchParams.delete('page');
        navigate(`?${newSearchParams.toString()}`);
    };

    const handlePageChange = (page) => {
        if (page !== currentPage) {
            setCurrentPage(page);
            const newSearchParams = new URLSearchParams(location.search);
            if (page === 1) {
                newSearchParams.delete('page');
            } else {
                newSearchParams.set('page', page);
            }
            navigate(`?${newSearchParams.toString()}`);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const getProductPrice = (product) => {
        return product.pricing?.regular || product.price || 0;
    };

    const getSalePrice = (product) => {
        return product.pricing?.sale || null;
    };

    const getProductImage = (product) => {
        const images = product.images || product.image || [];
        return images[0]?.url || '/placeholder-product.png';
    };

    const getDiscountPercentage = (product) => {
        const regular = getProductPrice(product);
        const sale = getSalePrice(product);
        if (sale && regular > sale) {
            return Math.round(((regular - sale) / regular) * 100);
        }
        return 0;
    };

    const getStockStatus = (product) => {
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

    const handleQuickAdd = (productId) => {
        dispatch(addItemsToCart({ id: productId, quantity: 1 }));
    };

    const getSortedProducts = () => {
        if (!products || products.length === 0) return [];
        
        let sorted = [...products];
        
        switch (sortBy) {
            case 'price-low':
                sorted.sort((a, b) => getProductPrice(a) - getProductPrice(b));
                break;
            case 'price-high':
                sorted.sort((a, b) => getProductPrice(b) - getProductPrice(a));
                break;
            case 'rating':
                sorted.sort((a, b) => (b.ratings || 0) - (a.ratings || 0));
                break;
            case 'popular':
                sorted.sort((a, b) => (b.analytics?.purchases || 0) - (a.analytics?.purchases || 0));
                break;
            default:
                sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        
        return sorted;
    };

    const sortedProducts = getSortedProducts();

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <PageTitle title={keyword ? `Search: ${keyword}` : 'All Products'} />
            <Navbar />

            <div className="ep-container">
                {/* Header */}
                <div className="ep-header">
                    <div className="ep-header-content">
                        <h1 className="ep-title">
                            {keyword ? `Search Results for "${keyword}"` : 'Our Products'}
                        </h1>
                        <p className="ep-subtitle">
                            {productCount} {productCount === 1 ? 'product' : 'products'} found
                        </p>
                    </div>
                </div>

                <div className="ep-content">
                    {/* Sidebar Filters */}
                    <aside className={`ep-sidebar ${showFilters ? 'show' : ''}`}>
                        <div className="ep-sidebar-header">
                            <h3 className="ep-sidebar-title">
                                <FiFilter /> Filters
                            </h3>
                            <button 
                                className="ep-sidebar-close"
                                onClick={() => setShowFilters(false)}
                            >
                                <FiX />
                            </button>
                        </div>

                        {/* Categories */}
                        <div className="ep-filter-section">
                            <h4 className="ep-filter-title">Categories</h4>
                            <div className="ep-category-list">
                                {categories.map(cat => (
                                    <button
                                        key={cat.id}
                                        className={`ep-category-btn ${selectedCategory === (cat.id === 'all' ? '' : cat.id) ? 'active' : ''}`}
                                        onClick={() => handleCategoryClick(cat.id)}
                                    >
                                        {cat.icon}
                                        <span>{cat.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Price Range */}
                        <div className="ep-filter-section">
                            <h4 className="ep-filter-title">Price Range</h4>
                            <div className="ep-price-inputs">
                                <input
                                    type="number"
                                    className="ep-price-input"
                                    placeholder="Min"
                                    value={priceRange.min}
                                    onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
                                />
                                <span className="ep-price-separator">-</span>
                                <input
                                    type="number"
                                    className="ep-price-input"
                                    placeholder="Max"
                                    value={priceRange.max}
                                    onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Clear Filters */}
                        <button 
                            className="ep-clear-filters"
                            onClick={() => {
                                setSelectedCategory('');
                                setPriceRange({ min: '', max: '' });
                                handleCategoryClick('all');
                            }}
                        >
                            Clear All Filters
                        </button>
                    </aside>

                    {/* Main Content */}
                    <div className="ep-main">
                        {/* Toolbar */}
                        <div className="ep-toolbar">
                            <button 
                                className="ep-filter-toggle"
                                onClick={() => setShowFilters(!showFilters)}
                            >
                                <FiFilter /> Filters
                            </button>

                            <div className="ep-toolbar-right">
                                <select
                                    className="ep-sort-select"
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value)}
                                >
                                    {sortOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>

                                <div className="ep-view-toggle">
                                    <button
                                        className={`ep-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                                        onClick={() => setViewMode('grid')}
                                    >
                                        <FiGrid />
                                    </button>
                                    <button
                                        className={`ep-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                                        onClick={() => setViewMode('list')}
                                    >
                                        <FiList />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Products Grid/List */}
                        {sortedProducts.length > 0 ? (
                            <div className={`ep-products ${viewMode}`}>
                                {sortedProducts.map((product) => {
                                    const price = getProductPrice(product);
                                    const salePrice = getSalePrice(product);
                                    const discount = getDiscountPercentage(product);
                                    const image = getProductImage(product);
                                    const stock = product.inventory?.stock ?? product.stock ?? 0;

                                    return (
                                        <div 
                                            key={product._id} 
                                            className="ep-product-card"
                                            onMouseEnter={() => setHoveredProduct(product._id)}
                                            onMouseLeave={() => setHoveredProduct(null)}
                                        >
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
                                                    {product.isNewArrival && (
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
                                                <div className={`ep-quick-actions ${hoveredProduct === product._id ? 'show' : ''}`}>
                                                    <button 
                                                        className="ep-action-btn"
                                                        onClick={() => navigate(`/product/${product._id}`)}
                                                        title="View Details"
                                                    >
                                                        <FiEye />
                                                    </button>
                                                    <button 
                                                        className="ep-action-btn"
                                                        title="Add to Wishlist"
                                                    >
                                                        <FiHeart />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="ep-product-info">
                                                <h3 className="ep-product-name">
                                                    {product.name}
                                                </h3>
                                                
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
                                                        {getStockStatus(product)}
                                                    </span>
                                                    
                                                    {stock > 0 && (
                                                        <button 
                                                            className="ep-add-cart-btn"
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
                            <div className="ep-empty-state">
                                <FiPackage className="ep-empty-icon" />
                                <h3>No Products Found</h3>
                                <p>
                                    {keyword 
                                        ? `No products match your search for "${keyword}"`
                                        : 'No products available in this category'
                                    }
                                </p>
                            </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="ep-pagination">
                                <button
                                    className="ep-page-btn"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage === 1}
                                >
                                    Previous
                                </button>

                                <div className="ep-page-numbers">
                                    {[...Array(totalPages)].map((_, index) => {
                                        const page = index + 1;
                                        return (
                                            <button
                                                key={page}
                                                className={`ep-page-number ${currentPage === page ? 'active' : ''}`}
                                                onClick={() => handlePageChange(page)}
                                            >
                                                {page}
                                            </button>
                                        );
                                    })}
                                </div>

                                <button
                                    className="ep-page-btn"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Mobile Filter Overlay */}
            {showFilters && (
                <div 
                    className="ep-sidebar-overlay"
                    onClick={() => setShowFilters(false)}
                />
            )}

            <Footer />
        </>
    );
}

export default Products;