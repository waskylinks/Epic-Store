import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import {
  Dashboard as DashboardIcon,
  TrendingUp, TrendingDown,
  ShoppingCart, Inventory,
  Assessment,
  StarOutline,
  MarkEmailRead,
  AttachMoney, Menu, Close,
  Warning, CheckCircle,
  ManageAccounts,
  KeyboardArrowRight,
  ReplayCircleFilled,
  CurrencyExchange,
  FactCheck,
  BarChart,
  Storefront,
  PersonSearch,
  CampaignOutlined,
  ShoppingCartCheckout,
  AccountBalanceWallet,
  Timeline,
  PieChartOutlined,
  CompareArrows,
} from '@mui/icons-material';
import {
  AreaChart, Area,
  BarChart as ReBarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchRefundOverview,
  fetchRefundsByPaymentMethod,
  fetchRefundTimeline,
} from '../features/analytics/operationsSlice';
import { setActiveTimeframe } from '../features/analytics/dashboardSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/Dashboard.css';
import '../AdminStyles/RefundAnalytics.css';

// ─── NAV ─────────────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  { group: 'Overview', items: [{ path: '/admin/dashboard', icon: DashboardIcon, label: 'Dashboard', color: '#6366F1' }] },
  {
    group: 'Analytics',
    items: [
      { path: '/admin/analytics',          icon: BarChart,             label: 'Overview',          color: '#8B5CF6' },
      { path: '/admin/reports',            icon: Assessment,           label: 'Reports',           color: '#EC4899' },
      { path: '/admin/customers',          icon: PersonSearch,         label: 'Customers',         color: '#06B6D4' },
      { path: '/admin/attribution',        icon: CampaignOutlined,     label: 'Attribution',       color: '#F59E0B' },
      { path: '/admin/checkout',           icon: ShoppingCartCheckout, label: 'Checkout',          color: '#10B981' },
      { path: '/admin/refund-analytics',   icon: CurrencyExchange,     label: 'Refund Analytics',  color: '#14B8A6' },
    ],
  },
  {
    group: 'Commerce',
    items: [
      { path: '/admin/products', icon: Inventory,    label: 'Products', color: '#3B82F6' },
      { path: '/admin/orders',   icon: ShoppingCart, label: 'Orders',   color: '#F97316' },
    ],
  },
  { group: 'Management', items: [{ path: '/admin/users', icon: ManageAccounts, label: 'Users', color: '#A855F7' }] },
  {
    group: 'Operations',
    items: [
      { path: '/admin/returns',         icon: ReplayCircleFilled, label: 'Returns',         color: '#EF4444' },
      { path: '/admin/refunds',         icon: CurrencyExchange,   label: 'Refunds',         color: '#14B8A6' },
      { path: '/admin/reviews',         icon: StarOutline,        label: 'Reviews',         color: '#F59E0B' },
      { path: '/admin/recovery-emails', icon: MarkEmailRead,      label: 'Recovery Emails', color: '#FF6B6B' },
    ],
  },
];

