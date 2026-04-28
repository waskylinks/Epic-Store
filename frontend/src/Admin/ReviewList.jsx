import React, { useEffect, useState, useMemo, useCallback } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

// ─── Import from your adminProductSlice (the correct slice) ──────────────────
import {
  fetchAdminProducts,
  fetchProductReviews,
  deleteProductReview,
  clearDeleteReviewStatus,
  selectAdminProducts,
  selectAdminProductsLoading,
  selectDeleteReviewStatus,
} from '../features/admin/adminProductSlice';

// ─── Constants ────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Newest First' },
  { value: 'oldest',   label: 'Oldest First' },
  { value: 'rating_hi', label: 'Rating High–Low' },
  { value: 'rating_lo', label: 'Rating Low–High' },
];

const ITEMS_PER_PAGE = 15;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const StarIcon = ({ filled }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const renderStars = (rating) =>
  [...Array(5)].map((_, i) => (
    <span
      key={i}
      style={{ color: i < rating ? '#F59E0B' : 'var(--ar-border-md)', lineHeight: 1 }}
    >
      <StarIcon filled={i < rating} />
    </span>
  ));

const getRatingColor = (rating) => {
  if (rating >= 4) return { bg: '#DCFCE7', color: '#15803D' };
  if (rating >= 3) return { bg: '#FEF3C7', color: '#B45309' };
  return { bg: '#FEE2E2', color: '#DC2626' };
};

const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

function SkeletonRows({ count = 8 }) {
  return Array.from({ length: count }).map((_, i) => (
    <tr key={i} className="ar-row ar-row--skeleton">
      <td>
        <div className="ar-product-cell">
          <div className="ar-skeleton ar-skeleton--thumb" />
          <div className="ar-skeleton ar-skeleton--text" style={{ width: '60%' }} />
        </div>
      </td>
      <td><div className="ar-skeleton ar-skeleton--text" style={{ width: '80px' }} /></td>
      <td className="ar-th--hide-sm"><div className="ar-skeleton ar-skeleton--badge" /></td>
      <td className="ar-th--hide-md"><div className="ar-skeleton ar-skeleton--text" style={{ width: '90%' }} /></td>
      <td className="ar-th--hide-lg"><div className="ar-skeleton ar-skeleton--text" style={{ width: '60px' }} /></td>
      <td><div className="ar-skeleton ar-skeleton--actions" /></td>
    </tr>
  ));
}

// ─── Main Component ───────────────────────────────────────────────────────────

function AllReviews() {
  const dispatch = useDispatch();

  // ── Selectors ──────────────────────────────────────────────────────────────
  const products           = useSelector(selectAdminProducts);
  const productsLoading    = useSelector(selectAdminProductsLoading);
  const deleteReviewStatus = useSelector(selectDeleteReviewStatus);

  // ── Local state ────────────────────────────────────────────────────────────
  const [flatReviews,    setFlatReviews]    = useState([]);
  const [searchInput,    setSearchInput]    = useState('');
  const [search,         setSearch]         = useState('');
  const [filterRating,   setFilterRating]   = useState('all');
  const [sortKey,        setSortKey]        = useState('newest');
  const [page,           setPage]           = useState(1);
  const [filtersOpen,    setFiltersOpen]    = useState(false);
  const [isFirstLoad,    setIsFirstLoad]    = useState(true);
  const [loadProgress,   setLoadProgress]   = useState({ done: 0, total: 0 });

  const [modal, setModal] = useState({
    type: '',      // 'view' | 'delete'
    open: false,
    review: null,
  });

  // ── Step 1: Load all published products ───────────────────────────────────
  useEffect(() => {
    dispatch(fetchAdminProducts({ limit: 100, status: 'published' }));
  }, [dispatch]);

  // ── Step 2: For each product fetch its reviews, then flatten ──────────────
  // We do this in-component because there's no "all reviews" endpoint.
  // The reviews are fetched sequentially in small batches to avoid hammering.
  useEffect(() => {
    if (!products || products.length === 0) return;

    let cancelled = false;
    const productsWithReviews = products.filter(p => (p.numOfReviews || 0) > 0);

    if (productsWithReviews.length === 0) {
      setFlatReviews([]);
      setIsFirstLoad(false);
      return;
    }

    setLoadProgress({ done: 0, total: productsWithReviews.length });

    const fetchAll = async () => {
      const collected = [];

      for (let i = 0; i < productsWithReviews.length; i++) {
        if (cancelled) break;
        const product = productsWithReviews[i];
        try {
          const result = await dispatch(fetchProductReviews(product._id)).unwrap();
          if (result && result.length > 0) {
            result.forEach(r => {
              collected.push({
                ...r,
                productId:    product._id,
                productName:  product.name,
                productImage: product.images?.find(img => img.isPrimary)?.url
                              || product.images?.[0]?.url
                              || null,
                productSlug:  product.slug,
              });
            });
          }
        } catch {
          // Skip products where review fetch fails (don't crash the page)
        }
        if (!cancelled) {
          setLoadProgress({ done: i + 1, total: productsWithReviews.length });
        }
      }

      if (!cancelled) {
        setFlatReviews(collected);
        setIsFirstLoad(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // ── Debounce search ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [filterRating, sortKey]);

  // ── Delete status ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (deleteReviewStatus.success) {
      toast.success('Review deleted successfully!', { position: 'top-center', autoClose: 3000 });
      dispatch(clearDeleteReviewStatus());
      // Remove from local flat list immediately (optimistic UI)
      if (modal.review) {
        setFlatReviews(prev =>
          prev.filter(r => String(r._id) !== String(modal.review._id))
        );
      }
      setModal({ type: '', open: false, review: null });
    }
    if (deleteReviewStatus.error) {
      toast.error(deleteReviewStatus.error || 'Failed to delete review', {
        position: 'top-center',
        autoClose: 3000,
      });
      dispatch(clearDeleteReviewStatus());
    }
  }, [deleteReviewStatus.success, deleteReviewStatus.error, dispatch, modal.review]);

  // ── Filter + Search + Sort ─────────────────────────────────────────────────
  const processed = useMemo(() => {
    let list = flatReviews;

    if (filterRating !== 'all') {
      list = list.filter(r => r.rating === Number(filterRating));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.productName?.toLowerCase().includes(q) ||
        r.name?.toLowerCase().includes(q) ||
        r.comment?.toLowerCase().includes(q) ||
        r.reviewTitle?.toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    if (sortKey === 'newest')     sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    else if (sortKey === 'oldest')    sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    else if (sortKey === 'rating_hi') sorted.sort((a, b) => b.rating - a.rating);
    else if (sortKey === 'rating_lo') sorted.sort((a, b) => a.rating - b.rating);

    return sorted;
  }, [flatReviews, filterRating, search, sortKey]);

  const totalPages  = Math.ceil(processed.length / ITEMS_PER_PAGE);
  const paginated   = processed.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total   = flatReviews.length;
    const avgRating = total > 0
      ? Math.round((flatReviews.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10
      : 0;
    const five    = flatReviews.filter(r => r.rating === 5).length;
    const low     = flatReviews.filter(r => r.rating <= 2).length;
    const verified = flatReviews.filter(r => r.verified).length;
    return { total, avgRating, five, low, verified };
  }, [flatReviews]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAction = useCallback((type, review) => {
    setModal({ type, open: true, review });
  }, []);

  const executeDelete = useCallback(() => {
    if (!modal.review) return;
    dispatch(deleteProductReview({
      productId: modal.review.productId,
      reviewId:  modal.review._id,
    }));
  }, [dispatch, modal.review]);

  const activeFiltersCount = [filterRating !== 'all', search.trim() !== ''].filter(Boolean).length;

  const resetFilters = () => {
    setFilterRating('all');
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  const isLoading = productsLoading || (isFirstLoad && loadProgress.total > 0 && loadProgress.done < loadProgress.total);

  // ── First-load skeleton ────────────────────────────────────────────────────
  if (isFirstLoad && (productsLoading || loadProgress.total > 0)) {
    return (
      <>
        <Navbar />
        <main className="ar-main">
          <div className="ar-skeleton-page">
            <div className="ar-skeleton ar-skeleton--title" style={{ marginBottom: 20 }} />
            {loadProgress.total > 0 && (
              <div className="ar-progress-bar">
                <div
                  className="ar-progress-fill"
                  style={{ width: `${Math.round((loadProgress.done / loadProgress.total) * 100)}%` }}
                />
                <span className="ar-progress-label">
                  Loading reviews… {loadProgress.done}/{loadProgress.total} products
                </span>
              </div>
            )}
            <div className="ar-skeleton-stats">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="ar-stat ar-stat--skeleton">
                  <div className="ar-skeleton ar-skeleton--stat-val" />
                  <div className="ar-skeleton ar-skeleton--stat-label" />
                </div>
              ))}
            </div>
            <div className="ar-skeleton ar-skeleton--toolbar" style={{ marginBottom: 16 }} />
            <div className="ar-skeleton" style={{ height: 380, borderRadius: 12 }} />
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title="All Reviews — Admin" />
      <Navbar />

      <main className="ar-main">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="ar-header">
          <div className="ar-header__left">
            <h1 className="ar-title">Reviews</h1>
            <span className="ar-subtitle">{stats.total.toLocaleString()} total reviews</span>
          </div>
        </div>

        {/* ── Stats ──────────────────────────────────────────────────── */}
        <div className="ar-stats">
          <div className="ar-stat ar-stat--coral">
            <span className="ar-stat__value">{stats.total.toLocaleString()}</span>
            <span className="ar-stat__label">Total Reviews</span>
          </div>
          <div className="ar-stat ar-stat--amber">
            <span className="ar-stat__value">{stats.avgRating > 0 ? stats.avgRating : '—'}</span>
            <span className="ar-stat__label">Avg Rating</span>
          </div>
          <div className="ar-stat ar-stat--green">
            <span className="ar-stat__value">{stats.five.toLocaleString()}</span>
            <span className="ar-stat__label">5-Star Reviews</span>
          </div>
          <div className="ar-stat ar-stat--red">
            <span className="ar-stat__value">{stats.low.toLocaleString()}</span>
            <span className="ar-stat__label">Low Ratings (≤2)</span>
          </div>
          <div className="ar-stat ar-stat--blue">
            <span className="ar-stat__value">{stats.verified.toLocaleString()}</span>
            <span className="ar-stat__label">Verified</span>
          </div>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────── */}
        <div className="ar-toolbar">
          <div className="ar-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by product, reviewer, or comment…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                className="ar-search__clear"
                onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
              >✕</button>
            )}
          </div>

          <div className="ar-toolbar__actions">
            <button
              className={`ar-btn ar-btn--filter ${filtersOpen ? 'active' : ''}`}
              onClick={() => setFiltersOpen(v => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filters
              {activeFiltersCount > 0 && (
                <span className="ar-filter-badge">{activeFiltersCount}</span>
              )}
            </button>

            <select
              className="ar-select"
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Filter Panel ────────────────────────────────────────────── */}
        {filtersOpen && (
          <div className="ar-filters">
            <div className="ar-filter-group">
              <label>Filter by Rating</label>
              <div className="ar-filter-pills">
                {['all', '5', '4', '3', '2', '1'].map(r => (
                  <button
                    key={r}
                    className={`ar-pill ${filterRating === r ? 'active' : ''}`}
                    onClick={() => setFilterRating(r)}
                  >
                    {r === 'all' ? 'All Ratings' : `${r} Star${r === '1' ? '' : 's'}`}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="ar-btn ar-btn--ghost"
              style={{ alignSelf: 'flex-start', padding: '6px 14px', fontSize: '12.5px' }}
              onClick={resetFilters}
            >
              Reset filters
            </button>
          </div>
        )}

        {/* ── Table ──────────────────────────────────────────────────── */}
        <div className={`ar-table-wrap ${isLoading && !isFirstLoad ? 'ar-table-wrap--loading' : ''}`}>
          {!isLoading && paginated.length === 0 ? (
            <div className="ar-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p>No reviews found</p>
              <span>
                {flatReviews.length === 0
                  ? 'No reviews exist yet across any products.'
                  : 'Try adjusting your search or filters.'}
              </span>
            </div>
          ) : (
            <table className="ar-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Reviewer</th>
                  <th className="ar-th--hide-sm">Rating</th>
                  <th className="ar-th--hide-md">Comment</th>
                  <th className="ar-th--hide-lg">Date</th>
                  <th className="ar-th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? <SkeletonRows count={ITEMS_PER_PAGE} />
                  : paginated.map((review, i) => {
                    const ratingColors = getRatingColor(review.rating);
                    return (
                      <tr
                        key={review._id}
                        className="ar-row"
                        style={{ animationDelay: `${i * 18}ms` }}
                      >
                        {/* Product */}
                        <td className="ar-td--product">
                          <div className="ar-product-cell">
                            {review.productImage ? (
                              <img
                                src={review.productImage}
                                alt={review.productName}
                                className="ar-product-thumb"
                                loading="lazy"
                              />
                            ) : (
                              <div className="ar-product-thumb ar-product-thumb--placeholder">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <polyline points="21 15 16 10 5 21" />
                                </svg>
                              </div>
                            )}
                            <span className="ar-product-name" title={review.productName}>
                              {review.productName || 'Unknown Product'}
                            </span>
                          </div>
                        </td>

                        {/* Reviewer */}
                        <td>
                          <div className="ar-reviewer-cell">
                            <div className="ar-reviewer-avatar">
                              {(review.name || 'A').charAt(0).toUpperCase()}
                            </div>
                            <div className="ar-reviewer-info">
                              <span className="ar-reviewer-name">{review.name || 'Anonymous'}</span>
                              {review.verified && (
                                <span className="ar-verified-chip">✓ Verified</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Rating */}
                        <td className="ar-th--hide-sm">
                          <div className="ar-rating-cell">
                            <span
                              className="ar-rating-badge"
                              style={{ background: ratingColors.bg, color: ratingColors.color }}
                            >
                              {review.rating}/5
                            </span>
                            <div className="ar-stars">
                              {renderStars(review.rating)}
                            </div>
                          </div>
                        </td>

                        {/* Comment */}
                        <td className="ar-th--hide-md">
                          <div className="ar-comment-cell">
                            {review.reviewTitle && (
                              <span className="ar-comment-title">{review.reviewTitle}</span>
                            )}
                            <span className="ar-comment-body">
                              {review.comment || <em style={{ color: 'var(--ar-text-xs)' }}>No comment</em>}
                            </span>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="ar-th--hide-lg ar-date-cell">
                          {formatDate(review.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="ar-td--actions">
                          <div className="ar-actions">
                            <button
                              className="ar-action-btn ar-action-btn--view"
                              onClick={() => handleAction('view', review)}
                              title="View review"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            <button
                              className="ar-action-btn ar-action-btn--delete"
                              onClick={() => handleAction('delete', review)}
                              title="Delete review"
                              disabled={deleteReviewStatus.loading}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ─────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="ar-pagination">
            <span className="ar-pagination__info">
              Showing {((page - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(page * ITEMS_PER_PAGE, processed.length).toLocaleString()} of {processed.length.toLocaleString()}
            </span>
            <div className="ar-pagination__controls">
              <button className="ar-page-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
              <button className="ar-page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p;
                if (totalPages <= 5)             p = i + 1;
                else if (page <= 3)              p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else                             p = page - 2 + i;
                return (
                  <button
                    key={p}
                    className={`ar-page-btn ${page === p ? 'active' : ''}`}
                    onClick={() => setPage(p)}
                  >{p}</button>
                );
              })}
              <button className="ar-page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
              <button className="ar-page-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
            </div>
          </div>
        )}
      </main>

      <Footer />

      {/* ── Modal Overlay ──────────────────────────────────────────── */}
      {modal.open && modal.review && (
        <div
          className="ar-modal-overlay"
          onClick={() => !deleteReviewStatus.loading && setModal({ type: '', open: false, review: null })}
        >
          <div className="ar-modal" onClick={e => e.stopPropagation()}>

            {/* View Modal */}
            {modal.type === 'view' && (
              <>
                <div className="ar-modal__header">
                  <h3>Review Details</h3>
                  <button
                    className="ar-modal__close"
                    onClick={() => setModal({ type: '', open: false, review: null })}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="ar-modal__body">
                  {/* Product row */}
                  <div className="ar-modal-product-row">
                    {modal.review.productImage && (
                      <img
                        src={modal.review.productImage}
                        alt={modal.review.productName}
                        className="ar-modal-product-img"
                      />
                    )}
                    <div>
                      <div className="ar-modal-product-name">{modal.review.productName}</div>
                      <div className="ar-modal-product-label">Product</div>
                    </div>
                  </div>

                  <div className="ar-modal-divider" />

                  {/* Info grid */}
                  <div className="ar-modal-grid">
                    <div className="ar-modal-field">
                      <label>Reviewer</label>
                      <span>{modal.review.name || 'Anonymous'}</span>
                    </div>
                    <div className="ar-modal-field">
                      <label>Rating</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="ar-stars">{renderStars(modal.review.rating)}</div>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>
                          {modal.review.rating}/5
                        </span>
                      </div>
                    </div>
                    <div className="ar-modal-field">
                      <label>Date</label>
                      <span>{formatDate(modal.review.createdAt)}</span>
                    </div>
                    <div className="ar-modal-field">
                      <label>Verified Purchase</label>
                      <span className={modal.review.verified ? 'ar-chip ar-chip--green' : 'ar-chip ar-chip--gray'}>
                        {modal.review.verified ? '✓ Yes' : '✕ No'}
                      </span>
                    </div>
                  </div>

                  {modal.review.reviewTitle && (
                    <div className="ar-modal-field ar-modal-field--full">
                      <label>Review Title</label>
                      <span style={{ fontWeight: 600 }}>{modal.review.reviewTitle}</span>
                    </div>
                  )}

                  <div className="ar-modal-field ar-modal-field--full">
                    <label>Comment</label>
                    <p className="ar-modal-comment">
                      {modal.review.comment || 'No comment provided.'}
                    </p>
                  </div>

                  {modal.review.pros?.length > 0 && (
                    <div className="ar-modal-field ar-modal-field--full">
                      <label>Pros</label>
                      <ul className="ar-modal-list ar-modal-list--pros">
                        {modal.review.pros.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}

                  {modal.review.cons?.length > 0 && (
                    <div className="ar-modal-field ar-modal-field--full">
                      <label>Cons</label>
                      <ul className="ar-modal-list ar-modal-list--cons">
                        {modal.review.cons.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="ar-modal__footer">
                  <button
                    className="ar-btn ar-btn--ghost"
                    onClick={() => setModal({ type: '', open: false, review: null })}
                  >
                    Close
                  </button>
                  <button
                    className="ar-btn ar-btn--danger"
                    onClick={() => setModal(prev => ({ ...prev, type: 'delete' }))}
                  >
                    Delete Review
                  </button>
                </div>
              </>
            )}

            {/* Delete Modal */}
            {modal.type === 'delete' && (
              <>
                <div className="ar-modal__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="ar-modal__header ar-modal__header--center">
                  <h3>Delete Review</h3>
                </div>
                <div className="ar-modal__body">
                  <p className="ar-modal-warning">
                    This action is permanent and cannot be undone.
                  </p>
                  <div className="ar-delete-summary">
                    <div><strong>Product:</strong> {modal.review.productName}</div>
                    <div><strong>Reviewer:</strong> {modal.review.name || 'Anonymous'}</div>
                    <div>
                      <strong>Rating:</strong>{' '}
                      <span style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }}>
                        {renderStars(modal.review.rating)}
                      </span>{' '}
                      ({modal.review.rating}/5)
                    </div>
                    {modal.review.comment && (
                      <div style={{ marginTop: 8, fontStyle: 'italic', color: 'var(--ar-text-muted)', fontSize: 13 }}>
                        "{modal.review.comment.substring(0, 100)}{modal.review.comment.length > 100 ? '…' : ''}"
                      </div>
                    )}
                  </div>
                </div>
                <div className="ar-modal__footer">
                  <button
                    className="ar-btn ar-btn--ghost"
                    onClick={() => setModal({ type: '', open: false, review: null })}
                    disabled={deleteReviewStatus.loading}
                  >
                    Cancel
                  </button>
                  <button
                    className="ar-btn ar-btn--danger"
                    onClick={executeDelete}
                    disabled={deleteReviewStatus.loading}
                  >
                    {deleteReviewStatus.loading ? 'Deleting…' : 'Delete Review'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default AllReviews;