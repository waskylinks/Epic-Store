/**
 * frontend/src/pages/admin/QueueHealthPage.jsx
 *
 * Analytics Event Queue Health Monitor — Phase 8 Observability
 * Route: /admin/analytics/queue
 *
 * Displays real-time queue status: pending/failed/dead_letter counts,
 * per-platform failure breakdown, recent dead-letter events,
 * and failed events due for retry.
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, ErrorOutline, Warning,
  CheckCircle, Schedule, BarChart as BarChartIcon,
  Loop, Bolt, TableChart, PlayArrow, Cloud,
  Campaign,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import {
  fetchQueueHealth,
  selectQueueHealth,
  selectQueueLoading,
  selectQueueError,
} from '../features/analytics/analyticsObservabilitySlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/QueueHealth.css';

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
const fmtTimeAgo = (d) => {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const m    = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Skel({ h = 14, w = '100%', r = 6 }) {
  return <div className="qh-skel" style={{ height: h, width: w, borderRadius: r }} />;
}
function Spinner() { return <div className="qh-spinner" />; }

function StatusDot({ status }) {
  const cls = {
    completed:   'qh-dot--ok',
    pending:     'qh-dot--pending',
    processing:  'qh-dot--processing',
    failed:      'qh-dot--failed',
    dead_letter: 'qh-dot--dead',
  }[status] || 'qh-dot--unknown';
  return <span className={`qh-dot ${cls}`} />;
}

function PlatformFailureBar(props) {
  const { label, count, max, color } = props;
  const PlatformIcon = props.Icon;
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="qh-plat-row">
      <span className="qh-plat-icon" style={{ background: `${color}15`, color }}>
        <PlatformIcon style={{ fontSize: 14 }} />
      </span>
      <span className="qh-plat-label">{label}</span>
      <div className="qh-plat-track">
        <div className="qh-plat-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="qh-plat-count" style={{ color: count > 0 ? color : '#9CA3AF' }}>
        {count}
      </span>
    </div>
  );
}

const TT = {
  contentStyle: {
    background: '#fff', border: '1px solid #E2E8F0',
    borderRadius: 8, fontSize: 13, color: '#1E293B',
  },
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function QueueHealthPage() {
  const dispatch = useDispatch();
  const queue    = useSelector(selectQueueHealth);
  const loading  = useSelector(selectQueueLoading);
  const error    = useSelector(selectQueueError);
  const [fetched, setFetched]       = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const loadRef  = useRef(false);
  const timerRef = useRef(null);

  const load = useCallback(() => {
    if (loadRef.current) return;
    loadRef.current = true;
    dispatch(fetchQueueHealth()).finally(() => {
      loadRef.current = false;
      setFetched(true);
    });
  }, [dispatch]);

  // Auto-refresh every 30s when enabled
  useEffect(() => {
    load();
    if (autoRefresh) {
      timerRef.current = setInterval(load, 30_000);
    }
    return () => clearInterval(timerRef.current);
  }, [load, autoRefresh]);

  const first   = !fetched;
  const summary = queue?.summary             || {};
  const plat    = queue?.platformFailures    || {};
  const dead    = queue?.recentDeadLetters   || [];
  const failed  = queue?.recentFailed        || [];
  const flags   = queue?.flags               || [];

  // Status breakdown pie data
  const pieData = first ? [] : [
    { name: 'Completed',   value: summary.completed   || 0, fill: '#10B981' },
    { name: 'Pending',     value: summary.pending     || 0, fill: '#6366F1' },
    { name: 'Failed',      value: summary.failed      || 0, fill: '#F59E0B' },
    { name: 'Dead Letter', value: summary.dead_letter || 0, fill: '#EF4444' },
    { name: 'Processing',  value: summary.processing  || 0, fill: '#06B6D4' },
  ].filter(d => d.value > 0);

  // Platform failure bar data
  const platMax = Math.max(plat.ga4 || 0, plat.meta || 0, plat.bigquery || 0, 1);

  // Health ratio color
  const healthRatio = summary.healthyRatio ?? null;
  const ratioColor  = healthRatio >= 90 ? '#10B981' : healthRatio >= 70 ? '#F59E0B' : '#EF4444';

  return (
    <>
      <Navbar />
      <div className="qh-page">
        <div className="qh-body">

          <Link to="/admin/dashboard" className="qh-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* Header */}
          <div className="qh-hd">
            <div className="qh-hd-left">
              <span className="qh-hd-icon"><Loop style={{ fontSize: 26 }} /></span>
              <div>
                <div className="qh-hd-eyebrow">Analytics Observability</div>
                <h1 className="qh-hd-title">Queue Health Monitor</h1>
                <p className="qh-hd-sub">
                  Analytics event dispatch queue · GA4 · Meta CAPI · BigQuery
                </p>
              </div>
            </div>
            <div className="qh-hd-right">
              <button
                className={`qh-auto-btn ${autoRefresh ? 'qh-auto-btn--on' : ''}`}
                onClick={() => setAutoRefresh(p => !p)}
                title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
              >
                <PlayArrow style={{ fontSize: 14 }} />
                {autoRefresh ? 'Live' : 'Paused'}
              </button>
              <Link to="/admin/analytics/health"     className="qh-nav-pill">Health</Link>
              <Link to="/admin/analytics/drift"      className="qh-nav-pill">Drift</Link>
              <Link to="/admin/analytics/user-trace" className="qh-nav-pill">User Trace</Link>
              <button
                className={`qh-refresh ${loading ? 'qh-refresh--spin' : ''}`}
                onClick={load} disabled={loading}
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {error && (
            <div className="qh-error">
              <ErrorOutline style={{ fontSize: 16 }} />{error}
            </div>
          )}

          {/* Flags */}
          {!first && flags.length > 0 && (
            <div className="qh-flags">
              {flags.map((f, i) => (
                <div key={i} className={`qh-flag qh-flag--${f.severity.toLowerCase()}`}>
                  {f.severity === 'CRITICAL'
                    ? <ErrorOutline style={{ fontSize: 15 }} />
                    : <Warning style={{ fontSize: 15 }} />
                  }
                  <span>{f.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* KPI strip */}
          <div className="qh-kpi-strip">
            {[
              { label: 'Total Events',  value: summary.total,      color: '#6366F1', Icon: Schedule },
              { label: 'Completed',     value: summary.completed,  color: '#10B981', Icon: CheckCircle },
              { label: 'Pending',       value: summary.pending,    color: '#6366F1', Icon: Schedule },
              { label: 'Processing',    value: summary.processing, color: '#06B6D4', Icon: Bolt },
              { label: 'Failed',        value: summary.failed,     color: '#F59E0B', Icon: Warning },
              { label: 'Dead Letter',   value: summary.dead_letter,color: '#EF4444', Icon: ErrorOutline },
            ].map((kpi) => {
              const KpiIcon = kpi.Icon;
              const { label, value, color } = kpi;
              return (
              <div key={label} className="qh-kpi" style={{ '--kpi-color': color }}>
                <div className="qh-kpi-top">
                  <span className="qh-kpi-icon" style={{ background: `${color}15`, color }}>
                    <KpiIcon style={{ fontSize: 18 }} />
                  </span>
                  {label === 'Dead Letter' && (value || 0) > 0 && (
                    <span className="qh-kpi-alert-dot" />
                  )}
                </div>
                <div className="qh-kpi-label">{label}</div>
                {first
                  ? <Skel h={24} w="55%" r={5} />
                  : <div className="qh-kpi-value">{value ?? 0}</div>
                }
              </div>
              );
            })}
          </div>

          {/* Charts row */}
          <div className="qh-charts-row">
            {/* Health ratio + pie */}
            <div className="qh-card">
              <div className="qh-card-hd">
                <span className="qh-card-icon" style={{ background: '#10B98115', color: '#10B981' }}>
                  <CheckCircle style={{ fontSize: 16 }} />
                </span>
                <div>
                  <div className="qh-card-title">Queue Health Ratio</div>
                  <div className="qh-card-sub">Completed events as % of total</div>
                </div>
              </div>
              <div className="qh-card-body">
                {first ? (
                  <div className="qh-chart-ph"><Spinner /></div>
                ) : (
                  <div className="qh-health-layout">
                    <div className="qh-ratio-display" style={{ color: ratioColor }}>
                      <span className="qh-ratio-num">{healthRatio ?? 0}%</span>
                      <span className="qh-ratio-label">
                        {healthRatio >= 90 ? 'Healthy' : healthRatio >= 70 ? 'Degraded' : 'Critical'}
                      </span>
                    </div>
                    {pieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%" cy="50%"
                            outerRadius={80}
                            strokeWidth={0}
                            label={({ name, percent }) =>
                              percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                            }
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            {...TT}
                            formatter={(v) => [v, 'Events']}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="qh-chart-empty">No events yet</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Platform failures */}
            <div className="qh-card">
              <div className="qh-card-hd">
                <span className="qh-card-icon" style={{ background: '#EF444415', color: '#EF4444' }}>
                  <BarChartIcon style={{ fontSize: 16 }} />
                </span>
                <div>
                  <div className="qh-card-title">Platform Failure Breakdown</div>
                  <div className="qh-card-sub">Recent failed events per destination</div>
                </div>
              </div>
              <div className="qh-card-body">
                {first ? (
                  <div className="qh-plat-skels">
                    {[1,2,3].map(i => <Skel key={i} h={42} r={8} />)}
                  </div>
                ) : (
                  <>
                    <div className="qh-plat-list">
                      <PlatformFailureBar label="GA4 Measurement Protocol" count={plat.ga4 || 0}      max={platMax} color="#3B82F6" Icon={BarChartIcon} />
                      <PlatformFailureBar label="Meta Conversions API"      count={plat.meta || 0}     max={platMax} color="#1877F2" Icon={Campaign} />
                      <PlatformFailureBar label="BigQuery"                  count={plat.bigquery || 0} max={platMax} color="#F59E0B" Icon={Cloud} />
                    </div>
                    {(plat.ga4 === 0 && plat.meta === 0 && plat.bigquery === 0) && (
                      <div className="qh-plat-ok">
                        <CheckCircle style={{ fontSize: 18, color: '#10B981' }} />
                        <span>No platform failures in recent events</span>
                      </div>
                    )}
                    <div className="qh-plat-note">
                      Counts from the last {failed.length + dead.length} failed/dead-letter events
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Bar chart — queue state counts */}
            <div className="qh-card">
              <div className="qh-card-hd">
                <span className="qh-card-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                  <TableChart style={{ fontSize: 16 }} />
                </span>
                <div>
                  <div className="qh-card-title">Queue State Distribution</div>
                  <div className="qh-card-sub">Events by status</div>
                </div>
              </div>
              <div className="qh-card-body">
                {first ? (
                  <div className="qh-chart-ph"><Spinner /></div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={[
                        { name: 'Completed',  value: summary.completed   || 0, fill: '#10B981' },
                        { name: 'Pending',    value: summary.pending     || 0, fill: '#6366F1' },
                        { name: 'Processing', value: summary.processing  || 0, fill: '#06B6D4' },
                        { name: 'Failed',     value: summary.failed      || 0, fill: '#F59E0B' },
                        { name: 'Dead',       value: summary.dead_letter || 0, fill: '#EF4444' },
                      ]}
                      margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748B' }} />
                      <Tooltip {...TT} formatter={(v) => [v, 'Events']} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {[
                          '#10B981','#6366F1','#06B6D4','#F59E0B','#EF4444',
                        ].map((color, i) => (
                          <Cell key={i} fill={color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Dead-letter events */}
          <div className="qh-section" style={{ marginTop: 8 }}>
            <span className="qh-section-text">
              Recent Dead-Letter Events
              {dead.length > 0 && (
                <span className="qh-section-count qh-section-count--red">{dead.length}</span>
              )}
            </span>
            <span className="qh-section-line" />
          </div>
          <div className="qh-card">
            <div className="qh-card-body">
              {first ? (
                <div className="qh-tbl-skels">
                  {[1,2,3].map(i => <Skel key={i} h={40} r={8} />)}
                </div>
              ) : dead.length === 0 ? (
                <div className="qh-tbl-empty">
                  <CheckCircle style={{ fontSize: 28, color: '#10B981' }} />
                  <span>No dead-letter events — all events dispatched successfully</span>
                </div>
              ) : (
                <div className="qh-tbl-wrap">
                  <table className="qh-tbl">
                    <thead>
                      <tr>
                        <th>Event ID</th><th>Type</th><th>Attempts</th><th>Last Error</th><th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dead.map((ev, i) => (
                        <tr key={i} className="qh-tbl-row--dead">
                          <td className="qh-td-id">
                            <StatusDot status="dead_letter" />
                            {ev.eventId?.slice(0, 18)}…
                          </td>
                          <td><span className="qh-type-pill">{ev.eventType}</span></td>
                          <td className="qh-td-attempts">{ev.attempts}</td>
                          <td className="qh-td-error" title={ev.lastError}>
                            {ev.lastError
                              ? ev.lastError.length > 60
                                ? `${ev.lastError.slice(0, 57)}…`
                                : ev.lastError
                              : '—'
                            }
                          </td>
                          <td className="qh-td-muted">{fmtTimeAgo(ev.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Failed events due for retry */}
          <div className="qh-section" style={{ marginTop: 16 }}>
            <span className="qh-section-text">
              Failed Events (Due for Retry)
              {failed.length > 0 && (
                <span className="qh-section-count qh-section-count--amber">{failed.length}</span>
              )}
            </span>
            <span className="qh-section-line" />
          </div>
          <div className="qh-card">
            <div className="qh-card-body">
              {first ? (
                <div className="qh-tbl-skels">
                  {[1,2,3].map(i => <Skel key={i} h={40} r={8} />)}
                </div>
              ) : failed.length === 0 ? (
                <div className="qh-tbl-empty">
                  <CheckCircle style={{ fontSize: 28, color: '#10B981' }} />
                  <span>No events currently pending retry</span>
                </div>
              ) : (
                <div className="qh-tbl-wrap">
                  <table className="qh-tbl">
                    <thead>
                      <tr>
                        <th>Event ID</th><th>Type</th><th>Attempts</th>
                        <th>GA4</th><th>Meta</th><th>BigQuery</th><th>Next Retry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failed.map((ev, i) => (
                        <tr key={i}>
                          <td className="qh-td-id">
                            <StatusDot status="failed" />
                            {ev.eventId?.slice(0, 18)}…
                          </td>
                          <td><span className="qh-type-pill">{ev.eventType}</span></td>
                          <td className="qh-td-attempts">{ev.attempts}</td>
                          {['ga4', 'meta', 'bigquery'].map(platform => (
                            <td key={platform}>
                              {ev.platforms?.[platform]?.success === false
                                ? <span className="qh-plat-fail">✗ fail</span>
                                : ev.platforms?.[platform]?.success === true
                                  ? <span className="qh-plat-ok-badge">✓</span>
                                  : <span className="qh-td-muted">—</span>
                              }
                            </td>
                          ))}
                          <td className="qh-td-muted">{fmtTimeAgo(ev.nextRetryAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* How to resolve dead-letter events */}
          <div className="qh-section" style={{ marginTop: 16 }}>
            <span className="qh-section-text">Resolution Guide</span>
            <span className="qh-section-line" />
          </div>
          <div className="qh-guide-grid">
            {[
              {
                title: 'Dead-letter events',
                steps: [
                  'Check the lastError message in the table above.',
                  'Fix the root cause (invalid API key, expired token, misconfigured endpoint).',
                  'Run: retryDeadLetterEvents() from analyticsQueue.js via a Node.js script.',
                  'Monitor this page — events should move from dead_letter → pending → completed.',
                ],
                color: '#EF4444',
              },
              {
                title: 'High failed count',
                steps: [
                  'Check per-platform failure column — which platform is failing?',
                  'GA4: verify GA4_MEASUREMENT_ID and GA4_API_SECRET in .env.',
                  'Meta: check META_ACCESS_TOKEN hasn\'t expired (system user tokens don\'t expire).',
                  'BigQuery: verify GOOGLE_APPLICATION_CREDENTIALS path and service account permissions.',
                ],
                color: '#F59E0B',
              },
              {
                title: 'High pending count',
                steps: [
                  'Pending events > 50 means the queue worker is not running.',
                  'Check cronRegistry.js — AnalyticsQueue should be registered.',
                  'Check CronHealth page — look for AnalyticsQueue last run time.',
                  'If never run: verify processAnalyticsQueue is imported and the cron is active.',
                ],
                color: '#6366F1',
              },
            ].map(({ title, steps, color }) => (
              <div key={title} className="qh-guide-card" style={{ '--guide-color': color }}>
                <div className="qh-guide-title">{title}</div>
                <ol className="qh-guide-steps">
                  {steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}