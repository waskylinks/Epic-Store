import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  getAllDiscounts,
  getSingleDiscount,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  createCompensationDiscount,
  createDiscountForUsers,
  getDiscountStats,
  triggerCleanup,
  getAuditLog,
  getDiscountAuditLog,
  getPurgeLog,
  clearAdminDiscountState,
  clearCurrentDiscount,
  clearDiscountAuditLogs,
  clearCleanupResult,
  clearDeleteProtectionError,
  clearCompensationConflict,
  clearVipState,
  dismissPurgeBanner,
  appendDiscounts,
  appendAuditLogs,
  resetDiscountList,
} from '../features/admin/adminDiscountSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/AdminDiscounts.css';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const ACTION_META = {
  created:              { label: 'Created',        color: '#059669', bg: '#D1FAE5' },
  updated:              { label: 'Updated',        color: '#0369A1', bg: '#E0F2FE' },
  used:                 { label: 'Used',           color: '#7C3AED', bg: '#EDE9FE' },
  deactivated:          { label: 'Deactivated',    color: '#DC2626', bg: '#FEE2E2' },
  deactivation_blocked: { label: 'Block Attempt',  color: '#D97706', bg: '#FEF3C7' },
  manual_cleanup:       { label: 'Manual Cleanup', color: '#D97706', bg: '#FEF3C7' },
  sweep_run:            { label: 'Sweep Run',      color: '#6B7280', bg: '#F3F4F6' },
  sweep_auto_deleted:   { label: 'Auto-Deleted',   color: '#991B1B', bg: '#FEE2E2' },
  sweep_window_expired: { label: 'Window Expired', color: '#6B7280', bg: '#F3F4F6' },
};

const CATEGORY_OPTIONS = ['promo', 'refund', 'return', 'loyalty', 'affiliate', 'support'];
const TYPE_OPTIONS     = ['percentage', 'fixed'];
const STATUS_OPTIONS   = ['active', 'expired', 'inactive'];
const EDIT_STATUS_OPTIONS = ['active', 'inactive'];

const PRODUCT_CATEGORIES = [
  'Electronics',
  'Clothing & Apparel',
  'Home & Living',
  'Sports & Outdoors',
  'Beauty & Personal Care',
  'Books & Media',
  'Food & Beverages',
];

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const fmtCurrency = (n) =>
  typeof n === 'number' ? `$${n.toFixed(2)}` : '—';

const getDaysUntilEligible = (date) => {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / 86400000);
};

// ─────────────────────────────────────────────
// SMALL ATOMS
// ─────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const map = {
    active:           { label: 'Active',       cls: 'addisc-badge--active'   },
    expired:          { label: 'Expired',      cls: 'addisc-badge--expired'  },
    inactive:         { label: 'Inactive',     cls: 'addisc-badge--inactive' },
    pending_deletion: { label: 'Pending Del.', cls: 'addisc-badge--pending'  },
  };
  const m = map[status] ?? { label: status, cls: '' };
  return <span className={`addisc-badge ${m.cls}`}>{m.label}</span>;
};

const AudienceBadge = ({ audience }) => {
  if (audience === 'all') return <span className="addisc-audience-badge addisc-audience-badge--all">All users</span>;
  return <span className="addisc-audience-badge addisc-audience-badge--specific">Specific</span>;
};

const ActionBadge = ({ action }) => {
  const m = ACTION_META[action] ?? { label: action, color: '#6B7280', bg: '#F3F4F6' };
  return (
    <span className="addisc-action-badge" style={{ color: m.color, background: m.bg }}>
      {m.label}
    </span>
  );
};

const LockIcon = ({ title }) => (
  <span className="addisc-lock-icon" title={title} aria-label={title}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  </span>
);

const Spinner = ({ size = 18 }) => (
  <span className="addisc-spinner" style={{ width: size, height: size }} />
);

const EmptyState = ({ icon, title, desc }) => (
  <div className="addisc-empty">
    <div className="addisc-empty-icon">{icon}</div>
    <p className="addisc-empty-title">{title}</p>
    {desc && <p className="addisc-empty-desc">{desc}</p>}
  </div>
);

// ─────────────────────────────────────────────
// PRODUCT CATEGORY CHIPS
// ─────────────────────────────────────────────

