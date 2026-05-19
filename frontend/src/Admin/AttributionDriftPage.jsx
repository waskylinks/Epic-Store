/**
 * frontend/src/pages/admin/AttributionDriftPage.jsx
 *
 * Attribution Drift Monitor — Phase 8 Observability
 * Route: /admin/analytics/drift
 *
 * Compares source distribution of last 7 days vs last 30 days.
 * Alerts when any source shifts more than 20 percentage points.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, ErrorOutline, Warning,
  CheckCircle, TrendingDown, TrendingUp,
  Remove, TrackChanges, BarChart as BarChartIcon,
  TableChart,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend,
} from 'recharts';
import {
  fetchAttributionDrift,
  selectAttributionDrift,
  selectDriftLoading,
  selectDriftError,
} from '../features/analytics/analyticsObservabilitySlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/AttributionDrift.css';

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const PAL = ['#6366F1','#10B981','#F59E0B','#3B82F6','#EF4444','#06B6D4','#8B5CF6','#F97316'];

const pct = (v) => `${(v || 0).toFixed(1)}%`;
const signedPct = (v) => `${v > 0 ? '+' : ''}${(v || 0).toFixed(1)}pp`;

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Skel({ h = 14, w = '100%', r = 6 }) {
  return <div className="adr-skel" style={{ height: h, width: w, borderRadius: r }} />;
}
function Spinner() { return <div className="adr-spinner" />; }

function DriftBadge({ direction, drift }) {
  if (!direction || direction === 'stable') {
    return (
      <span className="adr-badge adr-badge--flat">
        <Remove style={{ fontSize: 10 }} />0pp
      </span>
    );
  }
  const isSpike = direction === 'spike';
  return (
    <span className={`adr-badge ${isSpike ? 'adr-badge--spike' : 'adr-badge--drop'}`}>
      {isSpike
        ? <TrendingUp style={{ fontSize: 10 }} />
        : <TrendingDown style={{ fontSize: 10 }} />
      }
      {signedPct(drift)}
    </span>
  );
}

function SeverityPill({ severity }) {
  if (!severity) return null;
  return (
    <span className={`adr-severity adr-severity--${severity.toLowerCase()}`}>
      {severity}
    </span>
  );
}

function AlertCard({ alert }) {
  const isDrop = alert.direction === 'drop';
  return (
    <div className={`adr-alert adr-alert--${alert.severity.toLowerCase()}`}>
      <div className="adr-alert-top">
        <div className="adr-alert-left">
          {alert.severity === 'CRITICAL'
            ? <ErrorOutline style={{ fontSize: 18, color: '#EF4444' }} />
            : <Warning style={{ fontSize: 18, color: '#F59E0B' }} />
          }
          <div>
            <div className="adr-alert-source">{alert.source}</div>
            <SeverityPill severity={alert.severity} />
          </div>
        </div>
        <DriftBadge direction={alert.direction} drift={alert.drift_pct} />
      </div>
      <div className="adr-alert-stats">
        <div className="adr-alert-stat">
          <span className="adr-alert-stat-label">Recent (7d)</span>
          <span className="adr-alert-stat-val">{pct(alert.recent_pct)}</span>
        </div>
        <div className="adr-alert-arrow">{isDrop ? '↓' : '↑'}</div>
        <div className="adr-alert-stat">
          <span className="adr-alert-stat-label">Baseline (30d)</span>
          <span className="adr-alert-stat-val">{pct(alert.baseline_pct)}</span>
        </div>
      </div>
      <div className="adr-alert-msg">{alert.message}</div>
    </div>
  );
}

// Custom tooltip for bar chart
const TT = {
  contentStyle: {
    background: '#fff', border: '1px solid #E2E8F0',
    borderRadius: 8, fontSize: 13, color: '#1E293B',
  },
  labelStyle: { color: '#0F172A', fontWeight: 700 },
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function AttributionDriftPage() {
  const dispatch = useDispatch();
  const drift    = useSelector(selectAttributionDrift);
  const loading  = useSelector(selectDriftLoading);
  const error    = useSelector(selectDriftError);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(() => {
    dispatch(fetchAttributionDrift()).finally(() => {
      setFetched(true);
    });
  }, [dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  const alerts  = drift?.driftAlerts    || [];
  const sources = drift?.sourceAnalysis || [];
  const first   = !fetched;

  // Chart data — side-by-side bars for recent vs baseline
  const chartData = sources.slice(0, 10).map((s) => ({
    name:     s.source,
    recent:   s.recent_pct,
    baseline: s.baseline_pct,
    drift:    s.drift_pct,
    alert:    s.alert,
  }));

  // Drift direction bar chart
  const driftBarData = sources.slice(0, 10).map((s) => ({
    name:  s.source,
    drift: s.drift_pct,
    alert: s.alert,
  }));

  return (
    <>
      <Navbar />
      <div className="adr-page">
        <div className="adr-body">

          <Link to="/admin/dashboard" className="adr-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* Header */}
          <div className="adr-hd">
            <div className="adr-hd-left">
              <span className="adr-hd-icon">
                <TrackChanges style={{ fontSize: 26 }} />
              </span>
              <div>
                <div className="adr-hd-eyebrow">Analytics Observability</div>
                <h1 className="adr-hd-title">Attribution Drift Monitor</h1>
                <p className="adr-hd-sub">
                  {drift?.periods
                    ? `Last 7 days vs last 30 days · Threshold: ±${drift.driftThreshold}pp`
                    : 'Compares source distribution across time windows'
                  }
                </p>
              </div>
            </div>
            <div className="adr-hd-right">
              <Link to="/admin/analytics/health"     className="adr-nav-pill">Health</Link>
              <Link to="/admin/analytics/queue"      className="adr-nav-pill">Queue Health</Link>
              <Link to="/admin/analytics/user-trace" className="adr-nav-pill">User Trace</Link>
              <button
                className={`adr-refresh ${loading ? 'adr-refresh--spin' : ''}`}
                onClick={load} 
                disabled={loading}
                aria-label="Refresh attribution drift data"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {error && (
            <div className="adr-error" role="alert">
              <ErrorOutline style={{ fontSize: 16 }} />
              <span>{typeof error === 'string' ? error : 'An error occurred loading drift data'}</span>
            </div>
          )}

          {/* Initial loading state */}
          {loading && !fetched && (
            <div className="adr-loading-container">
              <Spinner />
              <p className="adr-loading-text">Loading attribution drift data...</p>
            </div>
          )}

          {/* Summary KPIs */}
          <div className="adr-kpi-strip">
            {[
              {
                label: 'Alert Count',
                value: first ? null : alerts.length,
                color: (first ? null : alerts.length) > 0 ? '#EF4444' : '#10B981',
                bg:    (first ? null : alerts.length) > 0 ? '#FEF2F2' : '#F0FDF4',
                icon:  (first ? null : alerts.length) > 0 ? <Warning style={{ fontSize: 20 }} /> : <CheckCircle style={{ fontSize: 20 }} />,
              },
              {
                label: 'Sources Tracked',
                value: first ? null : sources.length,
                color: '#6366F1', bg: '#EEF2FF',
                icon:  <BarChartIcon style={{ fontSize: 20 }} />,
              },
              {
                label: 'Recent Orders (7d)',
                value: first ? null : drift?.totals?.recent ?? '—',
                color: '#3B82F6', bg: '#EFF6FF',
                icon:  <TrendingUp style={{ fontSize: 20 }} />,
              },
              {
                label: 'Baseline Orders (30d)',
                value: first ? null : drift?.totals?.baseline ?? '—',
                color: '#8B5CF6', bg: '#EEF2FF',
                icon:  <TableChart style={{ fontSize: 20 }} />,
              },
            ].map(({ label, value, color, bg, icon }) => (
              <div key={label} className="adr-kpi" style={{ '--kpi-color': color }}>
                <div className="adr-kpi-top">
                  <span className="adr-kpi-icon" style={{ background: bg, color }}>
                    {icon}
                  </span>
                </div>
                <div className="adr-kpi-label">{label}</div>
                {first && loading
                  ? <Skel h={26} w="60%" r={5} />
                  : <div className="adr-kpi-value">{value ?? '—'}</div>
                }
              </div>
            ))}
          </div>

          {/* Alerts */}
          {!first && alerts.length > 0 && (
            <>
              <div className="adr-section">
                <span className="adr-section-text">
                  Active Drift Alerts
                  <span className="adr-section-count">{alerts.length}</span>
                </span>
                <span className="adr-section-line" />
              </div>
              <div className="adr-alerts-grid">
                {alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
              </div>
            </>
          )}

          {!first && alerts.length === 0 && fetched && !loading && (
            <div className="adr-no-alerts">
              <CheckCircle style={{ fontSize: 32, color: '#10B981' }} />
              <span>No drift detected — all sources within ±{drift?.driftThreshold}pp of baseline</span>
            </div>
          )}

          {/* Charts */}
          <div className="adr-section" style={{ marginTop: 28 }}>
            <span className="adr-section-text">Source Distribution Comparison</span>
            <span className="adr-section-line" />
          </div>

          <div className="adr-charts-row">
            {/* Side-by-side comparison */}
            <div className="adr-card">
              <div className="adr-card-hd">
                <span className="adr-card-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                  <BarChartIcon style={{ fontSize: 16 }} />
                </span>
                <div>
                  <div className="adr-card-title">Recent vs Baseline</div>
                  <div className="adr-card-sub">% share per source — last 7 days vs last 30 days</div>
                </div>
              </div>
              <div className="adr-card-body">
                {first && loading ? (
                  <div className="adr-chart-ph"><Spinner /></div>
                ) : chartData.length === 0 ? (
                  <div className="adr-chart-empty">No source data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        {...TT}
                        formatter={(v, n) => [`${v.toFixed(1)}%`, n === 'recent' ? 'Recent (7d)' : 'Baseline (30d)']}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                        formatter={(v) => v === 'recent' ? 'Recent (7d)' : 'Baseline (30d)'}
                      />
                      <Bar dataKey="baseline" fill="#D1D5DB" radius={[3, 3, 0, 0]} name="baseline" />
                      <Bar dataKey="recent"   fill="#6366F1" radius={[3, 3, 0, 0]} name="recent">
                        {chartData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.alert
                              ? (entry.drift > 0 ? '#F59E0B' : '#EF4444')
                              : '#6366F1'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Drift magnitude */}
            <div className="adr-card">
              <div className="adr-card-hd">
                <span className="adr-card-icon" style={{ background: '#EF444415', color: '#EF4444' }}>
                  <TrendingDown style={{ fontSize: 16 }} />
                </span>
                <div>
                  <div className="adr-card-title">Drift Magnitude</div>
                  <div className="adr-card-sub">Percentage point shift from baseline · Red = alert zone</div>
                </div>
              </div>
              <div className="adr-card-body">
                {first && loading ? (
                  <div className="adr-chart-ph"><Spinner /></div>
                ) : driftBarData.length === 0 ? (
                  <div className="adr-chart-empty">No drift data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={driftBarData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}pp`} />
                      <Tooltip
                        {...TT}
                        formatter={(v) => [`${v > 0 ? '+' : ''}${v.toFixed(1)}pp`, 'Drift']}
                      />
                      <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
                      <ReferenceLine y={20}  stroke="#F59E0B" strokeDasharray="4 4" label={{ value: '+20pp', fontSize: 10, fill: '#F59E0B' }} />
                      <ReferenceLine y={-20} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: '-20pp', fontSize: 10, fill: '#F59E0B' }} />
                      <Bar dataKey="drift" radius={[3, 3, 0, 0]}>
                        {driftBarData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.alert
                              ? (entry.drift > 0 ? '#F59E0B' : '#EF4444')
                              : '#10B981'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Full source table */}
          <div className="adr-section" style={{ marginTop: 4 }}>
            <span className="adr-section-text">All Sources</span>
            <span className="adr-section-line" />
          </div>
          <div className="adr-card">
            <div className="adr-card-body">
              {first && loading ? (
                <div className="adr-tbl-skels">
                  {[1,2,3,4,5].map(i => <Skel key={i} h={40} r={8} />)}
                </div>
              ) : sources.length === 0 ? (
                <div className="adr-chart-empty">No source data available</div>
              ) : (
                <div className="adr-tbl-wrap">
                  <table className="adr-tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Source</th>
                        <th>Recent (7d)</th>
                        <th>Baseline (30d)</th>
                        <th>Drift</th>
                        <th>Direction</th>
                        <th>Alert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((s, i) => (
                        <tr key={i} className={s.alert ? 'adr-tbl-row--alert' : ''}>
                          <td className="adr-td-rank">{i + 1}</td>
                          <td className="adr-td-source">
                            <span className="adr-src-dot" style={{ background: PAL[i % PAL.length] }} />
                            {s.source}
                          </td>
                          <td className="adr-td-mono">{pct(s.recent_pct)}</td>
                          <td className="adr-td-mono adr-td-muted">{pct(s.baseline_pct)}</td>
                          <td>
                            <DriftBadge direction={s.drift_direction} drift={s.drift_pct} />
                          </td>
                          <td className="adr-td-muted" style={{ textTransform: 'capitalize' }}>
                            {s.drift_direction}
                          </td>
                          <td>
                            {s.alert
                              ? <SeverityPill severity={
                                  Math.abs(s.drift_pct) >= 35 ? 'CRITICAL' : 'WARNING'
                                } />
                              : <span className="adr-td-ok">—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Interpretation guide */}
          <div className="adr-section" style={{ marginTop: 28 }}>
            <span className="adr-section-text">Interpretation Guide</span>
            <span className="adr-section-line" />
          </div>
          <div className="adr-guide-grid">
            {[
              {
                title:  'What is attribution drift?',
                body:   'A shift of >20 percentage points in any single source\'s share of orders between the last 7 days and last 30 days. This is a statistical signal, not a business signal — it indicates a possible tracking issue, not necessarily a real change in user behaviour.',
                color:  '#6366F1',
              },
              {
                title:  'Drop alert (source losing share)',
                body:   'The source contributed significantly less in recent days than the 30-day average. Check: pixel/CAPI configuration, UTM parameters being stripped, ad platform tracking changes, or iOS ATT restrictions tightening.',
                color:  '#EF4444',
              },
              {
                title:  'Spike alert (source gaining share)',
                body:   'The source contributed significantly more in recent days. Check: duplicate event firing (browser + server both sending without deduplication), a new campaign tagging everything with the same UTM, or a bot/spam traffic burst.',
                color:  '#F59E0B',
              },
              {
                title:  'CRITICAL vs WARNING severity',
                body:   'WARNING: drift ≥ 20pp and < 35pp. Investigate within 24 hours. CRITICAL: drift ≥ 35pp. Act immediately — this level of shift almost always indicates a broken tracking configuration, not organic behaviour.',
                color:  '#DC2626',
              },
            ].map(({ title, body, color }) => (
              <div key={title} className="adr-guide-card" style={{ '--guide-accent': color }}>
                <div className="adr-guide-title">{title}</div>
                <div className="adr-guide-body">{body}</div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}