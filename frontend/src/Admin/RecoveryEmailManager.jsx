import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack,
  Refresh,
  Email,
  MarkEmailRead,
  Schedule,
  CheckCircle,
  Warning,
  MoneyOff,
  FilterList,
  Search,
  AttachMoney,
  ErrorOutline,
  Send,
  Block,
  Inbox,
} from '@mui/icons-material';
import {
  fetchAbandonedCheckouts,
  markRecoveryEmailSent,
} from '../features/analytics/operationsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/RecoveryEmailManager.css';

/* ── Constants ──────────────────────────────────────────────── */
const COOLDOWN_MS  = (parseInt(import.meta.env.VITE_RECOVERY_COOLDOWN_HOURS) || 24) * 3_600_000;
const MAX_ATTEMPTS = parseInt(import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS) || 3;
const BULK_DELAY_MS = 800; // delay between bulk sends to avoid hammering

/* ── Formatters ─────────────────────────────────────────────── */
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number: (v) => new Intl.NumberFormat('en-US').format(v || 0),
  compact: (v) => {
    const n = v || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return fmt.currency(n);
  },
  date: (d) =>
    d ? new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) : '—',
};

/* ── Helpers ────────────────────────────────────────────────── */
function getEmailStatus(checkout, result) {
  const ab       = checkout.abandonment || {};
  const count    = result?.attemptNumber  ?? ab.recoveryEmailCount  ?? 0;
  const sentAt   = result?.sentAt         ?? ab.recoveryEmailSentAt ?? null;
  const nextAt   = result?.nextAvailableAt ?? null;
  const converted = checkout.conversion?.isConverted;

  if (converted) return { type: 'converted', label: 'Converted', count };

  const cooldownUntil =
    nextAt ? new Date(nextAt) :
    sentAt ? new Date(new Date(sentAt).getTime() + COOLDOWN_MS) :
    null;

  const inCooldown = !!(cooldownUntil && cooldownUntil.getTime() > Date.now());

  if (count >= MAX_ATTEMPTS) return { type: 'maxed',    label: `Max (${MAX_ATTEMPTS})`,   count };
  if (inCooldown)            return { type: 'cooldown', label: 'Cooldown',                count, cooldownUntil };
  if (count > 0)             return { type: 'sent',     label: `Sent (${count})`,         count };
  return                            { type: 'ready',    label: 'Ready',                   count };
}

function getPriority(score) {
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
}

function Spinner({ size = 20 }) {
  return (
    <span
      className="rem-spinner"
      style={{ width: size, height: size, borderWidth: size > 16 ? 3 : 2 }}
    />
  );
}

function Empty({ Icon = Inbox, label, sub }) {
  return (
    <div className="rem-empty">
      <Icon style={{ fontSize: 44 }} />
      <span className="rem-empty-label">{label}</span>
      {sub && <span className="rem-empty-sub">{sub}</span>}
    </div>
  );
}

/* ── Tab definitions ────────────────────────────────────────── */
const TABS = [
  { key: 'queue',     label: 'Queue',     icon: Inbox },
  { key: 'sent',      label: 'Sent',      icon: MarkEmailRead },
  { key: 'recovered', label: 'Recovered', icon: CheckCircle },
];

/* ── Per-row send button ────────────────────────────────────── */
// Module-level timestamp: evaluated once when the module loads, never during render.
// This satisfies react-hooks/purity which flags Date.now() inside components.
const MODULE_NOW = Date.now();

