import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/ProductsList.css';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdminProducts, deleteProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { 
    FiEdit2, FiTrash2, FiSearch, FiFilter, FiGrid, FiList,
    FiPackage, FiDollarSign, FiStar, FiEye, FiPlus,
    FiAlertCircle, FiX, FiChevronDown, FiTrendingUp
} from 'react-icons/fi';

function ProductList() {
    const { products, loading, error, success } = useSelector(state => state.admin);
    const dispatch = useDispatch();

    // View and filter states
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
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

    useEffect(() => {
        dispatch(fetchAdminProducts());
    }, [dispatch]);

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
            dispatch(fetchAdminProducts()); // Refresh the list
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

    // Filter and sort products
    const getFilteredProducts = () => {
        if (!products || products.length === 0) return [];

        let filtered = [...products];

        // Search filter
        if (searchQuery) {
            filtered = filtered.filter(product =>
                product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.inventory?.sku?.toLowerCase().includes(searchQuery.toLowerCase())
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
                filtered.sort((a, b) => (a.pricing?.regular || 0) - (b.pricing?.regular || 0));
                break;
            case 'price-high':
                filtered.sort((a, b) => (b.pricing?.regular || 0) - (a.pricing?.regular || 0));
                break;
            case 'name':
                filtered.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'stock-low':
                filtered.sort((a, b) => (a.inventory?.stock || 0) - (b.inventory?.stock || 0));
                break;
            default:
                break;
        }

        return filtered;
    };

    const filteredProducts = getFilteredProducts();

    const getStockStatus = (product) => {
    const stock = product.inventory?.stock ?? 0;
    const threshold = product.inventory?.lowStockThreshold ?? 5;

    if (stock === 0) return { label: 'Out of Stock', class: 'out-of-stock' };
    if (stock <= threshold) return { label: 'Low Stock', class: 'low-stock' };
    return { label: 'In Stock', class: 'in-stock' };
};


    // Get product price
    const getProductPrice = (product) => {
    return product.pricing?.sale || product.pricing?.regular || 0;
};

    // Get product image
    const getProductImage = (product) => {
        const images = product.images || product.image || [];
        return images[0]?.url || '/placeholder-product.png';
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
                            placeholder="Search products by name, SKU, or description..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
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
                        >
                            <FiGrid />
                        </button>
                        <button
                            className={`epl-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => setViewMode('table')}
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
                        <p>Try adjusting your filters or create a new product</p>
                        <Link to="/admin/products/create" className="epl-btn epl-btn-primary">
                            <FiPlus /> Create Product
                        </Link>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="epl-grid">
                        {filteredProducts.map((product) => {
                            const stockStatus = getStockStatus(product);
                            const price = getProductPrice(product);
                            const image = getProductImage(product);
                            const stock = product.inventory?.stock ?? 0;

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
                                            <span className={`epl-badge ${stockStatus.class}`}>
                                                {stockStatus.label}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="epl-card-content">
                                        <h3 className="epl-card-title">{product.name}</h3>
                                        <p className="epl-card-category">{product.category}</p>

                                        <div className="epl-card-meta">
                                            <div className="epl-meta-item">
                                                <FiDollarSign />
                                                <span>${price.toFixed(2)}</span>
                                            </div>
                                            <div className="epl-meta-item">
                                                <FiPackage />
                                                <span>{stock} units</span>
                                            </div>
                                            <div className="epl-meta-item">
                                                <FiStar />
                                                <span>{product.ratings || 0}</span>
                                            </div>
                                        </div>

                                        {product.inventory?.sku && (
                                            <p className="epl-card-sku">SKU: {product.inventory.sku}</p>
                                        )}

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
                                    const image = getProductImage(product);
                                    const stock = product.inventory?.stock ?? 0;

                                    return (
                                        <tr key={product._id}>
                                            <td>
                                                <div className="epl-table-image">
                                                    <img src={image} alt={product.name} />
                                                </div>
                                            </td>
                                            <td>
                                                <div className="epl-table-product">
                                                    <p className="epl-table-name">{product.name}</p>
                                                    {product.inventory?.sku && (
                                                        <span className="epl-table-sku">SKU: {product.inventory.sku}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>{product.category}</td>
                                            <td>${price.toFixed(2)}</td>
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
                                                    {product.ratings || 0}
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
                            <button className="epl-modal-close" onClick={closeDeleteModal}>
                                <FiX />
                            </button>
                        </div>

                        <div className="epl-modal-content">
                            <h2>Delete Product?</h2>
                            <p>This action cannot be undone. This will permanently delete the product.</p>

                            {productToDelete && (
                                <div className="epl-modal-product">
                                    <img
                                        src={getProductImage(productToDelete)}
                                        alt={productToDelete.name}
                                    />
                                    <div>
                                        <h3>{productToDelete.name}</h3>
                                        <p className="epl-modal-meta">
                                            ${getProductPrice(productToDelete).toFixed(2)} • 
                                            Stock: {productToDelete.inventory?.stock ?? 0}
                                        </p>
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