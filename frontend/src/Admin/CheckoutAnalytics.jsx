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
} from '../features/analytics/operationsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/CheckoutAnalytics.css';

const PAL = ['#059669','#1D4ED8','#D97706','#DC2626','#7C3AED','#0D9488','#EA580C','#0284C7'];

const fmt = {
  currency: (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:   (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:      (v) => `${(v || 0).toFixed(1)}%`,
  compact:  (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  date: (d) => d ? new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—',
  hours: (h) => h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`,
};

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

function TrendBadge({ value, invert = false }) {
  if (value == null) return <span className="ck-badge ck-badge--flat">—</span>;
  if (value === 0)   return <span className="ck-badge ck-badge--flat"><Remove style={{ fontSize: 10 }} />0%</span>;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="ck-skel" style={{ width: 42, height: 42, borderRadius: 11 }} />
        <div className="ck-skel" style={{ width: 54, height: 22 }} />
      </div>
      <div className="ck-skel" style={{ width: '55%', height: 11, marginBottom: 8 }} />
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
            <span className="ck-card-icon" style={{ background: `${iconColor}18`, color: iconColor }}>
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
  contentStyle: { background: '#FFFFFF', border: '1px solid #DDE3EC', borderRadius: 8, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', color: '#0F1923' },
  labelStyle:   { color: '#0F1923', fontWeight: 700 },
  itemStyle:    { color: '#2D4059' },
};

const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5 + 24;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x} y={y}
      fill="#374151"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    >
      {`${name} ${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

function getPriority(score) {
  if (!score && score !== 0) return { label: '—', cls: 'low' };
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
}

function dropCls(rate) {
  if (!rate)      return 'low';
  if (rate >= 30) return 'high';
  if (rate >= 15) return 'med';
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

const VIEWS = [
  { key: 'abandonment',  label: 'Abandonment',      icon: Warning },
  { key: 'funnel',       label: 'Funnel Steps',      icon: ShoppingCartCheckout },
  { key: 'recovery',     label: 'Recovery',           icon: Bolt },
  { key: 'abandoned',    label: 'Abandoned Carts',    icon: MoneyOff },
  { key: 'reabandoned',  label: 'Failed Recoveries',  icon: Loop },
];

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

  const loadAll = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    return Promise.allSettled([
      dispatch(fetchCheckoutAbandonmentStats(timeframe)),
      dispatch(fetchRecoveryOpportunities(50)),
      dispatch(fetchAbandonedCheckouts({ hours: 720, minValue: 0, limit: 100, page: 1, sortBy: 'priority' })),
      dispatch(fetchReAbandonmentAnalytics(timeframe)),
    ]).finally(() => { loadingRef.current = false; });
  }, [dispatch, timeframe]);

  useEffect(() => {
    setRefreshing(true);
    setHasFetched(false);
    loadAll()?.then(() => { setRefreshing(false); setHasFetched(true); });
  }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setHasFetched(false);
    loadAll()?.then(() => { setRefreshing(false); setHasFetched(true); });
  }, [loadAll]);

  const stats = checkoutAbandonment || {};

  const steps = useMemo(() => stats.stepBreakdown || [], [stats.stepBreakdown]);

  const stepsMax = steps.length
    ? Math.max(1, ...steps.map((s) => s.count || 0))
    : 1;

  const opps           = recoveryOpportunitiesRaw?.opportunities || [];
  const recoverableRev = recoveryOpportunitiesRaw?.summary?.totalPotentialRevenue || 0;
  const abandoned      = abandonedCheckoutsRaw?.abandonedCheckouts || [];
  const first          = !hasFetched;

  const completedCheckouts = stats.completedCheckouts || 0;
  const abandonedCount     = stats.abandonedCheckouts || 0;
  const totalCheckouts     = completedCheckouts + abandonedCount;
  const conversionRate     = totalCheckouts > 0 ? (completedCheckouts / totalCheckouts) * 100 : 0;

  const recoveryRate = useMemo(() => {
    const recovered  = stats.recoveredOrders    || 0;
    const abandoned_ = stats.abandonedCheckouts || 0;
    if (abandoned_ === 0) return 0;
    return Math.round((recovered / abandoned_) * 10000) / 100;
  }, [stats.recoveredOrders, stats.abandonedCheckouts]);

  const barChartData = useMemo(
    () => steps.map((s) => ({
      resolvedLabel: resolveStepLabel(s.step),
      shortName:     truncateStepLabel(resolveStepLabel(s.step)),
      count:         s.count       || 0,
      dropOff:       s.dropOffRate || 0,
    })),
    [steps]
  );

  const reaData    = reAbandonmentAnalytics?.current || {};
  const reaSteps   = reaData.stepBreakdown || [];
  const reaStepMax = reaSteps.length ? Math.max(1, ...reaSteps.map(s => s.count || 0)) : 1;

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
                <div className="ck-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
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

                <div className="ck-kpi" style={{ '--kpi-color': '#059669', '--kpi-bg': 'rgba(5,150,105,0.08)' }}>
                  <div className="ck-kpi-top"><span className="ck-kpi-icon"><CheckCircle style={{ fontSize: 20 }} /></span></div>
                  <div className="ck-kpi-label">Completed Checkouts</div>
                  <div className="ck-kpi-value">{fmt.number(completedCheckouts)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">Conv rate: {fmt.pct(conversionRate)}</span>
                  </div>
                </div>

                <div className="ck-kpi" style={{ '--kpi-color': '#1D4ED8', '--kpi-bg': 'rgba(29,78,216,0.08)' }}>
                  <div className="ck-kpi-top"><span className="ck-kpi-icon"><Bolt style={{ fontSize: 20 }} /></span></div>
                  <div className="ck-kpi-label">Recovery Rate</div>
                  <div className="ck-kpi-value">{fmt.pct(recoveryRate)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">Organic: {fmt.number(stats.organicRecoveryCount || 0)}</span>
                  </div>
                </div>

                <div className="ck-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                  <div className="ck-kpi-top"><span className="ck-kpi-icon"><AttachMoney style={{ fontSize: 20 }} /></span></div>
                  <div className="ck-kpi-label">Recoverable Revenue</div>
                  <div className="ck-kpi-value">{fmt.compact(recoverableRev)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">{opps.length} opportunities</span>
                  </div>
                </div>

                <div className="ck-kpi" style={{ '--kpi-color': '#7C3AED', '--kpi-bg': 'rgba(124,58,237,0.08)' }}>
                  <div className="ck-kpi-top">
                    <span className="ck-kpi-icon"><Loop style={{ fontSize: 20 }} /></span>
                    <TrendBadge value={reAbandonmentAnalytics?.trend?.totalChange ?? null} invert />
                  </div>
                  <div className="ck-kpi-label">Failed Recoveries</div>
                  <div className="ck-kpi-value">{fmt.number(stats.reAbandonedCount || 0)}</div>
                  <div className="ck-kpi-footer">
                    <span className="ck-kpi-sub">{fmt.compact(stats.failedRecoveryRevenue || 0)} lost</span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="ck-tabs">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`ck-tab ${activeView === key ? 'ck-tab--active' : ''}`}
                onClick={() => setActiveView(key)}
              >
                <Icon style={{ fontSize: 15 }} />{label}
              </button>
            ))}
          </div>

          {/* ══ ABANDONMENT OVERVIEW ══ */}
          {activeView === 'abandonment' && (
            <div className="ck-panel">
              <div className="ck-section"><span className="ck-section-text">Abandonment Overview</span><span className="ck-section-line" /></div>
              <div className="ck-grid-2">
                <Card title="Checkout Completion Rate" sub="Abandoned vs completed sessions" icon={ShoppingCartCheckout} iconColor="#059669">
                  {first ? <Spinner h={280} /> : (
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
                            cx="50%" cy="50%"
                            outerRadius={80}
                            labelLine={false}
                            label={renderPieLabel}
                          >
                            <Cell fill="#059669" /><Cell fill="#DC2626" />
                          </Pie>
                          <Tooltip {...TT} formatter={(v) => [fmt.number(v), 'Checkouts']} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="ck-summary-bar" style={{ margin: '0 -22px -20px' }}>
                        <div className="ck-summary-item">
                          <div className="ck-summary-label">Abandoned</div>
                          <div className="ck-summary-val" style={{ color: '#DC2626' }}>{fmt.number(abandonedCount)}</div>
                        </div>
                        <div className="ck-summary-item">
                          <div className="ck-summary-label">Completed</div>
                          <div className="ck-summary-val" style={{ color: '#059669' }}>{fmt.number(completedCheckouts)}</div>
                        </div>
                        <div className="ck-summary-item">
                          <div className="ck-summary-label">Abandon Rate</div>
                          <div className="ck-summary-val">{fmt.pct(stats.abandonmentRate)}</div>
                        </div>
                      </div>
                    </>
                  )}
                </Card>

                <Card title="Recovery Performance" sub="Recovered revenue, organic recoveries and rate" icon={Bolt} iconColor="#1D4ED8">
                  {first ? <Spinner h={280} /> : (
                    <div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Recovery Rate</span><span className="ck-metric-val ck-metric-val--green">{fmt.pct(recoveryRate)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Recovered Revenue</span><span className="ck-metric-val ck-metric-val--green">{fmt.compact(stats.recoveredValue)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Organic Recoveries</span><span className="ck-metric-val ck-metric-val--green">{fmt.number(stats.organicRecoveryCount || 0)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Lost Revenue</span><span className="ck-metric-val ck-metric-val--red">{fmt.compact(stats.lostRevenue)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Recoverable Revenue</span><span className="ck-metric-val ck-metric-val--amber">{fmt.compact(recoverableRev)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Failed Recoveries</span><span className="ck-metric-val" style={{ color: '#7C3AED', fontWeight: 700 }}>{fmt.number(stats.reAbandonedCount || 0)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Revenue Lost to Failed Recovery</span><span className="ck-metric-val ck-metric-val--red">{fmt.compact(stats.failedRecoveryRevenue || 0)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Emails Sent</span><span className="ck-metric-val">{fmt.number(stats.emailsSent)}</span></div>
                      <div className="ck-metric-row"><span className="ck-metric-label">Orders Recovered</span><span className="ck-metric-val ck-metric-val--green">{fmt.number(stats.recoveredOrders)}</span></div>
                    </div>
                  )}
                </Card>
              </div>

              <div className="ck-section"><span className="ck-section-text">Funnel Quick View</span><span className="ck-section-line" /></div>
              <div className="ck-row">
                <Card title="Step Drop-Off Rates" sub="Where customers are abandoning in the checkout funnel (first abandonment step)" icon={TrendingDown} iconColor="#DC2626">
                  {first ? <Spinner h={200} /> : steps.length === 0 ? <Empty label="No step data available" h={200} /> : (
                    <div>
                      {steps.map((step, i) => (
                        <div className="ck-bar-row" key={i}>
                          <span className="ck-bar-label">{resolveStepLabel(step.step)}</span>
                          <div className="ck-bar-track">
                            <div className="ck-bar-fill" style={{ width: `${stepsMax > 0 ? (step.count / stepsMax) * 100 : 0}%`, background: PAL[i % PAL.length] }} />
                          </div>
                          <span className="ck-bar-val">{fmt.number(step.count)}</span>
                          <span className={`ck-step-drop ck-step-drop--${dropCls(step.dropOffRate)}`} style={{ marginLeft: 8, flexShrink: 0 }}>
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

          {/* ══ FUNNEL STEPS ══ */}
          {activeView === 'funnel' && (
            <div className="ck-panel">
              <div className="ck-section"><span className="ck-section-text">Checkout Funnel Analysis</span><span className="ck-section-line" /></div>
              <div className="ck-grid-2">
                <Card title="Abandonment Funnel" sub="Count and drop-off rate per checkout step (first abandonment)" icon={ShoppingCartCheckout} iconColor="#059669">
                  {first ? <Spinner h={360} /> : steps.length === 0 ? <Empty h={360} /> : (
                    <div className="ck-funnel">
                      {steps.map((step, i) => {
                        const widthPct = stepsMax > 0 ? (step.count / stepsMax) * 100 : 0;
                        return (
                          <div className="ck-step" key={i}>
                            <div className="ck-step-top">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span className="ck-step-number">{i + 1}</span>
                                <span className="ck-step-name">{resolveStepLabel(step.step)}</span>
                              </div>
                              <div className="ck-step-meta">
                                <span className="ck-step-count">{fmt.number(step.count)}</span>
                                <span className={`ck-step-drop ck-step-drop--${dropCls(step.dropOffRate)}`}>
                                  -{fmt.pct(step.dropOffRate)} drop
                                </span>
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

                <Card title="Step Volume Chart" sub="Customers reaching each checkout step" icon={TrendingDown} iconColor="#DC2626">
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
                            n === 'count' ? 'Customers' : 'Drop-Off Rate',
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
                <Card title="Step Detail Table" sub="Step name, volume and drop-off rate" icon={TableChart} iconColor="#1D4ED8">
                  {first ? <Spinner h={200} /> : steps.length === 0 ? <Empty /> : (
                    <div className="ck-tbl-wrap">
                      <table className="ck-tbl">
                        <thead>
                          <tr>
                            <th>#</th><th>Step Name</th><th>Customers Reached</th>
                            <th>Drop-Off Rate</th><th>Lost Customers</th><th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((step, i) => {
                            const lost = Math.round(((step.dropOffRate || 0) / 100) * (step.count || 0));
                            const cls  = dropCls(step.dropOffRate);
                            return (
                              <tr key={i}>
                                <td className="ck-td-mono">{i + 1}</td>
                                <td className="ck-td-name">{resolveStepLabel(step.step)}</td>
                                <td>{fmt.number(step.count)}</td>
                                <td>
                                  <span style={{
                                    fontWeight: 700,
                                    color: step.dropOffRate >= 30 ? '#DC2626' : step.dropOffRate >= 15 ? '#D97706' : '#059669',
                                    fontFamily: 'Source Code Pro, monospace',
                                    fontSize: 12.5,
                                  }}>
                                    {fmt.pct(step.dropOffRate)}
                                  </span>
                                </td>
                                <td className="ck-td-red">{fmt.number(lost)}</td>
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

          {/* ══ RECOVERY OPPORTUNITIES ══ */}
          {activeView === 'recovery' && (
            <div className="ck-panel">
              <div className="ck-grid-4" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                {first ? (
                  Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                      <div className="ck-kpi-label">Total Recoverable</div>
                      <div className="ck-kpi-value">{fmt.compact(recoverableRev)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">{opps.length} opportunities</span></div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#059669', '--kpi-bg': 'rgba(5,150,105,0.08)' }}>
                      <div className="ck-kpi-label">Recovered Revenue</div>
                      <div className="ck-kpi-value">{fmt.currency(stats.recoveredValue)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">Organic: {fmt.number(stats.organicRecoveryCount || 0)} · Rate: {fmt.pct(recoveryRate)}</span>
                      </div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
                      <div className="ck-kpi-label">Avg Cart Value</div>
                      <div className="ck-kpi-value">{fmt.compact(recoveryOpportunitiesRaw?.summary?.avgCheckoutValue || 0)}</div>
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                    {opps.slice(0, 12).map((opp, i) => {
                      const user          = opp.user || {};
                      const priorityScore = opp.priority ?? opp.priorityScore ?? 0;
                      const priority      = getPriority(priorityScore);
                      const cartValue     = opp.pricing?.totalPrice || 0;
                      const itemCount     = opp.items?.length || 0;
                      const lastStep      = resolveStepLabel(opp.abandonment?.abandonedAtStep) || '—';
                      return (
                        <div className="ck-opp-card" key={i}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                            <span className={`ck-priority ck-priority--${priority.cls}`}>{priority.label} Priority</span>
                            <span style={{ fontSize: 11, color: '#6B7E99', fontFamily: 'Source Code Pro, monospace' }}>Score: {priorityScore}</span>
                          </div>
                          <div className="ck-opp-name">{user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Guest'}</div>
                          <div className="ck-opp-email">{user.email || '—'}</div>
                          <div className="ck-opp-stats">
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Cart Value</div>
                              <div className="ck-opp-stat-val" style={{ color: '#059669' }}>{fmt.compact(cartValue)}</div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Items</div>
                              <div className="ck-opp-stat-val">{fmt.number(itemCount)}</div>
                            </div>
                            <div className="ck-opp-stat">
                              <div className="ck-opp-stat-label">Last Step</div>
                              <div className="ck-opp-stat-val" style={{ fontSize: 12, color: '#DC2626' }}>{lastStep}</div>
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

              <div className="ck-grid-4" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 16 }}>
                {first ? (
                  Array.from({ length: 3 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">Total Lost Value</div>
                      <div className="ck-kpi-value">{fmt.compact(abandonedCheckoutsRaw?.summary?.totalValue ?? 0)}</div>
                      <div className="ck-kpi-footer">
                        <span className="ck-kpi-sub">{abandonedCheckoutsRaw?.pagination?.totalCheckouts ?? abandoned.length} carts</span>
                      </div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><AttachMoney style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">Avg Cart Value</div>
                      <div className="ck-kpi-value">{fmt.compact(abandonedCheckoutsRaw?.summary?.avgValue ?? 0)}</div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#7C3AED', '--kpi-bg': 'rgba(124,58,237,0.08)' }}>
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
                    <span style={{ fontSize: 12, color: '#6B7E99', fontWeight: 600 }}>
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
                            {/* FIX: removed "Recovery Email" column header — the send button
                                was removed along with admin send functionality. The column
                                had no matching <td> causing a mismatched column count. */}
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
                                <td style={{ fontSize: 12, color: '#6B7E99', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {user.email || '—'}
                                </td>
                                <td className="ck-td-money">{fmt.compact(c.pricing?.totalPrice || 0)}</td>
                                <td>{fmt.number(c.items?.length || 0)}</td>
                                <td style={{ color: '#DC2626', fontWeight: 600, fontSize: 12 }}>
                                  {resolveStepLabel(firstStep) || '—'}
                                </td>
                                <td>
                                  <span className={`ck-priority ck-priority--${priority.cls}`}>{priority.label}</span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {isReAbandoned && (
                                      <span className="ck-flag ck-flag--reabandoned" title="Clicked recovery link but abandoned again">Re-abn</span>
                                    )}
                                    {isOrganic && (
                                      <span className="ck-flag ck-flag--organic" title="Converted without using recovery link">Organic</span>
                                    )}
                                  </div>
                                </td>
                                <td className="ck-td-mono" style={{ fontSize: 11.5 }}>
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

              <div className="ck-grid-4">
                {first ? (
                  Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />)
                ) : (
                  <>
                    <div className="ck-kpi" style={{ '--kpi-color': '#7C3AED', '--kpi-bg': 'rgba(124,58,237,0.08)' }}>
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon"><Loop style={{ fontSize: 20 }} /></span>
                        <TrendBadge value={reAbandonmentAnalytics?.trend?.totalChange ?? null} invert />
                      </div>
                      <div className="ck-kpi-label">Failed Recoveries</div>
                      <div className="ck-kpi-value">{fmt.number(reaData.total || 0)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Clicked link, abandoned again</span></div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#DC2626', '--kpi-bg': 'rgba(220,38,38,0.08)' }}>
                      <div className="ck-kpi-top">
                        <span className="ck-kpi-icon"><MoneyOff style={{ fontSize: 20 }} /></span>
                        <TrendBadge value={reAbandonmentAnalytics?.trend?.revenueLostChange ?? null} invert />
                      </div>
                      <div className="ck-kpi-label">Revenue Lost</div>
                      <div className="ck-kpi-value">{fmt.compact(reaData.totalRevenueLost || 0)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Avg {fmt.compact(reaData.avgCartValue || 0)} per cart</span></div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#D97706', '--kpi-bg': 'rgba(217,119,6,0.08)' }}>
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><PersonSearch style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">Avg Time to Re-abandon</div>
                      <div className="ck-kpi-value">{fmt.hours(reaData.avgHoursToReAbandon)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">After clicking recovery link</span></div>
                    </div>
                    <div className="ck-kpi" style={{ '--kpi-color': '#059669', '--kpi-bg': 'rgba(5,150,105,0.08)' }}>
                      <div className="ck-kpi-top"><span className="ck-kpi-icon"><Bolt style={{ fontSize: 20 }} /></span></div>
                      <div className="ck-kpi-label">With Discount Interaction</div>
                      <div className="ck-kpi-value">{fmt.number(reaData.withDiscountDuringRecovery || 0)}</div>
                      <div className="ck-kpi-footer"><span className="ck-kpi-sub">Applied/changed discount code</span></div>
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
                            <div className="ck-bar-fill" style={{ width: `${reaStepMax > 0 ? (step.count / reaStepMax) * 100 : 0}%`, background: '#7C3AED' }} />
                          </div>
                          <span className="ck-bar-val">{fmt.number(step.count)}</span>
                          <span style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>
                            {fmt.compact(step.totalValue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="First vs Post-Recovery Drop-Off" sub="Comparing where users abandon on first attempt vs after clicking recovery link" icon={TrendingDown} iconColor="#DC2626">
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
                              ...steps.map(s => s.step),
                              ...reaSteps.map(s => s.step),
                            ])];
                            return stepKeys.map((key, i) => {
                              const firstRow = steps.find(s => s.step === key);
                              const reaRow   = reaSteps.find(s => s.step === key);
                              const delta    = (reaRow?.count || 0) - (firstRow?.count || 0);
                              return (
                                <tr key={i}>
                                  <td className="ck-td-name" style={{ fontSize: 12 }}>{resolveStepLabel(key)}</td>
                                  <td>{fmt.number(firstRow?.count || 0)}</td>
                                  <td style={{ color: '#7C3AED', fontWeight: 700 }}>{fmt.number(reaRow?.count || 0)}</td>
                                  <td style={{ color: delta > 0 ? '#DC2626' : delta < 0 ? '#059669' : '#6B7E99', fontWeight: 700, fontSize: 12 }}>
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