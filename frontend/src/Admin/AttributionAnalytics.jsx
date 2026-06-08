import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, ArrowUpward, ArrowDownward, Remove,
  DevicesOther, Language,
  Campaign, Link as LinkIcon, Laptop, Smartphone,
  BarChart as BarChartIcon, TableChart, ErrorOutline,
  TouchApp, FilterAlt, CompareArrows, OpenInNew,
} from '@mui/icons-material';
import {
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchChannelPerformance,
  fetchCampaignPerformance,
  fetchDevicePerformance,
  fetchBrowserPerformance,
  fetchReferrerPerformance,
  fetchAttributionModels,
  fetchLandingPagePerformance,
} from '../features/analytics/attributionSlice';
// ── CHANGE 1 ──────────────────────────────────────────────────
import {
  fetchAttributionHealth,
  fetchAttributionDrift,
  selectAttributionHealth,
  selectAttributionDrift,
  selectHealthLoading,
  selectDriftLoading,
} from '../features/analytics/analyticsObservabilitySlice';
// ─────────────────────────────────────────────────────────────
import Navbar from '../components/Navbar';
import '../AdminStyles/AttributionAnalytics.css';

/* ── Palette ─────────────────────────────────────────────────── */
const PAL = ['#2563EB','#16A34A','#D97706','#DC2626','#7C3AED','#0891B2','#DB2777','#65A30D'];

