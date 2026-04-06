import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import {
  Dashboard as DashboardIcon,
  TrendingUp, TrendingDown,
  ShoppingCart, People, Inventory,
  Assessment,
  StarOutline,
  MarkEmailRead,
  AttachMoney, Menu, Close,
  Warning, CheckCircle,
  Category,
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
  ErrorOutline,
  PersonAdd,
  Insights,
  Schedule,
} from '@mui/icons-material';
import {
  BarChart as ReChart, Bar,
  PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ── Slice imports ─────────────────────────────────────────────
import {
  fetchAdminStats,
  fetchOrderStatusBreakdown,
  fetchInventoryBreakdown,
  setActiveOrderStatusTimeframe,
} from '../features/analytics/coreAnalyticsSlice';
import {
  fetchDashboardKPIs,
  fetchRevenueTrends,
  fetchTopPerformers,
  fetchDashboardAlerts,
  setActiveTimeframe,
} from '../features/analytics/dashboardSlice';
import {
  fetchCustomerOverview,
} from '../features/analytics/customerAnalyticsSlice';
import {
  fetchChannelPerformance,
  fetchDevicePerformance,
} from '../features/analytics/attributionSlice';
import {
  fetchCheckoutAbandonmentStats,
  fetchCategoryPerformance,
  fetchLowStockAlerts,
  fetchFulfillmentAnalytics,
  fetchFraudAnalytics,
  fetchSLABreaches,
} from '../features/analytics/operationsSlice';
import {
  fetchReturnOverview,
  fetchRefundOverview,
  setReturnAnalyticsTimeframe,
} from '../features/analytics/returnAnalyticsSlice';
import {
  fetchDiscountAnalyticsOverview,
} from '../features/analytics/discountAnalyticsSlice';
import {
  fetchCronHealth,
} from '../features/admin/cronHealthSlice';

import Navbar from '../components/Navbar';
import '../AdminStyles/Dashboard.css';

// ── Nav groups ────────────────────────────────────────────────
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
            { path: '/admin/cron-health',     icon: Schedule,           label: 'Cron Health',     color: '#6366F1' },
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
    ],
  },
];

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;
const STALE_DATA_THRESHOLD  = 3 * 60 * 1000;
const DEBOUNCE_DELAY        = 800;

// Module-scoped — survives navigation.
// 'month' entry is deleted on mount so navigating back always fetches fresh.
const lastFetchedCache = {};
let activeAbortController = null;

