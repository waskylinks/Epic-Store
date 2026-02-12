import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import {
  Dashboard as DashboardIcon,
  TrendingUp, TrendingDown,
  ShoppingCart, People, Inventory,
  Assessment, Analytics,
  MoneyOff, Percent,
  AttachMoney, Menu, Close,
  LocalOffer, ShoppingBag,
  Warning, CheckCircle,
  Refresh, Category,
  ManageAccounts,
  KeyboardArrowRight,
  ReplayCircleFilled,
  Payment as Payments,
  LocalShipping,
  Security,
  FactCheck,
  BarChart,
  Storefront,
  CurrencyExchange,
  PersonSearch,
  DevicesOther,
  CampaignOutlined,
  ShoppingCartCheckout,
  ErrorOutline,
  ExpandLess,
  ExpandMore,
} from '@mui/icons-material';
import {
  LineChart, Line, BarChart as ReChart, Bar,
  PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchAdminStats,
  fetchDashboardKPIs,
  fetchRevenueTrends,
  fetchTopPerformers,
  fetchDashboardAlerts,
  fetchCustomerOverview,
  fetchChannelPerformance,
  fetchDevicePerformance,
  fetchCheckoutAbandonmentStats,
  fetchProductPerformanceOverview,
  fetchCategoryPerformance,
  fetchLowStockAlerts,
  fetchFulfillmentAnalytics,
  fetchFraudAnalytics,
  fetchSLABreaches,
  fetchReturnOverview,
  fetchRefundOverview,
} from '../features/analytics/analyticsSlice';
import '../AdminStyles/Dashboard.css';

// ─── Navigation Config ──────────────────────────────────────────────────────
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
      { path: '/admin/analytics',    icon: Analytics,         label: 'Overview',     color: '#8B5CF6' },
      { path: '/admin/reports',      icon: Assessment,         label: 'Reports',      color: '#EC4899' },
      { path: '/admin/customers',    icon: PersonSearch,       label: 'Customers',    color: '#06B6D4' },
      { path: '/admin/attribution',  icon: CampaignOutlined,   label: 'Attribution',  color: '#F59E0B' },
      { path: '/admin/checkout',     icon: ShoppingCartCheckout, label: 'Checkout',  color: '#10B981' },
    ],
  },
  {
    group: 'Commerce',
    items: [
      { path: '/admin/products', icon: Inventory,    label: 'Products', color: '#3B82F6' },
      { path: '/admin/orders',   icon: ShoppingCart, label: 'Orders',   color: '#F97316' },
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
      { path: '/admin/returns',   icon: ReplayCircleFilled, label: 'Returns',   color: '#EF4444' },
      { path: '/admin/refunds',   icon: CurrencyExchange,   label: 'Refunds',   color: '#14B8A6' },
      { path: '/admin/discounts', icon: Percent,            label: 'Discounts', color: '#84CC16' },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct: (v) => `${(v || 0).toFixed(1)}%`,
  compact: (v) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
    return fmt.currency(v);
  },
};

function TrendChip({ value }) {
  const isPos = value >= 0;
  return (
    <span className={`adm-chip ${isPos ? 'adm-chip--pos' : 'adm-chip--neg'}`}>
      {isPos ? <TrendingUp style={{ fontSize: 12 }} /> : <TrendingDown style={{ fontSize: 12 }} />}
      {isPos ? '+' : ''}{(value || 0).toFixed(1)}%
    </span>
  );
}

function SkeletonBlock({ h = 20, w = '100%', radius = 6, mb = 0 }) {
  return (
    <div
      className="adm-skeleton"
      style={{ height: h, width: w, borderRadius: radius, marginBottom: mb }}
    />
  );
}

function SectionSkeleton({ rows = 4 }) {
  return (
    <div className="adm-skeleton-section">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} h={60} radius={8} mb={12} w={`${70 + (i % 3) * 10}%`} />
      ))}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="adm-kpi-card">
      <SkeletonBlock h={40} w={40} radius={10} mb={12} />
      <SkeletonBlock h={14} w="60%" mb={8} />
      <SkeletonBlock h={28} w="80%" mb={10} />
      <SkeletonBlock h={10} w="40%" />
    </div>
  );
}

