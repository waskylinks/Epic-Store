import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Schedule,
  CheckCircle,
  ErrorOutline,
  Warning,
  Refresh,
  ArrowBack,
  PlayArrow,
  MarkEmailRead,
  LocalOffer,
  FactCheck,
  ShoppingCartCheckout,
  ReplayCircleFilled,
  Close,
  History,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import {
  fetchCronHealth,
  triggerCronJob,
  clearCronError,
  clearTriggerResult,
} from '../features/admin/cronHealthSlice';
import {
  fetchCronJobHistory,
  fetchMoreCronJobHistory,
  clearJobHistory,
  selectJobHistory,
  selectJobHistoryLoading,
  selectJobHistoryLoadingMore,
  selectJobHistoryHasNextPage,
} from '../features/admin/cronLogSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CronHealth.css';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS  = 60_000;
const TRIGGERABLE_JOBS = new Set(['DiscountCleanup', 'AuditCleanup', 'CheckoutRetention']);

const JOB_META = {
  AbandonmentSweep: {
    label:       'Abandonment Sweep',
    description: 'Marks stale checkouts as abandoned. Clears stale pendingAck records before the recovery email cron runs.',
    icon:        ShoppingCartCheckout,
    color:       '#10B981',
  },
  DiscountCleanup: {
    label:       'Discount Cleanup',
    description: 'Expires stale discount codes and hard-deletes old expired codes outside the 30-day fraud-protection window.',
    icon:        LocalOffer,
    color:       '#e563f1',
  },
  AuditCleanup: {
    label:       'Audit Log Cleanup',
    description: 'Enforces 365 + 30 day retention. Writes a purge receipt before any deletion. Partial deletions trigger a Slack warning.',
    icon:        FactCheck,
    color:       '#F59E0B',
  },
  CheckoutRetention: {
    label:       'Checkout Retention',
    description: 'Monthly three-pass lifecycle: warm prune (90d), cold archive (365d → checkouts_archive), hard delete (7yr, production only).',
    icon:        Schedule,
    color:       '#0284C7',
  },
  RecoveryEmailCron: {
    label:       'Recovery Email Cron',
    description: 'Sends abandoned cart recovery emails sequentially. Respects per-attempt delay rules, overlap guard, and per-run cap.',
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
  if (minutes < 1)   return 'Just now';
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

function StatusDot({ status }) {
  return (
    <span
      className={`crn-dot crn-dot--${status ?? 'unknown'}`}
      aria-label={`Status: ${status ?? 'unknown'}`}
    />
  );
}

function StatusBadge({ status }) {
  const map = {
    ok:      { label: 'Healthy', cls: 'crn-badge--ok'      },
    failed:  { label: 'Failed',  cls: 'crn-badge--failed'  },
    partial: { label: 'Partial', cls: 'crn-badge--partial' },
    unknown: { label: 'Pending', cls: 'crn-badge--unknown' },
  };
  const m = map[status] ?? map.unknown;
  return <span className={`crn-badge ${m.cls}`}>{m.label}</span>;
}

function TriggerBadge({ triggeredBy }) {
  if (!triggeredBy) return null;
  return (
    <span className={`crn-trigger-badge crn-trigger-badge--${triggeredBy}`}>
      {triggeredBy === 'manual' ? 'Manual' : 'Cron'}
    </span>
  );
}

function LastUpdated({ timestamp }) {
  const [label, setLabel] = useState('Never');

  useEffect(() => {
    const update = () => {
      if (!timestamp) { setLabel('Never'); return; }
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

// ─── OVERVIEW CARD ────────────────────────────────────────────────────────────

function OverviewCard({ job }) {
  const meta = JOB_META[job.jobName] ?? { label: job.jobName, icon: Schedule, color: '#6B7280' };
  const Icon = meta.icon;

  return (
    <div className={`crn-overview-card crn-overview-card--${job.status ?? 'unknown'}`}>
      <div className="crn-overview-card-top">
        <span
          className="crn-overview-icon"
          style={{ background: `${meta.color}18`, color: meta.color }}
        >
          <Icon style={{ fontSize: 20 }} />
        </span>
        <StatusDot status={job.status} />
      </div>
      <div className="crn-overview-name">{meta.label}</div>
      <div className="crn-overview-schedule">{job.scheduleLabel ?? '—'}</div>
      <div className="crn-overview-footer">
        <span className="crn-overview-last-run">{fmtTimeAgo(job.lastRunAt)}</span>
        {job.lastDurationMs != null && (
          <span className="crn-overview-duration">{fmtDuration(job.lastDurationMs)}</span>
        )}
      </div>
    </div>
  );
}

// ─── RUN HISTORY PANEL ────────────────────────────────────────────────────────

function RunHistoryPanel({ jobName }) {
  const dispatch    = useDispatch();
  const history     = useSelector(selectJobHistory(jobName));
  const loading     = useSelector(selectJobHistoryLoading(jobName));
  const loadingMore = useSelector(selectJobHistoryLoadingMore(jobName));
  const hasNextPage = useSelector(selectJobHistoryHasNextPage(jobName));

  const { logs, error } = history;

  // Load first page when panel opens
  useEffect(() => {
    dispatch(fetchCronJobHistory({ jobName, limit: 15 }));
    return () => { dispatch(clearJobHistory(jobName)); };
  }, [dispatch, jobName]);

  const handleLoadMore = () => {
    if (!loadingMore && hasNextPage) {
      dispatch(fetchMoreCronJobHistory(jobName));
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="crn-history-loading">
        <Spinner size={16} />
        <span>Loading history…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="crn-history-error">
        <ErrorOutline style={{ fontSize: 14 }} />
        <span>{error}</span>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="crn-history-empty">
        No run history available yet.
      </div>
    );
  }

  return (
    <div className="crn-history-panel">
      <div className="crn-history-tbl-wrap">
        <table className="crn-history-tbl">
          <thead>
            <tr>
              <th>Started</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Source</th>
              <th>Counts</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const countEntries = log.counts
                ? Object.entries(log.counts).filter(([, v]) =>
                    typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
                  )
                : [];

              return (
                <tr key={log._id}>
                  <td className="crn-history-td-date">{fmtDateTime(log.startedAt)}</td>
                  <td className="crn-history-td-mono">{fmtDuration(log.durationMs)}</td>
                  <td><StatusBadge status={log.status} /></td>
                  <td><TriggerBadge triggeredBy={log.triggeredBy} /></td>
                  <td>
                    {countEntries.length > 0 ? (
                      <div className="crn-history-counts">
                        {countEntries.map(([k, v]) => (
                          <span key={k} className="crn-history-count-chip">
                            <span className="crn-history-count-key">{capitalize(k)}</span>
                            <span className="crn-history-count-val">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="crn-history-td-muted">—</span>
                    )}
                  </td>
                  <td>
                    {log.error ? (
                      <span className="crn-history-error-cell" title={log.error}>
                        {log.error.length > 60 ? `${log.error.slice(0, 57)}…` : log.error}
                      </span>
                    ) : (
                      <span className="crn-history-td-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasNextPage && (
        <div className="crn-history-load-more">
          <button
            type="button"
            className="crn-history-load-btn"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? <><Spinner size={13} /> Loading…</> : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── JOB DETAIL CARD ─────────────────────────────────────────────────────────

function JobDetailCard({ job, triggerLoading, triggerResult, triggerError, onTrigger, onClearResult }) {
  const meta       = JOB_META[job.jobName] ?? { label: job.jobName, icon: Schedule, color: '#6B7280', description: '' };
  const Icon       = meta.icon;
  const canTrigger = TRIGGERABLE_JOBS.has(job.jobName);
  const isRunning  = !!triggerLoading;
  const hasResult  = !!triggerResult;
  const hasError   = !!triggerError;

  const [historyOpen, setHistoryOpen] = useState(false);

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
          <div className="crn-detail-title-wrap">
            <div className="crn-detail-title-row">
              <span className="crn-detail-title">{meta.label}</span>
              <StatusBadge status={job.status} />
            </div>
            <p className="crn-detail-desc">{meta.description}</p>
          </div>
        </div>
        <div className="crn-detail-hd-actions">
          {canTrigger && (
            <button
              type="button"
              className="crn-trigger-btn"
              onClick={() => onTrigger(job.jobName)}
              disabled={isRunning}
              title={`Manually run ${meta.label}`}
            >
              {isRunning
                ? <><Spinner size={13} /> Running…</>
                : <><PlayArrow style={{ fontSize: 15 }} /> Run Now</>
              }
            </button>
          )}
          <button
            type="button"
            className="crn-history-toggle-btn"
            onClick={() => setHistoryOpen((prev) => !prev)}
            title={historyOpen ? 'Hide run history' : 'Show run history'}
          >
            <History style={{ fontSize: 15 }} />
            {historyOpen
              ? <><ExpandLess style={{ fontSize: 14 }} /> Hide History</>
              : <><ExpandMore style={{ fontSize: 14 }} /> History</>
            }
          </button>
        </div>
      </div>

      {/* Trigger result */}
      {hasResult && (
        <div className="crn-trigger-result">
          <div className="crn-trigger-result-hd">
            <CheckCircle style={{ fontSize: 15, color: '#10B981' }} />
            <span>Run complete</span>
            <button
              type="button"
              className="crn-dismiss-btn"
              onClick={() => onClearResult(job.jobName)}
              aria-label="Dismiss"
            >
              <Close style={{ fontSize: 13 }} />
            </button>
          </div>
          {resultEntries.length > 0 && (
            <div className="crn-trigger-stats">
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

      {/* Trigger error */}
      {hasError && (
        <div className="crn-trigger-error">
          <ErrorOutline style={{ fontSize: 15 }} />
          <span>{triggerError}</span>
          <button
            type="button"
            className="crn-dismiss-btn"
            onClick={() => onClearResult(job.jobName)}
            aria-label="Dismiss"
          >
            <Close style={{ fontSize: 13 }} />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="crn-detail-body">

        <div className="crn-detail-section">
          <div className="crn-detail-section-label">Run Timing</div>
          <div className="crn-metrics-grid">
            <div className="crn-metric">
              <span className="crn-metric-label">Last Run</span>
              <span className="crn-metric-value">{fmtDateTime(job.lastRunAt)}</span>
            </div>
            <div className="crn-metric">
              <span className="crn-metric-label">Last Success</span>
              <span
                className="crn-metric-value"
                style={{ color: job.lastSuccessAt ? '#10B981' : undefined }}
              >
                {fmtDateTime(job.lastSuccessAt)}
              </span>
            </div>
            <div className="crn-metric">
              <span className="crn-metric-label">Last Failure</span>
              <span
                className="crn-metric-value"
                style={{ color: job.lastFailureAt ? '#EF4444' : undefined }}
              >
                {fmtDateTime(job.lastFailureAt)}
              </span>
            </div>
            <div className="crn-metric">
              <span className="crn-metric-label">Duration</span>
              <span className="crn-metric-value crn-metric-mono">
                {fmtDuration(job.lastDurationMs)}
              </span>
            </div>
          </div>
        </div>

        <div className="crn-detail-section">
          <div className="crn-detail-section-label">Schedule</div>
          <div className="crn-metrics-grid crn-metrics-grid--3">
            <div className="crn-metric">
              <span className="crn-metric-label">Expression</span>
              <code className="crn-expr">{job.schedule ?? '—'}</code>
            </div>
            <div className="crn-metric">
              <span className="crn-metric-label">Frequency</span>
              <span className="crn-metric-value">{job.scheduleLabel ?? '—'}</span>
            </div>
            <div className="crn-metric">
              <span className="crn-metric-label">Run ID</span>
              <span
                className="crn-metric-value crn-metric-mono crn-runid"
                title={job.lastRunId ?? ''}
              >
                {job.lastRunId ? `${job.lastRunId.slice(0, 22)}…` : '—'}
              </span>
            </div>
          </div>
        </div>

        {lastResultEntries.length > 0 && (
          <div className="crn-detail-section">
            <div className="crn-detail-section-label">Last Run Result</div>
            <div className="crn-metrics-grid">
              {lastResultEntries.map(([k, v]) => (
                <div key={k} className="crn-metric">
                  <span className="crn-metric-label">{capitalize(k)}</span>
                  <span className="crn-metric-value crn-metric-mono">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {job.lastError && (
          <div className="crn-detail-section">
            <div className="crn-detail-section-label crn-detail-section-label--error">
              <ErrorOutline style={{ fontSize: 12 }} />
              Last Error
            </div>
            <pre className="crn-error-block">{job.lastError}</pre>
          </div>
        )}
      </div>

      {/* Run history — collapsible */}
      {historyOpen && (
        <div className="crn-history-section">
          <div className="crn-history-section-hd">
            <History style={{ fontSize: 14 }} />
            <span>Run History</span>
          </div>
          <RunHistoryPanel jobName={job.jobName} />
        </div>
      )}
    </div>
  );
}

// ─── SKELETON CARDS ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="crn-overview-card crn-overview-card--skeleton">
      <div className="crn-overview-card-top">
        <div className="crn-skeleton crn-skeleton--icon" />
        <div className="crn-skeleton crn-skeleton--dot" />
      </div>
      <div className="crn-skeleton crn-skeleton--name" />
      <div className="crn-skeleton crn-skeleton--schedule" />
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function AdminCronHealth() {
  const dispatch = useDispatch();

  const {
    jobs,
    jobsLoading,
    triggerLoading,
    triggerResult,
    triggerError,
    error,
    lastFetchTime,
  } = useSelector((s) => s.cronHealth);

  const timerRef = useRef(null);

  const load = useCallback(() => {
    dispatch(fetchCronHealth());
  }, [dispatch]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const handleTrigger     = useCallback((jn) => dispatch(triggerCronJob(jn)),     [dispatch]);
  const handleClearResult = useCallback((jn) => dispatch(clearTriggerResult(jn)), [dispatch]);
  const handleDismissErr  = useCallback(()   => dispatch(clearCronError()),        [dispatch]);

  const healthy = jobs.filter((j) => j.status === 'ok').length;
  const failed  = jobs.filter((j) => j.status === 'failed').length;
  const pending = jobs.filter((j) => j.status === 'unknown').length;

  const firstLoad = jobsLoading && jobs.length === 0;

  return (
    <>
      <Navbar />

      <div className="crn-page">
        <div className="crn-body">

          {/* Back link */}
          <Link to="/admin/dashboard" className="crn-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          {/* Page header */}
          <div className="crn-hd">
            <div className="crn-hd-left">
              <span className="crn-hd-icon">
                <Schedule style={{ fontSize: 26 }} />
              </span>
              <div>
                <div className="crn-hd-eyebrow">System Operations</div>
                <h1 className="crn-hd-title">Cron Health</h1>
                <p className="crn-hd-sub">Real-time status for all scheduled background jobs</p>
              </div>
            </div>
            <div className="crn-hd-right">
              <LastUpdated timestamp={lastFetchTime} />
              <button
                className={`crn-refresh-btn${jobsLoading ? ' crn-refresh-btn--spinning' : ''}`}
                onClick={load}
                disabled={jobsLoading}
                aria-label="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="crn-error-banner" role="alert">
              <Warning style={{ fontSize: 17 }} />
              <span>{error}</span>
              <button className="crn-error-dismiss" onClick={handleDismissErr} aria-label="Dismiss error">
                <Close style={{ fontSize: 15 }} />
              </button>
            </div>
          )}

          {/* ── Summary KPIs ─────────────────────────────────────────── */}
          <div className="crn-summary-strip">
            {[
              { label: 'Healthy', val: healthy,      icon: <CheckCircle style={{ fontSize: 22 }} />,        cls: 'crn-summary-kpi--ok'      },
              { label: 'Failed',  val: failed,        icon: <ErrorOutline style={{ fontSize: 22 }} />,       cls: 'crn-summary-kpi--failed'  },
              { label: 'Pending', val: pending,       icon: <ReplayCircleFilled style={{ fontSize: 22 }} />, cls: 'crn-summary-kpi--unknown' },
              { label: 'Total',   val: jobs.length,   icon: <Schedule style={{ fontSize: 22 }} />,           cls: ''                         },
            ].map(({ label, val, icon, cls }) => (
              <div key={label} className={`crn-summary-kpi ${cls}`}>
                <span className="crn-summary-icon">{icon}</span>
                <span className="crn-summary-val">{val}</span>
                <span className="crn-summary-label">{label}</span>
              </div>
            ))}
          </div>

          {/* ── Overview strip ───────────────────────────────────────── */}
          <div className="crn-section-div">
            <span className="crn-section-div-text">Scheduled Jobs</span>
            <span className="crn-section-div-line" />
            {jobsLoading && jobs.length > 0 && (
              <span className="crn-refreshing">Refreshing…</span>
            )}
          </div>

          {firstLoad ? (
            <div className="crn-overview-strip">
              {[0, 1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
            </div>
          ) : jobs.length === 0 ? (
            <div className="crn-empty">
              <Schedule style={{ fontSize: 44, color: '#D1D5DB' }} />
              <p className="crn-empty-title">No jobs registered yet</p>
              <p className="crn-empty-sub">
                Jobs appear here after the server boots with <code>startAllCronJobs()</code>
              </p>
            </div>
          ) : (
            <div className="crn-overview-strip">
              {jobs.map((job) => <OverviewCard key={job.jobName} job={job} />)}
            </div>
          )}

          {/* ── Job detail cards ─────────────────────────────────────── */}
          {jobs.length > 0 && (
            <>
              <div className="crn-section-div" style={{ marginTop: 36 }}>
                <span className="crn-section-div-text">Job Details</span>
                <span className="crn-section-div-line" />
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
            </>
          )}

          {/* ── Schedule reference table ─────────────────────────────── */}
          {jobs.length > 0 && (
            <>
              <div className="crn-section-div" style={{ marginTop: 36 }}>
                <span className="crn-section-div-text">Schedule Reference</span>
                <span className="crn-section-div-line" />
              </div>
              <div className="crn-table-wrap">
                <div className="crn-tbl-scroll">
                  <table className="crn-schedule-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Expression</th>
                        <th>Frequency</th>
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
                                className="crn-job-pill"
                                style={{
                                  color:       meta.color,
                                  background:  `${meta.color}15`,
                                  borderColor: `${meta.color}30`,
                                }}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td><code className="crn-expr">{job.schedule ?? '—'}</code></td>
                            <td className="crn-td-muted">{job.scheduleLabel ?? '—'}</td>
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
                                    : <><PlayArrow style={{ fontSize: 13 }} /> Run</>
                                  }
                                </button>
                              ) : (
                                <span className="crn-td-auto">Auto only</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}