/**
 * CheckoutAnalytics — Recovery tab fix
 *
 * CHANGES IN THIS FILE:
 *
 * 1. "Not Yet Contacted" section removed entirely from the Recovery tab.
 *    That concern is handled by the Recovery Email Monitor / cron page.
 *
 * 2. "Active Campaigns" now sourced from recoveryEmailSlice (fetchSendList)
 *    rather than derived from the checkout operations slice.
 *    Active = outcome is 'sent' | 'clicked' | 'exhausted'.
 *      - sent      → email delivered, user hasn't clicked yet
 *      - clicked   → user clicked but hasn't converted
 *      - exhausted → all N emails sent, tokens still potentially live,
 *                    awaiting click until the last token expires
 *    This is the canonical set of "campaigns still in play."
 *
 * 3. A dedicated useEffect fetches the send-list once when the Recovery tab
 *    is first activated (or refreshed).  The fetch uses outcome=all so
 *    client-side filtering can cover all three active outcomes without three
 *    round-trips.  hours=8760 (1 yr) matches the existing getSendListHandler
 *    default so no records are inadvertently excluded.
 */

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
import {
  fetchSendList,
  selectSendList,
  selectSendListLoading,
} from '../features/admin/recoveryEmailSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CheckoutAnalytics.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_VOLUME_FOR_RATE = 5;

const PAL = ['#059669','#1D4ED8','#D97706','#DC2626','#7C3AED','#0D9488','#EA580C','#0284C7'];

const FUNNEL_ORDER = [
  'shipping_info',
  'order_confirmation',
  'payment_selection',
  'payment_gateway',
  'payment_failed',
];

// Outcomes that constitute an "active" recovery campaign — emails sent or
// clicked but not yet resolved to a terminal state.
// exhausted = all emails sent but tokens still valid → still "in play."
const ACTIVE_RECOVERY_OUTCOMES = new Set(['sent', 'clicked', 'exhausted']);

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

const DISPLAY_TO_RAW = Object.fromEntries(
  Object.entries(STEP_LABEL_MAP).map(([k, v]) => [v, k])
);

const STEP_ABBREV = {
  'Shipping Information': 'Shipping',
  'Order Confirmation':   'Order',
  'Payment Selection':    'Pmt Select',
  'Payment Gateway':      'Gateway',
  'Payment Failed':       'Failed',
};