const ProductCategoryChips = ({ selected = [], onChange, mode = 'select', disabled = false }) => {
  if (mode === 'display') {
    if (!selected || selected.length === 0) {
      return <span className="addisc-prodcat-none">All products</span>;
    }
    return (
      <div className="addisc-prodcat-chips">
        {selected.map((cat) => (
          <span key={cat} className="addisc-prodcat-chip addisc-prodcat-chip--display">{cat}</span>
        ))}
      </div>
    );
  }

  const toggle = (cat) => {
    if (disabled) return;
    const next = selected.includes(cat)
      ? selected.filter((c) => c !== cat)
      : [...selected, cat];
    onChange(next);
  };

  return (
    <div className="addisc-prodcat-chips">
      {PRODUCT_CATEGORIES.map((cat) => (
        <button
          key={cat}
          type="button"
          disabled={disabled}
          onClick={() => toggle(cat)}
          className={`addisc-prodcat-chip ${selected.includes(cat) ? 'addisc-prodcat-chip--active' : ''} ${disabled ? 'addisc-prodcat-chip--disabled' : ''}`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────
// AUDIT TIMELINE ENTRY
// ─────────────────────────────────────────────

const AuditEntry = ({ entry, compact = false }) => {
  const [expanded, setExpanded] = useState(false);
  const isSystem = entry.performedBy?.system === true;

  const actor = isSystem
    ? 'System (CRON)'
    : entry.performedBy?.firstName
      ? `${entry.performedBy.firstName} ${entry.performedBy.lastName ?? ''}`.trim()
      : entry.performedBy?.email ?? 'Unknown';

  const hasMeta = entry.meta && Object.keys(entry.meta).length > 0;

  return (
    <div className={`addisc-audit-entry ${isSystem ? 'addisc-audit-entry--system' : ''} ${compact ? 'addisc-audit-entry--compact' : ''}`}>
      <div className="addisc-audit-entry-dot" />
      <div className="addisc-audit-entry-body">
        <div className="addisc-audit-entry-row">
          <ActionBadge action={entry.action} />
          {!compact && <span className="addisc-audit-code">{entry.discountCode}</span>}
          <span className={`addisc-audit-actor ${isSystem ? 'addisc-audit-actor--system' : ''}`}>
            {isSystem && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
              </svg>
            )}
            {actor}
          </span>
          <span className="addisc-audit-time">{fmtDateTime(entry.performedAt)}</span>
          {hasMeta && (
            <button type="button" className="addisc-audit-expand"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse meta' : 'Expand meta'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
        {expanded && hasMeta && (
          <pre className="addisc-audit-meta">{JSON.stringify(entry.meta, null, 2)}</pre>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// CLEANUP CONFIRM MODAL
// ─────────────────────────────────────────────

const CleanupModal = ({ running, result, onConfirm, onClose }) => (
  <div className="addisc-modal-overlay" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
    <div className="addisc-modal addisc-cleanup-modal">
      <div className="addisc-modal-header">
        <h2 className="addisc-modal-title">Run Manual Cleanup</h2>
        <button type="button" className="addisc-modal-close" onClick={onClose} disabled={running} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="addisc-modal-form">
        <div className="addisc-cleanup-body">
          {result ? (
            <div className="addisc-cleanup-result">
              <div className="addisc-cleanup-result-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="addisc-cleanup-result-title">Cleanup complete</p>
              <p className="addisc-cleanup-result-desc">
                <strong>{result.expired}</strong> code{result.expired !== 1 ? 's' : ''} expired &nbsp;·&nbsp;
                <strong>{result.deleted}</strong> code{result.deleted !== 1 ? 's' : ''} permanently deleted
              </p>
            </div>
          ) : (
            <>
              <div className="addisc-cleanup-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.27" />
                </svg>
              </div>
              <p className="addisc-cleanup-desc">
                This will scan all discount codes and apply automated maintenance rules. This action cannot be undone.
              </p>
              <ul className="addisc-cleanup-checklist">
                <li>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Expire codes whose validUntil date has passed
                </li>
                <li>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Delete expired codes outside the 30-day fraud-protection window
                </li>
                <li>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Codes inside the fraud-protection window will not be deleted
                </li>
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="addisc-modal-footer addisc-cleanup-footer">
        <button type="button" className="addisc-btn addisc-btn--ghost" onClick={onClose} disabled={running}>
          {result ? 'Close' : 'Cancel'}
        </button>
        {!result && (
          <button type="button" className="addisc-btn addisc-btn--warning" onClick={onConfirm} disabled={running}>
            {running ? <><Spinner size={14} /> Running…</> : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.27" />
                </svg>
                Run cleanup
              </>
            )}
          </button>
        )}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// DETAIL DRAWER
// ─────────────────────────────────────────────

const DetailDrawer = ({
  discount,
  currentDiscount,
  detailLoading,
  auditLogs,
  auditLoading,
  deleteProtectionError,
  usageHistoryTotal,
  usageHistoryCapped,
  onClose,
  onEdit,
  onDelete,
}) => {
  const d = currentDiscount ?? discount;

  const daysLeft = getDaysUntilEligible(d.deletionEligibleAt);
  const isLocked = (d.usageLimit?.currentUses ?? 0) >= 1 &&
                   d.deletionEligibleAt &&
                   new Date(d.deletionEligibleAt) > new Date();

  const eligibleProductCategories = d.conditions?.eligibleProductCategories ?? [];

  return (
    <div className="addisc-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="addisc-drawer">
        <div className="addisc-drawer-header">
          <div className="addisc-drawer-header-left">
            <span className="addisc-drawer-code">{d.code}</span>
            <StatusBadge status={d.status} />
            <AudienceBadge audience={d.audience} />
          </div>
          <button type="button" className="addisc-drawer-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="addisc-drawer-body">
          {detailLoading && (
            <div className="addisc-drawer-detail-loading">
              <Spinner size={16} /><span>Loading full details…</span>
            </div>
          )}

          <section className="addisc-drawer-section">
            <h4 className="addisc-drawer-section-title">Details</h4>
            <div className="addisc-drawer-grid">
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Type</span>
                <span className="addisc-drawer-value">{d.type}</span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Value</span>
                <span className="addisc-drawer-value addisc-drawer-value--bold">
                  {d.type === 'percentage' ? `${d.value}%` : fmtCurrency(d.value)}
                </span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Category</span>
                <span className="addisc-drawer-value">{d.category}</span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Audience</span>
                <span className="addisc-drawer-value">
                  {d.audience === 'all' ? 'All users (broadcast)' : 'Specific users'}
                </span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Valid from</span>
                <span className="addisc-drawer-value">{fmtDate(d.validFrom)}</span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Valid until</span>
                <span className="addisc-drawer-value">{fmtDate(d.validUntil)}</span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Uses</span>
                <span className="addisc-drawer-value">
                  {d.usageLimit?.currentUses ?? 0}
                  {d.usageLimit?.totalUses ? ` / ${d.usageLimit.totalUses}` : ' / ∞'}
                </span>
              </div>
              <div className="addisc-drawer-field">
                <span className="addisc-drawer-label">Per user</span>
                <span className="addisc-drawer-value">{d.usageLimit?.usesPerUser ?? '∞'}</span>
              </div>
              {d.createdBy && (
                <div className="addisc-drawer-field">
                  <span className="addisc-drawer-label">Created by</span>
                  <span className="addisc-drawer-value">
                    {d.createdBy.firstName
                      ? `${d.createdBy.firstName} ${d.createdBy.lastName ?? ''}`.trim()
                      : d.createdBy.email ?? '—'}
                  </span>
                </div>
              )}
              {d.relatedOrder && (
                <div className="addisc-drawer-field">
                  <span className="addisc-drawer-label">Related order</span>
                  <span className="addisc-drawer-value">{d.relatedOrder.orderNumber ?? d.relatedOrder}</span>
                </div>
              )}

              <div className="addisc-drawer-field addisc-drawer-field--full">
                <span className="addisc-drawer-label">Product categories</span>
                <ProductCategoryChips
                  selected={eligibleProductCategories}
                  mode="display"
                />
              </div>
            </div>
            {d.description && <p className="addisc-drawer-desc">{d.description}</p>}
            {d.notes && <p className="addisc-drawer-notes">📝 {d.notes}</p>}
          </section>

          {d.usageHistory?.length > 0 && (
            <section className="addisc-drawer-section">
              <h4 className="addisc-drawer-section-title">
                Usage history
                {usageHistoryCapped && usageHistoryTotal && (
                  <span className="addisc-drawer-section-hint">
                    Showing last {d.usageHistory.length} of {usageHistoryTotal}
                  </span>
                )}
              </h4>
              <div className="addisc-usage-list">
                {d.usageHistory.slice(-10).map((entry, i) => (
                  <div key={entry._id ?? i} className="addisc-usage-entry">
                    <span className="addisc-usage-user">
                      {entry.user?.firstName
                        ? `${entry.user.firstName} ${entry.user.lastName ?? ''}`.trim()
                        : 'Guest'}
                    </span>
                    <span className="addisc-usage-amount">{fmtCurrency(entry.discountAmount)}</span>
                    <span className="addisc-usage-date">{fmtDate(entry.usedAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {deleteProtectionError && (
            <section className="addisc-drawer-section">
              <div className="addisc-modal-error" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {deleteProtectionError.message}
              </div>
            </section>
          )}

          {isLocked ? (
            <section className="addisc-drawer-section addisc-drawer-section--locked">
              <div className="addisc-lock-banner">
                <LockIcon title="Protected" />
                <div>
                  <p className="addisc-lock-banner-title">Fraud protection active</p>
                  <p className="addisc-lock-banner-desc">
                    This discount was used on {fmtDate(d.lockedAt)}.
                    Deactivation is locked for 30 days to protect the audit trail.
                    Eligible for deactivation on <strong>{fmtDate(d.deletionEligibleAt)}</strong>
                    {daysLeft !== null && ` (${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining)`}.
                  </p>
                </div>
              </div>
            </section>
          ) : d.lockedAt ? (
            <section className="addisc-drawer-section">
              <div className="addisc-lock-banner addisc-lock-banner--cleared">
                <div>
                  <p className="addisc-lock-banner-title">Protection window passed</p>
                  <p className="addisc-lock-banner-desc">
                    First used {fmtDate(d.lockedAt)}. Protection window ended {fmtDate(d.deletionEligibleAt)}.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="addisc-drawer-section">
            <h4 className="addisc-drawer-section-title">
              Audit trail
              <span className="addisc-drawer-section-hint">Last 20 entries</span>
            </h4>
            {auditLoading ? (
              <div className="addisc-drawer-audit-loading">
                <Spinner size={16} /><span>Loading audit trail…</span>
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="addisc-drawer-no-audit">No audit entries yet.</p>
            ) : (
              <div className="addisc-audit-timeline">
                {auditLogs.map((entry) => (
                  <AuditEntry key={entry._id} entry={entry} compact />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="addisc-drawer-footer">
          <button type="button" className="addisc-btn addisc-btn--outline" onClick={() => onEdit(d)}>
            Edit
          </button>
          <button
            type="button"
            className={`addisc-btn ${isLocked ? 'addisc-btn--locked' : 'addisc-btn--danger'}`}
            onClick={() => !isLocked && onDelete(d)}
            disabled={isLocked}
            title={isLocked ? `Protected until ${fmtDate(d.deletionEligibleAt)}` : 'Deactivate discount'}>
            {isLocked ? (
              <><LockIcon /> Protected until {fmtDate(d.deletionEligibleAt)}</>
            ) : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// CREATE / EDIT MODAL
// ─────────────────────────────────────────────

const DiscountModal = ({ mode = 'create', initial = {}, loading, error, onSubmit, onClose }) => {
  const [form, setForm] = useState({
    code:                      initial.code        ?? '',
    description:               initial.description ?? '',
    type:                      initial.type        ?? 'percentage',
    value:                     initial.value       ?? '',
    category:                  initial.category    ?? 'promo',
    audience:                  initial.audience    ?? 'all',
    status:                    initial.status      ?? 'active',
    validFrom:                 initial.validFrom   ? initial.validFrom.slice(0, 10) : '',
    validUntil:                initial.validUntil  ? initial.validUntil.slice(0, 10) : '',
    usageLimit:                initial.usageLimit  ?? { totalUses: '', usesPerUser: 1 },
    conditions:                initial.conditions  ?? { minPurchaseAmount: 0, firstOrderOnly: false },
    notes:                     initial.notes       ?? '',
    eligibleProductCategories: initial.conditions?.eligibleProductCategories ?? [],
  });

  const set = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form };
    if (payload.eligibleProductCategories.length === 0) {
      delete payload.eligibleProductCategories;
    }
    onSubmit(payload);
  };

  const isEditRestricted = mode === 'edit' && form.eligibleProductCategories.length > 0;

  return (
    <div className="addisc-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="addisc-modal">

        {/* ── Header ── */}
        <div className="addisc-modal-header">
          <div className="addisc-modal-header-left">
            <div className="addisc-modal-title-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </div>
            <div>
              <h2 className="addisc-modal-title">
                {mode === 'create' ? 'New Broadcast Discount' : `Edit — ${initial.code}`}
              </h2>
              <p className="addisc-modal-subtitle">
                {mode === 'create'
                  ? 'Visible to all users · triggers navbar notification'
                  : 'Update editable fields. Type, value, and category are locked after creation.'}
              </p>
            </div>
          </div>
          <button type="button" className="addisc-modal-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable form body ── */}
        <form className="addisc-modal-form" onSubmit={handleSubmit}>

          {error && (
            <div className="addisc-modal-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* ── SECTION: Audience ── */}
          <div className="addisc-form-section">
            <div className="addisc-form-section-label">Audience</div>
            <div className={`addisc-audience-display ${form.audience === 'all' ? 'addisc-audience-display--broadcast' : 'addisc-audience-display--specific'}`}>
              <div className="addisc-audience-display-icon">
                {form.audience === 'all' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>
              <div className="addisc-audience-display-text">
                <span className="addisc-audience-display-name">
                  {form.audience === 'all' ? 'All users (broadcast)' : 'Specific users'}
                </span>
                {mode === 'create' && (
                  <span className="addisc-audience-display-hint">
                    To target specific users, use the <strong>VIP discount</strong> button instead.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── SECTION: Identity ── */}
          <div className="addisc-form-section">
            <div className="addisc-form-section-label">Identity</div>

            {mode === 'create' && (
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-code">Discount code</label>
                <input id="addisc-code" className="addisc-form-input" type="text"
                  placeholder="e.g. SUMMER25"
                  value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())}
                  required maxLength={40} />
                <span className="addisc-form-hint">Customers will enter this code at checkout.</span>
              </div>
            )}

            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="addisc-desc">Description <span className="addisc-form-label-required">*</span></label>
              <textarea id="addisc-desc" className="addisc-form-textarea" rows={2}
                placeholder="e.g. Summer sale — 20% off all orders"
                value={form.description} onChange={(e) => set('description', e.target.value)} required />
              <span className="addisc-form-hint">Shown to customers in their cart and order details.</span>
            </div>
          </div>

          {/* ── SECTION: Discount value ── */}
          <div className="addisc-form-section">
            <div className="addisc-form-section-label">Discount value</div>

            <div className="addisc-form-row">
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-type">Type</label>
                <select id="addisc-type" className="addisc-form-select" value={form.type}
                  onChange={(e) => set('type', e.target.value)} disabled={mode === 'edit'}>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount ($)</option>
                </select>
                {mode === 'edit' && <span className="addisc-form-hint addisc-form-hint--locked">Locked after creation</span>}
              </div>
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-value">
                  Value {form.type === 'percentage' ? '(%)' : '($)'}
                </label>
                <input id="addisc-value" className="addisc-form-input" type="number" min="0" step="0.01"
                  placeholder={form.type === 'percentage' ? '20' : '10.00'}
                  value={form.value} onChange={(e) => set('value', e.target.value)}
                  required={mode === 'create'} disabled={mode === 'edit'} />
                {mode === 'edit' && <span className="addisc-form-hint addisc-form-hint--locked">Locked after creation</span>}
              </div>
            </div>

            <div className="addisc-form-row">
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-category">Category</label>
                <select id="addisc-category" className="addisc-form-select" value={form.category}
                  onChange={(e) => set('category', e.target.value)} disabled={mode === 'edit'}>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>)}
                </select>
                {mode === 'edit' && <span className="addisc-form-hint addisc-form-hint--locked">Locked after creation</span>}
              </div>
              {mode === 'edit' && (
                <div className="addisc-form-field">
                  <label className="addisc-form-label" htmlFor="addisc-status">Status</label>
                  <select id="addisc-status" className="addisc-form-select" value={form.status}
                    onChange={(e) => set('status', e.target.value)}>
                    {EDIT_STATUS_OPTIONS.map((s) => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
                  </select>
                  {form.status === 'active' && (
                    <span className="addisc-form-hint addisc-form-hint--warn">
                      Reactivating requires a future validUntil date.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── SECTION: Validity window ── */}
          <div className="addisc-form-section">
            <div className="addisc-form-section-label">Validity window</div>
            <div className="addisc-form-row">
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-from">Active from</label>
                <input id="addisc-from" className="addisc-form-input" type="date"
                  value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
                <span className="addisc-form-hint">Leave blank to activate immediately.</span>
              </div>
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-until">
                  Expires on <span className="addisc-form-label-required">*</span>
                </label>
                <input id="addisc-until" className="addisc-form-input" type="date"
                  value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} required />
              </div>
            </div>
          </div>

          {/* ── SECTION: Usage limits ── */}
          <div className="addisc-form-section">
            <div className="addisc-form-section-label">Usage limits</div>
            <div className="addisc-form-row">
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-total-uses">Total uses cap</label>
                <input id="addisc-total-uses" className="addisc-form-input" type="number" min="1"
                  placeholder="∞ unlimited"
                  value={form.usageLimit.totalUses}
                  onChange={(e) => setForm((p) => ({ ...p, usageLimit: { ...p.usageLimit, totalUses: e.target.value } }))} />
                <span className="addisc-form-hint">Max redemptions across all users.</span>
              </div>
              <div className="addisc-form-field">
                <label className="addisc-form-label" htmlFor="addisc-per-user">Uses per user</label>
                <input id="addisc-per-user" className="addisc-form-input" type="number" min="1"
                  value={form.usageLimit.usesPerUser}
                  onChange={(e) => setForm((p) => ({ ...p, usageLimit: { ...p.usageLimit, usesPerUser: e.target.value } }))} />
                <span className="addisc-form-hint">How many times one user can redeem.</span>
              </div>
            </div>
          </div>

          {/* ── SECTION: Product restrictions ── */}
          <div className="addisc-form-section">
            <div className="addisc-form-section-label">
              Product category restriction
              <span className="addisc-form-section-optional">optional</span>
            </div>
            <p className="addisc-form-section-desc">
              Select categories to limit which products this discount applies to. Leave all unchecked to apply to the entire cart.
            </p>
            <ProductCategoryChips
              selected={form.eligibleProductCategories}
              onChange={(cats) => set('eligibleProductCategories', cats)}
              mode="select"
              disabled={mode === 'edit'}
            />
            {mode === 'edit' && isEditRestricted && (
              <span className="addisc-form-hint addisc-form-hint--warn" style={{ display: 'block', marginTop: 10 }}>
                Category restriction is read-only after creation. Deactivate and recreate to change it.
              </span>
            )}
            {mode === 'create' && form.eligibleProductCategories.length > 0 && (
              <span className="addisc-form-hint addisc-form-hint--info" style={{ display: 'block', marginTop: 10 }}>
                Discount only applies to carts containing items from{' '}
                <strong>{form.eligibleProductCategories.join(', ')}</strong>.
                {form.type === 'percentage' && ' Percentage is calculated on eligible item subtotals only.'}
              </span>
            )}
          </div>

          {/* ── SECTION: Internal notes ── */}
          <div className="addisc-form-section addisc-form-section--last">
            <div className="addisc-form-section-label">
              Internal notes
              <span className="addisc-form-section-optional">optional</span>
            </div>
            <div className="addisc-form-field" style={{ marginBottom: 0 }}>
              <input id="addisc-notes" className="addisc-form-input" type="text"
                placeholder="e.g. Created for Q3 email campaign"
                value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              <span className="addisc-form-hint">Not visible to customers. Admin reference only.</span>
            </div>
          </div>

        </form>

        {/* ── Sticky footer ── */}
        <div className="addisc-modal-footer">
          <button type="button" className="addisc-btn addisc-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="addisc-discount-form"
            className="addisc-btn addisc-btn--primary"
            disabled={loading}
            onClick={handleSubmit}
          >
            {loading ? <Spinner size={15} /> : mode === 'create' ? 'Create discount' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
};


// ─────────────────────────────────────────────
// COMPENSATION MODAL
// ─────────────────────────────────────────────

const CompensationModal = ({ loading, error, compensationConflict, onViewExisting, onSubmit, onClose }) => {
  const [form, setForm] = useState({
    userId: '', amount: '', reason: '', category: 'refund',
    validDays: 30, relatedOrder: '', relatedReturn: '',
  });
  const set = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  return (
    <div className="addisc-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="addisc-modal">
        <div className="addisc-modal-header">
          <h2 className="addisc-modal-title">Create Compensation Discount</h2>
          <button type="button" className="addisc-modal-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form className="addisc-modal-form" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
          {compensationConflict ? (
            <div className="addisc-modal-conflict" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <p>{compensationConflict.message}</p>
                {compensationConflict.existingCode && (
                  <p className="addisc-conflict-code">
                    Existing code: <strong>{compensationConflict.existingCode}</strong>
                  </p>
                )}
                {compensationConflict.existingDiscountId && (
                  <button type="button" className="addisc-conflict-view-btn"
                    onClick={() => onViewExisting(compensationConflict.existingDiscountId)}>
                    View existing discount →
                  </button>
                )}
              </div>
            </div>
          ) : error ? (
            <div className="addisc-modal-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          ) : null}

          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="comp-userId">User ID</label>
            <input id="comp-userId" className="addisc-form-input" type="text"
              placeholder="MongoDB ObjectId of the user"
              value={form.userId} onChange={(e) => set('userId', e.target.value.trim())} required />
          </div>
          <div className="addisc-form-row">
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="comp-category">Category</label>
              <select id="comp-category" className="addisc-form-select" value={form.category}
                onChange={(e) => set('category', e.target.value)}>
                {['refund', 'return', 'loyalty', 'support'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="comp-validDays">Valid for (days)</label>
              <input id="comp-validDays" className="addisc-form-input" type="number" min="1" max="365"
                value={form.validDays} onChange={(e) => set('validDays', e.target.value)} />
            </div>
          </div>
          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="comp-amount">
              Amount ($)
              <span style={{ display: 'inline', textTransform: 'none', marginLeft: 4, fontSize: '10px', color: '#9CA3AF', fontWeight: 400 }}>
                — ignored if relatedReturn is set
              </span>
            </label>
            <input id="comp-amount" className="addisc-form-input" type="number" min="0.01" step="0.01"
              placeholder="e.g. 15.00"
              value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="comp-reason">Reason (internal note)</label>
            <textarea id="comp-reason" className="addisc-form-textarea" rows={2}
              placeholder="Why is this compensation being issued?"
              value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </div>
          <div className="addisc-form-row">
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="comp-relatedOrder">Related Order ID</label>
              <input id="comp-relatedOrder" className="addisc-form-input" type="text" placeholder="Optional"
                value={form.relatedOrder} onChange={(e) => set('relatedOrder', e.target.value.trim())} />
            </div>
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="comp-relatedReturn">Related Return ID</label>
              <input id="comp-relatedReturn" className="addisc-form-input" type="text"
                placeholder="Optional — overrides amount"
                value={form.relatedReturn} onChange={(e) => set('relatedReturn', e.target.value.trim())} />
            </div>
          </div>
          <div className="addisc-modal-footer">
            <button type="button" className="addisc-btn addisc-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="addisc-btn addisc-btn--primary" disabled={loading}>
              {loading ? <Spinner size={15} /> : 'Create compensation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// VIP DISCOUNT MODAL
// ─────────────────────────────────────────────

const VipModal = ({ loading, error, vipSuccess, lastCreatedVipDiscount, lastVipEligibleCount, onSubmit, onClose }) => {
  const [form, setForm] = useState({
    userIdsRaw:                '',
    emailsRaw:                 '',
    description:               '',
    type:                      'percentage',
    value:                     '',
    category:                  'loyalty',
    validDays:                 30,
    validUntil:                '',
    usesPerUser:               1,
    totalUses:                 '',
    minPurchaseAmount:         0,
    firstOrderOnly:            false,
    code:                      '',
    notes:                     '',
    eligibleProductCategories: [],
  });

  const set = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const userIds = form.userIdsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
    const emails  = form.emailsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
    const payload = {
      description:       form.description,
      type:              form.type,
      value:             form.value,
      category:          form.category,
      usesPerUser:       form.usesPerUser,
      minPurchaseAmount: form.minPurchaseAmount,
      firstOrderOnly:    form.firstOrderOnly,
      notes:             form.notes || undefined,
      code:              form.code  || undefined,
    };
    if (userIds.length) payload.userIds = userIds;
    if (emails.length)  payload.emails  = emails;
    if (form.validUntil) {
      payload.validUntil = form.validUntil;
    } else {
      payload.validDays = form.validDays;
    }
    if (form.totalUses) payload.totalUses = form.totalUses;
    if (form.eligibleProductCategories.length > 0) {
      payload.eligibleProductCategories = form.eligibleProductCategories;
    }
    onSubmit(payload);
  };

  if (vipSuccess && lastCreatedVipDiscount) {
    return (
      <div className="addisc-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="addisc-modal">
          <div className="addisc-modal-header">
            <h2 className="addisc-modal-title">VIP Discount Created</h2>
            <button type="button" className="addisc-modal-close" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="addisc-modal-form">
            <div className="addisc-vip-success">
              <div className="addisc-vip-success-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="addisc-vip-success-code">{lastCreatedVipDiscount.code}</p>
              <p className="addisc-vip-success-desc">
                Issued to <strong>{lastVipEligibleCount}</strong> user{lastVipEligibleCount !== 1 ? 's' : ''}.
                Valid until {fmtDate(lastCreatedVipDiscount.validUntil)}.
              </p>
              {lastCreatedVipDiscount.conditions?.eligibleProductCategories?.length > 0 && (
                <p className="addisc-vip-success-cats">
                  Restricted to: {lastCreatedVipDiscount.conditions.eligibleProductCategories.join(', ')}
                </p>
              )}
            </div>
          </div>
          <div className="addisc-modal-footer">
            <button type="button" className="addisc-btn addisc-btn--primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="addisc-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="addisc-modal">
        <div className="addisc-modal-header">
          <h2 className="addisc-modal-title">Create VIP / Targeted Discount</h2>
          <button type="button" className="addisc-modal-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form className="addisc-modal-form" onSubmit={handleSubmit}>
          {error && (
            <div className="addisc-modal-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="vip-userIds">
              User IDs
              <span className="addisc-form-label-hint"> — one per line</span>
            </label>
            <textarea id="vip-userIds" className="addisc-form-textarea" rows={3}
              placeholder={'6659e3a...abc\n6659e3b...def'}
              value={form.userIdsRaw} onChange={(e) => set('userIdsRaw', e.target.value)} />
          </div>

          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="vip-emails">
              Emails
              <span className="addisc-form-label-hint"> — one per line (resolved to user IDs server-side)</span>
            </label>
            <textarea id="vip-emails" className="addisc-form-textarea" rows={3}
              placeholder={'user@example.com\nanother@example.com'}
              value={form.emailsRaw} onChange={(e) => set('emailsRaw', e.target.value)} />
          </div>

          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="vip-desc">Description</label>
            <textarea id="vip-desc" className="addisc-form-textarea" rows={2}
              placeholder="What is this VIP discount for?"
              value={form.description} onChange={(e) => set('description', e.target.value)} required />
          </div>

          <div className="addisc-form-row">
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-type">Type</label>
              <select id="vip-type" className="addisc-form-select" value={form.type}
                onChange={(e) => set('type', e.target.value)}>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-value">Value</label>
              <input id="vip-value" className="addisc-form-input" type="number" min="0.01" step="0.01"
                placeholder={form.type === 'percentage' ? '20' : '10.00'}
                value={form.value} onChange={(e) => set('value', e.target.value)} required />
            </div>
          </div>

          <div className="addisc-form-row">
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-category">Category</label>
              <select id="vip-category" className="addisc-form-select" value={form.category}
                onChange={(e) => set('category', e.target.value)}>
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-usesPerUser">Uses per user</label>
              <input id="vip-usesPerUser" className="addisc-form-input" type="number" min="1"
                value={form.usesPerUser} onChange={(e) => set('usesPerUser', e.target.value)} />
            </div>
          </div>

          <div className="addisc-form-row">
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-validDays">
                Valid for (days)
                <span className="addisc-form-label-hint"> — ignored if validUntil set</span>
              </label>
              <input id="vip-validDays" className="addisc-form-input" type="number" min="1" max="365"
                value={form.validDays} onChange={(e) => set('validDays', e.target.value)} />
            </div>
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-validUntil">Valid until (optional)</label>
              <input id="vip-validUntil" className="addisc-form-input" type="date"
                value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
            </div>
          </div>

          <div className="addisc-form-row">
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-totalUses">Total uses cap</label>
              <input id="vip-totalUses" className="addisc-form-input" type="number" min="1"
                placeholder="∞ unlimited"
                value={form.totalUses} onChange={(e) => set('totalUses', e.target.value)} />
            </div>
            <div className="addisc-form-field">
              <label className="addisc-form-label" htmlFor="vip-minPurchase">Min purchase ($)</label>
              <input id="vip-minPurchase" className="addisc-form-input" type="number" min="0" step="0.01"
                value={form.minPurchaseAmount} onChange={(e) => set('minPurchaseAmount', e.target.value)} />
            </div>
          </div>

          <div className="addisc-form-field">
            <label className="addisc-form-label" htmlFor="vip-code">
              Custom code
              <span className="addisc-form-label-hint"> — auto-generated if blank</span>
            </label>
            <input id="vip-code" className="addisc-form-input" type="text"
              placeholder="e.g. LOYALTY-VIP-GOLD"
              value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          </div>

          <div className="addisc-form-field">
            <label className="addisc-form-label addisc-form-label--checkbox">
              <input type="checkbox" checked={form.firstOrderOnly}
                onChange={(e) => set('firstOrderOnly', e.target.checked)} />
              First order only
            </label>
          </div>

          <div className="addisc-form-field">
            <label className="addisc-form-label">
              Product category restriction
              <span className="addisc-form-label-hint"> — leave unchecked for no restriction</span>
            </label>
            <ProductCategoryChips
              selected={form.eligibleProductCategories}
              onChange={(cats) => set('eligibleProductCategories', cats)}
              mode="select"
            />
            {form.eligibleProductCategories.length > 0 && (
              <p className="addisc-form-hint addisc-form-hint--info">
                Discount only applies to carts containing items from the selected {form.eligibleProductCategories.length === 1 ? 'category' : 'categories'}.
                {form.type === 'percentage' && ' The percentage is calculated on eligible item subtotals only.'}
              </p>
            )}
          </div>

          <div className="addisc-modal-footer">
            <button type="button" className="addisc-btn addisc-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="addisc-btn addisc-btn--primary" disabled={loading}>
              {loading ? <Spinner size={15} /> : 'Create VIP discount'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// PURGE BANNER
// ─────────────────────────────────────────────

const PurgeBanner = ({ purge, onDismiss }) => {
  if (!purge) return null;
  return (
    <div className="addisc-purge-banner" role="status">
      <div className="addisc-purge-banner-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="addisc-purge-banner-body">
        <span className="addisc-purge-banner-title">Audit purge completed</span>
        <span className="addisc-purge-banner-desc">
          {purge.actualDeletedCount ?? purge.recordCount} records deleted on {fmtDate(purge.purgedAt)},
          covering {fmtDate(purge.dateRangeFrom)} – {fmtDate(purge.dateRangeTo)}.
          {purge.notes && ` Note: ${purge.notes}`}
        </span>
      </div>
      <button type="button" className="addisc-purge-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────

const AdminDiscounts = () => {
  const dispatch = useDispatch();

  const {
    discounts,
    pagination,
    currentDiscount,
    stats,
    auditLogs,
    auditPagination,
    discountAuditLogs,
    discountAuditLoading,
    purgeLog,
    latestPurge,
    showBanner,
    discountsLoading,
    detailLoading,
    actionLoading,
    auditLoading,
    error,
    deleteProtectionError,
    compensationConflict,
    cleanupResult,
    usageHistoryTotal,
    usageHistoryCapped,
    vipLoading,
    vipError,
    vipSuccess,
    lastCreatedVipDiscount,
    lastVipEligibleCount,
  } = useSelector((state) => state.adminDiscount);

  const [activeTab,        setActiveTab]        = useState('codes');
  const [drawerDiscount,   setDrawerDiscount]   = useState(null);
  const [modalMode,        setModalMode]        = useState(null);
  const [editTarget,       setEditTarget]       = useState(null);
  const [toast,            setToast]            = useState(null);
  const [showCompModal,    setShowCompModal]    = useState(false);
  const [showVipModal,     setShowVipModal]     = useState(false);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupRunning,   setCleanupRunning]   = useState(false);

  const [codesFilters, setCodesFilters] = useState({
    status: '', category: '', type: '', search: '', productCategory: '',
  });
  const [auditFilters, setAuditFilters] = useState({
    action: '', discountCode: '', dateFrom: '', dateTo: '',
  });

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    dispatch(getAllDiscounts({}));
    dispatch(getDiscountStats());
  }, [dispatch]);

  const purgeFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'audit') {
      const params = {};
      Object.entries(auditFilters).forEach(([k, v]) => { if (v) params[k] = v; });
      dispatch(getAuditLog(params));
      if (!purgeFetchedRef.current) {
        purgeFetchedRef.current = true;
        dispatch(getPurgeLog());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dispatch]);

  const openDrawer = useCallback((discount) => {
    setDrawerDiscount(discount);
    dispatch(clearDiscountAuditLogs());
    dispatch(clearCurrentDiscount());
    dispatch(clearDeleteProtectionError());
    dispatch(getSingleDiscount(discount._id));
    dispatch(getDiscountAuditLog(discount._id));
  }, [dispatch]);

  const closeDrawer = useCallback(() => {
    setDrawerDiscount(null);
    dispatch(clearDiscountAuditLogs());
    dispatch(clearCurrentDiscount());
    dispatch(clearDeleteProtectionError());
  }, [dispatch]);

  const handleEdit = useCallback((discount) => {
    setEditTarget(discount);
    setModalMode('edit');
    closeDrawer();
  }, [closeDrawer]);

  const handleDelete = useCallback((discount) => {
    dispatch(deleteDiscount(discount._id))
      .unwrap()
      .then(() => {
        closeDrawer();
        dispatch(clearAdminDiscountState());
        showToast('Discount deactivated.');
      })
      .catch((err) => {
        if (err?.status !== 403) {
          showToast(typeof err === 'string' ? err : err?.message ?? 'Failed.', 'error');
          dispatch(clearAdminDiscountState());
        }
      });
  }, [dispatch, closeDrawer, showToast]);

  const handleModalSubmit = useCallback((formData) => {
    if (modalMode === 'create') {
      dispatch(createDiscount(formData)).unwrap()
        .then(() => {
          setModalMode(null);
          dispatch(clearAdminDiscountState());
          dispatch(getAllDiscounts({}));
          showToast('Discount created.');
        })
        .catch((err) => {
          showToast(typeof err === 'string' ? err : err?.message ?? 'Failed to create discount.', 'error');
        });
    } else {
      dispatch(updateDiscount({ id: editTarget._id, discountData: formData })).unwrap()
        .then(() => {
          setModalMode(null);
          setEditTarget(null);
          dispatch(clearAdminDiscountState());
          showToast('Discount updated.');
        })
        .catch((err) => {
          showToast(typeof err === 'string' ? err : err?.message ?? 'Failed to update discount.', 'error');
        });
    }
  }, [dispatch, modalMode, editTarget, showToast]);

  const handleCompensationSubmit = useCallback((formData) => {
    dispatch(createCompensationDiscount(formData)).unwrap()
      .then(() => {
        setShowCompModal(false);
        dispatch(clearAdminDiscountState());
        dispatch(clearCompensationConflict());
        showToast('Compensation discount created.');
      })
      .catch(() => {});
  }, [dispatch, showToast]);

  const handleViewExistingFromConflict = useCallback((discountId) => {
    setShowCompModal(false);
    dispatch(clearCompensationConflict());
    dispatch(clearAdminDiscountState());
    const existing = discounts.find((d) => d._id === discountId);
    if (existing) {
      openDrawer(existing);
    } else {
      dispatch(getSingleDiscount(discountId)).unwrap()
        .then((data) => {
          if (data.discount) setDrawerDiscount(data.discount);
        })
        .catch(() => {});
    }
  }, [dispatch, discounts, openDrawer]);

  const handleVipSubmit = useCallback((payload) => {
    dispatch(createDiscountForUsers(payload));
  }, [dispatch]);

  const handleCleanupConfirm = useCallback(() => {
    setCleanupRunning(true);
    dispatch(triggerCleanup({})).unwrap()
      .then(() => {})
      .catch((err) => {
        dispatch(clearAdminDiscountState());
        showToast(typeof err === 'string' ? err : err?.message ?? 'Cleanup failed.', 'error');
        setShowCleanupModal(false);
      })
      .finally(() => setCleanupRunning(false));
  }, [dispatch, showToast]);

  const handleCleanupModalClose = useCallback(() => {
    if (cleanupRunning) return;
    setShowCleanupModal(false);
    dispatch(clearCleanupResult());
  }, [cleanupRunning, dispatch]);

  const applyCodesFilters = useCallback(() => {
    const params = {};
    Object.entries(codesFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    dispatch(resetDiscountList());
    dispatch(getAllDiscounts(params));
  }, [dispatch, codesFilters]);

  const loadMoreCodes = useCallback(() => {
    if (!pagination?.nextCursor) return;
    const params = { cursor: pagination.nextCursor };
    Object.entries(codesFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    dispatch(getAllDiscounts(params)).unwrap()
      .then((data) => dispatch(appendDiscounts(data)))
      .catch(() => {});
  }, [dispatch, pagination, codesFilters]);

  const applyAuditFilters = useCallback(() => {
    const params = {};
    Object.entries(auditFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    dispatch(getAuditLog(params));
  }, [dispatch, auditFilters]);

  const loadMoreAudit = useCallback(() => {
    if (!auditPagination?.nextCursor) return;
    const params = { cursor: auditPagination.nextCursor };
    Object.entries(auditFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    dispatch(getAuditLog(params)).unwrap()
      .then((data) => dispatch(appendAuditLogs(data)))
      .catch(() => {});
  }, [dispatch, auditPagination, auditFilters]);

  const broadcastCount = useMemo(
    () => discounts.filter((d) => d.audience === 'all' && d.status === 'active').length,
    [discounts],
  );

  return (
    <>
      <Navbar />

      <div className="addisc-page">

        {toast && (
          <div className={`addisc-toast addisc-toast--${toast.type}`} role="alert">
            {toast.type === 'success' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {toast.msg}
          </div>
        )}

        <div className="addisc-body">

          <Link to="/admin/dashboard" className="addisc-back-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Dashboard
          </Link>

          <div className="addisc-page-header">
            <div className="addisc-page-header-left">
              <h1 className="addisc-page-title">Discount Codes</h1>
              <p className="addisc-page-sub">
                Create, manage, and audit all discount codes. All changes are permanently logged.
              </p>
            </div>
            <div className="addisc-page-header-actions">
              <button type="button" className="addisc-btn addisc-btn--outline"
                onClick={() => setShowCleanupModal(true)}
                disabled={cleanupRunning}>
                {cleanupRunning ? <Spinner size={14} /> : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 .49-3.27" />
                  </svg>
                )}
                Run cleanup
              </button>
              <button type="button" className="addisc-btn addisc-btn--outline"
                onClick={() => setShowCompModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 12V22H4V12" />
                  <path d="M22 7H2v5h20V7z" />
                  <path d="M12 22V7" />
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                </svg>
                Compensation
              </button>
              <button type="button" className="addisc-btn addisc-btn--outline"
                onClick={() => setShowVipModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                VIP discount
              </button>
              <button type="button" className="addisc-btn addisc-btn--primary"
                onClick={() => setModalMode('create')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New discount
              </button>
            </div>
          </div>

          <div className="addisc-section-divider">
            <span className="addisc-section-divider-text">Overview</span>
            <span className="addisc-section-divider-line" />
          </div>

          <div className="addisc-kpi-grid">
            {[
              { label: 'Total codes',      value: stats?.total     ?? 0, color: '#6366F1' },
              { label: 'Active',           value: stats?.active    ?? 0, color: '#ff3c3c' },
              { label: 'Expired',          value: stats?.expired   ?? 0, color: '#F59E0B' },
              { label: 'Inactive',         value: stats?.inactive  ?? 0, color: '#9CA3AF' },
              { label: 'Total uses',       value: stats?.totalUses ?? 0, color: '#10B981' },
              { label: 'Broadcast active', value: broadcastCount,         color: '#0369A1' },
            ].map((kpi) => (
              <div key={kpi.label} className="addisc-kpi" style={{ '--addisc-kpi-color': kpi.color }}>
                <span className="addisc-kpi-label">{kpi.label}</span>
                <span className="addisc-kpi-value">{kpi.value}</span>
              </div>
            ))}
          </div>

          <div className="addisc-section-divider">
            <span className="addisc-section-divider-text">Management</span>
            <span className="addisc-section-divider-line" />
          </div>

          {/* ── Tabs: Analytics removed — KPI cards cover it ── */}
          <div className="addisc-tabs">
            {[
              { key: 'codes', label: 'All Codes',  count: discounts.length },
              { key: 'audit', label: 'Audit Log' },
            ].map((tab) => (
              <button key={tab.key} type="button"
                className={`addisc-tab ${activeTab === tab.key ? 'addisc-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.key)}>
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="addisc-tab-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'codes' && (
            <div className="addisc-tab-panel">
              <div className="addisc-filter-bar">
                <input type="text" className="addisc-filter-input"
                  placeholder="Search code or description…"
                  value={codesFilters.search}
                  onChange={(e) => setCodesFilters((p) => ({ ...p, search: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && applyCodesFilters()} />
                <select className="addisc-filter-select" value={codesFilters.status}
                  onChange={(e) => setCodesFilters((p) => ({ ...p, status: e.target.value }))}>
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="addisc-filter-select" value={codesFilters.category}
                  onChange={(e) => setCodesFilters((p) => ({ ...p, category: e.target.value }))}>
                  <option value="">All categories</option>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="addisc-filter-select" value={codesFilters.type}
                  onChange={(e) => setCodesFilters((p) => ({ ...p, type: e.target.value }))}>
                  <option value="">All types</option>
                  {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="addisc-filter-select" value={codesFilters.productCategory}
                  onChange={(e) => setCodesFilters((p) => ({ ...p, productCategory: e.target.value }))}>
                  <option value="">All product cats</option>
                  {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" className="addisc-btn addisc-btn--outline"
                  onClick={applyCodesFilters} disabled={discountsLoading}>
                  {discountsLoading ? <Spinner size={14} /> : 'Filter'}
                </button>
              </div>

              {discountsLoading && discounts.length === 0 ? (
                <div className="addisc-loading-row"><Spinner /> Loading discounts…</div>
              ) : discounts.length === 0 ? (
                <EmptyState
                  icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>}
                  title="No discount codes found"
                  desc="Create a new discount code to get started."
                />
              ) : (
                <>
                  <div className="addisc-table-wrap">
                    <div className="addisc-tbl-scroll">
                      <table className="addisc-table">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Type / Value</th>
                            <th>Category</th>
                            <th>Audience</th>
                            <th>Product cats</th>
                            <th>Uses</th>
                            <th>Valid until</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {discounts.map((d) => {
                            const locked = (d.usageLimit?.currentUses ?? 0) >= 1 &&
                              d.deletionEligibleAt &&
                              new Date(d.deletionEligibleAt) > new Date();
                            const prodCats = d.conditions?.eligibleProductCategories ?? [];
                            return (
                              <tr key={d._id}
                                className={`addisc-table-row ${locked ? 'addisc-table-row--locked' : ''}`}
                                onClick={() => openDrawer(d)} style={{ cursor: 'pointer' }}>
                                <td>
                                  <div className="addisc-code-cell">
                                    <span className="addisc-code-mono">{d.code}</span>
                                    {locked && <LockIcon title={`Protected until ${fmtDate(d.deletionEligibleAt)}`} />}
                                  </div>
                                </td>
                                <td>
                                  <div className="addisc-type-val">
                                    <span>{d.type === 'percentage' ? `${d.value}%` : fmtCurrency(d.value)}</span>
                                    <span className="addisc-type-label">{d.type}</span>
                                  </div>
                                </td>
                                <td>{d.category}</td>
                                <td><AudienceBadge audience={d.audience} /></td>
                                <td>
                                  {prodCats.length > 0 ? (
                                    <span className="addisc-prodcat-table-cell" title={prodCats.join(', ')}>
                                      {prodCats.length === 1
                                        ? prodCats[0]
                                        : `${prodCats[0]} +${prodCats.length - 1}`}
                                    </span>
                                  ) : (
                                    <span className="addisc-prodcat-table-all">All</span>
                                  )}
                                </td>
                                <td>
                                  {d.usageLimit?.currentUses ?? 0}
                                  {d.usageLimit?.totalUses ? ` / ${d.usageLimit.totalUses}` : ''}
                                </td>
                                <td>{fmtDate(d.validUntil)}</td>
                                <td><StatusBadge status={d.status} /></td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  <div className="addisc-row-actions">
                                    <button type="button" className="addisc-row-btn"
                                      onClick={() => handleEdit(d)} title="Edit">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                      </svg>
                                    </button>
                                    <button type="button"
                                      className={`addisc-row-btn addisc-row-btn--danger ${locked ? 'addisc-row-btn--disabled' : ''}`}
                                      onClick={() => !locked && handleDelete(d)}
                                      disabled={locked}
                                      title={locked ? `Protected until ${fmtDate(d.deletionEligibleAt)}` : 'Deactivate'}>
                                      {locked ? <LockIcon /> : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                          <polyline points="3 6 5 6 21 6" />
                                          <path d="M19 6l-1 14H6L5 6" />
                                          <path d="M10 11v6M14 11v6" />
                                          <path d="M9 6V4h6v2" />
                                        </svg>
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {pagination?.hasNextPage && (
                    <div className="addisc-load-more">
                      <button type="button" className="addisc-btn addisc-btn--outline"
                        onClick={loadMoreCodes} disabled={discountsLoading}>
                        {discountsLoading ? <Spinner size={14} /> : 'Load more'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="addisc-tab-panel">
              {showBanner && (
                <PurgeBanner
                  purge={latestPurge}
                  onDismiss={() => dispatch(dismissPurgeBanner())}
                />
              )}

              <div className="addisc-filter-bar">
                <input type="text" className="addisc-filter-input"
                  placeholder="Filter by discount code…"
                  value={auditFilters.discountCode}
                  onChange={(e) => setAuditFilters((p) => ({ ...p, discountCode: e.target.value.toUpperCase() }))} />
                <select className="addisc-filter-select" value={auditFilters.action}
                  onChange={(e) => setAuditFilters((p) => ({ ...p, action: e.target.value }))}>
                  <option value="">All actions</option>
                  {Object.keys(ACTION_META).map((a) => (
                    <option key={a} value={a}>{ACTION_META[a].label}</option>
                  ))}
                </select>
                <input type="date" className="addisc-filter-input addisc-filter-input--date"
                  value={auditFilters.dateFrom}
                  onChange={(e) => setAuditFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
                <input type="date" className="addisc-filter-input addisc-filter-input--date"
                  value={auditFilters.dateTo}
                  onChange={(e) => setAuditFilters((p) => ({ ...p, dateTo: e.target.value }))} />
                <button type="button" className="addisc-btn addisc-btn--outline"
                  onClick={applyAuditFilters} disabled={auditLoading}>
                  {auditLoading ? <Spinner size={14} /> : 'Filter'}
                </button>
              </div>

              {auditLoading && auditLogs.length === 0 ? (
                <div className="addisc-loading-row"><Spinner /> Loading audit log…</div>
              ) : auditLogs.length === 0 ? (
                <EmptyState
                  icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
                  title="No audit entries"
                  desc="Audit entries will appear here as discounts are created, used, and modified."
                />
              ) : (
                <>
                  <div className="addisc-audit-table-wrap">
                    <div className="addisc-audit-full-timeline">
                      {auditLogs.map((entry) => (
                        <AuditEntry key={entry._id} entry={entry} compact={false} />
                      ))}
                    </div>
                  </div>
                  {auditPagination?.hasNextPage && (
                    <div className="addisc-load-more">
                      <button type="button" className="addisc-btn addisc-btn--outline"
                        onClick={loadMoreAudit} disabled={auditLoading}>
                        {auditLoading ? <Spinner size={14} /> : 'Load more'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {purgeLog?.length > 0 && (
                <div className="addisc-purge-receipts">
                  <h3 className="addisc-purge-receipts-title">
                    Deletion receipts
                    <span className="addisc-purge-receipts-hint">Permanent — these records are never deleted</span>
                  </h3>
                  <div className="addisc-table-wrap">
                    <div className="addisc-tbl-scroll">
                      <table className="addisc-table">
                        <thead>
                          <tr>
                            <th>Purged at</th>
                            <th>Records</th>
                            <th>Date range covered</th>
                            <th>Codes affected</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purgeLog.map((receipt) => (
                            <tr key={receipt._id} className="addisc-table-row">
                              <td>{fmtDateTime(receipt.purgedAt)}</td>
                              <td>
                                {receipt.actualDeletedCount ?? receipt.recordCount}
                                {receipt.actualDeletedCount != null &&
                                 receipt.actualDeletedCount !== receipt.recordCount && (
                                  <span className="addisc-purge-anomaly" title="Count mismatch — check notes">⚠</span>
                                )}
                              </td>
                              <td>{fmtDate(receipt.dateRangeFrom)} – {fmtDate(receipt.dateRangeTo)}</td>
                              <td>{receipt.discountCodesAffected?.length ?? 0} codes</td>
                              <td className="addisc-purge-notes">{receipt.notes ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {drawerDiscount && (
        <DetailDrawer
          discount={drawerDiscount}
          currentDiscount={currentDiscount}
          detailLoading={detailLoading}
          auditLogs={discountAuditLogs}
          auditLoading={discountAuditLoading}
          deleteProtectionError={deleteProtectionError}
          usageHistoryTotal={usageHistoryTotal}
          usageHistoryCapped={usageHistoryCapped}
          onClose={closeDrawer}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {showCleanupModal && (
        <CleanupModal
          running={cleanupRunning}
          result={cleanupResult}
          onConfirm={handleCleanupConfirm}
          onClose={handleCleanupModalClose}
        />
      )}

      {showCompModal && (
        <CompensationModal
          loading={actionLoading}
          error={error}
          compensationConflict={compensationConflict}
          onViewExisting={handleViewExistingFromConflict}
          onSubmit={handleCompensationSubmit}
          onClose={() => {
            setShowCompModal(false);
            dispatch(clearAdminDiscountState());
            dispatch(clearCompensationConflict());
          }}
        />
      )}

      {showVipModal && (
        <VipModal
          loading={vipLoading}
          error={vipError}
          vipSuccess={vipSuccess}
          lastCreatedVipDiscount={lastCreatedVipDiscount}
          lastVipEligibleCount={lastVipEligibleCount}
          onSubmit={handleVipSubmit}
          onClose={() => {
            setShowVipModal(false);
            dispatch(clearVipState());
          }}
        />
      )}

      {modalMode && (
        <DiscountModal
          mode={modalMode}
          initial={modalMode === 'edit' ? editTarget : {}}
          loading={actionLoading}
          error={error}
          onSubmit={handleModalSubmit}
          onClose={() => {
            setModalMode(null);
            setEditTarget(null);
            dispatch(clearAdminDiscountState());
          }}
        />
      )}

      <Footer />
    </>
  );
};

export default AdminDiscounts;