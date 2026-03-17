import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Insights,
  ArrowBack,
  Refresh,
  TrendingUp,
  TrendingDown,
  AttachMoney,
  LocalOffer,
  BarChart as BarChartIcon,
  TableChart,
  Sync,
  SyncProblem,
  CheckCircle,
  Warning,
  KeyboardArrowRight,
  KeyboardArrowDown,
  Close,
  People,
  Category,
  FilterList,
} from '@mui/icons-material';
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  fetchDiscountAnalyticsOverview,
  fetchDiscountROIByCategory,
  fetchDiscountROIByType,
  fetchDiscountTopPerformers,
  fetchDiscountRedemptionTrends,
  fetchAllDiscountAnalytics,
  fetchDiscountAnalyticsDetail,
  fetchDiscountSegmentBreakdown,
  fetchDiscountCodeTrend,
  syncSingleDiscountAnalytics,
  syncAllDiscountAnalytics,
  setActiveTrendsTimeframe,
  clearSelectedDetail,
  clearDiscountAnalyticsError,
} from '../features/analytics/discountAnalyticsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/DiscountAnalytics.css';

const DEBOUNCE_DELAY        = 800;
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;
const STALE_DATA_THRESHOLD  = 3 * 60 * 1000;

const lastFetchedCache = {};
let   activeAbortController = null;

const PAL = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#8B5CF6', '#F97316', '#14B8A6'];

const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:    (v) => `${(v || 0).toFixed(1)}%`,
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  roi: (v) => {
    if (v === null || v === undefined) return '—';
    return `${v >= 0 ? '+' : ''}${Number(v).toFixed(0)}%`;
  },
  // FIX: removed instanceof Date check — MongoDB returns ISO strings over the
  // wire, never Date objects. new Date(d) handles both strings and Date objects.
  date: (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  },
};

