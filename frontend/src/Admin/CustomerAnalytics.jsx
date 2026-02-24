import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  People,
  ArrowBack,
  Refresh,
  ArrowUpward,
  ArrowDownward,
  Remove,
  Star,
  Warning,
  TrendingUp,
  TrendingDown,
  PersonSearch,
  Loyalty,
  Group,
  WorkspacePremium,
  Timeline,
  Psychology,
  CampaignOutlined,
  CheckCircleOutline,
  ShoppingCart,
  AttachMoney,
  ErrorOutline,
} from '@mui/icons-material';
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchCustomerOverview,
  fetchSegmentDistribution,
  fetchHighValueCustomers,
  fetchAtRiskCustomers,
  fetchVIPCustomers,
  fetchCLVDistribution,
  fetchCustomersNeedingAttention,
  fetchCustomerCohorts,
  fetchRepeatPurchaseAnalytics,
  fetchPurchaseFrequencyAnalytics,
  fetchAcquisitionSourceAnalytics,
} from '../features/analytics/analyticsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CustomerAnalytics.css';

// ── Palette ──────────────────────────────────────────────────
const PAL = ['#6366F1','#10B981','#F59E0B','#EF4444','#06B6D4','#8B5CF6','#F97316','#14B8A6'];

// ── Formatters ───────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:  (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:     (v) => `${(v || 0).toFixed(1)}%`,
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  month: (year, month) => {
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  },
};