const resolveStepLabel = (s = '') => {
  if (Object.values(STEP_LABEL_MAP).includes(s)) return s;
  return STEP_LABEL_MAP[s] || s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const truncateStepLabel = (label = '') =>
  STEP_ABBREV[label] || (label.length > 10 ? label.slice(0, 9) + '…' : label);

const sortByFunnelOrder = (steps = [], getKey = (s) => s.step) =>
  [...steps].sort((a, b) => {
    const resolve = (item) => {
      const key    = getKey(item);
      const rawKey = DISPLAY_TO_RAW[key] || key;
      const idx    = FUNNEL_ORDER.indexOf(rawKey);
      return idx === -1 ? 999 : idx;
    };
    return resolve(a) - resolve(b);
  });

// ── Outcome label map for campaign status display ─────────────────────────────
const OUTCOME_LABEL = {
  sent:      'Awaiting click',
  clicked:   'Clicked — not converted',
  exhausted: 'All emails sent',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function TrendBadge({ value, invert = false }) {
  if (value == null) return <span className="ck-badge ck-badge--flat">—</span>;
  if (Object.is(value, -0)) return <span className="ck-badge ck-badge--flat"><Remove style={{ fontSize: 10 }} />0%</span>;
  if (value === 0)           return <span className="ck-badge ck-badge--flat"><Remove style={{ fontSize: 10 }} />0%</span>;
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

function AbandonmentFlags({ isReAbandoned, isOrganic, isExpired }) {
  if (!isReAbandoned && !isOrganic && !isExpired) {
    return <span className="ck-flag-none">—</span>;
  }
  return (
    <div className="ck-flag-group">
      {isReAbandoned && (
        <span className="ck-flag ck-flag--reabandoned" title="Clicked recovery link but abandoned again">
          Re-abn
        </span>
      )}
      {isExpired && (
        <span className="ck-flag ck-flag--expired" title="Recovery token expired — never clicked">
          Expired
        </span>
      )}
      {isOrganic && (
        <span className="ck-flag ck-flag--organic" title="Converted without using recovery link">
          Organic
        </span>
      )}
    </div>
  );
}

/**
 * CampaignStatusBadge
 * Shows the live recovery outcome in a human-readable chip.
 * exhausted gets its own label since it's distinct from sent/clicked.
 */
function CampaignStatusBadge({ outcome, confirmedAttempts, maxAttempts }) {
  if (outcome === 'clicked') {
    return (
      <span className="ck-badge ck-badge--pos" title="User clicked recovery link — not yet converted">
        Clicked
      </span>
    );
  }
  if (outcome === 'exhausted') {
    return (
      <span className="ck-badge ck-badge--neg" title={`All ${maxAttempts} emails sent — awaiting click before tokens expire`}>
        {confirmedAttempts}/{maxAttempts} sent · awaiting click
      </span>
    );
  }
  // outcome === 'sent'
  return (
    <span className="ck-badge ck-badge--flat" title={`${confirmedAttempts}/${maxAttempts} email(s) sent — user hasn't clicked yet`}>
      {confirmedAttempts}/{maxAttempts} sent
    </span>
  );
}

const VIEWS = [
  { key: 'abandonment', label: 'Abandonment',     TabIcon: Warning              },
  { key: 'funnel',      label: 'Funnel Steps',     TabIcon: ShoppingCartCheckout },
  { key: 'recovery',    label: 'Recovery',          TabIcon: Bolt                 },
  { key: 'abandoned',   label: 'Abandoned Carts',   TabIcon: MoneyOff             },
  { key: 'reabandoned', label: 'Failed Recoveries', TabIcon: Loop                 },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function CheckoutAnalytics() {
  const dispatch = useDispatch();

  const {
    checkoutAbandonment,
    abandonedCheckouts:    abandonedCheckoutsRaw,
    reAbandonmentAnalytics,
    error,
  } = useSelector((s) => s.operations);

  // Source active campaigns from the recovery email slice — it has the
  // canonical outcome state per campaign and the correct { checkout, recovery }
  // shape without needing manual derivation from the operations slice.
  const sendList        = useSelector(selectSendList);
  const sendListLoading = useSelector(selectSendListLoading);

  const [activeView, setActiveView] = useState('abandonment');
  const [timeframe,  setTimeframe]  = useState('month');
  const [hasFetched, setHasFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Tracks whether we've loaded send-list data for the recovery tab
  const [sendListFetched, setSendListFetched] = useState(false);
  const loadingRef     = useRef(false);
  const sendListRef    = useRef(false);

  const loadAll = useCallback((tf) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    dispatch(setOperationsTimeframe(tf));

    return Promise.allSettled([
      dispatch(fetchCheckoutAbandonmentStats(tf)),
      dispatch(fetchAbandonedCheckouts({
        hours:    8760,
        minValue: 0,
        limit:    200,
        page:     1,
        sortBy:   'priority',
      })),
      dispatch(fetchReAbandonmentAnalytics(tf)),
    ]).finally(() => { loadingRef.current = false; });
  }, [dispatch]);

  // Load send-list from the recovery email slice.
  // Called when the recovery tab is first opened, or on manual refresh.
  const loadSendList = useCallback(() => {
    if (sendListRef.current) return;
    sendListRef.current = true;
    dispatch(fetchSendList({
      page:    1,
      limit:   200,
      outcome: 'all',
      sortBy:  'priority',
      hours:   8760,
    })).finally(() => {
      sendListRef.current = false;
      setSendListFetched(true);
    });
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

  // Fetch send-list when recovery tab is first activated
  useEffect(() => {
    if (activeView === 'recovery' && !sendListFetched) {
      loadSendList();
    }
  }, [activeView, sendListFetched, loadSendList]);

  const handleRefresh = useCallback(() => {
    Promise.resolve().then(() => {
      setRefreshing(true);
      setHasFetched(false);
    });
    const promise = loadAll(timeframe);
    if (promise) {
      promise.then(() => { setRefreshing(false); setHasFetched(true); });
    }
    // Also refresh send-list if on the recovery tab
    if (activeView === 'recovery') {
      setSendListFetched(false);
      loadSendList();
    }
  }, [loadAll, loadSendList, timeframe, activeView]);

  const stats = checkoutAbandonment || {};

  const steps = useMemo(
    () => sortByFunnelOrder(
      stats.stepBreakdown || [],
      (s) => DISPLAY_TO_RAW[s.step] || s.step
    ),
    [stats.stepBreakdown]
  );

  const stepsMax = steps.length ? Math.max(1, ...steps.map((s) => s.count || 0)) : 1;

  const first = !hasFetched;

  const abandoned = useMemo(
    () => abandonedCheckoutsRaw?.abandonedCheckouts || [],
    [abandonedCheckoutsRaw]
  );

  const completedCheckouts = stats.completedCheckouts || 0;
  const abandonedCount     = stats.abandonedCheckouts || 0;
  const totalCheckouts     = completedCheckouts + abandonedCount;
  const conversionRate     = totalCheckouts > 0 ? (completedCheckouts / totalCheckouts) * 100 : 0;

  const recoverableRevenue = stats.recoverableRevenue || 0;
  const recoverableCount   = stats.recoverableCount   || 0;

  const totalFailedRecoveries  = stats.totalFailedRecoveries  ?? (stats.reAbandonedCount || 0);
  const totalFailedRevenueLost = stats.totalFailedRevenueLost ?? (stats.failedRecoveryRevenue || 0);
  const expiredRecoveryCount   = stats.expiredRecoveryCount   ?? 0;
  const reAbandonedCount       = stats.reAbandonedCount       ?? 0;
  const avgAbandonedCartValue  = stats.avgAbandonedCheckoutValue || 0;

  /**
   * Active campaigns — sourced from the recovery email send-list.
   * ACTIVE_RECOVERY_OUTCOMES covers:
   *   sent      → at least one email sent, user hasn't clicked
   *   clicked   → user clicked a valid token, hasn't converted yet
   *   exhausted → all emails sent, tokens still live, awaiting click
   *
   * Each item in sendList has shape { checkout: {...}, recovery: {...} }
   * which is the correct shape for the campaign cards below.
   */
  const activeCampaigns = useMemo(
    () => sendList.filter((item) => {
      const outcome  = item.recovery?.outcome;
      const attempts = item.recovery?.confirmedAttempts || 0;
      // Must have at least one confirmed send AND be in an active outcome
      return attempts > 0 && ACTIVE_RECOVERY_OUTCOMES.has(outcome);
    }),
    [sendList]
  );

  // MAX_ATTEMPTS from env (Vite) or fallback to 3
  const MAX_ATTEMPTS = parseInt(import.meta.env?.VITE_MAX_RECOVERY_ATTEMPTS) || 3;

  const barChartData = useMemo(
    () => steps.map((s) => ({
      resolvedLabel: s.step,
      shortName:     truncateStepLabel(s.step),
      count:         s.count       || 0,
      dropOff:       s.dropOffRate || 0,
    })),
    [steps]
  );

  const pieData = useMemo(() => [
    { name: 'Completed', value: completedCheckouts, fill: '#059669' },
    { name: 'Abandoned', value: abandonedCount,     fill: '#DC2626' },
  ].filter((d) => d.value > 0), [completedCheckouts, abandonedCount]);

  const reaData    = reAbandonmentAnalytics?.current || {};
  const reaSteps   = useMemo(
    () => sortByFunnelOrder(
      reaData.stepBreakdown || [],
      (s) => {
        const label = s.stepLabel || s.step;
        return DISPLAY_TO_RAW[label] || label;
      }
    ),
    [reaData.stepBreakdown]
  );
  const reaStepMax = reaSteps.length ? Math.max(1, ...reaSteps.map((s) => s.count || 0)) : 1;

  const totalAbandonedValue = abandonedCheckoutsRaw?.summary?.totalValue ?? 0;

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
                    <span className="ck-kpi-sub">{fmt.number(recoverableCount)} carts with live tokens</span>
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
            {VIEWS.map(({ key, label, TabIcon }) => {
              const Icon = TabIcon;
              return (
                <button
                  key={key}
                  className={`ck-tab ${activeView === key ? 'ck-tab--active' : ''}`}
                  onClick={() => setActiveView(key)}
                >
                  <Icon style={{ fontSize: 15 }} />{label}
                </button>
              );
            })}
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
                          <Tooltip {...TT} formatter={(v) => [fmt.number(v), 'Checkouts']} />
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
                      <DonutLegend completed={completedCheckouts} abandoned={abandonedCount} total={totalCheckouts} />
                    </>
                  )}
                </Card>

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
                  sub={`Steps sorted by checkout sequence — rates shown for ${MIN_VOLUME_FOR_RATE}+ sessions only`}
                  icon={TrendingDown}
                  iconColor="#DC2626"
                >
                  {first ? <Spinner h={200} /> : steps.length === 0 ? <Empty label="No step data available" h={200} /> : (
                    <div>
                      {steps.map((step, i) => (
                        <div className="ck-bar-row" key={i}>
                          <span className="ck-bar-label">{step.step}</span>
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
                <Card title="Abandonment Funnel" sub="Users who abandoned at each step vs how many reached that step" icon={ShoppingCartCheckout} iconColor="#059669">
                  {first ? <Spinner h={360} /> : steps.length === 0 ? <Empty h={360} /> : (
                    <div className="ck-funnel">
                      {steps.map((step, i) => {
                        const widthPct = stepsMax > 0 ? (step.count / stepsMax) * 100 : 0;
                        return (
                          <div className="ck-step" key={i}>
                            <div className="ck-step-top">
                              <div className="ck-step-top-left">
                                <span className="ck-step-number">{i + 1}</span>
                                <span className="ck-step-name">{step.step}</span>
                              </div>
                              <div className="ck-step-meta">
                                <span className="ck-step-count">{fmt.number(step.count)} abandoned</span>
                                {step.reachCount != null && (
                                  <span className="ck-step-reach">of {fmt.number(step.reachCount)} reached</span>
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

                <Card title="Step Volume Chart" sub="Customers abandoning at each checkout step (funnel order)" icon={TrendingDown} iconColor="#DC2626">
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
                  sub={`Steps in funnel order — rates shown for ${MIN_VOLUME_FOR_RATE}+ sessions only`}
                  icon={TableChart}
                  iconColor="#1D4ED8"
                >
                  {first ? <Spinner h={200} /> : steps.length === 0 ? <Empty /> : (
                    <div className="ck-tbl-wrap">
                      <table className="ck-tbl">
                        <thead>
                          <tr>
                            <th>#</th><th>Step Name</th><th>Abandoned Here</th>
                            <th>Reached Step</th><th>Drop-Off Rate</th><th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((step, i) => (
                            <tr key={i}>
                              <td className="ck-td-mono">{i + 1}</td>
                              <td className="ck-td-name">{step.step}</td>
                              <td>{fmt.number(step.count)}</td>
                              <td className="ck-td-reach">{step.reachCount != null ? fmt.number(step.reachCount) : '—'}</td>
                              <td><DropOffRateCell count={step.count} dropOffRate={step.dropOffRate} /></td>
                              <td><SeverityCell count={step.count} dropOffRate={step.dropOffRate} /></td>
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

          {/* ══ RECOVERY — ACTIVE CAMPAIGNS ONLY ══ */}
          {activeView === 'recovery' && (
            <div className="ck-panel">
              {/* ── KPI strip ── */}
              <div className="ck-grid-4 ck-grid-4--auto">
                {first ? (
                  Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi ck-kpi--amber">
                      <div className="ck-kpi-label">Total Recoverable</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(recoverableRevenue)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">{fmt.number(recoverableCount)} carts with live tokens</span>
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
                      <div className="ck-kpi-label">Avg Abandoned Cart Value</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(avgAbandonedCartValue)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Per abandoned cart (all)</span></div>
                    </div>
                  </>
                )}
              </div>

              {/* ── Active campaigns ── */}
              <div className="ck-section">
                <span className="ck-section-text">
                  Active Recovery Campaigns
                  {activeCampaigns.length > 0 && (
                    <span className="ck-section-count">{activeCampaigns.length}</span>
                  )}
                </span>
                <span className="ck-section-line" />
              </div>

              {/* Explanation of what "active" means */}
              <p className="ck-section-desc">
                Campaigns where at least one email has been sent and the recovery window is still open —
                includes carts awaiting a first click, carts where the user clicked but hasn't converted,
                and carts where all emails have been sent but tokens haven't expired yet.
              </p>

              <div className="ck-row">
                {/* Show skeletons while the send-list is loading for the first time */}
                {!sendListFetched || sendListLoading ? (
                  <Spinner h={280} />
                ) : activeCampaigns.length === 0 ? (
                  <Empty
                    label="No active campaigns — all recovery emails have either been converted, expired, or reached a terminal state."
                    h={200}
                  />
                ) : (
                  <div className="ck-opp-grid">
                    {activeCampaigns.slice(0, 18).map((item, i) => {
                      // sendList items have shape { checkout, recovery }
                      const c          = item.checkout;
                      const recovery   = item.recovery || {};
                      const user       = c.user || {};
                      const priority   = getPriority(c.priority ?? 0);
                      const cartValue  = c.pricing?.totalPrice || 0;
                      const itemCount  = c.items?.length || 0;
                      const lastStep   = resolveStepLabel(
                        c.abandonment?.firstAbandonedAtStep || c.abandonment?.abandonedAtStep
                      ) || '—';
                      const lastSentAt = recovery.lastSentAt;
                      const nextAt     = recovery.nextAvailableAt;
                      const outcome    = recovery.outcome;

                      return (
                        <div
                          className={`ck-opp-card ck-opp-card--inprogress${outcome === 'exhausted' ? ' ck-opp-card--exhausted' : ''}`}
                          key={i}
                        >
                          <div className="ck-opp-card-top">
                            <span className={`ck-priority ck-priority--${priority.cls}`}>
                              {priority.label} Priority
                            </span>
                            <CampaignStatusBadge
                              outcome={outcome}
                              confirmedAttempts={recovery.confirmedAttempts || 0}
                              maxAttempts={MAX_ATTEMPTS}
                            />
                          </div>

                          <div className="ck-opp-name">
                            {user.firstName
                              ? `${user.firstName} ${user.lastName || ''}`.trim()
                              : (c.email || 'Guest')}
                          </div>
                          <div className="ck-opp-email">{user.email || c.email || '—'}</div>

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
                              <div className="ck-opp-stat-label">Abandoned At</div>
                              <div className="ck-opp-stat-val ck-opp-stat-val--red">{lastStep}</div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Link Clicks</div>
                              <div className="ck-opp-stat-val">{recovery.totalLinkClicks || 0}</div>
                            </div>
                          </div>

                          {lastSentAt && (
                            <div className="ck-opp-meta">
                              Last email: {fmt.date(lastSentAt)}
                              {nextAt && new Date(nextAt) > new Date() && (
                                <span className="ck-opp-next"> · Next avail: {fmt.date(nextAt)}</span>
                              )}
                            </div>
                          )}

                          {/* Show token expiry hint for exhausted campaigns */}
                          {outcome === 'exhausted' && (
                            <div className="ck-opp-exhaust-note">
                              All emails sent — will expire if user doesn't click
                            </div>
                          )}
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
                      <div className="ck-kpi-label">Confirmed Lost Revenue</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(totalFailedRevenueLost)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub" title="Total value of all unconverted abandoned carts">
                          {fmt.number(totalFailedRecoveries)} failed · {fmt.currency(totalAbandonedValue)} total abn.
                        </span>
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
                            const isExpired     =
                              c.recoveryOutcome === 'expired' ||
                              (!isReAbandoned && !c.abandonment?.recoveryLinkClickedAt &&
                               !!c.abandonment?.lastRecoveryTokenExpiredAt);
                            return (
                              <tr key={i}>
                                <td className="ck-td-rank">{i + 1}</td>
                                <td className="ck-td-name">{user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Guest'}</td>
                                <td className="ck-td-email">{user.email || '—'}</td>
                                <td className="ck-td-money">{fmt.currency(c.pricing?.totalPrice || 0)}</td>
                                <td>{fmt.number(c.items?.length || 0)}</td>
                                <td className="ck-td-step">{resolveStepLabel(firstStep) || '—'}</td>
                                <td><span className={`ck-priority ck-priority--${priority.cls}`}>{priority.label}</span></td>
                                <td>
                                  <AbandonmentFlags
                                    isReAbandoned={isReAbandoned}
                                    isOrganic={isOrganic}
                                    isExpired={isExpired}
                                  />
                                </td>
                                <td className="ck-td-date">{fmt.date(c.abandonment?.abandonedAt || c.updatedAt || c.createdAt)}</td>
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
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Re-abn + Expired</span></div>
                    </div>

                    <div className="ck-kpi ck-kpi--orange">
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><Loop style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">↩ Re-abandoned</div>
                      <div className="ck-kpi-value">{fmt.number(reAbandonedCount)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Clicked link, left again</span></div>
                    </div>

                    <div className="ck-kpi ck-kpi--gray">
                      <div className="ck-kpi-top"><span className="ck-kpi-icon ck-kpi-icon--emoji">⌛</span></div>
                      <div className="ck-kpi-label">⌛ Expired (Never Clicked)</div>
                      <div className="ck-kpi-value">{fmt.number(expiredRecoveryCount)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">All tokens elapsed, no response</span></div>
                    </div>

                    <div className="ck-kpi ck-kpi--red">
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span>
                        <TrendBadge value={reAbandonmentAnalytics?.trend?.revenueLostChange ?? null} invert />
                      </div>
                      <div className="ck-kpi-label">Total Revenue Lost</div>
                      <div className="ck-kpi-value ck-kpi-value--currency">{fmt.currency(totalFailedRevenueLost)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Avg {fmt.currency(reaData.avgCartValue || 0)} per cart</span></div>
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
                <Card title="Where Users Leave After Clicking Link" sub="Step at which the second abandonment occurred (funnel order)" icon={Loop} iconColor="#7C3AED">
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
                            <th>Step</th><th>First Abandon</th><th>Post-Recovery</th><th>Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const allRawKeys = [...new Set([
                              ...steps.map((s) => DISPLAY_TO_RAW[s.step] || s.step),
                              ...reaSteps.map((s) => {
                                const label = s.stepLabel || s.step;
                                return DISPLAY_TO_RAW[label] || label;
                              }),
                            ])].sort((a, b) => {
                              const ai = FUNNEL_ORDER.indexOf(a);
                              const bi = FUNNEL_ORDER.indexOf(b);
                              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                            });

                            return allRawKeys.map((rawKey, i) => {
                              const displayLabel = STEP_LABEL_MAP[rawKey] || rawKey;
                              const firstRow = steps.find((s) => s.step === displayLabel);
                              const reaRow   = reaSteps.find(
                                (s) => (s.stepLabel || resolveStepLabel(s.step)) === displayLabel
                              );
                              const delta = (reaRow?.count || 0) - (firstRow?.count || 0);
                              return (
                                <tr key={i}>
                                  <td className="ck-td-name ck-td-name--sm">{displayLabel}</td>
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