/* ── Formatters ──────────────────────────────────────────────── */
const fmt = {
  currency: (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:   (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:      (v) => `${(v || 0).toFixed(1)}%`,
  compact:  (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
};

/* ── Helpers ────────────────────────────────────────────────── */
function TrendBadge({ value }) {
  if (value == null) return <span className="at-badge at-badge--flat">—</span>;
  if (value === 0)   return <span className="at-badge at-badge--flat"><Remove style={{ fontSize: 10 }} />0%</span>;
  return (
    <span className={`at-badge ${value > 0 ? 'at-badge--pos' : 'at-badge--neg'}`}>
      {value > 0 ? <ArrowUpward style={{ fontSize: 10 }} /> : <ArrowDownward style={{ fontSize: 10 }} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}
// TrendBadge kept for potential future use — exported for reuse
export { TrendBadge };

function Spinner({ h = 200 }) {
  return <div className="at-loading" style={{ minHeight: h }}><div className="at-spinner" /><span>Loading…</span></div>;
}
function Empty({ label = 'No data available', h = 180 }) {
  return (
    <div className="at-empty" style={{ minHeight: h }}>
      <Campaign style={{ fontSize: 38 }} />
      <span>{label}</span>
    </div>
  );
}
function KpiSkel() {
  return (
    <div className="at-kpi-skel">
      <div className="at-skel" style={{ width: '55%', height: 10, marginBottom: 12 }} />
      <div className="at-skel" style={{ width: '75%', height: 28, marginBottom: 8 }} />
      <div className="at-skel" style={{ width: '45%', height: 10 }} />
    </div>
  );
}
function Card({ title, sub, icon: Icon, iconColor, action, flush, footer, children }) {
  return (
    <div className="at-card">
      <div className="at-card-hd">
        <div className="at-card-hd-left">
          {Icon && <span className="at-card-icon" style={{ background: iconColor + '18', color: iconColor }}><Icon style={{ fontSize: 18 }} /></span>}
          <div>
            <h3 className="at-card-title">{title}</h3>
            {sub && <p className="at-card-sub">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={flush ? 'at-card-body--np' : 'at-card-body'}>{children}</div>
      {footer && <div className="at-card-footer">{footer}</div>}
    </div>
  );
}

/* ── Recharts tooltip style (light theme) ───────────────────── */
const TT = {
  contentStyle: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', color: '#1E293B' },
  labelStyle: { color: '#0F172A', fontWeight: 700 },
};

/* ── View tabs ───────────────────────────────────────────────── */
const VIEWS = [
  { key: 'channels',  label: 'Channels',      icon: Campaign },
  { key: 'campaigns', label: 'Campaigns',      icon: FilterAlt },
  { key: 'devices',   label: 'Devices',        icon: DevicesOther },
  { key: 'browsers',  label: 'Browsers',       icon: Language },
  { key: 'referrers', label: 'Referrers',      icon: LinkIcon },
  { key: 'models',    label: 'Models',         icon: CompareArrows },
  { key: 'landing',   label: 'Landing Pages',  icon: OpenInNew },
];

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function AttributionAnalytics() {
  const dispatch = useDispatch();
  const {
    channelPerformance, campaignPerformance, devicePerformance,
    browserPerformance, referrerPerformance, attributionModels,
    landingPagePerformance, error,
  } = useSelector(s => s.attribution);

  // ── CHANGE 2 ──────────────────────────────────────────────────
  const health        = useSelector(selectAttributionHealth);
  const healthLoading = useSelector(selectHealthLoading);
  const drift         = useSelector(selectAttributionDrift);
  const driftLoading  = useSelector(selectDriftLoading);
  // ─────────────────────────────────────────────────────────────

  const [activeView, setActiveView] = useState('channels');
  const [timeframe,  setTimeframe]  = useState('month');
  const [hasFetched, setHasFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);

  const loadAll = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    setHasFetched(false);
    Promise.allSettled([

      dispatch(fetchChannelPerformance({ timeframe })),
      dispatch(fetchCampaignPerformance({ timeframe })),
      dispatch(fetchDevicePerformance({ timeframe })),
      dispatch(fetchBrowserPerformance({ timeframe })),
      dispatch(fetchReferrerPerformance({ timeframe })),
      dispatch(fetchAttributionModels({ timeframe })),
      dispatch(fetchLandingPagePerformance({ timeframe })),
      // ── CHANGE 3 ──────────────────────────────────────────────
      dispatch(fetchAttributionHealth()),
      dispatch(fetchAttributionDrift()),
      // ─────────────────────────────────────────────────────────
    ]).finally(() => {
      loadingRef.current = false;
      setRefreshing(false);
      setHasFetched(true);
    });
  }, [dispatch, timeframe]);

  useEffect(() => { loadAll(); }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived data ─────────────────────────────────────────────
   * FIX: Controller returns items with `source` field, not `_id`.
   * We normalise here so the rest of the component stays readable.
   * ─────────────────────────────────────────────────────────── */

  // channels: [{ source, orders, revenue, uniqueCustomers, newCustomers, avgOrderValue, avgCLV, customerLTV }]
  const channels = (channelPerformance?.channels || []).map(c => ({
    ...c,
    _id:       c.source       || c._id || 'Unknown',   // normalise display key
    customers: c.uniqueCustomers ?? c.customers ?? 0,
  }));
  const chMax = channels.length ? Math.max(...channels.map(c => c.revenue || 0)) : 1;

  // campaigns: [{ campaign, source, medium, orders, revenue, uniqueCustomers, avgOrderValue }]
  // Controller does NOT return conversionRate; derive it from avgOrderValue or leave 0
  const campaigns = (campaignPerformance?.campaigns || []).map(c => ({
    ...c,
    _id:            c.campaign || c._id || '—',
    // conversionRate not in controller — show avgOrderValue context instead
    conversionRate: c.conversionRate ?? 0,
  }));

  // devices: [{ device, orders, revenue, orderPercentage, avgOrderValue }]
  const devices = (devicePerformance?.devices || []).map(d => ({
    ...d,
    _id:        d.device      || d._id      || 'Unknown',
    percentage: d.orderPercentage ?? d.percentage ?? 0,
  }));

  // browsers: [{ browser, orders, revenue }]
  const browsers = (browserPerformance?.browsers || []).map(b => ({
    ...b,
    _id: b.browser || b._id || 'Unknown',
  }));

  // referrers: [{ referrer, orders, revenue, uniqueCustomers }]
  const referrers = (referrerPerformance?.referrers || []).map(r => ({
    ...r,
    _id: r.referrer || r._id || 'Direct',
  }));

  // FIX: Controller returns { firstTouch: [...], lastTouch: [...] }
  // firstTouch items: { source, customers, totalRevenue }
  // lastTouch items:  { source, orders, revenue }
  const firstTouchList = Array.isArray(attributionModels?.firstTouch)
    ? attributionModels.firstTouch
    : [];
  const lastTouchList = Array.isArray(attributionModels?.lastTouch)
    ? attributionModels.lastTouch
    : [];

  // FIX: Controller response key is `landingPages`, not `pages`
  // items: { landingPage, orders, revenue, uniqueCustomers }
  const pages = (landingPagePerformance?.landingPages || landingPagePerformance?.pages || []).map(p => ({
    ...p,
    _id:            p.landingPage  || p._id     || '/',
    sessions:       p.uniqueCustomers ?? p.sessions ?? 0,
    // conversionRate not in controller — derive from orders/uniqueCustomers
    conversionRate: p.conversionRate ?? (
      p.uniqueCustomers > 0 ? (p.orders / p.uniqueCustomers) * 100 : 0
    ),
  }));

  // ── CHANGE 4 ──────────────────────────────────────────────────
  const confDist   = health?.metrics?.confidence_distribution || {};
  const confHigh   = confDist.HIGH   ?? null;
  const confMedium = confDist.MEDIUM ?? null;
  const confLow    = confDist.LOW    ?? null;
  const confTotal  = (confHigh ?? 0) + (confMedium ?? 0) + (confLow ?? 0);
  const driftAlerts = drift?.driftAlerts || [];
  const hasDriftAlert = driftAlerts.length > 0;
  // ─────────────────────────────────────────────────────────────

  /* ── Totals for overview KPIs ─────────────────────────────── */
  const totalRevenue   = channels.reduce((s, c) => s + (c.revenue   || 0), 0);
  const totalOrders    = channels.reduce((s, c) => s + (c.orders    || 0), 0);
  const totalCustomers = channels.reduce((s, c) => s + (c.customers || 0), 0);
  const totalNewCust   = channels.reduce((s, c) => s + (c.newCustomers || 0), 0);

  const first = !hasFetched;

  return (
    <>
      <Navbar />
      <div className="at-page">
        <div className="at-body">

          {/* ── Back ──────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="at-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* ── Header ────────────────────────────────────── */}
          <div className="at-hd">
            <div className="at-hd-left">
              <span className="at-hd-icon">
                <Campaign style={{ fontSize: 28 }} />
              </span>
              <div>
                <div className="at-hd-eyebrow">Marketing Intelligence</div>
                <h1 className="at-hd-title">Attribution Analytics</h1>
                <p className="at-hd-sub">Channels · Campaigns · Devices · Referrers · Attribution Models</p>
              </div>
            </div>
            <div className="at-hd-right">
              <div className="at-tf">
                {['day', 'week', 'month', 'quarter', 'year'].map(t => (
                  <button
                    key={t}
                    className={`at-tf-btn ${timeframe === t ? 'at-tf-btn--active' : ''}`}
                    onClick={() => setTimeframe(t)}
                    disabled={refreshing}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <button
                className={`at-icon-btn ${refreshing ? 'at-icon-btn--spin' : ''}`}
                onClick={loadAll}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 19 }} />
              </button>
            </div>
          </div>

          {error && <div className="at-error"><ErrorOutline style={{ fontSize: 17 }} />{error}</div>}

          {/* ── CHANGE 5 ──────────────────────────────────────── */}
          {hasDriftAlert && !driftLoading && (
            <div className="at-drift-banner" role="alert">
              <div className="at-drift-banner-left">
                <ErrorOutline style={{ fontSize: 16, color: '#EF4444' }} />
                <div>
                  <span className="at-drift-banner-title">
                    Attribution drift detected — {driftAlerts.length} source{driftAlerts.length !== 1 ? 's' : ''} outside baseline
                  </span>
                  <span className="at-drift-banner-detail">
                    {driftAlerts.map(a => `${a.source} (${a.drift_pct > 0 ? '+' : ''}${a.drift_pct?.toFixed(1)}pp)`).join(' · ')}
                  </span>
                </div>
              </div>
              <a href="/admin/analytics/drift" className="at-drift-banner-link">
                View Drift Monitor →
              </a>
            </div>
          )}
          {/* ──────────────────────────────────────────────────── */}

          {/* ── Summary KPIs ──────────────────────────────── */}
          <div className="at-grid-4">
            {first ? Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />) : (
              <>
                <div className="at-kpi" style={{ '--kpi-color': '#2563EB' }}>
                  <div className="at-kpi-eyebrow">Total Revenue</div>
                  <div className="at-kpi-value">{fmt.compact(totalRevenue)}</div>
                  <div className="at-kpi-label">All attributed channels</div>
                </div>
                <div className="at-kpi" style={{ '--kpi-color': '#16A34A' }}>
                  <div className="at-kpi-eyebrow">Total Orders</div>
                  <div className="at-kpi-value">{fmt.number(totalOrders)}</div>
                  <div className="at-kpi-label">Across {channels.length} channels</div>
                </div>
                <div className="at-kpi" style={{ '--kpi-color': '#7C3AED' }}>
                  <div className="at-kpi-eyebrow">Total Customers</div>
                  <div className="at-kpi-value">{fmt.number(totalCustomers)}</div>
                  <div className="at-kpi-label">New: {fmt.number(totalNewCust)}</div>
                </div>
                <div className="at-kpi" style={{ '--kpi-color': '#D97706' }}>
                  <div className="at-kpi-eyebrow">Active Channels</div>
                  <div className="at-kpi-value">{channels.length}</div>
                  <div className="at-kpi-label">{campaigns.length} campaigns tracked</div>
                </div>
                {/* ── CHANGE 6 ──────────────────────────────────── */}
                <div className="at-kpi at-kpi--split" style={{ '--kpi-color': '#6366F1' }}>
                  <div className="at-kpi-eyebrow">Attribution Confidence</div>
                  {(healthLoading && confHigh === null) ? (
                    <div className="at-skel" style={{ height: 28, width: '70%', borderRadius: 5 }} />
                  ) : confTotal === 0 ? (
                    <div className="at-kpi-value" style={{ fontSize: 14, color: '#9CA3AF' }}>No data</div>
                  ) : (
                    <div className="at-conf-strip">
                      <span className="at-conf-pill at-conf-pill--high"  title={`${confHigh} HIGH confidence orders`}>
                        H {confHigh ?? '—'}
                      </span>
                      <span className="at-conf-pill at-conf-pill--medium" title={`${confMedium} MEDIUM confidence orders`}>
                        M {confMedium ?? '—'}
                      </span>
                      <span className="at-conf-pill at-conf-pill--low"   title={`${confLow} LOW confidence orders`}>
                        L {confLow ?? '—'}
                      </span>
                    </div>
                  )}
                  <div className="at-kpi-label">
                    <a href="/admin/analytics/health" className="at-kpi-link">View Health →</a>
                  </div>
                </div>
                {/* ──────────────────────────────────────────────── */}
              </>
            )}
          </div>

          {/* ── View tabs ─────────────────────────────────── */}
          <div className="at-tabs">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`at-tab ${activeView === key ? 'at-tab--active' : ''}`}
                onClick={() => setActiveView(key)}
              >
                <Icon style={{ fontSize: 15 }} />{label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════
              CHANNELS
          ══════════════════════════════════════════════ */}
          {activeView === 'channels' && (
            <div className="at-panel">
              <div className="at-section"><span className="at-section-text">Channel Performance</span><span className="at-section-line" /></div>

              <div className="at-grid-3-2">
                <Card title="Revenue by Channel" sub="Attributed revenue across all marketing channels" icon={Campaign} iconColor="#2563EB">
                  {first ? <Spinner h={280} /> : channels.length === 0 ? <Empty h={280} /> : (
                    <>
                      <div>
                        {channels.map((c, i) => {
                          const pct = chMax > 0 ? (c.revenue / chMax) * 100 : 0;
                          return (
                            <div className="at-bar-row" key={i}>
                              <span className="at-bar-label" title={c._id}>{c._id}</span>
                              <div className="at-bar-track">
                                <div className="at-bar-fill" style={{ width: `${pct}%`, background: PAL[i % PAL.length] }} />
                              </div>
                              <span className="at-bar-pct">{fmt.pct(totalRevenue > 0 ? (c.revenue / totalRevenue) * 100 : 0)}</span>
                              <span className="at-bar-val">{fmt.compact(c.revenue)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="at-summary-bar" style={{ margin: '20px -22px -20px' }}>
                        <div className="at-summary-item"><div className="at-summary-label">Total Rev</div><div className="at-summary-val">{fmt.compact(totalRevenue)}</div></div>
                        <div className="at-summary-item"><div className="at-summary-label">Channels</div><div className="at-summary-val">{channels.length}</div></div>
                        <div className="at-summary-item"><div className="at-summary-label">Top Channel</div><div className="at-summary-val" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channels[0]?._id || '—'}</div></div>
                      </div>
                    </>
                  )}
                </Card>

                <Card title="Channel Share" sub="Revenue distribution" icon={BarChartIcon} iconColor="#7C3AED">
                  {first ? <Spinner h={280} /> : channels.length === 0 ? <Empty h={280} /> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={channels.map((c, i) => ({ name: c._id, value: c.revenue || 0, fill: PAL[i % PAL.length] }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%" cy="50%"
                          outerRadius={90}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={{ stroke: '#94A3B8' }}
                        >
                          {channels.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Pie>
                        <Tooltip {...TT} formatter={(v) => [fmt.compact(v), 'Revenue']} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <div className="at-section"><span className="at-section-text">Detailed Breakdown</span><span className="at-section-line" /></div>
              <div className="at-row">
                <Card
                  title="Channel Metrics Table"
                  sub="Orders, revenue, customers and new acquisitions per channel"
                  icon={TableChart}
                  iconColor="#0891B2"
                  action={<span className="at-count-badge">{channels.length} channels</span>}
                >
                  {first ? <Spinner h={200} /> : channels.length === 0 ? <Empty /> : (
                    <div className="at-tbl-wrap">
                      <table className="at-tbl">
                        <thead>
                          <tr><th>#</th><th>Channel</th><th>Orders</th><th>Revenue</th><th>Customers</th><th>New Customers</th><th>Rev/Order</th><th>Share</th></tr>
                        </thead>
                        <tbody>
                          {channels.map((c, i) => (
                            <tr key={i}>
                              <td className="at-td-rank">{i + 1}</td>
                              <td><span className="at-dot" style={{ background: PAL[i % PAL.length] }} /><span className="at-channel-pill">{c._id}</span></td>
                              <td>{fmt.number(c.orders)}</td>
                              <td className="at-td-money">{fmt.compact(c.revenue)}</td>
                              <td>{fmt.number(c.customers)}</td>
                              <td className="at-td-accent">{fmt.number(c.newCustomers)}</td>
                              <td className="at-td-mono">{fmt.currency((c.revenue || 0) / (c.orders || 1))}</td>
                              <td className="at-td-mono">{fmt.pct(totalRevenue > 0 ? (c.revenue / totalRevenue) * 100 : 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              CAMPAIGNS
          ══════════════════════════════════════════════ */}
          {activeView === 'campaigns' && (
            <div className="at-panel">
              <div className="at-section"><span className="at-section-text">Campaign Performance</span><span className="at-section-line" /></div>

              <div className="at-grid-4">
                {first ? Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="at-kpi" style={{ '--kpi-color': '#2563EB' }}>
                      <div className="at-kpi-eyebrow">Active Campaigns</div>
                      <div className="at-kpi-value">{campaigns.length}</div>
                      <div className="at-kpi-label">In selected period</div>
                    </div>
                    <div className="at-kpi" style={{ '--kpi-color': '#16A34A' }}>
                      <div className="at-kpi-eyebrow">Campaign Revenue</div>
                      <div className="at-kpi-value">{fmt.compact(campaigns.reduce((s, c) => s + (c.revenue || 0), 0))}</div>
                      <div className="at-kpi-label">Total attributed</div>
                    </div>
                    <div className="at-kpi" style={{ '--kpi-color': '#7C3AED' }}>
                      <div className="at-kpi-eyebrow">Campaign Orders</div>
                      <div className="at-kpi-value">{fmt.number(campaigns.reduce((s, c) => s + (c.orders || 0), 0))}</div>
                      <div className="at-kpi-label">Total orders</div>
                    </div>
                    <div className="at-kpi" style={{ '--kpi-color': '#D97706' }}>
                      <div className="at-kpi-eyebrow">Avg Order Value</div>
                      <div className="at-kpi-value">{fmt.compact(campaigns.length > 0 ? campaigns.reduce((s, c) => s + (c.avgOrderValue || 0), 0) / campaigns.length : 0)}</div>
                      <div className="at-kpi-label">Across all campaigns</div>
                    </div>
                  </>
                )}
              </div>

              <div className="at-grid-2">
                <Card title="Revenue by Campaign" sub="Top performing campaigns" icon={Campaign} iconColor="#2563EB">
                  {first ? <Spinner h={280} /> : campaigns.length === 0 ? <Empty h={280} /> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={campaigns.slice(0, 8).map(c => ({ name: (c._id || '').substring(0, 16), revenue: c.revenue || 0, orders: c.orders || 0 }))}
                        layout="vertical"
                        margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#334155' }} width={110} />
                        <Tooltip {...TT} formatter={(v, n) => [n === 'revenue' ? fmt.compact(v) : fmt.number(v), n === 'revenue' ? 'Revenue' : 'Orders']} />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                          {campaigns.slice(0, 8).map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card title="Avg Order Value by Campaign" sub="Revenue per order per campaign" icon={BarChartIcon} iconColor="#16A34A">
                  {first ? <Spinner h={280} /> : campaigns.length === 0 ? <Empty h={280} /> : (
                    <div>
                      {campaigns.slice(0, 8).map((c, i) => {
                        const maxAOV = Math.max(...campaigns.map(x => x.avgOrderValue || 0)) || 1;
                        return (
                          <div className="at-bar-row" key={i}>
                            <span className="at-bar-label" title={c._id}>{(c._id || '').substring(0, 20) || 'Unknown'}</span>
                            <div className="at-bar-track">
                              <div className="at-bar-fill" style={{ width: `${((c.avgOrderValue || 0) / maxAOV) * 100}%`, background: PAL[i % PAL.length] }} />
                            </div>
                            <span className="at-bar-val">{fmt.compact(c.avgOrderValue)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>

              <div className="at-section"><span className="at-section-text">All Campaigns</span><span className="at-section-line" /></div>
              <div className="at-row">
                <Card title="Campaign Data Table" sub="Full campaign metrics — campaign, source, medium, orders, revenue, avg order value" icon={TableChart} iconColor="#0891B2">
                  {first ? <Spinner h={200} /> : campaigns.length === 0 ? <Empty /> : (
                    <div className="at-tbl-wrap">
                      <table className="at-tbl">
                        <thead><tr><th>#</th><th>Campaign</th><th>Source</th><th>Medium</th><th>Orders</th><th>Revenue</th><th>Avg Order Value</th></tr></thead>
                        <tbody>
                          {campaigns.map((c, i) => (
                            <tr key={i}>
                              <td className="at-td-rank">{i + 1}</td>
                              <td className="at-td-name">{c._id}</td>
                              <td className="at-td-muted">{c.source || '—'}</td>
                              <td className="at-td-muted">{c.medium || '—'}</td>
                              <td>{fmt.number(c.orders)}</td>
                              <td className="at-td-money">{fmt.compact(c.revenue)}</td>
                              <td className="at-td-mono">{fmt.currency(c.avgOrderValue || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              DEVICES
          ══════════════════════════════════════════════ */}
          {activeView === 'devices' && (
            <div className="at-panel">
              <div className="at-section"><span className="at-section-text">Device Performance</span><span className="at-section-line" /></div>
              <div className="at-grid-2">
                <Card title="Orders by Device" sub="With percentage of total orders" icon={DevicesOther} iconColor="#0891B2">
                  {first ? <Spinner h={260} /> : devices.length === 0 ? <Empty h={260} /> : (
                    <div>
                      {devices.map((d, i) => (
                        <div className="at-bar-row" key={i}>
                          <span className="at-bar-label">{d._id}</span>
                          <div className="at-bar-track">
                            <div className="at-bar-fill" style={{ width: `${d.percentage || 0}%`, background: PAL[i % PAL.length] }} />
                          </div>
                          <span className="at-bar-pct">{fmt.pct(d.percentage)}</span>
                          <span className="at-bar-val">{fmt.number(d.orders)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Revenue by Device" sub="Attributed revenue per device type" icon={Laptop} iconColor="#2563EB">
                  {first ? <Spinner h={260} /> : devices.length === 0 ? <Empty h={260} /> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={devices.map((d, i) => ({ name: d._id, value: d.revenue || 0, fill: PAL[i % PAL.length] }))}
                          dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={{ stroke: '#94A3B8' }}
                        >
                          {devices.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Pie>
                        <Tooltip {...TT} formatter={v => [fmt.compact(v), 'Revenue']} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <div className="at-row">
                <Card title="Device Breakdown" sub="Full metrics per device" icon={Smartphone} iconColor="#7C3AED">
                  {first ? <Spinner h={160} /> : devices.length === 0 ? <Empty /> : (
                    <div className="at-tbl-wrap">
                      <table className="at-tbl">
                        <thead><tr><th>#</th><th>Device</th><th>Orders</th><th>% of Orders</th><th>Revenue</th><th>Rev/Order</th></tr></thead>
                        <tbody>
                          {devices.map((d, i) => (
                            <tr key={i}>
                              <td className="at-td-rank">{i + 1}</td>
                              <td><span className="at-dot" style={{ background: PAL[i % PAL.length] }} /><span className="at-td-name">{d._id}</span></td>
                              <td>{fmt.number(d.orders)}</td>
                              <td className="at-td-accent">{fmt.pct(d.percentage)}</td>
                              <td className="at-td-money">{fmt.compact(d.revenue)}</td>
                              <td className="at-td-mono">{fmt.currency((d.revenue || 0) / (d.orders || 1))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              BROWSERS
          ══════════════════════════════════════════════ */}
          {activeView === 'browsers' && (
            <div className="at-panel">
              <div className="at-section"><span className="at-section-text">Browser Performance</span><span className="at-section-line" /></div>
              <div className="at-grid-2">
                <Card title="Orders by Browser" sub="Breakdown of orders per browser" icon={Language} iconColor="#0891B2">
                  {first ? <Spinner h={260} /> : browsers.length === 0 ? <Empty h={260} /> : (
                    <div>
                      {browsers.map((b, i) => {
                        const max = Math.max(...browsers.map(x => x.orders || 0)) || 1;
                        return (
                          <div className="at-bar-row" key={i}>
                            <span className="at-bar-label">{b._id}</span>
                            <div className="at-bar-track">
                              <div className="at-bar-fill" style={{ width: `${(b.orders / max) * 100}%`, background: PAL[i % PAL.length] }} />
                            </div>
                            <span className="at-bar-val">{fmt.number(b.orders)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card title="Revenue by Browser" sub="Which browsers drive most value" icon={Language} iconColor="#2563EB">
                  {first ? <Spinner h={260} /> : browsers.length === 0 ? <Empty h={260} /> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={browsers.map(b => ({ name: (b._id || 'Unknown').substring(0, 12), revenue: b.revenue || 0, orders: b.orders || 0 }))}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip {...TT} formatter={(v, n) => [n === 'revenue' ? fmt.compact(v) : fmt.number(v), n === 'revenue' ? 'Revenue' : 'Orders']} />
                        <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                          {browsers.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <div className="at-row">
                <Card title="Browser Detail Table" sub="Complete metrics per browser" icon={TableChart} iconColor="#0891B2">
                  {first ? <Spinner h={160} /> : browsers.length === 0 ? <Empty /> : (
                    <div className="at-tbl-wrap">
                      <table className="at-tbl">
                        <thead><tr><th>#</th><th>Browser</th><th>Orders</th><th>Revenue</th><th>Rev/Order</th></tr></thead>
                        <tbody>
                          {browsers.map((b, i) => (
                            <tr key={i}>
                              <td className="at-td-rank">{i + 1}</td>
                              <td><span className="at-dot" style={{ background: PAL[i % PAL.length] }} /><span className="at-td-name">{b._id}</span></td>
                              <td>{fmt.number(b.orders)}</td>
                              <td className="at-td-money">{fmt.compact(b.revenue)}</td>
                              <td className="at-td-mono">{fmt.currency((b.revenue || 0) / (b.orders || 1))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              REFERRERS
          ══════════════════════════════════════════════ */}
          {activeView === 'referrers' && (
            <div className="at-panel">
              <div className="at-section"><span className="at-section-text">Referrer Performance</span><span className="at-section-line" /></div>
              <div className="at-grid-2">
                <Card title="Top Referrers by Revenue" sub="Traffic sources driving most revenue" icon={LinkIcon} iconColor="#16A34A">
                  {first ? <Spinner h={280} /> : referrers.length === 0 ? <Empty h={280} /> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={referrers.slice(0, 8).map(r => ({ name: (r._id || 'Direct').substring(0, 18), revenue: r.revenue || 0, orders: r.orders || 0 }))}
                        layout="vertical"
                        margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#334155' }} width={130} />
                        <Tooltip {...TT} formatter={(v, n) => [n === 'revenue' ? fmt.compact(v) : fmt.number(v), n === 'revenue' ? 'Revenue' : 'Orders']} />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                          {referrers.slice(0, 8).map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card title="Referrer Order Share" sub="Orders per referral source" icon={BarChartIcon} iconColor="#2563EB">
                  {first ? <Spinner h={280} /> : referrers.length === 0 ? <Empty h={280} /> : (
                    <div>
                      {referrers.slice(0, 8).map((r, i) => {
                        const max = Math.max(...referrers.map(x => x.orders || 0)) || 1;
                        return (
                          <div className="at-bar-row" key={i}>
                            <span className="at-bar-label" title={r._id}>{(r._id || 'Direct').substring(0, 20)}</span>
                            <div className="at-bar-track">
                              <div className="at-bar-fill" style={{ width: `${(r.orders / max) * 100}%`, background: PAL[i % PAL.length] }} />
                            </div>
                            <span className="at-bar-val">{fmt.number(r.orders)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>

              <div className="at-row">
                <Card
                  title="All Referrers"
                  sub="Complete referral source data"
                  icon={TableChart}
                  iconColor="#0891B2"
                  action={<span className="at-count-badge">{referrers.length} sources</span>}
                >
                  {first ? <Spinner h={200} /> : referrers.length === 0 ? <Empty /> : (
                    <div className="at-tbl-wrap">
                      <table className="at-tbl">
                        <thead><tr><th>#</th><th>Referrer</th><th>Orders</th><th>Revenue</th><th>Rev/Order</th></tr></thead>
                        <tbody>
                          {referrers.map((r, i) => (
                            <tr key={i}>
                              <td className="at-td-rank">{i + 1}</td>
                              <td className="at-td-name">{r._id}</td>
                              <td>{fmt.number(r.orders)}</td>
                              <td className="at-td-money">{fmt.compact(r.revenue)}</td>
                              <td className="at-td-mono">{fmt.currency((r.revenue || 0) / (r.orders || 1))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              ATTRIBUTION MODELS
          ══════════════════════════════════════════════ */}
          {activeView === 'models' && (
            <div className="at-panel">
              <div className="at-section"><span className="at-section-text">Attribution Model Comparison</span><span className="at-section-line" /></div>

              <div className="at-grid-2">
                {/* FIX: firstTouch is an array of { source, customers, totalRevenue } */}
                <Card title="First-Touch Attribution" sub="Credit given to the first channel a customer interacted with" icon={TouchApp} iconColor="#2563EB">
                  {first ? <Spinner h={240} /> : !attributionModels ? <Empty h={240} /> : (
                    <div>
                      {firstTouchList.length === 0 ? (
                        <Empty h={160} label="No first-touch data for this period" />
                      ) : firstTouchList.map((item, i) => (
                        <div className="at-metric-row" key={i}>
                          <span className="at-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PAL[i % PAL.length], display: 'inline-block', flexShrink: 0 }} />
                            {item.source || 'Unknown'}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="at-metric-val at-metric-val--blue">{fmt.compact(item.totalRevenue)}</span>
                            <span className="at-metric-sub">{fmt.number(item.customers)} customers</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* FIX: lastTouch is an array of { source, orders, revenue } */}
                <Card title="Last-Touch Attribution" sub="Credit given to the final channel before conversion" icon={TouchApp} iconColor="#16A34A">
                  {first ? <Spinner h={240} /> : !attributionModels ? <Empty h={240} /> : (
                    <div>
                      {lastTouchList.length === 0 ? (
                        <Empty h={160} label="No last-touch data for this period" />
                      ) : lastTouchList.map((item, i) => (
                        <div className="at-metric-row" key={i}>
                          <span className="at-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PAL[i % PAL.length], display: 'inline-block', flexShrink: 0 }} />
                            {item.source || 'Unknown'}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="at-metric-val at-metric-val--green">{fmt.compact(item.revenue)}</span>
                            <span className="at-metric-sub">{fmt.number(item.orders)} orders</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="at-row">
                <Card title="Attribution Model Guide" sub="Understanding first-touch vs last-touch" icon={CompareArrows} iconColor="#7C3AED">
                  <div className="at-model-hd">
                    <div className="at-model-col">
                      <div className="at-model-title">First-Touch</div>
                      <div className="at-model-body">
                        All credit goes to the very first channel the customer interacted with. Best for measuring
                        <span className="at-model-highlight-blue"> awareness &amp; discovery</span> effectiveness.
                        Shows which channels attract new audiences into your funnel.
                      </div>
                    </div>
                    <div className="at-model-col">
                      <div className="at-model-title">Last-Touch</div>
                      <div className="at-model-body">
                        All credit goes to the final channel before purchase. Best for measuring
                        <span className="at-model-highlight-green"> conversion &amp; closing</span> performance.
                        Shows which channels directly drive purchases.
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              LANDING PAGES
          ══════════════════════════════════════════════ */}
          {activeView === 'landing' && (
            <div className="at-panel">
              <div className="at-grid-4">
                {first ? Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="at-kpi" style={{ '--kpi-color': '#2563EB' }}>
                      <div className="at-kpi-eyebrow">Total Pages</div>
                      <div className="at-kpi-value">{pages.length}</div>
                      <div className="at-kpi-label">Tracked landing pages</div>
                    </div>
                    <div className="at-kpi" style={{ '--kpi-color': '#7C3AED' }}>
                      {/* FIX: no sessions field from controller — use uniqueCustomers */}
                      <div className="at-kpi-eyebrow">Unique Visitors</div>
                      <div className="at-kpi-value">{fmt.number(pages.reduce((s, p) => s + (p.sessions || 0), 0))}</div>
                      <div className="at-kpi-label">All landing page visitors</div>
                    </div>
                    <div className="at-kpi" style={{ '--kpi-color': '#16A34A' }}>
                      <div className="at-kpi-eyebrow">Total Revenue</div>
                      <div className="at-kpi-value">{fmt.compact(pages.reduce((s, p) => s + (p.revenue || 0), 0))}</div>
                      <div className="at-kpi-label">From landing pages</div>
                    </div>
                    <div className="at-kpi" style={{ '--kpi-color': '#D97706' }}>
                      <div className="at-kpi-eyebrow">Avg Conv Rate</div>
                      <div className="at-kpi-value">{fmt.pct(pages.length > 0 ? pages.reduce((s, p) => s + (p.conversionRate || 0), 0) / pages.length : 0)}</div>
                      <div className="at-kpi-label">Visitors → orders</div>
                    </div>
                  </>
                )}
              </div>

              <div className="at-section"><span className="at-section-text">Landing Page Performance</span><span className="at-section-line" /></div>

              <div className="at-grid-2">
                <Card title="Conv Rate by Page" sub="Top converting landing pages (orders / unique visitors)" icon={OpenInNew} iconColor="#2563EB">
                  {first ? <Spinner h={280} /> : pages.length === 0 ? <Empty h={280} /> : (
                    <div>
                      {pages.slice(0, 8).map((p, i) => (
                        <div className="at-bar-row" key={i}>
                          <span className="at-bar-label" title={p._id}>{(p._id || '/').substring(0, 22)}</span>
                          <div className="at-bar-track">
                            <div className="at-bar-fill" style={{ width: `${Math.min(p.conversionRate || 0, 100)}%`, background: PAL[i % PAL.length] }} />
                          </div>
                          <span className="at-bar-val">{fmt.pct(p.conversionRate)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Revenue by Page" sub="Top earning landing pages" icon={BarChartIcon} iconColor="#16A34A">
                  {first ? <Spinner h={280} /> : pages.length === 0 ? <Empty h={280} /> : (
                    <div>
                      {pages.slice(0, 8).map((p, i) => {
                        const max = Math.max(...pages.map(x => x.revenue || 0)) || 1;
                        return (
                          <div className="at-bar-row" key={i}>
                            <span className="at-bar-label" title={p._id}>{(p._id || '/').substring(0, 22)}</span>
                            <div className="at-bar-track">
                              <div className="at-bar-fill" style={{ width: `${(p.revenue / max) * 100}%`, background: PAL[i % PAL.length] }} />
                            </div>
                            <span className="at-bar-val">{fmt.compact(p.revenue)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>

              <div className="at-row">
                <Card title="Landing Page Table" sub="All pages: visitors, orders, revenue, conversion rate" icon={TableChart} iconColor="#0891B2">
                  {first ? <Spinner h={200} /> : pages.length === 0 ? <Empty /> : (
                    <div className="at-tbl-wrap">
                      <table className="at-tbl">
                        <thead><tr><th>#</th><th>Page</th><th>Visitors</th><th>Orders</th><th>Revenue</th><th>Conv Rate</th><th>Rev/Visitor</th></tr></thead>
                        <tbody>
                          {pages.map((p, i) => (
                            <tr key={i}>
                              <td className="at-td-rank">{i + 1}</td>
                              <td><span className="at-url" title={p._id}>{p._id}</span></td>
                              <td>{fmt.number(p.sessions)}</td>
                              <td>{fmt.number(p.orders)}</td>
                              <td className="at-td-money">{fmt.compact(p.revenue)}</td>
                              <td className="at-td-accent">{fmt.pct(p.conversionRate)}</td>
                              <td className="at-td-mono">{fmt.currency((p.revenue || 0) / (p.sessions || 1))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}