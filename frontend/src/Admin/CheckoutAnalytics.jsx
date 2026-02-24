import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack,
  Refresh,
  ArrowUpward,
  ArrowDownward,
  Remove,
  ShoppingCartCheckout,
  Warning,
  CheckCircle,
  Email,
  TrendingDown,
  AttachMoney,
  TableChart,
  Bolt,
  MoneyOff,
  MarkEmailRead,
  ErrorOutline,
  TrendingUp,
} from '@mui/icons-material';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchCheckoutAbandonmentStats,
  fetchRecoveryOpportunities,
  fetchAbandonedCheckouts,
  markRecoveryEmailSent,
} from '../features/analytics/analyticsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CheckoutAnalytics.css';

/* ── Palette ─────────────────────────────────────────────────── */
const PAL = [
  '#059669',
  '#1D4ED8',
  '#D97706',
  '#DC2626',
  '#7C3AED',
  '#0D9488',
  '#EA580C',
  '#0284C7',
];

/* ── Formatters ──────────────────────────────────────────────── */
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(v || 0),
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct: (v) => `${(v || 0).toFixed(1)}%`,
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  date: (d) =>
    d
      ? new Date(d).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—',
};

/* ── Helpers ────────────────────────────────────────────────── */
function TrendBadge({ value, invert = false }) {
  if (value == null)
    return <span className="ck-badge ck-badge--flat">—</span>;
  if (value === 0)
    return (
      <span className="ck-badge ck-badge--flat">
        <Remove style={{ fontSize: 10 }} />
        0%
      </span>
    );
  const pos = invert ? value < 0 : value > 0;
  return (
    <span className={`ck-badge ${pos ? 'ck-badge--pos' : 'ck-badge--neg'}`}>
      {value > 0 ? (
        <ArrowUpward style={{ fontSize: 10 }} />
      ) : (
        <ArrowDownward style={{ fontSize: 10 }} />
      )}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Spinner({ h = 200 }) {
  return (
    <div className="ck-loading" style={{ minHeight: h }}>
      <div className="ck-spinner" />
      <span>Loading…</span>
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div
          className="ck-skel"
          style={{ width: 42, height: 42, borderRadius: 11 }}
        />
        <div className="ck-skel" style={{ width: 54, height: 22 }} />
      </div>
      <div
        className="ck-skel"
        style={{ width: '55%', height: 11, marginBottom: 8 }}
      />
      <div className="ck-skel" style={{ width: '75%', height: 28 }} />
    </div>
  );
}

function Card({ title, sub, icon: Icon, iconColor, action, footer, children }) {
  return (
    <div className="ck-card">
      <div className="ck-card-hd">
        <div className="ck-card-hd-left">
          {Icon && (
            <span
              className="ck-card-icon"
              style={{
                background: `${iconColor}18`,
                color: iconColor,
              }}
            >
              <Icon style={{ fontSize: 18 }} />
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
  contentStyle: {
    background: '#FFFFFF',
    border: '1px solid #DDE3EC',
    borderRadius: 8,
    fontSize: 13,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    color: '#0F1923',
  },
  labelStyle: { color: '#0F1923', fontWeight: 700 },
  itemStyle: { color: '#2D4059' },
};

/* ── Priority helper ────────────────────────────────────────── */
function getPriority(score) {
  if (!score && score !== 0) return { label: '—', cls: 'low' };
  if (score >= 70) return { label: 'High', cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return { label: 'Low', cls: 'low' };
}

/* ── Step drop-off colour ───────────────────────────────────── */
function dropCls(rate) {
  if (!rate) return 'low';
  if (rate >= 30) return 'high';
  if (rate >= 15) return 'med';
  return 'low';
}

/* ── Recovery email button ──────────────────────────────────── */
// Read env limits — fall back so UI always renders correctly
// even without VITE_ vars set.
const COOLDOWN_MS  = (parseInt(import.meta.env.VITE_RECOVERY_COOLDOWN_HOURS) || 24) * 3_600_000;
const MAX_ATTEMPTS = parseInt(import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS) || 3;

function RecoveryEmailButton({ checkout, loading, result, sendError, onSend }) {
  const ab        = checkout.abandonment || {};
  const converted = checkout.conversion?.isConverted;

  // Prefer fresh data from a just-completed dispatch,
  // fall back to whatever is already on the model record.
  const count  = result?.attemptNumber  ?? ab.recoveryEmailCount  ?? 0;
  const sentAt = result?.sentAt         ?? ab.recoveryEmailSentAt ?? null;
  const nextAt = result?.nextAvailableAt ?? null;

  // Cooldown boundary — server-provided nextAvailableAt wins,
  // otherwise derive from sentAt so UI is accurate before any send.
  const cooldownUntil =
    nextAt ? new Date(nextAt) :
    sentAt ? new Date(new Date(sentAt).getTime() + COOLDOWN_MS) :
    null;

  const inCooldown = !!(cooldownUntil && cooldownUntil.getTime() > Date.now());
  const maxReached = count >= MAX_ATTEMPTS;

  const cooldownLabel = (() => {
    if (!inCooldown) return null;
    const h = Math.ceil((cooldownUntil.getTime() - Date.now()) / 3_600_000);
    return `${h}h left`;
  })();

  if (converted) {
    return (
      <span className="ck-email-badge ck-email-badge--converted">
        Converted
      </span>
    );
  }

  if (maxReached) {
    return (
      <span className="ck-email-badge ck-email-badge--maxed">
        Max ({MAX_ATTEMPTS}/{MAX_ATTEMPTS})
      </span>
    );
  }

  if (inCooldown) {
    return (
      <span
        className="ck-email-badge ck-email-badge--cooldown"
        title={`Next send available: ${cooldownUntil.toLocaleString()}`}
      >
        {cooldownLabel}
      </span>
    );
  }

  const btnLabel = loading
    ? 'Sending…'
    : count > 0
    ? `Resend (${count}/${MAX_ATTEMPTS})`
    : 'Send Email';

  return (
    <div className="ck-email-cell">
      {sendError && (
        <span className="ck-email-err" title={sendError}>
          Failed
        </span>
      )}
      <button
        className="ck-email-btn"
        onClick={() => onSend(checkout._id)}
        disabled={loading}
        title={
          count > 0
            ? `Send attempt ${count + 1} of ${MAX_ATTEMPTS}`
            : 'Send recovery email'
        }
      >
        {loading
          ? <span className="ck-email-spinner" />
          : <Email style={{ fontSize: 13 }} />}
        {btnLabel}
      </button>
    </div>
  );
}

/* ── View tabs ───────────────────────────────────────────────── */
const VIEWS = [
  { key: 'abandonment', label: 'Abandonment',    icon: Warning },
  { key: 'funnel',      label: 'Funnel Steps',   icon: ShoppingCartCheckout },
  { key: 'recovery',    label: 'Recovery',        icon: Bolt },
  { key: 'abandoned',   label: 'Abandoned Carts', icon: MoneyOff },
];

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function CheckoutAnalytics() {
  const dispatch = useDispatch();

  const {
    checkoutAbandonment,
    recoveryOpportunities: recoveryOpportunitiesRaw,
    abandonedCheckouts:    abandonedCheckoutsRaw,
    emailSendLoading,
    emailSendResults,
    emailSendError,
    loading,
    error,
  } = useSelector((s) => s.analytics);

  const [activeView, setActiveView] = useState('abandonment');
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
      dispatch(fetchCheckoutAbandonmentStats(timeframe)),
      dispatch(fetchRecoveryOpportunities(50)),
      dispatch(
        fetchAbandonedCheckouts({
          hours:   720,
          minValue: 0,
          limit:   100,
          page:    1,
          sortBy:  'priority',
        })
      ),
    ]).finally(() => {
      loadingRef.current = false;
      setRefreshing(false);
      setHasFetched(true);
    });
  }, [dispatch, timeframe]);

  useEffect(() => {
    loadAll();
  }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived data ─────────────────────────────────────────── */
  const stats    = checkoutAbandonment || {};
  const steps    = stats.stepBreakdown || [];
  const stepsMax = steps.length ? Math.max(...steps.map((s) => s.count || 0)) : 1;

  const opps         = recoveryOpportunitiesRaw?.opportunities || [];
  const recoverableRev = recoveryOpportunitiesRaw?.summary?.totalPotentialRevenue || 0;

  const abandoned = abandonedCheckoutsRaw?.abandonedCheckouts || [];
  const first     = !hasFetched && loading;

  /* ── Computed KPIs ────────────────────────────────────────── */
  const completedCheckouts = stats.completedCheckouts || 0;
  const abandonedCount     = stats.abandonedCheckouts || 0;
  const totalCheckouts     = completedCheckouts + abandonedCount;
  const conversionRate     =
    totalCheckouts > 0 ? (completedCheckouts / totalCheckouts) * 100 : 0;

  return (
    <>
      <Navbar />
      <div className="ck-page">
        <div className="ck-body">

          {/* ── Back ──────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="ck-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* ── Header ────────────────────────────────────── */}
          <div className="ck-hd">
            <div className="ck-hd-left">
              <span className="ck-hd-icon">
                <ShoppingCartCheckout style={{ fontSize: 28 }} />
              </span>
              <div>
                <div className="ck-hd-eyebrow">Conversion Intelligence</div>
                <h1 className="ck-hd-title">Checkout Analytics</h1>
                <p className="ck-hd-sub">
                  Abandonment · Funnel · Recovery · Opportunities
                </p>
              </div>
            </div>
            <div className="ck-hd-right">
              <div className="ck-tf">
                {['day', 'week', 'month', 'quarter', 'year'].map((t) => (
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
                onClick={loadAll}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 19 }} />
              </button>
            </div>
          </div>

          {error && (
            <div className="ck-error">
              <ErrorOutline style={{ fontSize: 17 }} />
              {error}
            </div>
          )}

          {/* ── Top KPIs ──────────────────────────────────── */}
          <div className="ck-grid-4">
            {first ? (
              Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />)
            ) : (
              <>
                <div
                  className="ck-kpi"
                  style={{
                    '--kpi-color': '#DC2626',
                    '--kpi-bg': 'rgba(220,38,38,0.08)',
                  }}
                >
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon">
                      <Warning style={{ fontSize: 20 }} />
                    </span>
                    <TrendBadge value={stats.trend ?? null} invert />
                  </div>
                  <div className="ck-kpi-label">Abandonment Rate</div>
                  <div className="ck-kpi-value">
                    {fmt.pct(stats.abandonmentRate)}
                  </div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">
                      {fmt.number(abandonedCount)} abandoned checkouts
                    </span>
                  </div>
                </div>

                <div
                  className="ck-kpi"
                  style={{
                    '--kpi-color': '#059669',
                    '--kpi-bg': 'rgba(5,150,105,0.08)',
                  }}
                >
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon">
                      <CheckCircle style={{ fontSize: 20 }} />
                    </span>
                  </div>
                  <div className="ck-kpi-label">Completed Checkouts</div>
                  <div className="ck-kpi-value">
                    {fmt.number(completedCheckouts)}
                  </div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">
                      Conv rate: {fmt.pct(conversionRate)}
                    </span>
                  </div>
                </div>

                <div
                  className="ck-kpi"
                  style={{
                    '--kpi-color': '#1D4ED8',
                    '--kpi-bg': 'rgba(29,78,216,0.08)',
                  }}
                >
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon">
                      <Bolt style={{ fontSize: 20 }} />
                    </span>
                  </div>
                  <div className="ck-kpi-label">Recovery Rate</div>
                  <div className="ck-kpi-value">
                    {fmt.pct(stats.recoveryRate)}
                  </div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">
                      Recovered: {fmt.compact(stats.recoveredValue)}
                    </span>
                  </div>
                </div>

                <div
                  className="ck-kpi"
                  style={{
                    '--kpi-color': '#D97706',
                    '--kpi-bg': 'rgba(217,119,6,0.08)',
                  }}
                >
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon">
                      <AttachMoney style={{ fontSize: 20 }} />
                    </span>
                  </div>
                  <div className="ck-kpi-label">Recoverable Revenue</div>
                  <div className="ck-kpi-value">{fmt.compact(recoverableRev)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">
                      {opps.length} opportunities
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── View tabs ─────────────────────────────────── */}
          <div className="ck-tabs">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`ck-tab ${activeView === key ? 'ck-tab--active' : ''}`}
                onClick={() => setActiveView(key)}
              >
                <Icon style={{ fontSize: 15 }} />
                {label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════
              ABANDONMENT OVERVIEW
          ══════════════════════════════════════════════ */}
          {activeView === 'abandonment' && (
            <div className="ck-panel">
              <div className="ck-section">
                <span className="ck-section-text">Abandonment Overview</span>
                <span className="ck-section-line" />
              </div>

              <div className="ck-grid-2">
                <Card
                  title="Checkout Completion Rate"
                  sub="Abandoned vs completed sessions"
                  icon={ShoppingCartCheckout}
                  iconColor="#059669"
                >
                  {first ? (
                    <Spinner h={280} />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Completed', value: completedCheckouts, fill: '#059669' },
                              { name: 'Abandoned',  value: abandonedCount,    fill: '#DC2626' },
                            ].filter((d) => d.value > 0)}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={85}
                            label={({ name, percent }) =>
                              `${name} ${(percent * 100).toFixed(0)}%`
                            }
                            labelLine={{ stroke: '#DDE3EC' }}
                          >
                            <Cell fill="#059669" />
                            <Cell fill="#DC2626" />
                          </Pie>
                          <Tooltip
                            {...TT}
                            formatter={(v) => [fmt.number(v), 'Checkouts']}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div
                        className="ck-summary-bar"
                        style={{ margin: '0 -22px -20px' }}
                      >
                        <div className="ck-summary-item">
                          <div className="ck-summary-label">Total Abandoned</div>
                          <div className="ck-summary-val" style={{ color: '#DC2626' }}>
                            {fmt.number(abandonedCount)}
                          </div>
                        </div>
                        <div className="ck-summary-item">
                          <div className="ck-summary-label">Completed</div>
                          <div className="ck-summary-val" style={{ color: '#059669' }}>
                            {fmt.number(completedCheckouts)}
                          </div>
                        </div>
                        <div className="ck-summary-item">
                          <div className="ck-summary-label">Abandon Rate</div>
                          <div className="ck-summary-val">
                            {fmt.pct(stats.abandonmentRate)}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </Card>

                <Card
                  title="Recovery Performance"
                  sub="Recovered revenue and rate"
                  icon={Bolt}
                  iconColor="#1D4ED8"
                >
                  {first ? (
                    <Spinner h={280} />
                  ) : (
                    <div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recovery Rate</span>
                        <span className="ck-metric-val ck-metric-val--green">{fmt.pct(stats.recoveryRate)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recovered Revenue</span>
                        <span className="ck-metric-val ck-metric-val--green">{fmt.compact(stats.recoveredValue)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Lost Revenue</span>
                        <span className="ck-metric-val ck-metric-val--red">{fmt.compact(stats.lostRevenue)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recoverable Revenue</span>
                        <span className="ck-metric-val ck-metric-val--amber">{fmt.compact(recoverableRev)}</span>
                      </div>
                      <div className="ck-metric-row">
                        <span className="ck-metric-label">Recovery Opportunities</span>
                        <span className="ck-metric-val">{fmt.number(opps.length)}</span>
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

              <div className="ck-section">
                <span className="ck-section-text">Funnel Quick View</span>
                <span className="ck-section-line" />
              </div>
              <div className="ck-row">
                <Card
                  title="Step Drop-Off Rates"
                  sub="Where customers are abandoning in the checkout funnel"
                  icon={TrendingDown}
                  iconColor="#DC2626"
                >
                  {first ? (
                    <Spinner h={200} />
                  ) : steps.length === 0 ? (
                    <Empty label="No step data available" h={200} />
                  ) : (
                    <div>
                      {steps.map((step, i) => (
                        <div className="ck-bar-row" key={i}>
                          <span className="ck-bar-label">
                            {step.step || `Step ${i + 1}`}
                          </span>
                          <div className="ck-bar-track">
                            <div
                              className="ck-bar-fill"
                              style={{
                                width: `${stepsMax > 0 ? (step.count / stepsMax) * 100 : 0}%`,
                                background: PAL[i % PAL.length],
                              }}
                            />
                          </div>
                          <span className="ck-bar-val">
                            {fmt.number(step.count)}
                          </span>
                          <span
                            className={`ck-step-drop ck-step-drop--${dropCls(step.dropOffRate)}`}
                            style={{ marginLeft: 8, flexShrink: 0 }}
                          >
                            -{fmt.pct(step.dropOffRate)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              FUNNEL STEPS
          ══════════════════════════════════════════════ */}
          {activeView === 'funnel' && (
            <div className="ck-panel">
              <div className="ck-section">
                <span className="ck-section-text">Checkout Funnel Analysis</span>
                <span className="ck-section-line" />
              </div>

              <div className="ck-grid-2">
                <Card
                  title="Abandonment Funnel"
                  sub="Count and drop-off rate per checkout step"
                  icon={ShoppingCartCheckout}
                  iconColor="#059669"
                >
                  {first ? (
                    <Spinner h={360} />
                  ) : steps.length === 0 ? (
                    <Empty h={360} />
                  ) : (
                    <div className="ck-funnel">
                      {steps.map((step, i) => {
                        const widthPct =
                          stepsMax > 0 ? (step.count / stepsMax) * 100 : 0;
                        return (
                          <div className="ck-step" key={i}>
                            <div className="ck-step-top">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span className="ck-step-number">{i + 1}</span>
                                <span className="ck-step-name">
                                  {step.step || `Step ${i + 1}`}
                                </span>
                              </div>
                              <div className="ck-step-meta">
                                <span className="ck-step-count">
                                  {fmt.number(step.count)}
                                </span>
                                <span className={`ck-step-drop ck-step-drop--${dropCls(step.dropOffRate)}`}>
                                  -{fmt.pct(step.dropOffRate)} drop
                                </span>
                              </div>
                            </div>
                            <div className="ck-step-track">
                              <div
                                className="ck-step-fill"
                                style={{
                                  width: `${widthPct}%`,
                                  background: PAL[i % PAL.length],
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card
                  title="Step Volume Chart"
                  sub="Customers reaching each checkout step"
                  icon={TrendingDown}
                  iconColor="#DC2626"
                >
                  {first ? (
                    <Spinner h={360} />
                  ) : steps.length === 0 ? (
                    <Empty h={360} />
                  ) : (
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart
                        data={steps.map((s) => ({
                          name:    s.step || `Step ${s.step}`,
                          count:   s.count || 0,
                          dropOff: s.dropOffRate || 0,
                        }))}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF4" />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 10, fill: '#6B7E99' }}
                          interval={0}
                          angle={-15}
                          textAnchor="end"
                          height={50}
                        />
                        <YAxis tick={{ fontSize: 10, fill: '#6B7E99' }} />
                        <Tooltip
                          {...TT}
                          formatter={(v, n) => [
                            n === 'count' ? fmt.number(v) : fmt.pct(v),
                            n === 'count' ? 'Customers' : 'Drop-Off Rate',
                          ]}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {steps.map((_, i) => (
                            <Cell key={i} fill={PAL[i % PAL.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>

              <div className="ck-section">
                <span className="ck-section-text">Drop-Off Analysis</span>
                <span className="ck-section-line" />
              </div>
              <div className="ck-row">
                <Card
                  title="Step Detail Table"
                  sub="Step name, volume and drop-off rate"
                  icon={TableChart}
                  iconColor="#1D4ED8"
                >
                  {first ? (
                    <Spinner h={200} />
                  ) : steps.length === 0 ? (
                    <Empty />
                  ) : (
                    <div className="ck-tbl-wrap">
                      <table className="ck-tbl">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Step Name</th>
                            <th>Customers Reached</th>
                            <th>Drop-Off Rate</th>
                            <th>Lost Customers</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((step, i) => {
                            const lost = Math.round(
                              ((step.dropOffRate || 0) / 100) * (step.count || 0)
                            );
                            const cls = dropCls(step.dropOffRate);
                            return (
                              <tr key={i}>
                                <td className="ck-td-mono">{i + 1}</td>
                                <td className="ck-td-name">
                                  {step.step || `Step ${i + 1}`}
                                </td>
                                <td>{fmt.number(step.count)}</td>
                                <td>
                                  <span style={{
                                    fontWeight: 700,
                                    color:
                                      step.dropOffRate >= 30 ? '#DC2626' :
                                      step.dropOffRate >= 15 ? '#D97706' :
                                      '#059669',
                                    fontFamily: 'Source Code Pro, monospace',
                                    fontSize: 12.5,
                                  }}>
                                    {fmt.pct(step.dropOffRate)}
                                  </span>
                                </td>
                                <td className="ck-td-red">
                                  {fmt.number(lost)}
                                </td>
                                <td>
                                  <span className={`ck-priority ck-priority--${cls === 'high' ? 'high' : cls === 'med' ? 'med' : 'low'}`}>
                                    {cls === 'high' ? 'Critical' : cls === 'med' ? 'Moderate' : 'Low'}
                                  </span>
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

          {/* ══════════════════════════════════════════════
              RECOVERY OPPORTUNITIES
          ══════════════════════════════════════════════ */}
          {activeView === 'recovery' && (
            <div className="ck-panel">
              <div
                className="ck-grid-4"
                style={{ gridTemplateColumns: 'repeat(3,1fr)' }}
              >
                {first ? (
                  Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                      <div className="ck-kpi-label">Total Recoverable</div>
                      <div className="ck-kpi-value">{fmt.compact(recoverableRev)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">{opps.length} opportunities</span>
                      </div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#059669', '--kpi-bg': 'rgba(5,150,105,0.08)' }}>
                      <div className="ck-kpi-label">Recovered Revenue</div>
                      <div className="ck-kpi-value">{fmt.compact(stats.recoveredValue)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Recovery rate: {fmt.pct(stats.recoveryRate)}</span>
                      </div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
                      <div className="ck-kpi-label">Avg Cart Value</div>
                      <div className="ck-kpi-value">
                        {fmt.compact(recoveryOpportunitiesRaw?.summary?.avgCheckoutValue || 0)}
                      </div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Per abandoned cart</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="ck-section">
                <span className="ck-section-text">Recovery Opportunities</span>
                <span className="ck-section-line" />
              </div>
              <div className="ck-row">
                {first ? (
                  <Spinner h={300} />
                ) : opps.length === 0 ? (
                  <Empty label="No recovery opportunities found" h={300} />
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 14,
                  }}>
                    {opps.slice(0, 12).map((opp, i) => {
                      const user          = opp.user || {};
                      const priorityScore = opp.priority ?? opp.priorityScore ?? 0;
                      const priority      = getPriority(priorityScore);
                      const cartValue     = opp.pricing?.totalPrice || 0;
                      const itemCount     = opp.items?.length || 0;
                      const lastStep      = opp.abandonment?.abandonedAtStep || '—';
                      return (
                        <div className="ck-opp-card" key={i}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                            <span className={`ck-priority ck-priority--${priority.cls}`}>
                              {priority.label} Priority
                            </span>
                            <span style={{ fontSize: 11, color: '#6B7E99', fontFamily: 'Source Code Pro, monospace' }}>
                              Score: {priorityScore}
                            </span>
                          </div>
                          <div className="ck-opp-name">
                            {user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Guest'}
                          </div>
                          <div className="ck-opp-email">{user.email || '—'}</div>
                          <div className="ck-opp-stats">
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Cart Value</div>
                              <div className="ck-opp-stat-val" style={{ color: '#059669' }}>
                                {fmt.compact(cartValue)}
                              </div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Items</div>
                              <div className="ck-opp-stat-val">{fmt.number(itemCount)}</div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Last Step</div>
                              <div className="ck-opp-stat-val" style={{ fontSize: 12, color: '#DC2626' }}>
                                {lastStep}
                              </div>
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

          {/* ══════════════════════════════════════════════
              ABANDONED CHECKOUTS LIST
          ══════════════════════════════════════════════ */}
          {activeView === 'abandoned' && (
            <div className="ck-panel">
              <div className="ck-section">
                <span className="ck-section-text">Abandoned Checkout List</span>
                <span className="ck-section-line" />
              </div>

              {!first && abandonedCheckoutsRaw?.summary && (
                <div
                  className="ck-grid-4"
                  style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 16 }}
                >
                  <div className="ck-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
                    <div className="ck-kpi-top">
                      <span className="ck-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span>
                    </div>
                    <div className="ck-kpi-label">Total Lost Value</div>
                    <div className="ck-kpi-value">
                      {fmt.compact(abandonedCheckoutsRaw.summary.totalValue)}
                    </div>
                    <div className="ck-kpi-footer">
                      <span className="ck-kpi-sub">
                        {abandonedCheckoutsRaw.pagination?.totalCheckouts || abandoned.length} carts
                      </span>
                    </div>
                  </div>
                  <div className="ck-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                    <div className="ck-kpi-top">
                      <span className="ck-kpi-icon"><AttachMoney style={{ fontSize: 20 }} /></span>
                    </div>
                    <div className="ck-kpi-label">Avg Cart Value</div>
                    <div className="ck-kpi-value">
                      {fmt.compact(abandonedCheckoutsRaw.summary.avgValue)}
                    </div>
                  </div>
                  <div className="ck-kpi" style={{ '--kpi-color': '#7C3AED', '--kpi-bg': 'rgba(124,58,237,0.08)' }}>
                    <div className="ck-kpi-top">
                      <span className="ck-kpi-icon"><TrendingUp style={{ fontSize: 20 }} /></span>
                    </div>
                    <div className="ck-kpi-label">High Priority</div>
                    <div className="ck-kpi-value">
                      {fmt.number(abandonedCheckoutsRaw.summary.highPriorityCheckouts)}
                    </div>
                    <div className="ck-kpi-footer">
                      <span className="ck-kpi-sub">Score ≥ 70</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="ck-row">
                <Card
                  title="All Abandoned Checkouts"
                  sub="Sorted by priority score — act on high priority first"
                  icon={MoneyOff}
                  iconColor="#DC2626"
                  action={
                    <span style={{ fontSize: 12, color: '#6B7E99', fontWeight: 600 }}>
                      {abandonedCheckoutsRaw?.pagination?.totalCheckouts || abandoned.length}{' '}
                      checkouts
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
                            <th>#</th>
                            <th>Customer</th>
                            <th>Email</th>
                            <th>Cart Value</th>
                            <th>Items</th>
                            <th>Last Step</th>
                            <th>Priority</th>
                            <th>Date</th>
                            <th>Recovery Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {abandoned.slice(0, 50).map((c, i) => {
                            const user          = c.user || {};
                            const priorityScore = c.priority ?? c.priorityScore ?? 0;
                            const priority      = getPriority(priorityScore);
                            const cartValue     = c.pricing?.totalPrice || 0;
                            const itemCount     = c.items?.length || 0;
                            const lastStep      = c.abandonment?.abandonedAtStep || '—';
                            const id            = c._id;
                            return (
                              <tr key={i}>
                                <td className="ck-td-rank">{i + 1}</td>
                                <td className="ck-td-name">
                                  {user.firstName
                                    ? `${user.firstName} ${user.lastName || ''}`.trim()
                                    : 'Guest'}
                                </td>
                                <td style={{ fontSize: 12, color: '#6B7E99', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {user.email || '—'}
                                </td>
                                <td className="ck-td-money">{fmt.compact(cartValue)}</td>
                                <td>{fmt.number(itemCount)}</td>
                                <td style={{ color: '#DC2626', fontWeight: 600, fontSize: 12 }}>
                                  {lastStep}
                                </td>
                                <td>
                                  <span className={`ck-priority ck-priority--${priority.cls}`}>
                                    {priority.label}
                                  </span>
                                </td>
                                <td className="ck-td-mono" style={{ fontSize: 11.5 }}>
                                  {fmt.date(c.abandonment?.abandonedAt || c.updatedAt || c.createdAt)}
                                </td>
                                <td>
                                  <RecoveryEmailButton
                                    checkout={c}
                                    loading={!!emailSendLoading?.[id]}
                                    result={emailSendResults?.[id]}
                                    sendError={emailSendError?.[id]}
                                    onSend={(checkoutId) =>
                                      dispatch(markRecoveryEmailSent(checkoutId))
                                    }
                                  />
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

        </div>
      </div>
    </>
  );
}