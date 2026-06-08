import React, { useEffect, useState } from 'react';
import '../pageStyles/Products.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Product from '../components/Product';
import { useDispatch, useSelector } from 'react-redux';
import { getProduct, removeErrors } from '../features/products/productSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
    FiGrid, FiList, FiFilter, FiX, FiPackage
} from 'react-icons/fi';
import { addItemsToCart, removeMessage } from '../features/cart/cartSlice';

function Products() {
    const { loading, error, products, productCount, totalPages } = useSelector(state => state.product);
    const { success: cartSuccess, message: cartMessage } = useSelector(state => state.cart);
    const dispatch = useDispatch();

    const location  = useLocation();
    const navigate  = useNavigate();
    const searchParams = new URLSearchParams(location.search);

    const keyword        = searchParams.get('keyword');
    const pageFromURL    = parseInt(searchParams.get('page'), 10) || 1;
    const categoryFromURL = searchParams.get('category');

    const [currentPage,      setCurrentPage]      = useState(pageFromURL);
    const [viewMode,         setViewMode]          = useState('grid');
    const [selectedCategory, setSelectedCategory] = useState(categoryFromURL || '');
    const [sortBy,           setSortBy]            = useState('newest');
    const [priceRange,       setPriceRange]        = useState({ min: '', max: '' });
    const [showFilters,      setShowFilters]       = useState(false);

    const categories = [
        { id: 'all',                    name: 'All Products'           },
        { id: 'Electronics',            name: 'Electronics'            },
        { id: 'Clothing & Apparel',     name: 'Clothing & Apparel'     },
        { id: 'Home & Living',          name: 'Home & Living'          },
        { id: 'Sports & Outdoors',      name: 'Sports & Outdoors'      },
        { id: 'Beauty & Personal Care', name: 'Beauty & Personal Care' },
        { id: 'Books & Media',          name: 'Books & Media'          },
        { id: 'Food & Beverages',       name: 'Food & Beverages'       },
    ];

    const sortOptions = [
        { value: 'newest',     label: 'Newest First'        },
        { value: 'price-low',  label: 'Price: Low to High'  },
        { value: 'price-high', label: 'Price: High to Low'  },
        { value: 'rating',     label: 'Highest Rated'       },
        { value: 'popular',    label: 'Most Popular'        },
    ];

    useEffect(() => {
        dispatch(getProduct({ keyword, page: currentPage, category: selectedCategory }));
    }, [dispatch, keyword, currentPage, selectedCategory]);

    useEffect(() => {
        if (error) {
            toast.error(error.message || error, { position: 'top-center', autoClose: 3000 });
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
        const p = new URLSearchParams(location.search);
        catId ? p.set('category', catId) : p.delete('category');
        p.delete('page');
        navigate(`?${p.toString()}`);
    };

    const handlePageChange = (page) => {
        if (page === currentPage) return;
        setCurrentPage(page);
        const p = new URLSearchParams(location.search);
        page === 1 ? p.delete('page') : p.set('page', page);
        navigate(`?${p.toString()}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const getProductPrice = (product) => product.pricing?.regular || product.price || 0;

    const handleQuickAdd = (productId) => dispatch(addItemsToCart({ id: productId, quantity: 1 }));

    const getSortedProducts = () => {
        if (!products || products.length === 0) return [];
        const sorted = [...products];
        switch (sortBy) {
            case 'price-low':  sorted.sort((a, b) => getProductPrice(a) - getProductPrice(b)); break;
            case 'price-high': sorted.sort((a, b) => getProductPrice(b) - getProductPrice(a)); break;
            case 'rating':     sorted.sort((a, b) => (b.ratings || 0) - (a.ratings || 0)); break;
            case 'popular':    sorted.sort((a, b) => (b.analytics?.purchases || 0) - (a.analytics?.purchases || 0)); break;
            default:           sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        return sorted;
    };

    const sortedProducts = getSortedProducts();

    if (loading) return <Loader />;

    return (
        <>
            <PageTitle title={keyword ? `Search: ${keyword}` : 'All Products'} />
            <Navbar />

            <div className="ep-container">

                {/* Header */}
                <div className="ep-header">
                    <div className="ep-header-content">
                        <h1 className="ep-title">
                            {keyword ? `Results for "${keyword}"` : 'Our Products'}
                        </h1>
                        <p className="ep-subtitle">
                            {productCount} {productCount === 1 ? 'product' : 'products'} found
                        </p>
                    </div>
                </div>

                <div className="ep-content">

                    {/* Sidebar */}
                    <aside className={`ep-sidebar ${showFilters ? 'show' : ''}`}>
                        <div className="ep-sidebar-header">
                            <h3 className="ep-sidebar-title">
                                <FiFilter /> Filters
                            </h3>
                            <button
                                className="ep-sidebar-close"
                                onClick={() => setShowFilters(false)}
                                aria-label="Close filters"
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
                                        className={`ep-category-btn ${
                                            selectedCategory === (cat.id === 'all' ? '' : cat.id) ? 'active' : ''
                                        }`}
                                        onClick={() => handleCategoryClick(cat.id)}
                                    >
                                        <FiPackage />
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
                                <span className="ep-price-separator">–</span>
                                <input
                                    type="number"
                                    className="ep-price-input"
                                    placeholder="Max"
                                    value={priceRange.max}
                                    onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Clear */}
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

                    {/* Main */}
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
                                    {sortOptions.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>

                                <div className="ep-view-toggle">
                                    <button
                                        className={`ep-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                                        onClick={() => setViewMode('grid')}
                                        aria-label="Grid view"
                                    >
                                        <FiGrid />
                                    </button>
                                    <button
                                        className={`ep-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                                        onClick={() => setViewMode('list')}
                                        aria-label="List view"
                                    >
                                        <FiList />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Products */}
                        {sortedProducts.length > 0 ? (
                            <div className={`ep-products ${viewMode}`}>
                                {sortedProducts.map((product) => (
                                    <Product
                                        key={product._id}
                                        product={product}
                                        hideNewBadge={false}
                                        onQuickAdd={handleQuickAdd}
                                        showQuickActions={true}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="ep-empty-state">
                                <FiPackage className="ep-empty-icon" />
                                <h3>No Products Found</h3>
                                <p>
                                    {keyword
                                        ? `No products match "${keyword}"`
                                        : 'No products available in this category'}
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
                                    {[...Array(totalPages)].map((_, i) => {
                                        const page = i + 1;
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