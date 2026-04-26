import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { Email, ArrowBack, Refresh, Warning } from '@mui/icons-material';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import PageTitle from '../components/PageTitle';
import {
  fetchRecoveryAnalytics,
  setAnalyticsTimeframe,
  selectAnalytics,
  selectAnalyticsLoading,
  selectAnalyticsError,
  selectAnalyticsTimeframe,
} from '../features/admin/recoveryEmailSlice';

// ── CHANGE 1a: Import banner selectors from cronLogSlice ──────────────────────
import {
  fetchCronBanner,
  dismissBanner,
  resetBannerDismiss,
  selectBannerJobByName,
  selectBannerDismissed,
} from '../features/admin/cronLogSlice';

import RetentionBanner from '../components/RetentionBanner';

import '../AdminStyles/RecoveryEmailAnalytics.css';

// ============================================
// HELPERS
// ============================================

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
};

const OUTCOME_CONFIG = {
  converted:    { label: 'Converted',    dotColor: '#16a34a' },
  organic:      { label: 'Organic',      dotColor: '#059669' },
  clicked:      { label: 'Clicked',      dotColor: '#2563eb' },
  sent:         { label: 'Sent',         dotColor: '#3b82f6' },
  re_abandoned: { label: 'Re-abandoned', dotColor: '#d97706' },
  pending:      { label: 'Pending',      dotColor: '#9ca3af' },
  exhausted:    { label: 'Exhausted',    dotColor: '#dc2626' },
  expired:      { label: 'Expired',      dotColor: '#6b7280' },
  failed:       { label: 'Failed',       dotColor: '#b91c1c' },
};

const FUNNEL_COLORS = {
  sent:      '#FF6B6B',
  clicked:   '#2563eb',
  converted: '#16a34a',
};

// ============================================
// SUB-COMPONENTS
// ============================================

function KpiSkel() {
  return (
    <div className="rea-kpi-skel">
      <div className="rea-skel" style={{ width: '55%', height: 11, marginBottom: 12 }} />
      <div className="rea-skel" style={{ width: '42%', height: 26, marginBottom: 8 }} />
      <div className="rea-skel" style={{ width: '65%', height: 11 }} />
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div className="rea-section">
      <span className="rea-section-text">{label}</span>
      <span className="rea-section-line" />
    </div>
  );
}

function ClickFunnel({ clickFunnel }) {
  if (!clickFunnel) return <div className="rea-empty">No funnel data available</div>;

  const { sent, clicked, converted, sentToClickRate, clickToConvertRate } = clickFunnel;
  const max = Math.max(sent, clicked, converted, 1);

  const steps = [
    { label: 'Emails Sent (Campaigns)',  count: sent,      fill: Math.min((sent      / max) * 100, 100), color: FUNNEL_COLORS.sent,      rate: null },
    { label: 'Link Clicked', count: clicked,   fill: Math.min((clicked   / max) * 100, 100), color: FUNNEL_COLORS.clicked,   rate: `${fmt.pct(sentToClickRate)} click rate` },
    { label: 'Converted',    count: converted, fill: Math.min((converted / max) * 100, 100), color: FUNNEL_COLORS.converted, rate: `${fmt.pct(clickToConvertRate)} conversion rate` },
  ];

  return (
    <div className="rea-funnel">
      {steps.map((step, i) => (
        <div key={step.label} className="rea-funnel-step">
          {i > 0 && <div className="rea-funnel-arrow">↓</div>}
          <div className="rea-funnel-hd">
            <span className="rea-funnel-label">{step.label}</span>
            <span className="rea-funnel-count">{fmt.number(step.count)}</span>
          </div>
          <div className="rea-funnel-track">
            <div className="rea-funnel-fill" style={{ width: `${step.fill}%`, background: step.color }} />
          </div>
          {step.rate && <div className="rea-funnel-rate">{step.rate}</div>}
        </div>
      ))}
    </div>
  );
}

