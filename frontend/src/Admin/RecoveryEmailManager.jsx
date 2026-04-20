import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { Email, ArrowBack, Refresh, Warning, MoneyOff } from '@mui/icons-material';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import PageTitle from '../components/PageTitle';
import {
  fetchSendList,
  fetchRecoveryStatus,
  selectSendList,
  selectSendListLoading,
  selectSendListError,
  selectPagination,
  selectSendListSummary,
  selectStatusFor,
} from '../features/admin/recoveryEmailSlice';
import '../AdminStyles/RecoveryEmailManager.css';

// ============================================
// CONSTANTS
// ============================================

const MAX_ATTEMPTS = parseInt(import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS) || 3;

const OUTCOME_CHIPS = [
  { key: 'all',          label: 'All' },
  { key: 'none',         label: 'Not contacted' },
  { key: 'sent',         label: 'Awaiting click' },
  { key: 'clicked',      label: 'Clicked' },
  { key: 're_abandoned', label: 'Re-abandoned' },
  { key: 'exhausted',    label: 'Max reached' },
  { key: 'expired',      label: 'Expired' },
  { key: 'converted',    label: 'Completed' },
];

const SORT_OPTIONS = [
  { value: 'priority',    label: 'Priority score' },
  { value: 'value',       label: 'Cart value' },
  { value: 'abandonedAt', label: 'Abandoned date' },
  { value: 'lastSentAt',  label: 'Last email sent' },
];

const OUTCOME_LABEL = {
  none:         'Not contacted',
  pending:      'Not contacted',
  sent:         'Awaiting click',
  clicked:      'Clicked',
  converted:    'Completed',
  organic:      'Completed',
  re_abandoned: 'Re-abandoned',
  exhausted:    'Max reached',
  expired:      'Expired',
  failed:       'Failed',
};

// ============================================
// HELPERS
// ============================================

