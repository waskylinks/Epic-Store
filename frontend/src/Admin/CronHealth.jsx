import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import {
  Schedule,
  CheckCircle,
  ErrorOutline,
  Warning,
  Refresh,
  ArrowBack,
  PlayArrow,
  Dashboard as DashboardIcon,
  ShoppingCart,
  People,
  Inventory,
  Assessment,
  StarOutline,
  MarkEmailRead,
  AttachMoney,
  LocalOffer,
  ManageAccounts,
  KeyboardArrowRight,
  ReplayCircleFilled,
  CurrencyExchange,
  LocalShipping,
  Security,
  FactCheck,
  BarChart,
  Storefront,
  PersonSearch,
  DevicesOther,
  CampaignOutlined,
  ShoppingCartCheckout,
  ErrorOutline as ErrorIcon,
  PersonAdd,
  Insights,
} from '@mui/icons-material';
import {
  fetchCronHealth,
  triggerCronJob,
  clearCronError,
  clearTriggerResult,
} from '../features/admin/cronHealthSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CronHealth.css';

// ─── NAV GROUPS (mirrors AdminDashboard.jsx) ──────────────────────────────────

const NAV_GROUPS = [
  {
    group: 'Overview',
    items: [
      { path: '/admin/dashboard', icon: DashboardIcon, label: 'Dashboard', color: '#6366F1' },
    ],
  },
  {
    group: 'Analytics',
    items: [
      { path: '/admin/analytics',          icon: BarChart,             label: 'Overview',           color: '#8B5CF6' },
      { path: '/admin/reports',            icon: Assessment,           label: 'Reports',             color: '#EC4899' },
      { path: '/admin/customers',          icon: PersonSearch,         label: 'Customers',           color: '#06B6D4' },
      { path: '/admin/attribution',        icon: CampaignOutlined,     label: 'Attribution',         color: '#F59E0B' },
      { path: '/admin/checkout',           icon: ShoppingCartCheckout, label: 'Checkout',            color: '#10B981' },
      { path: '/admin/refund-analytics',   icon: CurrencyExchange,     label: 'Refund Analytics',    color: '#14B8A6' },
      { path: '/admin/return-analytics',   icon: ReplayCircleFilled,   label: 'Return Analytics',    color: '#EF4444' },
      { path: '/admin/discount-analytics', icon: Insights,             label: 'Discount ROI',        color: '#e563f1' },
      { path: '/admin/recovery-email-analytics', icon: MarkEmailRead,  label: 'Recovery Email Analytics', color: '#fb7185' },
    ],
  },
  {
    group: 'Commerce',
    items: [
      { path: '/admin/products',  icon: Inventory,    label: 'Products',  color: '#3B82F6' },
      { path: '/admin/orders',    icon: ShoppingCart, label: 'Orders',    color: '#F97316' },
      { path: '/admin/discounts', icon: LocalOffer,   label: 'Discounts', color: '#e563f1' },
    ],
  },
  {
    group: 'Management',
    items: [
      { path: '/admin/users', icon: ManageAccounts, label: 'Users', color: '#A855F7' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { path: '/admin/refunds',         icon: CurrencyExchange,   label: 'Refunds',         color: '#14B8A6' },
      { path: '/admin/returns',         icon: ReplayCircleFilled, label: 'Returns',         color: '#EF4444' },
      { path: '/admin/reviews',         icon: StarOutline,        label: 'Reviews',         color: '#F59E0B' },
      { path: '/admin/recovery-emails', icon: MarkEmailRead,      label: 'Recovery Emails', color: '#FF6B6B' },
      { path: '/admin/cron-health',     icon: Schedule,           label: 'Cron Health',     color: '#6366F1' },
    ],
  },
];

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 60_000;

const TRIGGERABLE_JOBS = new Set(['DiscountCleanup', 'AuditCleanup']);

const JOB_META = {
  AbandonmentSweep: {
    label:       'Abandonment Sweep',
    description: 'Marks stale checkouts as abandoned. Runs frequently to keep recovery pipeline fresh.',
    icon:        ShoppingCartCheckout,
    color:       '#10B981',
  },
  DiscountCleanup: {
    label:       'Discount Cleanup',
    description: 'Expires stale discount codes and hard-deletes old expired codes outside the fraud-protection window.',
    icon:        LocalOffer,
    color:       '#e563f1',
  },
  AuditCleanup: {
    label:       'Audit Log Cleanup',
    description: 'Enforces 365 + 30 day retention policy on discount audit logs. Writes purge receipts before deletion.',
    icon:        FactCheck,
    color:       '#F59E0B',
  },
  RecoveryEmailCron: {
    label:       'Recovery Email Cron',
    description: 'Sends abandoned cart recovery emails in sequential batches. Respects delay rules and per-cart caps.',
    icon:        MarkEmailRead,
    color:       '#fb7185',
  },
};

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function fmtTimeAgo(d) {
  if (!d) return 'Never';
  const diff    = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours   = Math.floor(diff / 3600000);
  const days    = Math.floor(diff / 86400000);
  if (minutes < 1)  return 'Just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60)  return `${minutes} mins ago`;
  if (hours === 1)   return '1 hour ago';
  if (hours < 24)    return `${hours} hours ago`;
  if (days === 1)    return '1 day ago';
  return `${days} days ago`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── ATOMS ────────────────────────────────────────────────────────────────────

function Spinner({ size = 18 }) {
  return (
    <span
      className="crn-spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

function StatusDot({ status, size = 'md' }) {
  return (
    <span
      className={`crn-dot crn-dot--${status ?? 'unknown'} crn-dot--${size}`}
      aria-label={`Status: ${status}`}
    />
  );
}

function StatusBadge({ status }) {
  const map = {
    ok:      { label: 'Healthy',  cls: 'crn-badge--ok'      },
    failed:  { label: 'Failed',   cls: 'crn-badge--failed'  },
    unknown: { label: 'Pending',  cls: 'crn-badge--unknown' },
  };
  const m = map[status] ?? map.unknown;
  return <span className={`crn-badge ${m.cls}`}>{m.label}</span>;
}

function LastUpdated({ timestamp }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    const update = () => {
      if (!timestamp) return setLabel('Never');
      const diff    = Date.now() - timestamp;
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1)        setLabel('Just now');
      else if (minutes === 1) setLabel('1 min ago');
      else if (minutes < 60)  setLabel(`${minutes} mins ago`);
      else                    setLabel(`${Math.floor(diff / 3600000)}h ago`);
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [timestamp]);

  return (
    <div className="crn-last-updated">
      <span className="crn-last-updated-label">Updated:</span>
      <span className="crn-last-updated-time">{label}</span>
    </div>
  );
}

function MetricRow({ label, value, accent }) {
  return (
    <div className="crn-metric-row">
      <span className="crn-metric-label">{label}</span>
      <span
        className="crn-metric-value"
        style={accent ? { color: accent } : undefined}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

// ─── OVERVIEW STRIP CARD ──────────────────────────────────────────────────────

function OverviewCard({ job }) {
  const meta = JOB_META[job.jobName] ?? {
    label: job.jobName,
    icon:  Schedule,
    color: '#6B7280',
  };
  const Icon = meta.icon;

  return (
    <div className={`crn-overview-card crn-overview-card--${job.status ?? 'unknown'}`}>
      <div className="crn-overview-card-top">
        <span
          className="crn-overview-icon"
          style={{ background: `${meta.color}18`, color: meta.color }}
        >
          <Icon style={{ fontSize: 18 }} />
        </span>
        <StatusDot status={job.status} size="lg" />
      </div>
      <div className="crn-overview-card-name">{meta.label}</div>
      <div className="crn-overview-card-schedule">{job.scheduleLabel ?? '—'}</div>
      <div className="crn-overview-card-meta">
        <span className="crn-overview-last-run">
          {fmtTimeAgo(job.lastRunAt)}
        </span>
        {job.lastDurationMs != null && (
          <span className="crn-overview-duration">
            {fmtDuration(job.lastDurationMs)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── JOB DETAIL CARD ─────────────────────────────────────────────────────────

function JobDetailCard({ job, triggerLoading, triggerResult, triggerError, onTrigger, onClearResult }) {
  const meta        = JOB_META[job.jobName] ?? { label: job.jobName, icon: Schedule, color: '#6B7280', description: '' };
  const Icon        = meta.icon;
  const canTrigger  = TRIGGERABLE_JOBS.has(job.jobName);
  const isTriggering = !!triggerLoading;
  const hasResult   = !!triggerResult;
  const hasError    = !!triggerError;

  const resultEntries = triggerResult
    ? Object.entries(triggerResult).filter(
        ([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
      )
    : [];

  const lastResultEntries = job.lastResult
    ? Object.entries(job.lastResult).filter(
        ([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
      )
    : [];

  return (
    <div className={`crn-detail-card crn-detail-card--${job.status ?? 'unknown'}`}>
      {/* Header */}
      <div className="crn-detail-hd">
        <div className="crn-detail-hd-left">
          <span
            className="crn-detail-icon"
            style={{ background: `${meta.color}18`, color: meta.color }}
          >
            <Icon style={{ fontSize: 20 }} />
          </span>
          <div>
            <div className="crn-detail-title">{meta.label}</div>
            <div className="crn-detail-desc">{meta.description}</div>
          </div>
        </div>
        <div className="crn-detail-hd-right">
          <StatusBadge status={job.status} />
          {canTrigger && (
            <button
              type="button"
              className="crn-trigger-btn"
              onClick={() => onTrigger(job.jobName)}
              disabled={isTriggering}
              title={`Manually run ${meta.label}`}
            >
              {isTriggering ? (
                <><Spinner size={13} /> Running…</>
              ) : (
                <><PlayArrow style={{ fontSize: 14 }} /> Run Now</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Trigger result / error */}
      {hasResult && (
        <div className="crn-trigger-result">
          <div className="crn-trigger-result-hd">
            <CheckCircle style={{ fontSize: 15, color: '#10B981' }} />
            <span>Run complete</span>
            <button
              type="button"
              className="crn-trigger-dismiss"
              onClick={() => onClearResult(job.jobName)}
              aria-label="Dismiss result"
            >
              ✕
            </button>
          </div>
          {resultEntries.length > 0 && (
            <div className="crn-trigger-result-body">
              {resultEntries.map(([k, v]) => (
                <span key={k} className="crn-trigger-stat">
                  <span className="crn-trigger-stat-key">{capitalize(k)}</span>
                  <span className="crn-trigger-stat-val">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {hasError && (
        <div className="crn-trigger-error">
          <ErrorOutline style={{ fontSize: 14 }} />
          <span>{triggerError}</span>
          <button
            type="button"
            className="crn-trigger-dismiss"
            onClick={() => onClearResult(job.jobName)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Metrics grid */}
      <div className="crn-detail-body">
        <div className="crn-detail-section">
          <div className="crn-detail-section-title">Run Timing</div>
          <div className="crn-metrics-grid">
            <MetricRow label="Last Run"     value={fmtDateTime(job.lastRunAt)} />
            <MetricRow label="Last Success" value={fmtDateTime(job.lastSuccessAt)} accent="#10B981" />
            <MetricRow label="Last Failure" value={fmtDateTime(job.lastFailureAt)} accent="#EF4444" />
            <MetricRow label="Duration"     value={fmtDuration(job.lastDurationMs)} />
          </div>
        </div>

        <div className="crn-detail-section">
          <div className="crn-detail-section-title">Schedule</div>
          <div className="crn-metrics-grid">
            <MetricRow label="Expression" value={job.schedule ?? '—'} />
            <MetricRow label="Label"      value={job.scheduleLabel ?? '—'} />
            <MetricRow label="Run ID"     value={
              job.lastRunId
                ? <span className="crn-runid" title={job.lastRunId}>
                    {job.lastRunId.slice(0, 28)}{job.lastRunId.length > 28 ? '…' : ''}
                  </span>
                : '—'
            } />
          </div>
        </div>

        {lastResultEntries.length > 0 && (
          <div className="crn-detail-section">
            <div className="crn-detail-section-title">Last Run Result</div>
            <div className="crn-metrics-grid">
              {lastResultEntries.map(([k, v]) => (
                <MetricRow key={k} label={capitalize(k)} value={String(v)} />
              ))}
            </div>
          </div>
        )}

        {job.lastError && (
          <div className="crn-detail-section">
            <div className="crn-detail-section-title">
              <ErrorIcon style={{ fontSize: 13, color: '#EF4444' }} />
              Last Error
            </div>
            <pre className="crn-error-block">{job.lastError}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function AdminCronHealth() {
  const dispatch  = useDispatch();
  const location  = useLocation();

  const {
    jobs,
    jobsLoading,
    triggerLoading,
    triggerResult,
    triggerError,
    error,
    lastFetchTime,
  } = useSelector((s) => s.cronHealth);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(
    () => { dispatch(fetchCronHealth()); },
    [dispatch]
  );

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const handleTrigger = useCallback(
    (jobName) => { dispatch(triggerCronJob(jobName)); },
    [dispatch]
  );

  const handleClearResult = useCallback(
    (jobName) => { dispatch(clearTriggerResult(jobName)); },
    [dispatch]
  );

  const handleDismissError = useCallback(
    () => { dispatch(clearCronError()); },
    [dispatch]
  );

  const isActive = useCallback(
    (p) => location.pathname === p || location.pathname.startsWith(p + '/'),
    [location.pathname]
  );

  const healthySummary = jobs.filter((j) => j.status === 'ok').length;
  const failedSummary  = jobs.filter((j) => j.status === 'failed').length;
  const unknownSummary = jobs.filter((j) => j.status === 'unknown').length;

  return (
    <>
      <Navbar />
      <div className="crn-wrap">
        {/* ── Sidebar ── */}
        <aside className={`crn-sidebar ${sidebarOpen ? 'crn-sidebar--open' : ''}`}>
          <div className="crn-sidebar-logo">
            <span className="crn-logo-mark">
              <DashboardIcon style={{ fontSize: 20 }} />
            </span>
            <span className="crn-logo-text">Admin Panel</span>
          </div>
          <nav className="crn-nav">
            {NAV_GROUPS.map((group) => (
              <div key={group.group} className="crn-nav-group">
                <span className="crn-nav-group-label">{group.group}</span>
                {group.items.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`crn-nav-link ${active ? 'crn-nav-link--active' : ''}`}
                      style={active ? { '--crn-link-accent': item.color } : {}}
                      onClick={() => setSidebarOpen(false)}
                      title={item.label}
                    >
                      <span
                        className="crn-nav-icon"
                        style={{
                          color:      active ? item.color : undefined,
                          background: active ? `${item.color}18` : undefined,
                        }}
                      >
                        <item.icon style={{ fontSize: 18 }} />
                      </span>
                      <span className="crn-nav-text">{item.label}</span>
                      {active && (
                        <span
                          className="crn-nav-pip"
                          style={{ background: item.color }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {sidebarOpen && (
          <div
            className="crn-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Main ── */}
        <div className="crn-main">
          {/* Page header */}
          <div className="crn-page-hd">
            <div className="crn-page-hd-left">
              <button
                className="crn-menu-btn"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label="Toggle menu"
              >
                ☰
              </button>
              <Link to="/admin/dashboard" className="crn-back-btn">
                <ArrowBack style={{ fontSize: 15 }} /> Dashboard
              </Link>
              <div>
                <div className="crn-page-eyebrow">System Operations</div>
                <h1 className="crn-page-title">Cron Health</h1>
                <p className="crn-page-sub">
                  Real-time status for all scheduled background jobs
                </p>
              </div>
            </div>
            <div className="crn-page-hd-right">
              <LastUpdated timestamp={lastFetchTime} />
              <button
                className={`crn-refresh-btn ${jobsLoading ? 'crn-refresh-btn--spinning' : ''}`}
                onClick={load}
                disabled={jobsLoading}
                title="Refresh"
                aria-label="Refresh cron health"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          <div className="crn-content">
            {/* Error banner */}
            {error && (
              <div className="crn-error-banner">
                <Warning style={{ fontSize: 17 }} />
                <span>{error}</span>
                <button
                  className="crn-error-dismiss"
                  onClick={handleDismissError}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Summary KPIs */}
            <div className="crn-summary-strip">
              <div className="crn-summary-kpi crn-summary-kpi--ok">
                <CheckCircle style={{ fontSize: 20, color: '#10B981' }} />
                <span className="crn-summary-val">{healthySummary}</span>
                <span className="crn-summary-label">Healthy</span>
              </div>
              <div className="crn-summary-kpi crn-summary-kpi--failed">
                <ErrorOutline style={{ fontSize: 20, color: '#EF4444' }} />
                <span className="crn-summary-val">{failedSummary}</span>
                <span className="crn-summary-label">Failed</span>
              </div>
              <div className="crn-summary-kpi crn-summary-kpi--unknown">
                <Schedule style={{ fontSize: 20, color: '#9CA3AF' }} />
                <span className="crn-summary-val">{unknownSummary}</span>
                <span className="crn-summary-label">Pending</span>
              </div>
              <div className="crn-summary-kpi">
                <Inventory style={{ fontSize: 20, color: '#6366F1' }} />
                <span className="crn-summary-val">{jobs.length}</span>
                <span className="crn-summary-label">Total Jobs</span>
              </div>
            </div>

            {/* Section: Overview strip */}
            <div className="crn-section">
              <div className="crn-section-hd">
                <h2 className="crn-section-title">
                  <span className="crn-section-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                    <Schedule style={{ fontSize: 16 }} />
                  </span>
                  All Scheduled Jobs
                </h2>
                {jobsLoading && <span className="crn-refreshing">Refreshing…</span>}
              </div>

              {jobsLoading && jobs.length === 0 ? (
                <div className="crn-loading">
                  <Spinner size={28} />
                  <span>Loading cron health data…</span>
                </div>
              ) : jobs.length === 0 ? (
                <div className="crn-empty">
                  <Schedule style={{ fontSize: 40, color: '#D1D5DB' }} />
                  <p>No cron jobs registered yet.</p>
                  <p className="crn-empty-sub">
                    Jobs appear here after the first server boot with{' '}
                    <code>startAllCronJobs()</code>.
                  </p>
                </div>
              ) : (
                <div className="crn-overview-strip">
                  {jobs.map((job) => (
                    <OverviewCard key={job.jobName} job={job} />
                  ))}
                </div>
              )}
            </div>

            {/* Section: Job detail cards */}
            {jobs.length > 0 && (
              <div className="crn-section">
                <div className="crn-section-hd">
                  <h2 className="crn-section-title">
                    <span className="crn-section-icon" style={{ background: '#F59E0B15', color: '#F59E0B' }}>
                      <FactCheck style={{ fontSize: 16 }} />
                    </span>
                    Job Details
                  </h2>
                </div>
                <div className="crn-detail-grid">
                  {jobs.map((job) => (
                    <JobDetailCard
                      key={job.jobName}
                      job={job}
                      triggerLoading={triggerLoading[job.jobName]}
                      triggerResult={triggerResult[job.jobName]}
                      triggerError={triggerError[job.jobName]}
                      onTrigger={handleTrigger}
                      onClearResult={handleClearResult}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Section: Schedule reference */}
            {jobs.length > 0 && (
              <div className="crn-section">
                <div className="crn-section-hd">
                  <h2 className="crn-section-title">
                    <span className="crn-section-icon" style={{ background: '#10B98115', color: '#10B981' }}>
                      <Schedule style={{ fontSize: 16 }} />
                    </span>
                    Schedule Reference
                  </h2>
                </div>
                <div className="crn-schedule-table-wrap">
                  <table className="crn-schedule-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Cron Expression</th>
                        <th>Schedule</th>
                        <th>Status</th>
                        <th>Manual Trigger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => {
                        const meta = JOB_META[job.jobName] ?? { label: job.jobName, color: '#6B7280' };
                        return (
                          <tr key={job.jobName}>
                            <td>
                              <span
                                className="crn-table-job-pill"
                                style={{ color: meta.color, background: `${meta.color}15`, borderColor: `${meta.color}30` }}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td>
                              <code className="crn-expr">{job.schedule ?? '—'}</code>
                            </td>
                            <td>{job.scheduleLabel ?? '—'}</td>
                            <td><StatusBadge status={job.status} /></td>
                            <td>
                              {TRIGGERABLE_JOBS.has(job.jobName) ? (
                                <button
                                  type="button"
                                  className="crn-table-trigger-btn"
                                  onClick={() => handleTrigger(job.jobName)}
                                  disabled={!!triggerLoading[job.jobName]}
                                >
                                  {triggerLoading[job.jobName]
                                    ? <><Spinner size={11} /> Running…</>
                                    : <><PlayArrow style={{ fontSize: 12 }} /> Run</>
                                  }
                                </button>
                              ) : (
                                <span className="crn-table-no-trigger">Auto only</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}