import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ReplayCircleFilled,
  TrendingUp, TrendingDown,
  Assessment,
  Warning, CheckCircle,
  KeyboardArrowRight,
  AttachMoney,
  Timeline,
  PieChartOutlined,
  BarChart,
  Inventory2,
  GavelOutlined,
  LocalShipping,
  Speed,
  ArrowBack,
  Category,
  Refresh,
} from '@mui/icons-material';
import {
  BarChart as ReBarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchReturnOverview,
  fetchReturnsByProduct,
  fetchReturnsByCategory,
  fetchReturnPleaAnalytics,
  fetchReturnCreditAnalytics,
  fetchReturnLifecycleTiming,
  setReturnAnalyticsTimeframe,
} from '../features/analytics/returnAnalyticsSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/ReturnAnalytics.css';

// ─── Constants ────────────────────────────────────────────────
const DEBOUNCE_DELAY = 800;
const lastFetchedCache = {};

const STATUS_COLORS = {
  requested:         '#F59E0B',
  items_reviewed:    '#8B5CF6',
  plea_submitted:    '#6366F1',
  approved:          '#3B82F6',
  in_transit:        '#06B6D4',
  received:          '#14B8A6',
  inspected:         '#10B981',
  awaiting_discount: '#F97316',
  completed:         '#16A34A',
  rejected:          '#EF4444',
  cancelled:         '#6B7280',
};

const PIE_COLORS = ['#6366F1','#10B981','#F59E0B','#EF4444','#06B6D4','#8B5CF6','#F97316','#14B8A6'];

// ─── Formatters ───────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:   (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:      (v) => `${(v || 0).toFixed(1)}%`,
  compact:  (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  days: (v) => v != null ? `${v} days` : '—',
  hrs:  (v) => v != null ? `${v} hrs`  : '—',
};

// ─── Reusable Atoms ───────────────────────────────────────────
function TrendChip({ value }) {
  if (value === undefined || value === null) return null;
  const isPos = value >= 0;
  return (
    <span className={`rta-chip ${isPos ? 'rta-chip--pos' : 'rta-chip--neg'}`}>
      {isPos ? <TrendingUp style={{ fontSize: 12 }} /> : <TrendingDown style={{ fontSize: 12 }} />}
      {isPos ? '+' : ''}{(value || 0).toFixed(1)}%
    </span>
  );
}

function SkeletonBlock({ h = 20, w = '100%', radius = 6, mb = 0 }) {
  return <div className="rta-skeleton" style={{ height: h, width: w, borderRadius: radius, marginBottom: mb }} />;
}

function KpiSkeleton() {
  return (
    <div className="rta-kpi-card">
      <SkeletonBlock h={38} w={38} radius={9} mb={14} />
      <SkeletonBlock h={12} w="55%" mb={8} />
      <SkeletonBlock h={26} w="75%" />
    </div>
  );
}

function LoadingState({ label = 'Loading data...' }) {
  return (
    <div className="rta-loading-state">
      <div className="rta-loading-spinner" />
      <span className="rta-loading-text">{label}</span>
    </div>
  );
}

function EmptyState({ icon: Icon = Assessment, label = 'No data available' }) {
  return (
    <div className="rta-empty">
      <Icon style={{ fontSize: 36, color: '#D1D5DB' }} />
      <span>{label}</span>
    </div>
  );
}

function MetricRow({ label, value, sub, accent }) {
  return (
    <div className="rta-metric-row">
      <div className="rta-metric-label">{label}</div>
      <div className="rta-metric-value" style={accent ? { color: accent } : {}}>{value ?? '—'}</div>
      {sub && <div className="rta-metric-sub">{sub}</div>}
    </div>
  );
}

function SectionCard({ title, subtitle, link, linkLabel = 'View All', children, icon: Icon, iconColor }) {
  return (
    <div className="rta-section-card">
      <div className="rta-section-card-hd">
        <div className="rta-section-card-hd-left">
          {Icon && (
            <span className="rta-section-icon" style={{ background: iconColor + '1a', color: iconColor }}>
              <Icon style={{ fontSize: 18 }} />
            </span>
          )}
          <div>
            <h3 className="rta-card-title">{title}</h3>
            {subtitle && <p className="rta-card-sub">{subtitle}</p>}
          </div>
        </div>
        {link && (
          <Link to={link} className="rta-view-link">
            {linkLabel} <KeyboardArrowRight style={{ fontSize: 16 }} />
          </Link>
        )}
      </div>
      <div className="rta-section-card-body">{children}</div>
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
    <div className="rta-last-updated">
      <span className="rta-last-updated-label">Last updated:</span>
      <span className="rta-last-updated-time">{timeAgo}</span>
    </div>
  );
}

function CustomTooltip({ active, payload, label, type = 'default' }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rta-tooltip">
      <div className="rta-tooltip-label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="rta-tooltip-row">
          <span className="rta-tooltip-dot" style={{ background: entry.color }} />
          <span className="rta-tooltip-name">{entry.name}:</span>
          <span className="rta-tooltip-value">
            {type === 'currency' ? fmt.currency(entry.value) : fmt.number(entry.value)}
          </span>
        </div>
      ))}
    </div>
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

