import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/ProductsList.css';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdminProducts, deleteProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { 
    FiEdit2, FiTrash2, FiSearch, FiFilter, FiGrid, FiList,
    FiPackage, FiDollarSign, FiStar, FiPlus,
    FiAlertCircle, FiX, FiChevronDown
} from 'react-icons/fi';

function ProductList() {
    const { products, loading, error, success } = useSelector(state => state.admin);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    // View and filter states
    const [viewMode, setViewMode] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sortBy, setSortBy] = useState('newest');
    const [showFilters, setShowFilters] = useState(false);

    // Modal state
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [productToDelete, setProductToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const categories = [
        'Electronics',
        'Clothing & Apparel',
        'Home & Living',
        'Sports & Outdoors',
        'Beauty & Personal Care',
        'Books & Media',
        'Food & Beverages'
    ];

    // Fetch products on mount
    useEffect(() => {
        dispatch(fetchAdminProducts());
    }, [dispatch]);

    // Handle errors and success messages
    useEffect(() => {
        if (error) {
            toast.error(error.message || error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setDeleting(false);
        }
        if (success) {
            toast.success('Product deleted successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setDeleteModalOpen(false);
            setProductToDelete(null);
            setDeleting(false);
            // Products list is automatically updated via Redux state
        }
    }, [error, success, dispatch]);

    const openDeleteModal = (product) => {
        setProductToDelete(product);
        setDeleteModalOpen(true);
        setDeleting(false);
    };

    const closeDeleteModal = () => {
        if (deleting) return;
        setDeleteModalOpen(false);
        setProductToDelete(null);
    };

    const confirmDelete = () => {
        if (!productToDelete || deleting) return;
        setDeleting(true);
        dispatch(deleteProduct(productToDelete._id));
    };

    // Format price in USD
    const formatPrice = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2
        }).format(amount || 0);
    };

    // Filter and sort products
    const getFilteredProducts = () => {
        if (!products || products.length === 0) return [];

        let filtered = [...products];

        // Search filter
        if (searchQuery) {
            filtered = filtered.filter(product =>
                product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.inventory?.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.brand?.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Category filter
        if (categoryFilter) {
            filtered = filtered.filter(product => product.category === categoryFilter);
        }

        // Status filter
        if (statusFilter) {
            filtered = filtered.filter(product => product.status === statusFilter);
        }

        // Sort
        switch (sortBy) {
            case 'newest':
                filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                break;
            case 'oldest':
                filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                break;
            case 'price-low':
                filtered.sort((a, b) => {
                    const priceA = a.pricing?.regular || a.price || 0;
                    const priceB = b.pricing?.regular || b.price || 0;
                    return priceA - priceB;
                });
                break;
            case 'price-high':
                filtered.sort((a, b) => {
                    const priceA = a.pricing?.regular || a.price || 0;
                    const priceB = b.pricing?.regular || b.price || 0;
                    return priceB - priceA;
                });
                break;
            case 'name':
                filtered.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'stock-low':
                filtered.sort((a, b) => {
                    const stockA = a.inventory?.stock ?? a.stock ?? 0;
                    const stockB = b.inventory?.stock ?? b.stock ?? 0;
                    return stockA - stockB;
                });
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

    // Get stock status with enhanced logic
    const getStockStatus = (product) => {
        const stock = product.inventory?.stock ?? product.stock ?? 0;
        const threshold = product.inventory?.lowStockThreshold ?? 5;
        const inventoryStatus = product.inventory?.status;

        // Check for discontinued first
        if (inventoryStatus === 'Discontinued') {
            return { label: 'Discontinued', class: 'discontinued' };
        }

        if (stock === 0) return { label: 'Out of Stock', class: 'out-of-stock' };
        if (stock <= threshold) return { label: 'Low Stock', class: 'low-stock' };
        return { label: 'In Stock', class: 'in-stock' };
    };

    // Get product price (prioritize sale price)
    const getProductPrice = (product) => {
        return product.pricing?.sale || product.pricing?.regular || product.price || 0;
    };

    // Get regular price
    const getRegularPrice = (product) => {
        return product.pricing?.regular || product.price || 0;
    };

    // Check if on sale
    const isOnSale = (product) => {
        const regular = product.pricing?.regular || product.price || 0;
        const sale = product.pricing?.sale;
        return sale && sale < regular;
    };

    // Get product image (prioritize primary image)
    const getProductImage = (product) => {
        const images = product.images || product.image || [];
        const primaryImage = images.find(img => img.isPrimary) || images[0];
        return primaryImage?.url || '/placeholder-product.png';
    };

    // Get stock count
    const getStock = (product) => {
        return product.inventory?.stock ?? product.stock ?? 0;
    };

    if (loading && (!products || products.length === 0)) {
        return <Loader />;
    }

    return (
        <>
            <PageTitle title='Admin Products'/>
            <Navbar />

            <div className="epl-container">
                {/* Header */}
                <div className="epl-header">
                    <div className="epl-header-content">
                        <h1 className="epl-title">Product Management</h1>
                        <p className="epl-subtitle">
                            {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'} found
                            {products.length > 0 && filteredProducts.length !== products.length && 
                                ` (${products.length} total)`
                            }
                        </p>
                    </div>
                    <div className="epl-header-actions">
                        <Link to="/admin/products/create" className="epl-btn epl-btn-primary">
                            <FiPlus /> Add Product
                        </Link>
                    </div>
                </div>

                {/* Filters Bar */}
                <div className="epl-filters-bar">
                    <div className="epl-search-box">
                        <FiSearch className="epl-search-icon" />
                        <input
                            type="text"
                            className="epl-search-input"
                            placeholder="Search products by name, SKU, brand, or description..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button 
                                className="epl-search-clear"
                                onClick={() => setSearchQuery('')}
                            >
                                <FiX />
                            </button>
                        )}
                    </div>

                    <button 
                        className="epl-filter-toggle"
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <FiFilter /> Filters
                        <FiChevronDown className={showFilters ? 'rotated' : ''} />
                    </button>

                    <div className="epl-view-toggle">
                        <button
                            className={`epl-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title="Grid View"
                        >
                            <FiGrid />
                        </button>
                        <button
                            className={`epl-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => setViewMode('table')}
                            title="Table View"
                        >
                            <FiList />
                        </button>
                    </div>
                </div>

                {/* Advanced Filters */}
                {showFilters && (
                    <div className="epl-advanced-filters">
                        <div className="epl-filter-group">
                            <label>Category</label>
                            <select
                                className="epl-filter-select"
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                            >
                                <option value="">All Categories</option>
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>

                        <div className="epl-filter-group">
                            <label>Status</label>
                            <select
                                className="epl-filter-select"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="">All Status</option>
                                <option value="published">Published</option>
                                <option value="draft">Draft</option>
                                <option value="archived">Archived</option>
                            </select>
                        </div>

                        <div className="epl-filter-group">
                            <label>Sort By</label>
                            <select
                                className="epl-filter-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                            >
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="name">Name (A-Z)</option>
                                <option value="price-high">Price (High-Low)</option>
                                <option value="price-low">Price (Low-High)</option>
                                <option value="stock-low">Stock (Low-High)</option>
                                <option value="rating">Highest Rated</option>
                            </select>
                        </div>

                        <button 
                            className="epl-filter-clear"
                            onClick={() => {
                                setCategoryFilter('');
                                setStatusFilter('');
                                setSortBy('newest');
                                setSearchQuery('');
                            }}
                        >
                            Clear Filters
                        </button>
                    </div>
                )}

                {/* Products Display */}
                {filteredProducts.length === 0 ? (
                    <div className="epl-empty-state">
                        <FiPackage className="epl-empty-icon" />
                        <h3>No Products Found</h3>
                        <p>
                            {searchQuery || categoryFilter || statusFilter
                                ? 'Try adjusting your filters or search query'
                                : 'Get started by creating your first product'
                            }
                        </p>
                        <Link to="/admin/products/create" className="epl-btn epl-btn-primary">
                            <FiPlus /> Create Product
                        </Link>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="epl-grid">
                        {filteredProducts.map((product) => {
                            const stockStatus = getStockStatus(product);
                            const price = getProductPrice(product);
                            const regularPrice = getRegularPrice(product);
                            const onSale = isOnSale(product);
                            const image = getProductImage(product);
                            const stock = getStock(product);

                            return (
                                <div key={product._id} className="epl-card">
                                    <div className="epl-card-image">
                                        <img src={image} alt={product.name} />
                                        <div className="epl-card-badges">
                                            {product.isFeatured && (
                                                <span className="epl-badge featured">Featured</span>
                                            )}
                                            {product.isNewArrival && (
                                                <span className="epl-badge new">New</span>
                                            )}
                                            {product.isBestseller && (
                                                <span className="epl-badge bestseller">Bestseller</span>
                                            )}
                                            {onSale && (
                                                <span className="epl-badge sale">On Sale</span>
                                            )}
                                            <span className={`epl-badge ${stockStatus.class}`}>
                                                {stockStatus.label}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="epl-card-content">
                                        <h3 className="epl-card-title">{product.name}</h3>
                                        <p className="epl-card-category">{product.category}</p>
                                        {product.brand && (
                                            <p className="epl-card-brand">{product.brand}</p>
                                        )}

                                        <div className="epl-card-price">
                                            <span className="epl-price-current">{formatPrice(price)}</span>
                                            {onSale && (
                                                <span className="epl-price-original">{formatPrice(regularPrice)}</span>
                                            )}
                                        </div>

                                        <div className="epl-card-meta">
                                            <div className="epl-meta-item">
                                                <FiPackage />
                                                <span>{stock} units</span>
                                            </div>
                                            <div className="epl-meta-item">
                                                <FiStar />
                                                <span>{product.ratings?.toFixed(1) || '0.0'} ({product.numOfReviews || 0})</span>
                                            </div>
                                        </div>

                                        {product.inventory?.sku && (
                                            <p className="epl-card-sku">SKU: {product.inventory.sku}</p>
                                        )}

                                        <div className="epl-card-status-badge">
                                            <span className={`epl-status ${product.status || 'published'}`}>
                                                {product.status || 'published'}
                                            </span>
                                        </div>

                                        <div className="epl-card-actions">
                                            <Link
                                                to={`/admin/product/${product._id}`}
                                                className="epl-card-btn epl-edit-btn"
                                            >
                                                <FiEdit2 /> Edit
                                            </Link>
                                            <button
                                                onClick={() => openDeleteModal(product)}
                                                className="epl-card-btn epl-delete-btn"
                                            >
                                                <FiTrash2 /> Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="epl-table-container">
                        <table className="epl-table">
                            <thead>
                                <tr>
                                    <th>Image</th>
                                    <th>Product</th>
                                    <th>Category</th>
                                    <th>Price</th>
                                    <th>Stock</th>
                                    <th>Status</th>
                                    <th>Rating</th>
                                    <th>Created</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.map((product) => {
                                    const stockStatus = getStockStatus(product);
                                    const price = getProductPrice(product);
                                    const regularPrice = getRegularPrice(product);
                                    const onSale = isOnSale(product);
                                    const image = getProductImage(product);
                                    const stock = getStock(product);

                                    return (
                                        <tr key={product._id}>
                                            <td>
                                                <div className="epl-table-image">
                                                    <img src={image} alt={product.name} />
                                                    {onSale && (
                                                        <span className="epl-sale-badge">Sale</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="epl-table-product">
                                                    <p className="epl-table-name">{product.name}</p>
                                                    {product.brand && (
                                                        <span className="epl-table-brand">{product.brand}</span>
                                                    )}
                                                    {product.inventory?.sku && (
                                                        <span className="epl-table-sku">SKU: {product.inventory.sku}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>{product.category}</td>
                                            <td>
                                                <div className="epl-table-price">
                                                    <span className="epl-price-current">{formatPrice(price)}</span>
                                                    {onSale && (
                                                        <span className="epl-price-original">{formatPrice(regularPrice)}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`epl-stock-badge ${stockStatus.class}`}>
                                                    {stock}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`epl-status-badge ${product.status || 'published'}`}>
                                                    {product.status || 'published'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="epl-rating">
                                                    <FiStar className="epl-star-icon" />
                                                    <span>{product.ratings?.toFixed(1) || '0.0'}</span>
                                                    <span className="epl-reviews">({product.numOfReviews || 0})</span>
                                                </div>
                                            </td>
                                            <td>{new Date(product.createdAt).toLocaleDateString()}</td>
                                            <td>
                                                <div className="epl-table-actions">
                                                    <Link
                                                        to={`/admin/product/${product._id}`}
                                                        className="epl-action-btn epl-edit"
                                                        title="Edit"
                                                    >
                                                        <FiEdit2 />
                                                    </Link>
                                                    <button
                                                        onClick={() => openDeleteModal(product)}
                                                        className="epl-action-btn epl-delete"
                                                        title="Delete"
                                                    >
                                                        <FiTrash2 />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Footer />

            {/* Delete Confirmation Modal */}
            {deleteModalOpen && (
                <div className="epl-modal-overlay" onClick={closeDeleteModal}>
                    <div className="epl-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="epl-modal-header">
                            <div className="epl-modal-icon">
                                <FiAlertCircle />
                            </div>
                            <button 
                                className="epl-modal-close" 
                                onClick={closeDeleteModal}
                                disabled={deleting}
                            >
                                <FiX />
                            </button>
                        </div>

                        <div className="epl-modal-content">
                            <h2>Delete Product?</h2>
                            <p>This action cannot be undone. This will permanently delete the product and all associated images from Cloudinary.</p>

                            {productToDelete && (
                                <div className="epl-modal-product">
                                    <img
                                        src={getProductImage(productToDelete)}
                                        alt={productToDelete.name}
                                    />
                                    <div>
                                        <h3>{productToDelete.name}</h3>
                                        <p className="epl-modal-category">{productToDelete.category}</p>
                                        <p className="epl-modal-meta">
                                            {formatPrice(getProductPrice(productToDelete))} • 
                                            Stock: {getStock(productToDelete)} units
                                        </p>
                                        {productToDelete.inventory?.sku && (
                                            <p className="epl-modal-sku">SKU: {productToDelete.inventory.sku}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="epl-modal-actions">
                            <button 
                                onClick={closeDeleteModal} 
                                className="epl-modal-btn epl-cancel"
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmDelete} 
                                className="epl-modal-btn epl-confirm"
                                disabled={deleting}
                            >
                                {deleting ? 'Deleting...' : 'Delete Product'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default ProductList;