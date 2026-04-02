import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Refresh, Email, MarkEmailRead, CheckCircle,
  Search, AttachMoney, ErrorOutline, Send, Block, Inbox,
  Loop, PersonSearch, SwapHoriz,
} from '@mui/icons-material';
import { fetchAbandonedCheckouts } from '../features/analytics/operationsSlice';
import { dispatchRecoveryEmail, clearResults } from '../features/admin/recoveryEmailSlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/RecoveryEmailManager.css';

const COOLDOWN_MS   = (parseInt(import.meta.env.VITE_RECOVERY_COOLDOWN_HOURS) || 24) * 3_600_000;
const MAX_ATTEMPTS  = parseInt(import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS) || 3;
const BULK_DELAY_MS = 800;

console.log('[REM] Module loaded — COOLDOWN_MS:', COOLDOWN_MS, '| MAX_ATTEMPTS:', MAX_ATTEMPTS);

// ============================================
// FORMATTERS
// ============================================

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
};

// ============================================
// EMAIL STATUS
// sendResult (from slice) always wins over checkout fields.
// ============================================

function getEmailFields(checkout, sendResult) {
  const ab = checkout?.abandonment ?? {};
  const fields = {
    count:           Number(sendResult?.attemptNumber    ?? ab.recoveryEmailCount  ?? 0),
    sentAt:          sendResult?.sentAt                   ?? ab.recoveryEmailSentAt ?? null,
    nextAvailableAt: sendResult?.nextAvailableAt          ?? null,
    isConverted:     checkout?.conversion?.isConverted    === true,
  };
  console.log('[getEmailFields] id:', checkout?._id, '| sendResult:', sendResult ? '✅' : 'null', '| fields:', fields);
  return fields;
}

function getEmailStatus({ count, sentAt, nextAvailableAt, isConverted }, now) {
  if (isConverted) return { type: 'converted', label: 'Converted', count };

  const cooldownUntil =
    nextAvailableAt ? new Date(nextAvailableAt) :
    sentAt          ? new Date(new Date(sentAt).getTime() + COOLDOWN_MS) :
    null;

  const inCooldown = Boolean(cooldownUntil && cooldownUntil.getTime() > now);

  let status;
  if (count >= MAX_ATTEMPTS) status = { type: 'maxed',    label: `Max (${MAX_ATTEMPTS})`, count };
  else if (inCooldown)       status = { type: 'cooldown', label: 'Cooldown',              count, cooldownUntil };
  else if (count > 0)        status = { type: 'sent',     label: `Sent (${count})`,       count };
  else                       status = { type: 'ready',    label: 'Ready',                 count };

  console.log('[getEmailStatus] count:', count, '| inCooldown:', inCooldown, '| resolved type:', status.type);
  return status;
}

// ============================================
// HELPERS
// ============================================

function getPriority(score) {
  if (score >= 70) return { label: 'High',   cls: 'high' };
  if (score >= 40) return { label: 'Medium', cls: 'med' };
  return                  { label: 'Low',    cls: 'low' };
}

const STEP_LABELS = {
  'shipping_info':      'Shipping Info',
  'order_confirmation': 'Order Confirm',
  'payment_selection':  'Pmt Selection',
  'payment_gateway':    'Pmt Gateway',
  'payment_failed':     'Pmt Failed',
};
const resolveStep = (s = '') =>
  STEP_LABELS[s] || s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ============================================
// SUB-COMPONENTS
// ============================================

function Spinner({ size = 20 }) {
  return (
    <span
      className="rem-spinner"
      style={{ width: size, height: size, borderWidth: size > 16 ? 3 : 2 }}
    />
  );
}

function Empty({ icon: Icon = Inbox, label, sub }) {
  return (
    <div className="rem-empty">
      <Icon style={{ fontSize: 44 }} />
      <span className="rem-empty-label">{label}</span>
      {sub && <span className="rem-empty-sub">{sub}</span>}
    </div>
  );
}