function roiColor(roi) {
  if (roi === null || roi === undefined) return '#6B7280';
  if (roi >= 100) return '#10B981';
  if (roi >= 0)   return '#F59E0B';
  return '#EF4444';
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

function SkeletonBlock({ h = 20, w = '100%', radius = 6, mb = 0 }) {
  return <div className="da-skeleton" style={{ height: h, width: w, borderRadius: radius, marginBottom: mb }} />;
}

function KpiSkeleton() {
  return (
    <div className="da-kpi-card">
      <SkeletonBlock h={38} w={38} radius={9} mb={14} />
      <SkeletonBlock h={11} w="55%" mb={8} />
      <SkeletonBlock h={26} w="75%" />
    </div>
  );
}

function LoadingState({ label = 'Loading…', h = 180 }) {
  return (
    <div className="da-loading-state" style={{ minHeight: h }}>
      <div className="da-spinner" />
      <span>{label}</span>
    </div>
  );
}

function Empty({ label = 'No data available', h = 160 }) {
  return (
    <div className="da-empty" style={{ minHeight: h }}>
      <Insights style={{ fontSize: 36, color: '#D1D5DB' }} />
      <span>{label}</span>
    </div>
  );
}

function TrendChip({ value }) {
  if (value === null || value === undefined) return <span className="da-chip da-chip--flat">—</span>;
  const pos = value >= 0;
  return (
    <span className={`da-chip ${pos ? 'da-chip--pos' : 'da-chip--neg'}`}>
      {pos ? <TrendingUp style={{ fontSize: 11 }} /> : <TrendingDown style={{ fontSize: 11 }} />}
      {fmt.roi(value)}
    </span>
  );
}

const TT = {
  contentStyle: {
    background:   '#fff',
    border:       '1px solid #D1D5DB',
    borderRadius: 8,
    fontSize:     13,
    boxShadow:    '0 4px 12px rgba(0,0,0,0.08)',
  },
};

function Card({ title, sub, icon: Icon, iconColor, action, children }) {
  return (
    <div className="da-card">
      <div className="da-card-hd">
        <div className="da-card-hd-left">
          {Icon && (
            <span className="da-card-icon" style={{ background: `${iconColor}1a`, color: iconColor }}>
              <Icon style={{ fontSize: 18 }} />
            </span>
          )}
          <div>
            <h3 className="da-card-title">{title}</h3>
            {sub && <p className="da-card-sub">{sub}</p>}
          </div>
        </div>
        {action && <div className="da-card-action">{action}</div>}
      </div>
      <div className="da-card-body">{children}</div>
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div className="da-section-div">
      <span className="da-section-div-text">{label}</span>
      <span className="da-section-div-line" />
    </div>
  );
}

function LastUpdated({ timestamp }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const update = () => {
      if (!timestamp) return setLabel('Never');
      const diff    = Date.now() - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours   = Math.floor(diff / 3600000);
      if (minutes < 1)        setLabel('Just now');
      else if (minutes === 1) setLabel('1 min ago');
      else if (minutes < 60)  setLabel(`${minutes} mins ago`);
      else if (hours === 1)   setLabel('1 hour ago');
      else                    setLabel(`${hours} hours ago`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [timestamp]);
  return (
    <div className="da-last-updated">
      <span className="da-last-updated-label">Updated:</span>
      <span className="da-last-updated-time">{label}</span>
    </div>
  );
}

function TimeframeSheet({ timeframe, onChange, disabled, options }) {
  const [open, setOpen] = useState(false);
  const labels = { week: 'This Week', month: 'This Month', quarter: 'This Quarter', year: 'This Year' };
  return (
    <>
      <button
        className="da-tf-mobile-trigger"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Change time period"
      >
        <span className="da-tf-mobile-label">{labels[timeframe] || timeframe}</span>
        <KeyboardArrowDown style={{ fontSize: 16 }} />
      </button>
      {open && (
        <>
          <div className="da-tf-sheet-overlay" onClick={() => setOpen(false)} />
          <div className="da-tf-sheet">
            <div className="da-tf-sheet-handle" />
            <p className="da-tf-sheet-title">Select Time Period</p>
            {options.map(t => (
              <button
                key={t}
                className={`da-tf-sheet-btn ${timeframe === t ? 'da-tf-sheet-btn--active' : ''}`}
                onClick={() => { onChange(t); setOpen(false); }}
                disabled={disabled}
              >
                {labels[t]}
                {timeframe === t && <CheckCircle style={{ fontSize: 18, color: '#e563f1' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const VIEWS = [
  { key: 'overview',    label: 'Overview',    icon: Insights },
  { key: 'trends',      label: 'Trends',      icon: TrendingUp },
  { key: 'leaderboard', label: 'Leaderboard', icon: BarChartIcon },
  { key: 'codes',       label: 'All Codes',   icon: TableChart },
];

const TREND_TIMEFRAMES = ['week', 'month', 'quarter', 'year'];

// FIX: DetailDrawer receives the Discount's _id (discountId field on the
// analytics doc), not the analytics doc's own _id. All three sub-endpoints
// use findOne({ discountId }) so they need the original Discount _id.
function DetailDrawer({ discountId, onClose }) {
  const dispatch = useDispatch();
  const { selectedDetail, selectedSegmentBreakdown, selectedCodeTrend, detailLoading } =
    useSelector((s) => s.discountAnalytics);

  useEffect(() => {
    if (!discountId) return;
    dispatch(fetchDiscountAnalyticsDetail(discountId));
    dispatch(fetchDiscountSegmentBreakdown(discountId));
    dispatch(fetchDiscountCodeTrend({ discountId, timeframe: 'month' }));
  }, [dispatch, discountId]);

  const d     = selectedDetail;
  const seg   = selectedSegmentBreakdown;
  const trend = selectedCodeTrend?.trend || [];

  return (
    <div className="da-drawer-overlay" onClick={onClose}>
      <div className="da-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="da-drawer-hd">
          <div>
            <div className="da-drawer-code">{d?.discountCode ?? '…'}</div>
            <div className="da-drawer-sub">
              {d?.meta?.category ?? ''} · {d?.meta?.type ?? ''}
            </div>
          </div>
          <button className="da-drawer-close" onClick={onClose} aria-label="Close">
            <Close style={{ fontSize: 20 }} />
          </button>
        </div>

        {detailLoading && <LoadingState label="Loading detail…" h={200} />}

        {!detailLoading && d && (
          <div className="da-drawer-body">
            <p className="da-drawer-section-label">Financials</p>
            <div className="da-drawer-metrics">
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">ROI</div>
                <div className="da-drawer-metric-val" style={{ color: roiColor(d.financials?.roi) }}>
                  {fmt.roi(d.financials?.roi)}
                </div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Revenue Influenced</div>
                <div className="da-drawer-metric-val">{fmt.compact(d.financials?.totalRevenueInfluenced)}</div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Discount Cost</div>
                <div className="da-drawer-metric-val">{fmt.compact(d.financials?.totalDiscountCost)}</div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Avg Order Value</div>
                <div className="da-drawer-metric-val">{fmt.currency(d.financials?.avgOrderValue)}</div>
              </div>
            </div>

            <p className="da-drawer-section-label">Redemptions</p>
            <div className="da-drawer-metrics">
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Total</div>
                <div className="da-drawer-metric-val">{fmt.number(d.redemptions?.total)}</div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Unique Users</div>
                <div className="da-drawer-metric-val">{fmt.number(d.redemptions?.uniqueUsers)}</div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">First-Time Users</div>
                <div className="da-drawer-metric-val">{fmt.number(d.redemptions?.firstTimeUsers)}</div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Retention Rate</div>
                <div className="da-drawer-metric-val">{fmt.pct(d.conversion?.postRedemptionRetentionRate)}</div>
              </div>
            </div>

            {trend.length > 0 && (
              <>
                <p className="da-drawer-section-label">Daily Redemption Trend</p>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={trend} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <defs>
                      <linearGradient id="drawerGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#e563f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#e563f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                      tickFormatter={(d) => fmt.date(d)} />
                    <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} />
                    <Tooltip {...TT}
                      labelFormatter={(d) => fmt.date(d)}
                      formatter={(v) => [fmt.number(v), 'Redemptions']} />
                    <Area type="monotone" dataKey="redemptions" stroke="#e563f1" strokeWidth={2} fill="url(#drawerGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </>
            )}

            {seg?.segmentBreakdown?.length > 0 && (
              <>
                <p className="da-drawer-section-label">Customer Segments</p>
                {seg.segmentBreakdown.slice(0, 6).map((s, i) => {
                  const maxCount = Math.max(
                    ...seg.segmentBreakdown.map((x) => x.redemptions || 0)
                  ) || 1;
                  return (
                    <div key={i} className="da-drawer-seg-row">
                      <span className="da-drawer-seg-name">{s.segment || 'Unknown'}</span>
                      <div className="da-drawer-seg-track">
                        <div
                          className="da-drawer-seg-fill"
                          style={{
                            width:      `${((s.redemptions || 0) / maxCount) * 100}%`,
                            background: PAL[i % PAL.length],
                          }}
                        />
                      </div>
                      <span className="da-drawer-seg-count">{fmt.number(s.redemptions)}</span>
                    </div>
                  );
                })}
              </>
            )}

            <p className="da-drawer-section-label">Baseline Comparison</p>
            <div className="da-drawer-metrics">
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">Store Avg AOV</div>
                <div className="da-drawer-metric-val">{fmt.currency(d.baseline?.storeAvgOrderValue)}</div>
              </div>
              <div className="da-drawer-metric">
                <div className="da-drawer-metric-label">AOV Lift</div>
                <div className="da-drawer-metric-val" style={{ color: roiColor(d.baseline?.aovLiftPercent) }}>
                  {fmt.roi(d.baseline?.aovLiftPercent)}
                </div>
              </div>
            </div>
            <p className="da-drawer-sync-note">Last synced: {fmt.date(d.lastSyncedAt)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminDiscountAnalytics() {
  const dispatch = useDispatch();

  const {
    overview,          overviewLoading,
    roiByCategory,     roiByType,
    topPerformers,     topPerformersLoading,
    redemptionTrends,  redemptionTrendsLoading,
    activeTrendsTimeframe,
    allAnalytics,      listLoading,      listPagination,
    syncLoading,       syncError,
    bulkSyncLoading,   bulkSyncMessage,
    error,
  } = useSelector((s) => s.discountAnalytics);

  const [activeView,    setActiveView]    = useState('overview');
  const [trendsTf,      setTrendsTf]      = useState('month');
  const [sortBy,        setSortBy]        = useState('roi');
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [drawerId,      setDrawerId]      = useState(null);
  const [filterCat,     setFilterCat]     = useState('');
  const [filterType,    setFilterType]    = useState('');

  const isLoadingRef        = useRef(false);
  const autoRefreshTimerRef = useRef(null);

  const anyLoading = overviewLoading || topPerformersLoading || listLoading;

  const loadStaticData = useCallback((force = false) => {
    const CACHE_KEY = '__da_static__';
    const now  = Date.now();
    const last = lastFetchedCache[CACHE_KEY] || 0;
    if (!force && now - last < 30000) return;
    lastFetchedCache[CACHE_KEY] = now;
    setLastFetchTime(now);
    Promise.allSettled([
      dispatch(fetchDiscountAnalyticsOverview()),
      dispatch(fetchDiscountROIByCategory()),
      dispatch(fetchDiscountROIByType()),
      dispatch(fetchDiscountTopPerformers({ limit: 20, sortBy })),
      dispatch(fetchAllDiscountAnalytics({ limit: 30, sortBy: 'revenue' })),
    ]);
  }, [dispatch, sortBy]);

  const loadTrendData = useCallback((tf, force = false) => {
    if (isLoadingRef.current) return;
    const now  = Date.now();
    const last = lastFetchedCache[`trend_${tf}`] || 0;
    if (!force && now - last < 30000) return;

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    dispatch(setActiveTrendsTimeframe(tf));
    lastFetchedCache[`trend_${tf}`] = now;
    setLastFetchTime(now);
    isLoadingRef.current = true;

    Promise.allSettled([
      dispatch(fetchDiscountRedemptionTrends({ timeframe: tf })),
    ]).finally(() => {
      isLoadingRef.current  = false;
      activeAbortController = null;
    });
  }, [dispatch]);

  const [debouncedLoadTrend, cancelTrendDebounce] = useDebounce(loadTrendData, DEBOUNCE_DELAY);

  const handleTrendsTimeframeChange = useCallback((newTf) => {
    if (redemptionTrendsLoading) return;
    setTrendsTf(newTf);
    cancelTrendDebounce();
    debouncedLoadTrend(newTf, true);
  }, [redemptionTrendsLoading, debouncedLoadTrend, cancelTrendDebounce]);

  const loadStaticDataRef      = useRef(loadStaticData);
  const loadTrendDataRef       = useRef(loadTrendData);
  const cancelTrendDebounceRef = useRef(cancelTrendDebounce);
  useEffect(() => { loadStaticDataRef.current      = loadStaticData;      }, [loadStaticData]);
  useEffect(() => { loadTrendDataRef.current        = loadTrendData;        }, [loadTrendData]);
  useEffect(() => { cancelTrendDebounceRef.current  = cancelTrendDebounce; }, [cancelTrendDebounce]);

  useEffect(() => {
    loadStaticDataRef.current(false);
    loadTrendDataRef.current('month', false);
    return () => {
      cancelTrendDebounceRef.current();
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    if (['week', 'month'].includes(trendsTf)) {
      autoRefreshTimerRef.current = setInterval(() => {
        const last = lastFetchedCache[`trend_${trendsTf}`] || 0;
        if (Date.now() - last >= STALE_DATA_THRESHOLD && !isLoadingRef.current) {
          loadTrendData(trendsTf, false);
        }
      }, AUTO_REFRESH_INTERVAL);
    }
    return () => { if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current); };
  }, [trendsTf, loadTrendData]);

  useEffect(() => {
    dispatch(fetchDiscountTopPerformers({ limit: 20, sortBy }));
  }, [dispatch, sortBy]);

  const handleRefresh = useCallback(() => {
    loadStaticData(true);
    loadTrendData(trendsTf, true);
  }, [loadStaticData, loadTrendData, trendsTf]);

  const handleSyncSingle = useCallback((id) => {
    dispatch(syncSingleDiscountAnalytics(id));
  }, [dispatch]);

  const handleSyncAll = useCallback(() => {
    dispatch(syncAllDiscountAnalytics());
  }, [dispatch]);

  const handleDismissError = useCallback(() => {
    dispatch(clearDiscountAnalyticsError());
  }, [dispatch]);

  const openDrawer  = useCallback((id) => { setDrawerId(id); }, []);
  const closeDrawer = useCallback(() => {
    setDrawerId(null);
    dispatch(clearSelectedDetail());
  }, [dispatch]);

  useEffect(() => {
    const params = { limit: 30, sortBy: 'revenue' };
    if (filterCat)  params.category = filterCat;
    if (filterType) params.type     = filterType;
    dispatch(fetchAllDiscountAnalytics(params));
  }, [dispatch, filterCat, filterType]);

  const overallSummary   = overview?.overall ?? null;
  const topByROI         = useMemo(() => overview?.topByROI        ?? [], [overview]);
  const underperforming  = useMemo(() => overview?.underperforming ?? [], [overview]);
  const categories       = useMemo(() => roiByCategory?.categories ?? [], [roiByCategory]);
  const types            = useMemo(() => roiByType?.types           ?? [], [roiByType]);
  const leaderboardCodes = useMemo(() => topPerformers?.codes       ?? [], [topPerformers]);
  const trendData        = useMemo(() => redemptionTrends?.trends   ?? [], [redemptionTrends]);
  const trendSummary     = useMemo(() => redemptionTrends?.summary  ?? {}, [redemptionTrends]);

  const catMax = useMemo(
    () => Math.max(...categories.map(c => c.totalRevenueInfluenced || 0), 1),
    [categories]
  );

  const firstLoad = !overview && overviewLoading;

  const kpiCards = useMemo(() => {
    if (!overallSummary) return [];
    return [
      {
        key: 'cost',   label: 'Total Discount Cost',
        value: fmt.compact(overallSummary.totalDiscountCost),
        icon: AttachMoney, accent: '#EF4444', bg: '#EF444415',
      },
      {
        key: 'rev',    label: 'Revenue Influenced',
        value: fmt.compact(overallSummary.totalRevenueInfluenced),
        icon: TrendingUp, accent: '#10B981', bg: '#10B98115',
      },
      {
        key: 'roi',    label: 'Overall ROI',
        value: fmt.roi(overallSummary.overallROI),
        valueColor: roiColor(overallSummary.overallROI),
        icon: Insights, accent: '#e563f1', bg: '#e563f115',
      },
      {
        key: 'redeem', label: 'Total Redemptions',
        value: fmt.number(overallSummary.totalRedemptions),
        icon: LocalOffer, accent: '#8B5CF6', bg: '#8B5CF615',
      },
      {
        key: 'codes',  label: 'Active Codes',
        value: fmt.number(overallSummary.totalCodesWithRedemptions),
        sub: `of ${fmt.number(overallSummary.totalCodes)} total`,
        icon: Category, accent: '#F59E0B', bg: '#F59E0B15',
      },
      {
        key: 'rate',   label: 'Redemption Rate',
        value: fmt.pct(overallSummary.redemptionRate),
        icon: People, accent: '#06B6D4', bg: '#06B6D415',
      },
    ];
  }, [overallSummary]);

  return (
    <>
      <Navbar />
      <div className="da-page">
        <div className="da-body">

          <Link to="/admin/dashboard" className="da-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          <div className="da-hd">
            <div className="da-hd-left">
              <span className="da-hd-icon"><Insights style={{ fontSize: 26 }} /></span>
              <div>
                <div className="da-hd-eyebrow">Commerce Intelligence</div>
                <h1 className="da-hd-title">Discount Analytics</h1>
                <p className="da-hd-sub">ROI · Redemptions · Trends · Leaderboard</p>
              </div>
            </div>
            <div className="da-hd-right">
              <LastUpdated timestamp={lastFetchTime} />
              <button
                className={`da-icon-btn ${anyLoading ? 'da-icon-btn--spin' : ''}`}
                onClick={handleRefresh}
                disabled={anyLoading}
                title="Refresh all data"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
              <button
                className={`da-sync-all-btn ${bulkSyncLoading ? 'da-sync-all-btn--loading' : ''}`}
                onClick={handleSyncAll}
                disabled={bulkSyncLoading}
                title="Re-sync all discount analytics from orders"
              >
                {bulkSyncLoading
                  ? <><span className="da-btn-spinner" /> Syncing…</>
                  : <><Sync style={{ fontSize: 15 }} /> Sync All</>
                }
              </button>
            </div>
          </div>

          {error && (
            <div className="da-error-banner">
              <Warning style={{ fontSize: 17 }} />
              <span>{error}</span>
              <button className="da-error-dismiss" onClick={handleDismissError} aria-label="Dismiss">
                <Close style={{ fontSize: 15 }} />
              </button>
            </div>
          )}

          {bulkSyncMessage && !bulkSyncLoading && (
            <div className="da-success-banner">
              <CheckCircle style={{ fontSize: 16 }} />
              <span>{bulkSyncMessage}</span>
            </div>
          )}

          <div className="da-tabs">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`da-tab ${activeView === key ? 'da-tab--active' : ''}`}
                onClick={() => setActiveView(key)}
              >
                <Icon style={{ fontSize: 15 }} />
                {label}
              </button>
            ))}
          </div>

          {/* ════════════ OVERVIEW ════════════ */}
          {activeView === 'overview' && (
            <div className="da-panel">
              <div className={`da-kpi-grid ${anyLoading && overallSummary ? 'da-kpi-grid--loading' : ''}`}>
                {firstLoad
                  ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
                  : !overallSummary
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="da-kpi-card da-kpi-card--empty">
                          <SkeletonBlock h={11} w="60%" mb={8} />
                          <SkeletonBlock h={24} w="50%" />
                        </div>
                      ))
                    : kpiCards.map(k => (
                        <div key={k.key} className="da-kpi-card">
                          <div className="da-kpi-top">
                            <span className="da-kpi-icon" style={{ background: k.bg, color: k.accent }}>
                              <k.icon style={{ fontSize: 20 }} />
                            </span>
                          </div>
                          <div className="da-kpi-label">{k.label}</div>
                          <div className="da-kpi-value" style={k.valueColor ? { color: k.valueColor } : {}}>
                            {k.value}
                          </div>
                          {k.sub && <div className="da-kpi-sub">{k.sub}</div>}
                        </div>
                      ))
                }
              </div>

              <SectionDivider label="ROI by Category" />
              <div className="da-grid-2">
                <Card title="Revenue Influenced by Category" sub="Sorted by influenced revenue" icon={Category} iconColor="#6366F1">
                  {!overview && overviewLoading ? <LoadingState /> : categories.length === 0 ? <Empty label="No category data yet" /> : (
                    <div>
                      {categories.map((cat, i) => {
                        const pct = catMax > 0 ? (cat.totalRevenueInfluenced / catMax) * 100 : 0;
                        return (
                          <div key={cat.category || i} className="da-bar-row">
                            <span className="da-bar-label" title={cat.category}>{cat.category || 'Unknown'}</span>
                            <div className="da-bar-track">
                              <div className="da-bar-fill" style={{ width: `${pct}%`, background: PAL[i % PAL.length] }} />
                            </div>
                            <span className="da-bar-val">{fmt.compact(cat.totalRevenueInfluenced)}</span>
                            <TrendChip value={cat.roi} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card title="Percentage vs Fixed Discounts" sub="ROI and revenue by discount mechanism" icon={BarChartIcon} iconColor="#8B5CF6">
                  {!roiByType && overviewLoading ? <LoadingState /> : types.length === 0 ? <Empty label="No type data yet" /> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={types} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="type" tick={{ fontSize: 11, fill: '#6B7280' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip {...TT} formatter={(v, name) => [
                          fmt.compact(v),
                          name === 'totalRevenueInfluenced' ? 'Revenue Influenced' : 'Discount Cost',
                        ]} />
                        <Bar dataKey="totalRevenueInfluenced" name="totalRevenueInfluenced" radius={[4, 4, 0, 0]}>
                          {types.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <SectionDivider label="Top &amp; Underperforming Codes" />
              <div className="da-grid-2">
                {/* FIX: pass c.discountId (the Discount's _id) not c._id (analytics doc _id) */}
                <Card title="Top Codes by ROI" sub="Codes with highest return on discount spend" icon={TrendingUp} iconColor="#10B981">
                  {!overview && overviewLoading ? <LoadingState /> : topByROI.length === 0 ? <Empty label="No top performers yet" /> : (
                    <div className="da-code-list">
                      {topByROI.slice(0, 8).map((c, i) => (
                        <div key={i} className="da-code-row"
                          onClick={() => (c.discountId || c._id) && openDrawer(c.discountId || c._id)}>
                          <span className="da-code-rank">{i + 1}</span>
                          <span className="da-code-pill">{c.discountCode}</span>
                          <span className="da-code-cat">{c.meta?.category ?? '—'}</span>
                          <span className="da-code-roi" style={{ color: roiColor(c.financials?.roi) }}>
                            {fmt.roi(c.financials?.roi)}
                          </span>
                          <span className="da-code-rev">{fmt.compact(c.financials?.totalRevenueInfluenced)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Underperforming Codes" sub="Low ROI — consider revising these discounts" icon={Warning} iconColor="#EF4444">
                  {!overview && overviewLoading ? <LoadingState /> : underperforming.length === 0 ? (
                    <div className="da-all-clear">
                      <CheckCircle style={{ fontSize: 32, color: '#10B981' }} />
                      <span>All codes performing well</span>
                    </div>
                  ) : (
                    <div className="da-code-list">
                      {underperforming.slice(0, 8).map((c, i) => (
                        <div key={i} className="da-code-row da-code-row--warn"
                          onClick={() => (c.discountId || c._id) && openDrawer(c.discountId || c._id)}>
                          <span className="da-code-rank">{i + 1}</span>
                          <span className="da-code-pill">{c.discountCode}</span>
                          <span className="da-code-cat">{c.meta?.category ?? '—'}</span>
                          <span className="da-code-roi" style={{ color: roiColor(c.financials?.roi) }}>
                            {fmt.roi(c.financials?.roi)}
                          </span>
                          <span className="da-code-rev">{fmt.compact(c.financials?.totalRevenueInfluenced)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <SectionDivider label="Category Detail" />
              <Card title="ROI Detail by Category" sub="Full metrics per discount category" icon={TableChart} iconColor="#374151">
                {categories.length === 0 ? <Empty label="No category data" h={120} /> : (
                  <div className="da-tbl-wrap">
                    <table className="da-tbl">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Codes</th>
                          <th>Redemptions</th>
                          <th>Discount Cost</th>
                          <th>Rev Influenced</th>
                          <th>Avg AOV</th>
                          <th>ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map((cat, i) => (
                          <tr key={i}>
                            <td className="da-td-name">{cat.category}</td>
                            <td>{fmt.number(cat.totalCodes)}</td>
                            <td>{fmt.number(cat.totalRedemptions)}</td>
                            <td className="da-td-red">{fmt.compact(cat.totalDiscountCost)}</td>
                            <td className="da-td-green">{fmt.compact(cat.totalRevenueInfluenced)}</td>
                            <td className="da-td-mono">{fmt.currency(cat.avgAOV)}</td>
                            <td>
                              <span className="da-roi-chip" style={{ color: roiColor(cat.roi), background: `${roiColor(cat.roi)}15` }}>
                                {fmt.roi(cat.roi)}
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
          )}

          {/* ════════════ TRENDS ════════════ */}
          {activeView === 'trends' && (
            <div className="da-panel">
              <div className="da-trend-controls">
                <div className="da-tf-group">
                  {TREND_TIMEFRAMES.map(t => (
                    <button
                      key={t}
                      className={`da-tf-btn ${trendsTf === t ? 'da-tf-btn--active' : ''}`}
                      onClick={() => handleTrendsTimeframeChange(t)}
                      disabled={redemptionTrendsLoading}
                      aria-pressed={trendsTf === t}
                    >
                      {redemptionTrendsLoading && activeTrendsTimeframe === t
                        ? <span className="da-tf-spinner" />
                        : t.charAt(0).toUpperCase() + t.slice(1)
                      }
                    </button>
                  ))}
                </div>
                <TimeframeSheet
                  timeframe={trendsTf}
                  onChange={handleTrendsTimeframeChange}
                  disabled={redemptionTrendsLoading}
                  options={TREND_TIMEFRAMES}
                />
                {redemptionTrendsLoading && <span className="da-refreshing-label">Refreshing…</span>}
              </div>

              {trendSummary && Object.keys(trendSummary).length > 0 && (
                <div className={`da-trend-kpi-strip ${redemptionTrendsLoading ? 'da-trend-kpi-strip--loading' : ''}`}>
                  <div className="da-trend-kpi">
                    <div className="da-trend-kpi-label">Period Redemptions</div>
                    <div className="da-trend-kpi-val">{fmt.number(trendSummary.totalRedemptions)}</div>
                  </div>
                  <div className="da-trend-kpi">
                    <div className="da-trend-kpi-label">Discount Cost</div>
                    <div className="da-trend-kpi-val da-trend-kpi-val--red">{fmt.compact(trendSummary.totalDiscountCost)}</div>
                  </div>
                  <div className="da-trend-kpi">
                    <div className="da-trend-kpi-label">Revenue Influenced</div>
                    <div className="da-trend-kpi-val da-trend-kpi-val--green">{fmt.compact(trendSummary.totalRevenueInfluenced)}</div>
                  </div>
                  <div className="da-trend-kpi">
                    <div className="da-trend-kpi-label">Period ROI</div>
                    <div className="da-trend-kpi-val" style={{ color: roiColor(trendSummary.periodROI) }}>
                      {fmt.roi(trendSummary.periodROI)}
                    </div>
                  </div>
                </div>
              )}

              <SectionDivider label="Daily Redemption Trend" />

              <Card
                title="Daily Redemptions"
                sub={`Store-wide — ${trendsTf} view`}
                icon={LocalOffer}
                iconColor="#e563f1"
                action={redemptionTrendsLoading && <div className="da-card-spinner" />}
              >
                {!redemptionTrends && redemptionTrendsLoading
                  ? <LoadingState label="Loading trend data…" h={280} />
                  : trendData.length === 0
                    ? <Empty label="No trend data for this period" h={280} />
                    : (
                      <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="redeemGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#e563f1" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#e563f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickFormatter={(d) => fmt.date(d)} />
                          <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                          <Tooltip {...TT}
                            labelFormatter={(d) => fmt.date(d)}
                            formatter={(v) => [fmt.number(v), 'Redemptions']} />
                          <Area type="monotone" dataKey="redemptions" stroke="#e563f1" strokeWidth={2} fill="url(#redeemGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )
                }
              </Card>

              <SectionDivider label="Daily Cost vs Revenue" />

              <Card
                title="Discount Cost vs Revenue Influenced"
                sub="Daily comparison"
                icon={AttachMoney}
                iconColor="#10B981"
                action={redemptionTrendsLoading && <div className="da-card-spinner" />}
              >
                {!redemptionTrends && redemptionTrendsLoading
                  ? <LoadingState label="Loading…" h={260} />
                  : trendData.length === 0
                    ? <Empty h={260} />
                    : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickFormatter={(d) => fmt.date(d)} />
                          <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip {...TT}
                            labelFormatter={(d) => fmt.date(d)}
                            formatter={(v, name) => [fmt.compact(v), name === 'revenueInfluenced' ? 'Revenue Influenced' : 'Discount Cost']}
                          />
                          <Bar dataKey="revenueInfluenced" fill="#10B981" opacity={0.85} radius={[3, 3, 0, 0]} />
                          <Bar dataKey="discountCost"      fill="#EF4444" opacity={0.75} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )
                }
              </Card>

              <SectionDivider label="Daily Data" />
              <Card title="Trend Data Table" sub="Full daily breakdown" icon={TableChart} iconColor="#374151">
                {trendData.length === 0 ? <Empty h={120} /> : (
                  <div className="da-tbl-wrap">
                    <table className="da-tbl">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Redemptions</th>
                          <th>Discount Cost</th>
                          <th>Revenue Influenced</th>
                          <th>Daily ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* FIX: fmt.date now handles ISO strings directly */}
                        {trendData.map((row, i) => (
                          <tr key={i}>
                            <td className="da-td-mono">{fmt.date(row.date)}</td>
                            <td>{fmt.number(row.redemptions)}</td>
                            <td className="da-td-red">{fmt.compact(row.discountCost)}</td>
                            <td className="da-td-green">{fmt.compact(row.revenueInfluenced)}</td>
                            <td>
                              <span style={{ color: roiColor(row.dailyROI), fontWeight: 700, fontSize: 12.5 }}>
                                {fmt.roi(row.dailyROI)}
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
          )}

          {/* ════════════ LEADERBOARD ════════════ */}
          {activeView === 'leaderboard' && (
            <div className="da-panel">
              <div className="da-leaderboard-controls">
                <span className="da-leaderboard-label">Sort by:</span>
                {['roi', 'revenue', 'redemptions'].map(s => (
                  <button
                    key={s}
                    className={`da-sort-btn ${sortBy === s ? 'da-sort-btn--active' : ''}`}
                    onClick={() => setSortBy(s)}
                    disabled={topPerformersLoading}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
                {topPerformersLoading && <span className="da-refreshing-label">Loading…</span>}
              </div>

              {topPerformers && (
                <div className="da-lb-kpi-strip">
                  <div className="da-lb-kpi">
                    <div className="da-lb-kpi-label">Codes Shown</div>
                    <div className="da-lb-kpi-val">{topPerformers.count ?? leaderboardCodes.length}</div>
                  </div>
                  <div className="da-lb-kpi">
                    <div className="da-lb-kpi-label">Sorted By</div>
                    <div className="da-lb-kpi-val" style={{ textTransform: 'capitalize' }}>{topPerformers.sortBy}</div>
                  </div>
                  <div className="da-lb-kpi">
                    <div className="da-lb-kpi-label">Category Filter</div>
                    <div className="da-lb-kpi-val">{topPerformers.category === 'all' ? 'All' : topPerformers.category}</div>
                  </div>
                </div>
              )}

              <SectionDivider label="Top Performers" />

              <Card title="Top Codes — Revenue Influenced" sub="Visual comparison of top discount codes" icon={BarChartIcon} iconColor="#6366F1">
                {topPerformersLoading && leaderboardCodes.length === 0
                  ? <LoadingState h={260} />
                  : leaderboardCodes.length === 0
                    ? <Empty h={260} />
                    : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart
                          data={leaderboardCodes.slice(0, 10).map(c => ({
                            name:    (c.discountCode || '').substring(0, 12),
                            revenue: c.financials?.totalRevenueInfluenced ?? 0,
                            cost:    c.financials?.totalDiscountCost      ?? 0,
                          }))}
                          layout="vertical"
                          margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#374151' }} width={90} />
                          <Tooltip {...TT} formatter={(v, name) => [fmt.compact(v), name === 'revenue' ? 'Revenue' : 'Cost']} />
                          <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                            {leaderboardCodes.slice(0, 10).map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )
                }
              </Card>

              <SectionDivider label="Full Leaderboard" />
              <Card
                title="Top Performers Table"
                sub="Click a row to open the detail drawer"
                icon={TableChart}
                iconColor="#374151"
                action={<span className="da-count-badge">{leaderboardCodes.length} codes</span>}
              >
                {topPerformersLoading && leaderboardCodes.length === 0
                  ? <LoadingState h={200} />
                  : leaderboardCodes.length === 0
                    ? <Empty />
                    : (
                      <div className="da-tbl-wrap">
                        <table className="da-tbl">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Code</th>
                              <th>Category</th>
                              <th>Type</th>
                              <th>Redemptions</th>
                              <th>Rev Influenced</th>
                              <th>Discount Cost</th>
                              <th>Avg AOV</th>
                              <th>Retention</th>
                              <th>AOV Lift</th>
                              <th>ROI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaderboardCodes.map((c, i) => {
                              const roi     = c.financials?.roi;
                              const rev     = c.financials?.totalRevenueInfluenced;
                              const cost    = c.financials?.totalDiscountCost;
                              const aov     = c.financials?.avgOrderValue;
                              const redeem  = c.redemptions?.total;
                              const retent  = c.conversion?.postRedemptionRetentionRate;
                              const aovLift = c.baseline?.aovLiftPercent;
                              const cat     = c.meta?.category;
                              const type    = c.meta?.type;
                              return (
                                <tr
                                  key={i}
                                  className="da-tr-clickable"
                                  onClick={() => (c.discountId || c._id) && openDrawer(c.discountId || c._id)}
                                >
                                  <td className="da-td-rank">{i + 1}</td>
                                  <td><span className="da-code-pill-sm">{c.discountCode}</span></td>
                                  <td className="da-td-muted">{cat ?? '—'}</td>
                                  <td className="da-td-muted">{type ?? '—'}</td>
                                  <td>{fmt.number(redeem)}</td>
                                  <td className="da-td-green">{fmt.compact(rev)}</td>
                                  <td className="da-td-red">{fmt.compact(cost)}</td>
                                  <td className="da-td-mono">{fmt.currency(aov)}</td>
                                  <td className="da-td-mono">{fmt.pct(retent)}</td>
                                  <td>
                                    <span style={{ color: roiColor(aovLift), fontWeight: 700, fontSize: 12 }}>
                                      {fmt.roi(aovLift)}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="da-roi-chip" style={{ color: roiColor(roi), background: `${roiColor(roi)}15` }}>
                                      {fmt.roi(roi)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                }
              </Card>
            </div>
          )}

          {/* ════════════ ALL CODES ════════════ */}
          {activeView === 'codes' && (
            <div className="da-panel">
              <div className="da-filter-bar">
                <FilterList style={{ fontSize: 16, color: '#6B7280', flexShrink: 0 }} />
                <span className="da-filter-label">Filter:</span>
                <select
                  className="da-filter-select"
                  value={filterCat}
                  onChange={(e) => setFilterCat(e.target.value)}
                  aria-label="Filter by category"
                >
                  <option value="">All Categories</option>
                  <option value="promo">Promo</option>
                  <option value="loyalty">Loyalty</option>
                  <option value="return">Return</option>
                  <option value="affiliate">Affiliate</option>
                  <option value="support">Support</option>
                  <option value="refund">Refund</option>
                </select>
                <select
                  className="da-filter-select"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  aria-label="Filter by type"
                >
                  <option value="">All Types</option>
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed</option>
                </select>
                {(filterCat || filterType) && (
                  <button
                    className="da-filter-clear"
                    onClick={() => { setFilterCat(''); setFilterType(''); }}
                  >
                    <Close style={{ fontSize: 14 }} /> Clear
                  </button>
                )}
                {listLoading && <span className="da-refreshing-label">Loading…</span>}
              </div>

              <Card
                title="All Discount Codes"
                sub="Full analytics per code — click a row to see detail"
                icon={LocalOffer}
                iconColor="#e563f1"
                action={
                  <span className="da-count-badge">
                    {allAnalytics.length} codes
                    {listPagination.hasNextPage && '+'}
                  </span>
                }
              >
                {listLoading && allAnalytics.length === 0
                  ? <LoadingState h={300} />
                  : allAnalytics.length === 0
                    ? <Empty label="No discount analytics yet — analytics are generated on first redemption" h={200} />
                    : (
                      <div className="da-tbl-wrap">
                        <table className="da-tbl">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Code</th>
                              <th>Category</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Redemptions</th>
                              <th>Unique Users</th>
                              <th>Rev Influenced</th>
                              <th>Discount Cost</th>
                              <th>ROI</th>
                              <th>Last Synced</th>
                              <th>Sync</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allAnalytics.map((a, i) => {
                              const roi     = a.financials?.roi;
                              const syncing = !!syncLoading?.[a._id];
                              const syncErr = syncError?.[a._id];
                              return (
                                <tr
                                  key={a._id || i}
                                  className="da-tr-clickable"
                                  onClick={() => (a.discountId || a._id) && openDrawer(a.discountId || a._id)}
                                >
                                  <td className="da-td-rank">{i + 1}</td>
                                  <td><span className="da-code-pill-sm">{a.discountCode}</span></td>
                                  <td className="da-td-muted" style={{ textTransform: 'capitalize' }}>{a.meta?.category ?? '—'}</td>
                                  <td className="da-td-muted" style={{ textTransform: 'capitalize' }}>{a.meta?.type ?? '—'}</td>
                                  <td>
                                    <span className={`da-status-pill da-status-pill--${a.meta?.status ?? 'unknown'}`}>
                                      {a.meta?.status ?? '—'}
                                    </span>
                                  </td>
                                  <td>{fmt.number(a.redemptions?.total)}</td>
                                  <td>{fmt.number(a.redemptions?.uniqueUsers)}</td>
                                  <td className="da-td-green">{fmt.compact(a.financials?.totalRevenueInfluenced)}</td>
                                  <td className="da-td-red">{fmt.compact(a.financials?.totalDiscountCost)}</td>
                                  <td>
                                    <span className="da-roi-chip" style={{ color: roiColor(roi), background: `${roiColor(roi)}15` }}>
                                      {fmt.roi(roi)}
                                    </span>
                                  </td>
                                  <td className="da-td-mono">{fmt.date(a.lastSyncedAt)}</td>
                                  <td onClick={(e) => e.stopPropagation()}>
                                    <button
                                      className={`da-sync-btn ${syncing ? 'da-sync-btn--loading' : ''} ${syncErr ? 'da-sync-btn--error' : ''}`}
                                      onClick={() => handleSyncSingle(a._id)}
                                      disabled={syncing}
                                      title={syncErr ? `Error: ${syncErr}` : 'Re-sync this code'}
                                    >
                                      {syncing
                                        ? <span className="da-btn-spinner" />
                                        : syncErr
                                          ? <SyncProblem style={{ fontSize: 14 }} />
                                          : <Sync style={{ fontSize: 14 }} />
                                      }
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                }

                {listPagination.hasNextPage && (
                  <div className="da-load-more">
                    <button
                      className="da-load-more-btn"
                      disabled={listLoading}
                      onClick={() => dispatch(fetchAllDiscountAnalytics({
                        limit:  30,
                        sortBy: 'revenue',
                        cursor: listPagination.nextCursor,
                        ...(filterCat  ? { category: filterCat  } : {}),
                        ...(filterType ? { type:     filterType } : {}),
                      }))}
                    >
                      {listLoading
                        ? 'Loading…'
                        : <><span>Load More</span><KeyboardArrowRight style={{ fontSize: 14 }} /></>
                      }
                    </button>
                  </div>
                )}
              </Card>
            </div>
          )}

        </div>
      </div>

      {drawerId && <DetailDrawer discountId={drawerId} onClose={closeDrawer} />}
    </>
  );
}