const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(v || 0),
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  date: (d) =>
    d ? new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) : '—',
  hours: (h) =>
    h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m` : `${Math.floor(h)}h`,
};

const getFullName = (user) =>
  user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Guest'
    : 'Guest';

const getPriority = (score) => {
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
};

const outcomeClass = (outcome) => ({
  none: 'none', pending: 'none', sent: 'sent', clicked: 'clicked',
  converted: 'converted', organic: 'converted', re_abandoned: 're_abandoned',
  exhausted: 'exhausted', expired: 'expired', failed: 'failed',
}[outcome] || 'none');

// ============================================
// SUB-COMPONENTS
// ============================================

function KpiSkel() {
  return (
    <div className="res-kpi-skel">
      <div className="res-skel" style={{ width: '60%', height: 11, marginBottom: 10 }} />
      <div className="res-skel" style={{ width: '45%', height: 26 }} />
    </div>
  );
}

function CartItemSkeleton() {
  return (
    <div className="res-cart-item">
      <div className="res-cart-item-top">
        <div style={{ flex: 1 }}>
          <div className="res-skel" style={{ width: '65%', height: 13, marginBottom: 6 }} />
          <div className="res-skel" style={{ width: '80%', height: 11 }} />
        </div>
        <div className="res-skel" style={{ width: 52, height: 16 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <div className="res-skel" style={{ width: 60, height: 18, borderRadius: 999 }} />
        <div className="res-skel" style={{ width: 44, height: 18, borderRadius: 999 }} />
      </div>
    </div>
  );
}

// ── Cart detail right panel — read only ──────────────────────

function CartDetail({ item }) {
  const dispatch = useDispatch();
  const checkout = item.checkout;
  const recovery = item.recovery;
  const status   = useSelector(selectStatusFor(checkout._id));

  useEffect(() => {
    dispatch(fetchRecoveryStatus(checkout._id));
  }, [checkout._id, dispatch]);

  const user    = checkout.user        || {};
  const pricing = checkout.pricing     || {};
  const abn     = checkout.abandonment || {};
  const items   = checkout.items       || [];

  const liveOutcome = status?.outcome || recovery?.outcome || 'none';

  return (
    <div className="res-right">
      <div className="res-detail-hd">
        <div>
          <div className="res-detail-hd-name">{getFullName(user)}</div>
          <div className="res-detail-hd-email">{user.email || checkout.email || '—'}</div>
        </div>
        <span className={`res-badge res-badge--${outcomeClass(liveOutcome)}`}>
          {OUTCOME_LABEL[liveOutcome] || liveOutcome}
        </span>
      </div>

      <div className="res-detail-body">

        {/* Abandonment info */}
        <div>
          <div className="res-section-label">Abandonment details</div>
          <div className="res-info-grid">
            <div className="res-info-row">
              <span className="res-info-key">First abandoned step</span>
              <span className="res-info-val" style={{ color: '#dc2626' }}>
                {abn.firstAbandonedAtStep?.replace(/_/g, ' ') || '—'}
              </span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Abandoned at</span>
              <span className="res-info-val">{fmt.date(abn.firstAbandonedAt || abn.abandonedAt)}</span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Hours since abandonment</span>
              <span className="res-info-val">{fmt.hours(checkout.hoursSinceAbandoned)}</span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Re-abandoned</span>
              <span className="res-info-val">
                {abn.reAbandoned ? `Yes (${abn.failedRecoveries || 1}×)` : 'No'}
              </span>
            </div>
          </div>
        </div>

        {/* Cart items */}
        <div>
          <div className="res-section-label">Cart items ({items.length})</div>
          <table className="res-items-table">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ textAlign: 'center' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((cartItem, i) => {
                const isUnavailable =
                  cartItem.product?.status && cartItem.product.status !== 'published';
                return (
                  <tr key={i}>
                    <td>
                      <div className="res-item-name">
                        {cartItem.name || cartItem.product?.name || 'Unknown'}
                      </div>
                      {isUnavailable && (
                        <div className="res-item-unavailable">⚠ Product unavailable</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', color: '#374151', fontWeight: 700 }}>
                      {cartItem.quantity}
                    </td>
                    <td style={{ fontWeight: 700, color: '#111827', textAlign: 'right' }}>
                      {fmt.currency((cartItem.price || 0) * cartItem.quantity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pricing */}
        <div>
          <div className="res-section-label">Pricing</div>
          <div className="res-pricing-row">
            <span>Subtotal</span>
            <span>{fmt.currency(pricing.itemPrice)}</span>
          </div>
          {pricing.discountAmount > 0 && (
            <div className="res-pricing-row">
              <span>Discount{pricing.discountCode ? ` (${pricing.discountCode})` : ''}</span>
              <span className="res-pricing-discount">−{fmt.currency(pricing.discountAmount)}</span>
            </div>
          )}
          <div className="res-pricing-row">
            <span>Tax</span>
            <span>{fmt.currency(pricing.taxPrice)}</span>
          </div>
          <div className="res-pricing-row">
            <span>Shipping</span>
            <span style={{ color: pricing.shippingPrice === 0 ? '#16a34a' : undefined }}>
              {pricing.shippingPrice === 0 ? 'Free' : fmt.currency(pricing.shippingPrice)}
            </span>
          </div>
          <div className="res-pricing-row res-pricing-row--total">
            <span>Total</span>
            <span className="res-pricing-total-val">{fmt.currency(pricing.totalPrice)}</span>
          </div>
        </div>

        {/* Email attempt history */}
        {status?.attempts?.length > 0 && (
          <div>
            <div className="res-section-label">
              Email history ({status.attempts.length} attempt{status.attempts.length !== 1 ? 's' : ''})
            </div>
            <div className="res-timeline">
              {status.attempts.map((attempt, i) => (
                <div
                  key={i}
                  className={[
                    'res-attempt',
                    attempt.linkClickedAt   ? 'res-attempt--clicked' : '',
                    attempt.status === 'failed' ? 'res-attempt--failed'  : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div className="res-attempt-hd">
                    <span className="res-attempt-num">Attempt #{attempt.attemptNumber}</span>
                    <span className="res-attempt-date">
                      {fmt.date(attempt.sentAt || attempt.initiatedAt)}
                    </span>
                  </div>
                  <div className="res-attempt-rows">
                    <div className="res-attempt-row">
                      <span className="res-attempt-key">Status</span>
                      <span>{attempt.status}</span>
                    </div>
                    {attempt.linkClickedAt && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Clicked</span>
                        <span>{fmt.date(attempt.linkClickedAt)} · {attempt.linkClickCount}×</span>
                      </div>
                    )}
                    {attempt.clickedAfterExpiry && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Note</span>
                        <span style={{ color: '#d97706' }}>Clicked after token expired</span>
                      </div>
                    )}
                    {attempt.checkoutStepAtClick && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Step at click</span>
                        <span>{attempt.checkoutStepAtClick.replace(/_/g, ' ')}</span>
                      </div>
                    )}
                    {attempt.tokenExpiresAt && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Token expires</span>
                        <span style={{
                          color: new Date(attempt.tokenExpiresAt) < new Date()
                            ? '#6B7280' : '#374151'
                        }}>
                          {fmt.date(attempt.tokenExpiresAt)}
                          {new Date(attempt.tokenExpiresAt) < new Date() ? ' · expired' : ''}
                        </span>
                      </div>
                    )}
                    {attempt.tokenExpiredUnclicked && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Token</span>
                        <span style={{ color: '#6B7280' }}>Expired without click</span>
                      </div>
                    )}
                    {attempt.failReason && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Error</span>
                        <span style={{ color: '#dc2626' }}>{attempt.failReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recovery summary */}
        <div className="res-send-block">
          <div className="res-send-block-label">Recovery summary</div>
          <div className="res-info-grid">
            <div className="res-info-row">
              <span className="res-info-key">Attempts sent</span>
              <span className="res-info-val">
                {recovery?.confirmedAttempts || 0} / {MAX_ATTEMPTS}
              </span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Total link clicks</span>
              <span className="res-info-val">{recovery?.totalLinkClicks || 0}</span>
            </div>
            {recovery?.lastSentAt && (
              <div className="res-info-row">
                <span className="res-info-key">Last sent</span>
                <span className="res-info-val">{fmt.date(recovery.lastSentAt)}</span>
              </div>
            )}
            {recovery?.lastClickedAttemptNumber && (
              <div className="res-info-row">
                <span className="res-info-key">Clicked on attempt</span>
                <span className="res-info-val">#{recovery.lastClickedAttemptNumber}</span>
              </div>
            )}
            <div className="res-info-row">
              <span className="res-info-key">Outcome</span>
              <span className={`res-badge res-badge--${outcomeClass(liveOutcome)}`}>
                {OUTCOME_LABEL[liveOutcome] || liveOutcome}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function RecoveryEmailMonitorPage() {
  const dispatch = useDispatch();

  const sendList   = useSelector(selectSendList);
  const loading    = useSelector(selectSendListLoading);
  const listError  = useSelector(selectSendListError);
  const pagination = useSelector(selectPagination);
  const summary    = useSelector(selectSendListSummary);

  const [selectedItem, setSelectedItem] = useState(null);
  const [isFirstLoad,  setIsFirstLoad]  = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const [filters, setFilters] = useState({
    page:    1,
    limit:   20,
    outcome: 'all',
    sortBy:  'priority',
    search:  '',
    hours:   8760,
  });

  const [searchInput, setSearchInput] = useState('');
  const loadingRef = useRef(false);

  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    dispatch(fetchSendList(filters)).finally(() => {
      loadingRef.current = false;
      setIsFirstLoad(false);
      setRefreshing(false);
    });
  }, [dispatch, filters]);

  useEffect(() => { load(); }, [load]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput, page: 1 }));
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Clear selection when list changes
  useEffect(() => {
    setSelectedItem(null);
  }, [filters.outcome, filters.page]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const setPage = (p) => setFilters((f) => ({ ...f, page: p }));

  const kpis = [
    { label: 'Total',         value: fmt.number(summary.totalMatchingCarts), color: 'coral'  },
    { label: 'Not contacted', value: fmt.number(summary.neverContacted),     color: 'amber',
      tip: 'Abandoned carts not yet emailed' },
    { label: 'Awaiting click',value: fmt.number(summary.awaitingResponse),   color: 'blue',
      tip: 'Email sent, user has not clicked yet' },
    { label: 'Clicked',       value: fmt.number(summary.clicked),            color: 'indigo',
      tip: 'Clicked recovery link, not yet converted' },
    { label: 'Re-abandoned',  value: fmt.number(summary.reAbandoned),        color: 'purple',
      tip: 'Returned via link then left again' },
    { label: 'Completed',     value: fmt.number(summary.completed),          color: 'green',
      tip: 'Order placed after recovery' },
  ];

  return (
    <>
      <PageTitle title="Recovery Email Monitor — Admin" />
      <Navbar />

      <div className="res-page">
        <div className="res-body">

          <Link to="/admin/dashboard" className="res-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          <div className="res-hd">
            <div className="res-hd-left">
              <div className="res-hd-icon"><Email style={{ fontSize: 24 }} /></div>
              <div>
                <div className="res-hd-eyebrow">Recovery Emails</div>
                <h1 className="res-hd-title">Recovery Email Monitor</h1>
                <p className="res-hd-sub">
                  Read-only view of abandoned carts and their recovery email status
                </p>
              </div>
            </div>
            <button
              className={`res-icon-btn${refreshing ? ' res-icon-btn--spin' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh"
            >
              <Refresh style={{ fontSize: 18 }} />
            </button>
          </div>

          {/* KPI strip */}
          <div className="res-kpi-strip">
            {isFirstLoad
              ? Array.from({ length: 6 }).map((_, i) => <KpiSkel key={i} />)
              : kpis.map((k) => (
                <div
                  key={k.label}
                  className={`res-kpi res-kpi--${k.color}`}
                  title={k.tip || ''}
                >
                  <div className="res-kpi-label">{k.label}</div>
                  <div className="res-kpi-value">{k.value}</div>
                </div>
              ))}
          </div>

          {listError && !loading && (
            <div className="res-error-bar">
              <Warning style={{ fontSize: 16 }} /> {listError}
            </div>
          )}

          {/* Filters */}
          <div className="res-filters">
            <input
              className="res-search"
              type="text"
              placeholder="Search by email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select
              className="res-select"
              value={filters.sortBy}
              onChange={(e) => setFilters((f) => ({ ...f, sortBy: e.target.value, page: 1 }))}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="res-outcome-chips">
              {OUTCOME_CHIPS.map((chip) => (
                <button
                  key={chip.key}
                  className={`res-chip${filters.outcome === chip.key ? ' res-chip--active' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, outcome: chip.key, page: 1 }))}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Two-panel layout */}
          <div className="res-panels">

            {/* Left — cart list */}
            <div className="res-left">
              <div className="res-left-hd">
                <span className="res-left-title">Abandoned carts</span>
                <span className="res-left-count">{fmt.number(pagination.total)}</span>
              </div>

              <div className="res-cart-list">
                {isFirstLoad || (loading && sendList.length === 0)
                  ? Array.from({ length: 8 }).map((_, i) => <CartItemSkeleton key={i} />)
                  : sendList.length === 0
                    ? (
                      <div className="res-empty">
                        <MoneyOff style={{ fontSize: 38, color: '#9CA3AF' }} />
                        <span>No carts match this filter</span>
                      </div>
                    )
                    : sendList.map((listItem) => {
                      const ch         = listItem.checkout;
                      const rec        = listItem.recovery;
                      const user       = ch.user || {};
                      const priority   = getPriority(ch.priority || 0);
                      const outcome    = rec?.outcome || 'none';
                      const isSelected = selectedItem?.checkout._id === ch._id;

                      return (
                        <div
                          key={ch._id}
                          className={`res-cart-item${isSelected ? ' res-cart-item--selected' : ''}`}
                          onClick={() => setSelectedItem(listItem)}
                        >
                          <div className="res-cart-item-top">
                            <div className="res-cart-item-info">
                              <div className="res-cart-name">{getFullName(user)}</div>
                              <div className="res-cart-email">{user.email || ch.email}</div>
                            </div>
                            <div className="res-cart-value">
                              {fmt.currency(ch.pricing?.totalPrice)}
                            </div>
                          </div>
                          <div className="res-cart-meta">
                            <span className={`res-priority res-priority--${priority.cls}`}>
                              {priority.label}
                            </span>
                            <span className={`res-badge res-badge--${outcomeClass(outcome)}`}>
                              {OUTCOME_LABEL[outcome] || outcome}
                            </span>
                            {rec?.confirmedAttempts > 0 && (
                              <span className="res-cart-hours">
                                {rec.confirmedAttempts}/{MAX_ATTEMPTS} sent
                              </span>
                            )}
                            <span className="res-cart-hours">
                              {fmt.hours(ch.hoursSinceAbandoned)} ago
                            </span>
                          </div>
                        </div>
                      );
                    })}
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="res-pagination">
                  <button
                    className="res-pg-btn"
                    disabled={!pagination.hasPrevPage}
                    onClick={() => setPage(1)}
                    aria-label="First page"
                  >«</button>
                  <button
                    className="res-pg-btn"
                    disabled={!pagination.hasPrevPage}
                    onClick={() => setPage(filters.page - 1)}
                    aria-label="Previous page"
                  >‹</button>
                  <span className="res-pg-info">
                    {filters.page} / {pagination.totalPages}
                  </span>
                  <button
                    className="res-pg-btn"
                    disabled={!pagination.hasNextPage}
                    onClick={() => setPage(filters.page + 1)}
                    aria-label="Next page"
                  >›</button>
                  <button
                    className="res-pg-btn"
                    disabled={!pagination.hasNextPage}
                    onClick={() => setPage(pagination.totalPages)}
                    aria-label="Last page"
                  >»</button>
                </div>
              )}
            </div>

            {/* Right — detail panel */}
            {selectedItem ? (
              <CartDetail item={selectedItem} />
            ) : (
              <div className="res-right">
                <div className="res-empty-panel">
                  <Email style={{ fontSize: 44, color: '#9CA3AF' }} />
                  <p>Select a cart to view its abandonment details and email history.</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      <Footer />
    </>
  );
}