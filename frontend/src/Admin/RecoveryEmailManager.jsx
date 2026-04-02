import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, Email, Send, CheckCircle,
  Warning, AttachMoney, Loop, ErrorOutline,
  SelectAll, Close, FilterList, MoneyOff,
  MarkEmailRead, Bolt, PersonSearch,
} from '@mui/icons-material';
import Navbar from '../components/Navbar';
import {
  fetchRecoveryEmailList,
  sendSingleEmail,
  sendBulkEmails,
  setFilters,
  resetFilters,
  toggleSelectId,
  selectAllIds,
  clearSelection,
  resetBulkState,
  resetSendState,
  selectRecoveryCheckouts,
  selectRecoveryListStatus,
  selectRecoveryListError,
  selectRecoveryPagination,
  selectRecoveryListSummary,
  selectRecoveryFilters,
  selectSelectedIds,
  selectBulkStatus,
  selectBulkResults,
  selectBulkError,
  selectBulkMessage,
  selectSendState,
  selectAnySending,
  selectEligibleSelectedCount,
} from '../features/admin/recoveryEmailSlice';
import '../AdminStyles/RecoveryEmailManager.css';

// ============================================
// CONSTANTS
// ============================================

const MAX_ATTEMPTS   = parseInt(import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS,  10) || 3;
const COOLDOWN_MS    = (parseInt(import.meta.env.VITE_RECOVERY_COOLDOWN_HOURS, 10) || 24) * 3_600_000;
const BULK_CAP       = 100;

// ============================================
// FORMATTERS
// ============================================

