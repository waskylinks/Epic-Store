import { useEffect, useState, useMemo, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import {
  fetchAdminProducts,
  deleteProduct,
  deleteMultipleProducts,
  clearDeleteStatus,
  clearBatchDeleteStatus,
  selectAdminProducts,
  selectAdminProductsLoading,
  selectAdminProductsError,
  selectDeleteStatus,
  selectBatchDeleteStatus,
  selectProductsCount,
  selectPaginationMeta,
  selectPublishedProducts,
  selectDraftProducts,
  selectArchivedProducts,
  selectLowStockProducts,
  selectOutOfStockProducts,
  selectFeaturedProducts,
  selectOnSaleProducts,
} from '../features/admin/adminProductSlice';
import { Link } from 'react-router-dom';
import {ArrowBack }from '@mui/icons-material';

import '../AdminStyles/ProductsList.css';

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS = { published: 'Published', draft: 'Draft', archived: 'Archived' };
const INV_LABELS    = { InStock: 'In Stock', LowStock: 'Low Stock', OutOfStock: 'Out of Stock', Discontinued: 'Discontinued' };
const CATEGORIES    = ['All','Electronics','Clothing & Apparel','Home & Living','Sports & Outdoors','Beauty & Personal Care','Books & Media','Food & Beverages'];
const SORT_OPTIONS  = [
  { value: 'createdAt_desc',      label: 'Newest First' },
  { value: 'createdAt_asc',       label: 'Oldest First' },
  { value: 'name_asc',            label: 'Name A–Z' },
  { value: 'name_desc',           label: 'Name Z–A' },
  { value: 'pricing.regular_asc', label: 'Price Low–High' },
  { value: 'pricing.regular_desc',label: 'Price High–Low' },
  { value: 'ratings_desc',        label: 'Top Rated' },
  { value: 'inventory.stock_asc', label: 'Stock Low–High' },
];

const fmt = (n) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── component ────────────────────────────────────────────────────────────────

export default function ProductList() {
  const dispatch   = useDispatch();
  const navigate   = useNavigate();

  const products           = useSelector(selectAdminProducts);
  const loading            = useSelector(selectAdminProductsLoading);
  const error              = useSelector(selectAdminProductsError);
  const totalCount         = useSelector(selectProductsCount);
  const { totalPages, currentPage, resultPerPage } = useSelector(selectPaginationMeta);
  const publishedProducts  = useSelector(selectPublishedProducts);
  const draftProducts      = useSelector(selectDraftProducts);
  const archivedProducts   = useSelector(selectArchivedProducts);
  const lowStockProducts   = useSelector(selectLowStockProducts);
  const outOfStockProducts = useSelector(selectOutOfStockProducts);
  const featuredProducts   = useSelector(selectFeaturedProducts);
  const onSaleProducts     = useSelector(selectOnSaleProducts);
  const deleteStatus       = useSelector(selectDeleteStatus);
  const batchStatus        = useSelector(selectBatchDeleteStatus);

  // ── local state ────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState('');
  const [searchInput,  setSearchInput]  = useState(''); // unbound input value
  const [statusFilter, setStatusFilter] = useState('all');
  const [invFilter,    setInvFilter]    = useState('all');
  const [catFilter,    setCatFilter]    = useState('All');
  const [sortKey,      setSortKey]      = useState('createdAt_desc');
  const [page,         setPage]         = useState(1);
  const [selected,     setSelected]     = useState(new Set());
  const [confirmId,    setConfirmId]    = useState(null);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [toast,        setToast]        = useState(null);
  const [filtersOpen,  setFiltersOpen]  = useState(false);

  // ── fetch whenever query params change ─────────────────────────────────────
  useEffect(() => {
    dispatch(fetchAdminProducts({
      page,
      limit: 20,
      ...(search      && { search }),
      ...(statusFilter !== 'all' && { status: statusFilter }),
      ...(invFilter   !== 'all' && { inventoryStatus: invFilter }),
      ...(catFilter   !== 'All' && { category: catFilter }),
      ...(sortKey     && { sort: sortKey }),
    }));
  }, [dispatch, page, search, statusFilter, invFilter, catFilter, sortKey]);

  // ── debounce search input so we don't hit the server on every keystroke ────
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── reset to page 1 when any filter/sort changes ───────────────────────────
  useEffect(() => { setPage(1); }, [statusFilter, invFilter, catFilter, sortKey]);

  // ── toast helper ───────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── delete single ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (deleteStatus.success) {
      showToast('Product deleted successfully.');
      dispatch(clearDeleteStatus());
      setConfirmId(null);
    }
    if (deleteStatus.error) {
      showToast(deleteStatus.error, 'error');
      dispatch(clearDeleteStatus());
    }
  }, [deleteStatus, dispatch, showToast]);

  // ── batch delete ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (batchStatus.results) {
      const { successful, failed } = batchStatus.results;
      showToast(
        `Deleted ${successful.length} product${successful.length !== 1 ? 's' : ''}${failed.length ? `, ${failed.length} failed` : ''}.`,
        failed.length ? 'warn' : 'success'
      );
      dispatch(clearBatchDeleteStatus());
      setSelected(new Set());
      setConfirmBatch(false);
    }
    if (batchStatus.error) {
      showToast(batchStatus.error, 'error');
      dispatch(clearBatchDeleteStatus());
    }
  }, [batchStatus, dispatch, showToast]);

  // ── selection ──────────────────────────────────────────────────────────────
  const toggleOne   = (id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll   = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map(p => p._id)));
  };
  const allChecked  = products.length > 0 && selected.size === products.length;
  const someChecked = selected.size > 0 && selected.size < products.length;

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleDelete      = (id) => setConfirmId(id);
  const confirmDelete     = () => dispatch(deleteProduct(confirmId));
  const handleBatchDelete = () => setConfirmBatch(true);
  const confirmBatchDel   = () => dispatch(deleteMultipleProducts([...selected]));

  const activeFiltersCount = [
    statusFilter !== 'all',
    invFilter    !== 'all',
    catFilter    !== 'All',
    search.trim() !== '',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setStatusFilter('all');
    setInvFilter('all');
    setCatFilter('All');
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  // ── stat cards ─────────────────────────────────────────────────────────────
  // Note: stat card counts reflect the current page's products for filtered
  // counts (published, draft, etc.) since the server sends one page at a time.
  // totalCount always comes from the server's real total.
  const stats = [
    { label: 'Total',        value: totalCount,               key: 'all' },
    { label: 'Published',    value: publishedProducts.length, key: 'published', color: 'green' },
    { label: 'Drafts',       value: draftProducts.length,     key: 'draft',     color: 'amber' },
    { label: 'Archived',     value: archivedProducts.length,  key: 'archived',  color: 'grey' },
    { label: 'Low Stock',    value: lowStockProducts.length,  key: 'low',       color: 'orange' },
    { label: 'Out of Stock', value: outOfStockProducts.length,key: 'out',       color: 'red' },
    { label: 'Featured',     value: featuredProducts.length,  key: 'featured',  color: 'coral' },
    { label: 'On Sale',      value: onSaleProducts.length,    key: 'sale',      color: 'blue' },
  ];

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) 
    return( 
          <>  
          <Navbar />
          <Loader />
          <Footer />
          </>
    );
    

  return (
    <>
      <PageTitle title="Products — Admin" />
      <Navbar />

      <main className="pl-main">

        {/* ── Toast ── */}
        {toast && (
          <div className={`pl-toast pl-toast--${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : toast.type === 'warn' ? '⚠' : '✕'}</span>
            {toast.msg}
          </div>
        )}

        {/* ── Header ── */}

        <Link to="/admin/dashboard" className="ao-back-btn">
            <ArrowBack style={{ fontSize: 16 }} />
            Dashboard
        </Link>
                        
        <div className="pl-header">
          <div className="pl-header__left">
            <h1 className="pl-title">Products</h1>
            <span className="pl-subtitle">{totalCount} total products</span>
          </div>
          <button className="pl-btn pl-btn--primary" onClick={() => navigate('/admin/products/create')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Product
          </button>
        </div>

        {/* ── Stats ── */}
        <div className="pl-stats">
          {stats.map(s => (
            <div key={s.key} className={`pl-stat pl-stat--${s.color || 'default'}`}>
              <span className="pl-stat__value">{s.value}</span>
              <span className="pl-stat__label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="pl-toolbar">
          <div className="pl-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              placeholder="Search by name, brand, SKU, category…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            {searchInput && <button className="pl-search__clear" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>✕</button>}
          </div>

          <div className="pl-toolbar__actions">
            <button
              className={`pl-btn pl-btn--filter ${filtersOpen ? 'active' : ''}`}
              onClick={() => setFiltersOpen(v => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Filters
              {activeFiltersCount > 0 && <span className="pl-filter-badge">{activeFiltersCount}</span>}
            </button>

            <select className="pl-select" value={sortKey} onChange={e => setSortKey(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {selected.size > 0 && (
              <button
                className="pl-btn pl-btn--danger"
                onClick={handleBatchDelete}
                disabled={batchStatus.loading}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                Delete ({selected.size})
              </button>
            )}
          </div>
        </div>

        {/* ── Filter Panel ── */}
        {filtersOpen && (
          <div className="pl-filters">
            <div className="pl-filter-group">
              <label>Status</label>
              <div className="pl-filter-pills">
                {['all','published','draft','archived'].map(s => (
                  <button
                    key={s}
                    className={`pl-pill ${statusFilter === s ? 'active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'all' ? 'All' : STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="pl-filter-group">
              <label>Inventory</label>
              <div className="pl-filter-pills">
                {['all','InStock','LowStock','OutOfStock','Discontinued'].map(s => (
                  <button
                    key={s}
                    className={`pl-pill ${invFilter === s ? 'active' : ''}`}
                    onClick={() => setInvFilter(s)}
                  >
                    {s === 'all' ? 'All' : INV_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="pl-filter-group">
              <label>Category</label>
              <div className="pl-filter-pills pl-filter-pills--wrap">
                {CATEGORIES.map(c => (
                  <button
                    key={c}
                    className={`pl-pill ${catFilter === c ? 'active' : ''}`}
                    onClick={() => setCatFilter(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <button className="pl-btn pl-btn--ghost pl-filter-reset" onClick={resetFilters}>
              Reset all filters
            </button>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="pl-error">
            <span>⚠</span> {error}
            <button onClick={() => dispatch(fetchAdminProducts({ page, limit: 20 }))}>Retry</button>
          </div>
        )}

        {/* ── Table ── */}
        <div className="pl-table-wrap">
          {products.length === 0 ? (
            <div className="pl-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              <p>No products found</p>
              <span>Try adjusting your search or filters</span>
            </div>
          ) : (
            <table className="pl-table">
              <thead>
                <tr>
                  <th className="pl-th--check">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked; }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Product</th>
                  <th className="pl-th--hide-sm">Category</th>
                  <th>Price</th>
                  <th className="pl-th--hide-sm">Stock</th>
                  <th>Status</th>
                  <th className="pl-th--hide-md">Inventory</th>
                  <th className="pl-th--hide-md">Rating</th>
                  <th className="pl-th--hide-lg">Flags</th>
                  <th className="pl-th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, i) => {
                  const primaryImg = product.images?.find(img => img.isPrimary) || product.images?.[0];
                  const isChecked  = selected.has(product._id);
                  return (
                    <tr
                      key={product._id}
                      className={`pl-row ${isChecked ? 'pl-row--selected' : ''}`}
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <td className="pl-td--check">
                        <input type="checkbox" checked={isChecked} onChange={() => toggleOne(product._id)} />
                      </td>

                      <td className="pl-td--product">
                        <div className="pl-product-cell">
                          <div className="pl-product-img">
                            {primaryImg
                              ? <img src={primaryImg.url} alt={primaryImg.alt || product.name} loading="lazy" />
                              : <span className="pl-product-img--placeholder">{product.name?.[0]?.toUpperCase()}</span>
                            }
                          </div>
                          <div className="pl-product-info">
                            <span className="pl-product-name">{product.name}</span>
                            {product.brand && <span className="pl-product-brand">{product.brand}</span>}
                            {product.inventory?.sku && <span className="pl-product-sku">SKU: {product.inventory.sku}</span>}
                          </div>
                        </div>
                      </td>

                      <td className="pl-th--hide-sm">
                        <span className="pl-category">{product.category}</span>
                      </td>

                      <td className="pl-td--price">
                        <span className="pl-price-final">{fmt(product.pricing?.sale ?? product.pricing?.regular)}</span>
                        {product.pricing?.sale != null && (
                          <span className="pl-price-original">{fmt(product.pricing.regular)}</span>
                        )}
                      </td>

                      <td className="pl-th--hide-sm">
                        <span className={`pl-stock ${(product.inventory?.stock ?? 0) <= (product.inventory?.lowStockThreshold ?? 5) && product.inventory?.stock > 0 ? 'pl-stock--low' : ''} ${product.inventory?.stock === 0 ? 'pl-stock--out' : ''}`}>
                          {product.inventory?.stock ?? 0}
                        </span>
                      </td>

                      <td>
                        <span className={`pl-badge pl-badge--status pl-badge--${product.status}`}>
                          {STATUS_LABELS[product.status] || product.status}
                        </span>
                      </td>

                      <td className="pl-th--hide-md">
                        <span className={`pl-badge pl-badge--inv pl-badge--inv-${product.inventory?.status}`}>
                          {INV_LABELS[product.inventory?.status] || product.inventory?.status}
                        </span>
                      </td>

                      <td className="pl-th--hide-md">
                        <div className="pl-rating">
                          <span className="pl-rating__star">★</span>
                          <span>{product.ratings != null ? Number(product.ratings).toFixed(1) : '—'}</span>
                          <span className="pl-rating__count">({product.numOfReviews ?? 0})</span>
                        </div>
                      </td>

                      <td className="pl-th--hide-lg">
                        <div className="pl-flags">
                          {product.isFeatured   && <span className="pl-flag" title="Featured">★</span>}
                          {product.isBestseller && <span className="pl-flag" title="Bestseller">🏆</span>}
                          {product.isNewArrival && <span className="pl-flag" title="New Arrival">✦</span>}
                          {product.isOnSale     && <span className="pl-flag pl-flag--sale" title="On Sale">%</span>}
                        </div>
                      </td>

                      <td className="pl-td--actions">
                        <div className="pl-actions">
                          <button
                            className="pl-action-btn pl-action-btn--edit"
                            onClick={() => navigate(`/admin/product/${product._id}`)}
                            title="Edit"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button
                            className="pl-action-btn pl-action-btn--delete"
                            onClick={() => handleDelete(product._id)}
                            title="Delete"
                            disabled={deleteStatus.loading && confirmId === product._id}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="pl-pagination">
            <span className="pl-pagination__info">
              Showing {((currentPage - 1) * resultPerPage) + 1}–{Math.min(currentPage * resultPerPage, totalCount)} of {totalCount}
            </span>
            <div className="pl-pagination__controls">
              <button className="pl-page-btn" disabled={currentPage === 1} onClick={() => setPage(1)}>«</button>
              <button className="pl-page-btn" disabled={currentPage === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p;
                if (totalPages <= 5)           p = i + 1;
                else if (currentPage <= 3)     p = i + 1;
                else if (currentPage >= totalPages - 2) p = totalPages - 4 + i;
                else                           p = currentPage - 2 + i;
                return (
                  <button
                    key={p}
                    className={`pl-page-btn ${currentPage === p ? 'active' : ''}`}
                    onClick={() => setPage(p)}
                  >{p}</button>
                );
              })}
              <button className="pl-page-btn" disabled={currentPage === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
              <button className="pl-page-btn" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>»</button>
            </div>
          </div>
        )}
      </main>

      {/* ── Confirm Delete Single ── */}
      {confirmId && (
        <div className="pl-modal-overlay" onClick={() => setConfirmId(null)}>
          <div className="pl-modal" onClick={e => e.stopPropagation()}>
            <div className="pl-modal__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h3>Delete Product</h3>
            <p>This will permanently delete the product and all its images from Cloudinary. This action cannot be undone.</p>
            <div className="pl-modal__actions">
              <button className="pl-btn pl-btn--ghost" onClick={() => setConfirmId(null)}>Cancel</button>
              <button className="pl-btn pl-btn--danger" onClick={confirmDelete} disabled={deleteStatus.loading}>
                {deleteStatus.loading ? 'Deleting…' : 'Delete Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Batch Delete ── */}
      {confirmBatch && (
        <div className="pl-modal-overlay" onClick={() => setConfirmBatch(false)}>
          <div className="pl-modal" onClick={e => e.stopPropagation()}>
            <div className="pl-modal__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h3>Delete {selected.size} Products</h3>
            <p>This will permanently delete {selected.size} product{selected.size !== 1 ? 's' : ''} and their images. Failed deletions will be reported individually.</p>
            <div className="pl-modal__actions">
              <button className="pl-btn pl-btn--ghost" onClick={() => setConfirmBatch(false)}>Cancel</button>
              <button className="pl-btn pl-btn--danger" onClick={confirmBatchDel} disabled={batchStatus.loading}>
                {batchStatus.loading ? 'Deleting…' : `Delete ${selected.size} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}