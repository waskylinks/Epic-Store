import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Product from '../components/Product';
import PageTitle from '../components/PageTitle';
import Loader from '../components/Loader';
import { toast } from 'react-toastify';
import {
    fetchNewArrivals,
    clearNewArrivalsError
} from '../features/publicProducts/publicProductsSlice';
import { addItemsToCart } from '../features/cart/cartSlice';
import {
    NewReleases,
    FilterList,
    GridView,
    ViewList,
    ArrowBack,
    ArrowForward
} from '@mui/icons-material';
import '../pageStyles/NewArrivals.css';

function NewArrivals() {
    const dispatch = useDispatch();
    const [searchParams, setSearchParams] = useSearchParams();

    // State
    const [viewMode, setViewMode] = useState('grid');
    const [filters, setFilters] = useState({
        category: searchParams.get('category') || '',
        daysBack: parseInt(searchParams.get('daysBack')) || 30,
        inStockOnly: searchParams.get('inStockOnly') !== 'false',
        page: parseInt(searchParams.get('page')) || 1,
        limit: 12
    });
    const [showFilters, setShowFilters] = useState(false);

    // Redux state
    const {
        newArrivals,
        newArrivalsPagination,
        newArrivalsLoading,
        newArrivalsError
    } = useSelector((state) => state.publicProducts);

    // Categories for filter (you can fetch this dynamically if needed)
    const categories = [
        'Electronics',
        'Fashion',
        'Home & Garden',
        'Sports',
        'Books',
        'Toys',
        'Beauty',
        'Automotive'
    ];

    const daysBackOptions = [
        { value: 7, label: 'Last 7 Days' },
        { value: 14, label: 'Last 2 Weeks' },
        { value: 30, label: 'Last 30 Days' },
        { value: 60, label: 'Last 2 Months' },
        { value: 90, label: 'Last 3 Months' }
    ];

    // Fetch products when filters change
    useEffect(() => {
        dispatch(fetchNewArrivals(filters));

        // Update URL params
        const params = new URLSearchParams();
        if (filters.category) params.set('category', filters.category);
        params.set('daysBack', filters.daysBack);
        params.set('inStockOnly', filters.inStockOnly);
        if (filters.page > 1) params.set('page', filters.page);
        setSearchParams(params);

        return () => {
            dispatch(clearNewArrivalsError());
        };
    }, [dispatch, filters, setSearchParams]);

    // Handle errors
    useEffect(() => {
        if (newArrivalsError) {
            toast.error(newArrivalsError, { 
                position: 'top-center', 
                autoClose: 3000 
            });
        }
    }, [newArrivalsError]);

    // Filter handlers
    const handleCategoryChange = (category) => {
        setFilters(prev => ({
            ...prev,
            category: prev.category === category ? '' : category,
            page: 1
        }));
    };

    const handleDaysBackChange = (days) => {
        setFilters(prev => ({
            ...prev,
            daysBack: days,
            page: 1
        }));
    };

    const handleInStockToggle = () => {
        setFilters(prev => ({
            ...prev,
            inStockOnly: !prev.inStockOnly,
            page: 1
        }));
    };

    const handlePageChange = (newPage) => {
        setFilters(prev => ({ ...prev, page: newPage }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleQuickAdd = (productId) => {
        dispatch(addItemsToCart({ id: productId, quantity: 1 }));
    };

    const clearAllFilters = () => {
        setFilters({
            category: '',
            daysBack: 30,
            inStockOnly: true,
            page: 1,
            limit: 12
        });
    };

    const hasActiveFilters = filters.category || filters.daysBack !== 30 || !filters.inStockOnly;

    return (
        <>
            <PageTitle title="New Arrivals - Epic Store" />
            <Navbar />

            <div className="new-arrivals-page">
                {/* Main Content */}
                <section className="na-main-section">
                    <div className="container">
                        {/* Toolbar */}
                        <div className="na-toolbar">
                            <div className="na-toolbar-left">
                                <button
                                    className="na-filter-toggle"
                                    onClick={() => setShowFilters(!showFilters)}
                                >
                                    <FilterList />
                                    Filters
                                    {hasActiveFilters && (
                                        <span className="filter-badge">
                                            {[filters.category, filters.daysBack !== 30, !filters.inStockOnly]
                                                .filter(Boolean).length}
                                        </span>
                                    )}
                                </button>

                                {newArrivalsPagination && (
                                    <div className="na-results-count">
                                        Showing {newArrivals.length} of {newArrivalsPagination.totalProducts} products
                                    </div>
                                )}
                            </div>

                            <div className="na-toolbar-right">
                                <div className="na-view-toggle">
                                    <button
                                        className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                                        onClick={() => setViewMode('grid')}
                                        aria-label="Grid view"
                                    >
                                        <GridView />
                                    </button>
                                    <button
                                        className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                                        onClick={() => setViewMode('list')}
                                        aria-label="List view"
                                    >
                                        <ViewList />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="na-content-wrapper">
                            {/* Sidebar Filters */}
                            <aside className={`na-sidebar ${showFilters ? 'show' : ''}`}>
                                <div className="na-sidebar-header">
                                    <h3>Filters</h3>
                                    {hasActiveFilters && (
                                        <button
                                            className="clear-filters-btn"
                                            onClick={clearAllFilters}
                                        >
                                            Clear All
                                        </button>
                                    )}
                                </div>

                                {/* Time Period Filter */}
                                <div className="filter-group">
                                    <h4 className="filter-title">Time Period</h4>
                                    <div className="filter-options">
                                        {daysBackOptions.map((option) => (
                                            <label key={option.value} className="filter-option">
                                                <input
                                                    type="radio"
                                                    name="daysBack"
                                                    checked={filters.daysBack === option.value}
                                                    onChange={() => handleDaysBackChange(option.value)}
                                                />
                                                <span>{option.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Category Filter */}
                                <div className="filter-group">
                                    <h4 className="filter-title">Category</h4>
                                    <div className="filter-options">
                                        {categories.map((category) => (
                                            <label key={category} className="filter-option">
                                                <input
                                                    type="checkbox"
                                                    checked={filters.category === category}
                                                    onChange={() => handleCategoryChange(category)}
                                                />
                                                <span>{category}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Stock Filter */}
                                <div className="filter-group">
                                    <h4 className="filter-title">Availability</h4>
                                    <div className="filter-options">
                                        <label className="filter-option">
                                            <input
                                                type="checkbox"
                                                checked={filters.inStockOnly}
                                                onChange={handleInStockToggle}
                                            />
                                            <span>In Stock Only</span>
                                        </label>
                                    </div>
                                </div>
                            </aside>

                            {/* Products Grid/List */}
                            <div className="na-products-section">
                                {newArrivalsLoading && newArrivals.length === 0 ? (
                                    <Loader />
                                ) : newArrivals.length === 0 ? (
                                    <div className="na-empty-state">
                                        <NewReleases className="empty-icon" />
                                        <h3>No New Arrivals Found</h3>
                                        <p>Try adjusting your filters to see more products</p>
                                        {hasActiveFilters && (
                                            <button
                                                className="clear-filters-btn-large"
                                                onClick={clearAllFilters}
                                            >
                                                Clear All Filters
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div className={`na-products-${viewMode}`}>
                                            {newArrivals.map((product) => (
                                                <Product
                                                    key={product._id}
                                                    product={product}
                                                    onQuickAdd={handleQuickAdd}
                                                    showQuickActions={true}
                                                    viewMode={viewMode}
                                                />
                                            ))}
                                        </div>

                                        {/* Pagination */}
                                        {newArrivalsPagination && newArrivalsPagination.totalPages > 1 && (
                                            <div className="na-pagination">
                                                <button
                                                    className="pagination-btn"
                                                    onClick={() => handlePageChange(filters.page - 1)}
                                                    disabled={filters.page === 1}
                                                >
                                                    <ArrowBack />
                                                    Previous
                                                </button>

                                                <div className="pagination-pages">
                                                    {[...Array(newArrivalsPagination.totalPages)].map((_, index) => {
                                                        const pageNum = index + 1;
                                                        // Show first, last, current, and adjacent pages
                                                        if (
                                                            pageNum === 1 ||
                                                            pageNum === newArrivalsPagination.totalPages ||
                                                            (pageNum >= filters.page - 1 && pageNum <= filters.page + 1)
                                                        ) {
                                                            return (
                                                                <button
                                                                    key={pageNum}
                                                                    className={`pagination-page ${
                                                                        pageNum === filters.page ? 'active' : ''
                                                                    }`}
                                                                    onClick={() => handlePageChange(pageNum)}
                                                                >
                                                                    {pageNum}
                                                                </button>
                                                            );
                                                        } else if (
                                                            pageNum === filters.page - 2 ||
                                                            pageNum === filters.page + 2
                                                        ) {
                                                            return <span key={pageNum} className="pagination-ellipsis">...</span>;
                                                        }
                                                        return null;
                                                    })}
                                                </div>

                                                <button
                                                    className="pagination-btn"
                                                    onClick={() => handlePageChange(filters.page + 1)}
                                                    disabled={filters.page === newArrivalsPagination.totalPages}
                                                >
                                                    Next
                                                    <ArrowForward />
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <Footer />
            </div>
        </>
    );
}

export default NewArrivals;