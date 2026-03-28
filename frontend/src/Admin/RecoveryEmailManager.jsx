import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, Email, MarkEmailRead, CheckCircle,
  Search, AttachMoney, ErrorOutline, Send, Block, Inbox,
  Loop, PersonSearch, SwapHoriz,
} from '@mui/icons-material';
import {
  fetchAbandonedCheckouts,
  markRecoveryEmailSent,
} from '../features/analytics/operationsSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/RecoveryEmailManager.css';

const COOLDOWN_MS  = (parseInt(import.meta.env.VITE_RECOVERY_COOLDOWN_HOURS) || 24) * 3_600_000;
const MAX_ATTEMPTS = parseInt(import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS) || 3;
const BULK_DELAY_MS = 800;

const fmt = {
  currency: (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0),
  number:   (v) => new Intl.NumberFormat('en-US').format(v || 0),
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

function getEmailStatus(checkout, result) {
  const ab        = checkout.abandonment || {};
  const count     = result?.attemptNumber  ?? ab.recoveryEmailCount  ?? 0;
  const sentAt    = result?.sentAt         ?? ab.recoveryEmailSentAt ?? null;
  const nextAt    = result?.nextAvailableAt ?? null;
  const converted = checkout.conversion?.isConverted;

  if (converted) return { type: 'converted', label: 'Converted', count };

  const cooldownUntil =
    nextAt ? new Date(nextAt) :
    sentAt ? new Date(new Date(sentAt).getTime() + COOLDOWN_MS) :
    null;

  const inCooldown = !!(cooldownUntil && cooldownUntil.getTime() > Date.now());

  if (count >= MAX_ATTEMPTS) return { type: 'maxed',    label: `Max (${MAX_ATTEMPTS})`, count };
  if (inCooldown)            return { type: 'cooldown', label: 'Cooldown',              count, cooldownUntil };
  if (count > 0)             return { type: 'sent',     label: `Sent (${count})`,       count };
  return                            { type: 'ready',    label: 'Ready',                 count };
}

function getPriority(score) {
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
}

// Resolve the step label to display for a checkout.
// Always shows firstAbandonedAtStep when available — for re-abandoned carts
// this is the original step, postRecoveryAbandonedAtStep is shown separately.
const STEP_LABEL_MAP = {
  'shipping_info':      'Shipping Info',
  'order_confirmation': 'Order Confirm',
  'payment_selection':  'Pmt Selection',
  'payment_gateway':    'Pmt Gateway',
  'payment_failed':     'Pmt Failed',
};
const resolveStep = (s = '') =>
  STEP_LABEL_MAP[s] || s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function Spinner({ size = 20 }) {
  return (
    <span
      className="rem-spinner"
      style={{ width: size, height: size, borderWidth: size > 16 ? 3 : 2 }}
    />
  );
}

function Empty({ icon: EmptyIcon = Inbox, label, sub }) {
  return (
    <div className="rem-empty">
      <EmptyIcon style={{ fontSize: 44 }} />
      <span className="rem-empty-label">{label}</span>
      {sub && <span className="rem-empty-sub">{sub}</span>}
    </div>
  );
}

// ── Cart diff indicator ────────────────────────────────────────────────────
// Shows a compact summary of what changed between the recovery cart snapshot
// and the actual purchase (or the current cart state for re-abandoned carts).
function CartDiffBadge({ diff }) {
  if (!diff) return null;

  const parts = [];
  if (diff.itemsAdded   > 0) parts.push(`+${diff.itemsAdded} added`);
  if (diff.itemsRemoved > 0) parts.push(`-${diff.itemsRemoved} removed`);
  if (diff.qtyIncreased > 0) parts.push(`↑ qty`);
  if (diff.qtyDecreased > 0) parts.push(`↓ qty`);
  if (diff.discountChangedAfterRecovery) parts.push('disc. changed');

  if (parts.length === 0) return (
    <span className="rem-diff-badge rem-diff-badge--unchanged" title="Cart unchanged from recovery snapshot">
      <SwapHoriz style={{ fontSize: 11 }} /> Unchanged
    </span>
  );

  const valueDelta = diff.valueDelta ?? 0;
  const cls = valueDelta > 0 ? 'pos' : valueDelta < 0 ? 'neg' : 'unchanged';

  return (
    <span
      className={`rem-diff-badge rem-diff-badge--${cls}`}
      title={`Cart changed after recovery link click: ${parts.join(', ')}. Value delta: ${valueDelta >= 0 ? '+' : ''}${fmt.currency(valueDelta)}`}
    >
      <SwapHoriz style={{ fontSize: 11 }} />
      {parts.slice(0, 2).join(', ')}
      {parts.length > 2 && ` +${parts.length - 2}`}
    </span>
  );
}

const TABS = [
  { key: 'queue',        label: 'Queue',           icon: Inbox },
  { key: 'sent',         label: 'Sent',            icon: MarkEmailRead },
  { key: 'reabandoned',  label: 'Failed Recovery', icon: Loop },
  { key: 'recovered',    label: 'Recovered',       icon: CheckCircle },
];

function useTick(intervalMs = 60_000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function SendButton({ checkout, loading, result, sendError, onSend, now }) {
  const status = getEmailStatus(checkout, result);
  const id     = checkout._id;

  if (status.type === 'converted') return <span className="rem-status rem-status--converted">Converted</span>;
  if (status.type === 'maxed')     return <span className="rem-status rem-status--maxed">Max reached</span>;
  if (status.type === 'cooldown') {
    const h = Math.ceil((status.cooldownUntil.getTime() - now) / 3_600_000);
    return (
      <span className="rem-status rem-status--cooldown" title={`Available: ${status.cooldownUntil.toLocaleString()}`}>
        {h}h left
      </span>
    );
  }

  const label = loading ? 'Sending…' : status.count > 0 ? `Resend (${status.count}/${MAX_ATTEMPTS})` : 'Send';

  return (
    <div className="rem-send-wrap">
      {sendError && (
        <span className="rem-send-err" title={sendError} aria-label={`Send error: ${sendError}`}>!</span>
      )}
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

export default function RecoveryEmailManager() {
  const dispatch = useDispatch();
  const tick     = useTick(60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now      = useMemo(() => Date.now(), [tick]);

  const {
    abandonedCheckouts: abandonedRaw,
    emailSendLoading,
    emailSendResults,
    emailSendError,
    error,
  } = useSelector((s) => s.operations);

  const [activeTab,   setActiveTab]   = useState('queue');
  const [search,      setSearch]      = useState('');
  const [hasFetched,  setHasFetched]  = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone,    setBulkDone]    = useState(0);
  const [bulkTotal,   setBulkTotal]   = useState(0);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const bulkAbort  = useRef(false);
  const loadingRef = useRef(false);

  const loadData = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    return Promise.allSettled([
      dispatch(fetchAbandonedCheckouts({
        hours: 168, minValue: 0, limit: 200, page: 1, sortBy: 'priority',
      })),
    ]).finally(() => { loadingRef.current = false; });
  }, [dispatch]);

  useEffect(() => {
    loadData()?.then(() => { setRefreshing(false); setHasFetched(true); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setHasFetched(false);
    loadData()?.then(() => { setRefreshing(false); setHasFetched(true); });
  }, [loadData]);

  const first = !hasFetched;

  // ── Partition checkouts into tabs ────────────────────────────────────────
  const { queue, sent, reAbandoned, recovered } = useMemo(() => {
    const checkouts = abandonedRaw?.abandonedCheckouts || [];
    const q = [], s = [], r = [], rec = [];

    for (const c of checkouts) {
      const result = emailSendResults?.[c._id];
      const status = getEmailStatus(c, result);
      const isConv = c.conversion?.isConverted;
      const isReAb = c.abandonment?.reAbandoned === true;

      if (isConv) {
        rec.push(c);
      } else if (isReAb) {
        // Re-abandoned always goes to its own tab regardless of email status
        r.push(c);
      } else if (status.type === 'sent' || status.type === 'cooldown' || status.type === 'maxed') {
        s.push(c);
      } else {
        q.push(c);
      }
    }
    return { queue: q, sent: s, reAbandoned: r, recovered: rec };
  }, [abandonedRaw, emailSendResults]);

  const activeList = useMemo(() => {
    const src =
      activeTab === 'queue'       ? queue       :
      activeTab === 'sent'        ? sent        :
      activeTab === 'reabandoned' ? reAbandoned :
      recovered;

    if (!search.trim()) return src;
    const q = search.toLowerCase();
    return src.filter((c) => {
      const u = c.user || {};
      return `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
             (u.email || '').toLowerCase().includes(q);
    });
  }, [activeTab, queue, sent, reAbandoned, recovered, search]);

  const totalValue = useMemo(
    () => queue.reduce((sum, c) => sum + (c.pricing?.totalPrice || 0), 0),
    [queue]
  );

  const reAbandonedRevenue = useMemo(
    () => reAbandoned.reduce((sum, c) => sum + (c.pricing?.totalPrice || 0), 0),
    [reAbandoned]
  );

  const eligibleForBulk = useMemo(
    () => queue.filter((c) => {
      const st = getEmailStatus(c, emailSendResults?.[c._id]);
      return st.type === 'ready' || st.type === 'sent';
    }),
    [queue, emailSendResults]
  );

  const handleBulkConfirmRequest = useCallback(() => {
    if (!eligibleForBulk.length) return;
    setBulkConfirm(true);
  }, [eligibleForBulk]);

  const handleBulkSend = useCallback(async () => {
    setBulkConfirm(false);
    if (!eligibleForBulk.length) return;

    bulkAbort.current = false;
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(eligibleForBulk.length);

    for (let i = 0; i < eligibleForBulk.length; i++) {
      if (bulkAbort.current) break;

      const latest = emailSendResults?.[eligibleForBulk[i]._id];
      const st     = getEmailStatus(eligibleForBulk[i], latest);
      if (st.type !== 'ready' && st.type !== 'sent') {
        setBulkDone(i + 1);
        continue;
      }

      await dispatch(markRecoveryEmailSent(eligibleForBulk[i]._id));
      setBulkDone(i + 1);
      if (i < eligibleForBulk.length - 1) {
        await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
      }
    }

    setBulkRunning(false);
  }, [dispatch, eligibleForBulk, emailSendResults]);

  const handleBulkAbort = () => { bulkAbort.current = true; };

  // ── Columns vary per tab ───────────────────────────────────────────────────
  const showActionCol   = activeTab !== 'recovered';
  const showReAbandonedCols = activeTab === 'reabandoned';

  return (
    <>
      <Navbar />
      <div className="rem-page">
        <div className="rem-body">

          <Link to="/admin/dashboard" className="rem-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          <div className="rem-hd">
            <div className="rem-hd-left">
              <span className="rem-hd-icon"><MarkEmailRead style={{ fontSize: 26 }} /></span>
              <div>
                <h1 className="rem-hd-title">Recovery Email Manager</h1>
                <p className="rem-hd-sub">Send cart recovery emails · Track cooldowns · Monitor failed recoveries · Conversions</p>
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
                  onClick={handleBulkConfirmRequest}
                  disabled={refreshing || !eligibleForBulk.length}
                  title="Send recovery email to all eligible carts in the queue"
                >
                  <Email style={{ fontSize: 15 }} />
                  Bulk Send ({eligibleForBulk.length})
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

          {bulkConfirm && (
            <div className="rem-confirm-banner">
              <span>
                Send recovery emails to <strong>{eligibleForBulk.length}</strong> cart{eligibleForBulk.length !== 1 ? 's' : ''}? This cannot be undone.
              </span>
              <div className="rem-confirm-actions">
                <button className="rem-confirm-btn rem-confirm-btn--cancel" onClick={() => setBulkConfirm(false)}>Cancel</button>
                <button className="rem-confirm-btn rem-confirm-btn--go"     onClick={handleBulkSend}>Send All</button>
              </div>
            </div>
          )}

          {error && (
            <div className="rem-error">
              <ErrorOutline style={{ fontSize: 16 }} />{error}
            </div>
          )}

          {/* ── KPI strip ──────────────────────────────────────────────── */}
          <div className="rem-kpi-strip">
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--coral"><Inbox style={{ fontSize: 18 }} /></span>
              <div><div className="rem-kpi-val">{fmt.number(queue.length)}</div><div className="rem-kpi-lbl">In Queue</div></div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--blue"><MarkEmailRead style={{ fontSize: 18 }} /></span>
              <div><div className="rem-kpi-val">{fmt.number(sent.length)}</div><div className="rem-kpi-lbl">Emails Sent</div></div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--purple"><Loop style={{ fontSize: 18 }} /></span>
              <div>
                <div className="rem-kpi-val" style={{ color: '#7C3AED' }}>{fmt.number(reAbandoned.length)}</div>
                <div className="rem-kpi-lbl">Failed Recoveries</div>
              </div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--green"><CheckCircle style={{ fontSize: 18 }} /></span>
              <div><div className="rem-kpi-val">{fmt.number(recovered.length)}</div><div className="rem-kpi-lbl">Recovered</div></div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--amber"><AttachMoney style={{ fontSize: 18 }} /></span>
              <div><div className="rem-kpi-val">{fmt.compact(totalValue)}</div><div className="rem-kpi-lbl">Queue Value</div></div>
            </div>
            <div className="rem-kpi">
              <span className="rem-kpi-icon rem-kpi-icon--red"><AttachMoney style={{ fontSize: 18 }} /></span>
              <div>
                <div className="rem-kpi-val" style={{ color: '#DC2626' }}>{fmt.compact(reAbandonedRevenue)}</div>
                <div className="rem-kpi-lbl">Failed Rev. Lost</div>
              </div>
            </div>
          </div>

          {bulkRunning && (
            <div className="rem-bulk-progress">
              <Spinner size={15} />
              <span>Sending {bulkDone} of {bulkTotal}…</span>
              <div className="rem-bulk-bar-track">
                <div className="rem-bulk-bar-fill" style={{ width: `${bulkTotal > 0 ? (bulkDone / bulkTotal) * 100 : 0}%` }} />
              </div>
              <span className="rem-bulk-pct">{bulkTotal > 0 ? Math.round((bulkDone / bulkTotal) * 100) : 0}%</span>
            </div>
          )}

          {/* ── Toolbar ─────────────────────────────────────────────────── */}
          <div className="rem-toolbar">
            <div className="rem-tabs">
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                const count =
                  tab.key === 'queue'       ? queue.length       :
                  tab.key === 'sent'        ? sent.length        :
                  tab.key === 'reabandoned' ? reAbandoned.length :
                  recovered.length;
                return (
                  <button
                    key={tab.key}
                    className={`rem-tab ${activeTab === tab.key ? 'rem-tab--active' : ''} ${tab.key === 'reabandoned' && reAbandoned.length > 0 ? 'rem-tab--alert' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <TabIcon style={{ fontSize: 14 }} />{tab.label}
                    <span className={`rem-tab-count ${tab.key === 'reabandoned' && reAbandoned.length > 0 ? 'rem-tab-count--alert' : ''}`}>
                      {count}
                    </span>
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

          {/* ── Failed Recovery context banner ───────────────────────────── */}
          {activeTab === 'reabandoned' && reAbandoned.length > 0 && (
            <div className="rem-context-banner">
              <Loop style={{ fontSize: 16, color: '#7C3AED' }} />
              <span>
                These customers <strong>clicked your recovery link</strong> but abandoned again without purchasing.
                The <em>Post-Recovery Step</em> column shows where they left on their second attempt.
                Consider a different offer or follow-up strategy.
              </span>
            </div>
          )}

          {/* ── Table ───────────────────────────────────────────────────── */}
          <div className="rem-card">
            {first ? (
              <div className="rem-loading"><Spinner size={28} /><span>Loading checkouts…</span></div>
            ) : activeList.length === 0 ? (
              <Empty
                icon={
                  activeTab === 'queue'       ? Inbox        :
                  activeTab === 'sent'        ? MarkEmailRead :
                  activeTab === 'reabandoned' ? Loop         :
                  CheckCircle
                }
                label={
                  activeTab === 'queue'       ? 'No carts in queue'          :
                  activeTab === 'sent'        ? 'No emails sent yet'         :
                  activeTab === 'reabandoned' ? 'No failed recoveries — great news!' :
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
                      <th>First Abandoned Step</th>
                      {showReAbandonedCols && <th>Post-Recovery Step</th>}
                      {showReAbandonedCols && <th>Cart Changes</th>}
                      <th>Abandoned</th>
                      <th>Status</th>
                      {showActionCol && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeList.slice(0, 100).map((c, i) => {
                      const u             = c.user || {};
                      const priorityScore = c.priority ?? c.priorityScore ?? 0;
                      const priority      = getPriority(priorityScore);
                      const id            = c._id;
                      const result        = emailSendResults?.[id];
                      const status        = getEmailStatus(c, result);

                      const firstStep       = c.abandonment?.firstAbandonedAtStep || c.abandonment?.abandonedAtStep;
                      const postRecovStep   = c.abandonment?.postRecoveryAbandonedAtStep;
                      const cartDiff        = c.abandonment?.recoveryCartDiff;
                      const isOrganic       = c.abandonment?.organicRecovery === true;
                      const failedRecoveries = c.abandonment?.failedRecoveries || 0;

                      return (
                        <tr key={id || i} className={status.type === 'ready' ? 'rem-tr--ready' : ''}>
                          <td className="rem-td-rank">{i + 1}</td>
                          <td className="rem-td-name">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Guest'}
                              {isOrganic && (
                                <span className="rem-flag rem-flag--organic" title="Converted without using recovery link (organic recovery)">
                                  <PersonSearch style={{ fontSize: 10 }} /> Organic
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="rem-td-email">{u.email || '—'}</td>
                          <td className="rem-td-money">{fmt.compact(c.pricing?.totalPrice || 0)}</td>
                          <td className="rem-td-num">{fmt.number(c.items?.length || 0)}</td>
                          <td>
                            <span className={`rem-priority rem-priority--${priority.cls}`}>{priority.label}</span>
                          </td>
                          <td className="rem-td-step">
                            {resolveStep(firstStep) || '—'}
                          </td>
                          {showReAbandonedCols && (
                            <td className="rem-td-step rem-td-step--post">
                              {postRecovStep ? (
                                <span style={{ color: '#7C3AED', fontWeight: 700 }}>
                                  {resolveStep(postRecovStep)}
                                </span>
                              ) : '—'}
                              {failedRecoveries > 1 && (
                                <span className="rem-fail-count" title={`${failedRecoveries} failed recovery attempts`}>
                                  ×{failedRecoveries}
                                </span>
                              )}
                            </td>
                          )}
                          {showReAbandonedCols && (
                            <td>
                              <CartDiffBadge diff={cartDiff} />
                            </td>
                          )}
                          <td className="rem-td-date">
                            {fmt.date(c.abandonment?.abandonedAt || c.updatedAt)}
                          </td>
                          <td>
                            <span className={`rem-status rem-status--${status.type}`}>{status.label}</span>
                          </td>
                          {showActionCol && (
                            <td>
                              <SendButton
                                checkout={c}
                                loading={!!emailSendLoading?.[id]}
                                result={result}
                                sendError={emailSendError?.[id]}
                                onSend={(checkoutId) => dispatch(markRecoveryEmailSent(checkoutId))}
                                now={now}
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