function OutcomeBreakdown({ outcomes, total }) {
  if (!outcomes || total === 0) return <div className="rea-empty">No outcome data</div>;

  const rows = Object.entries(outcomes)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  const maxCount = Math.max(...rows.map(([, c]) => c), 1);

  return (
    <div>
      {rows.map(([key, count]) => {
        const cfg = OUTCOME_CONFIG[key] || { label: key, dotColor: '#9ca3af' };
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        return (
          <div key={key} className="rea-outcome-row">
            <div className="rea-outcome-dot" style={{ background: cfg.dotColor }} />
            <span className="rea-outcome-label">{cfg.label}</span>
            <div
              className="rea-outcome-bar"
              style={{ width: `${(count / maxCount) * 80}px`, background: cfg.dotColor, opacity: 0.35 }}
            />
            <span className="rea-outcome-count">{fmt.number(count)}</span>
            <span className="rea-outcome-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function AttemptROITable({ revenueAttribution }) {
  if (!revenueAttribution?.length) {
    return (
      <div className="rea-empty">
        No conversion data yet — revenue attribution will appear once customers convert.
      </div>
    );
  }

  const totalRevenue     = revenueAttribution.reduce((s, r) => s + r.totalRevenue, 0);
  const totalConversions = revenueAttribution.reduce((s, r) => s + r.conversions, 0);

  return (
    <div className="rea-tbl-wrap">
      <table className="rea-tbl">
        <thead>
          <tr>
            <th>Attempt #</th>
            <th>Conversions</th>
            <th>% of Conv.</th>
            <th>Revenue</th>
            <th>Avg Cart</th>
            <th style={{ minWidth: 160 }}>% of Total Revenue</th>
          </tr>
        </thead>
        <tbody>
          {revenueAttribution.map((row) => {
            const convPct = totalConversions > 0 ? (row.conversions / totalConversions) * 100 : 0;
            const revPct  = totalRevenue     > 0 ? (row.totalRevenue / totalRevenue)     * 100 : 0;
            return (
              <tr key={row.attemptNumber}>
                <td className="rea-tbl-mono">#{row.attemptNumber}</td>
                <td className="rea-tbl-bold">{fmt.number(row.conversions)}</td>
                <td className="rea-tbl-muted">{fmt.pct(convPct)}</td>
                <td className="rea-tbl-green rea-tbl-nowrap">{fmt.currency(row.totalRevenue)}</td>
                <td className="rea-tbl-nowrap" style={{ color: '#374151', fontWeight: 600 }}>{fmt.currency(row.avgCartValue)}</td>
                <td>
                  <div className="rea-tbl-rev-row">
                    <div className="rea-tbl-bar-track">
                      <div className="rea-tbl-bar-fill" style={{ width: `${revPct}%` }} />
                    </div>
                    <span className="rea-tbl-rev-pct">{fmt.pct(revPct)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="rea-tbl-foot">
            <td>Total</td>
            <td>{fmt.number(totalConversions)}</td>
            <td />
            <td className="rea-tbl-green rea-tbl-nowrap">{fmt.currency(totalRevenue)}</td>
            <td />
            <td className="rea-tbl-muted">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function RecoveryEmailAnalyticsPage() {
  const dispatch  = useDispatch();
  const analytics = useSelector(selectAnalytics);
  const loading   = useSelector(selectAnalyticsLoading);
  const error     = useSelector(selectAnalyticsError);
  const timeframe = useSelector(selectAnalyticsTimeframe);

  // ── CHANGE 2: Banner selectors ────────────────────────────────────────────
  const retentionJob    = useSelector(selectBannerJobByName('RecoveryEmailRetention'));
  const bannerDismissed = useSelector(selectBannerDismissed);
  const showBanner      = !!retentionJob && !bannerDismissed;

  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback((tf) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    dispatch(fetchRecoveryAnalytics(tf || timeframe)).finally(() => {
      loadingRef.current = false;
      setIsFirstLoad(false);
      setRefreshing(false);
    });
  }, [dispatch, timeframe]);

  // ── CHANGE 3a: Existing mount effect (unchanged) ──────────────────────────
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── CHANGE 3b: Banner fetch on mount ─────────────────────────────────────
  useEffect(() => {
    dispatch(fetchCronBanner());
  }, [dispatch]);

  // ── CHANGE 4: Timeframe handler with banner reset ─────────────────────────
  const handleTimeframe = (tf) => {
    dispatch(setAnalyticsTimeframe(tf));
    load(tf);
  };

  const handleRefresh = () => {
    load();
    dispatch(resetBannerDismiss());
    dispatch(fetchCronBanner(true));
  };

  const outcomes = analytics?.outcomes || {};
  const total    = analytics?.totalCampaigns || 0;

  const kpis = useMemo(() => [
    {
      label: 'Total Campaigns',
      value: fmt.number(analytics?.totalCampaigns),
      sub:   `${fmt.number(analytics?.totalSendAttempts || 0)} send attempts`,
      color: 'coral',
    },
    {
      label: 'Link Click Rate',
      value: fmt.pct(analytics?.linkClickRate),
      sub:   `${fmt.number(analytics?.totalLinkClicks || 0)} total clicks`,
      color: 'blue',
    },
    {
      label: 'Conversion Rate',
      value: fmt.pct(analytics?.conversionRate),
      sub:   `${fmt.number((outcomes.converted || 0) + (outcomes.organic || 0))} orders recovered`,
      color: 'green',
    },
    {
      label: 'Avg Attempts',
      value: analytics?.avgAttemptsPerCheckout?.toFixed(1) || '—',
      sub:   'per checkout',
      color: 'amber',
    },
    {
      label: 'Re-abandoned',
      value: fmt.number(outcomes.re_abandoned || 0),
      sub:   'clicked link · left again',
      color: 'purple',
    },
    {
      label: 'Exhausted',
      value: fmt.number(outcomes.exhausted || 0),
      sub:   'all emails sent · awaiting token expiry',
      color: 'red',
    },
    {
      label: 'Expired',
      value: fmt.number(outcomes.expired || 0),
      sub:   'all tokens dead · never clicked',
      color: 'amber',
    },
    {
      label: 'Late Clicks',
      value: fmt.number(analytics?.lateClicks || 0),
      sub:   'clicked · token already expired',
      color: 'amber',
    },
  ], [analytics, outcomes]);

  return (
    <>
      <PageTitle title="Recovery Email Analytics — Admin" />
      <Navbar />

      <div className="rea-page">
        <div className="rea-body">

          <Link to="/admin/dashboard" className="rea-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          {/* Page header */}
          <div className="rea-hd">
            <div className="rea-hd-left">
              <div className="rea-hd-icon"><Email style={{ fontSize: 24 }} /></div>
              <div>
                <div className="rea-hd-eyebrow">Recovery Emails</div>
                <h1 className="rea-hd-title">Email Campaign Analytics</h1>
                <p className="rea-hd-sub">Click rates · Conversion funnel · Revenue attribution by attempt</p>
              </div>
            </div>
            <div className="rea-hd-right">
              <div className="rea-tf">
                {['day', 'week', 'month', 'quarter', 'year'].map((tf) => (
                  <button
                    key={tf}
                    className={`rea-tf-btn ${timeframe === tf ? 'rea-tf-btn--active' : ''}`}
                    onClick={() => handleTimeframe(tf)}
                    disabled={refreshing}
                  >
                    {tf.charAt(0).toUpperCase() + tf.slice(1)}
                  </button>
                ))}
              </div>
              {/* ── CHANGE 4: Refresh button now also resets + refetches banner ── */}
              <button
                className={`rea-icon-btn ${refreshing ? 'rea-icon-btn--spin' : ''}`}
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {/* ── CHANGE 5: Retention banner — shown after header, before error ── */}
          {showBanner && (
            <RetentionBanner
              job={retentionJob}
              label="Recovery Email Retention"
              onDismiss={() => dispatch(dismissBanner())}
            />
          )}

          {error && !loading && (
            <div className="rea-error">
              <Warning style={{ fontSize: 16 }} /> {error}
            </div>
          )}

          {/* KPI Grid */}
          <div className="rea-kpi-grid">
            {isFirstLoad
              ? Array.from({ length: 8 }).map((_, i) => <KpiSkel key={i} />)
              : kpis.map((k) => (
                <div key={k.label} className={`rea-kpi rea-kpi--${k.color}`}>
                  <div className="rea-kpi-label">{k.label}</div>
                  <div className="rea-kpi-value">{k.value}</div>
                  <div className="rea-kpi-sub">{k.sub}</div>
                </div>
              ))
            }
          </div>

          {/* Funnel & Outcomes */}
          <SectionDivider label="Send funnel &amp; Outcome breakdown" />
          <div className="rea-grid-2">
            <div className="rea-card">
              <div className="rea-card-hd">
                <div>
                  <div className="rea-card-title">Click Funnel</div>
                  <div className="rea-card-sub">Sent → clicked → converted drop-off rates</div>
                </div>
              </div>
              <div className="rea-card-body">
                {isFirstLoad
                  ? <div className="rea-loading"><span className="rea-spinner" /> Loading…</div>
                  : <ClickFunnel clickFunnel={analytics?.clickFunnel} />
                }
              </div>
            </div>

            <div className="rea-card">
              <div className="rea-card-hd">
                <div>
                  <div className="rea-card-title">Outcome Breakdown</div>
                  <div className="rea-card-sub">Final state of all recovery campaigns</div>
                </div>
              </div>
              <div className="rea-card-body">
                {isFirstLoad
                  ? <div className="rea-loading"><span className="rea-spinner" /> Loading…</div>
                  : <OutcomeBreakdown outcomes={outcomes} total={total} />
                }
              </div>
            </div>
          </div>

          {/* Campaign summary */}
          <SectionDivider label="Campaign summary" />
          <div className="rea-grid-3">

            <div className="rea-card">
              <div className="rea-card-hd">
                <div>
                  <div className="rea-card-title">Send Performance</div>
                  <div className="rea-card-sub">Volume and delivery stats</div>
                </div>
              </div>
              <div className="rea-card-body">
                {isFirstLoad ? <div className="rea-loading"><span className="rea-spinner" /></div> : (
                  <>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Total campaigns</span>
                      <span className="rea-metric-val">{fmt.number(analytics?.totalCampaigns)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Total sends</span>
                      <span className="rea-metric-val">{fmt.number(analytics?.totalSendAttempts)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Avg sends / cart</span>
                      <span className="rea-metric-val">{analytics?.avgAttemptsPerCheckout?.toFixed(1) || '—'}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Total link clicks</span>
                      <span className="rea-metric-blue">{fmt.number(analytics?.totalLinkClicks)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Click rate</span>
                      <span className="rea-metric-blue">{fmt.pct(analytics?.linkClickRate)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Late clicks (after expiry)</span>
                      <span style={{ color: '#d97706', fontWeight: 700 }}>
                        {fmt.number(analytics?.lateClicks || 0)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="rea-card">
              <div className="rea-card-hd">
                <div>
                  <div className="rea-card-title">Conversion Results</div>
                  <div className="rea-card-sub">Recovery success and attribution</div>
                </div>
              </div>
              <div className="rea-card-body">
                {isFirstLoad ? <div className="rea-loading"><span className="rea-spinner" /></div> : (
                  <>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Email-attributed</span>
                      <span className="rea-metric-green">{fmt.number(outcomes.converted || 0)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Organic recovery</span>
                      <span className="rea-metric-green">{fmt.number(outcomes.organic || 0)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Total recovered</span>
                      <span className="rea-metric-green">{fmt.number((outcomes.converted || 0) + (outcomes.organic || 0))}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Conversion rate</span>
                      <span className="rea-metric-green">{fmt.pct(analytics?.conversionRate)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Re-abandoned</span>
                      <span className="rea-metric-red">{fmt.number(outcomes.re_abandoned || 0)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="rea-card">
              <div className="rea-card-hd">
                <div>
                  <div className="rea-card-title">Campaign Status</div>
                  <div className="rea-card-sub">Active and resolved states</div>
                </div>
              </div>
              <div className="rea-card-body">
                {isFirstLoad ? <div className="rea-loading"><span className="rea-spinner" /></div> : (
                  <>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Pending (unsent)</span>
                      <span className="rea-metric-val">{fmt.number(outcomes.pending || 0)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Awaiting click</span>
                      <span className="rea-metric-val">{fmt.number(outcomes.sent || 0)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Clicked (pending conversion)</span>
                      <span className="rea-metric-blue">{fmt.number(outcomes.clicked || 0)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Re-abandoned</span>
                      <span className="rea-metric-red">{fmt.number(outcomes.re_abandoned || 0)}</span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Exhausted (all sent)</span>
                      <span style={{ color: '#dc2626', fontWeight: 700 }}>
                        {fmt.number(outcomes.exhausted || 0)}
                      </span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Expired (no response)</span>
                      <span style={{ color: '#6B7280', fontWeight: 700 }}>
                        {fmt.number(outcomes.expired || 0)}
                      </span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Failed (system error)</span>
                      <span style={{ color: '#6B7280', fontWeight: 700 }}>
                        {fmt.number(outcomes.failed || 0)}
                      </span>
                    </div>
                    <div className="rea-metric-row">
                      <span className="rea-metric-key">Late clicks</span>
                      <span style={{ color: '#d97706', fontWeight: 700 }}>
                        {fmt.number(analytics?.lateClicks || 0)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>

          {/* ROI by attempt */}
          <SectionDivider label="ROI by attempt number — is a second email worth it?" />
          <div className="rea-card">
            <div className="rea-card-hd">
              <div>
                <div className="rea-card-title">Revenue Attribution by Attempt</div>
                <div className="rea-card-sub">
                  Conversions and revenue generated by each send attempt
                </div>
              </div>
            </div>
            <div className="rea-card-body">
              {isFirstLoad
                ? <div className="rea-loading"><span className="rea-spinner" /> Loading…</div>
                : <AttemptROITable revenueAttribution={analytics?.revenueAttribution} />
              }
            </div>
          </div>

        </div>
      </div>

      <Footer />
    </>
  );
}