function CartDiffBadge({ diff }) {
  if (!diff) return null;
  const parts = [];
  if (diff.itemsAdded   > 0) parts.push(`+${diff.itemsAdded} added`);
  if (diff.itemsRemoved > 0) parts.push(`-${diff.itemsRemoved} removed`);
  if (diff.qtyIncreased > 0) parts.push(`↑ qty`);
  if (diff.qtyDecreased > 0) parts.push(`↓ qty`);
  if (diff.discountChangedAfterRecovery) parts.push('disc. changed');

  if (parts.length === 0) return (
    <span className="rem-diff-badge rem-diff-badge--unchanged" title="Cart unchanged">
      <SwapHoriz style={{ fontSize: 11 }} /> Unchanged
    </span>
  );

  const valueDelta = diff.valueDelta ?? 0;
  const cls = valueDelta > 0 ? 'pos' : valueDelta < 0 ? 'neg' : 'unchanged';
  return (
    <span
      className={`rem-diff-badge rem-diff-badge--${cls}`}
      title={`${parts.join(', ')}. Delta: ${valueDelta >= 0 ? '+' : ''}${fmt.currency(valueDelta)}`}
    >
      <SwapHoriz style={{ fontSize: 11 }} />
      {parts.slice(0, 2).join(', ')}{parts.length > 2 && ` +${parts.length - 2}`}
    </span>
  );
}

// Purely presentational — no Redux reads, no side effects.
function SendButton({ status, loading, sendError, onSend, checkoutId, justSent, now }) {
  console.log('[SendButton] render — id:', checkoutId, '| loading:', loading, '| justSent:', justSent, '| status:', status.type);

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

  const label =
    loading  ? 'Sending…' :
    justSent ? 'Sent!'    :
    status.count > 0 ? `Resend (${status.count}/${MAX_ATTEMPTS})` : 'Send';

  return (
    <div className="rem-send-wrap">
      {sendError && <span className="rem-send-err" title={sendError}>!</span>}
      <button
        className={`rem-send-btn${justSent ? ' rem-send-btn--success' : ''}`}
        onClick={() => {
          console.log('[SendButton] clicked — id:', checkoutId, '| loading:', loading);
          if (!loading) onSend(checkoutId);
        }}
        disabled={loading}
        title={
          loading  ? 'Sending recovery email...' :
          justSent ? 'Email sent successfully'   :
          status.count > 0 ? `Attempt ${status.count + 1} of ${MAX_ATTEMPTS}` : 'Send recovery email'
        }
      >
        {loading  ? <Spinner size={13} />                    :
         justSent ? <CheckCircle style={{ fontSize: 13 }} /> :
                    <Send style={{ fontSize: 13 }} />}
        {label}
      </button>
    </div>
  );
}

// ============================================
// TABS
// ============================================

const TABS = [
  { key: 'queue',       label: 'Queue',           icon: Inbox        },
  { key: 'sent',        label: 'Sent',            icon: MarkEmailRead },
  { key: 'reabandoned', label: 'Failed Recovery', icon: Loop         },
  { key: 'recovered',   label: 'Recovered',       icon: CheckCircle  },
];

// ============================================
// HOOKS
// ============================================

// Ticks every minute so cooldown timers stay accurate without re-fetching.
function useTick(ms = 60_000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

// Tracks which checkout IDs just had a successful send.
// These IDs are PINNED in the queue tab for `durationMs` so the
// "Sent!" flash is visible before the row migrates to the Sent tab.
function useJustSent(durationMs = 4000) {
  const [ids, setIds] = useState({});
  const timers        = useRef({});

  const mark = useCallback((id) => {
    console.log('[useJustSent] marking id:', id);
    setIds(prev => ({ ...prev, [id]: true }));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      console.log('[useJustSent] pin expired — releasing id:', id);
      setIds(prev => { const n = { ...prev }; delete n[id]; return n; });
      delete timers.current[id];
    }, durationMs);
  }, [durationMs]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  return { ids, mark };
}

// ============================================
// PAGE
// ============================================