// ── Formatters ────────────────────────────────────────────────
const fmt = {
  currency: (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:   (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:      (v) => `${(v || 0).toFixed(1)}%`,
  compact:  (v) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}k`;
    return fmt.currency(v);
  },
  roi: (v) => {
    if (v === null || v === undefined) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
  },
};

// ── Shared atoms ──────────────────────────────────────────────
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
  return <div className="adm-skeleton" style={{ height: h, width: w, borderRadius: radius, marginBottom: mb }} />;
}

function KpiSkeleton() {
  return (
    <div className="adm-kpi-card">
      <SkeletonBlock h={38} w={38} radius={9} mb={14} />
      <SkeletonBlock h={12} w="55%" mb={8} />
      <SkeletonBlock h={26} w="75%" />
    </div>
  );
}

function LoadingState({ label = 'Loading data...' }) {
  return (
    <div className="adm-loading-state">
      <div className="adm-loading-spinner" />
      <span className="adm-loading-text">{label}</span>
    </div>
  );
}

function Dash() {
  return <span style={{ color: '#9CA3AF', fontWeight: 400 }}>-</span>;
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

function LastUpdated({ timestamp }) {
  const [timeAgo, setTimeAgo] = useState('');
  useEffect(() => {
    const update = () => {
      if (!timestamp) return setTimeAgo('Never');
      const diff    = Date.now() - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours   = Math.floor(diff / 3600000);
      if (minutes < 1)        setTimeAgo('Just now');
      else if (minutes === 1) setTimeAgo('1 min ago');
      else if (minutes < 60)  setTimeAgo(`${minutes} mins ago`);
      else if (hours === 1)   setTimeAgo('1 hour ago');
      else                    setTimeAgo(`${hours} hours ago`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [timestamp]);
  return (
    <div className="adm-last-updated">
      <span className="adm-last-updated-label">Last updated:</span>
      <span className="adm-last-updated-time">{timeAgo}</span>
    </div>
  );
}

function TimeframeSheet({ timeframe, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const labels = { day: 'Today', week: 'This Week', month: 'This Month', year: 'This Year' };
  return (
    <>
      <button className="adm-tf-mobile-trigger" onClick={() => setOpen(true)} disabled={disabled} aria-label="Change time period">
        <span className="adm-tf-mobile-label">{labels[timeframe] || timeframe}</span>
        <KeyboardArrowRight style={{ fontSize: 16, transform: 'rotate(90deg)' }} />
      </button>
      {open && (
        <>
          <div className="adm-tf-sheet-overlay" onClick={() => setOpen(false)} />
          <div className="adm-tf-sheet">
            <div className="adm-tf-sheet-handle" />
            <p className="adm-tf-sheet-title">Select Time Period</p>
            {['day', 'week', 'month', 'year'].map(t => (
              <button key={t} className={`adm-tf-sheet-btn ${timeframe === t ? 'adm-tf-sheet-btn--active' : ''}`}
                onClick={() => { onChange(t); setOpen(false); }} disabled={disabled}>
                {labels[t]}
                {timeframe === t && <CheckCircle style={{ fontSize: 18, color: '#6366F1' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function useDebounce(callback, delay) {
  const cbRef    = useRef(callback);
  const timerRef = useRef(null);
  useEffect(() => { cbRef.current = callback; }, [callback]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const debounced = useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => cbRef.current(...args), delay);
  }, [delay]);
  const cancel = useCallback(() => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return [debounced, cancel];
}

function roiColor(roi) {
  if (roi === null || roi === undefined) return '#6B7280';
  if (roi >= 100) return '#10B981';
  if (roi >= 0)   return '#F59E0B';
  return '#EF4444';
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function AdminDashboard() {
  const dispatch = useDispatch();
  const location = useLocation();

  // ── Selectors ────────────────────────────────────────────
  const {
    basicStats,
    basicStatsFetched,
    ordersByStatus,
    ordersByStatusTrends,
    inventoryStatus,
  } = useSelector((s) => s.coreAnalytics);

  const {
    kpis, kpisLoading, revenueTrends, topPerformers, alerts,
  } = useSelector((s) => s.dashboard);

  const { customerOverview }   = useSelector((s) => s.customerAnalytics);
  const { channelPerformance, devicePerformance } = useSelector((s) => s.attribution);

  const {
    checkoutAbandonment, categoryPerformance, lowStockAlerts,
    fulfillmentAnalytics, fraudAnalytics, slaBreaches,
  } = useSelector((s) => s.operations);

  const {
    returnOverview,
    refundOverview,
  } = useSelector((s) => s.returnAnalytics);

  const {
    overview:        discountOverview,
    overviewLoading: discountOverviewLoading,
  } = useSelector((s) => s.discountAnalytics);

  const { jobs: cronJobs, jobsLoading: cronJobsLoading } = useSelector((s) => s.cronHealth);

  const error = useSelector(
    (s) => s.coreAnalytics.error || s.dashboard.error || s.operations.error || s.returnAnalytics.error || null
  );

  // ── Local state ──────────────────────────────────────────
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [timeframe,     setTimeframe]     = useState('month');
  const [lastFetchTime, setLastFetchTime] = useState(null);

  const kpisReady = (
    kpis !== null && kpis !== undefined &&
    typeof kpis === 'object' && !Array.isArray(kpis) &&
    ('revenue' in kpis || 'orders' in kpis || 'customers' in kpis)
  );

  const firstLoad = !basicStatsFetched;

  const isLoadingRef        = useRef(false);
  const autoRefreshTimerRef = useRef(null);

  // ── Static data (one-time) ───────────────────────────────
  const loadStaticData = useCallback(() => {
    if (basicStatsFetched) return;
    Promise.allSettled([
      fetchAdminStats(),
      fetchInventoryBreakdown(),
      fetchDashboardAlerts(),
      fetchLowStockAlerts(),
      fetchCustomerOverview(),
      fetchOrderStatusBreakdown(),
    ].map(thunk => dispatch(thunk).unwrap().catch(() => {})));
  }, [dispatch, basicStatsFetched]);

  // ── Timeframe data ───────────────────────────────────────
  const loadTimeframeData = useCallback((currentTimeframe, force = false) => {
    if (isLoadingRef.current) return;
    const now  = Date.now();
    const last = lastFetchedCache[currentTimeframe] || 0;
    if (!force && now - last < 30000) return;

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    dispatch(setActiveTimeframe(currentTimeframe));
    dispatch(setActiveOrderStatusTimeframe(currentTimeframe));
    dispatch(setReturnAnalyticsTimeframe(currentTimeframe));

    lastFetchedCache[currentTimeframe] = now;
    setLastFetchTime(now);
    isLoadingRef.current = true;

    Promise.allSettled([
      fetchDashboardKPIs(currentTimeframe),
      fetchRevenueTrends({ timeframe: currentTimeframe, groupBy: 'day' }),
      fetchTopPerformers(currentTimeframe),
      fetchOrderStatusBreakdown(currentTimeframe),
      fetchChannelPerformance(currentTimeframe),
      fetchDevicePerformance(currentTimeframe),
      fetchCheckoutAbandonmentStats(currentTimeframe),
      fetchCategoryPerformance(currentTimeframe),
      fetchFulfillmentAnalytics(currentTimeframe),
      fetchFraudAnalytics(currentTimeframe),
      fetchSLABreaches(currentTimeframe),
      fetchReturnOverview(currentTimeframe),
      fetchRefundOverview(currentTimeframe),
      fetchDiscountAnalyticsOverview(),
      fetchCronHealth(),
    ].map(thunk => dispatch(thunk).unwrap().catch(() => {})))
      .finally(() => {
        isLoadingRef.current  = false;
        activeAbortController = null;
      });
  }, [dispatch]);

  const [debouncedLoadTimeframe, cancelDebounce] = useDebounce(
    loadTimeframeData,
    DEBOUNCE_DELAY
  );

  const handleTimeframeChange = useCallback((newTf) => {
    if (kpisLoading) return;
    setTimeframe(newTf);
    cancelDebounce();
    debouncedLoadTimeframe(newTf, true);
  }, [kpisLoading, debouncedLoadTimeframe, cancelDebounce]);

  // ── Mount effect ─────────────────────────────────────────
  useEffect(() => {
    delete lastFetchedCache['month'];
    loadStaticData();
    loadTimeframeData('month', true);
    return () => { cancelDebounce(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    autoRefreshTimerRef.current = null;
    if (['day', 'week', 'month'].includes(timeframe)) {
      autoRefreshTimerRef.current = setInterval(() => {
        const last = lastFetchedCache[timeframe] || 0;
        if (Date.now() - last >= STALE_DATA_THRESHOLD && !isLoadingRef.current) {
          loadTimeframeData(timeframe, false);
        }
      }, AUTO_REFRESH_INTERVAL);
    }
    return () => { if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current); };
  }, [timeframe, loadTimeframeData]);

  const isActive = useCallback(
    (p) => location.pathname === p || location.pathname.startsWith(p + '/'),
    [location.pathname]
  );

  const inv = useMemo(() => inventoryStatus || {
    inStock: 0, lowStock: 0, outOfStock: 0, discontinued: 0, total: 0,
  }, [inventoryStatus]);

  // ── KPI Cards ────────────────────────────────────────────
  const kpiCards = [
    { key: 'revenue',       label: 'Total Revenue',    icon: AttachMoney,   accent: '#10B981', bg: '#10B98115',
      value:  kpisReady ? fmt.currency(kpis?.revenue?.current)    : null,
      change: kpisReady ? kpis?.revenue?.change                   : undefined },
    { key: 'orders',        label: 'Total Orders',     icon: ShoppingCart,  accent: '#3B82F6', bg: '#3B82F615',
      value:  kpisReady ? fmt.number(kpis?.orders?.current)        : null,
      change: kpisReady ? kpis?.orders?.change                     : undefined },
    { key: 'payingCustomers', label: 'Customers',      icon: PersonAdd,     accent: '#8B5CF6', bg: '#8B5CF615',
      value:  kpisReady ? fmt.number(kpis?.customers?.current)     : null,
      change: kpisReady ? kpis?.customers?.change                  : undefined },
    { key: 'totalUsers',    label: 'Total Users',      icon: People,        accent: '#06B6D4', bg: '#06B6D415',
      value:  basicStatsFetched ? fmt.number(basicStats?.users)    : null },
    { key: 'products',      label: 'Products',         icon: Inventory,     accent: '#F97316', bg: '#F9731615',
      value:  basicStatsFetched ? fmt.number(basicStats?.products) : null },
    { key: 'lowStock',      label: 'Low Stock',        icon: Warning,       accent: '#F59E0B', bg: '#F59E0B15',
      value:  basicStatsFetched ? fmt.number(inv.lowStock)         : null },
    { key: 'outOfStock',    label: 'Out of Stock',     icon: ErrorOutline,  accent: '#EF4444', bg: '#EF444415',
      value:  basicStatsFetched ? fmt.number(inv.outOfStock)       : null },
    { key: 'recoveryEmails', label: 'Recovery Emails', icon: MarkEmailRead, accent: '#FF6B6B', bg: '#FF6B6B15',
      value:  basicStatsFetched ? fmt.number(checkoutAbandonment?.emailsSent ?? 0) : null },
  ];

  const revenueData  = useMemo(() => revenueTrends?.data || [], [revenueTrends]);
  const catData      = useMemo(() => (
    (topPerformers?.categories || categoryPerformance?.categories || [])
      .slice(0, 5).map((c, i) => ({ name: c.name, value: c.revenue, fill: ['#6366F1','#10B981','#F59E0B','#EF4444','#14B8A6'][i] }))
  ), [topPerformers, categoryPerformance]);
  const channelData  = useMemo(() => channelPerformance?.channels || [], [channelPerformance]);
  const deviceData   = useMemo(() => devicePerformance?.devices   || [], [devicePerformance]);
  const safeSegments = useMemo(() => customerOverview?.segments   ?? [], [customerOverview]);
  const quickStats   = useMemo(() => [
    { label: 'Products',     value: basicStats?.products  ?? null, color: '#3B82F6', icon: Inventory },
    { label: 'Users',        value: basicStats?.users      ?? null, color: '#8B5CF6', icon: People },
    { label: 'In Stock',     value: inv.inStock            ?? null, color: '#10B981', icon: CheckCircle },
    { label: 'Out of Stock', value: inv.outOfStock         ?? null, color: '#EF4444', icon: ErrorOutline },
    { label: 'Orders',       value: basicStats?.orders     ?? null, color: '#F97316', icon: ShoppingCart },
    { label: 'Admins',       value: basicStats?.adminCount ?? null, color: '#A855F7', icon: ManageAccounts },
  ], [basicStats, inv]);

  const discountSummary = discountOverview?.overall ?? null;
  const discountTopCode = discountOverview?.topByROI?.[0] ?? null;

  return (
    <>
      <Navbar />
      <div className="adm-wrap">
        {/* ── Sidebar ─────────────────────────────────────── */}
        <aside className={`adm-sidebar ${sidebarOpen ? 'adm-sidebar--open' : ''}`}>
          <div className="adm-sidebar-logo">
            <span className="adm-logo-mark"><DashboardIcon style={{ fontSize: 20 }} /></span>
            <span className="adm-logo-text">Admin Panel</span>
          </div>
          <nav className="adm-nav">
            {NAV_GROUPS.map(group => (
              <div key={group.group} className="adm-nav-group">
                <span className="adm-nav-group-label">{group.group}</span>
                {group.items.map(item => {
                  const active = isActive(item.path);
                  return (
                    <Link key={item.path} to={item.path}
                      className={`adm-nav-link ${active ? 'adm-nav-link--active' : ''}`}
                      style={active ? { '--adm-link-accent': item.color } : {}}
                      onClick={() => setSidebarOpen(false)} title={item.label}>
                      <span className="adm-nav-icon" style={{ color: active ? item.color : undefined, background: active ? item.color + '18' : undefined }}>
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

        {sidebarOpen && <div className="adm-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* ── Main ────────────────────────────────────────── */}
        <div className="adm-main">
          <div className="adm-page-hd">
            <div className="adm-page-hd-left">
              <button className="adm-menu-btn" onClick={() => setSidebarOpen(prev => !prev)} aria-label="Toggle menu">
                {sidebarOpen ? <Close style={{ fontSize: 22 }} /> : <Menu style={{ fontSize: 22 }} />}
              </button>
              <div>
                <h1 className="adm-page-title">Dashboard Overview</h1>
                <p className="adm-page-sub">Monitor all business analytics in one place</p>
              </div>
            </div>
            <div className="adm-page-hd-right">
              <LastUpdated timestamp={lastFetchTime} />
              <div className="adm-timeframe">
                {['day', 'week', 'month', 'year'].map(t => (
                  <button key={t}
                    className={`adm-tf-btn ${timeframe === t ? 'adm-tf-btn--active' : ''}`}
                    onClick={() => handleTimeframeChange(t)}
                    disabled={kpisLoading}
                    aria-pressed={timeframe === t}>
                    {kpisLoading && timeframe === t
                      ? <span className="adm-tf-spinner" />
                      : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <TimeframeSheet timeframe={timeframe} onChange={handleTimeframeChange} disabled={kpisLoading} />
            </div>
          </div>

          <div className="adm-content">
            {error && (
              <div className="adm-error-banner">
                <Warning style={{ fontSize: 18 }} /><span>{error}</span>
              </div>
            )}

            {/* ── KPIs ──────────────────────────────────────── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#6366F115', color: '#6366F1' }}>
                    <BarChart style={{ fontSize: 16 }} />
                  </span>
                  Key Performance Indicators
                </h2>
                {kpisReady && !kpisLoading && <TrendChip value={kpis?.revenue?.change || 0} />}
                {kpisLoading && <span className="adm-kpi-refreshing">Refreshing…</span>}
              </div>
              <div className={`adm-kpi-grid ${kpisLoading ? 'adm-kpi-grid--loading' : ''}`}>
                {!basicStatsFetched
                  ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)
                  : kpiCards.map(k => {
                      if (!k || typeof k !== 'object' || !k.key) return null;
                      return (
                        <div key={k.key} className="adm-kpi-card">
                          <div className="adm-kpi-top">
                            <span className="adm-kpi-icon" style={{ background: k.bg, color: k.accent }}>
                              <k.icon style={{ fontSize: 20 }} />
                            </span>
                            {k.change !== undefined && kpisReady && !kpisLoading && (
                              <TrendChip value={k.change} />
                            )}
                          </div>
                          <div className="adm-kpi-label">{k.label}</div>
                          <div className="adm-kpi-value">{k.value ?? <Dash />}</div>
                        </div>
                      );
                    })
                }
              </div>
            </div>

                        {/* ── Scheduled Jobs (Cron Health Mini-Strip) ───── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#6366F115', color: '#6366F1' }}>
                    <Schedule style={{ fontSize: 16 }} />
                  </span>
                  Scheduled Jobs
                </h2>
                <Link to="/admin/cron-health" className="adm-section-link">
                  Full Health View <KeyboardArrowRight style={{ fontSize: 16 }} />
                </Link>
              </div>
              <div className="adm-cron-mini-strip">
                {cronJobsLoading && cronJobs.length === 0
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="adm-cron-mini-card adm-cron-mini-card--skeleton">
                        <div className="adm-skeleton" style={{ width: 8, height: 8, borderRadius: '50%' }} />
                        <div className="adm-skeleton" style={{ flex: 1, height: 12 }} />
                      </div>
                    ))
                  : cronJobs.length === 0
                    ? (
                      <div className="adm-cron-mini-empty">
                        <Schedule style={{ fontSize: 20, color: '#9CA3AF' }} />
                        <span>No cron jobs registered</span>
                      </div>
                    )
                    : cronJobs.map((job) => (
                        <Link
                          key={job.jobName}
                          to="/admin/cron-health"
                          className="adm-cron-mini-card"
                          title={`${job.jobName} — ${job.scheduleLabel ?? ''}`}
                        >
                          <span className={`adm-cron-mini-dot adm-cron-mini-dot--${job.status ?? 'unknown'}`} />
                          <span className="adm-cron-mini-name">{job.jobName.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="adm-cron-mini-time">
                            {job.lastRunAt
                              ? (() => {
                                  const diff    = Date.now() - new Date(job.lastRunAt).getTime();
                                  const minutes = Math.floor(diff / 60000);
                                  const hours   = Math.floor(diff / 3600000);
                                  if (minutes < 1)  return 'Just now';
                                  if (minutes < 60) return `${minutes}m`;
                                  if (hours < 24)   return `${hours}h`;
                                  return `${Math.floor(hours / 24)}d`;
                                })()
                              : 'Never'
                            }
                          </span>
                        </Link>
                      ))
                }
              </div>
            </div>

            {/* ── Orders & Inventory ────────────────────────── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#F9731615', color: '#F97316' }}>
                    <ShoppingCart style={{ fontSize: 16 }} />
                  </span>
                  Orders &amp; Inventory Status
                </h2>
                <Link to="/admin/orders" className="adm-section-link">
                  View Orders <KeyboardArrowRight style={{ fontSize: 16 }} />
                </Link>
              </div>
              <div className="adm-charts-row">
                <SectionCard title="Order Status Breakdown" icon={ShoppingCart} iconColor="#F97316" link="/admin/orders">
                  {firstLoad ? <LoadingState label="Loading orders..." /> : (
                    <div className="adm-metric-list">
                      <MetricRow
                        label="Processing"
                        value={fmt.number(ordersByStatus?.processing)}
                        accent="#F59E0B"
                        sub={ordersByStatusTrends?.processing !== undefined
                          ? <TrendChip value={ordersByStatusTrends.processing} />
                          : null}
                      />
                      <MetricRow
                        label="Shipped"
                        value={fmt.number(ordersByStatus?.shipped)}
                        accent="#3B82F6"
                        sub={ordersByStatusTrends?.shipped !== undefined
                          ? <TrendChip value={ordersByStatusTrends.shipped} />
                          : null}
                      />
                      <MetricRow
                        label="Delivered"
                        value={fmt.number(ordersByStatus?.delivered)}
                        accent="#10B981"
                        sub={ordersByStatusTrends?.delivered !== undefined
                          ? <TrendChip value={ordersByStatusTrends.delivered} />
                          : null}
                      />
                      <MetricRow
                        label="Cancelled"
                        value={fmt.number(ordersByStatus?.cancelled)}
                        accent="#EF4444"
                        sub={ordersByStatusTrends?.cancelled !== undefined
                          ? <TrendChip value={ordersByStatusTrends.cancelled} />
                          : null}
                      />
                      <MetricRow
                        label="Total (all-time)"
                        value={basicStats?.orders !== undefined ? fmt.number(basicStats.orders) : <Dash />}
                      />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Inventory Breakdown" icon={Inventory} iconColor="#3B82F6" link="/admin/products">
                  {firstLoad ? <LoadingState label="Loading inventory..." /> : (
                    <div className="adm-metric-list">
                      <MetricRow label="In Stock"     value={fmt.number(inv.inStock)}      accent="#10B981" />
                      <MetricRow label="Low Stock"    value={fmt.number(inv.lowStock)}     accent="#F59E0B" />
                      <MetricRow label="Out of Stock" value={fmt.number(inv.outOfStock)}   accent="#EF4444" />
                      <MetricRow label="Discontinued" value={fmt.number(inv.discontinued)} accent="#6B7280" />
                      <MetricRow label="Total SKUs"   value={fmt.number(inv.total)} />
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Revenue Analytics ─────────────────────────── */}
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
                <SectionCard title="Revenue Trends" subtitle={`${timeframe} view - daily breakdown`} icon={TrendingUp} iconColor="#10B981" link="/admin/reports" linkLabel="Reports">
                  {firstLoad ? <LoadingState label="Loading revenue data..." /> : revenueData.length === 0 ? (
                    <div className="adm-empty">
                      <Assessment style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No revenue data available for this period</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={revenueData}>
                        <defs>
                          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#10B981" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
                          formatter={(v) => [fmt.currency(v), 'Revenue']}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#revGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>
                <SectionCard title="Sales by Category" subtitle="Revenue distribution" icon={Category} iconColor="#6366F1" link="/admin/analytics">
                  {firstLoad ? <LoadingState label="Loading categories..." /> : catData.length === 0 ? (
                    <div className="adm-empty">
                      <Category style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No category data available</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <ReChart data={catData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} width={90} />
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
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

            {/* ── Discount ROI Summary ───────────────────────── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#e563f115', color: '#e563f1' }}>
                    <Insights style={{ fontSize: 16 }} />
                  </span>
                  Discount Performance
                </h2>
                <Link to="/admin/discount-analytics" className="adm-section-link">
                  Full ROI Analytics <KeyboardArrowRight style={{ fontSize: 16 }} />
                </Link>
              </div>
              <div className="adm-charts-row">
                <SectionCard title="Discount ROI Overview" subtitle="Store-wide discount effectiveness" icon={LocalOffer} iconColor="#e563f1" link="/admin/discount-analytics" linkLabel="View Analytics">
                  {discountOverviewLoading || (!discountSummary && firstLoad) ? (
                    <LoadingState label="Loading discount data..." />
                  ) : !discountSummary ? (
                    <div className="adm-empty">
                      <Insights style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No discount analytics yet</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Total Discount Cost"   value={fmt.compact(discountSummary.totalDiscountCost)}      accent="#EF4444" />
                      <MetricRow label="Revenue Influenced"    value={fmt.compact(discountSummary.totalRevenueInfluenced)} accent="#10B981" />
                      <MetricRow label="Overall ROI"           value={
                        <span style={{ color: roiColor(discountSummary.overallROI), fontWeight: 700 }}>
                          {fmt.roi(discountSummary.overallROI)}
                        </span>
                      } />
                      <MetricRow label="Total Redemptions"     value={fmt.number(discountSummary.totalRedemptions)}        accent="#8B5CF6" />
                      <MetricRow label="Active Codes"          value={fmt.number(discountSummary.totalCodesWithRedemptions)} sub={`of ${fmt.number(discountSummary.totalCodes)} total`} />
                      <MetricRow label="Redemption Rate"       value={fmt.pct(discountSummary.redemptionRate)}             accent="#F59E0B" />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Top Code &amp; Category Breakdown" subtitle="Best performing discount and ROI by category" icon={BarChart} iconColor="#8B5CF6" link="/admin/discount-analytics" linkLabel="Leaderboard">
                  {discountOverviewLoading || (!discountOverview && firstLoad) ? (
                    <LoadingState label="Loading discount data..." />
                  ) : !discountOverview ? (
                    <div className="adm-empty">
                      <BarChart style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No data available</span>
                    </div>
                  ) : (
                    <>
                      {discountTopCode && (
                        <div className="adm-discount-top-code">
                          <div className="adm-discount-top-label">Top ROI Code</div>
                          <div className="adm-discount-top-row">
                            <span className="adm-discount-code-pill">{discountTopCode.discountCode}</span>
                            <span className="adm-discount-roi-badge" style={{ color: roiColor(discountTopCode.financials?.roi) }}>
                              {fmt.roi(discountTopCode.financials?.roi)}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="adm-metric-list" style={{ marginTop: discountTopCode ? 12 : 0 }}>
                        {(discountOverview.byCategory || []).slice(0, 5).map((cat, i) => {
                          const maxRev = Math.max(...(discountOverview.byCategory || []).map(c => c.totalRevenueInfluenced || 0)) || 1;
                          const pct    = maxRev > 0 ? (cat.totalRevenueInfluenced / maxRev) * 100 : 0;
                          const color  = ['#6366F1','#10B981','#F59E0B','#EF4444','#14B8A6'][i % 5];
                          return (
                            <div key={cat._id || i} className="adm-discount-cat-row">
                              <span className="adm-discount-cat-name">{cat._id || 'Unknown'}</span>
                              <div className="adm-discount-cat-bar-wrap">
                                <div className="adm-discount-cat-bar" style={{ width: `${pct}%`, background: color }} />
                              </div>
                              <span className="adm-discount-cat-val" style={{ color: roiColor(cat.avgROI) }}>
                                {fmt.roi(cat.avgROI)}
                              </span>
                            </div>
                          );
                        })}
                        {(!discountOverview.byCategory || discountOverview.byCategory.length === 0) && (
                          <div className="adm-empty" style={{ padding: '16px 0' }}>
                            <span>No category data yet</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </SectionCard>
              </div>
            </div>


            {/* ── Customer Analytics ────────────────────────── */}
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
                  {firstLoad ? <LoadingState label="Loading customers..." /> : (
                    <div className="adm-metric-list">
                      <MetricRow label="Total Registered" value={basicStatsFetched ? fmt.number(basicStats?.users) : <Dash />} accent="#06B6D4" />
                      <MetricRow label="Paying Customers" value={kpisReady ? fmt.number(kpis?.customers?.current) : <Dash />} accent="#8B5CF6" />
                      <MetricRow label="New This Period"  value={fmt.number(customerOverview?.newCustomers)} sub={<TrendChip value={customerOverview?.newCustomersGrowth || 0} />} />
                      <MetricRow label="Active Customers" value={fmt.number(customerOverview?.activeCustomers)} />
                      <MetricRow label="Avg. Order Value" value={fmt.currency(customerOverview?.avgOrderValue)}    accent="#10B981" />
                      <MetricRow label="Customer LTV"     value={fmt.currency(customerOverview?.avgLifetimeValue)} accent="#8B5CF6" />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Segment Distribution" icon={BarChart} iconColor="#8B5CF6" link="/admin/customers">
                  {firstLoad ? <LoadingState label="Loading segments..." /> : safeSegments.length === 0 ? (
                    <div className="adm-empty">
                      <CheckCircle style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No segment data available</span>
                    </div>
                  ) : (
                    <div className="adm-segment-list">
                      {safeSegments.map((seg, i) => (
                        <div key={i} className="adm-segment-row">
                          <div className="adm-segment-label">{seg.name}</div>
                          <div className="adm-segment-bar-wrap">
                            <div className="adm-segment-bar" style={{ width: `${seg.percentage || 0}%`, background: ['#6366F1','#10B981','#F59E0B','#EF4444','#06B6D4'][i % 5] }} />
                          </div>
                          <div className="adm-segment-pct">{fmt.pct(seg.percentage)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Top Customers" icon={ManageAccounts} iconColor="#A855F7" link="/admin/customers">
                  {firstLoad ? <LoadingState label="Loading top customers..." /> : !topPerformers?.customers?.length ? (
                    <div className="adm-empty">
                      <People style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No customer data available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      {topPerformers.customers.slice(0, 5).map((c, i) => (
                        <MetricRow key={i} label={c.name || c.email || `Customer #${i + 1}`} value={fmt.currency(c.totalSpent)} sub={`${fmt.number(c.orderCount)} orders`} accent="#A855F7" />
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Marketing Attribution ─────────────────────── */}
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
                  {firstLoad ? <LoadingState label="Loading channels..." /> : channelData.length === 0 ? (
                    <div className="adm-empty">
                      <CampaignOutlined style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No channel data available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      {channelData.slice(0, 6).map((ch, i) => (
                        <div key={i} className="adm-channel-row">
                          <span className="adm-channel-dot" style={{ background: ['#F59E0B','#6366F1','#10B981','#EF4444','#06B6D4','#8B5CF6'][i % 6] }} />
                          <span className="adm-channel-name">{ch.channel || ch.name || ch.source}</span>
                          <span className="adm-channel-sessions">{fmt.number(ch.sessions || ch.orders)} {ch.sessions ? 'sessions' : 'orders'}</span>
                          <span className="adm-channel-revenue" style={{ color: '#10B981' }}>{fmt.compact(ch.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Device Performance" icon={DevicesOther} iconColor="#6366F1" link="/admin/attribution">
                  {firstLoad ? <LoadingState label="Loading device data..." /> : deviceData.length === 0 ? (
                    <div className="adm-empty">
                      <DevicesOther style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No device data available</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={deviceData} dataKey="sessions" nameKey="device" cx="50%" cy="50%" outerRadius={80}
                          label={({ device, percent }) => `${device} ${(percent * 100).toFixed(0)}%`}>
                          {deviceData.map((_, i) => <Cell key={i} fill={['#6366F1','#10B981','#F59E0B'][i % 3]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Checkout Analytics ────────────────────────── */}
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
                  {firstLoad ? <LoadingState label="Loading checkout data..." /> : !checkoutAbandonment ? (
                    <div className="adm-empty"><ShoppingCartCheckout style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No checkout data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Abandonment Rate"    value={fmt.pct(checkoutAbandonment.abandonmentRate)}       accent="#EF4444" />
                      <MetricRow label="Completed Checkouts" value={fmt.number(checkoutAbandonment.completedCheckouts)} accent="#10B981" />
                      <MetricRow label="Abandoned Checkouts" value={fmt.number(checkoutAbandonment.abandonedCheckouts)} />
                      <MetricRow label="Lost Revenue"        value={fmt.currency(checkoutAbandonment.lostRevenue)}      accent="#F59E0B" />
                      <MetricRow label="Recovery Rate"       value={fmt.pct(checkoutAbandonment.recoveryRate)}          accent="#06B6D4" />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Abandonment by Step" icon={FactCheck} iconColor="#8B5CF6">
                  {firstLoad ? <LoadingState label="Loading step data..." /> : !checkoutAbandonment?.stepBreakdown?.length ? (
                    <div className="adm-empty"><CheckCircle style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No checkout abandonment steps recorded</span></div>
                  ) : (
                    <div className="adm-segment-list">
                      {checkoutAbandonment.stepBreakdown.map((step, i) => (
                        <div key={i} className="adm-segment-row">
                          <div className="adm-segment-label">{step.step}</div>
                          <div className="adm-segment-bar-wrap"><div className="adm-segment-bar" style={{ width: `${step.dropOffRate || 0}%`, background: '#8B5CF6' }} /></div>
                          <div className="adm-segment-pct">{fmt.pct(step.dropOffRate)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Recovery Opportunities" icon={CurrencyExchange} iconColor="#14B8A6" link="/admin/checkout">
                  {firstLoad ? <LoadingState label="Loading recovery data..." /> : !checkoutAbandonment ? (
                    <div className="adm-empty"><CurrencyExchange style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No recovery data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Recoverable Revenue" value={fmt.currency(checkoutAbandonment.recoverableRevenue)} accent="#14B8A6" />
                      <MetricRow label="High Priority"       value={fmt.number(checkoutAbandonment.highPriority)}         accent="#EF4444" />
                      <MetricRow label="Emails Sent"         value={fmt.number(checkoutAbandonment.emailsSent)} />
                      <MetricRow label="Recovered Orders"    value={fmt.number(checkoutAbandonment.recoveredOrders)}      accent="#10B981" />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Recovery Email Manager" subtitle="Send & track cart recovery emails" icon={MarkEmailRead} iconColor="#FF6B6B" link="/admin/recovery-emails" linkLabel="Open Manager">
                  {firstLoad ? <LoadingState label="Loading recovery data..." /> : (
                    <div className="adm-metric-list">
                      <MetricRow label="Emails Sent"      value={fmt.number(checkoutAbandonment?.emailsSent)}      accent="#FF6B6B" />
                      <MetricRow label="Recovered Orders" value={fmt.number(checkoutAbandonment?.recoveredOrders)} accent="#10B981" />
                      <MetricRow label="Recovery Rate"    value={fmt.pct(checkoutAbandonment?.recoveryRate)}        accent="#06B6D4" />
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Product Performance ───────────────────────── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                    <Inventory style={{ fontSize: 16 }} />
                  </span>
                  Product Performance
                </h2>
                <Link to="/admin/products" className="adm-section-link">View Products <KeyboardArrowRight style={{ fontSize: 16 }} /></Link>
              </div>
              <div className="adm-charts-row">
                <SectionCard title="Top Products" icon={Storefront} iconColor="#3B82F6" link="/admin/products">
                  {firstLoad ? <LoadingState label="Loading products..." /> : !topPerformers?.products?.length ? (
                    <div className="adm-empty"><Storefront style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No product data available</span></div>
                  ) : (
                    <div className="adm-product-list">
                      <div className="adm-table-hd"><span>Product</span><span>Sales</span><span>Revenue</span><span>Trend</span></div>
                      {topPerformers.products.slice(0, 6).map((p, i) => (
                        <div key={i} className="adm-table-row">
                          <span className="adm-table-name">{p.name}</span>
                          <span>{fmt.number(p.salesCount)}</span>
                          <span style={{ color: '#10B981', fontWeight: 700 }}>{fmt.compact(p.revenue)}</span>
                          <TrendChip value={p.growth} />
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Inventory Alerts" icon={Warning} iconColor="#F59E0B" link="/admin/products">
                  {firstLoad ? <LoadingState label="Loading inventory alerts..." /> : !lowStockAlerts ? (
                    <div className="adm-empty"><Warning style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No inventory alert data</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Low Stock Items"  value={fmt.number(lowStockAlerts.lowStockCount)}         accent="#F59E0B" />
                      <MetricRow label="Out of Stock"     value={fmt.number(lowStockAlerts.outOfStockCount)}       accent="#EF4444" />
                      <MetricRow label="Reorder Needed"   value={fmt.number(lowStockAlerts.reorderCount)}          accent="#F97316" />
                      <MetricRow label="Inventory Value"  value={fmt.currency(lowStockAlerts.totalInventoryValue)} accent="#3B82F6" />
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

            {/* ── Operational Metrics ───────────────────────── */}
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
                  {firstLoad ? <LoadingState label="Loading fulfillment data..." /> : !fulfillmentAnalytics ? (
                    <div className="adm-empty"><LocalShipping style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No fulfillment data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="On-Time Rate"         value={fmt.pct(fulfillmentAnalytics.onTimeRate)}                              accent="#10B981" />
                      <MetricRow label="Avg. Processing Time" value={`${fulfillmentAnalytics.avgProcessingTime?.toFixed(1) || '-'} hrs`} />
                      <MetricRow label="Avg. Shipping Time"   value={`${fulfillmentAnalytics.avgShippingTime?.toFixed(1)  || '-'} days`} />
                      <MetricRow label="Pending Shipments"    value={fmt.number(fulfillmentAnalytics.pendingShipments)}                    accent="#F59E0B" />
                      <MetricRow label="Delivered Today"      value={fmt.number(fulfillmentAnalytics.deliveredToday)}                      accent="#10B981" />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="SLA Compliance" icon={FactCheck} iconColor="#8B5CF6">
                  {firstLoad ? <LoadingState label="Loading SLA data..." /> : !slaBreaches ? (
                    <div className="adm-empty"><FactCheck style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No SLA data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Compliance Rate"      value={fmt.pct(slaBreaches.complianceRate)}      accent="#10B981" />
                      <MetricRow label="Total Breaches"       value={fmt.number(slaBreaches.totalBreaches)}    accent="#EF4444" />
                      <MetricRow label="Critical Breaches"    value={fmt.number(slaBreaches.criticalBreaches)} accent="#DC2626" />
                      <MetricRow label="Avg. Resolution Time" value={`${slaBreaches.avgResolutionTime?.toFixed(1) || '-'} hrs`} />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Fraud Detection" icon={Security} iconColor="#EF4444">
                  {firstLoad ? <LoadingState label="Loading fraud data..." /> : !fraudAnalytics ? (
                    <div className="adm-empty"><Security style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No fraud data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Fraud Rate"      value={fmt.pct(fraudAnalytics.fraudRate)}         accent="#EF4444" />
                      <MetricRow label="Flagged Orders"  value={fmt.number(fraudAnalytics.flaggedOrders)}  accent="#F59E0B" />
                      <MetricRow label="Confirmed Fraud" value={fmt.number(fraudAnalytics.confirmedFraud)} accent="#DC2626" />
                      <MetricRow label="Revenue Saved"   value={fmt.currency(fraudAnalytics.revenueSaved)} accent="#10B981" />
                      <MetricRow label="Pending Review"  value={fmt.number(fraudAnalytics.pendingReview)} />
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Returns Analytics ─────────────────────────── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#EF444415', color: '#EF4444' }}>
                    <ReplayCircleFilled style={{ fontSize: 16 }} />
                  </span>
                  Returns Analytics
                </h2>
                <Link to="/admin/returns" className="adm-section-link">Manage Returns <KeyboardArrowRight style={{ fontSize: 16 }} /></Link>
              </div>
              <div className="adm-charts-row">
                <SectionCard title="Returns Overview" icon={ReplayCircleFilled} iconColor="#EF4444">
                  {firstLoad ? <LoadingState label="Loading returns data..." /> : !returnOverview ? (
                    <div className="adm-empty"><ReplayCircleFilled style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No returns data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Total Returns"    value={fmt.number(returnOverview.totalReturns)} />
                      <MetricRow label="Return Rate"      value={fmt.pct(returnOverview.returnRate)}              accent="#EF4444" />
                      <MetricRow label="Pending Review"   value={fmt.number(returnOverview.byStatus?.requested)}  accent="#F59E0B" />
                      <MetricRow label="Completed"        value={fmt.number(returnOverview.byStatus?.completed)}  accent="#10B981" />
                      <MetricRow label="Approved Value"   value={fmt.compact(returnOverview.creditMetrics?.totalApprovedGross ?? 0)} accent="#EF4444" />
                      <MetricRow label="Avg. Processing"  value={`${returnOverview.avgProcessingDays?.toFixed(1) || '-'} days`} />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Top Return Reasons" icon={Assessment} iconColor="#F97316" link="/admin/returns">
                  {firstLoad ? <LoadingState label="Loading return reasons..." /> : !returnOverview?.byReason?.length ? (
                    <div className="adm-empty"><CheckCircle style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No return reasons data available</span></div>
                  ) : (
                    <div className="adm-segment-list">
                      {(() => {
                        const total = returnOverview.byReason.reduce((s, r) => s + (r.count || 0), 0);
                        return returnOverview.byReason.slice(0, 5).map((r, i) => {
                          const pct = total > 0 ? (r.count / total) * 100 : 0;
                          return (
                            <div key={i} className="adm-segment-row">
                              <div className="adm-segment-label">{r._id || 'Unknown'}</div>
                              <div className="adm-segment-bar-wrap">
                                <div className="adm-segment-bar" style={{ width: `${pct}%`, background: '#EF4444' }} />
                              </div>
                              <div className="adm-segment-pct">{pct.toFixed(1)}%</div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Refunds Analytics ─────────────────────────── */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#14B8A615', color: '#14B8A6' }}>
                    <CurrencyExchange style={{ fontSize: 16 }} />
                  </span>
                  Refunds Analytics
                </h2>
                <Link to="/admin/refunds" className="adm-section-link">Manage Refunds <KeyboardArrowRight style={{ fontSize: 16 }} /></Link>
              </div>
              <div className="adm-charts-row">
                <SectionCard title="Refunds Overview" icon={CurrencyExchange} iconColor="#14B8A6">
                  {firstLoad ? <LoadingState label="Loading refund data..." /> : !refundOverview ? (
                    <div className="adm-empty"><CurrencyExchange style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No refund data available</span></div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Total Refunds"     value={fmt.number(refundOverview.totalRefunds)} />
                      <MetricRow label="Refund Rate"       value={fmt.pct(refundOverview.refundRate)}             accent="#14B8A6" />
                      <MetricRow label="Pending Refunds"   value={fmt.number(refundOverview.pending)}             accent="#F59E0B" />
                      <MetricRow label="Total Refunded"    value={fmt.currency(refundOverview.totalAmount)}       accent="#EF4444" />
                      <MetricRow label="Avg. Refund Value" value={fmt.currency(refundOverview.avgAmount)} />
                      <MetricRow label="Avg. Processing"   value={`${refundOverview.avgProcessingTime?.toFixed(1) || '-'} hrs`} />
                    </div>
                  )}
                </SectionCard>
                <SectionCard title="Refund Status Breakdown" icon={BarChart} iconColor="#8B5CF6" link="/admin/refunds">
                  {firstLoad ? <LoadingState label="Loading refund status..." /> : !refundOverview?.statusBreakdown?.length || refundOverview.statusBreakdown.every(s => s.count === 0) ? (
                    <div className="adm-empty"><CheckCircle style={{ fontSize: 36, color: '#9CA3AF' }} /><span>No refund status data available</span></div>
                  ) : (
                    <div className="adm-segment-list">
                      {refundOverview.statusBreakdown.filter(s => s.count > 0).map((s, i) => (
                        <div key={i} className="adm-segment-row">
                          <div className="adm-segment-label">{s.status}</div>
                          <div className="adm-segment-bar-wrap">
                            <div className="adm-segment-bar" style={{ width: `${s.percentage || 0}%`, background: ['#10B981','#F59E0B','#EF4444','#06B6D4','#8B5CF6'][i % 5] }} />
                          </div>
                          <div className="adm-segment-pct">{fmt.number(s.count)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ── Alerts & Quick Stats ──────────────────────── */}
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
                  {firstLoad ? <LoadingState label="Loading alerts..." /> : alerts.length === 0 ? (
                    <div className="adm-empty"><CheckCircle style={{ fontSize: 36, color: '#10B981' }} /><span>All systems operational</span></div>
                  ) : (
                    <div className="adm-alert-feed">
                      {alerts.slice(0, 8).map((a, i) => (
                        <div key={i} className={`adm-alert-item adm-alert-item--${a.severity || 'info'}`}>
                          <div className="adm-alert-item-icon">
                            {a.severity === 'critical' ? <ErrorOutline style={{ fontSize: 16, color: '#EF4444' }} />
                              : a.severity === 'warning' ? <Warning style={{ fontSize: 16, color: '#F59E0B' }} />
                              : <CheckCircle style={{ fontSize: 16, color: '#10B981' }} />}
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
                    {quickStats.map((s, i) => (
                      <div key={i} className="adm-quick-stat">
                        <span className="adm-quick-icon" style={{ background: s.color + '15', color: s.color }}>
                          <s.icon style={{ fontSize: 16 }} />
                        </span>
                        <span className="adm-quick-value">{s.value === null ? <Dash /> : fmt.number(s.value)}</span>
                        <span className="adm-quick-label">{s.label}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}