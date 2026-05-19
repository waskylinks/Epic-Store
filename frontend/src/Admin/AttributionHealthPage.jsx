/**
 * frontend/src/pages/admin/AttributionHealthPage.jsx
 *
 * Attribution Health Dashboard — Phase 8 Observability
 * Route: /admin/analytics/health
 *
 * Displays six attribution health metrics computed from the last 30 days
 * of orders, actionable flags, confidence distribution, and reconstruction
 * rule breakdown.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, CheckCircle, Warning, ErrorOutline,
  TrackChanges, Fingerprint, Campaign, FilterAlt,
  BarChart, TrendingUp, Insights, SentimentSatisfied,
} from '@mui/icons-material';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  fetchAttributionHealth,
  selectAttributionHealth,
  selectHealthLoading,
  selectHealthError,
} from '../../features/analytics/analyticsObservabilitySlice';
import Navbar from '../../components/Navbar';
import '../../AdminStyles/AttributionHealth.css';

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const CONF_COLORS = { HIGH: '#10B981', MEDIUM: '#F59E0B', LOW: '#EF4444', unknown: '#9CA3AF' };
const PAL = ['#10B981', '#F59E0B', '#EF4444', '#6366F1', '#06B6D4', '#8B5CF6'];

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
const pct = (v) => `${(v || 0).toFixed(1)}%`;

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Skel({ h = 12, w = '100%', r = 6 }) {
  return <div className="ah-skel" style={{ height: h, width: w, borderRadius: r }} />;
}

function Spinner() {
  return <div className="ah-spinner" />;
}

function GaugeRing({ value, color, size = 80 }) {
  const r   = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash  = (value / 100) * circ;
  return (
    <svg width={size} height={size} className="ah-gauge">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5E7EB" strokeWidth={8} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <text
        x={size / 2} y={size / 2 + 5}
        textAnchor="middle"
        fontSize={13}
        fontWeight={800}
        fill={color}
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      >
        {(value || 0).toFixed(0)}%
      </text>
    </svg>
  );
}

function MetricCard({ label, value, color, icon: Icon, healthy, loading, sub }) {
  return (
    <div className={`ah-metric-card ${healthy === false ? 'ah-metric-card--warn' : ''}`}>
      <div className="ah-metric-top">
        <span className="ah-metric-icon" style={{ background: `${color}15`, color }}>
          <Icon style={{ fontSize: 18 }} />
        </span>
        {healthy === false && <Warning style={{ fontSize: 15, color: '#F59E0B' }} />}
        {healthy === true  && <CheckCircle style={{ fontSize: 15, color: '#10B981' }} />}
      </div>
      <div className="ah-metric-label">{label}</div>
      {loading
        ? <Skel h={28} w="70%" r={6} />
        : <div className="ah-metric-value" style={{ color }}>{value ?? '—'}</div>
      }
      {sub && <div className="ah-metric-sub">{sub}</div>}
    </div>
  );
}

function FlagCard({ flag }) {
  const isCritical = flag.severity === 'CRITICAL';
  return (
    <div className={`ah-flag ${isCritical ? 'ah-flag--critical' : 'ah-flag--warning'}`}>
      <span className="ah-flag-icon">
        {isCritical
          ? <ErrorOutline style={{ fontSize: 16, color: '#EF4444' }} />
          : <Warning style={{ fontSize: 16, color: '#F59E0B' }} />
        }
      </span>
      <div className="ah-flag-body">
        <div className="ah-flag-metric">{flag.metric}</div>
        <div className="ah-flag-msg">{flag.message}</div>
      </div>
      <div className="ah-flag-val" style={{ color: isCritical ? '#EF4444' : '#F59E0B' }}>
        {pct(flag.value)}
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function AttributionHealthPage() {
  const dispatch = useDispatch();
  const health   = useSelector(selectAttributionHealth);
  const loading  = useSelector(selectHealthLoading);
  const error    = useSelector(selectHealthError);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(() => {
    dispatch(fetchAttributionHealth()).finally(() => {
      setFetched(true);
    });
  }, [dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  // Cleanup on unmount - abort any pending requests
  useEffect(() => {
    return () => {
      // The abort signal in the thunk will handle cancellation automatically
      // when the component unmounts
    };
  }, []);

  const m     = health?.metrics || {};
  const flags = health?.flags   || [];
  const rules = health?.reconstructionRules || [];
  const first = !fetched;

  // Confidence distribution pie
  const confDist = m.confidence_distribution
    ? Object.entries(m.confidence_distribution).map(([k, v]) => ({
        name: k.charAt(0).toUpperCase() + k.slice(1),
        value: v,
        fill: CONF_COLORS[k] || '#9CA3AF',
      }))
    : [];

  // Radar data — six health metrics
  const radarData = first ? [] : [
    { metric: 'UTM Capture',     value: m.utm_capture_rate       || 0 },
    { metric: 'Click ID',        value: m.click_id_capture_rate  || 0 },
    { metric: 'Identity Match',  value: m.identity_match_rate    || 0 },
    { metric: 'Not Unattrib.',   value: 100 - (m.unattributed_rate || 0) },
    { metric: 'Not Reconstructed', value: 100 - (m.reconstruction_rate || 0) },
    { metric: 'High Confidence', value: m.confidence_distribution?.HIGH || 0 },
  ];

  // Health score — average of all positive metrics
  const healthScore = first ? null : Math.round(
    ((m.utm_capture_rate || 0) +
     (m.click_id_capture_rate || 0) +
     (m.identity_match_rate || 0) +
     (100 - (m.unattributed_rate || 0)) +
     (m.confidence_distribution?.HIGH || 0)) / 5
  );

  const scoreColor = healthScore >= 70 ? '#10B981' : healthScore >= 40 ? '#F59E0B' : '#EF4444';

  return (
    <>
      <Navbar />
      <div className="ah-page">
        <div className="ah-body">

          <Link to="/admin/dashboard" className="ah-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* Header */}
          <div className="ah-hd">
            <div className="ah-hd-left">
              <span className="ah-hd-icon"><TrackChanges style={{ fontSize: 26 }} /></span>
              <div>
                <div className="ah-hd-eyebrow">Analytics Observability</div>
                <h1 className="ah-hd-title">Attribution Health</h1>
                <p className="ah-hd-sub">
                  {health?.period || 'Last 30 days'} · {health?.total ?? '—'} orders analysed
                </p>
              </div>
            </div>
            <div className="ah-hd-right">
              <Link to="/admin/analytics/drift"       className="ah-nav-pill">Drift Monitor</Link>
              <Link to="/admin/analytics/queue"       className="ah-nav-pill">Queue Health</Link>
              <Link to="/admin/analytics/user-trace"  className="ah-nav-pill">User Trace</Link>
              <button
                className={`ah-refresh ${loading ? 'ah-refresh--spin' : ''}`}
                onClick={load} 
                disabled={loading}
                aria-label="Refresh attribution health data"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {error && (
            <div className="ah-error" role="alert">
              <ErrorOutline style={{ fontSize: 16 }} />
              <span>{typeof error === 'string' ? error : 'An error occurred loading attribution health'}</span>
            </div>
          )}

          {/* No orders */}
          {fetched && !loading && !health?.metrics && !error && (
            <div className="ah-empty">
              <SentimentSatisfied style={{ fontSize: 44, color: '#D1D5DB' }} />
              <p>No orders in the analysis window yet.</p>
              <p className="ah-empty-sub">Place a test order to begin collecting attribution data.</p>
            </div>
          )}

          {/* Initial loading state */}
          {loading && !fetched && (
            <div className="ah-loading-container">
              <Spinner />
              <p className="ah-loading-text">Loading attribution health data...</p>
            </div>
          )}

          {(health?.metrics || loading) && (
            <>
              {/* Overall score + flags */}
              <div className="ah-overview-row">
                <div className="ah-score-card">
                  <div className="ah-score-label">Overall Health Score</div>
                  {first && loading
                    ? <Skel h={80} w={80} r="50%" />
                    : <GaugeRing value={healthScore} color={scoreColor} size={100} />
                  }
                  <div className="ah-score-sub">
                    {first && loading ? <Skel h={12} w={120} /> : (
                      healthScore >= 70 ? '✓ Attribution data is reliable'
                      : healthScore >= 40 ? '⚠ Some tracking gaps detected'
                      : '✗ Significant attribution gaps'
                    )}
                  </div>
                </div>

                <div className="ah-flags-panel">
                  <div className="ah-section-label">Actionable Flags</div>
                  {first && loading ? (
                    <div className="ah-flags-list">
                      {[1,2].map(i => <Skel key={i} h={52} r={8} />)}
                    </div>
                  ) : flags.length === 0 ? (
                    <div className="ah-no-flags">
                      <CheckCircle style={{ fontSize: 28, color: '#10B981' }} />
                      <span>No issues detected — all metrics within healthy ranges</span>
                    </div>
                  ) : (
                    <div className="ah-flags-list">
                      {flags.map((f, i) => <FlagCard key={i} flag={f} />)}
                    </div>
                  )}
                </div>
              </div>

              {/* Six metric cards */}
              <div className="ah-section-label" style={{ marginTop: 28, marginBottom: 14 }}>
                Metric Breakdown
              </div>
              <div className="ah-metrics-grid">
                {[
                  {
                    label: 'UTM Capture Rate',
                    key:   'utm_capture_rate',
                    icon:  Campaign,
                    color: '#6366F1',
                    good:  (v) => v >= 30,
                    sub:   'Orders with non-direct UTM source',
                  },
                  {
                    label: 'Click ID Capture Rate',
                    key:   'click_id_capture_rate',
                    icon:  Fingerprint,
                    color: '#3B82F6',
                    good:  (v) => v >= 10,
                    sub:   'Orders with gclid / fbclid / ttclid',
                  },
                  {
                    label: 'Identity Match Rate',
                    key:   'identity_match_rate',
                    icon:  FilterAlt,
                    color: '#8B5CF6',
                    good:  (v) => v >= 50,
                    sub:   'Orders with anonymousId stitched',
                  },
                  {
                    label: 'Unattributed Rate',
                    key:   'unattributed_rate',
                    icon:  BarChart,
                    color: '#EF4444',
                    good:  (v) => v < 50,
                    invert: true,
                    sub:   'Direct orders with no click IDs',
                  },
                  {
                    label: 'Reconstruction Rate',
                    key:   'reconstruction_rate',
                    icon:  TrendingUp,
                    color: '#F59E0B',
                    good:  (v) => v < 30,
                    invert: true,
                    sub:   'Orders using inferred attribution',
                  },
                  {
                    label: 'High Confidence %',
                    key:   null,
                    valueOverride: m.confidence_distribution?.HIGH,
                    icon:  Insights,
                    color: '#10B981',
                    good:  (v) => v >= 20,
                    sub:   'Orders with score ≥ 0.80',
                  },
                ].map(({ label, key, valueOverride, icon, color, good, invert, sub }) => {
                  const raw = key ? (m[key] ?? null) : (valueOverride ?? null);
                  const isHealthy = raw !== null ? (invert ? !good(raw) : good(raw)) : null;
                  return (
                    <MetricCard
                      key={label}
                      label={label}
                      value={raw !== null ? pct(raw) : null}
                      color={isHealthy === false ? '#F59E0B' : isHealthy === true ? color : color}
                      icon={icon}
                      healthy={isHealthy}
                      loading={first && loading}
                      sub={sub}
                    />
                  );
                })}
              </div>

              {/* Charts row */}
              <div className="ah-charts-row">
                {/* Radar */}
                <div className="ah-card">
                  <div className="ah-card-hd">
                    <span className="ah-card-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                      <TrackChanges style={{ fontSize: 16 }} />
                    </span>
                    <div>
                      <div className="ah-card-title">Health Radar</div>
                      <div className="ah-card-sub">Six-axis attribution quality view</div>
                    </div>
                  </div>
                  <div className="ah-card-body">
                    {first && loading ? (
                      <div className="ah-chart-placeholder"><Spinner /></div>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="#E5E7EB" />
                          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#6B7280' }} />
                          <Radar
                            dataKey="value"
                            stroke="#6366F1"
                            fill="#6366F1"
                            fillOpacity={0.18}
                            strokeWidth={2}
                          />
                          <Tooltip
                            contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                            formatter={(v) => [`${v.toFixed(1)}%`, 'Score']}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Confidence distribution */}
                <div className="ah-card">
                  <div className="ah-card-hd">
                    <span className="ah-card-icon" style={{ background: '#10B98115', color: '#10B981' }}>
                      <Insights style={{ fontSize: 16 }} />
                    </span>
                    <div>
                      <div className="ah-card-title">Confidence Distribution</div>
                      <div className="ah-card-sub">HIGH / MEDIUM / LOW breakdown</div>
                    </div>
                  </div>
                  <div className="ah-card-body">
                    {first && loading ? (
                      <div className="ah-chart-placeholder"><Spinner /></div>
                    ) : confDist.length === 0 ? (
                      <div className="ah-chart-empty">No confidence data yet</div>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={confDist}
                              dataKey="value"
                              nameKey="name"
                              cx="50%" cy="50%"
                              outerRadius={80}
                              strokeWidth={0}
                              label={({ name, percent }) =>
                                percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                              }
                            >
                              {confDist.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                              formatter={(v) => [`${v.toFixed(1)}%`]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="ah-conf-legend">
                          {confDist.map((d) => (
                            <div key={d.name} className="ah-conf-row">
                              <span className="ah-conf-dot" style={{ background: d.fill }} />
                              <span className="ah-conf-label">{d.name}</span>
                              <span className="ah-conf-val" style={{ color: d.fill }}>{pct(d.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Reconstruction rules */}
              {rules.length > 0 && (
                <>
                  <div className="ah-section-label" style={{ marginTop: 28, marginBottom: 14 }}>
                    Active Reconstruction Rules
                  </div>
                  <div className="ah-rules-grid">
                    {rules.map((rule) => (
                      <div key={rule.rule} className="ah-rule-card">
                        <div className="ah-rule-name">{rule.rule}</div>
                        <div className="ah-rule-desc">{rule.description}</div>
                        <div className="ah-rule-footer">
                          <span className="ah-rule-pill" style={{ background: '#6366F115', color: '#6366F1' }}>
                            → {rule.targetSource}
                          </span>
                          <span className="ah-rule-pill" style={{ background: '#F59E0B15', color: '#B45309' }}>
                            {rule.targetMedium}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Healthy ranges reference */}
              <div className="ah-section-label" style={{ marginTop: 28, marginBottom: 14 }}>
                Healthy Range Reference
              </div>
              <div className="ah-card">
                <div className="ah-card-body">
                  <div className="ah-ref-tbl-wrap">
                    <table className="ah-ref-tbl">
                      <thead>
                        <tr>
                          <th>Metric</th><th>Healthy</th><th>Warning</th><th>Current</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: 'UTM Capture Rate',      healthy: '> 40%', warning: '< 30%', cur: m.utm_capture_rate,      ok: (m.utm_capture_rate || 0) >= 30 },
                          { label: 'Click ID Capture Rate', healthy: '> 20%', warning: '< 10%', cur: m.click_id_capture_rate, ok: (m.click_id_capture_rate || 0) >= 10 },
                          { label: 'Identity Match Rate',   healthy: '> 70%', warning: '< 50%', cur: m.identity_match_rate,   ok: (m.identity_match_rate || 0) >= 50 },
                          { label: 'Unattributed Rate',     healthy: '< 30%', warning: '> 50%', cur: m.unattributed_rate,     ok: (m.unattributed_rate || 0) < 50 },
                          { label: 'High Confidence %',     healthy: '> 30%', warning: '< 20%', cur: m.confidence_distribution?.HIGH, ok: (m.confidence_distribution?.HIGH || 0) >= 20 },
                        ].map(({ label, healthy, warning, cur, ok }) => (
                          <tr key={label}>
                            <td className="ah-ref-label">{label}</td>
                            <td className="ah-ref-good">{healthy}</td>
                            <td className="ah-ref-warn">{warning}</td>
                            <td className="ah-ref-cur">
                              {first && loading ? <Skel h={12} w={50} /> : cur != null ? pct(cur) : '—'}
                            </td>
                            <td>
                              {!(first && loading) && cur != null && (
                                <span className={`ah-status-pill ${ok ? 'ah-status-pill--ok' : 'ah-status-pill--warn'}`}>
                                  {ok ? 'OK' : 'Warning'}
                                </span>
                              )}
                            </td>
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
      </div>
    </>
  );
}