// ── Trend badge ──────────────────────────────────────────────
function TrendBadge({ value }) {
  if (value === undefined || value === null)
    return <span className="ca-badge ca-badge--flat">—</span>;
  if (value === 0)
    return (
      <span className="ca-badge ca-badge--flat">
        <Remove style={{ fontSize: 10 }} />0%
      </span>
    );
  const pos = value > 0;
  return (
    <span className={`ca-badge ${pos ? 'ca-badge--pos' : 'ca-badge--neg'}`}>
      {pos ? <ArrowUpward style={{ fontSize: 10 }} /> : <ArrowDownward style={{ fontSize: 10 }} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ── Spinner ──────────────────────────────────────────────────
function Spinner({ h = 200 }) {
  return (
    <div className="ca-loading" style={{ minHeight: h }}>
      <div className="ca-spinner" />
      <span>Loading…</span>
    </div>
  );
}

// ── Empty ────────────────────────────────────────────────────
function Empty({ label = 'No data available', h = 160 }) {
  return (
    <div className="ca-empty" style={{ minHeight: h }}>
      <People style={{ fontSize: 38, color: '#CBD5E1' }} />
      <span>{label}</span>
    </div>
  );
}

// ── KPI Skeleton ─────────────────────────────────────────────
function KpiSkel() {
  return (
    <div className="ca-kpi-skel">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="ca-skel" style={{ width: 42, height: 42, borderRadius: 11 }} />
        <div className="ca-skel" style={{ width: 54, height: 22 }} />
      </div>
      <div className="ca-skel" style={{ width: '55%', height: 11, marginBottom: 8 }} />
      <div className="ca-skel" style={{ width: '75%', height: 28 }} />
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────
function Card({ title, sub, icon: Icon, iconColor, action, flush, footer, children }) {
  return (
    <div className="ca-card">
      <div className="ca-card-hd">
        <div className="ca-card-hd-left">
          {Icon && (
            <span className="ca-card-icon" style={{ background: iconColor + '18', color: iconColor }}>
              <Icon style={{ fontSize: 18 }} />
            </span>
          )}
          <div>
            <h3 className="ca-card-title">{title}</h3>
            {sub && <p className="ca-card-sub">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={flush ? 'ca-card-body--np' : 'ca-card-body'}>{children}</div>
      {footer && <div className="ca-card-footer">{footer}</div>}
    </div>
  );
}

// ── Recharts tooltip style ───────────────────────────────────
const TT = {
  contentStyle: {
    background: '#FFFFFF',
    border: '1px solid #D1D5DB',
    borderRadius: 8,
    fontSize: 13,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    color: '#374151',
  },
  labelStyle: { color: '#111827', fontWeight: 700 },
};

// ── Bar chart icon (SVG) ─────────────────────────────────────
function BarChartIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor" {...props}>
      <path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>
    </svg>
  );
}

// ── View tabs config ─────────────────────────────────────────
const VIEWS = [
  { key: 'overview',    label: 'Overview',   icon: People },
  { key: 'segments',    label: 'Segments',   icon: Group },
  { key: 'highvalue',   label: 'High Value', icon: WorkspacePremium },
  { key: 'atrisk',      label: 'At Risk',    icon: Warning },
  { key: 'vip',         label: 'VIP',        icon: Star },
  { key: 'retention',   label: 'Retention',  icon: Loyalty },
  { key: 'cohorts',     label: 'Cohorts',    icon: Timeline },
  { key: 'acquisition', label: 'Acquisition',icon: CampaignOutlined },
];

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function CustomerAnalytics() {
  const dispatch = useDispatch();
  const {
    customerOverview,
    segmentDistribution,
    highValueCustomers,
    atRiskCustomers,
    vipCustomers,
    clvDistribution,
    customersNeedingAttention,
    customerCohorts,
    repeatPurchaseAnalytics,
    purchaseFrequencyAnalytics,
    acquisitionSources,
    error,
  } = useSelector((s) => s.analytics);

  const [activeView, setActiveView] = useState('overview');
  const [hasFetched, setHasFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);

  // ── Load all customer analytics data ────────────────────
  const loadAll = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setHasFetched(false);
    setRefreshing(true);

    Promise.allSettled([
      dispatch(fetchCustomerOverview()),
      dispatch(fetchSegmentDistribution()),
      dispatch(fetchHighValueCustomers({ minRevenue: 1000, limit: 50 })),
      dispatch(fetchAtRiskCustomers({ limit: 100 })),
      dispatch(fetchVIPCustomers(50)),
      dispatch(fetchCLVDistribution()),
      dispatch(fetchCustomersNeedingAttention()),
      dispatch(fetchCustomerCohorts('month')),
      dispatch(fetchRepeatPurchaseAnalytics()),
      dispatch(fetchPurchaseFrequencyAnalytics()),
      dispatch(fetchAcquisitionSourceAnalytics()),
    ]).finally(() => {
      loadingRef.current = false;
      setHasFetched(true);
      setRefreshing(false);
    });
  }, [dispatch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, []);

  // ── Derived ──────────────────────────────────────────────
  const ov         = customerOverview || {};
  const segDist    = segmentDistribution?.distribution || [];
  const segTotal   = segmentDistribution?.totalCustomers || 1;
  const hvList     = Array.isArray(highValueCustomers) ? highValueCustomers : (highValueCustomers?.customers || []);
  const hvStats    = highValueCustomers?.stats || {};
  const arList     = Array.isArray(atRiskCustomers) ? atRiskCustomers : (atRiskCustomers?.customers || []);
  const arRisk     = atRiskCustomers?.byRiskLevel || {};
  const arRevAtRisk= atRiskCustomers?.revenueAtRisk || 0;
  const vipList    = Array.isArray(vipCustomers) ? vipCustomers : (vipCustomers?.customers || []);
  const vipStats   = vipCustomers?.stats || {};
  const clvDist    = clvDistribution?.distribution || [];
  const attnSummary= customersNeedingAttention?.summary || {};
  const cohorts    = customerCohorts?.cohorts || [];
  const rpa        = repeatPurchaseAnalytics || {};
  const pfOverall  = purchaseFrequencyAnalytics?.overall || {};
  const pfDist     = purchaseFrequencyAnalytics?.distribution || [];
  const pfMax      = pfDist.length ? Math.max(...pfDist.map(d => d.count || 0)) : 1;
  const srcList    = acquisitionSources?.sources || [];

  const first = !hasFetched;

  return (
    <>
      <Navbar />
      <div className="ca-page">
        <div className="ca-body">

          {/* ── Back ──────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="ca-back-btn">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* ── Header ────────────────────────────────────── */}
          <div className="ca-hd">
            <div className="ca-hd-left">
              <span className="ca-hd-icon">
                <PersonSearch style={{ fontSize: 26 }} />
              </span>
              <div>
                <h1 className="ca-hd-title">Customer Analytics</h1>
                <p className="ca-hd-sub">Segments · Lifetime value · Retention · Acquisition</p>
              </div>
            </div>
            <div className="ca-hd-right">
              <button
                className={`ca-icon-btn ${refreshing ? 'ca-icon-btn--spin' : ''}`}
                onClick={loadAll}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 19 }} />
              </button>
            </div>
          </div>

          {error && (
            <div className="ca-error">
              <ErrorOutline style={{ fontSize: 17 }} />
              {error}
            </div>
          )}

          {/* ── View tabs ─────────────────────────────────── */}
          <div className="ca-tabs">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`ca-tab ${activeView === key ? 'ca-tab--active' : ''}`}
                onClick={() => setActiveView(key)}
              >
                <Icon style={{ fontSize: 15 }} />
                {label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════
              OVERVIEW TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'overview' && (
            <div className="ca-panel">

              {/* KPI Grid */}
              <div className="ca-grid-4">
                {first ? Array.from({ length: 8 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="ca-kpi" style={{ '--kpi-color': '#3B82F6', '--kpi-bg': '#EFF6FF' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><People style={{ fontSize: 20 }} /></span>
                        <TrendBadge value={ov.newCustomersGrowth} />
                      </div>
                      <div className="ca-kpi-label">Total Customers</div>
                      <div className="ca-kpi-value">{fmt.number(ov.totalCustomers)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">New this period: {fmt.number(ov.newCustomers)}</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#10B981', '--kpi-bg': '#ECFDF5' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><CheckCircleOutline style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">Active Customers</div>
                      <div className="ca-kpi-value">{fmt.number(ov.activeCustomers)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">Last 90 days</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#8B5CF6', '--kpi-bg': '#EEF2FF' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><AttachMoney style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">Avg Lifetime Value</div>
                      <div className="ca-kpi-value">{fmt.currency(ov.avgLifetimeValue)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">Rev / Customer: {fmt.currency(ov.totalRevenue / (ov.totalCustomers || 1))}</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#F59E0B', '--kpi-bg': '#FFFBEB' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><ShoppingCart style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">Avg Order Value</div>
                      <div className="ca-kpi-value">{fmt.currency(ov.avgOrderValue)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">Avg orders: {(ov.avgOrders || 0).toFixed(1)}</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#F59E0B', '--kpi-bg': '#FFFBEB' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><Star style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">VIP Customers</div>
                      <div className="ca-kpi-value">{fmt.number(ov.vipCount)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">{fmt.pct((ov.vipCount / (ov.totalCustomers || 1)) * 100)} of total</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#EF4444', '--kpi-bg': '#FEF2F2' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><Warning style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">At-Risk Customers</div>
                      <div className="ca-kpi-value">{fmt.number(ov.atRiskCount)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">Needs immediate action</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#06B6D4', '--kpi-bg': '#ECFEFF' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><TrendingUp style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">Total Revenue</div>
                      <div className="ca-kpi-value">{fmt.compact(ov.totalRevenue)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">All time customer revenue</span>
                      </div>
                    </div>

                    <div className="ca-kpi" style={{ '--kpi-color': '#8B5CF6', '--kpi-bg': '#EEF2FF' }}>
                      <div className="ca-kpi-top">
                        <span className="ca-kpi-icon"><Psychology style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ca-kpi-label">Avg Orders / Customer</div>
                      <div className="ca-kpi-value">{(ov.avgOrders || 0).toFixed(1)}</div>
                      <div className="ca-kpi-footer">
                        <span className="ca-kpi-prev">Purchase frequency</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Segments + CLV distribution */}
              <div className="ca-section"><span className="ca-section-text">Segments &amp; Value</span><span className="ca-section-line" /></div>
              <div className="ca-grid-2">
                <Card title="Customer Segments" sub="RFM-based distribution" icon={Group} iconColor="#8B5CF6">
                  {first ? <Spinner h={220} /> : !(ov.segments?.length) ? <Empty /> : (
                    <div>
                      {(ov.segments || []).map((seg, i) => (
                        <div className="ca-bar-row" key={i}>
                          <span className="ca-bar-label" title={seg.name}>{seg.name}</span>
                          <div className="ca-bar-track">
                            <div className="ca-bar-fill" style={{ width: `${seg.percentage || 0}%`, background: PAL[i % PAL.length] }} />
                          </div>
                          <span className="ca-bar-pct">{fmt.pct(seg.percentage)}</span>
                          <span className="ca-bar-val">{fmt.number(seg.count)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="CLV Distribution" sub="Customers by lifetime value range" icon={AttachMoney} iconColor="#10B981">
                  {first ? <Spinner h={220} /> : clvDist.length === 0 ? <Empty /> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={clvDist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#64748B' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748B' }} />
                        <Tooltip {...TT} formatter={(v) => [fmt.number(v), 'Customers']} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {clvDist.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              {/* Attention needed */}
              <div className="ca-section"><span className="ca-section-text">Attention Needed</span><span className="ca-section-line" /></div>
              <div className="ca-grid-2">
                <Card title="Customers Needing Attention" sub="Categorized priority view" icon={Warning} iconColor="#EF4444">
                  {first ? <Spinner h={200} /> : !customersNeedingAttention ? <Empty /> : (
                    <div>
                      {[
                        { label: 'Total Needing Attention', val: customersNeedingAttention.totalNeedingAttention, color: '#EF4444' },
                        { label: 'At Risk',                 val: attnSummary.atRisk,           color: '#EF4444' },
                        { label: 'High Value At Risk',      val: attnSummary.highValueAtRisk,  color: '#F97316' },
                        { label: 'Cannot Lose Them',        val: attnSummary.cannotLoseThem,   color: '#F59E0B' },
                        { label: 'About to Sleep',          val: attnSummary.aboutToSleep,     color: '#8B5CF6' },
                        { label: 'Flagged for Review',      val: attnSummary.flaggedForReview, color: '#EC4899' },
                      ].map((item) => (
                        <div className="ca-metric-row" key={item.label}>
                          <span className="ca-metric-label">{item.label}</span>
                          <span className="ca-metric-val" style={{ color: item.color }}>{fmt.number(item.val)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Churn Risk Breakdown" sub="Distribution across risk levels" icon={TrendingDown} iconColor="#F97316">
                  {first ? <Spinner h={200} /> : !(ov.churnRisk?.length) ? <Empty /> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={(ov.churnRisk || []).map((r) => ({
                            name: r._id ? r._id.charAt(0).toUpperCase() + r._id.slice(1) : 'Unknown',
                            value: r.count || 0,
                          }))}
                          dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={{ stroke: '#D1D5DB' }}
                        >
                          {(ov.churnRisk || []).map((_, i) => (
                            <Cell key={i} fill={['#EF4444', '#F97316', '#F59E0B', '#10B981'][i % 4]} />
                          ))}
                        </Pie>
                        <Tooltip {...TT} formatter={(v) => [fmt.number(v), 'Customers']} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              SEGMENTS TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'segments' && (
            <div className="ca-panel">
              <div className="ca-section"><span className="ca-section-text">RFM Segment Distribution</span><span className="ca-section-line" /></div>

              <div className="ca-grid-2-1">
                <Card
                  title="Segment Breakdown"
                  sub={`${segDist.length} RFM segments · ${fmt.number(segmentDistribution?.totalCustomers)} total customers`}
                  icon={Group}
                  iconColor="#8B5CF6"
                >
                  {first ? <Spinner h={320} /> : segDist.length === 0 ? <Empty h={320} /> : (
                    <>
                      <div>
                        {segDist.map((seg, i) => {
                          const pct = segTotal > 0 ? (seg.count / segTotal) * 100 : 0;
                          return (
                            <div className="ca-bar-row" key={i}>
                              <span className="ca-bar-label" title={seg._id}>{seg._id || 'Unknown'}</span>
                              <div className="ca-bar-track">
                                <div className="ca-bar-fill" style={{ width: `${pct}%`, background: PAL[i % PAL.length] }} />
                              </div>
                              <span className="ca-bar-pct">{fmt.pct(pct)}</span>
                              <span className="ca-bar-val">{fmt.compact(seg.totalRevenue)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="ca-summary-bar" style={{ margin: '20px -22px -20px' }}>
                        <div className="ca-summary-item">
                          <div className="ca-summary-label">Total Customers</div>
                          <div className="ca-summary-val">{fmt.number(segmentDistribution?.totalCustomers)}</div>
                        </div>
                        <div className="ca-summary-item">
                          <div className="ca-summary-label">Total Revenue</div>
                          <div className="ca-summary-val">{fmt.compact(segmentDistribution?.totalRevenue)}</div>
                        </div>
                        <div className="ca-summary-item">
                          <div className="ca-summary-label">Segments</div>
                          <div className="ca-summary-val">{segDist.length}</div>
                        </div>
                      </div>
                    </>
                  )}
                </Card>

                <Card title="Revenue by Segment" sub="Top segments" icon={AttachMoney} iconColor="#10B981">
                  {first ? <Spinner h={320} /> : segDist.length === 0 ? <Empty h={320} /> : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart
                        data={segDist.slice(0, 8).map(s => ({
                          name: (s._id || '').split(' ').slice(-1)[0],
                          revenue: s.totalRevenue,
                          count: s.count,
                        }))}
                        layout="vertical"
                        margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#334155' }} width={72} />
                        <Tooltip {...TT} formatter={(v, n) => [n === 'revenue' ? fmt.compact(v) : fmt.number(v), n === 'revenue' ? 'Revenue' : 'Customers']} />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                          {segDist.slice(0, 8).map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              {/* Segment table */}
              <div className="ca-section"><span className="ca-section-text">Detailed Breakdown</span><span className="ca-section-line" /></div>
              <div className="ca-row">
                <Card title="Segment Table" sub="Revenue and order metrics per segment" icon={Group} iconColor="#8B5CF6">
                  {first ? <Spinner h={200} /> : segDist.length === 0 ? <Empty /> : (
                    <div className="ca-tbl-wrap">
                      <table className="ca-tbl">
                        <thead>
                          <tr><th>#</th><th>Segment</th><th>Customers</th><th>Total Revenue</th><th>Avg Revenue</th><th>Avg Orders</th></tr>
                        </thead>
                        <tbody>
                          {segDist.map((seg, i) => (
                            <tr key={i}>
                              <td className="ca-td-rank">{i + 1}</td>
                              <td><span className="ca-seg-pill">{seg._id || 'Unknown'}</span></td>
                              <td>{fmt.number(seg.count)}</td>
                              <td className="ca-td-money">{fmt.compact(seg.totalRevenue)}</td>
                              <td className="ca-td-mono">{fmt.currency(seg.avgRevenue)}</td>
                              {/* avgOrders not returned by getSegmentDistribution aggregation — shows 0 by design */}
                              <td className="ca-td-mono">{(seg.avgOrders || 0).toFixed(1)}</td>
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
              HIGH VALUE TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'highvalue' && (
            <div className="ca-panel">
              <div className="ca-grid-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {first ? Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="ca-kpi" style={{ '--kpi-color': '#3B82F6', '--kpi-bg': '#EFF6FF' }}>
                      <div className="ca-kpi-label">High Value Count</div>
                      <div className="ca-kpi-value">{fmt.number(highValueCustomers?.count || hvList.length)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#10B981', '--kpi-bg': '#ECFDF5' }}>
                      <div className="ca-kpi-label">Total Revenue</div>
                      <div className="ca-kpi-value">{fmt.compact(hvStats.totalRevenue)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#8B5CF6', '--kpi-bg': '#EEF2FF' }}>
                      <div className="ca-kpi-label">Avg Revenue</div>
                      <div className="ca-kpi-value">{fmt.currency(hvStats.avgRevenue)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#F59E0B', '--kpi-bg': '#FFFBEB' }}>
                      <div className="ca-kpi-label">Avg Orders</div>
                      <div className="ca-kpi-value">{(hvStats.avgOrders || 0).toFixed(1)}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="ca-section"><span className="ca-section-text">High Value Customers</span><span className="ca-section-line" /></div>
              <div className="ca-row">
                <Card
                  title="Top Spenders"
                  sub="Customers with lifetime value ≥ $1,000"
                  icon={WorkspacePremium}
                  iconColor="#3B82F6"
                  action={<span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>{fmt.number(highValueCustomers?.count || hvList.length)} customers</span>}
                >
                  {first ? <Spinner h={280} /> : hvList.length === 0 ? <Empty label="No high-value customers found" /> : (
                    <div className="ca-tbl-wrap">
                      <table className="ca-tbl">
                        <thead>
                          <tr><th>#</th><th>Customer</th><th>Email</th><th>Total Revenue</th><th>Total Orders</th><th>Avg Order</th><th>Segment</th></tr>
                        </thead>
                        <tbody>
                          {hvList.slice(0, 25).map((c, i) => {
                            const user = c.user || {};
                            const clv  = c.clv  || {};
                            const rfm  = c.rfm  || {};
                            return (
                              <tr key={i}>
                                <td className="ca-td-rank">{i + 1}</td>
                                <td className="ca-td-name">{user.firstName ? `${user.firstName} ${user.lastName}` : 'Unknown'}</td>
                                <td className="ca-td-email">{user.email || '—'}</td>
                                <td className="ca-td-money">{fmt.compact(clv.totalRevenue)}</td>
                                <td>{fmt.number(clv.totalOrders)}</td>
                                <td className="ca-td-mono">{fmt.currency(clv.averageOrderValue)}</td>
                                <td><span className="ca-seg-pill">{rfm.segment || '—'}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              AT RISK TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'atrisk' && (
            <div className="ca-panel">
              <div className="ca-grid-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {first ? Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="ca-kpi" style={{ '--kpi-color': '#EF4444', '--kpi-bg': '#FEF2F2' }}>
                      <div className="ca-kpi-label">Total At Risk</div>
                      <div className="ca-kpi-value">{fmt.number(atRiskCustomers?.count || arList.length)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#F97316', '--kpi-bg': '#FFF7ED' }}>
                      <div className="ca-kpi-label">Revenue at Risk</div>
                      <div className="ca-kpi-value">{fmt.compact(arRevAtRisk)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#EF4444', '--kpi-bg': '#FEF2F2' }}>
                      <div className="ca-kpi-label">Critical</div>
                      <div className="ca-kpi-value">{fmt.number(arRisk.critical)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#F59E0B', '--kpi-bg': '#FFFBEB' }}>
                      <div className="ca-kpi-label">High Risk</div>
                      <div className="ca-kpi-value">{fmt.number(arRisk.high)}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="ca-section"><span className="ca-section-text">Risk Breakdown</span><span className="ca-section-line" /></div>
              <div className="ca-grid-2">
                <Card title="Risk Level Summary" sub="Customers by churn risk level" icon={Warning} iconColor="#EF4444">
                  {first ? <Spinner h={200} /> : (
                    <div>
                      {[
                        { level: 'critical', label: 'Critical', color: '#EF4444', val: arRisk.critical },
                        { level: 'high',     label: 'High',     color: '#F97316', val: arRisk.high },
                        { level: 'medium',   label: 'Medium',   color: '#F59E0B', val: arRisk.medium },
                        { level: 'low',      label: 'Low',      color: '#10B981', val: arRisk.low },
                      ].map(({ level, label, color, val }) => (
                        <div className="ca-metric-row" key={level}>
                          <span className="ca-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                            {label} Risk
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className={`ca-risk-pill ca-risk-pill--${level}`}>{level}</span>
                            <span className="ca-metric-val" style={{ color }}>{fmt.number(val)}</span>
                          </div>
                        </div>
                      ))}
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Total Revenue at Risk</span>
                        <span className="ca-metric-val ca-metric-val--red">{fmt.compact(arRevAtRisk)}</span>
                      </div>
                    </div>
                  )}
                </Card>

                <Card title="At-Risk Distribution" sub="Visual breakdown" icon={TrendingDown} iconColor="#F97316">
                  {first ? <Spinner h={200} /> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Critical', value: arRisk.critical || 0, fill: '#EF4444' },
                            { name: 'High',     value: arRisk.high    || 0, fill: '#F97316' },
                            { name: 'Medium',   value: arRisk.medium  || 0, fill: '#F59E0B' },
                            { name: 'Low',      value: arRisk.low     || 0, fill: '#10B981' },
                          ].filter(d => d.value > 0)}
                          dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={{ stroke: '#D1D5DB' }}
                        >
                          {['#EF4444', '#F97316', '#F59E0B', '#10B981'].map((c, i) => <Cell key={i} fill={c} />)}
                        </Pie>
                        <Tooltip {...TT} formatter={(v) => [fmt.number(v), 'Customers']} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <div className="ca-section"><span className="ca-section-text">At-Risk Customers</span><span className="ca-section-line" /></div>
              <div className="ca-row">
                <Card title="At-Risk Customer List" sub="Sorted by revenue — act immediately on critical" icon={Warning} iconColor="#EF4444">
                  {first ? <Spinner h={280} /> : arList.length === 0 ? <Empty label="No at-risk customers — great news!" /> : (
                    <div className="ca-tbl-wrap">
                      <table className="ca-tbl">
                        <thead>
                          <tr><th>#</th><th>Customer</th><th>Email</th><th>Revenue</th><th>Orders</th><th>Risk Level</th><th>Segment</th></tr>
                        </thead>
                        <tbody>
                          {arList.slice(0, 30).map((c, i) => {
                            const user = c.user || {};
                            const clv  = c.clv  || {};
                            const rfm  = c.rfm  || {};
                            const risk = c.risk  || {};
                            return (
                              <tr key={i}>
                                <td className="ca-td-rank">{i + 1}</td>
                                <td className="ca-td-name">{user.firstName ? `${user.firstName} ${user.lastName}` : 'Unknown'}</td>
                                <td className="ca-td-email">{user.email || '—'}</td>
                                <td className="ca-td-money">{fmt.compact(clv.totalRevenue)}</td>
                                <td>{fmt.number(clv.totalOrders)}</td>
                                <td>
                                  <span className={`ca-risk-pill ca-risk-pill--${risk.churnPrediction || 'low'}`}>
                                    {risk.churnPrediction || '—'}
                                  </span>
                                </td>
                                <td><span className="ca-seg-pill">{rfm.segment || '—'}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              VIP TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'vip' && (
            <div className="ca-panel">
              <div className="ca-grid-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {first ? Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="ca-kpi" style={{ '--kpi-color': '#F59E0B', '--kpi-bg': '#FFFBEB' }}>
                      <div className="ca-kpi-label">VIP Count</div>
                      <div className="ca-kpi-value">{fmt.number(vipCustomers?.count || vipList.length)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#10B981', '--kpi-bg': '#ECFDF5' }}>
                      <div className="ca-kpi-label">VIP Revenue</div>
                      <div className="ca-kpi-value">{fmt.compact(vipStats.totalRevenue)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#3B82F6', '--kpi-bg': '#EFF6FF' }}>
                      <div className="ca-kpi-label">Avg VIP Revenue</div>
                      <div className="ca-kpi-value">{fmt.currency(vipStats.avgRevenue)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#8B5CF6', '--kpi-bg': '#EEF2FF' }}>
                      <div className="ca-kpi-label">Avg VIP Orders</div>
                      <div className="ca-kpi-value">{(vipStats.avgOrders || 0).toFixed(1)}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="ca-section"><span className="ca-section-text">VIP Customers</span><span className="ca-section-line" /></div>
              <div className="ca-row">
                <Card
                  title="VIP Customer Roster"
                  sub="Your highest value customers"
                  icon={Star}
                  iconColor="#F59E0B"
                  action={<span className="ca-vip-badge"><Star style={{ fontSize: 11 }} />{fmt.number(vipCustomers?.count || vipList.length)} VIPs</span>}
                >
                  {first ? <Spinner h={280} /> : vipList.length === 0 ? <Empty label="No VIP customers yet" /> : (
                    <div className="ca-tbl-wrap">
                      <table className="ca-tbl">
                        <thead>
                          <tr><th>#</th><th>Customer</th><th>Email</th><th>Total Revenue</th><th>Orders</th><th>AOV</th><th>Segment</th><th>VIP</th></tr>
                        </thead>
                        <tbody>
                          {vipList.slice(0, 25).map((c, i) => {
                            const user = c.user || {};
                            const clv  = c.clv  || {};
                            const rfm  = c.rfm  || {};
                            return (
                              <tr key={i}>
                                <td className="ca-td-rank">{i + 1}</td>
                                <td className="ca-td-name">{user.firstName ? `${user.firstName} ${user.lastName}` : 'Unknown'}</td>
                                <td className="ca-td-email">{user.email || '—'}</td>
                                <td className="ca-td-money">{fmt.compact(clv.totalRevenue)}</td>
                                <td>{fmt.number(clv.totalOrders)}</td>
                                <td className="ca-td-mono">{fmt.currency(clv.averageOrderValue)}</td>
                                <td><span className="ca-seg-pill">{rfm.segment || '—'}</span></td>
                                <td><span className="ca-vip-badge"><Star style={{ fontSize: 10 }} />VIP</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              RETENTION TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'retention' && (
            <div className="ca-panel">
              <div className="ca-section"><span className="ca-section-text">Purchase Behavior</span><span className="ca-section-line" /></div>
              <div className="ca-grid-3">
                <Card title="Repeat Purchase Analytics" sub="Customer loyalty indicators" icon={Loyalty} iconColor="#10B981">
                  {first ? <Spinner h={200} /> : !repeatPurchaseAnalytics ? <Empty h={200} /> : (
                    <div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">One-Time Customers</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="ca-metric-val">{fmt.number(rpa.oneTimeCustomers)}</span>
                          <span style={{ fontSize: 11, color: '#EF4444' }}>{fmt.pct(rpa.oneTimePercentage)}</span>
                        </div>
                      </div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Repeat Customers</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="ca-metric-val ca-metric-val--blue">{fmt.number(rpa.repeatCustomers)}</span>
                          <span style={{ fontSize: 11, color: '#3B82F6' }}>{fmt.pct(rpa.repeatPercentage)}</span>
                        </div>
                      </div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Loyal Customers (5+)</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="ca-metric-val ca-metric-val--green">{fmt.number(rpa.loyalCustomers)}</span>
                          <span style={{ fontSize: 11, color: '#10B981' }}>{fmt.pct(rpa.loyalPercentage)}</span>
                        </div>
                      </div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Avg Repeat Rate</span>
                        <span className="ca-metric-val">{fmt.pct(rpa.avgRepeatRate)}</span>
                      </div>
                    </div>
                  )}
                </Card>

                <Card title="Purchase Frequency" sub="Overall frequency metrics" icon={TrendingUp} iconColor="#8B5CF6">
                  {first ? <Spinner h={200} /> : !purchaseFrequencyAnalytics ? <Empty h={200} /> : (
                    <div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Avg Orders / Month</span>
                        <span className="ca-metric-val ca-metric-val--blue">{(pfOverall.avgFrequency || 0).toFixed(2)}</span>
                      </div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Avg Days Between Orders</span>
                        <span className="ca-metric-val">{Math.round(pfOverall.avgDaysBetweenPurchases || 0)} days</span>
                      </div>
                      <div className="ca-metric-row">
                        <span className="ca-metric-label">Purchase Cycle</span>
                        <span className="ca-metric-val ca-metric-val--amber">
                          {pfOverall.avgDaysBetweenPurchases > 0
                            ? `Every ${Math.round(pfOverall.avgDaysBetweenPurchases)} days`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>

                <Card title="Loyalty Ratio" sub="One-time vs repeat vs loyal" icon={Psychology} iconColor="#EC4899">
                  {first ? <Spinner h={200} /> : !repeatPurchaseAnalytics ? <Empty h={200} /> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'One-Time', value: rpa.oneTimeCustomers || 0 },
                            { name: 'Repeat',   value: rpa.repeatCustomers  || 0 },
                            { name: 'Loyal',    value: rpa.loyalCustomers   || 0 },
                          ].filter(d => d.value > 0)}
                          dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={{ stroke: '#D1D5DB' }}
                        >
                          {['#EF4444', '#3B82F6', '#10B981'].map((c, i) => <Cell key={i} fill={c} />)}
                        </Pie>
                        <Tooltip {...TT} formatter={(v) => [fmt.number(v), 'Customers']} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              {/* Frequency distribution */}
              <div className="ca-section"><span className="ca-section-text">Order Frequency Distribution</span><span className="ca-section-line" /></div>
              <div className="ca-grid-2">
                <Card title="Frequency Distribution" sub="Customers grouped by order count" icon={BarChartIcon} iconColor="#3B82F6">
                  {first ? <Spinner h={240} /> : pfDist.length === 0 ? <Empty h={240} /> : (
                    <div>
                      {pfDist.map((d, i) => (
                        <div className="ca-freq-row" key={i}>
                          <span className="ca-freq-label">{d.range}</span>
                          <div className="ca-freq-track">
                            <div className="ca-freq-fill" style={{ width: `${pfMax > 0 ? (d.count / pfMax) * 100 : 0}%`, background: PAL[i % PAL.length] }} />
                          </div>
                          <span className="ca-freq-count">{fmt.number(d.count)}</span>
                          <span className="ca-freq-rev">{fmt.compact(d.avgRevenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Avg Revenue by Frequency" sub="Higher frequency = higher CLV" icon={AttachMoney} iconColor="#10B981">
                  {first ? <Spinner h={240} /> : pfDist.length === 0 ? <Empty h={240} /> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart
                        data={pfDist.map(d => ({
                          name: d.range.replace(' orders', '').replace(' order', ''),
                          avgRev: Math.round(d.avgRevenue),
                          count: d.count,
                        }))}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip {...TT} formatter={(v, n) => [n === 'avgRev' ? fmt.currency(v) : fmt.number(v), n === 'avgRev' ? 'Avg Revenue' : 'Customers']} />
                        <Bar dataKey="avgRev" radius={[4, 4, 0, 0]}>
                          {pfDist.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              COHORTS TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'cohorts' && (
            <div className="ca-panel">
              <div className="ca-section"><span className="ca-section-text">Monthly Acquisition Cohorts</span><span className="ca-section-line" /></div>

              <div className="ca-grid-2-1">
                <Card title="Cohort Revenue Trend" sub="Monthly cohorts by acquisition month" icon={Timeline} iconColor="#3B82F6">
                  {first ? <Spinner h={300} /> : cohorts.length === 0 ? <Empty h={300} /> : (
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart
                        data={[...cohorts].reverse().map(c => ({
                          month: fmt.month(c._id?.year, c._id?.month),
                          customers: c.customers,
                          revenue: c.totalRevenue,
                          avgRevenue: c.avgRevenue,
                        }))}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="gCohortRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748B' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip {...TT} formatter={(v, n) => [
                          n === 'revenue' ? fmt.compact(v) : n === 'customers' ? fmt.number(v) : fmt.currency(v),
                          n === 'revenue' ? 'Revenue' : n === 'customers' ? 'Customers' : 'Avg Revenue',
                        ]} />
                        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8, color: '#64748B' }} />
                        <Area type="monotone" dataKey="revenue" stroke="#6366F1" strokeWidth={2} fill="url(#gCohortRev)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card title="Cohort Summary" sub="Last 12 months at a glance" icon={Group} iconColor="#8B5CF6">
                  {first ? <Spinner h={300} /> : cohorts.length === 0 ? <Empty h={300} /> : (
                    <div>
                      <div className="ca-cohort-hd ca-cohort-row">
                        <span>Month</span>
                        <span style={{ textAlign: 'right' }}>Customers</span>
                        <span style={{ textAlign: 'right' }}>Revenue</span>
                        <span style={{ textAlign: 'right' }}>Avg Rev</span>
                      </div>
                      {cohorts.slice(0, 12).map((c, i) => (
                        <div className="ca-cohort-row" key={i}>
                          <span className="ca-cohort-month">{fmt.month(c._id?.year, c._id?.month)}</span>
                          <span style={{ textAlign: 'right', color: '#3B82F6', fontWeight: 600 }}>{fmt.number(c.customers)}</span>
                          <span style={{ textAlign: 'right', color: '#10B981', fontWeight: 700, fontFamily: 'monospace', fontSize: 12.5 }}>{fmt.compact(c.totalRevenue)}</span>
                          <span style={{ textAlign: 'right', color: '#64748B', fontFamily: 'monospace', fontSize: 12 }}>{fmt.currency(c.avgRevenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Customers per cohort bar */}
              <div className="ca-section"><span className="ca-section-text">New Customers Per Month</span><span className="ca-section-line" /></div>
              <div className="ca-row">
                <Card title="Monthly Acquisition Volume" sub="New customers acquired each month" icon={People} iconColor="#10B981">
                  {first ? <Spinner h={240} /> : cohorts.length === 0 ? <Empty h={240} /> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart
                        data={[...cohorts].reverse().map(c => ({
                          month: fmt.month(c._id?.year, c._id?.month),
                          customers: c.customers,
                          avgOrders: Number((c.avgOrders || 0).toFixed(1)),
                        }))}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748B' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748B' }} />
                        <Tooltip {...TT} formatter={(v, n) => [fmt.number(v), n === 'customers' ? 'Customers' : 'Avg Orders']} />
                        <Bar dataKey="customers" radius={[4, 4, 0, 0]} fill="#6366F1" opacity={0.85} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              ACQUISITION TAB
          ══════════════════════════════════════════════ */}
          {activeView === 'acquisition' && (
            <div className="ca-panel">
              <div className="ca-grid-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {first ? Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />) : (
                  <>
                    <div className="ca-kpi" style={{ '--kpi-color': '#3B82F6', '--kpi-bg': '#EFF6FF' }}>
                      <div className="ca-kpi-label">Total Sources</div>
                      <div className="ca-kpi-value">{srcList.length}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#10B981', '--kpi-bg': '#ECFDF5' }}>
                      <div className="ca-kpi-label">Total Customers</div>
                      <div className="ca-kpi-value">{fmt.number(acquisitionSources?.totalCustomers)}</div>
                    </div>
                    <div className="ca-kpi" style={{ '--kpi-color': '#8B5CF6', '--kpi-bg': '#EEF2FF' }}>
                      <div className="ca-kpi-label">Total Revenue</div>
                      <div className="ca-kpi-value">{fmt.compact(acquisitionSources?.totalRevenue)}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="ca-section"><span className="ca-section-text">Acquisition Channels</span><span className="ca-section-line" /></div>
              <div className="ca-grid-2">
                <Card title="Revenue by Source" sub="Lifetime revenue attributed per channel" icon={CampaignOutlined} iconColor="#F59E0B">
                  {first ? <Spinner h={280} /> : srcList.length === 0 ? <Empty h={280} /> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={srcList.map(s => ({ name: s._id || 'Direct', revenue: s.totalRevenue, customers: s.customers }))}
                        layout="vertical"
                        margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#334155' }} width={72} />
                        <Tooltip {...TT} formatter={(v, n) => [n === 'revenue' ? fmt.compact(v) : fmt.number(v), n === 'revenue' ? 'Revenue' : 'Customers']} />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                          {srcList.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card title="ROI by Source" sub="Estimated ROI per acquisition channel" icon={TrendingUp} iconColor="#10B981">
                  {first ? <Spinner h={280} /> : srcList.length === 0 ? <Empty h={280} /> : (
                    <div>
                      {srcList.map((src, i) => (
                        <div className="ca-src-row" key={i}>
                          <span className="ca-dot" style={{ background: PAL[i % PAL.length] }} />
                          <span className="ca-src-name">{src._id || 'Direct'}</span>
                          <span className="ca-src-cust">{fmt.number(src.customers)}</span>
                          <span className="ca-src-rev">{fmt.compact(src.totalRevenue)}</span>
                          <span className={`ca-src-roi ${src.roi >= 0 ? 'ca-src-roi--pos' : 'ca-src-roi--neg'}`}>
                            {src.roi >= 0 ? '+' : ''}{(src.roi || 0).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="ca-section"><span className="ca-section-text">Source Performance Table</span><span className="ca-section-line" /></div>
              <div className="ca-row">
                <Card title="Detailed Source Metrics" sub="CLV, orders, and VIP customers per source" icon={CampaignOutlined} iconColor="#3B82F6">
                  {first ? <Spinner h={240} /> : srcList.length === 0 ? <Empty /> : (
                    <div className="ca-tbl-wrap">
                      <table className="ca-tbl">
                        <thead>
                          <tr><th>#</th><th>Source</th><th>Customers</th><th>Total Revenue</th><th>Avg CLV</th><th>Avg Orders</th><th>VIP Count</th><th>Est. ROI</th></tr>
                        </thead>
                        <tbody>
                          {srcList.map((src, i) => (
                            <tr key={i}>
                              <td className="ca-td-rank">{i + 1}</td>
                              <td>
                                <span className="ca-dot" style={{ background: PAL[i % PAL.length] }} />
                                <span style={{ fontWeight: 600, color: '#0F172A' }}>{src._id || 'Direct'}</span>
                              </td>
                              <td>{fmt.number(src.customers)}</td>
                              <td className="ca-td-money">{fmt.compact(src.totalRevenue)}</td>
                              <td className="ca-td-mono">{fmt.currency(src.avgCLV)}</td>
                              <td className="ca-td-mono">{(src.avgOrders || 0).toFixed(1)}</td>
                              <td>
                                {src.vipCount > 0
                                  ? <span className="ca-vip-badge"><Star style={{ fontSize: 10 }} />{src.vipCount}</span>
                                  : <span className="ca-td-muted">—</span>}
                              </td>
                              <td>
                                <span style={{ fontWeight: 700, color: src.roi >= 0 ? '#10B981' : '#EF4444', fontFamily: 'monospace', fontSize: 12.5 }}>
                                  {src.roi >= 0 ? '+' : ''}{(src.roi || 0).toFixed(0)}%
                                </span>
                              </td>
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