const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(v || 0),
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
    return fmt.currency(n);
  },
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:    (v) => `${(v || 0).toFixed(1)}%`,
  date: (d) =>
    d
      ? new Date(d).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : '—',
  hours: (h) =>
    h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m ago` : `${h.toFixed(0)}h ago`,
};

const STEP_LABELS = {
  shipping_info:      'Shipping',
  order_confirmation: 'Order Confirm',
  payment_selection:  'Pmt Selection',
  payment_gateway:    'Pmt Gateway',
  payment_failed:     'Pmt Failed',
};

const resolveStep = (s = '') =>
  STEP_LABELS[s] || s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function getPriority(score) {
  if (score >= 70) return { label: 'High',   cls: 're-priority--high' };
  if (score >= 40) return { label: 'Medium', cls: 're-priority--med' };
  return               { label: 'Low',    cls: 're-priority--low' };
}

// ============================================
// SMALL COMPONENTS
// ============================================

function Spinner({ h = 200 }) {
  return (
    <div className="re-loading" style={{ minHeight: h }}>
      <div className="re-spinner" /><span>Loading…</span>
    </div>
  );
}

function Empty({ label = 'No data available', h = 200 }) {
  return (
    <div className="re-empty" style={{ minHeight: h }}>
      <Email style={{ fontSize: 40, color: '#9ca3af' }} />
      <span>{label}</span>
    </div>
  );
}

function KpiSkel() {
  return (
    <div className="re-kpi re-kpi--skel">
      <div className="re-skel" style={{ width: 40, height: 40, borderRadius: 10, marginBottom: 14 }} />
      <div className="re-skel" style={{ width: '55%', height: 10, marginBottom: 8 }} />
      <div className="re-skel" style={{ width: '75%', height: 26 }} />
    </div>
  );
}

// Per-row send button — reads from Redux send state
function SendButton({ checkoutId, now }) {
  const dispatch   = useDispatch();
  const anySending = useSelector(selectAnySending);
  const sendState  = useSelector(selectSendState(checkoutId));
  const checkout   = useSelector(state =>
    state.recoveryEmail.checkouts.find(c => c._id === checkoutId)
  );

  if (!checkout) return null;

  const ab         = checkout.abandonment || {};
  const converted  = checkout.conversion?.isConverted;
  const count      = sendState.emailCount ?? ab.recoveryEmailCount  ?? 0;
  const sentAt     = sendState.sentAt     ?? ab.recoveryEmailSentAt ?? null;

  const cooldownUntil = sentAt
    ? new Date(new Date(sentAt).getTime() + COOLDOWN_MS)
    : null;

  const inCooldown = !!(cooldownUntil && cooldownUntil.getTime() > now);
  const maxReached = count >= MAX_ATTEMPTS;
  const isSending  = sendState.status === 'sending';

  if (converted) {
    return <span className="re-status-pill re-status-pill--converted">Converted</span>;
  }
  if (maxReached) {
    return (
      <span className="re-status-pill re-status-pill--maxed">
        Max ({MAX_ATTEMPTS}/{MAX_ATTEMPTS})
      </span>
    );
  }
  if (inCooldown) {
    const hLeft = Math.ceil((cooldownUntil.getTime() - now) / 3_600_000);
    return (
      <span
        className="re-status-pill re-status-pill--cooldown"
        title={`Next send: ${cooldownUntil.toLocaleString()}`}
      >
        {hLeft}h cooldown
      </span>
    );
  }
  if (sendState.status === 'skipped') {
    return (
      <div className="re-send-cell">
        <span className="re-status-pill re-status-pill--skipped" title={sendState.reason}>
          Skipped
        </span>
        <button
          className="re-btn re-btn--ghost re-btn--xs"
          onClick={() => dispatch(resetSendState(checkoutId))}
        >
          Retry
        </button>
      </div>
    );
  }
  if (sendState.status === 'failed') {
    return (
      <div className="re-send-cell">
        <span
          className="re-status-pill re-status-pill--failed"
          title={sendState.error}
        >
          Failed
        </span>
        <button
          className="re-btn re-btn--ghost re-btn--xs"
          onClick={() => dispatch(resetSendState(checkoutId))}
        >
          Retry
        </button>
      </div>
    );
  }

  const label = isSending
    ? 'Sending…'
    : count > 0
    ? `Resend (${count}/${MAX_ATTEMPTS})`
    : 'Send Email';

  return (
    <button
      className="re-btn re-btn--send"
      onClick={() => dispatch(sendSingleEmail(checkoutId))}
      disabled={isSending || anySending}
      title={count > 0 ? `Send attempt ${count + 1} of ${MAX_ATTEMPTS}` : 'Send first recovery email'}
    >
      {isSending
        ? <span className="re-inline-spinner" />
        : <Send style={{ fontSize: 12 }} />
      }
      {label}
    </button>
  );
}

// Bulk results modal
function BulkResultsModal({ results, message, onClose }) {
  if (!results) return null;
  const { sent = [], skipped = [], failed = [], summary = {} } = results;

  return (
    <div className="re-modal-overlay" onClick={onClose}>
      <div className="re-modal" onClick={e => e.stopPropagation()}>
        <div className="re-modal-hd">
          <h3 className="re-modal-title">Bulk Send Results</h3>
          <button className="re-modal-close" onClick={onClose}>
            <Close style={{ fontSize: 18 }} />
          </button>
        </div>

        <div className="re-modal-summary">
          <div className="re-modal-stat re-modal-stat--sent">
            <div className="re-modal-stat-val">{summary.sent ?? sent.length}</div>
            <div className="re-modal-stat-label">Sent</div>
          </div>
          <div className="re-modal-stat re-modal-stat--skipped">
            <div className="re-modal-stat-val">{summary.skipped ?? skipped.length}</div>
            <div className="re-modal-stat-label">Skipped</div>
          </div>
          <div className="re-modal-stat re-modal-stat--failed">
            <div className="re-modal-stat-val">{summary.failed ?? failed.length}</div>
            <div className="re-modal-stat-label">Failed</div>
          </div>
        </div>

        {message && (
          <p className="re-modal-message">{message}</p>
        )}

        {failed.length > 0 && (
          <div className="re-modal-section">
            <p className="re-modal-section-title">Failed sends</p>
            <div className="re-modal-list">
              {failed.map((f, i) => (
                <div key={i} className="re-modal-list-item re-modal-list-item--failed">
                  <span className="re-modal-list-id">{f.id}</span>
                  <span className="re-modal-list-reason">{f.error}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {skipped.length > 0 && (
          <div className="re-modal-section">
            <p className="re-modal-section-title">Skipped (expected gates)</p>
            <div className="re-modal-list">
              {skipped.slice(0, 10).map((s, i) => (
                <div key={i} className="re-modal-list-item re-modal-list-item--skipped">
                  <span className="re-modal-list-id">{s.id}</span>
                  <span className="re-modal-list-reason">{s.reason}</span>
                </div>
              ))}
              {skipped.length > 10 && (
                <p className="re-modal-more">+{skipped.length - 10} more skipped</p>
              )}
            </div>
          </div>
        )}

        <button className="re-btn re-btn--primary re-modal-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

// Confirm bulk send modal
function BulkConfirmModal({ count, estimatedSeconds, onConfirm, onCancel, sending }) {
  return (
    <div className="re-modal-overlay" onClick={onCancel}>
      <div className="re-modal re-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="re-modal-hd">
          <h3 className="re-modal-title">Confirm bulk send</h3>
          <button className="re-modal-close" onClick={onCancel} disabled={sending}>
            <Close style={{ fontSize: 18 }} />
          </button>
        </div>

        <div className="re-confirm-body">
          <div className="re-confirm-icon">
            <Email style={{ fontSize: 28, color: '#ff3c3c' }} />
          </div>
          <p className="re-confirm-text">
            You are about to send recovery emails to
            <strong> {fmt.number(count)} customer{count !== 1 ? 's' : ''}</strong>.
            This cannot be undone.
          </p>
          <p className="re-confirm-sub">
            Estimated time: ~{estimatedSeconds < 60
              ? `${estimatedSeconds}s`
              : `${Math.ceil(estimatedSeconds / 60)}min`}
          </p>
          <p className="re-confirm-warn">
            Checkouts already converted, in cooldown, or at max attempts will be skipped automatically.
          </p>
        </div>

        <div className="re-confirm-actions">
          <button
            className="re-btn re-btn--ghost"
            onClick={onCancel}
            disabled={sending}
          >
            Cancel
          </button>
          <button
            className="re-btn re-btn--danger"
            onClick={onConfirm}
            disabled={sending}
          >
            {sending
              ? <><span className="re-inline-spinner re-inline-spinner--dark" />Sending…</>
              : <><Send style={{ fontSize: 14 }} />Send {fmt.number(count)} emails</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function RecoveryEmailPage() {
  const dispatch = useDispatch();

  // ── Redux state ────────────────────────────────────────────────────────
  const checkouts     = useSelector(selectRecoveryCheckouts);
  const listStatus    = useSelector(selectRecoveryListStatus);
  const listError     = useSelector(selectRecoveryListError);
  const pagination    = useSelector(selectRecoveryPagination);
  const listSummary   = useSelector(selectRecoveryListSummary);
  const filters       = useSelector(selectRecoveryFilters);
  const selectedIds   = useSelector(selectSelectedIds);
  const bulkStatus    = useSelector(selectBulkStatus);
  const bulkResults   = useSelector(selectBulkResults);
  const bulkError     = useSelector(selectBulkError);
  const bulkMessage   = useSelector(selectBulkMessage);
  const anySending    = useSelector(selectAnySending);
  const eligibleCount = useSelector(selectEligibleSelectedCount);

  // ── Local UI state ─────────────────────────────────────────────────────
  // FIX: Use lazy initializer (() => Date.now()) so Date.now() is not called
  // during every render, satisfying the react-hooks/purity rule.
  const [now,              setNow]              = useState(() => Date.now());
  const [showConfirm,      setShowConfirm]      = useState(false);
  const [showResults,      setShowResults]      = useState(false);
  const [showFilters,      setShowFilters]      = useState(false);
  const abortRef = useRef(null);

  // Tick every minute so cooldown labels update
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Show results modal when bulk send completes
  useEffect(() => {
    if (bulkStatus === 'succeeded' || bulkStatus === 'failed') {
      setShowConfirm(false);
      setShowResults(true);
    }
  }, [bulkStatus]);

  // ── Fetch ──────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller  = new AbortController();
    abortRef.current  = controller;

    const params = { ...filters };
    // Strip undefined so URLSearchParams doesn't serialise them as 'undefined'
    Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

    dispatch(fetchRecoveryEmailList(params));
  }, [dispatch, filters]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // ── Derived stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const sentCount    = checkouts.filter(c => c.abandonment?.recoveryEmailSent).length;
    const unsentCount  = checkouts.filter(
      c => !c.abandonment?.recoveryEmailSent &&
           !c.conversion?.isConverted &&
           !c.abandonment?.recovered
    ).length;
    const convertedCount = checkouts.filter(c => c.conversion?.isConverted).length;
    const reAbandonedCount = checkouts.filter(c => c.abandonment?.reAbandoned).length;

    return { sentCount, unsentCount, convertedCount, reAbandonedCount };
  }, [checkouts]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleFilterChange = useCallback((key, value) => {
    dispatch(setFilters({ [key]: value }));
  }, [dispatch]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.length === checkouts.filter(
      c => !c.conversion?.isConverted && !c.abandonment?.recovered
    ).length) {
      dispatch(clearSelection());
    } else {
      dispatch(selectAllIds());
    }
  }, [dispatch, selectedIds.length, checkouts]);

  const handleBulkSend = useCallback(() => {
    if (selectedIds.length === 0 || selectedIds.length > BULK_CAP) return;
    setShowConfirm(true);
  }, [selectedIds]);

  const handleConfirmBulk = useCallback(() => {
    dispatch(sendBulkEmails(selectedIds));
  }, [dispatch, selectedIds]);

  const handleCloseResults = useCallback(() => {
    setShowResults(false);
    dispatch(resetBulkState());
    load(); // Refresh list after bulk send
  }, [dispatch, load]);

  const handlePageChange = useCallback((page) => {
    dispatch(setFilters({ page }));
  }, [dispatch]);

  const isLoading  = listStatus === 'loading';
  const isFirstLoad = listStatus === 'idle' || (isLoading && checkouts.length === 0);
  const estimatedSeconds = Math.ceil(selectedIds.length * 0.3) + 2;

  const eligibleForSelectAll = checkouts.filter(
    c => !c.conversion?.isConverted && !c.abandonment?.recovered
  );
  const allSelected = eligibleForSelectAll.length > 0 &&
    selectedIds.length === eligibleForSelectAll.length;

  // ============================================
  // RENDER
  // ============================================

  return (
    <>
      <Navbar />
      <div className="re-page">
        <div className="re-body">

          {/* ── Back ─────────────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="re-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* ── Header ───────────────────────────────────────────── */}
          <div className="re-hd">
            <div className="re-hd-left">
              <span className="re-hd-icon">
                <Email style={{ fontSize: 26 }} />
              </span>
              <div>
                <div className="re-hd-eyebrow">Cart Recovery</div>
                <h1 className="re-hd-title">Recovery Emails</h1>
                <p className="re-hd-sub">
                  Send targeted recovery emails to abandoned checkouts
                </p>
              </div>
            </div>
            <div className="re-hd-right">
              <button
                className={`re-btn re-btn--icon ${isLoading ? 're-btn--spinning' : ''}`}
                onClick={load}
                disabled={isLoading || anySending}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {/* ── Error Banner ─────────────────────────────────────── */}
          {listError && !isFirstLoad && (
            <div className="re-error-banner">
              <ErrorOutline style={{ fontSize: 16 }} />
              {listError}
            </div>
          )}

          {bulkError && (
            <div className="re-error-banner">
              <ErrorOutline style={{ fontSize: 16 }} />
              Bulk send failed: {bulkError}
            </div>
          )}

          {/* ── KPI Cards ────────────────────────────────────────── */}
          <div className="re-kpi-grid">
            {isFirstLoad ? (
              Array.from({ length: 5 }).map((_, i) => <KpiSkel key={i} />)
            ) : (
              <>
                <div className="re-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
                  <div className="re-kpi-top">
                    <span className="re-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span>
                  </div>
                  <div className="re-kpi-label">Total Abandoned</div>
                  <div className="re-kpi-value">{fmt.number(pagination.totalCheckouts)}</div>
                  <div className="re-kpi-footer">
                    <span className="re-kpi-sub">{fmt.compact(listSummary.totalValue)} at risk</span>
                  </div>
                </div>

                <div className="re-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                  <div className="re-kpi-top">
                    <span className="re-kpi-icon"><Email style={{ fontSize: 20 }} /></span>
                  </div>
                  <div className="re-kpi-label">Unsent (eligible)</div>
                  <div className="re-kpi-value">{fmt.number(stats.unsentCount)}</div>
                  <div className="re-kpi-footer">
                    <span className="re-kpi-sub">Ready to contact</span>
                  </div>
                </div>

                <div className="re-kpi" style={{ '--kpi-color': '#1D4ED8', '--kpi-bg': 'rgba(29,78,216,0.08)' }}>
                  <div className="re-kpi-top">
                    <span className="re-kpi-icon"><MarkEmailRead style={{ fontSize: 20 }} /></span>
                  </div>
                  <div className="re-kpi-label">Emails Sent</div>
                  <div className="re-kpi-value">{fmt.number(stats.sentCount)}</div>
                  <div className="re-kpi-footer">
                    <span className="re-kpi-sub">In this view</span>
                  </div>
                </div>

                <div className="re-kpi" style={{ '--kpi-color': '#059669', '--kpi-bg': 'rgba(5,150,105,0.08)' }}>
                  <div className="re-kpi-top">
                    <span className="re-kpi-icon"><CheckCircle style={{ fontSize: 20 }} /></span>
                  </div>
                  <div className="re-kpi-label">Converted</div>
                  <div className="re-kpi-value">{fmt.number(stats.convertedCount)}</div>
                  <div className="re-kpi-footer">
                    <span className="re-kpi-sub">After email contact</span>
                  </div>
                </div>

                <div className="re-kpi" style={{ '--kpi-color': '#7C3AED', '--kpi-bg': 'rgba(124,58,237,0.08)' }}>
                  <div className="re-kpi-top">
                    <span className="re-kpi-icon"><Loop style={{ fontSize: 20 }} /></span>
                  </div>
                  <div className="re-kpi-label">Re-abandoned</div>
                  <div className="re-kpi-value">{fmt.number(stats.reAbandonedCount)}</div>
                  <div className="re-kpi-footer">
                    <span className="re-kpi-sub">Failed recoveries</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Second row KPIs ──────────────────────────────────── */}
          {!isFirstLoad && (
            <div className="re-meta-row">
              <div className="re-meta-card">
                <AttachMoney style={{ fontSize: 16, color: '#6b7280' }} />
                <span className="re-meta-label">Avg cart value</span>
                <span className="re-meta-val">{fmt.compact(listSummary.avgValue)}</span>
              </div>
              <div className="re-meta-card">
                <Bolt style={{ fontSize: 16, color: '#6b7280' }} />
                <span className="re-meta-label">High priority</span>
                <span className="re-meta-val">{fmt.number(listSummary.highPriorityCheckouts)}</span>
              </div>
              <div className="re-meta-card">
                <PersonSearch style={{ fontSize: 16, color: '#6b7280' }} />
                <span className="re-meta-label">Re-abandoned (list)</span>
                <span className="re-meta-val">{fmt.number(listSummary.reAbandonedCount)}</span>
              </div>
              <div className="re-meta-card">
                <Warning style={{ fontSize: 16, color: '#6b7280' }} />
                <span className="re-meta-label">Total value</span>
                <span className="re-meta-val">{fmt.compact(listSummary.totalValue)}</span>
              </div>
            </div>
          )}

          {/* ── Filters + Bulk bar ────────────────────────────────── */}
          <div className="re-toolbar">
            <div className="re-toolbar-left">
              <button
                className={`re-btn re-btn--ghost re-btn--sm ${showFilters ? 're-btn--active' : ''}`}
                onClick={() => setShowFilters(p => !p)}
              >
                <FilterList style={{ fontSize: 15 }} />
                Filters
                {(filters.emailSent !== undefined || filters.reAbandoned !== undefined) && (
                  <span className="re-filter-dot" />
                )}
              </button>

              {selectedIds.length > 0 && (
                <span className="re-selection-pill">
                  {selectedIds.length} selected
                  <button
                    className="re-selection-clear"
                    onClick={() => dispatch(clearSelection())}
                    title="Clear selection"
                  >
                    <Close style={{ fontSize: 13 }} />
                  </button>
                </span>
              )}
            </div>

            <div className="re-toolbar-right">
              {selectedIds.length > 0 && (
                <>
                  {selectedIds.length > BULK_CAP && (
                    <span className="re-cap-warn">Max {BULK_CAP} per bulk send</span>
                  )}
                  <button
                    className="re-btn re-btn--danger re-btn--sm"
                    onClick={handleBulkSend}
                    disabled={
                      anySending ||
                      eligibleCount === 0 ||
                      selectedIds.length > BULK_CAP
                    }
                    title={`Send to ${eligibleCount} eligible selected checkouts`}
                  >
                    {bulkStatus === 'sending'
                      ? <><span className="re-inline-spinner" />Sending bulk…</>
                      : <><Send style={{ fontSize: 13 }} />Bulk send ({eligibleCount})</>
                    }
                  </button>
                </>
              )}

              <span className="re-total-label">
                {fmt.number(pagination.totalCheckouts)} checkouts
              </span>
            </div>
          </div>

          {/* ── Filter panel ─────────────────────────────────────── */}
          {showFilters && (
            <div className="re-filter-panel">
              <div className="re-filter-row">
                <label className="re-filter-label">Email status</label>
                <div className="re-filter-pills">
                  {[
                    { value: undefined, label: 'All' },
                    { value: 'false',   label: 'Not sent' },
                    { value: 'true',    label: 'Sent' },
                  ].map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`re-pill ${filters.emailSent === opt.value ? 're-pill--active' : ''}`}
                      onClick={() => handleFilterChange('emailSent', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="re-filter-row">
                <label className="re-filter-label">Re-abandoned</label>
                <div className="re-filter-pills">
                  {[
                    { value: undefined, label: 'All' },
                    { value: 'true',    label: 'Yes' },
                    { value: 'false',   label: 'No' },
                  ].map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`re-pill ${filters.reAbandoned === opt.value ? 're-pill--active' : ''}`}
                      onClick={() => handleFilterChange('reAbandoned', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="re-filter-row">
                <label className="re-filter-label">Time window</label>
                <div className="re-filter-pills">
                  {[
                    { value: 24,  label: '24h' },
                    { value: 72,  label: '3 days' },
                    { value: 168, label: '7 days' },
                    { value: 720, label: '30 days' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      className={`re-pill ${filters.hours === opt.value ? 're-pill--active' : ''}`}
                      onClick={() => handleFilterChange('hours', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="re-filter-row">
                <label className="re-filter-label">Sort by</label>
                <div className="re-filter-pills">
                  {[
                    { value: 'priority', label: 'Priority' },
                    { value: 'value',    label: 'Cart value' },
                    { value: 'date',     label: 'Date' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      className={`re-pill ${filters.sortBy === opt.value ? 're-pill--active' : ''}`}
                      onClick={() => handleFilterChange('sortBy', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="re-btn re-btn--ghost re-btn--xs"
                onClick={() => dispatch(resetFilters())}
              >
                Reset filters
              </button>
            </div>
          )}

          {/* ── Table ────────────────────────────────────────────── */}
          <div className="re-card">
            <div className="re-card-hd">
              <div className="re-card-hd-left">
                <Email style={{ fontSize: 18, color: '#ff3c3c' }} />
                <div>
                  <h3 className="re-card-title">Abandoned Checkouts</h3>
                  <p className="re-card-sub">
                    High priority first — act on unsent rows for maximum recovery
                  </p>
                </div>
              </div>
            </div>

            {isFirstLoad ? (
              <Spinner h={320} />
            ) : checkouts.length === 0 ? (
              <Empty label="No abandoned checkouts match your filters." h={280} />
            ) : (
              <>
                <div className="re-tbl-wrap">
                  <table className="re-tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            className="re-checkbox"
                            checked={allSelected}
                            onChange={handleSelectAll}
                            title="Select all eligible"
                          />
                        </th>
                        <th>#</th>
                        <th>Customer</th>
                        <th>Cart Value</th>
                        <th>Items</th>
                        <th>Abandoned Step</th>
                        <th>Priority</th>
                        <th>Email Status</th>
                        <th>Abandoned</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkouts.map((c, i) => {
                        const user          = c.user || {};
                        const priorityScore = c.priority ?? 0;
                        const priority      = getPriority(priorityScore);
                        const ab            = c.abandonment || {};
                        const isSelected    = selectedIds.includes(c._id);
                        const isReAbandoned = ab.reAbandoned === true;
                        const emailCount    = ab.recoveryEmailCount ?? 0;
                        const sentAt        = ab.recoveryEmailSentAt ?? null;
                        const isConverted   = c.conversion?.isConverted;
                        const isRecovered   = ab.recovered;
                        const firstStep     = ab.firstAbandonedAtStep || ab.abandonedAtStep;
                        const rowNum        = (filters.page - 1) * filters.limit + i + 1;

                        return (
                          <tr
                            key={c._id}
                            className={`${isSelected ? 're-tbl-row--selected' : ''} ${isConverted ? 're-tbl-row--converted' : ''}`}
                          >
                            <td>
                              <input
                                type="checkbox"
                                className="re-checkbox"
                                checked={isSelected}
                                disabled={isConverted || isRecovered}
                                onChange={() => dispatch(toggleSelectId(c._id))}
                              />
                            </td>
                            <td className="re-td-rank">{rowNum}</td>
                            <td>
                              <div className="re-customer">
                                <span className="re-customer-name">
                                  {user.firstName
                                    ? `${user.firstName} ${user.lastName || ''}`.trim()
                                    : 'Guest'}
                                </span>
                                <span className="re-customer-email">
                                  {user.email || c.email || '—'}
                                </span>
                              </div>
                            </td>
                            <td className="re-td-money">
                              {fmt.compact(c.pricing?.totalPrice || 0)}
                            </td>
                            <td>{c.items?.length ?? 0}</td>
                            <td>
                              <span className="re-step-label">
                                {resolveStep(firstStep)}
                              </span>
                            </td>
                            <td>
                              <span className={`re-priority ${priority.cls}`}>
                                {priority.label}
                              </span>
                              <span className="re-score">
                                {priorityScore}
                              </span>
                            </td>
                            <td>
                              <div className="re-email-status">
                                {isConverted ? (
                                  <span className="re-status-pill re-status-pill--converted">
                                    Converted
                                  </span>
                                ) : isRecovered ? (
                                  <span className="re-status-pill re-status-pill--recovered">
                                    Recovered
                                  </span>
                                ) : emailCount > 0 ? (
                                  <div className="re-email-meta">
                                    <span className="re-status-pill re-status-pill--sent">
                                      Sent ({emailCount}/{MAX_ATTEMPTS})
                                    </span>
                                    {sentAt && (
                                      <span className="re-email-date">
                                        {fmt.date(sentAt)}
                                      </span>
                                    )}
                                    {isReAbandoned && (
                                      <span className="re-flag re-flag--reabandoned">
                                        Re-abn
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="re-status-pill re-status-pill--unsent">
                                    Not sent
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="re-td-date">
                              {/* FIX: Use 'now' state variable instead of calling Date.now() directly in render */}
                              {fmt.hours(
                                ab.abandonedAt
                                  ? (now - new Date(ab.abandonedAt).getTime()) / 3_600_000
                                  : null
                              )}
                            </td>
                            <td>
                              <SendButton checkoutId={c._id} now={now} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── Pagination ──────────────────────────────────── */}
                {pagination.totalPages > 1 && (
                  <div className="re-pagination">
                    <button
                      className="re-btn re-btn--ghost re-btn--sm"
                      onClick={() => handlePageChange(filters.page - 1)}
                      disabled={!pagination.hasPrevPage || isLoading}
                    >
                      Previous
                    </button>
                    <span className="re-page-info">
                      Page {pagination.currentPage} of {pagination.totalPages}
                    </span>
                    <button
                      className="re-btn re-btn--ghost re-btn--sm"
                      onClick={() => handlePageChange(filters.page + 1)}
                      disabled={!pagination.hasNextPage || isLoading}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Bulk select bar ──────────────────────────────────── */}
          {checkouts.length > 0 && !isFirstLoad && (
            <div className="re-select-bar">
              <button
                className="re-btn re-btn--ghost re-btn--sm"
                onClick={handleSelectAll}
                disabled={anySending}
              >
                <SelectAll style={{ fontSize: 15 }} />
                {allSelected ? 'Deselect all' : `Select all (${eligibleForSelectAll.length})`}
              </button>
              {selectedIds.length > 0 && (
                <span className="re-select-hint">
                  {eligibleCount} of {selectedIds.length} selected are eligible to send
                </span>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────── */}
      {showConfirm && (
        <BulkConfirmModal
          count={eligibleCount}
          estimatedSeconds={estimatedSeconds}
          onConfirm={handleConfirmBulk}
          onCancel={() => setShowConfirm(false)}
          sending={bulkStatus === 'sending'}
        />
      )}

      {showResults && bulkResults && (
        <BulkResultsModal
          results={bulkResults}
          message={bulkMessage}
          onClose={handleCloseResults}
        />
      )}
    </>
  );
}