// ─── Main Component ───────────────────────────────────────────
export default function ReturnAnalytics() {
  const dispatch = useDispatch();

  const {
    returnOverview,
    returnsByProduct,
    returnsByCategory,
    returnPleaAnalytics,
    returnCreditAnalytics,
    returnLifecycleTiming,
    error,
  } = useSelector((s) => s.returnAnalytics);

  // Capture fields dropped by the slice via unwrap
  const [localByReason,       setLocalByReason]       = useState([]);
  const [localPreviousPeriod, setLocalPreviousPeriod] = useState(null);

  const [timeframe,     setTimeframe]     = useState('month');
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [pageLoading,   setPageLoading]   = useState(!returnOverview);
  const [tfLoading,     setTfLoading]     = useState(false);

  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const loadData = useCallback((currentTimeframe, force = false) => {
    const now  = Date.now();
    const last = lastFetchedCache[`rta_${currentTimeframe}`] || 0;
    if (!force && now - last < 30000) {
      if (isMountedRef.current) { setPageLoading(false); setTfLoading(false); }
      return;
    }

    lastFetchedCache[`rta_${currentTimeframe}`] = now;
    if (isMountedRef.current) setLastFetchTime(now);

    const myRequestId = ++requestIdRef.current;

    dispatch(setReturnAnalyticsTimeframe(currentTimeframe));

    if (isMountedRef.current) {
      setLocalByReason([]);
      setLocalPreviousPeriod(null);
    }

    // fetchReturnOverview — capture dropped fields via unwrap
    dispatch(fetchReturnOverview(currentTimeframe))
      .unwrap()
      .then((payload) => {
        if (!isMountedRef.current || myRequestId !== requestIdRef.current) return;
        setLocalByReason(payload?.byReason || []);
        setLocalPreviousPeriod(payload?.previousPeriod || null);
      })
      .catch(() => {});

    Promise.allSettled([
      dispatch(fetchReturnsByProduct({ limit: 20, sortBy: 'returnRate' })).unwrap().catch(() => {}),
      dispatch(fetchReturnsByCategory()).unwrap().catch(() => {}),
      dispatch(fetchReturnPleaAnalytics(currentTimeframe)).unwrap().catch(() => {}),
      dispatch(fetchReturnCreditAnalytics(currentTimeframe)).unwrap().catch(() => {}),
      dispatch(fetchReturnLifecycleTiming(currentTimeframe)).unwrap().catch(() => {}),
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

  useEffect(() => {
    isMountedRef.current = true;
    loadData('month', false);
    return () => {
      isMountedRef.current = false;
      cancelDebounce();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived data ──────────────────────────────────────────

  // Status breakdown for pie
  const statusPieData = returnOverview?.byStatus
    ? Object.entries(returnOverview.byStatus)
        .filter(([, v]) => v > 0)
        .map(([key, value]) => ({
          name:  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          value,
          color: STATUS_COLORS[key] || '#6B7280',
          key,
        }))
    : [];

  const totalStatusCount = statusPieData.reduce((s, d) => s + d.value, 0);

  // Reasons from unwrap capture
  const reasonsData = localByReason.map((r, i) => ({
    reason: r._id || 'Unknown',
    count:  r.count || 0,
    fill:   PIE_COLORS[i % PIE_COLORS.length],
  }));

  // Category data
  const categoryData = returnsByCategory?.categories || [];

  // Product data
  const productData = returnsByProduct?.products || [];

  // Plea analytics
  const pleaReturn = returnPleaAnalytics?.returnLevel || {};
  const pleaUnit   = returnPleaAnalytics?.unitLevel   || {};
  const pleaCredit = returnPleaAnalytics?.creditMetrics || {};

  // Credit analytics
  const creditIssued   = returnCreditAnalytics?.creditIssued   || {};
  const creditRedeemed = returnCreditAnalytics?.creditRedeemed || {};
  const roiMetrics     = returnCreditAnalytics?.roiMetrics     || {};

  // Lifecycle timing
  const stageTiming       = returnLifecycleTiming?.stageTiming        || {};
  const pleaImpactTiming  = returnLifecycleTiming?.pleaImpactOnTiming || {};

  // Previous period comparison
  const prevTotal    = localPreviousPeriod?.totalReturns || 0;
  const prevComplete = localPreviousPeriod?.completed    || 0;
  const currTotal    = returnOverview?.totalReturns       || 0;

  // KPI cards
  const kpiCards = [
    {
      key: 'totalReturns', label: 'Total Returns', icon: ReplayCircleFilled,
      accent: '#EF4444', bg: '#EF444415',
      value:  returnOverview ? fmt.number(returnOverview.totalReturns) : null,
      change: returnOverview?.trend,
    },
    {
      key: 'returnRate', label: 'Return Rate', icon: PieChartOutlined,
      accent: '#F59E0B', bg: '#F59E0B15',
      value:  returnOverview ? fmt.pct(returnOverview.returnRate) : null,
    },
    {
      key: 'approvalRate', label: 'Approval Rate', icon: CheckCircle,
      accent: '#10B981', bg: '#10B98115',
      value:  returnOverview ? fmt.pct(returnOverview.approvalRate) : null,
    },
    {
      key: 'pleaRate', label: 'Plea Rate', icon: GavelOutlined,
      accent: '#6366F1', bg: '#6366F115',
      value:  returnOverview ? fmt.pct(returnOverview.pleaRate) : null,
    },
    {
      key: 'avgProcessingDays', label: 'Avg Processing', icon: Timeline,
      accent: '#06B6D4', bg: '#06B6D415',
      value:  returnOverview ? fmt.days(returnOverview.avgProcessingDays) : null,
    },
    {
      key: 'avgReviewDays', label: 'Avg Review Time', icon: Speed,
      accent: '#8B5CF6', bg: '#8B5CF615',
      value:  returnOverview ? fmt.days(returnOverview.avgReviewDays) : null,
    },
    {
      key: 'totalRequestedGross', label: 'Total Requested', icon: AttachMoney,
      accent: '#F97316', bg: '#F9731615',
      value:  returnOverview?.creditMetrics
        ? fmt.currency(returnOverview.creditMetrics.totalRequestedGross) : null,
    },
    {
      key: 'totalApprovedGross', label: 'Total Approved Value', icon: AttachMoney,
      accent: '#16A34A', bg: '#16A34A15',
      value:  returnOverview?.creditMetrics
        ? fmt.currency(returnOverview.creditMetrics.totalApprovedGross) : null,
    },
  ];

  return (
    <>
      <Navbar />
      <div className="rta-page">
        <div className="rta-body">

          {/* ── Header ─────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="rta-back-btn">
            <ArrowBack style={{ fontSize: 16 }} />
            Dashboard
          </Link>

          <div className="rta-hd">
            <div className="rta-hd-left">
              <span className="rta-hd-icon">
                <ReplayCircleFilled style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="rta-hd-title">Return Analytics</h1>
                <p className="rta-hd-sub">Returns intelligence — lifecycle, plea, credit &amp; product breakdown</p>
              </div>
            </div>
            <div className="rta-hd-right">
              <LastUpdated timestamp={lastFetchTime} />
              <div className="rta-timeframe">
                {['day', 'week', 'month', 'year'].map((t) => (
                  <button
                    key={t}
                    className={`rta-tf-btn ${timeframe === t ? 'rta-tf-btn--active' : ''}`}
                    onClick={() => handleTimeframeChange(t)}
                    disabled={tfLoading}
                    aria-pressed={timeframe === t}
                  >
                    {tfLoading && timeframe === t
                      ? <span className="rta-tf-spinner" />
                      : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <button
                className="rta-refresh-btn"
                onClick={() => { setTfLoading(true); loadData(timeframe, true); }}
                disabled={tfLoading}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 17 }} />
              </button>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="rta-breadcrumb">
            <Link to="/admin/analytics" className="rta-breadcrumb-link">Analytics Overview</Link>
            <span className="rta-breadcrumb-sep">/</span>
            <span className="rta-breadcrumb-current">Return Analytics</span>
            <Link to="/admin/returns" className="rta-manage-btn">
              <ReplayCircleFilled style={{ fontSize: 14 }} /> Manage Returns
            </Link>
          </div>

          {error && (
            <div className="rta-error-banner">
              <Warning style={{ fontSize: 18 }} />
              <span>{typeof error === 'string' ? error : 'Failed to load return analytics data.'}</span>
            </div>
          )}

          {/* ══ SECTION 1: KPI Cards ═══════════════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#EF444415', color: '#EF4444' }}>
                  <ReplayCircleFilled style={{ fontSize: 16 }} />
                </span>
                Return KPIs
              </h2>
              {returnOverview?.trend !== undefined && !tfLoading && (
                <TrendChip value={returnOverview.trend} />
              )}
              {tfLoading && <span className="rta-kpi-refreshing">Refreshing…</span>}
            </div>
            <div className={`rta-kpi-grid ${tfLoading ? 'rta-kpi-grid--loading' : ''}`}>
              {pageLoading
                ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)
                : kpiCards.map((k) => (
                    <div key={k.key} className="rta-kpi-card">
                      <div className="rta-kpi-top">
                        <span className="rta-kpi-icon" style={{ background: k.bg, color: k.accent }}>
                          <k.icon style={{ fontSize: 20 }} />
                        </span>
                        {k.change !== undefined && !tfLoading && <TrendChip value={k.change} />}
                      </div>
                      <div className="rta-kpi-label">{k.label}</div>
                      <div className="rta-kpi-value">{k.value ?? '—'}</div>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* ══ SECTION 2: Period Comparison Banner ═══════════════════ */}
          {!pageLoading && returnOverview && (
            <div className="rta-section">
              <div className="rta-compare-banner">
                <div className="rta-compare-item">
                  <span className="rta-compare-label">Current Returns</span>
                  <span className="rta-compare-val" style={{ color: '#EF4444' }}>{fmt.number(currTotal)}</span>
                </div>
                <div className="rta-compare-item">
                  <span className="rta-compare-label">Previous Returns</span>
                  <span className="rta-compare-val" style={{ color: '#6B7280' }}>{fmt.number(prevTotal)}</span>
                </div>
                <div className="rta-compare-item">
                  <span className="rta-compare-label">Prev Completed</span>
                  <span className="rta-compare-val" style={{ color: '#10B981' }}>{fmt.number(prevComplete)}</span>
                </div>
                <div className="rta-compare-item">
                  <span className="rta-compare-label">Approval Rate</span>
                  <span className="rta-compare-val" style={{ color: '#3B82F6' }}>{fmt.pct(returnOverview.approvalRate)}</span>
                </div>
                <div className="rta-compare-item">
                  <span className="rta-compare-label">Plea Rate</span>
                  <span className="rta-compare-val" style={{ color: '#6366F1' }}>{fmt.pct(returnOverview.pleaRate)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ══ SECTION 3: Status & Reasons ═══════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#8B5CF615', color: '#8B5CF6' }}>
                  <PieChartOutlined style={{ fontSize: 16 }} />
                </span>
                Status &amp; Reason Breakdown
              </h2>
            </div>
            <div className="rta-cards-3">
              {/* Status Pie */}
              <SectionCard title="Return Status Distribution" icon={PieChartOutlined} iconColor="#8B5CF6">
                {pageLoading ? <LoadingState label="Loading status data..." /> : statusPieData.length === 0 ? (
                  <EmptyState label="No status data available" />
                ) : (
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={78}
                        label={({ cx, cy, midAngle, outerRadius: oR, value: v }) => {
                          const RADIAN = Math.PI / 180;
                          const pct = totalStatusCount > 0 ? Math.round((v / totalStatusCount) * 100) : 0;
                          if (pct < 5) return null;
                          const radius = oR + 20;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                          return (
                            <text x={x} y={y} fill="#374151" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight={600}>
                              {pct}%
                            </text>
                          );
                        }}
                        labelLine={{ stroke: '#D1D5DB', strokeWidth: 1 }}
                      >
                        {statusPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
                        formatter={(v, name) => [fmt.number(v), name]}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </SectionCard>

              {/* Status Count List */}
              <SectionCard title="Status Counts" icon={Assessment} iconColor="#14B8A6" link="/admin/returns" linkLabel="Manage">
                {pageLoading ? <LoadingState label="Loading status counts..." /> : statusPieData.length === 0 ? (
                  <EmptyState label="No status breakdown available" />
                ) : (
                  <div className="rta-metric-list">
                    {statusPieData.map((s, i) => {
                      const pct = totalStatusCount > 0 ? Math.round((s.value / totalStatusCount) * 100) : 0;
                      return (
                        <div key={i} className="rta-metric-row">
                          <div className="rta-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="rta-status-dot" style={{ background: s.color }} />
                            {s.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="rta-status-bar-wrap">
                              <div className="rta-status-bar" style={{ width: `${pct}%`, background: s.color }} />
                            </div>
                            <div className="rta-metric-value" style={{ color: s.color }}>{fmt.number(s.value)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Top Return Reasons */}
              <SectionCard title="Top Return Reasons" icon={BarChart} iconColor="#F97316">
                {pageLoading ? <LoadingState label="Loading reasons..." /> : reasonsData.length === 0 ? (
                  <EmptyState label="No reason data available" />
                ) : (
                  <div className="rta-metric-list">
                    {reasonsData.slice(0, 7).map((r, i) => (
                      <div key={i} className="rta-metric-row">
                        <div className="rta-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="rta-reason-badge" style={{ background: r.fill + '20', color: r.fill }}>{i + 1}</span>
                          {r.reason}
                        </div>
                        <div className="rta-metric-value">{fmt.number(r.count)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ══ SECTION 4: Credit Metrics ══════════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#10B98115', color: '#10B981' }}>
                  <AttachMoney style={{ fontSize: 16 }} />
                </span>
                Credit &amp; Value Breakdown
              </h2>
            </div>
            <div className="rta-cards-3">
              {/* Credit Overview */}
              <SectionCard title="Credit Overview" icon={AttachMoney} iconColor="#10B981">
                {pageLoading ? <LoadingState label="Loading credit data..." /> : !returnOverview?.creditMetrics ? (
                  <EmptyState label="No credit data available" />
                ) : (
                  <div className="rta-metric-list">
                    <MetricRow label="Total Requested"    value={fmt.compact(returnOverview.creditMetrics.totalRequestedGross)}   accent="#F97316" />
                    <MetricRow label="Total Approved"     value={fmt.compact(returnOverview.creditMetrics.totalApprovedGross)}    accent="#10B981" />
                    <MetricRow label="Total Rejected"     value={fmt.compact(returnOverview.creditMetrics.totalRejectedGross)}    accent="#EF4444" />
                    <MetricRow label="Discount Value"     value={fmt.compact(returnOverview.creditMetrics.totalDiscountValue)}    accent="#6366F1" />
                    <MetricRow label="Shipping Deducted"  value={fmt.compact(returnOverview.creditMetrics.totalShippingDeducted)} accent="#F59E0B" />
                  </div>
                )}
              </SectionCard>

              {/* Store Credit Issued */}
              <SectionCard title="Store Credit Issued" icon={AttachMoney} iconColor="#6366F1">
                {pageLoading ? <LoadingState label="Loading credit issued..." /> : Object.keys(creditIssued).length === 0 ? (
                  <EmptyState label="No credit issued data" />
                ) : (
                  <div className="rta-metric-list">
                    <MetricRow label="Credit Issued Count"    value={fmt.number(creditIssued.count)}                        accent="#6366F1" />
                    <MetricRow label="Total Credit Issued"    value={fmt.compact(creditIssued.totalCreditIssued)}           accent="#10B981" />
                    <MetricRow label="Avg Credit Issued"      value={fmt.compact(creditIssued.avgCreditIssued)}             />
                    <MetricRow label="Max Credit Issued"      value={fmt.compact(creditIssued.maxCreditIssued)}             accent="#F59E0B" />
                    <MetricRow label="Shipping Deducted"      value={fmt.compact(creditIssued.totalShippingDeducted)}       accent="#EF4444" />
                    <MetricRow label="Approved Discount"      value={fmt.compact(creditIssued.totalApprovedDiscount)}       accent="#8B5CF6" />
                  </div>
                )}
              </SectionCard>

              {/* ROI Metrics */}
              <SectionCard title="Store Credit ROI" icon={TrendingUp} iconColor="#14B8A6">
                {pageLoading ? <LoadingState label="Loading ROI metrics..." /> : Object.keys(roiMetrics).length === 0 ? (
                  <EmptyState label="No ROI data available" />
                ) : (
                  <div className="rta-metric-list">
                    <MetricRow label="Credit Retention Rate"  value={fmt.pct(roiMetrics.creditRetentionRate)}   accent="#14B8A6" />
                    <MetricRow label="Credit Redemption Rate" value={fmt.pct(roiMetrics.creditRedemptionRate)}  accent="#10B981" />
                    <MetricRow label="Approval Efficiency"    value={fmt.pct(roiMetrics.approvalEfficiency)}    accent="#6366F1" />
                    <MetricRow label="Net Credit Cost"        value={fmt.compact(roiMetrics.netCreditCost)}     accent="#EF4444" />
                    <MetricRow label="Revenue Protected"      value={fmt.compact(roiMetrics.revenueProtected)}  accent="#3B82F6" />
                    <MetricRow label="Credit Redeemed"        value={fmt.compact(creditRedeemed.totalCreditRedeemed)} accent="#F59E0B" />
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ══ SECTION 5: Plea Analytics ══════════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#6366F115', color: '#6366F1' }}>
                  <GavelOutlined style={{ fontSize: 16 }} />
                </span>
                Plea Analytics
              </h2>
            </div>
            <div className="rta-charts-row">
              {/* Return-level plea stats */}
              <SectionCard title="Return-Level Plea Stats" subtitle="Plea submission & success rates" icon={GavelOutlined} iconColor="#6366F1">
                {pageLoading ? <LoadingState label="Loading plea data..." /> : Object.keys(pleaReturn).length === 0 ? (
                  <EmptyState label="No plea analytics available" />
                ) : (
                  <div className="rta-metric-list">
                    <MetricRow label="Total Reviewed"             value={fmt.number(pleaReturn.totalReviewed)}            />
                    <MetricRow label="Returns With Plea"          value={fmt.number(pleaReturn.withPlea)}                 accent="#6366F1" />
                    <MetricRow label="Plea Submission Rate"       value={fmt.pct(pleaReturn.pleaSubmissionRate)}          accent="#8B5CF6" />
                    <MetricRow label="Plea Finalised"             value={fmt.number(pleaReturn.pleaFinalised)}            />
                    <MetricRow label="Plea Success Rate"          value={fmt.pct(pleaReturn.pleaSuccessRate)}             accent="#10B981" />
                    <MetricRow label="Plea Resulted in More Credit" value={fmt.number(pleaReturn.pleaResultedInMoreCredit)} accent="#F59E0B" />
                    <MetricRow label="Plea Deadline Expired"      value={fmt.number(pleaReturn.pleaDeadlineExpired)}      accent="#EF4444" />
                    <MetricRow label="Deadline Expiry Rate"       value={fmt.pct(pleaReturn.pleaDeadlineExpiredRate)}     accent="#DC2626" />
                  </div>
                )}
              </SectionCard>

              {/* Unit-level plea stats */}
              <SectionCard title="Unit-Level Plea Stats" subtitle="Item quantity breakdown" icon={Inventory2} iconColor="#F97316">
                {pageLoading ? <LoadingState label="Loading unit data..." /> : Object.keys(pleaUnit).length === 0 ? (
                  <EmptyState label="No unit plea data available" />
                ) : (
                  <>
                    <div className="rta-metric-list">
                      <MetricRow label="Total Items"           value={fmt.number(pleaUnit.totalItems)}               />
                      <MetricRow label="Total Quantity"        value={fmt.number(pleaUnit.totalQuantity)}            />
                      <MetricRow label="Approved Qty"          value={fmt.number(pleaUnit.totalApprovedQty)}         accent="#10B981" />
                      <MetricRow label="Unit Approval Rate"    value={fmt.pct(pleaUnit.unitApprovalRate)}            accent="#10B981" />
                      <MetricRow label="Items Fully Approved"  value={fmt.number(pleaUnit.itemsFullyApproved)}       accent="#16A34A" />
                      <MetricRow label="Items Partial"         value={fmt.number(pleaUnit.itemsPartiallyApproved)}   accent="#F59E0B" />
                      <MetricRow label="Items Fully Rejected"  value={fmt.number(pleaUnit.itemsFullyRejected)}       accent="#EF4444" />
                    </div>
                    <div className="rta-plea-unit-divider" />
                    <div className="rta-metric-list">
                      <MetricRow label="Items With Plea"       value={fmt.number(pleaUnit.itemsWithPlea)}            accent="#6366F1" />
                      <MetricRow label="Plea Qty"              value={fmt.number(pleaUnit.pleaQty)}                  />
                      <MetricRow label="Plea Approved Qty"     value={fmt.number(pleaUnit.pleaApprovedQty)}          accent="#10B981" />
                      <MetricRow label="Plea Rejected Qty"     value={fmt.number(pleaUnit.pleaRejectedQty)}          accent="#EF4444" />
                      <MetricRow label="Silent Accepted"       value={fmt.number(pleaUnit.silentAcceptedQty)}        accent="#9CA3AF" />
                      <MetricRow label="Silent Acceptance Rate" value={fmt.pct(pleaUnit.silentAcceptanceRate)}       accent="#6B7280" />
                      <MetricRow label="Plea Unit Approval Rate" value={fmt.pct(pleaUnit.pleaUnitApprovalRate)}      accent="#3B82F6" />
                    </div>
                  </>
                )}
              </SectionCard>
            </div>

            {/* Credit Metrics from Plea */}
            {!pageLoading && Object.keys(pleaCredit).length > 0 && (
              <div className="rta-plea-credit-banner">
                <div className="rta-plea-credit-item">
                  <span className="rta-plea-credit-label">Requested Gross</span>
                  <span className="rta-plea-credit-val" style={{ color: '#F97316' }}>{fmt.compact(pleaCredit.totalRequestedGross)}</span>
                </div>
                <div className="rta-plea-credit-item">
                  <span className="rta-plea-credit-label">Approved Gross</span>
                  <span className="rta-plea-credit-val" style={{ color: '#10B981' }}>{fmt.compact(pleaCredit.totalApprovedGross)}</span>
                </div>
                <div className="rta-plea-credit-item">
                  <span className="rta-plea-credit-label">Rejected Gross</span>
                  <span className="rta-plea-credit-val" style={{ color: '#EF4444' }}>{fmt.compact(pleaCredit.totalRejectedGross)}</span>
                </div>
                <div className="rta-plea-credit-item">
                  <span className="rta-plea-credit-label">Discount Value</span>
                  <span className="rta-plea-credit-val" style={{ color: '#6366F1' }}>{fmt.compact(pleaCredit.totalDiscountValue)}</span>
                </div>
                <div className="rta-plea-credit-item">
                  <span className="rta-plea-credit-label">Credit Recovery Rate</span>
                  <span className="rta-plea-credit-val" style={{ color: '#3B82F6' }}>{fmt.pct(pleaCredit.creditRecoveryRate)}</span>
                </div>
              </div>
            )}
          </div>

          {/* ══ SECTION 6: Lifecycle Timing ════════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#06B6D415', color: '#06B6D4' }}>
                  <Timeline style={{ fontSize: 16 }} />
                </span>
                Lifecycle Timing
              </h2>
            </div>
            <div className="rta-charts-row">
              {/* Stage Timing */}
              <SectionCard title="Stage Timing" subtitle="Average time per lifecycle stage" icon={Timeline} iconColor="#06B6D4">
                {pageLoading ? <LoadingState label="Loading lifecycle data..." /> : Object.keys(stageTiming).length === 0 ? (
                  <EmptyState label="No lifecycle timing data" />
                ) : (
                  <>
                    <div className="rta-metric-list">
                      <MetricRow label="Requested → Review"    value={fmt.hrs(stageTiming.avgRequestedToReviewHrs)}         accent="#F59E0B" />
                      <MetricRow label="Review → Plea"         value={fmt.hrs(stageTiming.avgReviewToPleaHrs)}              accent="#8B5CF6" />
                      <MetricRow label="Approved → Shipped"    value={fmt.days(stageTiming.avgApprovedToShippedDays)}       accent="#3B82F6" />
                      <MetricRow label="Requested → Inspected" value={fmt.days(stageTiming.avgRequestedToInspectedDays)}   accent="#06B6D4" />
                      <MetricRow label="Total Lifecycle"       value={fmt.days(stageTiming.avgTotalLifecycleDays)}          accent="#10B981" />
                    </div>
                    {/* Timing Bar Visual */}
                    <div className="rta-timing-bar-section">
                      {[
                        { label: 'Review', hours: stageTiming.avgRequestedToReviewHrs, max: 72, color: '#F59E0B', unit: 'hrs' },
                        { label: 'Plea',   hours: stageTiming.avgReviewToPleaHrs,      max: 72, color: '#8B5CF6', unit: 'hrs' },
                        { label: 'Total',  hours: stageTiming.avgTotalLifecycleDays,   max: 30, color: '#10B981', unit: 'days' },
                      ].map((item) => {
                        const pct = item.hours != null && item.max > 0 ? Math.min((item.hours / item.max) * 100, 100) : 0;
                        return (
                          <div key={item.label} className="rta-timing-bar-row">
                            <span className="rta-timing-bar-label">{item.label}</span>
                            <div className="rta-timing-bar-track">
                              <div className="rta-timing-bar-fill" style={{ width: `${pct}%`, background: item.color }} />
                            </div>
                            <span className="rta-timing-bar-val" style={{ color: item.color }}>
                              {item.hours != null ? `${item.hours} ${item.unit}` : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </SectionCard>

              {/* Plea Impact on Timing */}
              <SectionCard title="Plea Impact on Lifecycle" subtitle="With plea vs without plea" icon={GavelOutlined} iconColor="#EF4444">
                {pageLoading ? <LoadingState label="Loading plea timing..." /> : Object.keys(pleaImpactTiming).length === 0 ? (
                  <EmptyState label="No plea timing data available" />
                ) : (
                  <>
                    <div className="rta-metric-list">
                      <MetricRow label="Avg Lifecycle With Plea"    value={fmt.days(pleaImpactTiming.avgLifecycleWithPlea)}    accent="#EF4444" />
                      <MetricRow label="Avg Lifecycle Without Plea" value={fmt.days(pleaImpactTiming.avgLifecycleWithoutPlea)} accent="#10B981" />
                      <MetricRow label="Plea Adds Approx."          value={fmt.days(pleaImpactTiming.pleaAddsApproxDays)}      accent="#F59E0B"
                        sub={pleaImpactTiming.pleaAddsApproxDays > 0 ? 'Extra days due to plea' : null} />
                      <MetricRow label="Returns With Plea"    value={fmt.number(pleaImpactTiming.countWithPlea)}    accent="#6366F1" />
                      <MetricRow label="Returns Without Plea" value={fmt.number(pleaImpactTiming.countWithoutPlea)} accent="#6B7280" />
                      <MetricRow label="Total Returns"        value={fmt.number(pleaImpactTiming.total)} />
                    </div>

                    {/* Comparison visual */}
                    {pleaImpactTiming.avgLifecycleWithPlea != null &&
                     pleaImpactTiming.avgLifecycleWithoutPlea != null && (
                      <div className="rta-plea-compare">
                        <div className="rta-plea-compare-bar">
                          <div className="rta-plea-compare-label">With Plea</div>
                          <div className="rta-plea-compare-track">
                            <div
                              className="rta-plea-compare-fill"
                              style={{
                                width: `${Math.min((pleaImpactTiming.avgLifecycleWithPlea /
                                  Math.max(pleaImpactTiming.avgLifecycleWithPlea, pleaImpactTiming.avgLifecycleWithoutPlea)) * 100, 100)}%`,
                                background: '#EF4444',
                              }}
                            />
                          </div>
                          <span className="rta-plea-compare-val">{pleaImpactTiming.avgLifecycleWithPlea}d</span>
                        </div>
                        <div className="rta-plea-compare-bar">
                          <div className="rta-plea-compare-label">Without</div>
                          <div className="rta-plea-compare-track">
                            <div
                              className="rta-plea-compare-fill"
                              style={{
                                width: `${Math.min((pleaImpactTiming.avgLifecycleWithoutPlea /
                                  Math.max(pleaImpactTiming.avgLifecycleWithPlea, pleaImpactTiming.avgLifecycleWithoutPlea)) * 100, 100)}%`,
                                background: '#10B981',
                              }}
                            />
                          </div>
                          <span className="rta-plea-compare-val">{pleaImpactTiming.avgLifecycleWithoutPlea}d</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ══ SECTION 7: Returns by Category ════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#F59E0B15', color: '#F59E0B' }}>
                  <Category style={{ fontSize: 16 }} />
                </span>
                Returns by Category
              </h2>
            </div>
            <div className="rta-charts-row">
              {/* Bar Chart */}
              <SectionCard title="Return Rate by Category" subtitle="Returns vs sales per category" icon={BarChart} iconColor="#F59E0B">
                {pageLoading ? <LoadingState label="Loading category data..." /> : categoryData.length === 0 ? (
                  <EmptyState label="No category data available" icon={Category} />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <ReBarChart data={categoryData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: '#374151' }} width={100} />
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
                        formatter={(v) => [`${v}%`, 'Return Rate']}
                      />
                      <Bar dataKey="returnRate" name="Return Rate %" radius={[0, 4, 4, 0]}>
                        {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Bar>
                    </ReBarChart>
                  </ResponsiveContainer>
                )}
              </SectionCard>

              {/* Category Detail Table */}
              <SectionCard title="Category Details" subtitle="Returns, sales & rate per category" icon={Assessment} iconColor="#06B6D4">
                {pageLoading ? <LoadingState label="Loading category details..." /> : categoryData.length === 0 ? (
                  <EmptyState label="No category data available" />
                ) : (
                  <div className="rta-cat-table">
                    <div className="rta-cat-table-hd">
                      <span>Category</span>
                      <span>Returns</span>
                      <span>Sales</span>
                      <span>Rate</span>
                    </div>
                    {categoryData.map((c, i) => (
                      <div key={i} className="rta-cat-table-row">
                        <span className="rta-cat-name">
                          <span className="rta-cat-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {c.category || 'Unknown'}
                        </span>
                        <span>{fmt.number(c.totalReturns)}</span>
                        <span>{fmt.number(c.totalSales)}</span>
                        <span>
                          <span className="rta-rate-chip" style={{
                            background: c.returnRate > 15 ? '#FEE2E2' : c.returnRate > 8 ? '#FEF9C3' : '#DCFCE7',
                            color:      c.returnRate > 15 ? '#991B1B'  : c.returnRate > 8 ? '#713F12'  : '#166534',
                          }}>
                            {fmt.pct(c.returnRate)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ══ SECTION 8: Returns by Product ══════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                  <Inventory2 style={{ fontSize: 16 }} />
                </span>
                Returns by Product
              </h2>
              {returnsByProduct?.summary && (
                <span className="rta-summary-badge">
                  {fmt.number(returnsByProduct.summary.totalProductsWithReturns)} products · avg rate {fmt.pct(returnsByProduct.summary.avgReturnRate)} · avg plea {fmt.pct(returnsByProduct.summary.avgPleaRate)}
                </span>
              )}
            </div>

            <SectionCard
              title="Top Products by Return Rate"
              subtitle="Products sorted by return rate with plea metrics"
              icon={Inventory2}
              iconColor="#3B82F6"
              link="/admin/returns"
              linkLabel="View Returns"
            >
              {pageLoading ? <LoadingState label="Loading product data..." /> : productData.length === 0 ? (
                <EmptyState label="No product data available" icon={Inventory2} />
              ) : (
                <div className="rta-product-table-wrap">
                  <div className="rta-product-table">
                    <div className="rta-product-table-hd">
                      <span>Product</span>
                      <span>Returns</span>
                      <span>Return Rate</span>
                      <span>Unit Approval</span>
                      <span>Plea Rate</span>
                      <span>Silent Acc.</span>
                    </div>
                    {productData.slice(0, 15).map((item, i) => (
                      <div key={i} className="rta-product-table-row">
                        <span className="rta-product-name">
                          {item.product?.image && (
                            <img src={item.product.image} alt={item.product.name} className="rta-product-thumb" />
                          )}
                          <span className="rta-product-name-text">
                            <span className="rta-product-title">{item.product?.name || 'Unknown'}</span>
                            <span className="rta-product-cat">{item.product?.category || ''}</span>
                          </span>
                        </span>
                        <span>{fmt.number(item.returns?.totalReturns)}</span>
                        <span>
                          <span className="rta-rate-chip" style={{
                            background: item.returnRate > 20 ? '#FEE2E2' : item.returnRate > 10 ? '#FEF9C3' : '#DCFCE7',
                            color:      item.returnRate > 20 ? '#991B1B'  : item.returnRate > 10 ? '#713F12'  : '#166534',
                          }}>
                            {fmt.pct(item.returnRate)}
                          </span>
                        </span>
                        <span style={{ color: '#10B981', fontWeight: 700 }}>{fmt.pct(item.unitApprovalRate)}</span>
                        <span style={{ color: '#6366F1', fontWeight: 700 }}>{fmt.pct(item.pleaMetrics?.pleaRate)}</span>
                        <span style={{ color: '#9CA3AF', fontWeight: 600 }}>{fmt.pct(item.pleaMetrics?.silentAcceptanceRate)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          {/* ══ SECTION 9: Full Return Overview ════════════════════════ */}
          <div className="rta-section">
            <div className="rta-section-hd">
              <h2 className="rta-section-title">
                <span className="rta-section-icon-wrap" style={{ background: '#EF444415', color: '#EF4444' }}>
                  <Assessment style={{ fontSize: 16 }} />
                </span>
                Full Return Overview
              </h2>
              <Link to="/admin/returns" className="rta-section-link">
                Manage Returns <KeyboardArrowRight style={{ fontSize: 16 }} />
              </Link>
            </div>
            <div className="rta-cards-3">
              {/* Current period */}
              <SectionCard title="Current Period" icon={ReplayCircleFilled} iconColor="#EF4444">
                {pageLoading ? <LoadingState /> : !returnOverview ? (
                  <EmptyState label="No overview data" />
                ) : (
                  <div className="rta-metric-list">
                    <MetricRow label="Total Returns"     value={fmt.number(returnOverview.totalReturns)} />
                    <MetricRow label="Return Rate"       value={fmt.pct(returnOverview.returnRate)}             accent="#EF4444" />
                    <MetricRow label="Approval Rate"     value={fmt.pct(returnOverview.approvalRate)}           accent="#10B981" />
                    <MetricRow label="Plea Rate"         value={fmt.pct(returnOverview.pleaRate)}               accent="#6366F1" />
                    <MetricRow label="Avg Processing"    value={fmt.days(returnOverview.avgProcessingDays)}     />
                    <MetricRow label="Avg Review"        value={fmt.days(returnOverview.avgReviewDays)}         />
                    <MetricRow label="Returns With Plea" value={fmt.number(returnOverview.pleaMetrics?.withPlea)} accent="#8B5CF6" />
                  </div>
                )}
              </SectionCard>

              {/* All statuses */}
              <SectionCard title="All Return Statuses" icon={LocalShipping} iconColor="#06B6D4">
                {pageLoading ? <LoadingState /> : !returnOverview?.byStatus ? (
                  <EmptyState label="No status data" />
                ) : (
                  <div className="rta-metric-list">
                    {Object.entries(returnOverview.byStatus).map(([key, val], i) => (
                      <MetricRow
                        key={i}
                        label={key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        value={fmt.number(val)}
                        accent={STATUS_COLORS[key]}
                      />
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Product & Category summary */}
              <SectionCard title="Product & Category Summary" icon={Category} iconColor="#F59E0B">
                {pageLoading ? <LoadingState /> : (
                  <div className="rta-metric-list">
                    {returnsByProduct?.summary && (
                      <>
                        <MetricRow label="Products With Returns" value={fmt.number(returnsByProduct.summary.totalProductsWithReturns)} accent="#3B82F6" />
                        <MetricRow label="Avg Product Return Rate" value={fmt.pct(returnsByProduct.summary.avgReturnRate)} accent="#EF4444" />
                        <MetricRow label="Avg Product Plea Rate"   value={fmt.pct(returnsByProduct.summary.avgPleaRate)}   accent="#6366F1" />
                      </>
                    )}
                    {categoryData.slice(0, 5).map((c, i) => (
                      <MetricRow
                        key={i}
                        label={c.category || 'Unknown'}
                        value={fmt.pct(c.returnRate)}
                        sub={`${fmt.number(c.totalReturns)} returns`}
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
      <Footer />
    </>
  );
}