function MetricRow({ label, value, sub, accent }) {
  return (
    <div className="adm-metric-row">
      <div className="adm-metric-label">{label}</div>
      <div className="adm-metric-value" style={accent ? { color: accent } : {}}>{value}</div>
      {sub && <div className="adm-metric-sub">{sub}</div>}
    </div>
  );
}

function SectionCard({ title, subtitle, link, linkLabel = 'View All', children, icon: Icon, iconColor }) {
  return (
    <div className="adm-section-card">
      <div className="adm-section-card-hd">
        <div className="adm-section-card-hd-left">
          {Icon && (
            <span className="adm-section-icon" style={{ background: iconColor + '1a', color: iconColor }}>
              <Icon style={{ fontSize: 18 }} />
            </span>
          )}
          <div>
            <h3 className="adm-card-title">{title}</h3>
            {subtitle && <p className="adm-card-sub">{subtitle}</p>}
          </div>
        </div>
        {link && (
          <Link to={link} className="adm-view-link">
            {linkLabel} <KeyboardArrowRight style={{ fontSize: 16 }} />
          </Link>
        )}
      </div>
      <div className="adm-section-card-body">{children}</div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const dispatch = useDispatch();
  const location = useLocation();

  const {
    basicStats,
    kpis,
    revenueTrends,
    topPerformers,
    alerts,
    customerOverview,
    channelPerformance,
    devicePerformance,
    checkoutAbandonment,
    productPerformance,
    categoryPerformance,
    lowStockAlerts,
    fulfillmentAnalytics,
    fraudAnalytics,
    slaBreaches,
    returnOverview,
    refundOverview,
    loading,
    dashboardLoading,
    error,
  } = useSelector((s) => s.analytics);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [timeframe, setTimeframe] = useState('month');

  const loadAll = useCallback(() => {
    // Legacy stats endpoint
    dispatch(fetchAdminStats());
    // Dashboard
    dispatch(fetchDashboardKPIs(timeframe));
    dispatch(fetchRevenueTrends({ timeframe, groupBy: 'day' }));
    dispatch(fetchTopPerformers(timeframe));
    dispatch(fetchDashboardAlerts());
    // Customer
    dispatch(fetchCustomerOverview());
    // Attribution
    dispatch(fetchChannelPerformance(timeframe));
    dispatch(fetchDevicePerformance(timeframe));
    // Checkout
    dispatch(fetchCheckoutAbandonmentStats(timeframe));
    // Products
    dispatch(fetchProductPerformanceOverview(timeframe));
    dispatch(fetchCategoryPerformance(timeframe));
    dispatch(fetchLowStockAlerts());
    // Operations
    dispatch(fetchFulfillmentAnalytics(timeframe));
    dispatch(fetchFraudAnalytics(timeframe));
    dispatch(fetchSLABreaches(timeframe));
    // Returns & Refunds
    dispatch(fetchReturnOverview(timeframe));
    dispatch(fetchRefundOverview(timeframe));
  }, [dispatch, timeframe]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const isActive = (p) => location.pathname === p || location.pathname.startsWith(p + '/');

  // ── KPI Card Data ──────────────────────────────────────────────────────────
  const kpiCards = [
    {
      key: 'revenue',
      label: 'Total Revenue',
      value: kpis?.revenue ? fmt.compact(kpis.revenue.current) : fmt.currency(basicStats?.revenue),
      change: kpis?.revenue?.change,
      icon: AttachMoney,
      accent: '#10B981',
      bg: '#10B98115',
    },
    {
      key: 'orders',
      label: 'Total Orders',
      value: kpis?.orders ? fmt.number(kpis.orders.current) : fmt.number(basicStats?.orders),
      change: kpis?.orders?.change,
      icon: ShoppingCart,
      accent: '#3B82F6',
      bg: '#3B82F615',
    },
    {
      key: 'customers',
      label: 'Customers',
      value: kpis?.customers ? fmt.number(kpis.customers.current) : fmt.number(basicStats?.users),
      change: kpis?.customers?.change,
      icon: People,
      accent: '#8B5CF6',
      bg: '#8B5CF615',
    },
    {
      key: 'products',
      label: 'Products',
      value: fmt.number(basicStats?.products),
      icon: Inventory,
      accent: '#F97316',
      bg: '#F9731615',
    },
    {
      key: 'inStock',
      label: 'In Stock',
      value: fmt.number(basicStats?.inStock),
      icon: CheckCircle,
      accent: '#14B8A6',
      bg: '#14B8A615',
    },
    {
      key: 'outOfStock',
      label: 'Out of Stock',
      value: fmt.number(basicStats?.outOfStock),
      icon: ErrorOutline,
      accent: '#EF4444',
      bg: '#EF444415',
    },
  ];

  // ── Chart data ──────────────────────────────────────────────────────────────
  const revenueData = revenueTrends?.data || [];
  const catData = (topPerformers?.categories || categoryPerformance?.categories || []).slice(0, 5).map((c, i) => ({
    name: c.name,
    value: c.revenue,
    fill: ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#14B8A6'][i],
  }));

  const channelData = channelPerformance?.channels || [];
  const deviceData = devicePerformance?.devices || [];

  return (
    <div className="adm-wrap">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={`adm-sidebar ${sidebarOpen ? 'adm-sidebar--open' : ''}`}>
        <div className="adm-sidebar-logo">
          <span className="adm-logo-mark">
            <DashboardIcon style={{ fontSize: 20 }} />
          </span>
          <span className="adm-logo-text">Admin Panel</span>
        </div>

        <nav className="adm-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="adm-nav-group">
              <span className="adm-nav-group-label">{group.group}</span>
              {group.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`adm-nav-link ${active ? 'adm-nav-link--active' : ''}`}
                    style={active ? { '--adm-link-accent': item.color } : {}}
                    onClick={() => setSidebarOpen(false)}
                    title={item.label}
                  >
                    <span
                      className="adm-nav-icon"
                      style={{
                        color: active ? item.color : undefined,
                        background: active ? item.color + '18' : undefined,
                      }}
                    >
                      <item.icon style={{ fontSize: 18 }} />
                    </span>
                    <span className="adm-nav-text">{item.label}</span>
                    {active && <span className="adm-nav-pip" style={{ background: item.color }} />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="adm-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div className="adm-main">
        {/* Page header */}
        <div className="adm-page-hd">
          <div className="adm-page-hd-left">
            <button className="adm-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <Close style={{ fontSize: 22 }} /> : <Menu style={{ fontSize: 22 }} />}
            </button>
            <div>
              <h1 className="adm-page-title">Dashboard Overview</h1>
              <p className="adm-page-sub">Monitor all business analytics in one place</p>
            </div>
          </div>

          <div className="adm-page-hd-right">
            <button className="adm-refresh-btn" onClick={loadAll} title="Refresh all data">
              <Refresh style={{ fontSize: 18 }} />
            </button>
            <div className="adm-timeframe">
              {['day', 'week', 'month', 'year'].map((t) => (
                <button
                  key={t}
                  className={`adm-tf-btn ${timeframe === t ? 'adm-tf-btn--active' : ''}`}
                  onClick={() => setTimeframe(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="adm-content">
          {/* ── Error Banner ─────────────────────────────────────────────── */}
          {error && (
            <div className="adm-error-banner">
              <Warning style={{ fontSize: 18 }} />
              <span>{error}</span>
              <button onClick={loadAll}>Retry</button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 1: KEY PERFORMANCE INDICATORS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#6366F115', color: '#6366F1' }}>
                  <BarChart style={{ fontSize: 16 }} />
                </span>
                Key Performance Indicators
              </h2>
              <TrendChip value={kpis?.revenue?.change || 0} />
            </div>

            <div className="adm-kpi-grid">
              {(loading && !basicStats?.orders)
                ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
                : kpiCards.map((k) => (
                    <div key={k.key} className="adm-kpi-card">
                      <div className="adm-kpi-top">
                        <span className="adm-kpi-icon" style={{ background: k.bg, color: k.accent }}>
                          <k.icon style={{ fontSize: 20 }} />
                        </span>
                        {k.change !== undefined && <TrendChip value={k.change} />}
                      </div>
                      <div className="adm-kpi-label">{k.label}</div>
                      <div className="adm-kpi-value">{k.value}</div>
                    </div>
                  ))}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 2: REVENUE ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#10B98115', color: '#10B981' }}>
                  <TrendingUp style={{ fontSize: 16 }} />
                </span>
                Revenue Analytics
              </h2>
              <Link to="/admin/reports" className="adm-section-link">
                Full Reports <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-charts-row">
              <SectionCard
                title="Revenue Trends"
                subtitle={`${timeframe} view — daily breakdown`}
                icon={TrendingUp}
                iconColor="#10B981"
                link="/admin/reports"
                linkLabel="Reports"
              >
                {!revenueData.length ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={revenueData}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--adm-border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--adm-text-muted)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--adm-text-muted)' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: 'var(--adm-card)', border: '1px solid var(--adm-border)', borderRadius: 8, fontSize: 13 }}
                        formatter={(v) => [fmt.currency(v), 'Revenue']}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#revGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </SectionCard>

              <SectionCard
                title="Sales by Category"
                subtitle="Revenue distribution"
                icon={Category}
                iconColor="#6366F1"
                link="/admin/analytics"
              >
                {!catData.length ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <ReChart data={catData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--adm-border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--adm-text-muted)' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--adm-text-muted)' }} width={90} />
                      <Tooltip
                        contentStyle={{ background: 'var(--adm-card)', border: '1px solid var(--adm-border)', borderRadius: 8, fontSize: 13 }}
                        formatter={(v) => [fmt.currency(v), 'Revenue']}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {catData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Bar>
                    </ReChart>
                  </ResponsiveContainer>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 3: CUSTOMER ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#06B6D415', color: '#06B6D4' }}>
                  <PersonSearch style={{ fontSize: 16 }} />
                </span>
                Customer Analytics
              </h2>
              <Link to="/admin/customers" className="adm-section-link">
                Full Customer Data <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-cards-3">
              <SectionCard title="Customer Overview" icon={People} iconColor="#06B6D4">
                {!customerOverview ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Total Customers" value={fmt.number(customerOverview.totalCustomers)} accent="#06B6D4" />
                    <MetricRow label="New This Period" value={fmt.number(customerOverview.newCustomers)} sub={<TrendChip value={customerOverview.newCustomersGrowth} />} />
                    <MetricRow label="Active Customers" value={fmt.number(customerOverview.activeCustomers)} />
                    <MetricRow label="Avg. Order Value" value={fmt.currency(customerOverview.avgOrderValue)} accent="#10B981" />
                    <MetricRow label="Customer LTV" value={fmt.currency(customerOverview.avgLifetimeValue)} accent="#8B5CF6" />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Segment Distribution" icon={BarChart} iconColor="#8B5CF6" link="/admin/customers">
                {!customerOverview?.segments ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-segment-list">
                    {(customerOverview.segments || []).map((seg, i) => (
                      <div key={i} className="adm-segment-row">
                        <div className="adm-segment-label">{seg.name}</div>
                        <div className="adm-segment-bar-wrap">
                          <div
                            className="adm-segment-bar"
                            style={{
                              width: `${seg.percentage || 0}%`,
                              background: ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'][i % 5],
                            }}
                          />
                        </div>
                        <div className="adm-segment-pct">{fmt.pct(seg.percentage)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Top Customers" icon={ManageAccounts} iconColor="#A855F7" link="/admin/customers">
                {!topPerformers?.customers ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    {(topPerformers.customers || []).slice(0, 5).map((c, i) => (
                      <MetricRow
                        key={i}
                        label={c.name || c.email || `Customer #${i + 1}`}
                        value={fmt.currency(c.totalSpent)}
                        sub={`${fmt.number(c.orderCount)} orders`}
                        accent="#A855F7"
                      />
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 4: MARKETING ATTRIBUTION
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#F59E0B15', color: '#F59E0B' }}>
                  <CampaignOutlined style={{ fontSize: 16 }} />
                </span>
                Marketing Attribution
              </h2>
              <Link to="/admin/attribution" className="adm-section-link">
                Full Attribution <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-charts-row">
              <SectionCard title="Channel Performance" icon={CampaignOutlined} iconColor="#F59E0B" link="/admin/attribution">
                {!channelData.length ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <div className="adm-metric-list">
                    {channelData.slice(0, 6).map((ch, i) => (
                      <div key={i} className="adm-channel-row">
                        <span
                          className="adm-channel-dot"
                          style={{ background: ['#F59E0B', '#6366F1', '#10B981', '#EF4444', '#06B6D4', '#8B5CF6'][i % 6] }}
                        />
                        <span className="adm-channel-name">{ch.channel || ch.name}</span>
                        <span className="adm-channel-sessions">{fmt.number(ch.sessions)} sessions</span>
                        <span className="adm-channel-revenue" style={{ color: '#10B981' }}>{fmt.compact(ch.revenue)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Device Performance" icon={DevicesOther} iconColor="#6366F1" link="/admin/attribution">
                {!deviceData.length ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={deviceData} dataKey="sessions" nameKey="device" cx="50%" cy="50%" outerRadius={80} label={({ device, percent }) => `${device} ${(percent * 100).toFixed(0)}%`}>
                        {deviceData.map((_, i) => (
                          <Cell key={i} fill={['#6366F1', '#10B981', '#F59E0B'][i % 3]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'var(--adm-card)', border: '1px solid var(--adm-border)', borderRadius: 8, fontSize: 13 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 5: CHECKOUT ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#10B98115', color: '#10B981' }}>
                  <ShoppingCartCheckout style={{ fontSize: 16 }} />
                </span>
                Checkout Analytics
              </h2>
              <Link to="/admin/checkout" className="adm-section-link">
                Full Checkout Data <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-cards-3">
              <SectionCard title="Abandonment Stats" icon={ShoppingCartCheckout} iconColor="#10B981">
                {!checkoutAbandonment ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Abandonment Rate" value={fmt.pct(checkoutAbandonment.abandonmentRate)} accent="#EF4444" />
                    <MetricRow label="Completed Checkouts" value={fmt.number(checkoutAbandonment.completedCheckouts)} accent="#10B981" />
                    <MetricRow label="Abandoned Checkouts" value={fmt.number(checkoutAbandonment.abandonedCheckouts)} />
                    <MetricRow label="Lost Revenue" value={fmt.currency(checkoutAbandonment.lostRevenue)} accent="#F59E0B" />
                    <MetricRow label="Recovery Rate" value={fmt.pct(checkoutAbandonment.recoveryRate)} accent="#06B6D4" />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Abandonment by Step" icon={FactCheck} iconColor="#8B5CF6">
                {!checkoutAbandonment?.stepBreakdown ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-segment-list">
                    {(checkoutAbandonment.stepBreakdown || []).map((step, i) => (
                      <div key={i} className="adm-segment-row">
                        <div className="adm-segment-label">{step.step}</div>
                        <div className="adm-segment-bar-wrap">
                          <div className="adm-segment-bar" style={{ width: `${step.dropOffRate || 0}%`, background: '#8B5CF6' }} />
                        </div>
                        <div className="adm-segment-pct">{fmt.pct(step.dropOffRate)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Recovery Opportunities" icon={CurrencyExchange} iconColor="#14B8A6" link="/admin/checkout">
                {!checkoutAbandonment ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Recoverable Revenue" value={fmt.currency(checkoutAbandonment.recoverableRevenue)} accent="#14B8A6" />
                    <MetricRow label="High Priority" value={fmt.number(checkoutAbandonment.highPriority)} accent="#EF4444" />
                    <MetricRow label="Emails Sent" value={fmt.number(checkoutAbandonment.emailsSent)} />
                    <MetricRow label="Recovered Orders" value={fmt.number(checkoutAbandonment.recoveredOrders)} accent="#10B981" />
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 6: PRODUCT PERFORMANCE
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                  <Inventory style={{ fontSize: 16 }} />
                </span>
                Product Performance
              </h2>
              <Link to="/admin/products" className="adm-section-link">
                View Products <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-charts-row">
              <SectionCard title="Top Products" icon={Storefront} iconColor="#3B82F6" link="/admin/products">
                {!topPerformers?.products ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <div className="adm-product-list">
                    <div className="adm-table-hd">
                      <span>Product</span><span>Sales</span><span>Revenue</span><span>Trend</span>
                    </div>
                    {(topPerformers.products || []).slice(0, 6).map((p, i) => (
                      <div key={i} className="adm-table-row">
                        <span className="adm-table-name">{p.name}</span>
                        <span>{fmt.number(p.salesCount)}</span>
                        <span style={{ color: '#10B981', fontWeight: 600 }}>{fmt.compact(p.revenue)}</span>
                        <TrendChip value={p.growth} />
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Inventory Alerts" icon={Warning} iconColor="#F59E0B" link="/admin/products">
                {!lowStockAlerts ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Low Stock Items" value={fmt.number(lowStockAlerts.lowStockCount)} accent="#F59E0B" />
                    <MetricRow label="Out of Stock" value={fmt.number(lowStockAlerts.outOfStockCount)} accent="#EF4444" />
                    <MetricRow label="Reorder Needed" value={fmt.number(lowStockAlerts.reorderCount)} accent="#F97316" />
                    <MetricRow label="Inventory Value" value={fmt.currency(lowStockAlerts.totalInventoryValue)} accent="#3B82F6" />
                    {(lowStockAlerts.criticalItems || []).slice(0, 3).map((item, i) => (
                      <div key={i} className="adm-alert-row">
                        <ErrorOutline style={{ fontSize: 14, color: '#EF4444', flexShrink: 0 }} />
                        <span className="adm-alert-name">{item.name}</span>
                        <span className="adm-alert-stock">{item.stock} left</span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 7: OPERATIONAL ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#64748B15', color: '#64748B' }}>
                  <LocalShipping style={{ fontSize: 16 }} />
                </span>
                Operational Metrics
              </h2>
            </div>

            <div className="adm-cards-3">
              <SectionCard title="Fulfillment" icon={LocalShipping} iconColor="#64748B">
                {!fulfillmentAnalytics ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="On-Time Rate" value={fmt.pct(fulfillmentAnalytics.onTimeRate)} accent="#10B981" />
                    <MetricRow label="Avg. Processing Time" value={`${fulfillmentAnalytics.avgProcessingTime?.toFixed(1) || '—'} hrs`} />
                    <MetricRow label="Avg. Shipping Time" value={`${fulfillmentAnalytics.avgShippingTime?.toFixed(1) || '—'} days`} />
                    <MetricRow label="Pending Shipments" value={fmt.number(fulfillmentAnalytics.pendingShipments)} accent="#F59E0B" />
                    <MetricRow label="Delivered Today" value={fmt.number(fulfillmentAnalytics.deliveredToday)} accent="#10B981" />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="SLA Compliance" icon={FactCheck} iconColor="#8B5CF6">
                {!slaBreaches ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Compliance Rate" value={fmt.pct(slaBreaches.complianceRate)} accent="#10B981" />
                    <MetricRow label="Total Breaches" value={fmt.number(slaBreaches.totalBreaches)} accent="#EF4444" />
                    <MetricRow label="Critical Breaches" value={fmt.number(slaBreaches.criticalBreaches)} accent="#DC2626" />
                    <MetricRow label="Avg. Resolution Time" value={`${slaBreaches.avgResolutionTime?.toFixed(1) || '—'} hrs`} />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Fraud Detection" icon={Security} iconColor="#EF4444">
                {!fraudAnalytics ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Fraud Rate" value={fmt.pct(fraudAnalytics.fraudRate)} accent="#EF4444" />
                    <MetricRow label="Flagged Orders" value={fmt.number(fraudAnalytics.flaggedOrders)} accent="#F59E0B" />
                    <MetricRow label="Confirmed Fraud" value={fmt.number(fraudAnalytics.confirmedFraud)} accent="#DC2626" />
                    <MetricRow label="Revenue Saved" value={fmt.currency(fraudAnalytics.revenueSaved)} accent="#10B981" />
                    <MetricRow label="Pending Review" value={fmt.number(fraudAnalytics.pendingReview)} />
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 8: RETURNS ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#EF444415', color: '#EF4444' }}>
                  <ReplayCircleFilled style={{ fontSize: 16 }} />
                </span>
                Returns Analytics
              </h2>
              <Link to="/admin/returns" className="adm-section-link">
                Manage Returns <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-charts-row">
              <SectionCard title="Returns Overview" icon={ReplayCircleFilled} iconColor="#EF4444">
                {!returnOverview ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Total Returns" value={fmt.number(returnOverview.totalReturns)} />
                    <MetricRow label="Return Rate" value={fmt.pct(returnOverview.returnRate)} accent="#EF4444" />
                    <MetricRow label="Pending Review" value={fmt.number(returnOverview.pendingReview)} accent="#F59E0B" />
                    <MetricRow label="Approved Returns" value={fmt.number(returnOverview.approved)} accent="#10B981" />
                    <MetricRow label="Value Returned" value={fmt.currency(returnOverview.totalValue)} accent="#EF4444" />
                    <MetricRow label="Avg. Processing" value={`${returnOverview.avgProcessingDays?.toFixed(1) || '—'} days`} />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Top Return Reasons" icon={Assessment} iconColor="#F97316" link="/admin/returns">
                {!returnOverview?.topReasons ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <div className="adm-segment-list">
                    {(returnOverview.topReasons || []).map((r, i) => (
                      <div key={i} className="adm-segment-row">
                        <div className="adm-segment-label">{r.reason}</div>
                        <div className="adm-segment-bar-wrap">
                          <div className="adm-segment-bar" style={{ width: `${r.percentage || 0}%`, background: '#EF4444' }} />
                        </div>
                        <div className="adm-segment-pct">{fmt.pct(r.percentage)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 9: REFUNDS ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#14B8A615', color: '#14B8A6' }}>
                  <CurrencyExchange style={{ fontSize: 16 }} />
                </span>
                Refunds Analytics
              </h2>
              <Link to="/admin/refunds" className="adm-section-link">
                Manage Refunds <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>

            <div className="adm-charts-row">
              <SectionCard title="Refunds Overview" icon={CurrencyExchange} iconColor="#14B8A6">
                {!refundOverview ? (
                  <SectionSkeleton rows={5} />
                ) : (
                  <div className="adm-metric-list">
                    <MetricRow label="Total Refunds" value={fmt.number(refundOverview.totalRefunds)} />
                    <MetricRow label="Refund Rate" value={fmt.pct(refundOverview.refundRate)} accent="#14B8A6" />
                    <MetricRow label="Pending Refunds" value={fmt.number(refundOverview.pending)} accent="#F59E0B" />
                    <MetricRow label="Total Refunded" value={fmt.currency(refundOverview.totalAmount)} accent="#EF4444" />
                    <MetricRow label="Avg. Refund Value" value={fmt.currency(refundOverview.avgAmount)} />
                    <MetricRow label="Avg. Processing" value={`${refundOverview.avgProcessingTime?.toFixed(1) || '—'} hrs`} />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Refund Status Breakdown" icon={BarChart} iconColor="#8B5CF6" link="/admin/refunds">
                {!refundOverview?.statusBreakdown ? (
                  <SectionSkeleton rows={4} />
                ) : (
                  <div className="adm-segment-list">
                    {(refundOverview.statusBreakdown || []).map((s, i) => (
                      <div key={i} className="adm-segment-row">
                        <div className="adm-segment-label">{s.status}</div>
                        <div className="adm-segment-bar-wrap">
                          <div className="adm-segment-bar" style={{
                            width: `${s.percentage || 0}%`,
                            background: ['#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#8B5CF6'][i % 5]
                          }} />
                        </div>
                        <div className="adm-segment-pct">{fmt.number(s.count)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 10: ALERTS & RECENT ACTIVITY
          ═══════════════════════════════════════════════════════════════ */}
          <div className="adm-section">
            <div className="adm-section-hd">
              <h2 className="adm-section-title">
                <span className="adm-section-icon-wrap" style={{ background: '#F59E0B15', color: '#F59E0B' }}>
                  <Warning style={{ fontSize: 16 }} />
                </span>
                Alerts &amp; Activity
              </h2>
            </div>

            <div className="adm-charts-row">
              <SectionCard title="Dashboard Alerts" icon={Warning} iconColor="#F59E0B">
                {!alerts ? (
                  <SectionSkeleton rows={4} />
                ) : alerts.length === 0 ? (
                  <div className="adm-empty">
                    <CheckCircle style={{ fontSize: 36, color: '#10B981' }} />
                    <span>All systems operational</span>
                  </div>
                ) : (
                  <div className="adm-alert-feed">
                    {alerts.slice(0, 8).map((a, i) => (
                      <div key={i} className={`adm-alert-item adm-alert-item--${a.severity || 'info'}`}>
                        <div className="adm-alert-item-icon">
                          {a.severity === 'critical' ? (
                            <ErrorOutline style={{ fontSize: 16, color: '#EF4444' }} />
                          ) : a.severity === 'warning' ? (
                            <Warning style={{ fontSize: 16, color: '#F59E0B' }} />
                          ) : (
                            <CheckCircle style={{ fontSize: 16, color: '#10B981' }} />
                          )}
                        </div>
                        <div className="adm-alert-item-body">
                          <div className="adm-alert-item-msg">{a.message}</div>
                          <div className="adm-alert-item-time">{a.timeAgo || 'Just now'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Quick Stats" icon={DashboardIcon} iconColor="#6366F1">
                <div className="adm-quick-grid">
                  {[
                    { label: 'Products', value: fmt.number(basicStats?.products), color: '#3B82F6', icon: Inventory },
                    { label: 'Users', value: fmt.number(basicStats?.users), color: '#8B5CF6', icon: People },
                    { label: 'In Stock', value: fmt.number(basicStats?.inStock), color: '#10B981', icon: CheckCircle },
                    { label: 'Out of Stock', value: fmt.number(basicStats?.outOfStock), color: '#EF4444', icon: ErrorOutline },
                    { label: 'Orders', value: fmt.number(basicStats?.orders), color: '#F97316', icon: ShoppingCart },
                    { label: 'Admins', value: fmt.number(basicStats?.adminCount), color: '#A855F7', icon: ManageAccounts },
                  ].map((s, i) => (
                    <div key={i} className="adm-quick-stat">
                      <span className="adm-quick-icon" style={{ background: s.color + '15', color: s.color }}>
                        <s.icon style={{ fontSize: 16 }} />
                      </span>
                      <span className="adm-quick-value">{loading && !basicStats?.products ? '—' : s.value}</span>
                      <span className="adm-quick-label">{s.label}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          </div>

        </div>{/* end adm-content */}
      </div>{/* end adm-main */}
    </div>
  );
}