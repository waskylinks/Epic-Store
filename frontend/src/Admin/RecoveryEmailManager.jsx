import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { Email, ArrowBack, Refresh, Warning, MoneyOff, TrendingUp, Inbox } from '@mui/icons-material';
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
  { key: 'converted',    label: 'Converted' },
  { key: 'organic',      label: 'Organic' },
  { key: 'failed',       label: 'Failed' },
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
  converted:    'Converted',
  organic:      'Organic',
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
    h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`,
};

const getFullName = (user) =>
  user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Guest'
    : 'Guest';

const getInitials = (user) => {
  if (!user) return 'G';
  const first = user.firstName?.[0] || '';
  const last  = user.lastName?.[0]  || '';
  return (first + last).toUpperCase() || (user.email?.[0] || 'G').toUpperCase();
};

const getPriority = (score) => {
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
};

const outcomeClass = (outcome) => ({
  none:         'none',
  pending:      'none',
  sent:         'sent',
  clicked:      'clicked',
  converted:    'converted',
  organic:      'organic',
  re_abandoned: 're_abandoned',
  exhausted:    'exhausted',
  expired:      'expired',
  failed:       'failed',
}[outcome] || 'none');

// ============================================
// SUB-COMPONENTS
// ============================================

function KpiSkel() {
  return (
    <div className="res-kpi-skel">
      <div className="res-skel" style={{ width: '60%', height: 10, marginBottom: 10 }} />
      <div className="res-skel" style={{ width: '45%', height: 28 }} />
      <div className="res-skel" style={{ width: '70%', height: 9, marginTop: 10 }} />
    </div>
  );
}

function CartItemSkeleton() {
  return (
    <div className="res-cart-item">
      <div className="res-cart-item-top">
        <div className="res-cart-avatar res-skel" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="res-skel" style={{ width: '65%', height: 13, marginBottom: 6 }} />
          <div className="res-skel" style={{ width: '80%', height: 11 }} />
        </div>
        <div className="res-skel" style={{ width: 56, height: 18 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <div className="res-skel" style={{ width: 60, height: 20, borderRadius: 999 }} />
        <div className="res-skel" style={{ width: 80, height: 20, borderRadius: 999 }} />
        <div className="res-skel" style={{ width: 44, height: 20, borderRadius: 999 }} />
      </div>
    </div>
  );
}

// ── Attempt progress indicator ───────────────────────────────

function AttemptDots({ confirmed, max }) {
  return (
    <div className="res-attempt-dots" title={`${confirmed} of ${max} emails sent`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`res-attempt-dot${i < confirmed ? ' res-attempt-dot--filled' : ''}`}
        />
      ))}
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
  const initials    = getInitials(user);

  return (
    <div className="res-right">
      <div className="res-detail-hd">
        <div className="res-detail-hd-left">
          <div className="res-detail-avatar">{initials}</div>
          <div>
            <div className="res-detail-hd-name">{getFullName(user)}</div>
            <div className="res-detail-hd-email">{user.email || checkout.email || '—'}</div>
          </div>
        </div>
        <span className={`res-badge res-badge--${outcomeClass(liveOutcome)}`}>
          {OUTCOME_LABEL[liveOutcome] || liveOutcome}
        </span>
      </div>

      <div className="res-detail-body">

        {/* Abandonment info */}
        <section>
          <div className="res-section-label">Abandonment details</div>
          <div className="res-info-grid">
            <div className="res-info-row">
              <span className="res-info-key">First abandoned step</span>
              <span className="res-info-val res-info-val--danger">
                {abn.firstAbandonedAtStep?.replace(/_/g, ' ') || '—'}
              </span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Abandoned at</span>
              <span className="res-info-val">{fmt.date(abn.firstAbandonedAt || abn.abandonedAt)}</span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Hours since abandonment</span>
              <span className="res-info-val">{fmt.hours(checkout.hoursSinceAbandoned)} ago</span>
            </div>
            <div className="res-info-row">
              <span className="res-info-key">Re-abandoned</span>
              <span className="res-info-val">
                {abn.reAbandoned ? `Yes (${abn.failedRecoveries || 1}×)` : 'No'}
              </span>
            </div>
          </div>
        </section>

        {/* Cart items */}
        <section>
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
        </section>

        {/* Pricing */}
        <section>
          <div className="res-section-label">Pricing breakdown</div>
          <div className="res-pricing-rows">
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
        </section>

        {/* Email attempt history */}
        {status?.attempts?.length > 0 && (
          <section>
            <div className="res-section-label">
              Email history ({status.attempts.length} attempt{status.attempts.length !== 1 ? 's' : ''})
            </div>
            <div className="res-timeline">
              {status.attempts.map((attempt, i) => (
                <div
                  key={i}
                  className={[
                    'res-attempt',
                    attempt.linkClickedAt && !attempt.clickedAfterExpiry ? 'res-attempt--clicked' : '',
                    attempt.status === 'failed' ? 'res-attempt--failed' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div className="res-attempt-hd">
                    <div className="res-attempt-hd-left">
                      <span className="res-attempt-num">Attempt #{attempt.attemptNumber}</span>
                      <span className={`res-attempt-status-dot res-attempt-status-dot--${attempt.status}`} />
                      <span className="res-attempt-status-label">{attempt.status}</span>
                    </div>
                    <span className="res-attempt-date">
                      {fmt.date(attempt.sentAt || attempt.initiatedAt)}
                    </span>
                  </div>
                  <div className="res-attempt-rows">
                    {attempt.linkClickedAt && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Clicked</span>
                        <span>{fmt.date(attempt.linkClickedAt)} · {attempt.linkClickCount}×</span>
                      </div>
                    )}
                    {attempt.clickedAfterExpiry && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Note</span>
                        <span className="res-attempt-warn">Clicked after token expired — cart not restored</span>
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
                        <span className={new Date(attempt.tokenExpiresAt) < new Date() ? 'res-attempt-muted' : ''}>
                          {fmt.date(attempt.tokenExpiresAt)}
                          {new Date(attempt.tokenExpiresAt) < new Date() ? ' · expired' : ''}
                        </span>
                      </div>
                    )}
                    {attempt.tokenExpiredUnclicked && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Token</span>
                        <span className="res-attempt-muted">Expired without click</span>
                      </div>
                    )}
                    {attempt.failReason && (
                      <div className="res-attempt-row">
                        <span className="res-attempt-key">Error</span>
                        <span className="res-attempt-err">{attempt.failReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recovery summary */}
        <section>
          <div className="res-send-block">
            <div className="res-send-block-label">Recovery summary</div>
            <div className="res-recovery-progress">
              <span className="res-recovery-progress-label">Email attempts</span>
              <AttemptDots confirmed={recovery?.confirmedAttempts || 0} max={MAX_ATTEMPTS} />
              <span className="res-recovery-progress-count">
                {recovery?.confirmedAttempts || 0} / {MAX_ATTEMPTS}
              </span>
            </div>
            <div className="res-info-grid" style={{ marginTop: 14 }}>
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
        </section>

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

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput, page: 1 }));
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // FIX: Derive selectedItem reset from filter state instead of calling setState
  // inside an effect — avoids the cascading-render ESLint warning.
  const prevOutcomeRef = useRef(filters.outcome);
  const prevPageRef    = useRef(filters.page);

  const handleOutcomeChange = (outcome) => {
    setSelectedItem(null);
    setFilters((f) => ({ ...f, outcome, page: 1 }));
    prevOutcomeRef.current = outcome;
  };

  const setPage = (p) => {
    setSelectedItem(null);
    setFilters((f) => ({ ...f, page: p }));
    prevPageRef.current = p;
  };

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  // KPIs
  const kpis = [
    {
      label: 'Total campaigns',
      value: fmt.number(summary.totalCampaigns),
      color: 'coral',
      tip:   'All recovery email campaigns ever created',
      icon:  <Email style={{ fontSize: 16 }} />,
    },
    {
      label: 'Not contacted',
      value: fmt.number(summary.neverContacted),
      color: 'amber',
      tip:   'Records created but no email sent yet',
      icon:  <Inbox style={{ fontSize: 16 }} />,
    },
    {
      label: 'Awaiting click',
      value: fmt.number(summary.awaitingResponse),
      color: 'blue',
      tip:   'Email sent — user has not clicked yet',
      icon:  <Email style={{ fontSize: 16 }} />,
    },
    {
      label: 'Clicked',
      value: fmt.number(summary.clicked),
      color: 'indigo',
      tip:   'Clicked recovery link, not yet converted',
      icon:  <TrendingUp style={{ fontSize: 16 }} />,
    },
    {
      label: 'Converted',
      value: fmt.number(summary.converted),
      color: 'green',
      tip:   'Completed checkout after clicking recovery email',
      icon:  <TrendingUp style={{ fontSize: 16 }} />,
    },
    {
      label: 'Organic',
      value: fmt.number(summary.organic),
      color: 'teal',
      tip:   'Converted without clicking the recovery link',
      icon:  <TrendingUp style={{ fontSize: 16 }} />,
    },
    {
      label: 'Re-abandoned',
      value: fmt.number(summary.reAbandoned),
      color: 'purple',
      tip:   'Returned via link then left again',
      icon:  <Warning style={{ fontSize: 16 }} />,
    },
    {
      label: 'Expired',
      value: fmt.number(summary.expired),
      color: 'gray',
      tip:   'All tokens elapsed, user never clicked',
      icon:  <MoneyOff style={{ fontSize: 16 }} />,
    },
  ];

  return (
    <>
      <PageTitle title="Recovery Email Monitor — Admin" />
      <Navbar />

      <div className="res-page">
        <div className="res-body">

          <div className="res-topbar">
            <Link to="/admin/dashboard" className="res-back">
              <ArrowBack style={{ fontSize: 14 }} /> Dashboard
            </Link>
          </div>

          <div className="res-hd">
            <div className="res-hd-left">
              <div className="res-hd-icon"><Email style={{ fontSize: 22 }} /></div>
              <div>
                <div className="res-hd-eyebrow">Recovery Emails</div>
                <h1 className="res-hd-title">Recovery Email Monitor</h1>
                <p className="res-hd-sub">
                  Read-only view of all recovery campaigns and their current status
                </p>
              </div>
            </div>
            <button
              className={`res-icon-btn${refreshing ? ' res-icon-btn--spin' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh data"
              aria-label="Refresh"
            >
              <Refresh style={{ fontSize: 17 }} />
            </button>
          </div>

          {/* KPI strip — 8 cards */}
          <div className="res-kpi-strip">
            {isFirstLoad
              ? Array.from({ length: 8 }).map((_, i) => <KpiSkel key={i} />)
              : kpis.map((k) => (
                <div
                  key={k.label}
                  className={`res-kpi res-kpi--${k.color}`}
                  title={k.tip || ''}
                >
                  <div className="res-kpi-top">
                    <span className="res-kpi-label">{k.label}</span>
                    <span className="res-kpi-icon">{k.icon}</span>
                  </div>
                  <div className="res-kpi-value">{k.value}</div>
                </div>
              ))}
          </div>

          {listError && !loading && (
            <div className="res-error-bar">
              <Warning style={{ fontSize: 15 }} /> {listError}
            </div>
          )}

          {/* Filters */}
          <div className="res-filters">
            <div className="res-filters-top">
              <input
                className="res-search"
                type="text"
                placeholder="Search by email or name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search campaigns"
              />
              <select
                className="res-select"
                value={filters.sortBy}
                onChange={(e) => setFilters((f) => ({ ...f, sortBy: e.target.value, page: 1 }))}
                aria-label="Sort by"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="res-outcome-chips" role="group" aria-label="Filter by outcome">
              {OUTCOME_CHIPS.map((chip) => (
                <button
                  key={chip.key}
                  className={`res-chip${filters.outcome === chip.key ? ' res-chip--active' : ''}`}
                  onClick={() => handleOutcomeChange(chip.key)}
                  aria-pressed={filters.outcome === chip.key}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Two-panel layout */}
          <div className="res-panels">
            <div className="res-left">
              <div className="res-left-hd">
                <span className="res-left-title">Recovery campaigns</span>
                <span className="res-left-count">{fmt.number(pagination.total)}</span>
              </div>

              <div className="res-cart-list" role="list" aria-label="Campaign list">
                {isFirstLoad || (loading && sendList.length === 0)
                  ? Array.from({ length: 8 }).map((_, i) => <CartItemSkeleton key={i} />)
                  : sendList.length === 0
                    ? (
                      <div className="res-empty" role="status">
                        <MoneyOff style={{ fontSize: 36, color: '#9CA3AF' }} />
                        <span>No campaigns match this filter</span>
                      </div>
                    )
                    : sendList.map((listItem) => {
                      const ch         = listItem.checkout;
                      const rec        = listItem.recovery;
                      const user       = ch.user || {};
                      const priority   = getPriority(ch.priority || 0);
                      const outcome    = rec?.outcome || 'none';
                      const isSelected = selectedItem?.checkout._id === ch._id;
                      const initials   = getInitials(user);

                      return (
                        <div
                          key={ch._id}
                          className={`res-cart-item${isSelected ? ' res-cart-item--selected' : ''}`}
                          onClick={() => setSelectedItem(listItem)}
                          role="listitem"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && setSelectedItem(listItem)}
                          aria-selected={isSelected}
                        >
                          <div className="res-cart-item-top">
                            <div className="res-cart-avatar" aria-hidden="true">{initials}</div>
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
                              <AttemptDots confirmed={rec.confirmedAttempts} max={MAX_ATTEMPTS} />
                            )}
                            <span className="res-cart-hours">
                              {fmt.hours(ch.hoursSinceAbandoned)} ago
                            </span>
                          </div>
                        </div>
                      );
                    })}
              </div>

              {pagination.totalPages > 1 && (
                <div className="res-pagination" role="navigation" aria-label="Pagination">
                  <button className="res-pg-btn" disabled={!pagination.hasPrevPage} onClick={() => setPage(1)} aria-label="First page">«</button>
                  <button className="res-pg-btn" disabled={!pagination.hasPrevPage} onClick={() => setPage(filters.page - 1)} aria-label="Previous page">‹</button>
                  <span className="res-pg-info">{filters.page} / {pagination.totalPages}</span>
                  <button className="res-pg-btn" disabled={!pagination.hasNextPage} onClick={() => setPage(filters.page + 1)} aria-label="Next page">›</button>
                  <button className="res-pg-btn" disabled={!pagination.hasNextPage} onClick={() => setPage(pagination.totalPages)} aria-label="Last page">»</button>
                </div>
              )}
            </div>

            {selectedItem ? (
              <CartDetail item={selectedItem} />
            ) : (
              <div className="res-right">
                <div className="res-empty-panel">
                  <div className="res-empty-panel-icon">
                    <Email style={{ fontSize: 32, color: '#FF6B6B' }} />
                  </div>
                  <p className="res-empty-panel-title">No campaign selected</p>
                  <p className="res-empty-panel-sub">
                    Click any campaign on the left to view its details and email attempt history.
                  </p>
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