const DEBOUNCE_DELAY = 800;
const lastFetchedCache = {};

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
const fmt = {
  currency: (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:   (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:      (v) => `${(v || 0).toFixed(1)}%`,
  compact:  (v) => {
    if ((v || 0) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if ((v || 0) >= 1_000)     return `$${(v / 1_000).toFixed(0)}k`;
    return fmt.currency(v);
  },
};

// ─── REUSABLE COMPONENTS ──────────────────────────────────────────────────────
function TrendChip({ value }) {
  const isPos = (value || 0) >= 0;
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
  return <span style={{ color: '#9CA3AF', fontWeight: 400 }}>—</span>;
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
      <button
        className="adm-tf-mobile-trigger"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Change time period"
      >
        <span className="adm-tf-mobile-label">{labels[timeframe] || timeframe}</span>
        <KeyboardArrowRight style={{ fontSize: 16, transform: 'rotate(90deg)' }} />
      </button>
      {open && (
        <>
          <div className="adm-tf-sheet-overlay" onClick={() => setOpen(false)} />
          <div className="adm-tf-sheet">
            <div className="adm-tf-sheet-handle" />
            <p className="adm-tf-sheet-title">Select Time Period</p>
            {['day', 'week', 'month', 'year'].map((t) => (
              <button
                key={t}
                className={`adm-tf-sheet-btn ${timeframe === t ? 'adm-tf-sheet-btn--active' : ''}`}
                onClick={() => { onChange(t); setOpen(false); }}
                disabled={disabled}
              >
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

// ─── STATUS COLOR MAP ─────────────────────────────────────────────────────────
const STATUS_COLORS = {
  requested:  '#F59E0B',
  approved:   '#3B82F6',
  processing: '#8B5CF6',
  completed:  '#10B981',
  rejected:   '#EF4444',
  failed:     '#DC2626',
  cancelled:  '#6B7280',
};

const PIE_COLORS = ['#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#3B82F6', '#DC2626', '#6B7280'];

// ─── CUSTOM TOOLTIP ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, type = 'default' }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rfa-tooltip">
      <div className="rfa-tooltip-label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="rfa-tooltip-row">
          <span className="rfa-tooltip-dot" style={{ background: entry.color }} />
          <span className="rfa-tooltip-name">{entry.name}:</span>
          <span className="rfa-tooltip-value">
            {type === 'currency' ? fmt.currency(entry.value) : fmt.number(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN PAGE COMPONENT ──────────────────────────────────────────────────────
export default function RefundAnalytics() {
  const dispatch = useDispatch();
  const location = useLocation();

  const {
    refundOverview,
    refundsByPaymentMethod,
    refundTimeline,
    error,
  } = useSelector((s) => s.operations);

  // breakdown.byReason is dropped by the slice before writing to Redux state.
  // Capture it directly from the thunk unwrap result and store locally.
  const [localReasons, setLocalReasons] = useState([]);

  // previousPeriod is also dropped by the slice — capture from unwrap too.
  const [localPreviousPeriod, setLocalPreviousPeriod] = useState(null);

  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [timeframe,     setTimeframe]     = useState('month');
  const [lastFetchTime, setLastFetchTime] = useState(null);

  const [pageLoading, setPageLoading] = useState(!refundOverview);
  const [tfLoading,   setTfLoading]   = useState(false);

  const isMountedRef  = useRef(true);
  const requestIdRef  = useRef(0);

  const loadData = useCallback((currentTimeframe, force = false) => {
    const now  = Date.now();
    const last = lastFetchedCache[`rfa_${currentTimeframe}`] || 0;
    if (!force && now - last < 30000) {
      if (isMountedRef.current) { setPageLoading(false); setTfLoading(false); }
      return;
    }

    lastFetchedCache[`rfa_${currentTimeframe}`] = now;
    if (isMountedRef.current) setLastFetchTime(now);

    const myRequestId = ++requestIdRef.current;

    dispatch(setActiveTimeframe(currentTimeframe));

    // Reset local captures so stale data doesn't persist across timeframe switches
    if (isMountedRef.current) {
      setLocalReasons([]);
      setLocalPreviousPeriod(null);
    }

    // Dispatch refundOverview separately to capture fields the slice drops
    dispatch(fetchRefundOverview(currentTimeframe))
      .unwrap()
      .then((payload) => {
        if (!isMountedRef.current || myRequestId !== requestIdRef.current) return;
        setLocalReasons(payload?.breakdown?.byReason || []);
        setLocalPreviousPeriod(payload?.previousPeriod || null);
      })
      .catch(() => {});

    Promise.allSettled([
      dispatch(fetchRefundsByPaymentMethod(currentTimeframe)).unwrap().catch(() => {}),
      dispatch(fetchRefundTimeline({ timeframe: currentTimeframe, groupBy: 'day' })).unwrap().catch(() => {}),
    ]).finally(() => {
      if (!isMountedRef.current || myRequestId !== requestIdRef.current) return;
      setPageLoading(false);
      setTfLoading(false);
    });
  }, [dispatch]);

  const [debouncedLoad, cancelDebounce] = useDebounce(loadData, DEBOUNCE_DELAY);

  const handleTimeframeChange = useCallback((newTf) => {
    setTimeframe(newTf);
    setTfLoading(true);
    cancelDebounce();
    debouncedLoad(newTf, true);
  }, [debouncedLoad, cancelDebounce]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    isMountedRef.current = true;
    loadData('month', false);
    return () => {
      isMountedRef.current = false;
      cancelDebounce();
    };
  }, []);

  const isActive = useCallback((p) =>
    location.pathname === p || location.pathname.startsWith(p + '/'),
  [location.pathname]);

  // ─── Derived data ──────────────────────────────────────────────────────────

  // Timeline chart — controller returns timeline[].{_id, totalRefunds, totalAmount, completed}
  const timelineData = refundTimeline?.timeline?.map((t) => ({
    date:      t._id,
    refunds:   t.totalRefunds  || 0,
    amount:    t.totalAmount   || 0,
    completed: t.completed     || 0,
  })) || [];

  // Status breakdown pie — slice stores statusBreakdown[]
  const statusPieData = (refundOverview?.statusBreakdown || [])
    .filter((s) => s.count > 0)
    .map((s) => ({
      name:  s.status.charAt(0).toUpperCase() + s.status.slice(1),
      value: s.count,
      pct:   s.percentage,
      color: STATUS_COLORS[s.status] || '#6B7280',
    }));

  // Reasons: local capture from unwrap (slice drops breakdown.byReason)
  const reasonsData = localReasons.map((r, i) => ({
    reason: r._id || 'Unknown',
    count:  r.count || 0,
    amount: r.totalAmount || 0,
    fill:   PIE_COLORS[i % PIE_COLORS.length],
  }));

  // Payment method data — slice stores refundsByPaymentMethod.byPaymentMethod[]
  const paymentMethodData = refundsByPaymentMethod?.byPaymentMethod || [];

  // Overall refund rate for summary row: total completed refunds / total orders across all methods
  const summaryTotalOrders = paymentMethodData.reduce((sum, m) => sum + (m.totalOrders || 0), 0);
  const summaryOverallRate = summaryTotalOrders > 0
    ? Math.round((refundsByPaymentMethod?.summary?.totalRefunds || 0) / summaryTotalOrders * 100 * 100) / 100
    : 0;

  // Period comparison — previousPeriod captured from unwrap (slice drops it)
  // Controller shape: { totalRefunds, totalRefundAmount }
  const prevTotal  = localPreviousPeriod?.totalRefunds      || 0;
  const prevAmount = localPreviousPeriod?.totalRefundAmount  || 0;
  const currTotal  = refundOverview?.totalRefunds  || 0;
  const currAmount = refundOverview?.totalAmount   || 0;

  // Refund completion rate: completed / totalRefunds * 100
  const completedCount = (refundOverview?.statusBreakdown || [])
    .find((s) => s.status === 'completed')?.count || 0;
  const conversionRate = currTotal > 0
    ? Math.round((completedCount / currTotal) * 1000) / 10
    : 0;

  // KPI cards — all sourced from refundOverview (slice fields) only
  const kpiCards = [
    {
      key: 'totalRefunds', label: 'Total Refunds', icon: CurrencyExchange,
      accent: '#14B8A6', bg: '#14B8A615',
      value:  refundOverview ? fmt.number(refundOverview.totalRefunds) : null,
      change: refundOverview?.trends?.refunds,
    },
    {
      key: 'totalAmount', label: 'Total Refunded', icon: AttachMoney,
      accent: '#EF4444', bg: '#EF444415',
      value:  refundOverview ? fmt.currency(refundOverview.totalAmount) : null,
      change: refundOverview?.trends?.amount,
    },
    {
      key: 'refundRate', label: 'Refund Rate', icon: PieChartOutlined,
      accent: '#F59E0B', bg: '#F59E0B15',
      value:  refundOverview ? fmt.pct(refundOverview.refundRate) : null,
    },
    {
      key: 'pending', label: 'Pending', icon: Warning,
      accent: '#F97316', bg: '#F9731615',
      value:  refundOverview ? fmt.number(refundOverview.pending) : null,
    },
    {
      key: 'avgAmount', label: 'Avg. Refund Value', icon: AccountBalanceWallet,
      accent: '#8B5CF6', bg: '#8B5CF615',
      value:  refundOverview ? fmt.currency(refundOverview.avgAmount) : null,
    },
    {
      key: 'avgProcessing', label: 'Avg. Processing', icon: Timeline,
      accent: '#06B6D4', bg: '#06B6D415',
      // Controller stores avgProcessingTime in hours (renamed from avgProcessingDays in fix)
      value:  refundOverview ? `${(refundOverview.avgProcessingTime || 0).toFixed(1)} hrs` : null,
    },
    {
      key: 'completedCount', label: 'Completed Refunds', icon: CheckCircle,
      accent: '#10B981', bg: '#10B98115',
      value:  refundOverview ? fmt.number(completedCount) : null,
    },
    {
      key: 'conversionRate', label: 'Refund Completion Rate', icon: TrendingUp,
      accent: '#10B981', bg: '#10B98115',
      value:  refundOverview ? fmt.pct(conversionRate) : null,
    },
  ];

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="adm-wrap">

        {/* ── Sidebar ── */}
        <aside className={`adm-sidebar ${sidebarOpen ? 'adm-sidebar--open' : ''}`}>
          <div className="adm-sidebar-logo">
            <span className="adm-logo-mark"><DashboardIcon style={{ fontSize: 20 }} /></span>
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
                          color:      active ? item.color : undefined,
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

        {sidebarOpen && <div className="adm-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* ── Main ── */}
        <div className="adm-main">
          <div className="adm-page-hd">
            <div className="adm-page-hd-left">
              <button
                className="adm-menu-btn"
                onClick={() => setSidebarOpen((prev) => !prev)}
                aria-label="Toggle menu"
              >
                {sidebarOpen ? <Close style={{ fontSize: 22 }} /> : <Menu style={{ fontSize: 22 }} />}
              </button>
              <div>
                <h1 className="adm-page-title">Refund Analytics</h1>
                <p className="adm-page-sub">Revenue intelligence — refund trends, reasons &amp; payment breakdown</p>
              </div>
            </div>
            <div className="adm-page-hd-right">
              <LastUpdated timestamp={lastFetchTime} />
              <div className="adm-timeframe">
                {['day', 'week', 'month', 'year'].map((t) => (
                  <button
                    key={t}
                    className={`adm-tf-btn ${timeframe === t ? 'adm-tf-btn--active' : ''}`}
                    onClick={() => handleTimeframeChange(t)}
                    disabled={tfLoading}
                    aria-pressed={timeframe === t}
                  >
                    {tfLoading && timeframe === t ? <span className="adm-tf-spinner" /> : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <TimeframeSheet timeframe={timeframe} onChange={handleTimeframeChange} disabled={tfLoading} />
            </div>
          </div>

          <div className="adm-content">
            {error && (
              <div className="adm-error-banner">
                <Warning style={{ fontSize: 18 }} />
                <span>{typeof error === 'string' ? error : 'Failed to load refund analytics data.'}</span>
              </div>
            )}

            {/* ── Breadcrumb ── */}
            <div className="rfa-breadcrumb">
              <Link to="/admin/analytics" className="rfa-breadcrumb-link">Analytics Overview</Link>
              <span className="rfa-breadcrumb-sep">/</span>
              <span className="rfa-breadcrumb-current">Refund Analytics</span>
              <Link to="/admin/refunds" className="rfa-manage-btn">
                <CurrencyExchange style={{ fontSize: 14 }} /> Manage Refunds
              </Link>
            </div>

            {/* ══ SECTION 1: KPI Cards ══════════════════════════════════════ */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#14B8A615', color: '#14B8A6' }}>
                    <CurrencyExchange style={{ fontSize: 16 }} />
                  </span>
                  Refund KPIs
                </h2>
                {refundOverview?.trends?.refunds !== undefined && !tfLoading && (
                  <TrendChip value={refundOverview.trends.refunds} />
                )}
                {tfLoading && <span className="adm-kpi-refreshing">Refreshing…</span>}
              </div>
              <div className={`adm-kpi-grid ${tfLoading ? 'adm-kpi-grid--loading' : ''}`}>
                {pageLoading
                  ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)
                  : kpiCards.map((k) => (
                      <div key={k.key} className="adm-kpi-card">
                        <div className="adm-kpi-top">
                          <span className="adm-kpi-icon" style={{ background: k.bg, color: k.accent }}>
                            <k.icon style={{ fontSize: 20 }} />
                          </span>
                          {k.change !== undefined && !tfLoading && <TrendChip value={k.change} />}
                        </div>
                        <div className="adm-kpi-label">{k.label}</div>
                        <div className="adm-kpi-value">{k.value ?? <Dash />}</div>
                      </div>
                    ))
                }
              </div>
            </div>

            {/* ══ SECTION 2: Period Comparison Banner ═══════════════════════ */}
            {/* prevTotal/prevAmount now sourced from localPreviousPeriod (unwrap capture) */}
            {!pageLoading && refundOverview && (
              <div className="adm-section">
                <div className="rfa-compare-banner">
                  <div className="rfa-compare-item">
                    <span className="rfa-compare-label">Current Period Refunds</span>
                    <span className="rfa-compare-val" style={{ color: '#14B8A6' }}>{fmt.number(currTotal)}</span>
                  </div>
                  <div className="rfa-compare-arrow">
                    <CompareArrows style={{ fontSize: 28, color: '#9CA3AF' }} />
                  </div>
                  <div className="rfa-compare-item">
                    <span className="rfa-compare-label">Previous Period Refunds</span>
                    <span className="rfa-compare-val" style={{ color: '#6B7280' }}>{fmt.number(prevTotal)}</span>
                  </div>
                  <div className="rfa-compare-divider" />
                  <div className="rfa-compare-item">
                    <span className="rfa-compare-label">Current Period Amount</span>
                    <span className="rfa-compare-val" style={{ color: '#EF4444' }}>{fmt.currency(currAmount)}</span>
                  </div>
                  <div className="rfa-compare-arrow">
                    <CompareArrows style={{ fontSize: 28, color: '#9CA3AF' }} />
                  </div>
                  <div className="rfa-compare-item">
                    <span className="rfa-compare-label">Previous Period Amount</span>
                    <span className="rfa-compare-val" style={{ color: '#6B7280' }}>{fmt.currency(prevAmount)}</span>
                  </div>
                  <div className="rfa-compare-divider" />
                  <div className="rfa-compare-item">
                    <span className="rfa-compare-label">Refund Completion Rate</span>
                    <span className="rfa-compare-val" style={{ color: '#10B981' }}>{fmt.pct(conversionRate)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ══ SECTION 3: Refund Timeline Chart ═════════════════════════ */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#6366F115', color: '#6366F1' }}>
                    <Timeline style={{ fontSize: 16 }} />
                  </span>
                  Refund Timeline
                </h2>
                {/* summary sourced from refundTimeline.summary — controller shape */}
                <span className="adm-section-link" style={{ cursor: 'default' }}>
                  {refundTimeline?.summary
                    ? `${fmt.number(refundTimeline.summary.totalRefunds)} total · ${fmt.currency(refundTimeline.summary.totalAmount)} refunded`
                    : ''}
                </span>
              </div>
              <div className="adm-charts-row">
                {/* Volume over time */}
                <SectionCard
                  title="Refund Volume Over Time"
                  subtitle={`Daily breakdown · ${timeframe} view`}
                  icon={BarChart}
                  iconColor="#6366F1"
                >
                  {pageLoading ? <LoadingState label="Loading timeline..." /> : timelineData.length === 0 ? (
                    <div className="adm-empty">
                      <Timeline style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No timeline data for this period</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={timelineData}>
                        <defs>
                          <linearGradient id="rfaVolumeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="rfaCompletedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#10B981" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area
                          type="monotone"
                          dataKey="refunds"
                          name="Total Refunds"
                          stroke="#6366F1"
                          strokeWidth={2}
                          fill="url(#rfaVolumeGrad)"
                          dot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="completed"
                          name="Completed"
                          stroke="#10B981"
                          strokeWidth={2}
                          fill="url(#rfaCompletedGrad)"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>

                {/* Amount over time */}
                <SectionCard
                  title="Refund Amount Over Time"
                  subtitle="Revenue impact per day"
                  icon={AttachMoney}
                  iconColor="#EF4444"
                >
                  {pageLoading ? <LoadingState label="Loading amount timeline..." /> : timelineData.length === 0 ? (
                    <div className="adm-empty">
                      <AttachMoney style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No amount data for this period</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={timelineData}>
                        <defs>
                          <linearGradient id="rfaAmountGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip content={<CustomTooltip type="currency" />} />
                        <Area
                          type="monotone"
                          dataKey="amount"
                          name="Amount Refunded"
                          stroke="#EF4444"
                          strokeWidth={2}
                          fill="url(#rfaAmountGrad)"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ══ SECTION 4: Status & Reasons Breakdown ════════════════════ */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#8B5CF615', color: '#8B5CF6' }}>
                    <PieChartOutlined style={{ fontSize: 16 }} />
                  </span>
                  Status &amp; Reasons Breakdown
                </h2>
              </div>
              <div className="adm-cards-3">
                {/* Status breakdown pie */}
                <SectionCard title="Refund Status Distribution" icon={PieChartOutlined} iconColor="#8B5CF6">
                  {pageLoading ? <LoadingState label="Loading status data..." /> : statusPieData.length === 0 ? (
                    <div className="adm-empty">
                      <PieChartOutlined style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No status data available</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={statusPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={75}
                          label={({ cx, cy, midAngle, innerRadius, outerRadius, pct }) => {
                            const RADIAN = Math.PI / 180;
                            const radius = outerRadius + 22;
                            const x = cx + radius * Math.cos(-midAngle * RADIAN);
                            const y = cy + radius * Math.sin(-midAngle * RADIAN);
                            return (
                              <text x={x} y={y} fill="#374151" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight={600}>
                                {`${pct}%`}
                              </text>
                            );
                          }}
                          labelLine={{ stroke: '#D1D5DB', strokeWidth: 1 }}
                        >
                          {statusPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
                          formatter={(v, name) => [fmt.number(v), name]}
                        />
                        <Legend
                          iconType="circle"
                          iconSize={8}
                          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>

                {/* Status counts list */}
                <SectionCard title="Status Counts" icon={FactCheck} iconColor="#14B8A6" link="/admin/refunds" linkLabel="Manage">
                  {pageLoading ? <LoadingState label="Loading status counts..." /> : !refundOverview?.statusBreakdown?.length ? (
                    <div className="adm-empty">
                      <CheckCircle style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No status breakdown available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      {refundOverview.statusBreakdown.map((s, i) => (
                        <div key={i} className="adm-metric-row">
                          <div className="adm-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              className="rfa-status-dot"
                              style={{ background: STATUS_COLORS[s.status] || '#6B7280' }}
                            />
                            {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="rfa-status-bar-wrap">
                              <div
                                className="rfa-status-bar"
                                style={{
                                  width: `${s.percentage || 0}%`,
                                  background: STATUS_COLORS[s.status] || '#6B7280',
                                }}
                              />
                            </div>
                            <div className="adm-metric-value" style={{ color: STATUS_COLORS[s.status] || '#111827' }}>
                              {fmt.number(s.count)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {/* Top refund reasons — sourced from localReasons (unwrap capture) */}
                <SectionCard title="Top Refund Reasons" icon={Assessment} iconColor="#F97316">
                  {pageLoading ? <LoadingState label="Loading reasons..." /> : reasonsData.length === 0 ? (
                    <div className="adm-empty">
                      <Assessment style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No reason data available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      {reasonsData.slice(0, 6).map((r, i) => (
                        <div key={i} className="adm-metric-row">
                          <div className="adm-metric-label">
                            <span className="rfa-reason-badge" style={{ background: r.fill + '20', color: r.fill }}>
                              {i + 1}
                            </span>
                            {r.reason}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                            <div className="adm-metric-value">{fmt.number(r.count)}</div>
                            <div className="adm-metric-sub">{fmt.currency(r.amount)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ══ SECTION 5: Payment Method Breakdown ══════════════════════ */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                    <AccountBalanceWallet style={{ fontSize: 16 }} />
                  </span>
                  Refunds by Payment Method
                </h2>
                {refundsByPaymentMethod?.summary?.topMethod && (
                  <span className="rfa-top-method-badge">
                    Top: {refundsByPaymentMethod.summary.topMethod}
                  </span>
                )}
              </div>
              <div className="adm-charts-row">
                {/* Bar chart */}
                <SectionCard
                  title="Refund Count by Method"
                  subtitle="Total refunds per payment gateway"
                  icon={BarChart}
                  iconColor="#3B82F6"
                >
                  {pageLoading ? <LoadingState label="Loading payment methods..." /> : paymentMethodData.length === 0 ? (
                    <div className="adm-empty">
                      <AccountBalanceWallet style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No payment method data available</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <ReBarChart data={paymentMethodData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
                        <YAxis
                          type="category"
                          dataKey="paymentMethod"
                          tick={{ fontSize: 11, fill: '#6B7280' }}
                          width={90}
                        />
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
                          formatter={(v) => [fmt.number(v), 'Refunds']}
                        />
                        <Bar dataKey="totalRefunds" name="Refunds" radius={[0, 4, 4, 0]}>
                          {paymentMethodData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Bar>
                      </ReBarChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>

                {/* Method details table */}
                <SectionCard
                  title="Payment Method Details"
                  subtitle="Refund rate &amp; amounts per gateway"
                  icon={AccountBalanceWallet}
                  iconColor="#06B6D4"
                >
                  {pageLoading ? <LoadingState label="Loading method details..." /> : paymentMethodData.length === 0 ? (
                    <div className="adm-empty">
                      <AccountBalanceWallet style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No payment method details</span>
                    </div>
                  ) : (
                    <div className="rfa-method-table">
                      <div className="rfa-method-table-hd">
                        <span>Method</span>
                        <span>Refunds</span>
                        <span>Amount</span>
                        <span>Rate</span>
                      </div>
                      {paymentMethodData.map((m, i) => (
                        <div key={i} className="rfa-method-table-row">
                          <span className="rfa-method-name">
                            <span
                              className="rfa-method-dot"
                              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            {m.paymentMethod || 'Unknown'}
                          </span>
                          <span>{fmt.number(m.totalRefunds)}</span>
                          <span style={{ color: '#EF4444', fontWeight: 700 }}>
                            {fmt.compact(m.totalRefundAmount)}
                          </span>
                          <span>
                            <span
                              className="rfa-rate-chip"
                              style={{
                                background: m.refundRate > 10 ? '#FEE2E2' : '#DCFCE7',
                                color:      m.refundRate > 10 ? '#991B1B' : '#166534',
                              }}
                            >
                              {fmt.pct(m.refundRate)}
                            </span>
                          </span>
                        </div>
                      ))}
                      {refundsByPaymentMethod?.summary && (
                        <div className="rfa-method-table-footer">
                          <span>Summary</span>
                          <span>{fmt.number(refundsByPaymentMethod.summary.totalRefunds)}</span>
                          <span style={{ color: '#EF4444', fontWeight: 700 }}>
                            {fmt.compact(refundsByPaymentMethod.summary.totalRefundAmount)}
                          </span>
                          <span>
                            <span
                              className="rfa-rate-chip"
                              style={{
                                background: summaryOverallRate > 10 ? '#FEE2E2' : '#DCFCE7',
                                color:      summaryOverallRate > 10 ? '#991B1B' : '#166534',
                              }}
                            >
                              {fmt.pct(summaryOverallRate)}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            {/* ══ SECTION 6: Full Refund Overview ══════════════════════════ */}
            <div className="adm-section">
              <div className="adm-section-hd">
                <h2 className="adm-section-title">
                  <span className="adm-section-icon-wrap" style={{ background: '#10B98115', color: '#10B981' }}>
                    <Assessment style={{ fontSize: 16 }} />
                  </span>
                  Full Refund Overview
                </h2>
                <Link to="/admin/refunds" className="adm-section-link">
                  Manage Refunds <KeyboardArrowRight style={{ fontSize: 16 }} />
                </Link>
              </div>
              <div className="adm-cards-3">
                {/* Current period full breakdown */}
                <SectionCard title="Current Period Breakdown" icon={CurrencyExchange} iconColor="#14B8A6">
                  {pageLoading ? <LoadingState label="Loading overview..." /> : !refundOverview ? (
                    <div className="adm-empty">
                      <CurrencyExchange style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No overview data available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Total Refunds"     value={fmt.number(refundOverview.totalRefunds)}           />
                      <MetricRow label="Refund Rate"       value={fmt.pct(refundOverview.refundRate)}        accent="#14B8A6" />
                      <MetricRow label="Total Refunded"    value={fmt.currency(refundOverview.totalAmount)}  accent="#EF4444" />
                      <MetricRow label="Avg. Refund Value" value={fmt.currency(refundOverview.avgAmount)}             />
                      <MetricRow label="Avg. Processing"   value={`${(refundOverview.avgProcessingTime || 0).toFixed(1)} hrs`} />
                      <MetricRow label="Pending"           value={fmt.number(refundOverview.pending)}        accent="#F59E0B" />
                    </div>
                  )}
                </SectionCard>

                {/* All refund statuses */}
                <SectionCard title="All Refund Statuses" icon={FactCheck} iconColor="#8B5CF6">
                  {pageLoading ? <LoadingState label="Loading status data..." /> : !refundOverview?.statusBreakdown?.length ? (
                    <div className="adm-empty">
                      <FactCheck style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No status data available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      {refundOverview.statusBreakdown.map((s, i) => (
                        <MetricRow
                          key={i}
                          label={s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                          value={fmt.number(s.count)}
                          sub={`${s.percentage}%`}
                          accent={STATUS_COLORS[s.status]}
                        />
                      ))}
                    </div>
                  )}
                </SectionCard>

                {/* Payment method summary */}
                <SectionCard title="Payment Method Summary" icon={AccountBalanceWallet} iconColor="#3B82F6">
                  {pageLoading ? <LoadingState label="Loading payment summary..." /> : !refundsByPaymentMethod?.summary ? (
                    <div className="adm-empty">
                      <AccountBalanceWallet style={{ fontSize: 36, color: '#9CA3AF' }} />
                      <span>No payment summary available</span>
                    </div>
                  ) : (
                    <div className="adm-metric-list">
                      <MetricRow label="Total Refunds"     value={fmt.number(refundsByPaymentMethod.summary.totalRefunds)}      />
                      <MetricRow label="Total Amount"      value={fmt.currency(refundsByPaymentMethod.summary.totalRefundAmount)} accent="#EF4444" />
                      <MetricRow label="Avg. Refund"       value={fmt.currency(refundsByPaymentMethod.summary.avgRefundAmount)}             />
                      <MetricRow label="Top Gateway"       value={refundsByPaymentMethod.summary.topMethod || '—'}               accent="#3B82F6" />
                      {paymentMethodData.map((m, i) => (
                        <MetricRow
                          key={i}
                          label={m.paymentMethod}
                          value={fmt.currency(m.totalRefundAmount)}
                          sub={`${fmt.number(m.totalRefunds)} refunds · ${fmt.pct(m.refundRate)} rate`}
                          accent={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}