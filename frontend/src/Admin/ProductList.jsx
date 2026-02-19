import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/ProductsList.css';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
    fetchAdminProducts, deleteProduct,
    removeErrors, removeProductDeleted
} from '../features/admin/adminSlice';
// FIX: removed useNavigate (never called) and removeSuccess (wrong flag)
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import {
    FiEdit2, FiTrash2, FiSearch, FiFilter, FiGrid, FiList,
    FiPackage, FiStar, FiPlus, FiAlertCircle, FiX, FiChevronDown
} from 'react-icons/fi';
// FIX: removed FiDollarSign (imported but never used in JSX)

// FIX: CATEGORIES moved outside component. Was re-created as a new array on
// every render (every keypress, modal open/close, state change).
const CATEGORIES = [
    'Electronics', 'Clothing & Apparel', 'Home & Living',
    'Sports & Outdoors', 'Beauty & Personal Care', 'Books & Media', 'Food & Beverages'
];

function ProductList() {
    // FIX: watch productDeleted instead of the shared success flag.
    // The shared `success` flag is set by updateProduct.fulfilled, deleteOrder,
    // addOrderMessage, cancelOrder, and many other thunks. If any of those ran
    // before this component mounted (e.g. user saved an update on UpdateProduct
    // and was navigated here), the useEffect below fires immediately with
    // success=true and shows "Product deleted!" even though nothing was deleted.
    // productDeleted is set ONLY by deleteProduct.fulfilled.
    const { products, loading, error, productDeleted } = useSelector(s => s.admin);
    const dispatch = useDispatch();

    const [viewMode, setViewMode]           = useState('grid');
    const [searchQuery, setSearchQuery]     = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [statusFilter, setStatusFilter]   = useState('');
    const [sortBy, setSortBy]               = useState('newest');
    const [showFilters, setShowFilters]     = useState(false);

    const [deleteModalOpen, setDeleteModalOpen]   = useState(false);
    const [productToDelete, setProductToDelete]   = useState(null);
    const [deleting, setDeleting]                 = useState(false);

    // FIX: isMounted ref prevents setState on an unmounted component.
    // Scenario: user confirms delete → navigates away → deleteProduct.fulfilled
    // fires → useEffect tries setDeleteModalOpen(false) → React warning.
    const isMounted = useRef(true);
    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    useEffect(() => {
        dispatch(fetchAdminProducts());
    }, [dispatch]);

    useEffect(() => {
        // FIX: error is stored as a plain string in the slice.
        // Using error.message is always undefined on a string; fall back
        // would work by accident but is semantically wrong.
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            if (isMounted.current) 
                setDeleting(false);
        }
        if (productDeleted) {
            toast.success('Product deleted successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeProductDeleted());
            if (isMounted.current) {
                setDeleteModalOpen(false);
                setProductToDelete(null);
                setDeleting(false);
            }
        }
        // FIX: clear productDeleted on unmount so re-mounting this component
        // doesn't immediately re-fire the success toast from a prior delete.
        return () => { dispatch(removeProductDeleted()); };
    }, [error, productDeleted, dispatch]);

    const openDeleteModal  = p  => { setProductToDelete(p); setDeleteModalOpen(true); setDeleting(false); };
    const closeDeleteModal = () => { if (deleting) return; setDeleteModalOpen(false); setProductToDelete(null); };
    const confirmDelete    = () => {
        if (!productToDelete || deleting) return;
        setDeleting(true);
        dispatch(deleteProduct(productToDelete._id));
    };

    // FIX: formatPrice now accepts the product's own currency.
    // Previously hardcoded 'USD', so NGN/EUR/GBP products showed wrong symbol.
    // try/catch guards against invalid currency codes from dirty data.
    const formatPrice = (amount, currency = 'USD') => {
        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency', currency, minimumFractionDigits: 2
            }).format(amount || 0);
        } catch {
            return new Intl.NumberFormat('en-US', {
                style: 'currency', currency: 'USD', minimumFractionDigits: 2
            }).format(amount || 0);
        }
    };

    // FIX: memoized. Previously getFilteredProducts() was called inline in the
    // render body on every render — every modal open/close, every keypress
    // fired a full filter+sort pass over the entire products array.
    const filteredProducts = useMemo(() => {
        if (!products || !products.length) return [];
        let out = [...products];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            out = out.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.description?.toLowerCase().includes(q) ||
                p.inventory?.sku?.toLowerCase().includes(q) ||
                p.brand?.toLowerCase().includes(q)
            );
        }
        if (categoryFilter) out = out.filter(p => p.category === categoryFilter);
        if (statusFilter)   out = out.filter(p => p.status   === statusFilter);
        switch (sortBy) {
            case 'newest':    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
            case 'oldest':    out.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
            case 'price-low': out.sort((a, b) => (a.pricing?.regular || a.price || 0) - (b.pricing?.regular || b.price || 0)); break;
            case 'price-high':out.sort((a, b) => (b.pricing?.regular || b.price || 0) - (a.pricing?.regular || a.price || 0)); break;
            case 'name':      out.sort((a, b) => a.name.localeCompare(b.name)); break;
            case 'stock-low': out.sort((a, b) => (a.inventory?.stock ?? a.stock ?? 0) - (b.inventory?.stock ?? b.stock ?? 0)); break;
            case 'rating':    out.sort((a, b) => (b.ratings || 0) - (a.ratings || 0)); break;
            default: break;
        }
        return out;
    }, [products, searchQuery, categoryFilter, statusFilter, sortBy]);

    const getStockStatus = p => {
        const stock     = p.inventory?.stock ?? p.stock ?? 0;
        const threshold = p.inventory?.lowStockThreshold ?? 5;
        if (p.inventory?.status === 'Discontinued') return { label: 'Discontinued', cls: 'discontinued' };
        if (stock === 0)        return { label: 'Out of Stock', cls: 'out-of-stock' };
        if (stock <= threshold) return { label: 'Low Stock',    cls: 'low-stock' };
        return                         { label: 'In Stock',     cls: 'in-stock' };
    };

    const getCurrency    = p => p.pricing?.currency || 'USD';
    const getPrice       = p => p.pricing?.sale || p.pricing?.regular || p.price || 0;
    const getRegular     = p => p.pricing?.regular || p.price || 0;
    const isOnSale       = p => { const s = p.pricing?.sale; return s && s < (p.pricing?.regular || p.price || 0); };
    const getImage       = p => { const imgs = p.images || p.image || []; return (imgs.find(i => i.isPrimary) || imgs[0])?.url || '/placeholder-product.png'; };
    const getStock       = p => p.inventory?.stock ?? p.stock ?? 0;

    if (loading && (!products || !products.length)) return <Loader />;

    return (
        <>
            <PageTitle title="Admin Products" />
            <Navbar />
            <div className="epl-container">

                {/* ── Header ── */}
                <div className="epl-header">
                    <div className="epl-header-content">
                        <h1 className="epl-title">Product Management</h1>
                        <p className="epl-subtitle">
                            {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'} found
                            {products.length > 0 && filteredProducts.length !== products.length && ` (${products.length} total)`}
                        </p>
                    </div>
                    <div className="epl-header-actions">
                        <Link to="/admin/products/create" className="epl-btn epl-btn-primary">
                            <FiPlus /> Add Product
                        </Link>
                    </div>
                </div>

                {/* ── Search + Filters Bar ── */}
                <div className="epl-filters-bar">
                    <div className="epl-search-box">
                        <FiSearch className="epl-search-icon" />
                        <input
                            type="text"
                            className="epl-search-input"
                            placeholder="Search products by name, SKU, brand, or description..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button className="epl-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
                                <FiX />
                            </button>
                        )}
                    </div>
                    <button className="epl-filter-toggle" onClick={() => setShowFilters(s => !s)}>
                        <FiFilter /> Filters
                        <FiChevronDown className={showFilters ? 'rotated' : ''} />
                    </button>
                    <div className="epl-view-toggle">
                        <button className={`epl-view-btn ${viewMode === 'grid'  ? 'active' : ''}`} onClick={() => setViewMode('grid')}  title="Grid View"><FiGrid /></button>
                        <button className={`epl-view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="Table View"><FiList /></button>
                    </div>
                </div>

                {/* ── Advanced Filters ── */}
                {showFilters && (
                    <div className="epl-advanced-filters">
                        <div className="epl-filter-group">
                            <label>Category</label>
                            <select className="epl-filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                                <option value="">All Categories</option>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="epl-filter-group">
                            <label>Status</label>
                            <select className="epl-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                                <option value="">All Status</option>
                                <option value="published">Published</option>
                                <option value="draft">Draft</option>
                                <option value="archived">Archived</option>
                            </select>
                        </div>
                        <div className="epl-filter-group">
                            <label>Sort By</label>
                            <select className="epl-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="name">Name (A-Z)</option>
                                <option value="price-high">Price (High-Low)</option>
                                <option value="price-low">Price (Low-High)</option>
                                <option value="stock-low">Stock (Low-High)</option>
                                <option value="rating">Highest Rated</option>
                            </select>
                        </div>
                        <button className="epl-filter-clear" onClick={() => { setCategoryFilter(''); setStatusFilter(''); setSortBy('newest'); setSearchQuery(''); }}>
                            Clear Filters
                        </button>
                    </div>
                )}

                {/* ── Products ── */}
                {filteredProducts.length === 0 ? (
                    <div className="epl-empty-state">
                        <FiPackage className="epl-empty-icon" />
                        <h3>No Products Found</h3>
                        <p>{searchQuery || categoryFilter || statusFilter ? 'Try adjusting your filters or search query' : 'Get started by creating your first product'}</p>
                        <Link to="/admin/products/create" className="epl-btn epl-btn-primary"><FiPlus /> Create Product</Link>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="epl-grid">
                        {filteredProducts.map(product => {
                            const ss       = getStockStatus(product);
                            const price    = getPrice(product);
                            const regular  = getRegular(product);
                            const onSale   = isOnSale(product);
                            const image    = getImage(product);
                            const stock    = getStock(product);
                            const currency = getCurrency(product);
                            return (
                                <div key={product._id} className="epl-card">
                                    <div className="epl-card-image">
                                        <img src={image} alt={product.name} />
                                        <div className="epl-card-badges">
                                            {product.isFeatured   && <span className="epl-badge featured">Featured</span>}
                                            {product.isNewArrival && <span className="epl-badge new">New</span>}
                                            {product.isBestseller && <span className="epl-badge bestseller">Bestseller</span>}
                                            {onSale               && <span className="epl-badge sale">On Sale</span>}
                                            <span className={`epl-badge ${ss.cls}`}>{ss.label}</span>
                                        </div>
                                    </div>
                                    <div className="epl-card-content">
                                        <h3 className="epl-card-title">{product.name}</h3>
                                        <p className="epl-card-category">{product.category}</p>
                                        {product.brand && <p className="epl-card-brand">{product.brand}</p>}
                                        <div className="epl-card-price">
                                            <span className="epl-price-current">{formatPrice(price, currency)}</span>
                                            {onSale && <span className="epl-price-original">{formatPrice(regular, currency)}</span>}
                                        </div>
                                        <div className="epl-card-meta">
                                            <div className="epl-meta-item"><FiPackage /><span>{stock} units</span></div>
                                            <div className="epl-meta-item"><FiStar /><span>{product.ratings?.toFixed(1) || '0.0'} ({product.numOfReviews || 0})</span></div>
                                        </div>
                                        {product.inventory?.sku && <p className="epl-card-sku">SKU: {product.inventory.sku}</p>}
                                        <div className="epl-card-status-badge">
                                            <span className={`epl-status ${product.status || 'published'}`}>{product.status || 'published'}</span>
                                        </div>
                                        <div className="epl-card-actions">
                                            <Link to={`/admin/product/${product._id}`} className="epl-card-btn epl-edit-btn"><FiEdit2 /> Edit</Link>
                                            <button onClick={() => openDeleteModal(product)} className="epl-card-btn epl-delete-btn"><FiTrash2 /> Delete</button>
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
                                    <th>Image</th><th>Product</th><th>Category</th><th>Price</th>
                                    <th>Stock</th><th>Status</th><th>Rating</th><th>Created</th><th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.map(product => {
                                    const ss       = getStockStatus(product);
                                    const price    = getPrice(product);
                                    const regular  = getRegular(product);
                                    const onSale   = isOnSale(product);
                                    const image    = getImage(product);
                                    const stock    = getStock(product);
                                    const currency = getCurrency(product);
                                    return (
                                        <tr key={product._id}>
                                            <td>
                                                <div className="epl-table-image">
                                                    <img src={image} alt={product.name} />
                                                    {onSale && <span className="epl-sale-badge">Sale</span>}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="epl-table-product">
                                                    <p className="epl-table-name">{product.name}</p>
                                                    {product.brand && <span className="epl-table-brand">{product.brand}</span>}
                                                    {product.inventory?.sku && <span className="epl-table-sku">SKU: {product.inventory.sku}</span>}
                                                </div>
                                            </td>
                                            <td>{product.category}</td>
                                            <td>
                                                <div className="epl-table-price">
                                                    <span className="epl-price-current">{formatPrice(price, currency)}</span>
                                                    {onSale && <span className="epl-price-original">{formatPrice(regular, currency)}</span>}
                                                </div>
                                            </td>
                                            <td><span className={`epl-stock-badge ${ss.cls}`}>{stock}</span></td>
                                            <td><span className={`epl-status-badge ${product.status || 'published'}`}>{product.status || 'published'}</span></td>
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
                                                    <Link to={`/admin/product/${product._id}`} className="epl-action-btn epl-edit" title="Edit"><FiEdit2 /></Link>
                                                    <button onClick={() => openDeleteModal(product)} className="epl-action-btn epl-delete" title="Delete"><FiTrash2 /></button>
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

            {/* ── Delete Modal ── */}
            {deleteModalOpen && (
                <div className="epl-modal-overlay" onClick={closeDeleteModal}>
                    <div className="epl-modal" onClick={e => e.stopPropagation()}>
                        <div className="epl-modal-header">
                            <div className="epl-modal-icon"><FiAlertCircle /></div>
                            <button className="epl-modal-close" onClick={closeDeleteModal} disabled={deleting}><FiX /></button>
                        </div>
                        <div className="epl-modal-content">
                            <h2>Delete Product?</h2>
                            <p>This action cannot be undone. This will permanently delete the product and all associated images from Cloudinary.</p>
                            {productToDelete && (
                                <div className="epl-modal-product">
                                    <img src={getImage(productToDelete)} alt={productToDelete.name} />
                                    <div>
                                        <h3>{productToDelete.name}</h3>
                                        <p className="epl-modal-category">{productToDelete.category}</p>
                                        <p className="epl-modal-meta">
                                            {formatPrice(getPrice(productToDelete), getCurrency(productToDelete))} • Stock: {getStock(productToDelete)} units
                                        </p>
                                        {productToDelete.inventory?.sku && <p className="epl-modal-sku">SKU: {productToDelete.inventory.sku}</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="epl-modal-actions">
                            <button onClick={closeDeleteModal} className="epl-modal-btn epl-cancel" disabled={deleting}>Cancel</button>
                            <button onClick={confirmDelete}    className="epl-modal-btn epl-confirm" disabled={deleting}>
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