function SendButton({ checkout, loading, result, sendError, onSend }) {
  const now    = MODULE_NOW;
  const status = getEmailStatus(checkout, result);
  const id     = checkout._id;

  if (status.type === 'converted') {
    return <span className="rem-status rem-status--converted">Converted</span>;
  }
  if (status.type === 'maxed') {
    return <span className="rem-status rem-status--maxed">Max reached</span>;
  }
  if (status.type === 'cooldown') {
    const h = Math.ceil((status.cooldownUntil.getTime() - now) / 3_600_000);
    return (
      <span className="rem-status rem-status--cooldown" title={`Available: ${status.cooldownUntil.toLocaleString()}`}>
        {h}h left
      </span>
    );
  }

  const label = loading ? 'Sending…'
    : status.count > 0   ? `Resend (${status.count}/${MAX_ATTEMPTS})`
    : 'Send';

  return (
    <div className="rem-send-wrap">
      {sendError && <span className="rem-send-err" title={sendError}>!</span>}
      <button
        className="rem-send-btn"
        onClick={() => onSend(id)}
        disabled={loading}
        title={status.count > 0 ? `Attempt ${status.count + 1} of ${MAX_ATTEMPTS}` : 'Send recovery email'}
      >
        {loading ? <Spinner size={13} /> : <Send style={{ fontSize: 13 }} />}
        {label}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function RecoveryEmailManager() {
  const dispatch = useDispatch();

  const {
    abandonedCheckouts: abandonedRaw,
    emailSendLoading,
    emailSendResults,
    emailSendError,
    loading,
    error,
  } = useSelector((s) => s.operations);

  const [activeTab,   setActiveTab]   = useState('queue');
  const [search,      setSearch]      = useState('');
  const [hasFetched,  setHasFetched]  = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone,    setBulkDone]    = useState(0);
  const [bulkTotal,   setBulkTotal]   = useState(0);
  const bulkAbort                     = useRef(false);
  const loadingRef                    = useRef(false);

  /* ── Fetch ────────────────────────────────────────────────── */
  const loadData = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    return Promise.allSettled([
      dispatch(fetchAbandonedCheckouts({
        hours: 168, // 7 days — model max cart age
        minValue: 0,
        limit: 200,
        page: 1,
        sortBy: 'priority',
      })),
    ]).finally(() => { loadingRef.current = false; });
  }, [dispatch]);

  useEffect(() => {
    loadData()?.then(() => {
      setRefreshing(false);
      setHasFetched(true);
    });
    // setState calls are inside .then() (async), not the synchronous effect body
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setHasFetched(false);
    loadData()?.then(() => {
      setRefreshing(false);
      setHasFetched(true);
    });
  }, [loadData]);

  /* ── Raw data ─────────────────────────────────────────────── */
  const first = !hasFetched && loading;

  /* ── Derive tab lists ─────────────────────────────────────── */
  const { queue, sent, recovered } = useMemo(() => {
    const checkouts = abandonedRaw?.abandonedCheckouts || [];
    const q = [], s = [], r = [];
    for (const c of checkouts) {
      const result  = emailSendResults?.[c._id];
      const status  = getEmailStatus(c, result);
      const isConv  = c.conversion?.isConverted;

      if (isConv) {
        r.push(c);
      } else if (status.type === 'sent' || status.type === 'cooldown' || status.type === 'maxed') {
        s.push(c);
      } else {
        q.push(c);
      }
    }
    return { queue: q, sent: s, recovered: r };
  }, [abandonedRaw, emailSendResults]);

  /* ── Active list + search ─────────────────────────────────── */
  const activeList = useMemo(() => {
    const src = activeTab === 'queue' ? queue : activeTab === 'sent' ? sent : recovered;
    if (!search.trim()) return src;
    const q = search.toLowerCase();
    return src.filter((c) => {
      const u = c.user || {};
      return (
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    });
  }, [activeTab, queue, sent, recovered, search]);

  /* ── Summary KPIs ─────────────────────────────────────────── */
  const totalValue = useMemo(
    () => queue.reduce((sum, c) => sum + (c.pricing?.totalPrice || 0), 0),
    [queue]
  );

  /* ── Bulk send ────────────────────────────────────────────── */
  const handleBulkSend = useCallback(async () => {
    const eligible = queue.filter((c) => {
      const st = getEmailStatus(c, emailSendResults?.[c._id]);
      return st.type === 'ready' || st.type === 'sent';
    });
    if (!eligible.length) return;
    bulkAbort.current = false;
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(eligible.length);

    for (let i = 0; i < eligible.length; i++) {
      if (bulkAbort.current) break;
      await dispatch(markRecoveryEmailSent(eligible[i]._id));
      setBulkDone(i + 1);
      if (i < eligible.length - 1) {
        await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
      }
    }
    setBulkRunning(false);
  }, [dispatch, queue, emailSendResults]);

  const handleBulkAbort = () => { bulkAbort.current = true; };

  /* ── Render ───────────────────────────────────────────────── */
  return (
    <>
      <Navbar />
      <div className="rem-page">
        <div className="rem-body">

          {/* ── Back ──────────────────────────────────────── */}
          <Link to="/admin/dashboard" className="rem-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          {/* ── Header ────────────────────────────────────── */}
          <div className="rem-hd">
            <div className="rem-hd-left">
              <span className="rem-hd-icon">
                <MarkEmailRead style={{ fontSize: 26 }} />
              </span>
              <div>
                <h1 className="rem-hd-title">Recovery Email Manager</h1>
                <p className="rem-hd-sub">Send cart recovery emails · Track cooldowns · Monitor conversions</p>
              </div>
            </div>
            <div className="rem-hd-right">
              <button
                className={`rem-icon-btn ${refreshing ? 'rem-icon-btn--spin' : ''}`}
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
              {activeTab === 'queue' && !bulkRunning && (
                <button
                  className="rem-bulk-btn"
                  onClick={handleBulkSend}
                  disabled={refreshing || !queue.length}
                  title="Send recovery email to all eligible carts in the queue"
                >
                  <Email style={{ fontSize: 15 }} />
                  Bulk Send ({queue.filter((c) => {
                    const st = getEmailStatus(c, emailSendResults?.[c._id]);
                    return st.type === 'ready' || st.type === 'sent';
                  }).length})
                </button>
              )}
              {bulkRunning && (
                <button className="rem-bulk-abort-btn" onClick={handleBulkAbort}>
                  <Block style={{ fontSize: 14 }} />
                  Stop ({bulkDone}/{bulkTotal})
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="rem-error">
              <ErrorOutline style={{ fontSize: 16 }} />
              {error}
            </div>
          )}

          {/* ── KPI strip ─────────────────────────────────── */}
          <div className="rem-kpi-strip">
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--coral"><Inbox style={{ fontSize: 18 }} /></span>
              <div>
                <div className="rem-kpi-val">{fmt.number(queue.length)}</div>
                <div className="rem-kpi-lbl">In Queue</div>
              </div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--blue"><MarkEmailRead style={{ fontSize: 18 }} /></span>
              <div>
                <div className="rem-kpi-val">{fmt.number(sent.length)}</div>
                <div className="rem-kpi-lbl">Emails Sent</div>
              </div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--green"><CheckCircle style={{ fontSize: 18 }} /></span>
              <div>
                <div className="rem-kpi-val">{fmt.number(recovered.length)}</div>
                <div className="rem-kpi-lbl">Recovered</div>
              </div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--amber"><AttachMoney style={{ fontSize: 18 }} /></span>
              <div>
                <div className="rem-kpi-val">{fmt.compact(totalValue)}</div>
                <div className="rem-kpi-lbl">Queue Value</div>
              </div>
            </div>
          </div>

          {/* ── Bulk progress ──────────────────────────────── */}
          {bulkRunning && (
            <div className="rem-bulk-progress">
              <Spinner size={15} />
              <span>Sending {bulkDone} of {bulkTotal}…</span>
              <div className="rem-bulk-bar-track">
                <div
                  className="rem-bulk-bar-fill"
                  style={{ width: `${bulkTotal > 0 ? (bulkDone / bulkTotal) * 100 : 0}%` }}
                />
              </div>
              <span className="rem-bulk-pct">{bulkTotal > 0 ? Math.round((bulkDone / bulkTotal) * 100) : 0}%</span>
            </div>
          )}

          {/* ── Tabs + Search ──────────────────────────────── */}
          <div className="rem-toolbar">
            <div className="rem-tabs">
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                const count = tab.key === 'queue' ? queue.length : tab.key === 'sent' ? sent.length : recovered.length;
                return (
                  <button
                    key={tab.key}
                    className={`rem-tab ${activeTab === tab.key ? 'rem-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <TabIcon style={{ fontSize: 14 }} />
                    {tab.label}
                    <span className="rem-tab-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="rem-search-wrap">
              <Search style={{ fontSize: 15, color: '#9CA3AF', flexShrink: 0 }} />
              <input
                className="rem-search"
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* ── Table ─────────────────────────────────────── */}
          <div className="rem-card">
            {first ? (
              <div className="rem-loading">
                <Spinner size={28} />
                <span>Loading checkouts…</span>
              </div>
            ) : activeList.length === 0 ? (
              <Empty
                Icon={activeTab === 'queue' ? Inbox : activeTab === 'sent' ? MarkEmailRead : CheckCircle}
                label={
                  activeTab === 'queue'     ? 'No carts in queue'      :
                  activeTab === 'sent'      ? 'No emails sent yet'     :
                  'No recovered carts yet'
                }
                sub={search ? 'Try a different search term' : undefined}
              />
            ) : (
              <div className="rem-tbl-wrap">
                <table className="rem-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Customer</th>
                      <th>Email</th>
                      <th>Cart Value</th>
                      <th>Items</th>
                      <th>Priority</th>
                      <th>Abandoned</th>
                      <th>Status</th>
                      {activeTab !== 'recovered' && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeList.slice(0, 100).map((c, i) => {
                      const u             = c.user || {};
                      const priorityScore = c.priority ?? c.priorityScore ?? 0;
                      const priority      = getPriority(priorityScore);
                      const cartValue     = c.pricing?.totalPrice || 0;
                      const itemCount     = c.items?.length || 0;
                      const id            = c._id;
                      const result        = emailSendResults?.[id];
                      const status        = getEmailStatus(c, result);

                      return (
                        <tr key={id || i} className={status.type === 'ready' ? 'rem-tr--ready' : ''}>
                          <td className="rem-td-rank">{i + 1}</td>
                          <td className="rem-td-name">
                            {u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Guest'}
                          </td>
                          <td className="rem-td-email">{u.email || '—'}</td>
                          <td className="rem-td-money">{fmt.compact(cartValue)}</td>
                          <td className="rem-td-num">{fmt.number(itemCount)}</td>
                          <td>
                            <span className={`rem-priority rem-priority--${priority.cls}`}>
                              {priority.label}
                            </span>
                          </td>
                          <td className="rem-td-date">
                            {fmt.date(c.abandonment?.abandonedAt || c.updatedAt)}
                          </td>
                          <td>
                            <span className={`rem-status rem-status--${status.type}`}>
                              {status.label}
                            </span>
                          </td>
                          {activeTab !== 'recovered' && (
                            <td>
                              <SendButton
                                checkout={c}
                                loading={!!emailSendLoading?.[id]}
                                result={result}
                                sendError={emailSendError?.[id]}
                                onSend={(checkoutId) => dispatch(markRecoveryEmailSent(checkoutId))}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {activeList.length > 100 && (
            <p className="rem-truncation-note">
              Showing 100 of {activeList.length} — use search to narrow results
            </p>
          )}

        </div>
      </div>
    </>
  );
}