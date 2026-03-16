import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  BarChart as BarChartIcon,
  AttachMoney,
  ShoppingCart,
  People,
  TrendingUp,
  ArrowBack,
  Inventory2,
  KeyboardArrowRight,
  Refresh,
  ArrowUpward,
  ArrowDownward,
  Remove,
  CheckCircleOutline,
  Warning,
  ErrorOutline,
  InfoOutlined,
} from '@mui/icons-material';
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  fetchDashboardKPIs,
  fetchRevenueTrends,
  fetchTopPerformers,
  fetchDashboardAlerts,
  setActiveTimeframe,
} from '../features/analytics/dashboardSlice';
 
import {
  fetchCategoryPerformance,
} from '../features/analytics/operationsSlice';
import {fetchChannelPerformance} from '../features/analytics/attributionSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/AnalyticsOverview.css';

// ── Formatters ───────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(v || 0),
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct: (v) => `${(v || 0).toFixed(1)}%`,
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
};

// ── Shared atoms ─────────────────────────────────────────────
function TrendBadge({ value }) {
  if (value === undefined || value === null)
    return <span className="ao-badge ao-badge--flat">—</span>;
  if (value === 0)
    return (
      <span className="ao-badge ao-badge--flat">
        <Remove style={{ fontSize: 10 }} />0%
      </span>
    );
  const pos = value > 0;
  return (
    <span className={`ao-badge ${pos ? 'ao-badge--pos' : 'ao-badge--neg'}`}>
      {pos
        ? <ArrowUpward style={{ fontSize: 10 }} />
        : <ArrowDownward style={{ fontSize: 10 }} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Spinner({ h = 200 }) {
  return (
    <div className="ao-loading" style={{ height: h }}>
      <div className="ao-spinner" />
      <span>Loading…</span>
    </div>
  );
}

function Empty({ label = 'No data available', h = 180 }) {
  return (
    <div className="ao-empty" style={{ minHeight: h }}>
      <BarChartIcon style={{ fontSize: 36, color: '#D1D5DB' }} />
      <span>{label}</span>
    </div>
  );
}

function Card({ title, sub, action, flush, children }) {
  return (
    <div className="ao-card">
      <div className="ao-card-hd">
        <div>
          <h3 className="ao-card-title">{title}</h3>
          {sub && <p className="ao-card-sub">{sub}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? 'ao-card-body--np' : 'ao-card-body'}>{children}</div>
    </div>
  );
}

// Recharts tooltip style
const TOOLTIP = {
  contentStyle: {
    background: '#fff', border: '1px solid #D1D5DB',
    borderRadius: 8, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  },
};

const PALETTE = ['#6366F1','#10B981','#F59E0B','#EF4444','#06B6D4','#8B5CF6','#F97316','#14B8A6'];

// ── KPI Card ─────────────────────────────────────────────────
function KPICard({ label, value, prev, change, icon: Icon, color, prevLabel }) {
  return (
    <div className="ao-kpi" style={{ '--kpi-color': color }}>
      <div className="ao-kpi-top">
        <span className="ao-kpi-icon" style={{ background: color + '18', color }}>
          <Icon style={{ fontSize: 20 }} />
        </span>
        <TrendBadge value={change} />
      </div>
      <div className="ao-kpi-label">{label}</div>
      <div className="ao-kpi-value">{value}</div>
      {prev !== undefined && (
        <div className="ao-kpi-footer">
          <span className="ao-kpi-prev">{prevLabel ?? 'Prev:'} {prev}</span>
        </div>
      )}
    </div>
  );
}

// KPI skeleton
function KPISkeleton() {
  return (
    <div className="ao-kpi" style={{ '--kpi-color': '#E5E7EB' }}>
      <div className="ao-kpi-top">
        <div className="ao-skel" style={{ width: 40, height: 40, borderRadius: 10 }} />
        <div className="ao-skel" style={{ width: 52, height: 20 }} />
      </div>
      <div className="ao-skel" style={{ width: '55%', height: 12, marginBottom: 8 }} />
      <div className="ao-skel" style={{ width: '75%', height: 28 }} />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function AnalyticsOverview() {
  const dispatch  = useDispatch();
    const {
      kpis,
      revenueTrends,
      topPerformers,
      alerts,
    } = useSelector((s) => s.dashboard);
    
    const {
      categoryPerformance,
      channelPerformance,
    } = useSelector((s) => s.operations);

  const [timeframe,  setTimeframe]  = useState('month');
  const [hasFetched, setHasFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);

  // ── Fetch ────────────────────────────────────────────────
  const load = useCallback((tf) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setHasFetched(false);
    setRefreshing(true);

    Promise.allSettled([
      dispatch(fetchDashboardKPIs(tf)),
      dispatch(fetchRevenueTrends({ timeframe: tf, groupBy: 'day' })),
      dispatch(fetchTopPerformers(tf)),
      dispatch(fetchCategoryPerformance(tf)),
      dispatch(fetchChannelPerformance(tf)),
      dispatch(fetchDashboardAlerts()),
    ]).finally(() => {
      loadingRef.current = false;
      setHasFetched(true);
      setRefreshing(false);
    });
  }, [dispatch]);

  useEffect(() => { load('month'); }, []); // eslint-disable-line

  const handleTf = (tf) => {
    if (tf === timeframe) return;
    setTimeframe(tf);
    load(tf);
  };

  // ── Derived data with EXACT controller field names ────────

  // revenue trends: data[].date, .revenue, .orders, .cumulativeRevenue
  const trendData  = revenueTrends?.data || [];
  const trendSummary = revenueTrends?.summary || {};

  // categoryPerformance.categories[].category (not "name")
  const catData = categoryPerformance?.categories || [];
  const catMax  = catData.length ? Math.max(...catData.map((c) => c.revenue)) : 1;

  // channelPerformance.channels[].source (not "channel" or "name")
  const chData = channelPerformance?.channels || [];

  // topPerformers.products[].name, .revenue, .salesCount
  const topProducts = topPerformers?.products || [];

  // alerts[].type, .category, .message, .priority, .timeAgo
  const alertList = Array.isArray(alerts) ? alerts : [];

  // Period comparison rows — using exact kpis field names
  const cmpRows = hasFetched && kpis ? [
    { label: 'Revenue',    cur: fmt.compact(kpis.revenue?.current),         prev: fmt.compact(kpis.revenue?.previous),         change: kpis.revenue?.change },
    { label: 'Orders',     cur: fmt.number(kpis.orders?.current),           prev: fmt.number(kpis.orders?.previous),           change: kpis.orders?.change },
    { label: 'Customers',  cur: fmt.number(kpis.customers?.current),        prev: fmt.number(kpis.customers?.previous),        change: kpis.customers?.change },
    // controller field is averageOrderValue (not aov)
    { label: 'Avg Order',  cur: fmt.currency(kpis.averageOrderValue?.current), prev: fmt.currency(kpis.averageOrderValue?.previous), change: kpis.averageOrderValue?.change },
    { label: 'Conv. Rate', cur: fmt.pct(kpis.conversionRate?.current),      prev: '—',                                         change: null },
  ] : [];

  return (
    <>
      <Navbar />
      <div className="ao-page">
        <div className="ao-body">

          {/* ── Header ─────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="ao-back-btn">
                    <ArrowBack style={{ fontSize: 16 }} />
                    Dashboard
                </Link>
                
          <div className="ao-hd">
            <div className="ao-hd-left">

              <span className="ao-hd-icon" style={{ background: '#8B5CF615', color: '#8B5CF6' }}>
                <BarChartIcon style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="ao-hd-title">Analytics Overview</h1>
                <p className="ao-hd-sub">Business performance at a glance</p>
              </div>
            </div>

           

            <div className="ao-hd-right">
              <div className="ao-tf">
                {['day','week','month','quarter','year'].map((t) => (
                  <button
                    key={t}
                    className={`ao-tf-btn ${timeframe === t ? 'ao-tf-btn--active' : ''}`}
                    onClick={() => handleTf(t)}
                    disabled={refreshing}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <button
                className={`ao-icon-btn ${refreshing ? 'ao-icon-btn--spin' : ''}`}
                onClick={() => load(timeframe)}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {/* ── KPI Cards ───────────────────────────────────── */}
          <div className="ao-kpi-grid">
            {!hasFetched ? (
              Array.from({ length: 6 }).map((_, i) => <KPISkeleton key={i} />)
            ) : (
              <>
                <KPICard
                  label="Total Revenue"
                  value={fmt.compact(kpis?.revenue?.current)}
                  prev={fmt.compact(kpis?.revenue?.previous)}
                  change={kpis?.revenue?.change}
                  icon={AttachMoney} color="#10B981"
                />
                <KPICard
                  label="Total Orders"
                  value={fmt.number(kpis?.orders?.current)}
                  prev={fmt.number(kpis?.orders?.previous)}
                  change={kpis?.orders?.change}
                  icon={ShoppingCart} color="#3B82F6"
                />
                <KPICard
                  label="New Customers"
                  value={fmt.number(kpis?.customers?.current)}
                  prev={fmt.number(kpis?.customers?.previous)}
                  change={kpis?.customers?.change}
                  icon={People} color="#8B5CF6"
                />
                {/* controller field: kpis.averageOrderValue — NOT kpis.aov */}
                <KPICard
                  label="Avg Order Value"
                  value={fmt.currency(kpis?.averageOrderValue?.current)}
                  prev={fmt.currency(kpis?.averageOrderValue?.previous)}
                  change={kpis?.averageOrderValue?.change}
                  icon={AttachMoney} color="#F59E0B"
                />
                <KPICard
                  label="Conversion Rate"
                  value={fmt.pct(kpis?.conversionRate?.current)}
                  prev={kpis?.conversionRate?.description}
                  change={null}
                  icon={TrendingUp} color="#06B6D4"
                />
                <KPICard
                  label="Avg Lifetime Value"
                  value={fmt.currency(kpis?.customerLifetimeValue?.average)}
                  prev={`Per customer: ${fmt.currency(kpis?.revenuePerCustomer?.current)}`}
                  change={null}
                  icon={People} color="#EF4444"
                />
              </>
            )}
          </div>

          {/* ── Revenue Trend + Period Comparison ───────────── */}
          <div className="ao-section">
            <span className="ao-section-text">Revenue</span>
            <span className="ao-section-line" />
          </div>

          <div className="ao-grid-2-1">
            {/* Revenue area chart */}
            <Card title="Revenue Trend" sub={`Daily breakdown — ${timeframe} view`}>
              {!hasFetched ? <Spinner h={280} /> : trendData.length === 0 ? (
                <Empty label="No revenue data for this period" h={280} />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.12} />
                          <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gOrd" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#10B981" stopOpacity={0.12} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip
                        {...TOOLTIP}
                        formatter={(v, name) => [
                          name === 'revenue' ? fmt.currency(v) : fmt.number(v),
                          name === 'revenue' ? 'Revenue' : 'Orders',
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Area type="monotone" dataKey="revenue" stroke="#6366F1" strokeWidth={2} fill="url(#gRev)" dot={false} />
                      <Area type="monotone" dataKey="orders"  stroke="#10B981" strokeWidth={2} fill="url(#gOrd)" dot={false} yAxisId="right" />
                    </AreaChart>
                  </ResponsiveContainer>
                  {/* summary from revenueTrends.summary */}
                  <div className="ao-summary-bar" style={{ margin: '0 -20px -18px' }}>
                    <div className="ao-summary-item">
                      <div className="ao-summary-label">Total Revenue</div>
                      <div className="ao-summary-val">{fmt.compact(trendSummary.totalRevenue)}</div>
                    </div>
                    <div className="ao-summary-item">
                      <div className="ao-summary-label">Total Orders</div>
                      <div className="ao-summary-val">{fmt.number(trendSummary.totalOrders)}</div>
                    </div>
                    <div className="ao-summary-item">
                      <div className="ao-summary-label">Avg Daily</div>
                      <div className="ao-summary-val">{fmt.compact(trendSummary.avgDailyRevenue)}</div>
                    </div>
                  </div>
                </>
              )}
            </Card>

            {/* Period comparison */}
            <Card title="Period Comparison" sub="vs previous period">
              {!hasFetched ? <Spinner h={280} /> : cmpRows.length === 0 ? (
                <Empty label="No comparison data" h={280} />
              ) : (
                <div>
                  <div className="ao-cmp-hd">
                    <span>Metric</span><span>Current</span><span>Previous</span><span>Change</span>
                  </div>
                  {cmpRows.map((row) => (
                    <div className="ao-cmp-row" key={row.label}>
                      <span className="ao-cmp-metric">{row.label}</span>
                      <span className="ao-cmp-cur">{row.cur}</span>
                      <span className="ao-cmp-prev">{row.prev}</span>
                      <TrendBadge value={row.change} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── Category Performance ─────────────────────────── */}
          <div className="ao-section">
            <span className="ao-section-text">Categories</span>
            <span className="ao-section-line" />
          </div>

          <div className="ao-grid-2">
            {/* Horizontal bar chart — uses categoryPerformance.categories[].category */}
            <Card title="Revenue by Category" sub="Sorted by revenue">
              {!hasFetched ? <Spinner h={260} /> : catData.length === 0 ? (
                <Empty label="No category data" h={260} />
              ) : (
                <div>
                  {catData.slice(0, 8).map((cat, i) => {
                    const pct = catMax > 0 ? (cat.revenue / catMax) * 100 : 0;
                    return (
                      <div className="ao-bar-row" key={cat.category}>
                        <span className="ao-bar-label" title={cat.category}>{cat.category}</span>
                        <div className="ao-bar-track">
                          <div
                            className="ao-bar-fill"
                            style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }}
                          />
                        </div>
                        <span className="ao-bar-val">{fmt.compact(cat.revenue)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Category orders chart */}
            <Card title="Orders by Category" sub="Volume this period">
              {!hasFetched ? <Spinner h={260} /> : catData.length === 0 ? (
                <Empty label="No category order data" h={260} />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={catData.slice(0, 8)} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
                    {/* dataKey uses "category" — exact field from controller */}
                    <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: '#374151' }} width={100} />
                    <Tooltip {...TOOLTIP} formatter={(v) => [fmt.number(v), 'Orders']} />
                    <Bar dataKey="orders" radius={[0, 4, 4, 0]}>
                      {catData.slice(0, 8).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ── Top Products Table ───────────────────────────── */}
          <div className="ao-section">
            <span className="ao-section-text">Top Products</span>
            <span className="ao-section-line" />
          </div>

          <div className="ao-row">
            <Card
              title="Best Performing Products"
              sub={`Top sellers this ${timeframe}`}
              action={
                <Link to="/admin/products" className="ao-link-btn">
                  View All <KeyboardArrowRight style={{ fontSize: 15 }} />
                </Link>
              }
            >
              {!hasFetched ? <Spinner h={200} /> : topProducts.length === 0 ? (
                <Empty label="No product data" />
              ) : (
                <div className="ao-tbl-wrap">
                  <table className="ao-tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Product Name</th>
                        <th>Units Sold</th>
                        <th>Revenue</th>
                        <th>Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* topPerformers.products[].name, .revenue, .salesCount, .growth */}
                      {topProducts.slice(0, 10).map((p, i) => (
                        <tr key={p._id || i}>
                          <td className="ao-td-rank">{i + 1}</td>
                          <td className="ao-td-name">{p.name}</td>
                          <td>{fmt.number(p.salesCount)}</td>
                          <td className="ao-td-money">{fmt.compact(p.revenue)}</td>
                          <td><TrendBadge value={p.growth} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* ── Channel Performance + Alerts ────────────────── */}
          <div className="ao-section">
            <span className="ao-section-text">Channels & Alerts</span>
            <span className="ao-section-line" />
          </div>

          <div className="ao-grid-2">
            {/* Channel table — uses .source field from controller */}
            <Card
              title="Channel Performance"
              sub="Revenue by acquisition source"
              action={
                <Link to="/admin/attribution" className="ao-link-btn">
                  Details <KeyboardArrowRight style={{ fontSize: 15 }} />
                </Link>
              }
            >
              {!hasFetched ? <Spinner h={200} /> : chData.length === 0 ? (
                <Empty label="No channel data" />
              ) : (
                <>
                  <div className="ao-tbl-wrap">
                    <table className="ao-tbl">
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Orders</th>
                          <th>Revenue</th>
                          <th>Avg Order</th>
                          <th>Customers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* channels[].source — exact field name from controller */}
                        {chData.map((ch, i) => (
                          <tr key={ch.source || i}>
                            <td>
                              <span className="ao-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                              {ch.source || 'Direct'}
                            </td>
                            <td>{fmt.number(ch.orders)}</td>
                            <td className="ao-td-money">{fmt.compact(ch.revenue)}</td>
                            <td>{fmt.currency(ch.avgOrderValue)}</td>
                            <td>{fmt.number(ch.uniqueCustomers)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* channelPerformance.summary */}
                  {channelPerformance?.summary && (
                    <div className="ao-summary-bar" style={{ margin: '18px -20px -18px' }}>
                      <div className="ao-summary-item">
                        <div className="ao-summary-label">Total Revenue</div>
                        <div className="ao-summary-val">{fmt.compact(channelPerformance.summary.totalRevenue)}</div>
                      </div>
                      <div className="ao-summary-item">
                        <div className="ao-summary-label">Total Orders</div>
                        <div className="ao-summary-val">{fmt.number(channelPerformance.summary.totalOrders)}</div>
                      </div>
                      <div className="ao-summary-item">
                        <div className="ao-summary-label">Customers</div>
                        <div className="ao-summary-val">{fmt.number(channelPerformance.summary.totalCustomers)}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* Alerts */}
            <Card
              title="Active Alerts"
              sub={`${alertList.length} alert${alertList.length !== 1 ? 's' : ''} require attention`}
            >
              {!hasFetched ? <Spinner h={200} /> : alertList.length === 0 ? (
                <div className="ao-no-alerts">
                  <CheckCircleOutline style={{ fontSize: 36, color: '#10B981' }} />
                  <span>All clear — no active alerts</span>
                </div>
              ) : (
                <div>
                  {alertList.slice(0, 6).map((al, i) => (
                    <div className="ao-alert" key={i}>
                      <span className={`ao-alert-dot ao-alert-dot--${al.priority}`} />
                      <div className="ao-alert-body">
                        <div className="ao-alert-msg">{al.message}</div>
                        <div className="ao-alert-meta">
                          <span className="ao-alert-cat">{al.category}</span>
                          <span className="ao-alert-time">{al.timeAgo}</span>
                        </div>
                      </div>
                      <span className={`ao-alert-chip ao-alert-chip--${al.priority}`}>
                        {al.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── Additional KPI Metrics ───────────────────────── */}
          <div className="ao-section">
            <span className="ao-section-text">Additional Metrics</span>
            <span className="ao-section-line" />
          </div>

          <div className="ao-grid-3">
            <Card title="Revenue Targets" sub="Current vs goal">
              {!hasFetched ? <Spinner h={150} /> : !kpis ? (
                <Empty label="No target data" h={150} />
              ) : (
                <div>
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Revenue Target</span>
                    <span className="ao-metric-val">{fmt.compact(kpis.revenue?.target)}</span>
                  </div>
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Orders Target</span>
                    <span className="ao-metric-val">{fmt.number(kpis.orders?.target)}</span>
                  </div>
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Revenue Achievement</span>
                    <span className="ao-metric-val">
                      {kpis.revenue?.target > 0
                        ? fmt.pct((kpis.revenue.current / kpis.revenue.target) * 100)
                        : '—'}
                    </span>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Customer Value" sub="Lifetime & per-order metrics">
              {!hasFetched ? <Spinner h={150} /> : !kpis ? (
                <Empty label="No CLV data" h={150} />
              ) : (
                <div>
                  {/* kpis.customerLifetimeValue.average */}
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Avg Lifetime Value</span>
                    <span className="ao-metric-val">{fmt.currency(kpis.customerLifetimeValue?.average)}</span>
                  </div>
                  {/* kpis.revenuePerCustomer.current */}
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Revenue / Customer</span>
                    <span className="ao-metric-val">{fmt.currency(kpis.revenuePerCustomer?.current)}</span>
                  </div>
                  {/* kpis.averageOrderValue — correct field name */}
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Avg Order Value</span>
                    <span className="ao-metric-val">{fmt.currency(kpis.averageOrderValue?.current)}</span>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Conversion" sub="Checkout & conversion signals">
              {!hasFetched ? <Spinner h={150} /> : !kpis ? (
                <Empty label="No conversion data" h={150} />
              ) : (
                <div>
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Conversion Rate</span>
                    <span className="ao-metric-val">{fmt.pct(kpis.conversionRate?.current)}</span>
                  </div>
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Basis</span>
                    <span className="ao-metric-val ao-td-muted" style={{ fontSize: 12 }}>
                      {kpis.conversionRate?.description || '—'}
                    </span>
                  </div>
                  <div className="ao-metric-row">
                    <span className="ao-metric-label">Active Alerts</span>
                    <span className={`ao-metric-val ${alertList.filter(a => a.priority === 'critical').length > 0 ? 'ao-td-red' : ''}`}>
                      {alertList.length}
                      {alertList.filter((a) => a.priority === 'critical').length > 0 &&
                        ` (${alertList.filter((a) => a.priority === 'critical').length} critical)`}
                    </span>
                  </div>
                </div>
              )}
            </Card>
          </div>

        </div>
      </div>
    </>
  );
}