import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Assessment,
  ArrowBack,
  Refresh,
  Download,
  TrendingUp,
  TrendingDown,
  AttachMoney,
  ShoppingCart,
  People,
  Inventory2,
  ArrowUpward,
  ArrowDownward,
  Remove,
  BarChart as BarChartIcon,
  PieChart as PieChartIcon,
  TableChart,
  CheckCircleOutline,
  Schedule,
  CurrencyExchange,
  LocalShipping,
  KeyboardArrowRight,
  FileDownload,
} from '@mui/icons-material';
import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  generateBusinessReport,
  generateSalesReport,
  generateCustomerReport,
  generateProductReport,
  generateFinancialReport,
  exportReportCSV,
  clearReport,
} from '../features/analytics/analyticsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/Reports.css';

// ── Palette ──────────────────────────────────────────────────
const PALETTE = ['#6366F1','#10B981','#F59E0B','#EF4444','#06B6D4','#8B5CF6','#F97316','#14B8A6'];

// ── Formatters ───────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:  (v) => new Intl.NumberFormat('en-US').format(v || 0),
  pct:     (v) => `${(v || 0).toFixed(1)}%`,
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  date: (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
};

// ── Trend badge ──────────────────────────────────────────────
function TrendBadge({ value }) {
  if (value === undefined || value === null)
    return <span className="rp-badge rp-badge--flat">—</span>;
  if (value === 0)
    return (
      <span className="rp-badge rp-badge--flat">
        <Remove style={{ fontSize: 10 }} />0%
      </span>
    );
  const pos = value > 0;
  return (
    <span className={`rp-badge ${pos ? 'rp-badge--pos' : 'rp-badge--neg'}`}>
      {pos ? <ArrowUpward style={{ fontSize: 10 }} /> : <ArrowDownward style={{ fontSize: 10 }} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ── Spinner ──────────────────────────────────────────────────
function Spinner({ h = 200 }) {
  return (
    <div className="rp-loading" style={{ minHeight: h }}>
      <div className="rp-spinner" />
      <span>Generating report…</span>
    </div>
  );
}

// ── Empty ────────────────────────────────────────────────────
function Empty({ label = 'No data available', h = 180 }) {
  return (
    <div className="rp-empty" style={{ minHeight: h }}>
      <Assessment style={{ fontSize: 36, color: '#D1D5DB' }} />
      <span>{label}</span>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────
function Card({ title, sub, iconColor, icon: Icon, action, flush, children, footer }) {
  return (
    <div className="rp-card">
      <div className="rp-card-hd">
        <div className="rp-card-hd-left">
          {Icon && (
            <span className="rp-card-icon" style={{ background: iconColor + '18', color: iconColor }}>
              <Icon style={{ fontSize: 18 }} />
            </span>
          )}
          <div>
            <h3 className="rp-card-title">{title}</h3>
            {sub && <p className="rp-card-sub">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={flush ? 'rp-card-body--np' : 'rp-card-body'}>{children}</div>
      {footer && <div className="rp-card-footer">{footer}</div>}
    </div>
  );
}

// ── Recharts tooltip ─────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#fff', border: '1px solid #D1D5DB',
    borderRadius: 8, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  },
};

// ── Report tab config ─────────────────────────────────────────
const REPORT_TABS = [
  { key: 'business',  label: 'Business',  icon: Assessment,    color: '#8B5CF6', desc: 'Comprehensive overview of all business performance metrics' },
  { key: 'sales',     label: 'Sales',     icon: TrendingUp,    color: '#10B981', desc: 'Detailed sales trends, channels, and order analysis' },
  { key: 'customer',  label: 'Customers', icon: People,        color: '#06B6D4', desc: 'Customer segments, CLV, acquisition, and retention' },
  { key: 'product',   label: 'Products',  icon: Inventory2,    color: '#F59E0B', desc: 'Product performance, categories, and inventory health' },
  { key: 'financial', label: 'Financial', icon: AttachMoney,   color: '#EF4444', desc: 'Revenue, profit, refunds, and financial health' },
];

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function Reports() {
  const dispatch = useDispatch();
  const { currentReport, reportType, reportLoading, error, loading } = useSelector(
    (s) => s.analytics
  );

  const [activeTab,  setActiveTab]  = useState('business');
  const [timeframe,  setTimeframe]  = useState('month');
  const [groupBy,    setGroupBy]    = useState('day');
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [exporting,  setExporting]  = useState(false);
  const [generated,  setGenerated]  = useState(false);

  const isGenerating = reportLoading;

  // Clear stale report when tab changes
  useEffect(() => {
    dispatch(clearReport());
    setGenerated(false);
  }, [activeTab, dispatch]);

  // ── Generate ─────────────────────────────────────────────
  const handleGenerate = useCallback(() => {
    const params = { timeframe, startDate: startDate || undefined, endDate: endDate || undefined };
    const salesParams = { ...params, groupBy };

    const thunk = {
      business:  () => dispatch(generateBusinessReport(params)),
      sales:     () => dispatch(generateSalesReport(salesParams)),
      customer:  () => dispatch(generateCustomerReport(false)),
      product:   () => dispatch(generateProductReport(params)),
      financial: () => dispatch(generateFinancialReport(params)),
    }[activeTab];

    if (thunk) thunk().then(() => setGenerated(true));
  }, [activeTab, timeframe, groupBy, startDate, endDate, dispatch]);

  // ── Export CSV ───────────────────────────────────────────
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await dispatch(exportReportCSV({
        reportType: activeTab === 'business' ? 'sales' : activeTab,
        timeframe,
        startDate: startDate || undefined,
        endDate:   endDate   || undefined,
      }));
    } finally {
      setExporting(false);
    }
  }, [activeTab, timeframe, startDate, endDate, dispatch]);

  const tabConfig = REPORT_TABS.find((t) => t.key === activeTab);
  const showReport = generated && currentReport && reportType === activeTab;

  return (
    <>
      <Navbar />
      <div className="rp-page">
        <div className="rp-body">

          {/* ── Back ──────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="rp-back-btn">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          {/* ── Header ────────────────────────────────────── */}
          <div className="rp-hd">
            <div className="rp-hd-left">
              <span className="rp-hd-icon">
                <Assessment style={{ fontSize: 26 }} />
              </span>
              <div>
                <h1 className="rp-hd-title">Reports &amp; Analytics</h1>
                <p className="rp-hd-sub">Generate, explore, and export business reports</p>
              </div>
            </div>

            <div className="rp-hd-right">
              {/* Date range inputs */}
              <div className="rp-daterange">
                <span className="rp-daterange-label">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || undefined}
                />
                <span className="rp-daterange-sep">→</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                />
              </div>

              {/* Timeframe toggle */}
              <div className="rp-tf">
                {['day','week','month','quarter','year'].map((t) => (
                  <button
                    key={t}
                    className={`rp-tf-btn ${timeframe === t ? 'rp-tf-btn--active' : ''}`}
                    onClick={() => { setTimeframe(t); setGenerated(false); }}
                    disabled={isGenerating || !!startDate}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Export */}
              {showReport && (
                <button
                  className="rp-export-btn rp-export-btn--outline"
                  onClick={handleExport}
                  disabled={exporting || loading}
                >
                  <FileDownload style={{ fontSize: 16 }} />
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="rp-error-banner">
              <Assessment style={{ fontSize: 16 }} />
              {error}
            </div>
          )}

          {/* ── Report Type Tabs ───────────────────────────── */}
          <div className="rp-tabs">
            {REPORT_TABS.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  className={`rp-tab ${activeTab === tab.key ? 'rp-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <TabIcon style={{ fontSize: 16 }} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Generation Panel ───────────────────────────── */}
          {!showReport && (
            <div className="rp-card rp-row" style={{ marginBottom: 24 }}>
              <div className="rp-card-body" style={{ padding: '28px 24px' }}>
                {isGenerating && <div className="rp-gen-bar"><div className="rp-gen-bar-fill" /></div>}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <span style={{ width: 48, height: 48, borderRadius: 13, background: tabConfig.color + '15', color: tabConfig.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <tabConfig.icon style={{ fontSize: 24 }} />
                    </span>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 5 }}>
                        {tabConfig.label} Report
                      </div>
                      <div style={{ fontSize: 13, color: '#6B7280', maxWidth: 480 }}>
                        {tabConfig.desc}. Select your timeframe or custom date range above, then generate.
                      </div>
                      {activeTab === 'sales' && !isGenerating && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>Group by:</span>
                          {['day','week','month'].map((g) => (
                            <button
                              key={g}
                              onClick={() => setGroupBy(g)}
                              style={{
                                padding: '3px 10px', border: '1px solid', borderRadius: 6,
                                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                background: groupBy === g ? '#111827' : '#fff',
                                color: groupBy === g ? '#fff' : '#374151',
                                borderColor: groupBy === g ? '#111827' : '#D1D5DB',
                                fontFamily: 'inherit',
                              }}
                            >
                              {g.charAt(0).toUpperCase() + g.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    className="rp-panel-gen-btn"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    style={{ '--rp-purple': tabConfig.color }}
                  >
                    {isGenerating ? (
                      <><div className="rp-spinner" style={{ width: 16, height: 16, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />Generating…</>
                    ) : (
                      <><Assessment style={{ fontSize: 18 }} />Generate Report</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              REPORT PANELS
          ══════════════════════════════════════════════ */}
          {showReport && (
            <div className="rp-report-panel">

              {/* ── Regenerate / export header ─────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                <div className="rp-generated-at">
                  <CheckCircleOutline style={{ fontSize: 14, color: '#10B981' }} />
                  Generated {fmt.date(currentReport.generatedAt)} · {timeframe} view
                  {currentReport.period?.start && (
                    <> · {fmt.date(currentReport.period.start)} → {fmt.date(currentReport.period.end)}</>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="rp-export-btn rp-export-btn--outline" onClick={() => { dispatch(clearReport()); setGenerated(false); }}>
                    <Refresh style={{ fontSize: 15 }} /> New Report
                  </button>
                  <button className="rp-export-btn" onClick={handleExport} disabled={exporting || loading}>
                    <FileDownload style={{ fontSize: 15 }} />
                    {exporting ? 'Exporting…' : 'Export CSV'}
                  </button>
                </div>
              </div>

              {/* ─────────────────────────────────────────────
                  BUSINESS REPORT
              ───────────────────────────────────────────── */}
              {activeTab === 'business' && <BusinessReportView report={currentReport} />}

              {/* ─────────────────────────────────────────────
                  SALES REPORT
              ───────────────────────────────────────────── */}
              {activeTab === 'sales' && <SalesReportView report={currentReport} />}

              {/* ─────────────────────────────────────────────
                  CUSTOMER REPORT
              ───────────────────────────────────────────── */}
              {activeTab === 'customer' && <CustomerReportView report={currentReport} />}

              {/* ─────────────────────────────────────────────
                  PRODUCT REPORT
              ───────────────────────────────────────────── */}
              {activeTab === 'product' && <ProductReportView report={currentReport} />}

              {/* ─────────────────────────────────────────────
                  FINANCIAL REPORT
              ───────────────────────────────────────────── */}
              {activeTab === 'financial' && <FinancialReportView report={currentReport} />}

            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   BUSINESS REPORT VIEW
   report.sections: { executiveSummary, revenueAnalysis, salesAnalysis,
                      customerAnalysis, productAnalysis, operationalMetrics }
════════════════════════════════════════════════════════════ */
function BusinessReportView({ report }) {
  const ex  = report.sections?.executiveSummary    || {};
  const rev = report.sections?.revenueAnalysis     || {};
  const sal = report.sections?.salesAnalysis       || {};
  const cus = report.sections?.customerAnalysis    || {};
  const prod= report.sections?.productAnalysis     || {};
  const ops = report.sections?.operationalMetrics  || {};

  const kpis = [
    { label: 'Total Revenue',    value: fmt.compact(ex.totalRevenue),  icon: AttachMoney, color: '#10B981' },
    { label: 'Net Profit',       value: fmt.compact(ex.totalProfit),   icon: TrendingUp,  color: '#6366F1' },
    { label: 'Total Orders',     value: fmt.number(ex.totalOrders),    icon: ShoppingCart,color: '#3B82F6' },
    { label: 'Unique Customers', value: fmt.number(ex.uniqueCustomers),icon: People,      color: '#8B5CF6' },
    { label: 'Avg Order Value',  value: fmt.currency(ex.avgOrderValue),icon: AttachMoney, color: '#F59E0B' },
  ];

  // Build status pie data from sal.byStatus
  const statusData = (sal.byStatus || []).map((s, i) => ({
    name: s._id || 'Unknown',
    value: s.count || 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  // Payment breakdown
  const paymentData = (sal.byPaymentMethod || []).map((p, i) => ({
    name: p._id || 'Unknown',
    count: p.count || 0,
    revenue: p.revenue || 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  return (
    <>
      {/* KPI row */}
      <div className="rp-grid-4" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {kpis.map((k) => (
          <div key={k.label} className="rp-kpi" style={{ '--kpi-accent': k.color }}>
            <div className="rp-kpi-top">
              <span className="rp-kpi-icon" style={{ background: k.color + '18', color: k.color }}>
                <k.icon style={{ fontSize: 20 }} />
              </span>
            </div>
            <div className="rp-kpi-label">{k.label}</div>
            <div className="rp-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Revenue analysis */}
      <div className="rp-section"><span className="rp-section-text">Revenue Breakdown</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Revenue Components" sub="Breakdown of gross revenue" icon={AttachMoney} iconColor="#10B981">
          <div className="rp-fin-block">
            <div className="rp-fin-row">
              <span className="rp-fin-row-label">Product Revenue</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.productRevenue)}</span>
            </div>
            <div className="rp-fin-row">
              <span className="rp-fin-row-label">Shipping Revenue</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.shippingRevenue)}</span>
            </div>
            <div className="rp-fin-row">
              <span className="rp-fin-row-label">Tax Collected</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.taxRevenue)}</span>
            </div>
            <div className="rp-fin-row rp-fin-row--total">
              <span className="rp-fin-row-label">Total Revenue</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.totalRevenue)}</span>
            </div>
          </div>
        </Card>

        <Card title="Payment Methods" sub="Orders and revenue by payment type" icon={CurrencyExchange} iconColor="#6366F1">
          {paymentData.length === 0 ? <Empty h={160} /> : (
            <div>
              {paymentData.map((p, i) => (
                <div key={i} className="rp-bar-row">
                  <span className="rp-bar-label">{p.name}</span>
                  <div className="rp-bar-track">
                    <div className="rp-bar-fill" style={{ width: `${(p.count / (Math.max(...paymentData.map(x=>x.count)) || 1)) * 100}%`, background: p.fill }} />
                  </div>
                  <span className="rp-bar-val">{fmt.number(p.count)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Order status + customer */}
      <div className="rp-section"><span className="rp-section-text">Orders &amp; Customers</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Order Status Distribution" sub="All orders in the period" icon={ShoppingCart} iconColor="#F97316">
          {statusData.length === 0 ? <Empty h={200} /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>
                  {statusData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmt.number(v), 'Orders']} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Customer Metrics" sub="New vs returning in the period" icon={People} iconColor="#06B6D4">
          <div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">New Customers</span>
              <span className="rp-metric-val">{fmt.number(cus.newCustomers)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Returning Customers</span>
              <span className="rp-metric-val">{fmt.number(cus.returningCustomers)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Unique Buyers</span>
              <span className="rp-metric-val">{fmt.number(ex.uniqueCustomers)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Top products */}
      <div className="rp-section"><span className="rp-section-text">Top Products</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Best Selling Products" sub="By revenue in the period" icon={Inventory2} iconColor="#F59E0B">
          {!prod.topProducts || prod.topProducts.length === 0 ? <Empty /> : (
            <div className="rp-tbl-wrap">
              <table className="rp-tbl">
                <thead>
                  <tr><th>#</th><th>Product</th><th>Units</th><th>Revenue</th><th>Avg Price</th></tr>
                </thead>
                <tbody>
                  {prod.topProducts.slice(0,10).map((p, i) => (
                    <tr key={i}>
                      <td className="rp-td-rank">{i+1}</td>
                      <td className="rp-td-name">{p.productName}</td>
                      <td>{fmt.number(p.unitsSold)}</td>
                      <td className="rp-td-money">{fmt.compact(p.revenue)}</td>
                      <td className="rp-td-mono">{fmt.currency(p.avgPricePerUnit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Operations */}
      <div className="rp-section"><span className="rp-section-text">Operational Snapshot</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Fulfillment" sub="Delivery performance" icon={LocalShipping} iconColor="#64748B">
          <div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Avg Fulfillment Days</span>
              <span className="rp-metric-val">{ops.avgFulfillmentDays?.toFixed(1) || '—'} days</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Total Returns</span>
              <span className="rp-metric-val">{fmt.number(ops.totalReturns)}</span>
            </div>
          </div>
        </Card>
        <Card title="Report Period" sub="Date range covered" icon={Schedule} iconColor="#8B5CF6">
          <div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">From</span>
              <span className="rp-metric-val">{fmt.date(report.period?.start)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">To</span>
              <span className="rp-metric-val">{fmt.date(report.period?.end)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Timeframe Label</span>
              <span className="rp-metric-val" style={{ textTransform: 'capitalize' }}>{report.period?.label || '—'}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Generated At</span>
              <span className="rp-metric-val">{fmt.date(report.generatedAt)}</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   SALES REPORT VIEW
   report: { summary, salesData[], paymentMethodBreakdown[], statusBreakdown[] }
════════════════════════════════════════════════════════════ */
function SalesReportView({ report }) {
  const summary   = report.summary         || {};
  const salesData = report.salesData       || [];
  const payments  = report.paymentMethodBreakdown || [];
  const statuses  = report.statusBreakdown  || [];

  const maxRev = salesData.length ? Math.max(...salesData.map(d => d.revenue)) : 1;

  return (
    <>
      {/* KPI row */}
      <div className="rp-grid-4">
        {[
          { label: 'Total Revenue',       value: fmt.compact(summary.totalRevenue),       color: '#10B981' },
          { label: 'Total Orders',        value: fmt.number(summary.totalOrders),         color: '#3B82F6' },
          { label: 'Avg Order Value',     value: fmt.currency(summary.avgOrderValue),     color: '#F59E0B' },
          { label: 'Unique Customers',    value: fmt.number(summary.totalUniqueCustomers), color: '#8B5CF6' },
        ].map((k) => (
          <div key={k.label} className="rp-kpi" style={{ '--kpi-accent': k.color }}>
            <div className="rp-kpi-label">{k.label}</div>
            <div className="rp-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Revenue trend chart */}
      <div className="rp-section"><span className="rp-section-text">Revenue Trend</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Daily Revenue" sub={`${report.period?.groupBy || 'day'} view — orders and revenue over time`} icon={TrendingUp} iconColor="#10B981">
          {salesData.length === 0 ? <Empty h={280} /> : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={salesData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSalesRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10B981" stopOpacity={0.13} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSalesOrd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.13} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v, name) => [
                      name === 'revenue' ? fmt.currency(v) : fmt.number(v),
                      name === 'revenue' ? 'Revenue' : name === 'orders' ? 'Orders' : 'Customers',
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Area yAxisId="left"  type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#gSalesRev)" dot={false} />
                  <Area yAxisId="right" type="monotone" dataKey="orders"  stroke="#6366F1" strokeWidth={2} fill="url(#gSalesOrd)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="rp-summary-bar" style={{ margin: '0 -20px -18px' }}>
                <div className="rp-summary-item">
                  <div className="rp-summary-label">Peak Revenue</div>
                  <div className="rp-summary-val">{fmt.compact(maxRev)}</div>
                </div>
                <div className="rp-summary-item">
                  <div className="rp-summary-label">Data Points</div>
                  <div className="rp-summary-val">{fmt.number(salesData.length)}</div>
                </div>
                <div className="rp-summary-item">
                  <div className="rp-summary-label">Avg Daily Rev</div>
                  <div className="rp-summary-val">{fmt.compact(summary.totalRevenue / (salesData.length || 1))}</div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Payment + status */}
      <div className="rp-section"><span className="rp-section-text">Breakdown</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Payment Method Breakdown" sub="By order count and revenue" icon={CurrencyExchange} iconColor="#6366F1">
          {payments.length === 0 ? <Empty h={200} /> : (
            <div className="rp-tbl-wrap">
              <table className="rp-tbl">
                <thead><tr><th>Method</th><th>Orders</th><th>Revenue</th></tr></thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <span className="rp-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="rp-method-chip">{p.method || p._id || '—'}</span>
                      </td>
                      <td>{fmt.number(p.count)}</td>
                      <td className="rp-td-money">{fmt.compact(p.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Order Status Breakdown" sub="Count by fulfillment status" icon={ShoppingCart} iconColor="#F97316">
          {statuses.length === 0 ? <Empty h={200} /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={statuses.map(s => ({ name: s._id, count: s.count, value: s.totalValue }))} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={90} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmt.number(v), 'Orders']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {statuses.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Data table */}
      <div className="rp-section"><span className="rp-section-text">Daily Data</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Sales Data Table" sub="Detailed breakdown per period" icon={TableChart} iconColor="#374151"
          action={<span className="rp-generated-at"><CheckCircleOutline style={{ fontSize: 13, color: '#10B981' }} />{salesData.length} rows</span>}
        >
          {salesData.length === 0 ? <Empty /> : (
            <div className="rp-tbl-wrap">
              <table className="rp-tbl">
                <thead><tr><th>Date</th><th>Revenue</th><th>Orders</th><th>Avg Order</th><th>Customers</th><th>Items</th></tr></thead>
                <tbody>
                  {salesData.map((d, i) => (
                    <tr key={i}>
                      <td className="rp-td-mono">{d.date}</td>
                      <td className="rp-td-money">{fmt.compact(d.revenue)}</td>
                      <td>{fmt.number(d.orders)}</td>
                      <td className="rp-td-mono">{fmt.currency(d.avgOrderValue)}</td>
                      <td>{fmt.number(d.uniqueCustomers)}</td>
                      <td>{fmt.number(d.totalItems)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   CUSTOMER REPORT VIEW
   report: { summary, segmentDistribution[], valueTierDistribution[],
             churnRiskDistribution[], acquisitionSources[] }
════════════════════════════════════════════════════════════ */
function CustomerReportView({ report }) {
  const summary    = report.summary                || {};
  const segments   = report.segmentDistribution   || [];
  const tiers      = report.valueTierDistribution || [];
  const churnRisk  = report.churnRiskDistribution || [];
  const sources    = report.acquisitionSources    || [];

  const totalCust  = summary.totalCustomers || 1;
  const segMax     = segments.length ? Math.max(...segments.map(s => s.totalRevenue)) : 1;

  return (
    <>
      {/* KPI row */}
      <div className="rp-grid-4">
        {[
          { label: 'Total Customers',   value: fmt.number(summary.totalCustomers),   color: '#06B6D4' },
          { label: 'Avg CLV',           value: fmt.currency(summary.avgCLV),          color: '#8B5CF6' },
          { label: 'Avg Order Value',   value: fmt.currency(summary.avgAOV),          color: '#F59E0B' },
          { label: 'VIP Customers',     value: fmt.number(summary.vipCount),          color: '#10B981' },
        ].map((k) => (
          <div key={k.label} className="rp-kpi" style={{ '--kpi-accent': k.color }}>
            <div className="rp-kpi-label">{k.label}</div>
            <div className="rp-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Segment + tiers */}
      <div className="rp-section"><span className="rp-section-text">Segments &amp; Value Tiers</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="RFM Segment Distribution" sub="By customer segment and revenue" icon={People} iconColor="#06B6D4">
          {segments.length === 0 ? <Empty h={220} /> : (
            <div>
              {segments.map((seg, i) => {
                const pct = segMax > 0 ? (seg.totalRevenue / segMax) * 100 : 0;
                return (
                  <div className="rp-seg-row" key={i}>
                    <span className="rp-seg-name" title={seg._id}>{seg._id || 'Unknown'}</span>
                    <div className="rp-seg-track">
                      <div className="rp-seg-fill" style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }} />
                    </div>
                    <span className="rp-seg-count">{fmt.number(seg.count)}</span>
                    <span className="rp-seg-pct">{fmt.compact(seg.totalRevenue)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Value Tier Distribution" sub="Customer breakdown by spend tier" icon={BarChartIcon} iconColor="#8B5CF6">
          {tiers.length === 0 ? <Empty h={220} /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tiers.map(t => ({ name: t._id, count: t.count, revenue: t.totalRevenue }))} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={80} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [fmt.number(v), 'Customers']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {tiers.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Churn + acquisition */}
      <div className="rp-section"><span className="rp-section-text">Churn Risk &amp; Acquisition</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Churn Risk Distribution" sub="Customers by churn risk level" icon={TrendingDown} iconColor="#EF4444">
          {churnRisk.length === 0 ? <Empty h={180} /> : (
            <div>
              {churnRisk.map((r, i) => {
                const color = r._id === 'critical' ? '#EF4444' : r._id === 'high' ? '#F97316' : r._id === 'medium' ? '#F59E0B' : '#10B981';
                return (
                  <div className="rp-metric-row" key={i}>
                    <span className="rp-metric-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                      {r._id ? r._id.charAt(0).toUpperCase() + r._id.slice(1) : 'Unknown'} Risk
                    </span>
                    <span className="rp-metric-val">{fmt.number(r.count)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Acquisition Sources" sub="Revenue and CLV by source channel" icon={TrendingUp} iconColor="#10B981">
          {sources.length === 0 ? <Empty h={180} /> : (
            <div className="rp-tbl-wrap">
              <table className="rp-tbl">
                <thead><tr><th>Source</th><th>Customers</th><th>Revenue</th><th>Avg CLV</th></tr></thead>
                <tbody>
                  {sources.map((s, i) => (
                    <tr key={i}>
                      <td>
                        <span className="rp-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                        {s._id || 'Direct'}
                      </td>
                      <td>{fmt.number(s.customers)}</td>
                      <td className="rp-td-money">{fmt.compact(s.totalRevenue)}</td>
                      <td className="rp-td-mono">{fmt.currency(s.avgCLV)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Overall summary metrics */}
      <div className="rp-section"><span className="rp-section-text">Overall Summary</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Customer Analytics Summary" sub="Aggregate metrics across all customers" icon={Assessment} iconColor="#6366F1">
          <div className="rp-grid-3" style={{ marginBottom: 0 }}>
            {[
              { label: 'Total Customers',  val: fmt.number(summary.totalCustomers) },
              { label: 'Total Revenue',    val: fmt.compact(summary.totalRevenue) },
              { label: 'Average CLV',      val: fmt.currency(summary.avgCLV) },
              { label: 'Avg Orders / Customer', val: (summary.avgOrders || 0).toFixed(1) },
              { label: 'Average AOV',      val: fmt.currency(summary.avgAOV) },
              { label: 'At-Risk Count',    val: fmt.number(summary.atRiskCount) },
            ].map((m) => (
              <div key={m.label} style={{ padding: '12px 0', borderBottom: '1px solid #F9FAFB' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#9CA3AF', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>{m.val}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   PRODUCT REPORT VIEW
   report: { topProducts[], categoryPerformance[], inventoryStatus, summary }
════════════════════════════════════════════════════════════ */
function ProductReportView({ report }) {
  const products  = report.topProducts          || [];
  const cats      = report.categoryPerformance  || [];
  const inv       = report.inventoryStatus      || {};
  const summary   = report.summary              || {};

  const catMax = cats.length ? Math.max(...cats.map(c => c.revenue)) : 1;

  return (
    <>
      {/* KPI row */}
      <div className="rp-grid-4">
        {[
          { label: 'Total Revenue',    value: fmt.compact(summary.totalRevenue),  color: '#F59E0B' },
          { label: 'Total Units Sold', value: fmt.number(summary.totalUnitsSold), color: '#3B82F6' },
          { label: 'Published',        value: fmt.number(inv.publishedProducts),  color: '#10B981' },
          { label: 'Out of Stock',     value: fmt.number(inv.outOfStock),         color: '#EF4444' },
        ].map((k) => (
          <div key={k.label} className="rp-kpi" style={{ '--kpi-accent': k.color }}>
            <div className="rp-kpi-label">{k.label}</div>
            <div className="rp-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Top products table */}
      <div className="rp-section"><span className="rp-section-text">Top 50 Products</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Best Performing Products" sub="Ranked by revenue in the period" icon={Inventory2} iconColor="#F59E0B"
          action={<span className="rp-generated-at"><CheckCircleOutline style={{ fontSize: 13, color: '#10B981' }} />{products.length} products</span>}
        >
          {products.length === 0 ? <Empty /> : (
            <div className="rp-tbl-wrap">
              <table className="rp-tbl">
                <thead><tr><th>#</th><th>Product</th><th>Units Sold</th><th>Revenue</th><th>Avg Price</th><th>Orders</th></tr></thead>
                <tbody>
                  {products.map((p, i) => (
                    <tr key={i}>
                      <td className="rp-td-rank">{i+1}</td>
                      <td className="rp-td-name">{p.productName}</td>
                      <td>{fmt.number(p.unitsSold)}</td>
                      <td className="rp-td-money">{fmt.compact(p.revenue)}</td>
                      <td className="rp-td-mono">{fmt.currency(p.avgPricePerUnit)}</td>
                      <td>{fmt.number(p.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Category charts */}
      <div className="rp-section"><span className="rp-section-text">Category Performance</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Revenue by Category" sub="Horizontal bar chart" icon={BarChartIcon} iconColor="#6366F1">
          {cats.length === 0 ? <Empty h={240} /> : (
            <div>
              {cats.slice(0, 8).map((c, i) => {
                const pct = catMax > 0 ? (c.revenue / catMax) * 100 : 0;
                return (
                  <div className="rp-bar-row" key={i}>
                    <span className="rp-bar-label" title={c.category}>{c.category}</span>
                    <div className="rp-bar-track">
                      <div className="rp-bar-fill" style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }} />
                    </div>
                    <span className="rp-bar-val">{fmt.compact(c.revenue)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Units by Category" sub="Sales volume comparison" icon={BarChartIcon} iconColor="#10B981">
          {cats.length === 0 ? <Empty h={240} /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cats.slice(0, 8)} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: '#374151' }} width={100} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmt.number(v), 'Units']} />
                <Bar dataKey="unitsSold" radius={[0, 4, 4, 0]}>
                  {cats.slice(0, 8).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Inventory snapshot */}
      <div className="rp-section"><span className="rp-section-text">Inventory Snapshot</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Inventory Status" sub="Current state of all products" icon={Inventory2} iconColor="#374151">
          <div className="rp-grid-4" style={{ marginBottom: 0 }}>
            {[
              { label: 'Total Products',    value: fmt.number(inv.totalProducts),    color: '#374151' },
              { label: 'Published',         value: fmt.number(inv.publishedProducts), color: '#10B981' },
              { label: 'Low Stock',         value: fmt.number(inv.lowStock),          color: '#F59E0B' },
              { label: 'Out of Stock',      value: fmt.number(inv.outOfStock),        color: '#EF4444' },
            ].map((s) => (
              <div key={s.label} className="rp-kpi" style={{ '--kpi-accent': s.color }}>
                <div className="rp-kpi-label">{s.label}</div>
                <div className="rp-kpi-value" style={{ fontSize: 22 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   FINANCIAL REPORT VIEW
   report: { revenue: {gross,net,shipping,tax},
             profit: {total,margin}, refunds: {total,count,rate}, orderCount }
════════════════════════════════════════════════════════════ */
function FinancialReportView({ report }) {
  const rev     = report.revenue  || {};
  const profit  = report.profit   || {};
  const refunds = report.refunds  || {};

  return (
    <>
      {/* KPI row */}
      <div className="rp-grid-4">
        {[
          { label: 'Gross Revenue',  value: fmt.compact(rev.gross),    color: '#10B981' },
          { label: 'Net Revenue',    value: fmt.compact(rev.net),      color: '#6366F1' },
          { label: 'Total Profit',   value: fmt.compact(profit.total), color: '#8B5CF6' },
          { label: 'Profit Margin',  value: fmt.pct(profit.margin),   color: '#F59E0B' },
        ].map((k) => (
          <div key={k.label} className="rp-kpi" style={{ '--kpi-accent': k.color }}>
            <div className="rp-kpi-label">{k.label}</div>
            <div className="rp-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Revenue breakdown + refunds */}
      <div className="rp-section"><span className="rp-section-text">Revenue &amp; Refunds</span><span className="rp-section-line" /></div>
      <div className="rp-grid-2">
        <Card title="Revenue Breakdown" sub="Gross to net revenue waterfall" icon={AttachMoney} iconColor="#10B981">
          <div className="rp-fin-block">
            <div className="rp-fin-row">
              <span className="rp-fin-row-label">Gross Revenue</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.gross)}</span>
            </div>
            <div className="rp-fin-row">
              <span className="rp-fin-row-label">Shipping Revenue</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.shipping)}</span>
            </div>
            <div className="rp-fin-row">
              <span className="rp-fin-row-label">Tax Collected</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.tax)}</span>
            </div>
            <div className="rp-fin-row rp-fin-row--red">
              <span className="rp-fin-row-label">Refunds Issued</span>
              <span className="rp-fin-row-val">({fmt.compact(refunds.total)})</span>
            </div>
            <div className="rp-fin-row rp-fin-row--total">
              <span className="rp-fin-row-label">Net Revenue</span>
              <span className="rp-fin-row-val">{fmt.compact(rev.net)}</span>
            </div>
          </div>
        </Card>

        <Card title="Profit &amp; Refund Summary" sub="Profitability and refund rates" icon={TrendingUp} iconColor="#8B5CF6">
          <div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Total Profit</span>
              <span className="rp-metric-val" style={{ color: '#10B981' }}>{fmt.compact(profit.total)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Profit Margin</span>
              <span className="rp-metric-val">{fmt.pct(profit.margin)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Total Refunded</span>
              <span className="rp-metric-val" style={{ color: '#B91C1C' }}>{fmt.compact(refunds.total)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Refund Count</span>
              <span className="rp-metric-val">{fmt.number(refunds.count)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Refund Rate</span>
              <span className="rp-metric-val">{fmt.pct(refunds.rate)}</span>
            </div>
            <div className="rp-metric-row">
              <span className="rp-metric-label">Total Orders</span>
              <span className="rp-metric-val">{fmt.number(report.orderCount)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Visual chart */}
      <div className="rp-section"><span className="rp-section-text">Financial Overview</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Financial Health Chart" sub="Revenue vs profit vs refunds" icon={BarChartIcon} iconColor="#374151">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={[
                { name: 'Gross Revenue', value: rev.gross   || 0, fill: '#10B981' },
                { name: 'Net Revenue',   value: rev.net     || 0, fill: '#6366F1' },
                { name: 'Profit',        value: profit.total|| 0, fill: '#8B5CF6' },
                { name: 'Refunds',       value: refunds.total|| 0, fill: '#EF4444' },
                { name: 'Shipping',      value: rev.shipping|| 0, fill: '#F59E0B' },
                { name: 'Tax',           value: rev.tax     || 0, fill: '#06B6D4' },
              ]}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmt.compact(v), 'Amount']} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {[
                  '#10B981','#6366F1','#8B5CF6','#EF4444','#F59E0B','#06B6D4'
                ].map((color, i) => <Cell key={i} fill={color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Period info */}
      <div className="rp-section"><span className="rp-section-text">Report Details</span><span className="rp-section-line" /></div>
      <div className="rp-row">
        <Card title="Report Information" sub="Metadata for this financial report" icon={Schedule} iconColor="#374151">
          <div className="rp-grid-3" style={{ marginBottom: 0 }}>
            {[
              { label: 'Report Type', val: 'Financial Report' },
              { label: 'Period Start', val: fmt.date(report.period?.start) },
              { label: 'Period End',   val: fmt.date(report.period?.end) },
              { label: 'Total Orders', val: fmt.number(report.orderCount) },
              { label: 'Generated',   val: fmt.date(report.generatedAt) },
              { label: 'Refund Rate', val: fmt.pct(refunds.rate) },
            ].map((m) => (
              <div key={m.label} style={{ padding: '10px 0', borderBottom: '1px solid #F9FAFB' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#9CA3AF', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>{m.val}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}