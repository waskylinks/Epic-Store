import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Search,
  Refresh,
  Visibility,
  Add,
  Edit,
  Delete,
  LocalOffer,
  CheckCircle,
  Schedule,
  ArrowBack,
  Warning,
  ContentCopy,
  Done,
  BarChart,
  FilterList,
  Close,
  HourglassEmpty,
  AutoFixHigh,
  TrendingUp,
} from '@mui/icons-material';

import {
  getAllDiscounts,
  getSingleDiscount,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  getDiscountStats,
  triggerCleanup,
  clearAdminDiscountState,
  clearCurrentDiscount,
  clearCleanupResult,
} from '../features/discounts/adminDiscountSlice';

import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/AdminDiscounts.css';

// ── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Copy to clipboard hook ────────────────────────────────────────────────────
function useCopyCode() {
  const [copiedId, setCopiedId] = useState(null);
  const copy = useCallback((code, id) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);
  return { copiedId, copy };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
const fmtCurrency = (n) => `$${(typeof n === 'number' ? n : 0).toFixed(2)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const getDaysUntil = (date) => {
  if (!date) return null;
  const diff = new Date(date) - new Date();
  return Math.ceil(diff / 86400000);
};

const getExpiryUrgency = (date) => {
  const days = getDaysUntil(date);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= 2) return 'critical';
  if (days <= 7) return 'warning';
  return 'safe';
};

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_FILTERS = [
  { value: '',         label: 'All'      },
  { value: 'active',   label: 'Active'   },
  { value: 'inactive', label: 'Inactive' },
  { value: 'expired',  label: 'Expired'  },
];

const CATEGORY_FILTERS = [
  { value: '',          label: 'All Categories' },
  { value: 'promo',     label: 'Promo'          },
  { value: 'refund',    label: 'Refund'         },
  { value: 'return',    label: 'Return'         },
  { value: 'loyalty',   label: 'Loyalty'        },
  { value: 'affiliate', label: 'Affiliate'      },
  { value: 'support',   label: 'Support'        },
];

const TYPE_OPTIONS = [
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'fixed',      label: 'Fixed ($)'      },
];

const CATEGORY_OPTIONS = [
  { value: 'promo',     label: 'Promo'     },
  { value: 'refund',    label: 'Refund'    },
  { value: 'return',    label: 'Return'    },
  { value: 'loyalty',   label: 'Loyalty'   },
  { value: 'affiliate', label: 'Affiliate' },
  { value: 'support',   label: 'Support'   },
];

const CATEGORY_COLOR = {
  promo:     'promo',
  refund:    'refund',
  return:    'return',
  loyalty:   'loyalty',
  affiliate: 'affiliate',
  support:   'support',
};

const EMPTY_FORM = {
  code: '', description: '', type: 'percentage', value: '',
  category: 'promo', validFrom: '', validUntil: '',
  usageLimit: { totalUses: '', usesPerUser: 1 },
  conditions: {
    minPurchaseAmount: 0, maxDiscountAmount: '',
    excludeSaleItems: false, firstOrderOnly: false,
  },
  notes: '',
};

// ── Component ─────────────────────────────────────────────────────────────────
const AdminDiscounts = () => {
  const dispatch   = useDispatch();
  const navigate   = useNavigate();
  const location   = useLocation();
  const { copiedId, copy } = useCopyCode();

  const {
    currentDiscount,
    stats,
    categoryStats,
    cleanupResult,
    discountsLoading,
    actionLoading,
    statsLoading,
    error,
    success,
    message: successMessage,
  } = useSelector((state) => state.adminDiscount);

  // ── Return flow pre-fill ──────────────────────────────────────────────────
  const fromReturn   = location.state?.fromReturn   ?? false;
  const returnData   = location.state?.returnData   ?? null;

  // ── Filter / search state ─────────────────────────────────────────────────
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [searchQuery,    setSearchQuery]    = useState('');
  const [cursor,         setCursor]         = useState(null);
  const [allDiscounts,   setAllDiscounts]   = useState([]);
  const [hasMore,        setHasMore]        = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab,        setActiveTab]        = useState('list');
  const [showCreateModal,  setShowCreateModal]  = useState(false);
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [showDeleteConfirm,setShowDeleteConfirm]= useState(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [isEditing,        setIsEditing]        = useState(false);
  const [cleanupDays,      setCleanupDays]      = useState(90);

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});

  const searchDebounced = useDebounce(searchQuery, 400);
  const filtersRef = useRef({});
  filtersRef.current = { filterStatus, filterCategory, searchDebounced };

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch(getDiscountStats());
    fetchFirstPage();
    if (fromReturn && returnData) {
      prefillFromReturn(returnData);
      setShowCreateModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterCategory, searchDebounced]);

  const buildParams = useCallback((cursorVal = null) => {
    const f = filtersRef.current;
    const p = { limit: 20 };
    if (f.filterStatus)   p.status   = f.filterStatus;
    if (f.filterCategory) p.category = f.filterCategory;
    if (f.searchDebounced.trim()) p.search = f.searchDebounced.trim();
    if (cursorVal) p.cursor = cursorVal;
    return p;
  }, []);

  const fetchFirstPage = useCallback(async () => {
    setCursor(null);
    setAllDiscounts([]);
    const result = await dispatch(getAllDiscounts(buildParams(null)));
    if (getAllDiscounts.fulfilled.match(result)) {
      setAllDiscounts(result.payload.discounts ?? []);
      setHasMore(result.payload.pagination?.hasNextPage ?? false);
      setCursor(result.payload.pagination?.nextCursor ?? null);
    }
  }, [dispatch, buildParams]);

  const fetchNextPage = useCallback(async () => {
    if (!cursor || !hasMore || discountsLoading) return;
    const result = await dispatch(getAllDiscounts(buildParams(cursor)));
    if (getAllDiscounts.fulfilled.match(result)) {
      setAllDiscounts((prev) => [...prev, ...(result.payload.discounts ?? [])]);
      setHasMore(result.payload.pagination?.hasNextPage ?? false);
      setCursor(result.payload.pagination?.nextCursor ?? null);
    }
  }, [cursor, hasMore, discountsLoading, dispatch, buildParams]);

  // ── Pre-fill from return flow ─────────────────────────────────────────────
  const prefillFromReturn = useCallback((data) => {
    if (!data) return;
    setForm({
      ...EMPTY_FORM,
      description: `Return compensation — Order ref: ${data.orderReference ?? ''}`,
      type: 'fixed',
      value: data.discountValue ?? '',
      category: 'return',
      validUntil: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().split('T')[0];
      })(),
      notes: `Auto-generated from return. Customer: ${data.customerName ?? ''} (${data.customerEmail ?? ''})`,
    });
  }, []);

  // ── Toast auto-dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => dispatch(clearAdminDiscountState()), 3000);
    return () => clearTimeout(t);
  }, [success, dispatch]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => dispatch(clearAdminDiscountState()), 5000);
    return () => clearTimeout(t);
  }, [error, dispatch]);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const setField = (path, value) => {
    setForm((prev) => {
      const next = { ...prev };
      const parts = path.split('.');
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = { ...cur[parts[i]] };
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const validateForm = () => {
    const errs = {};
    if (!form.code.trim() && !isEditing) errs.code = 'Code is required';
    if (!form.description.trim()) errs.description = 'Description is required';
    if (!form.value || isNaN(Number(form.value)) || Number(form.value) <= 0)
      errs.value = 'Value must be a positive number';
    if (form.type === 'percentage' && Number(form.value) > 100)
      errs.value = 'Percentage cannot exceed 100';
    if (!form.validUntil) errs.validUntil = 'Expiry date is required';
    if (form.validFrom && form.validUntil && new Date(form.validFrom) >= new Date(form.validUntil))
      errs.validUntil = 'Expiry must be after start date';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOpenCreate = () => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setIsEditing(false);
    setShowCreateModal(true);
  };

  const handleOpenEdit = (discount) => {
    setForm({
      code: discount.code ?? '',
      description: discount.description ?? '',
      type: discount.type ?? 'percentage',
      value: discount.value ?? '',
      category: discount.category ?? 'promo',
      validFrom: discount.validFrom ? discount.validFrom.split('T')[0] : '',
      validUntil: discount.validUntil ? discount.validUntil.split('T')[0] : '',
      usageLimit: {
        totalUses: discount.usageLimit?.totalUses ?? '',
        usesPerUser: discount.usageLimit?.usesPerUser ?? 1,
      },
      conditions: {
        minPurchaseAmount: discount.conditions?.minPurchaseAmount ?? 0,
        maxDiscountAmount: discount.conditions?.maxDiscountAmount ?? '',
        excludeSaleItems: discount.conditions?.excludeSaleItems ?? false,
        firstOrderOnly: discount.conditions?.firstOrderOnly ?? false,
      },
      notes: discount.notes ?? '',
    });
    setFormErrors({});
    setIsEditing(true);
    setShowCreateModal(true);
  };

  const handleSubmitForm = async () => {
    if (!validateForm()) return;

    const payload = {
      ...form,
      value: Number(form.value),
      usageLimit: {
        totalUses: form.usageLimit.totalUses ? Number(form.usageLimit.totalUses) : null,
        usesPerUser: Number(form.usageLimit.usesPerUser) || 1,
      },
      conditions: {
        ...form.conditions,
        minPurchaseAmount: Number(form.conditions.minPurchaseAmount) || 0,
        maxDiscountAmount: form.conditions.maxDiscountAmount
          ? Number(form.conditions.maxDiscountAmount)
          : null,
      },
    };

    let result;
    if (isEditing && currentDiscount) {
      result = await dispatch(updateDiscount({ id: currentDiscount._id, discountData: payload }));
    } else {
      result = await dispatch(createDiscount(payload));
    }

    if (createDiscount.fulfilled.match(result) || updateDiscount.fulfilled.match(result)) {
      setShowCreateModal(false);
      dispatch(clearCurrentDiscount());
      fetchFirstPage();
      dispatch(getDiscountStats());
    }
  };

  const handleViewDetail = async (id) => {
    setShowDetailDrawer(true);
    await dispatch(getSingleDiscount(id));
  };

  const handleDelete = async (id) => {
    const result = await dispatch(deleteDiscount(id));
    if (deleteDiscount.fulfilled.match(result)) {
      setShowDeleteConfirm(null);
      fetchFirstPage();
      dispatch(getDiscountStats());
    }
  };

  const handleCleanup = async () => {
    const result = await dispatch(triggerCleanup({ daysOld: cleanupDays }));
    if (triggerCleanup.fulfilled.match(result)) {
      setShowCleanupModal(false);
      fetchFirstPage();
      dispatch(getDiscountStats());
    }
  };

  const handleCloseDrawer = () => {
    setShowDetailDrawer(false);
    dispatch(clearCurrentDiscount());
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const overallStats = useMemo(() => ({
    total:      stats?.total      ?? 0,
    active:     stats?.active     ?? 0,
    expired:    stats?.expired    ?? 0,
    totalUses:  stats?.totalUses  ?? 0,
  }), [stats]);

  // ── Render: KPI cards ─────────────────────────────────────────────────────
  const renderKPIs = () => {
    if (statsLoading) {
      return Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="ad-kpi">
          <div className="ad-skel" style={{ width: 40, height: 40, borderRadius: 10, marginBottom: 14 }} />
          <div className="ad-skel" style={{ width: '50%', height: 10, marginBottom: 8 }} />
          <div className="ad-skel" style={{ width: '70%', height: 28 }} />
        </div>
      ));
    }
    const cards = [
      { label: 'Total Codes',  value: overallStats.total,    icon: LocalOffer,    color: '#6366F1' },
      { label: 'Active',       value: overallStats.active,   icon: CheckCircle,   color: '#10B981' },
      { label: 'Expired',      value: overallStats.expired,  icon: HourglassEmpty,color: '#F59E0B' },
      { label: 'Total Uses',   value: overallStats.totalUses,icon: TrendingUp,    color: '#0EA5E9' },
    ];
    return cards.map((c) => (
      <div key={c.label} className="ad-kpi" style={{ '--kpi-color': c.color }}>
        <div className="ad-kpi-top">
          <span className="ad-kpi-icon" style={{ background: `${c.color}18`, color: c.color }}>
            <c.icon style={{ fontSize: 20 }} />
          </span>
        </div>
        <div className="ad-kpi-label">{c.label}</div>
        <div className="ad-kpi-value">{c.value.toLocaleString()}</div>
      </div>
    ));
  };

  // ── Render: category stats table ──────────────────────────────────────────
  const renderCategoryStats = () => {
    if (statsLoading) {
      return (
        <div className="ad-card">
          <div className="ad-card-hd"><h3 className="ad-card-title">Usage by Category</h3></div>
          <div className="ad-card-body">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} className="ad-skel" style={{ height: 14, flex: 1 }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (!categoryStats?.length) return null;
    return (
      <div className="ad-card">
        <div className="ad-card-hd">
          <div>
            <h3 className="ad-card-title">
              <BarChart style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />
              Usage by Category
            </h3>
            <p className="ad-card-sub">Discount performance across all categories</p>
          </div>
        </div>
        <div className="ad-card-body--np">
          <div className="ad-tbl-wrap">
            <table className="ad-tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Total</th>
                  <th>Active</th>
                  <th>Uses</th>
                  <th>Value Given</th>
                </tr>
              </thead>
              <tbody>
                {categoryStats.map((row) => (
                  <tr key={row._id}>
                    <td>
                      <span className={`ad-category ad-category--${CATEGORY_COLOR[row._id] ?? 'promo'}`}>
                        {row._id}
                      </span>
                    </td>
                    <td className="ad-td-num">{row.totalDiscounts}</td>
                    <td className="ad-td-num">{row.activeDiscounts}</td>
                    <td className="ad-td-num">{row.totalUses}</td>
                    <td className="ad-td-money">{fmtCurrency(row.totalDiscountValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: discount table ────────────────────────────────────────────────
  const renderTable = () => {
    if (discountsLoading && allDiscounts.length === 0) {
      return (
        <div style={{ padding: 20 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {Array.from({ length: 7 }).map((__, j) => (
                <div key={j} className="ad-skel" style={{ height: 16, flex: 1 }} />
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (!discountsLoading && allDiscounts.length === 0) {
      return (
        <div className="ad-empty">
          <LocalOffer style={{ fontSize: 36, color: '#D1D5DB' }} />
          <span>No discount codes found</span>
          <button type="button" className="ad-btn ad-btn--primary" onClick={handleOpenCreate}>
            <Add style={{ fontSize: 15 }} /> Create First Code
          </button>
        </div>
      );
    }

    return (
      <div className="ad-tbl-wrap">
        {discountsLoading && allDiscounts.length > 0 && <div className="ad-loading-bar" />}
        <table className="ad-tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Type</th>
              <th>Category</th>
              <th>Value</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {allDiscounts.map((d) => {
              const urgency = getExpiryUrgency(d.validUntil);
              const remaining = d.usageLimit?.totalUses != null
                ? `${d.usageLimit.currentUses ?? 0} / ${d.usageLimit.totalUses}`
                : `${d.usageLimit?.currentUses ?? 0} / ∞`;
              return (
                <tr key={d._id}>
                  <td>
                    <div className="ad-code-cell">
                      <span className="ad-code-text">{d.code}</span>
                      <button
                        type="button"
                        className="ad-copy-btn"
                        onClick={() => copy(d.code, d._id)}
                        title="Copy code"
                      >
                        {copiedId === d._id
                          ? <Done style={{ fontSize: 13 }} />
                          : <ContentCopy style={{ fontSize: 13 }} />}
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={`ad-type-badge ad-type-badge--${d.type}`}>
                      {d.type === 'percentage' ? `${d.value}%` : fmtCurrency(d.value)}
                    </span>
                  </td>
                  <td>
                    <span className={`ad-category ad-category--${CATEGORY_COLOR[d.category] ?? 'promo'}`}>
                      {d.category}
                    </span>
                  </td>
                  <td className="ad-td-money">
                    {d.type === 'percentage' ? `${d.value}%` : fmtCurrency(d.value)}
                  </td>
                  <td className="ad-td-num ad-td-mono">{remaining}</td>
                  <td>
                    <span className={`ad-expiry ad-expiry--${urgency}`}>
                      {urgency === 'expired' ? 'Expired' : fmtDate(d.validUntil)}
                    </span>
                  </td>
                  <td>
                    <span className={`ad-status ad-status--${d.status}`}>
                      {d.status}
                    </span>
                  </td>
                  <td>
                    <div className="ad-action-btns">
                      <button
                        type="button"
                        className="ad-icon-btn"
                        onClick={() => handleViewDetail(d._id)}
                        title="View Details"
                      >
                        <Visibility style={{ fontSize: 15 }} />
                      </button>
                      <button
                        type="button"
                        className="ad-icon-btn"
                        onClick={() => {
                          dispatch(getSingleDiscount(d._id)).then((res) => {
                            if (getSingleDiscount.fulfilled.match(res)) handleOpenEdit(res.payload.discount);
                          });
                        }}
                        title="Edit"
                      >
                        <Edit style={{ fontSize: 15 }} />
                      </button>
                      <button
                        type="button"
                        className="ad-icon-btn ad-icon-btn--danger"
                        onClick={() => setShowDeleteConfirm(d._id)}
                        title="Delete"
                        disabled={d.status === 'inactive'}
                      >
                        <Delete style={{ fontSize: 15 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasMore && (
          <div className="ad-load-more">
            <button
              type="button"
              className="ad-btn ad-btn--secondary"
              onClick={fetchNextPage}
              disabled={discountsLoading}
            >
              {discountsLoading ? 'Loading…' : 'Load More'}
            </button>
            <span className="ad-load-more-hint">Showing {allDiscounts.length} codes</span>
          </div>
        )}
      </div>
    );
  };

  // ── Render: create / edit modal ───────────────────────────────────────────
  const renderModal = () => {
    if (!showCreateModal) return null;
    return (
      <div className="ad-modal-overlay" onClick={() => setShowCreateModal(false)} role="presentation">
        <div className="ad-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="ad-modal-hd">
            <div className="ad-modal-hd-left">
              {fromReturn && !isEditing && (
                <span className="ad-return-badge">
                  <AutoFixHigh style={{ fontSize: 13 }} />
                  From Return
                </span>
              )}
              <h2 className="ad-modal-title">
                {isEditing ? 'Edit Discount Code' : 'Create Discount Code'}
              </h2>
            </div>
            <button type="button" className="ad-modal-close" onClick={() => setShowCreateModal(false)} aria-label="Close">
              <Close style={{ fontSize: 18 }} />
            </button>
          </div>

          <div className="ad-modal-body">
            {fromReturn && !isEditing && returnData && (
              <div className="ad-info-banner ad-info-banner--return">
                <AutoFixHigh style={{ fontSize: 15, flexShrink: 0 }} />
                <div>
                  <strong>Pre-filled from return</strong>
                  <p>
                    Customer: {returnData.customerName} · Order: {returnData.orderReference} · Value: {fmtCurrency(returnData.discountValue)}
                  </p>
                </div>
              </div>
            )}

            <div className="ad-form-grid">
              {!isEditing && (
                <div className="ad-form-group ad-form-group--full">
                  <label className="ad-form-label" htmlFor="ad-code">Discount Code *</label>
                  <input
                    id="ad-code"
                    type="text"
                    className={`ad-form-input ad-form-input--mono${formErrors.code ? ' ad-form-input--error' : ''}`}
                    value={form.code}
                    onChange={(e) => setField('code', e.target.value.toUpperCase())}
                    placeholder="e.g. SUMMER20"
                    maxLength={30}
                  />
                  {formErrors.code && <span className="ad-form-error">{formErrors.code}</span>}
                </div>
              )}

              <div className="ad-form-group ad-form-group--full">
                <label className="ad-form-label" htmlFor="ad-desc">Description *</label>
                <input
                  id="ad-desc"
                  type="text"
                  className={`ad-form-input${formErrors.description ? ' ad-form-input--error' : ''}`}
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Discount description…"
                />
                {formErrors.description && <span className="ad-form-error">{formErrors.description}</span>}
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-type">Type *</label>
                <select
                  id="ad-type"
                  className="ad-form-select"
                  value={form.type}
                  onChange={(e) => setField('type', e.target.value)}
                  disabled={fromReturn && !isEditing}
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-value">
                  Value {form.type === 'percentage' ? '(%)' : '($)'} *
                </label>
                <input
                  id="ad-value"
                  type="number"
                  className={`ad-form-input${formErrors.value ? ' ad-form-input--error' : ''}`}
                  value={form.value}
                  onChange={(e) => setField('value', e.target.value)}
                  placeholder={form.type === 'percentage' ? '0–100' : '0.00'}
                  min={0}
                  max={form.type === 'percentage' ? 100 : undefined}
                  step={form.type === 'percentage' ? 1 : 0.01}
                  readOnly={fromReturn && !isEditing}
                />
                {formErrors.value && <span className="ad-form-error">{formErrors.value}</span>}
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-category">Category *</label>
                <select
                  id="ad-category"
                  className="ad-form-select"
                  value={form.category}
                  onChange={(e) => setField('category', e.target.value)}
                  disabled={fromReturn && !isEditing}
                >
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-from">Valid From</label>
                <input
                  id="ad-from"
                  type="date"
                  className="ad-form-input"
                  value={form.validFrom}
                  onChange={(e) => setField('validFrom', e.target.value)}
                />
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-until">Expires *</label>
                <input
                  id="ad-until"
                  type="date"
                  className={`ad-form-input${formErrors.validUntil ? ' ad-form-input--error' : ''}`}
                  value={form.validUntil}
                  onChange={(e) => setField('validUntil', e.target.value)}
                />
                {formErrors.validUntil && <span className="ad-form-error">{formErrors.validUntil}</span>}
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-total-uses">Total Uses (blank = unlimited)</label>
                <input
                  id="ad-total-uses"
                  type="number"
                  className="ad-form-input"
                  value={form.usageLimit.totalUses}
                  onChange={(e) => setField('usageLimit.totalUses', e.target.value)}
                  placeholder="Unlimited"
                  min={1}
                />
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-per-user">Uses Per User</label>
                <input
                  id="ad-per-user"
                  type="number"
                  className="ad-form-input"
                  value={form.usageLimit.usesPerUser}
                  onChange={(e) => setField('usageLimit.usesPerUser', e.target.value)}
                  min={1}
                />
              </div>

              <div className="ad-form-group">
                <label className="ad-form-label" htmlFor="ad-min-purchase">Min Purchase ($)</label>
                <input
                  id="ad-min-purchase"
                  type="number"
                  className="ad-form-input"
                  value={form.conditions.minPurchaseAmount}
                  onChange={(e) => setField('conditions.minPurchaseAmount', e.target.value)}
                  min={0}
                  step={0.01}
                />
              </div>

              {form.type === 'percentage' && (
                <div className="ad-form-group">
                  <label className="ad-form-label" htmlFor="ad-max-discount">Max Discount Cap ($)</label>
                  <input
                    id="ad-max-discount"
                    type="number"
                    className="ad-form-input"
                    value={form.conditions.maxDiscountAmount}
                    onChange={(e) => setField('conditions.maxDiscountAmount', e.target.value)}
                    placeholder="No cap"
                    min={0}
                    step={0.01}
                  />
                </div>
              )}

              <div className="ad-form-group ad-form-group--full">
                <div className="ad-checkbox-row">
                  <label className="ad-checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.conditions.excludeSaleItems}
                      onChange={(e) => setField('conditions.excludeSaleItems', e.target.checked)}
                      className="ad-checkbox"
                    />
                    <span>Exclude sale items</span>
                  </label>
                  <label className="ad-checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.conditions.firstOrderOnly}
                      onChange={(e) => setField('conditions.firstOrderOnly', e.target.checked)}
                      className="ad-checkbox"
                    />
                    <span>First order only</span>
                  </label>
                </div>
              </div>

              <div className="ad-form-group ad-form-group--full">
                <label className="ad-form-label" htmlFor="ad-notes">Notes</label>
                <textarea
                  id="ad-notes"
                  className="ad-form-textarea"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Internal admin notes…"
                />
              </div>
            </div>
          </div>

          <div className="ad-modal-footer">
            <button type="button" className="ad-btn ad-btn--secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="ad-btn ad-btn--primary"
              onClick={handleSubmitForm}
              disabled={actionLoading}
            >
              {actionLoading
                ? (isEditing ? 'Saving…' : 'Creating…')
                : (isEditing ? 'Save Changes' : 'Create Discount')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: detail drawer ─────────────────────────────────────────────────
  const renderDetailDrawer = () => {
    if (!showDetailDrawer) return null;
    if (!currentDiscount) {
      return (
        <div className="ad-drawer-overlay" onClick={handleCloseDrawer} role="presentation">
          <div className="ad-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="ad-drawer-hd">
              <h2 className="ad-drawer-title">Loading…</h2>
              <button type="button" className="ad-drawer-close" onClick={handleCloseDrawer}>
                <Close style={{ fontSize: 18 }} />
              </button>
            </div>
            <div className="ad-drawer-body">
              <div className="ad-loading"><div className="ad-spinner" /><span>Fetching discount…</span></div>
            </div>
          </div>
        </div>
      );
    }

    const d = currentDiscount;
    const urgency = getExpiryUrgency(d.validUntil);
    const daysLeft = getDaysUntil(d.validUntil);
    const usagePercent = d.usageLimit?.totalUses
      ? Math.min(100, ((d.usageLimit.currentUses ?? 0) / d.usageLimit.totalUses) * 100)
      : null;

    return (
      <div className="ad-drawer-overlay" onClick={handleCloseDrawer} role="presentation">
        <div className="ad-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="ad-drawer-hd">
            <div className="ad-drawer-hd-left">
              <div className="ad-code-display">
                <span className="ad-code-display-text">{d.code}</span>
                <button
                  type="button"
                  className="ad-copy-btn ad-copy-btn--lg"
                  onClick={() => copy(d.code, d._id)}
                  title="Copy code"
                >
                  {copiedId === d._id ? <Done style={{ fontSize: 14 }} /> : <ContentCopy style={{ fontSize: 14 }} />}
                </button>
              </div>
              <span className={`ad-status ad-status--${d.status}`}>{d.status}</span>
            </div>
            <button type="button" className="ad-drawer-close" onClick={handleCloseDrawer} aria-label="Close">
              <Close style={{ fontSize: 18 }} />
            </button>
          </div>

          <div className="ad-drawer-body">
            <div className="ad-value-hero">
              <div className="ad-value-hero-amount">
                {d.type === 'percentage' ? `${d.value}% OFF` : `${fmtCurrency(d.value)} OFF`}
              </div>
              <div className="ad-value-hero-meta">
                <span className={`ad-category ad-category--${CATEGORY_COLOR[d.category] ?? 'promo'}`}>{d.category}</span>
                {d.conditions?.minPurchaseAmount > 0 && (
                  <span className="ad-value-hero-condition">Min. {fmtCurrency(d.conditions.minPurchaseAmount)}</span>
                )}
              </div>
            </div>

            <div className={`ad-expiry-block ad-expiry-block--${urgency}`}>
              <Schedule style={{ fontSize: 15, flexShrink: 0 }} />
              <div>
                <span className="ad-expiry-block-label">
                  {urgency === 'expired' ? 'Expired' : urgency === 'critical' ? 'Expires very soon!' : urgency === 'warning' ? 'Expiring soon' : 'Valid until'}
                </span>
                <span className="ad-expiry-block-date">{fmtDate(d.validUntil)}</span>
                {daysLeft !== null && daysLeft > 0 && (
                  <span className="ad-expiry-block-days">{daysLeft} days remaining</span>
                )}
              </div>
            </div>

            {usagePercent !== null && (
              <div className="ad-usage-block">
                <div className="ad-usage-row">
                  <span className="ad-usage-label">Usage</span>
                  <span className="ad-usage-count">
                    {d.usageLimit.currentUses ?? 0} / {d.usageLimit.totalUses}
                  </span>
                </div>
                <div className="ad-usage-bar">
                  <div
                    className={`ad-usage-fill${usagePercent >= 90 ? ' ad-usage-fill--full' : ''}`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="ad-section"><span className="ad-section-text">Details</span><span className="ad-section-line" /></div>
            <div className="ad-card">
              <div className="ad-card-body">
                {[
                  ['Description',    d.description],
                  ['Type',           d.type],
                  ['Valid From',     fmtDate(d.validFrom)],
                  ['Per-user Limit', d.usageLimit?.usesPerUser ?? 1],
                  ['Created By',     d.createdBy?.firstName ? `${d.createdBy.firstName} ${d.createdBy.lastName ?? ''}` : '—'],
                  ['Created',        fmtDateTime(d.createdAt)],
                ].map(([label, val]) => (
                  <div key={label} className="ad-metric-row">
                    <span className="ad-metric-label">{label}</span>
                    <span className="ad-metric-val">{val}</span>
                  </div>
                ))}
                {d.conditions?.maxDiscountAmount && (
                  <div className="ad-metric-row">
                    <span className="ad-metric-label">Max Discount Cap</span>
                    <span className="ad-metric-val">{fmtCurrency(d.conditions.maxDiscountAmount)}</span>
                  </div>
                )}
                {(d.conditions?.excludeSaleItems || d.conditions?.firstOrderOnly) && (
                  <div className="ad-metric-row">
                    <span className="ad-metric-label">Restrictions</span>
                    <span className="ad-metric-val">
                      {[
                        d.conditions.excludeSaleItems && 'Excludes sale items',
                        d.conditions.firstOrderOnly   && 'First order only',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
                {d.notes && (
                  <div className="ad-metric-row">
                    <span className="ad-metric-label">Notes</span>
                    <span className="ad-metric-val">{d.notes}</span>
                  </div>
                )}
              </div>
            </div>

            {d.relatedReturn && (
              <>
                <div className="ad-section"><span className="ad-section-text">Linked Return</span><span className="ad-section-line" /></div>
                <div className="ad-card">
                  <div className="ad-card-body">
                    <div className="ad-metric-row">
                      <span className="ad-metric-label">RMA / Return ID</span>
                      <span className="ad-metric-val ad-td-mono">
                        {d.relatedReturn?.returnInfo?.rmaNumber ?? d.relatedReturn?.toString?.().slice(-8).toUpperCase() ?? '—'}
                      </span>
                    </div>
                    {d.relatedReturn?.returnInfo?.status && (
                      <div className="ad-metric-row">
                        <span className="ad-metric-label">Return Status</span>
                        <span className="ad-metric-val">{d.relatedReturn.returnInfo.status.replace(/_/g, ' ')}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="ad-btn ad-btn--ghost ad-btn--sm"
                      style={{ marginTop: 8 }}
                      onClick={() => navigate('/admin/returns', {
                        state: { highlightId: typeof d.relatedReturn === 'string' ? d.relatedReturn : d.relatedReturn?._id }
                      })}
                    >
                      View Return →
                    </button>
                  </div>
                </div>
              </>
            )}

            {d.usageHistory?.length > 0 && (
              <>
                <div className="ad-section"><span className="ad-section-text">Usage History</span><span className="ad-section-line" /></div>
                <div className="ad-card">
                  <div className="ad-card-body--np">
                    <div className="ad-tbl-wrap">
                      <table className="ad-tbl">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Order</th>
                            <th>Amount</th>
                            <th>Used At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.usageHistory.slice(0, 10).map((h, i) => (
                            <tr key={h._id ?? i}>
                              <td>{h.user?.firstName ? `${h.user.firstName} ${h.user.lastName ?? ''}` : '—'}</td>
                              <td className="ad-td-mono">{h.order?.orderNumber ?? '—'}</td>
                              <td className="ad-td-money">{fmtCurrency(h.discountAmount)}</td>
                              <td className="ad-td-muted">{fmtDate(h.usedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="ad-drawer-footer">
            <button
              type="button"
              className="ad-btn ad-btn--primary"
              onClick={() => { handleCloseDrawer(); handleOpenEdit(d); }}
            >
              <Edit style={{ fontSize: 14, marginRight: 5 }} /> Edit
            </button>
            <button
              type="button"
              className="ad-btn ad-btn--danger"
              onClick={() => { handleCloseDrawer(); setShowDeleteConfirm(d._id); }}
              disabled={d.status === 'inactive'}
            >
              <Delete style={{ fontSize: 14, marginRight: 5 }} /> Deactivate
            </button>
            <button type="button" className="ad-btn ad-btn--secondary" onClick={handleCloseDrawer}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: delete confirm ────────────────────────────────────────────────
  const renderDeleteConfirm = () => {
    if (!showDeleteConfirm) return null;
    return (
      <div className="ad-modal-overlay" onClick={() => setShowDeleteConfirm(null)} role="presentation">
        <div className="ad-confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="ad-confirm-icon">
            <Warning style={{ fontSize: 28, color: '#EF4444' }} />
          </div>
          <h3 className="ad-confirm-title">Deactivate Discount?</h3>
          <p className="ad-confirm-desc">
            This will mark the discount as inactive. It cannot be used in any new transactions.
            This action can be reversed by editing the discount status.
          </p>
          <div className="ad-confirm-actions">
            <button type="button" className="ad-btn ad-btn--secondary" onClick={() => setShowDeleteConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="ad-btn ad-btn--danger"
              onClick={() => handleDelete(showDeleteConfirm)}
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing…' : 'Deactivate'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: cleanup modal ─────────────────────────────────────────────────
  const renderCleanupModal = () => {
    if (!showCleanupModal) return null;
    return (
      <div className="ad-modal-overlay" onClick={() => setShowCleanupModal(false)} role="presentation">
        <div className="ad-confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="ad-confirm-icon ad-confirm-icon--warning">
            <AutoFixHigh style={{ fontSize: 28, color: '#F59E0B' }} />
          </div>
          <h3 className="ad-confirm-title">Run Cleanup</h3>
          <p className="ad-confirm-desc">
            Step 1: All active discounts past their expiry date will be marked as expired.<br />
            Step 2: Expired discounts older than the threshold below will be permanently deleted.
          </p>
          <div className="ad-form-group" style={{ textAlign: 'left', marginBottom: 0 }}>
            <label className="ad-form-label" htmlFor="ad-cleanup-days">Hard-delete after (days)</label>
            <input
              id="ad-cleanup-days"
              type="number"
              className="ad-form-input"
              value={cleanupDays}
              onChange={(e) => setCleanupDays(Number(e.target.value))}
              min={1}
            />
          </div>
          {cleanupResult && (
            <div className="ad-cleanup-result">
              <span>✓ Expired: <strong>{cleanupResult.expired}</strong></span>
              <span>✓ Deleted: <strong>{cleanupResult.deleted}</strong></span>
            </div>
          )}
          <div className="ad-confirm-actions">
            <button type="button" className="ad-btn ad-btn--secondary" onClick={() => { setShowCleanupModal(false); dispatch(clearCleanupResult()); }}>
              Close
            </button>
            <button
              type="button"
              className="ad-btn ad-btn--warning"
              onClick={handleCleanup}
              disabled={actionLoading}
            >
              {actionLoading ? 'Running…' : 'Run Cleanup'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="ad-page">
        <div className="ad-body">

          <Link to="/admin/dashboard" className="ad-back-btn">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          <div className="ad-hd">
            <div className="ad-hd-left">
              <span className="ad-hd-icon">
                <LocalOffer style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="ad-hd-title">Discounts</h1>
                <p className="ad-hd-sub">Create, manage and analyse discount codes</p>
              </div>
            </div>
            <div className="ad-hd-right">
              <button
                type="button"
                className="ad-btn ad-btn--ghost ad-btn--sm"
                onClick={() => setShowCleanupModal(true)}
                title="Run cleanup"
              >
                <AutoFixHigh style={{ fontSize: 14, marginRight: 5 }} />
                Cleanup
              </button>
              <button
                type="button"
                className={`ad-icon-btn${discountsLoading ? ' ad-icon-btn--spin' : ''}`}
                onClick={() => { fetchFirstPage(); dispatch(getDiscountStats()); }}
                disabled={discountsLoading}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
              <button type="button" className="ad-btn ad-btn--primary" onClick={handleOpenCreate}>
                <Add style={{ fontSize: 16, marginRight: 4 }} /> New Discount
              </button>
            </div>
          </div>

          <div className="ad-kpi-grid">{renderKPIs()}</div>

          <div className="ad-tabs">
            {[
              { id: 'list',  label: 'All Codes', icon: LocalOffer },
              { id: 'stats', label: 'Analytics',  icon: BarChart  },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`ad-tab-btn${activeTab === tab.id ? ' ad-tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon style={{ fontSize: 15 }} />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'list' && (
            <>
              <div className="ad-filters">
                <div className="ad-search-wrap">
                  <Search className="ad-search-icon" style={{ fontSize: 16 }} />
                  <input
                    type="text"
                    className="ad-search-input"
                    placeholder="Search code or description…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search discounts"
                  />
                  {searchQuery && (
                    <button type="button" className="ad-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
                      <Close style={{ fontSize: 14 }} />
                    </button>
                  )}
                </div>
                <div className="ad-tf ad-filter-pills">
                  {STATUS_FILTERS.map((opt) => (
                    <button
                      key={opt.value || 'all'}
                      type="button"
                      className={`ad-tf-btn${filterStatus === opt.value ? ' ad-tf-btn--active' : ''}`}
                      onClick={() => setFilterStatus(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <select
                  className="ad-form-select ad-filter-select"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  aria-label="Filter by category"
                >
                  {CATEGORY_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="ad-error-banner" role="alert">
                  <Warning style={{ fontSize: 18, flexShrink: 0 }} />
                  <div>
                    <strong>Error</strong>
                    <p>{error}</p>
                  </div>
                </div>
              )}

              <div className="ad-card">
                <div className="ad-card-hd">
                  <div>
                    <h3 className="ad-card-title">Discount Codes</h3>
                    <p className="ad-card-sub">
                      {discountsLoading ? 'Loading…' : `${allDiscounts.length} codes loaded`}
                    </p>
                  </div>
                  <div className="ad-card-hd-right">
                    <FilterList style={{ fontSize: 16, color: '#9CA3AF' }} />
                  </div>
                </div>
                <div className="ad-card-body--np">{renderTable()}</div>
              </div>
            </>
          )}

          {activeTab === 'stats' && (
            <div className="ad-stats-grid">
              {renderCategoryStats()}
              {categoryStats?.length > 0 && (
                <div className="ad-card">
                  <div className="ad-card-hd">
                    <div>
                      <h3 className="ad-card-title">
                        <TrendingUp style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />
                        Category Breakdown
                      </h3>
                      <p className="ad-card-sub">Visual distribution of discount categories</p>
                    </div>
                  </div>
                  <div className="ad-card-body">
                    {categoryStats.map((row) => {
                      const pct = overallStats.total > 0 ? (row.totalDiscounts / overallStats.total) * 100 : 0;
                      return (
                        <div key={row._id} className="ad-bar-row">
                          <span className={`ad-category ad-category--${CATEGORY_COLOR[row._id] ?? 'promo'}`} style={{ minWidth: 80 }}>
                            {row._id}
                          </span>
                          <div className="ad-bar-track">
                            <div
                              className={`ad-bar-fill ad-bar-fill--${CATEGORY_COLOR[row._id] ?? 'promo'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="ad-bar-pct">{pct.toFixed(1)}%</span>
                          <span className="ad-bar-count">{row.totalDiscounts}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {success && successMessage && (
            <div className="ad-toast-wrap" role="status" aria-live="polite">
              <div className="ad-toast ad-toast--success">
                <CheckCircle style={{ fontSize: 18 }} />
                <div>
                  <strong>Success</strong>
                  <p>{successMessage}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {renderModal()}
      {renderDetailDrawer()}
      {renderDeleteConfirm()}
      {renderCleanupModal()}
      <Footer />
    </>
  );
};

export default AdminDiscounts;