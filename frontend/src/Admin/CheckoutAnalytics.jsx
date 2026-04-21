import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, ArrowUpward, ArrowDownward, Remove,
  ShoppingCartCheckout, Warning, CheckCircle,
  TrendingDown, AttachMoney, TableChart, Bolt, MoneyOff, ErrorOutline, TrendingUp, Loop, PersonSearch,
} from '@mui/icons-material';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  fetchCheckoutAbandonmentStats,
  fetchRecoveryOpportunities,
  fetchAbandonedCheckouts,
  fetchReAbandonmentAnalytics,
  setOperationsTimeframe,
} from '../features/analytics/operationsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CheckoutAnalytics.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_VOLUME_FOR_RATE = 5;

const PAL = ['#059669','#1D4ED8','#D97706','#DC2626','#7C3AED','#0D9488','#EA580C','#0284C7'];

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style:                 'currency',
      currency:              'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v || 0),

  currencyFull: (v) =>
    new Intl.NumberFormat('en-US', {
      style:                 'currency',
      currency:              'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v || 0),

  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),

  pct: (v) => `${(v || 0).toFixed(1)}%`,

  date: (d) => d ? new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—',

  hours: (h) => h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`,
};

// ── Step label maps ───────────────────────────────────────────────────────────
const STEP_LABEL_MAP = {
  'shipping_info':      'Shipping Information',
  'order_confirmation': 'Order Confirmation',
  'payment_selection':  'Payment Selection',
  'payment_gateway':    'Payment Gateway',
  'payment_failed':     'Payment Failed',
};

const STEP_ABBREV = {
  'Shipping Information': 'Shipping',
  'Order Confirmation':   'Order',
  'Payment Selection':    'Pmt Select',
  'Payment Gateway':      'Gateway',
  'Payment Failed':       'Failed',
};

const resolveStepLabel  = (s = '') => STEP_LABEL_MAP[s] || s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const truncateStepLabel = (label = '') => STEP_ABBREV[label] || (label.length > 10 ? label.slice(0, 9) + '…' : label);

// ── Sub-components ────────────────────────────────────────────────────────────

function TrendBadge({ value, invert = false }) {
  if (value == null)          return <span className="ck-badge ck-badge--flat">—</span>;
 
  if (Object.is(value, -0))   
    return <span className="ck-badge ck-badge--flat"><Remove style={{ fontSize: 10 }} />0%</span>;
  if (value === 0)             
    return <span className="ck-badge ck-badge--flat"><Remove style={{ fontSize: 10 }} />0%</span>;
  const pos = invert ? value < 0 : value > 0;
  return (
    <span className={`ck-badge ${pos ? 'ck-badge--pos' : 'ck-badge--neg'}`}>
      {value > 0 ? <ArrowUpward style={{ fontSize: 10 }} /> : <ArrowDownward style={{ fontSize: 10 }} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Spinner({ h = 200 }) {
  return (
    <div className="ck-loading" style={{ minHeight: h }}>
      <div className="ck-spinner" /><span>Loading…</span>
    </div>
  );
}

function Empty({ label = 'No data available', h = 180 }) {
  return (
    <div className="ck-empty" style={{ minHeight: h }}>
      <ShoppingCartCheckout style={{ fontSize: 40, color: '#9BADBF' }} />
      <span>{label}</span>
    </div>
  );
}

function KpiSkel() {
  return (
    <div className="ck-kpi-skel">
      <div className="ck-kpi-skel-top">
        <div className="ck-skel ck-skel--icon" />
        <div className="ck-skel ck-skel--badge" />
      </div>
      <div className="ck-skel ck-skel--label" />
      <div className="ck-skel ck-skel--value" />
    </div>
  );
}

function Card({ title, sub, icon: cardIcon, iconColor: cardIconColor, action, footer, children }) {
  return (
    <div className="ck-card">
      <div className="ck-card-hd">
        <div className="ck-card-hd-left">
          {cardIcon && (
            <span className="ck-card-icon" style={{ background: `${cardIconColor}18`, color: cardIconColor }}>
              {React.createElement(cardIcon, { style: { fontSize: 18 } })}
            </span>
          )}
          <div>
            <h3 className="ck-card-title">{title}</h3>
            {sub && <p className="ck-card-sub">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="ck-card-body">{children}</div>
      {footer && <div className="ck-card-footer">{footer}</div>}
    </div>
  );
}

const TT = {
  contentStyle: { background: '#FFFFFF', border: '1px solid #DDE3EC', borderRadius: 8, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', color: '#0F1923' },
  labelStyle:   { color: '#0F1923', fontWeight: 700 },
  itemStyle:    { color: '#2D4059' },
};

const DonutCenterLabel = ({ viewBox, abandonmentRate, conversionRate }) => {
  if (!viewBox) return null;
  const { cx, cy } = viewBox;
  return (
    <g>
      <text x={cx} y={cy - 14} textAnchor="middle" dominantBaseline="central"
        fontSize={28} fontWeight={800} fill="#DC2626"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        {(abandonmentRate || 0).toFixed(1)}%
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="central"
        fontSize={10} fontWeight={700} fill="#6b7280"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        ABANDONED
      </text>
      <line x1={cx - 20} y1={cy + 24} x2={cx + 20} y2={cy + 24} stroke="#e5e7eb" strokeWidth={1} />
      <text x={cx} y={cy + 38} textAnchor="middle" dominantBaseline="central"
        fontSize={10} fontWeight={600} fill="#059669"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        {(conversionRate || 0).toFixed(1)}% converted
      </text>
    </g>
  );
};

function DonutLegend({ completed, abandoned, total }) {
  const items = [
    { label: 'Completed', value: completed, fill: '#059669', pct: total > 0 ? (completed / total * 100) : 0 },
    { label: 'Abandoned', value: abandoned,  fill: '#DC2626', pct: total > 0 ? (abandoned  / total * 100) : 0 },
  ];
  return (
    <div className="ck-donut-legend">
      {items.map((item, i) => (
        <div key={i} className="ck-donut-legend-row">
          <span className="ck-donut-legend-dot" style={{ background: item.fill }} />
          <span className="ck-donut-legend-label">{item.label}</span>
          <span className="ck-donut-legend-count">{fmt.number(item.value)}</span>
          <span className="ck-donut-legend-pct" style={{ color: item.fill }}>{item.pct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function getPriority(score) {
  if (!score && score !== 0) return { label: '—', cls: 'low' };
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
}

function dropCls(rate) {
  if (!rate)      return 'low';
  if (rate >= 50) return 'high';
  if (rate >= 25) return 'med';
  return 'low';
}

function TruncatedXAxisTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill="#6B7E99" fontSize={10}>
        {truncateStepLabel(payload?.value)}
      </text>
    </g>
  );
}

function DropOffBadge({ count, dropOffRate }) {
  if (count < MIN_VOLUME_FOR_RATE) {
    return (
      <span
        className="ck-drop-lowvol"
        title={`Only ${count} session${count === 1 ? '' : 's'} — need at least ${MIN_VOLUME_FOR_RATE} for a reliable rate`}
      >
        low vol.
      </span>
    );
  }
  return (
    <span className={`ck-step-drop ck-step-drop--${dropCls(dropOffRate)}`}>
      {fmt.pct(dropOffRate)} drop
    </span>
  );
}

// ── Drop-off rate cell — used in the detail table ────────────────────────────
function DropOffRateCell({ count, dropOffRate }) {
  if (count < MIN_VOLUME_FOR_RATE) {
    return (
      <span
        className="ck-tbl-lowvol"
        title={`Only ${count} session${count === 1 ? '' : 's'} — need ${MIN_VOLUME_FOR_RATE}+ for a reliable rate`}
      >
        low vol.
      </span>
    );
  }
  const cls = dropCls(dropOffRate);
  return (
    <span className={`ck-tbl-rate ck-tbl-rate--${cls}`}>
      {fmt.pct(dropOffRate)}
    </span>
  );
}

// ── Severity cell — used in the detail table ─────────────────────────────────
function SeverityCell({ count, dropOffRate }) {
  if (count < MIN_VOLUME_FOR_RATE) {
    return (
      <span
        className="ck-priority ck-priority--low ck-priority--muted"
        title="Insufficient volume to classify severity"
      >
        Low vol.
      </span>
    );
  }
  const cls = dropCls(dropOffRate);
  return (
    <span className={`ck-priority ck-priority--${cls}`}>
      {cls === 'high' ? 'Critical' : cls === 'med' ? 'Moderate' : 'Low'}
    </span>
  );
}

const VIEWS = [
  { key: 'abandonment',  label: 'Abandonment',      icon: Warning },
  { key: 'funnel',       label: 'Funnel Steps',      icon: ShoppingCartCheckout },
  { key: 'recovery',     label: 'Recovery',           icon: Bolt },
  { key: 'abandoned',    label: 'Abandoned Carts',    icon: MoneyOff },
  { key: 'reabandoned',  label: 'Failed Recoveries',  icon: Loop },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function CheckoutAnalytics() {
  const dispatch = useDispatch();

  const {
    checkoutAbandonment,
    recoveryOpportunities: recoveryOpportunitiesRaw,
    abandonedCheckouts:    abandonedCheckoutsRaw,
    reAbandonmentAnalytics,
    error,
  } = useSelector((s) => s.operations);

  const [activeView, setActiveView] = useState('abandonment');
  const [timeframe,  setTimeframe]  = useState('month');
  const [hasFetched, setHasFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);

  const loadAll = useCallback((tf) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    dispatch(setOperationsTimeframe(tf));

    return Promise.allSettled([
      dispatch(fetchCheckoutAbandonmentStats(tf)),
      dispatch(fetchRecoveryOpportunities(50)),
      dispatch(fetchAbandonedCheckouts({ hours: 720, minValue: 0, limit: 100, page: 1, sortBy: 'priority' })),
      dispatch(fetchReAbandonmentAnalytics(tf)),
    ]).finally(() => { loadingRef.current = false; });
  }, [dispatch]);

  const pendingTimeframe = useRef(timeframe);
  useEffect(() => {
    pendingTimeframe.current = timeframe;
    const promise = loadAll(timeframe);
    if (promise) {
      promise.then(() => {
        setRefreshing(false);
        setHasFetched(true);
      });
    }
    Promise.resolve().then(() => {
      setRefreshing(true);
      setHasFetched(false);
    });
  }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    Promise.resolve().then(() => {
      setRefreshing(true);
      setHasFetched(false);
    });
    const promise = loadAll(timeframe);
    if (promise) {
      promise.then(() => { setRefreshing(false); setHasFetched(true); });
    }
  }, [loadAll, timeframe]);

  const stats = checkoutAbandonment || {};

  const steps = useMemo(() => stats.stepBreakdown || [], [stats.stepBreakdown]);

  const stepsMax = steps.length
    ? Math.max(1, ...steps.map((s) => s.count || 0))
    : 1;

  const opps = recoveryOpportunitiesRaw?.opportunities || [];
  const abandoned = abandonedCheckoutsRaw?.abandonedCheckouts || [];
  const first = !hasFetched;

  const completedCheckouts = stats.completedCheckouts || 0;
  const abandonedCount     = stats.abandonedCheckouts || 0;
  const totalCheckouts     = completedCheckouts + abandonedCount;
  const conversionRate     = totalCheckouts > 0 ? (completedCheckouts / totalCheckouts) * 100 : 0;

  const recoverableRevenue = stats.recoverableCount  || 0;

  const totalFailedRecoveries  = stats.totalFailedRecoveries  ?? (stats.reAbandonedCount || 0);
  const totalFailedRevenueLost = stats.totalFailedRevenueLost ?? (stats.failedRecoveryRevenue || 0);
  const expiredRecoveryCount   = stats.expiredRecoveryCount   ?? 0;
  const reAbandonedCount       = stats.reAbandonedCount       ?? 0;

  const barChartData = useMemo(
    () => steps.map((s) => ({
      resolvedLabel: resolveStepLabel(s.step),
      shortName:     truncateStepLabel(resolveStepLabel(s.step)),
      count:         s.count       || 0,
      dropOff:       s.dropOffRate || 0,
    })),
    [steps]
  );

  const pieData = useMemo(() => [
    { name: 'Completed', value: completedCheckouts, fill: '#059669' },
    { name: 'Abandoned',  value: abandonedCount,    fill: '#DC2626' },
  ].filter((d) => d.value > 0), [completedCheckouts, abandonedCount]);

  const reaData    = reAbandonmentAnalytics?.current || {};
  const reaSteps   = reaData.stepBreakdown || [];
  const reaStepMax = reaSteps.length ? Math.max(1, ...reaSteps.map((s) => s.count || 0)) : 1;

  return (
    <>
      <Navbar />
      <div className="ck-page">
        <div className="ck-body">

          <Link to="/admin/dashboard" className="ck-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          <div className="ck-hd">
            <div className="ck-hd-left">
              <span className="ck-hd-icon"><ShoppingCartCheckout style={{ fontSize: 28 }} /></span>
              <div>
                <div className="ck-hd-eyebrow">Conversion Intelligence</div>
                <h1 className="ck-hd-title">Checkout Analytics</h1>
                <p className="ck-hd-sub">Abandonment · Funnel · Recovery · Opportunities · Failed Recoveries</p>
              </div>
            </div>
            <div className="ck-hd-right">
              <div className="ck-tf">
                {['day','week','month','quarter','year'].map((t) => (
                  <button
                    key={t}
                    className={`ck-tf-btn ${timeframe === t ? 'ck-tf-btn--active' : ''}`}
                    onClick={() => setTimeframe(t)}
                    disabled={refreshing}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <button
                className={`ck-icon-btn ${refreshing ? 'ck-icon-btn--spin' : ''}`}
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 19 }} />
              </button>
            </div>
          </div>

          {error && (
            <div className="ck-error"><ErrorOutline style={{ fontSize: 17 }} />{error}</div>
          )}

          {/* ── Top KPIs ── */}
          <div className="ck-grid-4">
            {first ? (
              Array.from({ length: 5 }).map((_, i) => <KpiSkel key={i} />)
            ) : (
              <>
                <div className="ck-kpi ck-kpi--red">
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon"><Warning style={{ fontSize: 20 }} /></span>
                    <TrendBadge value={stats.trend ?? null} invert />
                  </div>
                  <div className="ck-kpi-label">Abandonment Rate</div>
                  <div className="ck-kpi-value">{fmt.pct(stats.abandonmentRate)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">{fmt.number(abandonedCount)} abandoned</span>
                  </div>
                </div>

                <div className="ck-kpi ck-kpi--green">
                  <div className="ck-kpi-top"><span className="ck-kpi-icon"><CheckCircle style={{ fontSize: 20 }} /></span></div>
                  <div className="ck-kpi-label">Completed Checkouts</div>
                  <div className="ck-kpi-value">{fmt.number(completedCheckouts)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">Conv rate: {fmt.pct(conversionRate)}</span>
                  </div>
                </div>

                <div className="ck-kpi ck-kpi--blue">
                  <div className="ck-kpi-top"><span className="ck-kpi-icon"><Bolt style={{ fontSize: 20 }} /></span></div>
                  <div className="ck-kpi-label">Recovery Rate</div>
                  <div className="ck-kpi-value">{fmt.pct(stats.recoveryRate)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">Organic: {fmt.number(stats.organicRecoveryCount || 0)}</span>
                  </div>
                </div>

                
              <div className="ck-kpi ck-kpi--amber">
                <div className="ck-kpi-top">
                  <span className="ck-kpi-icon"><AttachMoney style={{ fontSize: 20 }} /></span>
                </div>
                <div className="ck-kpi-label">Recoverable Revenue</div>
                <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(recoverableRevenue)}</div>
                <div className="ck-kpi-footer">
                  <span className="ck-kpi-sub">{fmt.number(recoverableCount)} abandoned carts</span>
                </div>
              </div>

                <div className="ck-kpi ck-kpi--purple">
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon"><Loop style={{ fontSize: 20 }} /></span>
                    <TrendBadge value={reAbandonmentAnalytics?.trend?.totalChange ?? null} invert />
                  </div>
                  <div className="ck-kpi-label">Failed Recoveries</div>
                  <div className="ck-kpi-value">{fmt.number(totalFailedRecoveries)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub ck-kpi-sub--split">
                      <span title="Clicked link, abandoned again">↩ {fmt.number(reAbandonedCount)} re-abn</span>
                      <span title="All tokens expired, never clicked">⌛ {fmt.number(expiredRecoveryCount)} expired</span>
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="ck-tabs">
            {VIEWS.map(({ key, label, icon: ViewIcon }) => (
              <button
                key={key}
                className={`ck-tab ${activeView === key ? 'ck-tab--active' : ''}`}
                onClick={() => setActiveView(key)}
              >
                <ViewIcon style={{ fontSize: 15 }} />{label}
              </button>
            ))}
          </div>

          {/* ══ ABANDONMENT OVERVIEW ══ */}
          {activeView === 'abandonment' && (
            <div className="ck-panel">
              <div className="ck-section"><span className="ck-section-text">Abandonment Overview</span><span className="ck-section-line" /></div>
              <div className="ck-grid-2">
                <Card title="Checkout Completion Rate" sub="Abandoned vs completed sessions" icon={ShoppingCartCheckout} iconColor="#059669">
                  {first ? <Spinner h={300} /> : (
                    <>
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={72}
                            outerRadius={100}
                            strokeWidth={0}
                            paddingAngle={pieData.length > 1 ? 3 : 0}
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            {...TT}
                            formatter={(v) => [fmt.number(v), 'Checkouts']}
                          />
                          <Pie
                            data={[{ value: 1 }]}
                            dataKey="value"
                            cx="50%"
                            cy="50%"
                            innerRadius={0}
                            outerRadius={0}
                            fill="transparent"
                            stroke="none"
                            label={<DonutCenterLabel abandonmentRate={stats.abandonmentRate} conversionRate={conversionRate} />}
                            labelLine={false}
                            isAnimationActive={false}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <DonutLegend
                        completed={completedCheckouts}
                        abandoned={abandonedCount}
                        total={totalCheckouts}
                      />
                    </>
                  )}
                </Card>

                {/* FIX: Recovery Performance card
                    - Removed "Lost Revenue" row (was a duplicate of failed recovery logic)
                    - Replaced with "Recoverable Revenue" from stats.recoverableRevenue
                    - "Revenue Lost to Failed Recoveries" remains as its own distinct metric
                    representing definitively failed recovery attempts only */}
                <Card title="Recovery Performance" sub="Recoverable revenue, recovered revenue and failed recovery breakdown" icon={Bolt} iconColor="#1D4ED8">
                  {first ? <Spinner h={300} /> : (
                    <div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recovery Rate</span>
                        <span className="ck-metric-val ck-metric-val--green">{fmt.pct(stats.recoveryRate)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recovered Revenue</span>
                        <span className="ck-metric-val ck-metric-val--green">{fmt.currency(stats.recoveredValue)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Organic Recoveries</span>
                        <span className="ck-metric-val ck-metric-val--green">{fmt.number(stats.organicRecoveryCount || 0)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recoverable Revenue</span>
                        <span className="ck-metric-val ck-metric-val--amber">{fmt.currency(recoverableRevenue)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Failed Recoveries (Total)</span>
                        <span className="ck-metric-val ck-metric-val--purple">{fmt.number(totalFailedRecoveries)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label ck-metric-label--indent ck-metric-label--muted">↩ Re-abandoned</span>
                        <span className="ck-metric-val ck-metric-val--purple ck-metric-val--sm">{fmt.number(reAbandonedCount)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label ck-metric-label--indent ck-metric-label--muted">⌛ Expired (never clicked)</span>
                        <span className="ck-metric-val ck-metric-val--purple ck-metric-val--sm">{fmt.number(expiredRecoveryCount)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Revenue Lost to Failed Recoveries</span>
                        <span className="ck-metric-val ck-metric-val--red">{fmt.currency(totalFailedRevenueLost)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Emails Sent</span>
                        <span className="ck-metric-val">{fmt.number(stats.emailsSent)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Orders Recovered</span>
                        <span className="ck-metric-val ck-metric-val--green">{fmt.number(stats.recoveredOrders)}</span>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              <div className="ck-section"><span className="ck-section-text">Funnel Quick View</span><span className="ck-section-line" /></div>
              <div className="ck-row">
                <Card
                  title="Step Drop-Off Rates"
                  sub={`Of users who reached each step, what fraction abandoned there (first abandonment) — rates shown for ${MIN_VOLUME_FOR_RATE}+ sessions only`}
                  icon={TrendingDown}
                  iconColor="#DC2626"
                >
                  {first ? <Spinner h={200} /> : steps.length === 0 ? <Empty label="No step data available" h={200} /> : (
                    <div>
                      {steps.map((step, i) => (
                        <div className="ck-bar-row" key={i}>
                          <span className="ck-bar-label">{resolveStepLabel(step.step)}</span>
                          <div className="ck-bar-track">
                            <div
                              className="ck-bar-fill"
                              style={{
                                width: `${stepsMax > 0 ? (step.count / stepsMax) * 100 : 0}%`,
                                background: PAL[i % PAL.length],
                              }}
                            />
                          </div>
                          <span className="ck-bar-val">{fmt.number(step.count)}</span>
                          <DropOffBadge count={step.count} dropOffRate={step.dropOffRate} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══ FUNNEL STEPS ══ */}
          {activeView === 'funnel' && (
            <div className="ck-panel">
              <div className="ck-section"><span className="ck-section-text">Checkout Funnel Analysis</span><span className="ck-section-line" /></div>
              <div className="ck-grid-2">
                <Card
                  title="Abandonment Funnel"
                  sub="Users who abandoned at each step vs how many reached that step"
                  icon={ShoppingCartCheckout}
                  iconColor="#059669"
                >
                  {first ? <Spinner h={360} /> : steps.length === 0 ? <Empty h={360} /> : (
                    <div className="ck-funnel">
                      {steps.map((step, i) => {
                        const widthPct = stepsMax > 0 ? (step.count / stepsMax) * 100 : 0;
                        return (
                          <div className="ck-step" key={i}>
                            <div className="ck-step-top">
                              <div className="ck-step-top-left">
                                <span className="ck-step-number">{i + 1}</span>
                                <span className="ck-step-name">{resolveStepLabel(step.step)}</span>
                              </div>
                              <div className="ck-step-meta">
                                <span className="ck-step-count">{fmt.number(step.count)} abandoned</span>
                                {step.reachCount != null && (
                                  <span className="ck-step-reach">
                                    of {fmt.number(step.reachCount)} reached
                                  </span>
                                )}
                                <DropOffBadge count={step.count} dropOffRate={step.dropOffRate} />
                              </div>
                            </div>
                            <div className="ck-step-track">
                              <div className="ck-step-fill" style={{ width: `${widthPct}%`, background: PAL[i % PAL.length] }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card title="Step Volume Chart" sub="Customers abandoning at each checkout step" icon={TrendingDown} iconColor="#DC2626">
                  {first ? <Spinner h={360} /> : barChartData.length === 0 ? <Empty h={360} /> : (
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart data={barChartData} margin={{ top: 4, right: 8, left: 0, bottom: 48 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF4" />
                        <XAxis dataKey="shortName" tick={<TruncatedXAxisTick />} interval={0} height={56} />
                        <YAxis tick={{ fontSize: 10, fill: '#6B7E99' }} />
                        <Tooltip
                          {...TT}
                          labelFormatter={(shortName, payload) => payload?.[0]?.payload?.resolvedLabel ?? shortName}
                          formatter={(v, n) => [
                            n === 'count' ? fmt.number(v) : fmt.pct(v),
                            n === 'count' ? 'Abandoned' : 'Drop-Off Rate',
                          ]}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {barChartData.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <div className="ck-section"><span className="ck-section-text">Drop-Off Analysis</span><span className="ck-section-line" /></div>
              <div className="ck-row">
                <Card
                  title="Step Detail Table"
                  sub={`Abandoned count, users reached, and true drop-off rate per step — rates shown for ${MIN_VOLUME_FOR_RATE}+ sessions only`}
                  icon={TableChart}
                  iconColor="#1D4ED8"
                >
                  {first ? <Spinner h={200} /> : steps.length === 0 ? <Empty /> : (
                    <div className="ck-tbl-wrap">
                      <table className="ck-tbl">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Step Name</th>
                            <th>Abandoned Here</th>
                            <th>Reached Step</th>
                            <th>Drop-Off Rate</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((step, i) => (
                            <tr key={i}>
                              <td className="ck-td-mono">{i + 1}</td>
                              <td className="ck-td-name">{resolveStepLabel(step.step)}</td>
                              <td>{fmt.number(step.count)}</td>
                              <td className="ck-td-reach">
                                {step.reachCount != null ? fmt.number(step.reachCount) : '—'}
                              </td>
                              <td>
                                <DropOffRateCell count={step.count} dropOffRate={step.dropOffRate} />
                              </td>
                              <td>
                                <SeverityCell count={step.count} dropOffRate={step.dropOffRate} />
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

          {/* ══ RECOVERY OPPORTUNITIES ══ */}
          {activeView === 'recovery' && (
            <div className="ck-panel">
              <div className="ck-grid-4 ck-grid-4--auto">
                {first ? (
                  Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>

                    <div className="ck-kpi ck-kpi--amber">
                      <div className="ck-kpi-label">Total Recoverable</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(recoverableRevenue)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">{fmt.number(recoverableCount)} abandoned carts</span>
                      </div>
                    </div>

                    <div className="ck-kpi ck-kpi--green">
                      <div className="ck-kpi-label">Recovered Revenue</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(stats.recoveredValue)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Organic: {fmt.number(stats.organicRecoveryCount || 0)} · Rate: {fmt.pct(stats.recoveryRate)}</span>
                      </div>
                    </div>
                    <div className="ck-kpi ck-kpi--red">
                      <div className="ck-kpi-label">Avg Cart Value</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(recoveryOpportunitiesRaw?.summary?.avgCheckoutValue || 0)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Per abandoned cart</span></div>
                    </div>
                  </>
                )}
              </div>

              <div className="ck-section"><span className="ck-section-text">Recovery Opportunities</span><span className="ck-section-line" /></div>
              <div className="ck-row">
                {first ? (
                  <Spinner h={300} />
                ) : opps.length === 0 ? (
                  <Empty label="No recovery opportunities found — all eligible carts have been contacted or converted." h={300} />
                ) : (
                  <div className="ck-opp-grid">
                    {opps.slice(0, 12).map((opp, i) => {
                      const user          = opp.user || {};
                      const priorityScore = opp.priority ?? opp.priorityScore ?? 0;
                      const priority      = getPriority(priorityScore);
                      const cartValue     = opp.pricing?.totalPrice || 0;
                      const itemCount     = opp.items?.length || 0;
                      const lastStep      = resolveStepLabel(opp.abandonment?.abandonedAtStep) || '—';
                      return (
                        <div className="ck-opp-card" key={i}>
                          <div className="ck-opp-card-top">
                            <span className={`ck-priority ck-priority--${priority.cls}`}>{priority.label} Priority</span>
                            <span className="ck-opp-score">Score: {priorityScore}</span>
                          </div>
                          <div className="ck-opp-name">{user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Guest'}</div>
                          <div className="ck-opp-email">{user.email || '—'}</div>
                          <div className="ck-opp-stats">
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Cart Value</div>
                              <div className="ck-opp-stat-val ck-opp-stat-val--green">{fmt.currency(cartValue)}</div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Items</div>
                              <div className="ck-opp-stat-val">{fmt.number(itemCount)}</div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Last Step</div>
                              <div className="ck-opp-stat-val ck-opp-stat-val--red">{lastStep}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ ABANDONED CHECKOUTS LIST ══ */}
          {activeView === 'abandoned' && (
            <div className="ck-panel">
              <div className="ck-section"><span className="ck-section-text">Abandoned Checkout List</span><span className="ck-section-line" /></div>

              <div className="ck-grid-4 ck-grid-4--auto ck-grid-4--mb">
                {first ? (
                  Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi ck-kpi--red">
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">Total Lost Value</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(abandonedCheckoutsRaw?.summary?.totalValue ?? 0)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">{abandonedCheckoutsRaw?.pagination?.totalCheckouts ?? abandoned.length} carts</span>
                      </div>
                    </div>
                    <div className="ck-kpi ck-kpi--amber">
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><AttachMoney style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">Avg Cart Value</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(abandonedCheckoutsRaw?.summary?.avgValue ?? 0)}</div>
                    </div>
                    <div className="ck-kpi ck-kpi--purple">
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><TrendingUp style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">High Priority</div>
                      <div className="ck-kpi-value">{fmt.number(abandonedCheckoutsRaw?.summary?.highPriorityCheckouts ?? 0)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Score ≥ 70</span></div>
                    </div>
                  </>
                )}
              </div>

              <div className="ck-row">
                <Card
                  title="All Abandoned Checkouts"
                  sub="Sorted by priority score — act on high priority first"
                  icon={MoneyOff}
                  iconColor="#DC2626"
                  action={
                    <span className="ck-card-count">
                      {abandonedCheckoutsRaw?.pagination?.totalCheckouts ?? abandoned.length} checkouts
                    </span>
                  }
                >
                  {first ? (
                    <Spinner h={300} />
                  ) : abandoned.length === 0 ? (
                    <Empty label="No abandoned checkouts — great news!" h={300} />
                  ) : (
                    <div className="ck-tbl-wrap">
                      <table className="ck-tbl">
                        <thead>
                          <tr>
                            <th>#</th><th>Customer</th><th>Email</th><th>Cart Value</th>
                            <th>Items</th><th>First Step</th><th>Priority</th><th>Flags</th><th>Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {abandoned.slice(0, 50).map((c, i) => {
                            const user          = c.user || {};
                            const priorityScore = c.priority ?? c.priorityScore ?? 0;
                            const priority      = getPriority(priorityScore);
                            const firstStep     = c.abandonment?.firstAbandonedAtStep || c.abandonment?.abandonedAtStep;
                            const isReAbandoned = c.abandonment?.reAbandoned === true;
                            const isOrganic     = c.abandonment?.organicRecovery === true;
                            return (
                              <tr key={i}>
                                <td className="ck-td-rank">{i + 1}</td>
                                <td className="ck-td-name">
                                  {user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Guest'}
                                </td>
                                <td className="ck-td-email">{user.email || '—'}</td>
                                <td className="ck-td-money">{fmt.currency(c.pricing?.totalPrice || 0)}</td>
                                <td>{fmt.number(c.items?.length || 0)}</td>
                                <td className="ck-td-step">{resolveStepLabel(firstStep) || '—'}</td>
                                <td>
                                  <span className={`ck-priority ck-priority--${priority.cls}`}>{priority.label}</span>
                                </td>
                                <td>
                                  <div className="ck-flag-group">
                                    {isReAbandoned && (
                                      <span className="ck-flag ck-flag--reabandoned" title="Clicked recovery link but abandoned again">Re-abn</span>
                                    )}
                                    {isOrganic && (
                                      <span className="ck-flag ck-flag--organic" title="Converted without using recovery link">Organic</span>
                                    )}
                                  </div>
                                </td>
                                <td className="ck-td-date">
                                  {fmt.date(c.abandonment?.abandonedAt || c.updatedAt || c.createdAt)}
                                </td>
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

          {/* ══ FAILED RECOVERIES ══ */}
          {activeView === 'reabandoned' && (
            <div className="ck-panel">
              <div className="ck-section"><span className="ck-section-text">Failed Recovery Analysis</span><span className="ck-section-line" /></div>

              <div className="ck-grid-4 ck-grid-4--auto">
                {first ? (
                  Array.from({ length: 5 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi ck-kpi--purple">
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon"><Loop style={{ fontSize: 20 }} /></span>
                        <TrendBadge value={reAbandonmentAnalytics?.trend?.totalChange ?? null} invert />
                      </div>
                      <div className="ck-kpi-label">Total Failed Recoveries</div>
                      <div className="ck-kpi-value">{fmt.number(totalFailedRecoveries)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Re-abn + Expired</span>
                      </div>
                    </div>

                    <div className="ck-kpi ck-kpi--orange">
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon"><Loop style={{ fontSize: 20 }} /></span>
                      </div>
                      <div className="ck-kpi-label">↩ Re-abandoned</div>
                      <div className="ck-kpi-value">{fmt.number(reAbandonedCount)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Clicked link, left again</span>
                      </div>
                    </div>

                    <div className="ck-kpi ck-kpi--gray">
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon ck-kpi-icon--emoji">⌛</span>
                      </div>
                      <div className="ck-kpi-label">⌛ Expired (Never Clicked)</div>
                      <div className="ck-kpi-value">{fmt.number(expiredRecoveryCount)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">All tokens elapsed, no response</span>
                      </div>
                    </div>

                    <div className="ck-kpi ck-kpi--red">
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span>
                        <TrendBadge value={reAbandonmentAnalytics?.trend?.revenueLostChange ?? null} invert />
                      </div>
                      <div className="ck-kpi-label">Total Revenue Lost</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(totalFailedRevenueLost)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Avg {fmt.currency(reaData.avgCartValue || 0)} per cart</span>
                      </div>
                    </div>

                    <div className="ck-kpi ck-kpi--amber">
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><PersonSearch style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">Avg Time to Re-abandon</div>
                      <div className="ck-kpi-value">{fmt.hours(reaData.avgHoursToReAbandon)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">After clicking recovery link</span></div>
                    </div>
                  </>
                )}
              </div>

              <div className="ck-section"><span className="ck-section-text">Post-Recovery Drop-Off by Step</span><span className="ck-section-line" /></div>
              <div className="ck-grid-2">
                <Card title="Where Users Leave After Clicking Link" sub="Step at which the second abandonment occurred" icon={Loop} iconColor="#7C3AED">
                  {first ? <Spinner h={280} /> : reaSteps.length === 0 ? <Empty h={280} label="No re-abandonment step data yet" /> : (
                    <div>
                      {reaSteps.map((step, i) => (
                        <div className="ck-bar-row" key={i}>
                          <span className="ck-bar-label">{step.stepLabel || resolveStepLabel(step.step)}</span>
                          <div className="ck-bar-track">
                            <div className="ck-bar-fill ck-bar-fill--purple" style={{ width: `${reaStepMax > 0 ? (step.count / reaStepMax) * 100 : 0}%` }} />
                          </div>
                          <span className="ck-bar-val">{fmt.number(step.count)}</span>
                          <span className="ck-bar-revenue">{fmt.currency(step.totalValue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="First vs Post-Recovery Drop-Off" sub="Where users abandon on first attempt vs after clicking recovery link" icon={TrendingDown} iconColor="#DC2626">
                  {first ? <Spinner h={280} /> : (steps.length === 0 && reaSteps.length === 0) ? <Empty h={280} /> : (
                    <div className="ck-tbl-wrap">
                      <table className="ck-tbl">
                        <thead>
                          <tr>
                            <th>Step</th>
                            <th>First Abandon</th>
                            <th>Post-Recovery</th>
                            <th>Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const stepKeys = [...new Set([
                              ...steps.map((s) => s.step),
                              ...reaSteps.map((s) => s.step),
                            ])];
                            return stepKeys.map((key, i) => {
                              const firstRow = steps.find((s) => s.step === key);
                              const reaRow   = reaSteps.find((s) => s.step === key);
                              const delta    = (reaRow?.count || 0) - (firstRow?.count || 0);
                              return (
                                <tr key={i}>
                                  <td className="ck-td-name ck-td-name--sm">{resolveStepLabel(key)}</td>
                                  <td>{fmt.number(firstRow?.count || 0)}</td>
                                  <td className="ck-td-purple">{fmt.number(reaRow?.count || 0)}</td>
                                  <td className={`ck-td-delta ${delta > 0 ? 'ck-td-delta--up' : delta < 0 ? 'ck-td-delta--down' : 'ck-td-delta--flat'}`}>
                                    {delta > 0 ? '+' : ''}{fmt.number(delta)}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
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