export default function RecoveryEmailManager() {
  console.log('[REM] Component rendering');

  const dispatch = useDispatch();
  const tick     = useTick();
  // Single stable `now` per render — prevents per-row drift in cooldown display.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick]);

  // ── Selectors ──────────────────────────────────────────────────────────
  const abandonedCheckouts = useSelector(s => s.operations.abandonedCheckouts);
  const fetchError         = useSelector(s => s.operations.error);
  const emailLoading       = useSelector(s => {
    console.log('[SELECTOR] emailLoading:', JSON.stringify(s.recoveryEmail.loading));
    return s.recoveryEmail.loading;
  });
  const emailResults = useSelector(s => {
    console.log('[SELECTOR] emailResults keys:', Object.keys(s.recoveryEmail.results));
    return s.recoveryEmail.results;
  });
  const emailErrors = useSelector(s => s.recoveryEmail.errors);

  // ── Local UI state ─────────────────────────────────────────────────────
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

  const { ids: justSentIds, mark: markJustSent } = useJustSent(4000);

  // ── Data loading ───────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    if (loadingRef.current) {
      console.log('[REM] loadData skipped — already in flight');
      return Promise.resolve();
    }
    loadingRef.current = true;
    console.log('[REM] loadData — dispatching fetchAbandonedCheckouts');
    return dispatch(fetchAbandonedCheckouts({
      hours: 168, minValue: 0, limit: 200, page: 1, sortBy: 'priority',
    })).finally(() => {
      loadingRef.current = false;
      console.log('[REM] loadData complete');
    });
  }, [dispatch]);

  useEffect(() => {
    console.log('[REM] Initial mount — calling loadData');
    loadData().then(() => {
      console.log('[REM] Initial load done — hasFetched = true');
      setHasFetched(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    console.log('[REM] handleRefresh called');
    setRefreshing(true);
    setHasFetched(false);
    dispatch(clearResults());
    loadData().then(() => {
      setRefreshing(false);
      setHasFetched(true);
      console.log('[REM] Refresh complete');
    });
  }, [dispatch, loadData]);

  // ── Send handler ───────────────────────────────────────────────────────
  // Uses fulfilled.match instead of .unwrap() — dispatch always resolves,
  // slice pending/fulfilled/rejected always fire, loading never gets stuck.
  const handleSend = useCallback(async (checkoutId) => {
    console.log('[handleSend] called — checkoutId:', checkoutId);
    const result = await dispatch(dispatchRecoveryEmail(checkoutId));
    console.log('[handleSend] dispatch resolved — result.type:', result.type);
    console.log('[handleSend] result.payload:', JSON.stringify(result.payload, null, 2));

    if (dispatchRecoveryEmail.fulfilled.match(result)) {
      console.log('[handleSend] ✅ fulfilled — marking justSent for:', checkoutId);
      markJustSent(checkoutId);
    } else {
      console.warn('[handleSend] ❌ not fulfilled — type:', result.type, '| payload:', result.payload);
    }
  }, [dispatch, markJustSent]);

  // ── Partition checkouts into tabs ──────────────────────────────────────
  //
  // KEY FIX: justSentIds pins a row in the queue tab for 4 seconds after
  // a successful send. Without this, the row immediately migrates to the
  // Sent tab the moment emailResults updates — the user never sees "Sent!"
  // and it looks like the button is stuck in "Sending…".
  //
  const { queue, sent, reAbandoned, recovered } = useMemo(() => {
    const raw = abandonedCheckouts?.abandonedCheckouts ?? [];
    console.log('[useMemo:partition] raw count:', raw.length, '| justSentIds:', Object.keys(justSentIds), '| emailResults keys:', Object.keys(emailResults));

    const q = [], s = [], r = [], rec = [];

    for (const checkout of raw) {
      const id         = String(checkout._id);
      const sendResult = emailResults[id] ?? null;
      const fields     = getEmailFields(checkout, sendResult);
      const status     = getEmailStatus(fields, now);
      const isReAb     = checkout.abandonment?.reAbandoned === true;

      // Pin this row in queue if it just sent — don't let it migrate tabs
      // until the justSent flash expires (4s). This is why the button
      // appeared stuck: the row vanished before loading cleared visually.
      const isPinned = Boolean(justSentIds[id]);

      console.log('[useMemo:partition] id:', id, '| status:', status.type, '| isPinned:', isPinned, '| isReAb:', isReAb);

      if (fields.isConverted) {
        rec.push({ checkout, status });
      } else if (isReAb) {
        r.push({ checkout, status });
      } else if (!isPinned && (status.type === 'sent' || status.type === 'cooldown' || status.type === 'maxed')) {
        s.push({ checkout, status });
      } else {
        // isPinned rows stay here in queue regardless of status
        q.push({ checkout, status });
      }
    }

    console.log('[useMemo:partition] result — queue:', q.length, '| sent:', s.length, '| reAbandoned:', r.length, '| recovered:', rec.length);
    return { queue: q, sent: s, reAbandoned: r, recovered: rec };
  }, [abandonedCheckouts, emailResults, justSentIds, now]);

  const activeEntries = useMemo(() => {
    const src =
      activeTab === 'queue'       ? queue       :
      activeTab === 'sent'        ? sent        :
      activeTab === 'reabandoned' ? reAbandoned :
      recovered;

    if (!search.trim()) return src;
    const q = search.toLowerCase();
    return src.filter(({ checkout: c }) => {
      const u = c.user || {};
      return `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
             (u.email || '').toLowerCase().includes(q);
    });
  }, [activeTab, queue, sent, reAbandoned, recovered, search]);

  const totalValue = useMemo(
    () => queue.reduce((sum, { checkout: c }) => sum + (c.pricing?.totalPrice || 0), 0),
    [queue]
  );

  const reAbandonedRevenue = useMemo(
    () => reAbandoned.reduce((sum, { checkout: c }) => sum + (c.pricing?.totalPrice || 0), 0),
    [reAbandoned]
  );

  // Eligible = queue rows that are ready or already sent (resend eligible)
  // Pinned rows are included since they're still in queue during the flash
  const eligibleForBulk = useMemo(
    () => queue.filter(({ status }) => status.type === 'ready' || status.type === 'sent'),
    [queue]
  );

  // ── Bulk send ──────────────────────────────────────────────────────────
  const handleBulkSend = useCallback(async () => {
    console.log('[handleBulkSend] called — eligibleForBulk:', eligibleForBulk.length);
    setBulkConfirm(false);
    if (!eligibleForBulk.length) return;

    bulkAbort.current = false;
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(eligibleForBulk.length);

    for (let i = 0; i < eligibleForBulk.length; i++) {
      if (bulkAbort.current) {
        console.log('[handleBulkSend] aborted at index:', i);
        break;
      }

      const { checkout } = eligibleForBulk[i];
      console.log('[handleBulkSend] sending for id:', checkout._id, `(${i + 1}/${eligibleForBulk.length})`);

      const result = await dispatch(dispatchRecoveryEmail(checkout._id));
      console.log('[handleBulkSend] result.type:', result.type, '| id:', checkout._id);

      if (dispatchRecoveryEmail.fulfilled.match(result)) {
        markJustSent(checkout._id);
      } else {
        console.warn('[handleBulkSend] ❌ failed for:', checkout._id, '| payload:', result.payload);
      }

      setBulkDone(i + 1);
      if (i < eligibleForBulk.length - 1) {
        await new Promise(res => setTimeout(res, BULK_DELAY_MS));
      }
    }

    console.log('[handleBulkSend] complete');
    setBulkRunning(false);
  }, [dispatch, eligibleForBulk, markJustSent]);

  const showActionCol       = activeTab !== 'recovered';
  const showReAbandonedCols = activeTab === 'reabandoned';

  console.log('[REM] Render — hasFetched:', hasFetched, '| activeTab:', activeTab, '| activeEntries:', activeEntries.length);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="rem-page">
        <div className="rem-body">

          <Link to="/admin/dashboard" className="rem-back">
            <ArrowBack style={{ fontSize: 15 }} /> Dashboard
          </Link>

          {/* Header */}
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
                  onClick={() => eligibleForBulk.length && setBulkConfirm(true)}
                  disabled={refreshing || !eligibleForBulk.length}
                  title="Send recovery email to all eligible carts"
                >
                  <Email style={{ fontSize: 15 }} />
                  Bulk Send ({eligibleForBulk.length})
                </button>
              )}
              {bulkRunning && (
                <button className="rem-bulk-abort-btn" onClick={() => { bulkAbort.current = true; }}>
                  <Block style={{ fontSize: 14 }} />
                  Stop ({bulkDone}/{bulkTotal})
                </button>
              )}
            </div>
          </div>

          {/* Bulk confirm */}
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

          {fetchError && (
            <div className="rem-error">
              <ErrorOutline style={{ fontSize: 16 }} />{fetchError}
            </div>
          )}

          {/* KPI strip */}
          <div className="rem-kpi-strip">
            {[
              { icon: Inbox,         cls: 'coral',  val: fmt.number(queue.length),        lbl: 'In Queue'          },
              { icon: MarkEmailRead, cls: 'blue',   val: fmt.number(sent.length),         lbl: 'Emails Sent'       },
              { icon: Loop,          cls: 'purple', val: fmt.number(reAbandoned.length),  lbl: 'Failed Recoveries', color: '#7C3AED' },
              { icon: CheckCircle,   cls: 'green',  val: fmt.number(recovered.length),    lbl: 'Recovered'         },
              { icon: AttachMoney,   cls: 'amber',  val: fmt.compact(totalValue),         lbl: 'Queue Value'       },
              { icon: AttachMoney,   cls: 'red',    val: fmt.compact(reAbandonedRevenue), lbl: 'Failed Rev. Lost',  color: '#DC2626' },
            ].map(({ icon: Icon, cls, val, lbl, color }) => (
              <div key={lbl} className="rem-kpi">
                <span className={`rem-kpi-icon rem-kpi-icon--${cls}`}><Icon style={{ fontSize: 18 }} /></span>
                <div>
                  <div className="rem-kpi-val" style={color ? { color } : {}}>{val}</div>
                  <div className="rem-kpi-lbl">{lbl}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Bulk progress */}
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

          {/* Toolbar */}
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
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Failed Recovery banner */}
          {activeTab === 'reabandoned' && reAbandoned.length > 0 && (
            <div className="rem-context-banner">
              <Loop style={{ fontSize: 16, color: '#7C3AED' }} />
              <span>
                These customers <strong>clicked your recovery link</strong> but abandoned again.
                The <em>Post-Recovery Step</em> column shows where they left on their second attempt.
              </span>
            </div>
          )}

          {/* Table */}
          <div className="rem-card">
            {!hasFetched ? (
              <div className="rem-loading"><Spinner size={28} /><span>Loading checkouts…</span></div>
            ) : activeEntries.length === 0 ? (
              <Empty
                icon={
                  activeTab === 'queue'       ? Inbox         :
                  activeTab === 'sent'        ? MarkEmailRead :
                  activeTab === 'reabandoned' ? Loop          : CheckCircle
                }
                label={
                  activeTab === 'queue'       ? 'No carts in queue'                  :
                  activeTab === 'sent'        ? 'No emails sent yet'                 :
                  activeTab === 'reabandoned' ? 'No failed recoveries — great news!' : 'No recovered carts yet'
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
                    {activeEntries.slice(0, 100).map(({ checkout: c, status }, i) => {
                      const id          = String(c._id);
                      const u           = c.user || {};
                      const priority    = getPriority(c.priority ?? c.priorityScore ?? 0);
                      const firstStep   = c.abandonment?.firstAbandonedAtStep || c.abandonment?.abandonedAtStep;
                      const isOrganic   = c.abandonment?.organicRecovery === true;
                      const failedCount = c.abandonment?.failedRecoveries || 0;
                      const justSent    = Boolean(justSentIds[id]);

                      return (
                        <tr key={id || i} className={status.type === 'ready' ? 'rem-tr--ready' : ''}>
                          <td className="rem-td-rank">{i + 1}</td>
                          <td className="rem-td-name">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Guest'}
                              {isOrganic && (
                                <span className="rem-flag rem-flag--organic" title="Converted without recovery link">
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
                          <td className="rem-td-step">{resolveStep(firstStep) || '—'}</td>

                          {showReAbandonedCols && (
                            <td className="rem-td-step rem-td-step--post">
                              {c.abandonment?.postRecoveryAbandonedAtStep
                                ? <span style={{ color: '#7C3AED', fontWeight: 700 }}>{resolveStep(c.abandonment.postRecoveryAbandonedAtStep)}</span>
                                : '—'}
                              {failedCount > 1 && (
                                <span className="rem-fail-count" title={`${failedCount} failed recovery attempts`}>×{failedCount}</span>
                              )}
                            </td>
                          )}
                          {showReAbandonedCols && (
                            <td><CartDiffBadge diff={c.abandonment?.recoveryCartDiff} /></td>
                          )}

                          <td className="rem-td-date">{fmt.date(c.abandonment?.abandonedAt || c.updatedAt)}</td>

                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`rem-status rem-status--${status.type}`}>{status.label}</span>
                              {justSent && (
                                <span
                                  className="rem-status rem-status--just-sent"
                                  title={`Sent at ${fmt.date(emailResults[id]?.sentAt)}`}
                                >
                                  <CheckCircle style={{ fontSize: 11 }} /> Sent ✓
                                </span>
                              )}
                            </div>
                          </td>

                          {showActionCol && (
                            <td>
                              <SendButton
                                checkoutId={id}
                                status={status}
                                loading={!!emailLoading[id]}
                                sendError={emailErrors[id]}
                                justSent={justSent}
                                onSend={handleSend}
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

          {activeEntries.length > 100 && (
            <p className="rem-truncation-note">
              Showing 100 of {activeEntries.length} — use search to narrow results
            </p>
          )}

        </div>
      </div>
    </>
  );
}