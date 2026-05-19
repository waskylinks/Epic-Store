/**
 * frontend/src/pages/admin/UserEventTracePage.jsx
 *
 * User Event Trace — Phase 8 Observability
 * Route: /admin/analytics/user-trace
 */

import React, { useState, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  ArrowBack, Search, ErrorOutline, PersonSearch,
  TrackChanges, CheckCircle, Warning, Fingerprint,
  ShoppingCart, Campaign, Timeline, InfoOutlined,
} from '@mui/icons-material';
import {
  fetchUserEventTrace,
  selectUserTrace,
  selectTraceLoading,
  selectTraceError,
  clearTrace,
} from '../features/analytics/analyticsObservabilitySlice';
import Navbar from '../components/Navbar';
import '../AdminStyles/UserEventTrace.css';

const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(v || 0),
  date: (d) =>
    d ? new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) : '—',
  shortDate: (d) =>
    d ? new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }) : '—',
};

const CONF_COLOR = { HIGH: '#10B981', MEDIUM: '#F59E0B', LOW: '#EF4444' };
const CONF_BG    = { HIGH: '#F0FDF4', MEDIUM: '#FFFBEB', LOW: '#FEF2F2' };

function ConfidenceBadge({ level, score }) {
  const color = CONF_COLOR[level] || '#9CA3AF';
  const bg    = CONF_BG[level]    || '#F3F4F6';
  return (
    <span className="uet-conf-badge" style={{ color, background: bg }}>
      {level || '—'}
      {score != null && <span className="uet-conf-score"> {score.toFixed(2)}</span>}
    </span>
  );
}

function StatusPill({ status }) {
  const map = {
    completed:   { cls: 'uet-pill--ok',      label: 'completed' },
    failed:      { cls: 'uet-pill--warn',     label: 'failed' },
    dead_letter: { cls: 'uet-pill--dead',     label: 'dead_letter' },
    pending:     { cls: 'uet-pill--pending',  label: 'pending' },
    processing:  { cls: 'uet-pill--info',     label: 'processing' },
  };
  const m = map[status] || { cls: 'uet-pill--muted', label: status || '—' };
  return <span className={`uet-pill ${m.cls}`}>{m.label}</span>;
}

function OrderTimelineCard({ order, index }) {
  const attr  = order.attribution || {};
  const level = attr.confidenceLevel;
  const color = CONF_COLOR[level] || '#9CA3AF';

  return (
    <div className="uet-order-card">
      <div className="uet-timeline-col">
        <div className="uet-timeline-dot" style={{ borderColor: color, background: `${color}20` }}>
          <ShoppingCart style={{ fontSize: 12, color }} />
        </div>
        <div className="uet-timeline-line" />
      </div>

      <div className="uet-order-content">
        <div className="uet-order-top">
          <div className="uet-order-meta">
            <span className="uet-order-num">Order #{index + 1}</span>
            <span className="uet-order-date">{fmt.shortDate(order.createdAt)}</span>
          </div>
          <div className="uet-order-revenue">{fmt.currency(order.revenue)}</div>
        </div>

        <div className="uet-order-attr">
          <div className="uet-attr-grid">
            <div className="uet-attr-item">
              <span className="uet-attr-label">Source</span>
              <span className="uet-attr-val uet-attr-val--bold">{attr.source || 'direct'}</span>
            </div>
            <div className="uet-attr-item">
              <span className="uet-attr-label">Medium</span>
              <span className="uet-attr-val">{attr.medium || '—'}</span>
            </div>
            <div className="uet-attr-item">
              <span className="uet-attr-label">Campaign</span>
              <span className="uet-attr-val">{attr.campaign || '—'}</span>
            </div>
            <div className="uet-attr-item">
              <span className="uet-attr-label">Confidence</span>
              <ConfidenceBadge level={attr.confidenceLevel} score={attr.confidenceScore} />
            </div>
            <div className="uet-attr-item">
              <span className="uet-attr-label">gclid</span>
              <span className="uet-attr-val uet-attr-val--mono">
                {attr.gclid ? `${attr.gclid.slice(0, 14)}…` : '—'}
              </span>
            </div>
            <div className="uet-attr-item">
              <span className="uet-attr-label">fbclid</span>
              <span className="uet-attr-val uet-attr-val--mono">
                {attr.fbclid ? `${attr.fbclid.slice(0, 14)}…` : '—'}
              </span>
            </div>
          </div>

          <div className="uet-order-flags">
            {attr.isReconstructed && (
              <span className="uet-flag uet-flag--reconstructed" title={`Rule: ${attr.reconstructionRule}`}>
                Reconstructed · {attr.reconstructionRule}
              </span>
            )}
            {attr.anonymousId && (
              <span className="uet-flag uet-flag--stitched" title={attr.anonymousId}>
                <Fingerprint style={{ fontSize: 10 }} /> Stitched
              </span>
            )}
            {attr.eventId && (
              <span className="uet-flag uet-flag--event" title={attr.eventId}>
                <Timeline style={{ fontSize: 10 }} /> {attr.eventId.slice(0, 12)}…
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UserEventTracePage() {
  const dispatch = useDispatch();
  const trace    = useSelector(selectUserTrace);
  const loading  = useSelector(selectTraceLoading);
  const error    = useSelector(selectTraceError);

  const [userId,    setUserId]    = useState('');
  const [submitted, setSubmitted] = useState(false);
  const loadRef = useRef(false);

  const handleSearch = useCallback(() => {
    const trimmed = userId.trim();
    if (!trimmed || loadRef.current) return;
    loadRef.current = true;
    setSubmitted(true);
    dispatch(clearTrace());
    dispatch(fetchUserEventTrace(trimmed)).finally(() => { loadRef.current = false; });
  }, [dispatch, userId]);

  const orders      = trace?.orders      || [];
  const queueEvents = trace?.queueEvents || [];
  const summary     = trace?.summary     || {};
  const anonIds     = summary.anonymousIds || [];
  const confLevels  = summary.confidenceLevels || {};

  return (
    <>
      <Navbar />
      <div className="uet-page">
        <div className="uet-body">

          <Link to="/admin/dashboard" className="uet-back">
            <ArrowBack style={{ fontSize: 16 }} /> Dashboard
          </Link>

          <div className="uet-hd">
            <div className="uet-hd-left">
              <span className="uet-hd-icon"><PersonSearch style={{ fontSize: 26 }} /></span>
              <div>
                <div className="uet-hd-eyebrow">Analytics Observability</div>
                <h1 className="uet-hd-title">User Event Trace</h1>
                <p className="uet-hd-sub">Attribution history, identity stitching audit, and queue events per user</p>
              </div>
            </div>
            <div className="uet-hd-right">
              <Link to="/admin/analytics/health"  className="uet-nav-pill">Health</Link>
              <Link to="/admin/analytics/drift"   className="uet-nav-pill">Drift</Link>
              <Link to="/admin/analytics/queue"   className="uet-nav-pill">Queue Health</Link>
            </div>
          </div>

          {/* Search */}
          <div className="uet-search-card">
            <div className="uet-search-label">
              <Search style={{ fontSize: 16, color: '#6366F1' }} />
              Search by MongoDB User ID
            </div>
            <div className="uet-search-row">
              <input
                className="uet-search-input"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="64a1b2c3d4e5f6789012345a"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="uet-search-btn"
                onClick={handleSearch}
                disabled={!userId.trim() || loading}
              >
                {loading
                  ? <><span className="uet-search-spinner" />Searching…</>
                  : <><Search style={{ fontSize: 15 }} />Trace User</>
                }
              </button>
            </div>
            <div className="uet-search-hint">
              Find the ID in MongoDB: <code className="uet-code">db.users.findOne({'{'}_id: 1{'}'})._id</code>
            </div>
          </div>

          {error && <div className="uet-error"><ErrorOutline style={{ fontSize: 16 }} />{error}</div>}

          {submitted && !loading && !trace && !error && (
            <div className="uet-empty">
              <PersonSearch style={{ fontSize: 44, color: '#D1D5DB' }} />
              <p>No data found for this user ID.</p>
              <p className="uet-empty-sub">Check the ID is correct and the user has placed at least one order.</p>
            </div>
          )}

          {trace && (
            <>
              {/* Summary strip */}
              <div className="uet-summary-strip">
                {[
                  { icon: <ShoppingCart style={{ fontSize: 18 }} />, label: 'Total Orders',      val: summary.totalOrders ?? 0,   color: '#6366F1' },
                  { icon: <CheckCircle  style={{ fontSize: 18 }} />, label: 'HIGH Confidence',   val: confLevels.HIGH ?? 0,        color: '#10B981' },
                  { icon: <Warning      style={{ fontSize: 18 }} />, label: 'MEDIUM Confidence', val: confLevels.MEDIUM ?? 0,      color: '#F59E0B' },
                  { icon: <ErrorOutline style={{ fontSize: 18 }} />, label: 'LOW Confidence',    val: confLevels.LOW ?? 0,         color: '#EF4444' },
                  { icon: <Fingerprint  style={{ fontSize: 18 }} />, label: 'Anonymous IDs',     val: anonIds.length,              color: '#8B5CF6' },
                  { icon: <Campaign     style={{ fontSize: 18 }} />, label: 'Sources Seen',      val: (summary.sources||[]).length, color: '#06B6D4' },
                ].map(({ icon, label, val, color }) => (
                  <div key={label} className="uet-sum-card">
                    <div className="uet-sum-icon" style={{ background: `${color}15`, color }}>{icon}</div>
                    <div className="uet-sum-label">{label}</div>
                    <div className="uet-sum-val" style={{ color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Sources */}
              {(summary.sources||[]).length > 0 && (
                <div className="uet-sources-row">
                  <span className="uet-sources-label">Attribution sources:</span>
                  {(summary.sources||[]).map(s => (
                    <span key={s} className="uet-source-chip">{s}</span>
                  ))}
                </div>
              )}

              {/* Anonymous IDs */}
              {anonIds.length > 0 && (
                <div className="uet-anon-panel">
                  <div className="uet-anon-hd">
                    <Fingerprint style={{ fontSize: 16, color: '#8B5CF6' }} />
                    <span>{anonIds.length} Anonymous ID{anonIds.length !== 1 ? 's' : ''} linked to this account</span>
                  </div>
                  <div className="uet-anon-ids">
                    {anonIds.map(id => <code key={id} className="uet-anon-id">{id}</code>)}
                  </div>
                  <div className="uet-anon-note">
                    <InfoOutlined style={{ fontSize: 13 }} />
                    Each ID represents a browser session linked after login. Pre-login activity from these sessions is attributed to this user in BigQuery.
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div className="uet-section">
                <span className="uet-section-text">
                  Order Attribution Timeline
                  <span className="uet-section-badge">{orders.length}</span>
                </span>
                <span className="uet-section-line" />
              </div>

              {orders.length === 0 ? (
                <div className="uet-no-orders">
                  <ShoppingCart style={{ fontSize: 28, color: '#D1D5DB' }} />
                  <span>No orders found for this user</span>
                </div>
              ) : (
                <div className="uet-timeline">
                  {orders.map((order, i) => (
                    <OrderTimelineCard key={order.orderId || i} order={order} index={i} />
                  ))}
                  <div className="uet-timeline-end">
                    <div className="uet-timeline-end-dot" />
                    <span>End of order history</span>
                  </div>
                </div>
              )}

              {/* Queue events */}
              <div className="uet-section" style={{ marginTop: 28 }}>
                <span className="uet-section-text">
                  Analytics Queue Events
                  <span className="uet-section-badge">{queueEvents.length}</span>
                </span>
                <span className="uet-section-line" />
              </div>

              <div className="uet-card">
                <div className="uet-card-body">
                  {queueEvents.length === 0 ? (
                    <div className="uet-no-queue">
                      <TrackChanges style={{ fontSize: 28, color: '#D1D5DB' }} />
                      <span>No queue events found for this user</span>
                    </div>
                  ) : (
                    <div className="uet-tbl-wrap">
                      <table className="uet-tbl">
                        <thead>
                          <tr>
                            <th>Event ID</th><th>Type</th><th>Status</th>
                            <th>Attempts</th><th>Created</th><th>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queueEvents.map((ev, i) => (
                            <tr key={i}>
                              <td className="uet-td-id" title={ev.eventId}>{ev.eventId?.slice(0, 20)}…</td>
                              <td><span className="uet-type-pill">{ev.eventType}</span></td>
                              <td><StatusPill status={ev.status} /></td>
                              <td className="uet-td-attempts">{ev.attempts ?? 0}</td>
                              <td className="uet-td-date">{fmt.date(ev.createdAt)}</td>
                              <td className="uet-td-date">{fmt.date(ev.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Intro state */}
          {!submitted && (
            <div className="uet-intro">
              <div className="uet-intro-grid">
                {[
                  { icon: <ShoppingCart style={{ fontSize: 22, color: '#6366F1' }} />, bg: '#6366F115', title: 'Order Attribution History', body: 'View the full attribution context (source, medium, gclid, fbclid, confidence score) for every order.' },
                  { icon: <Fingerprint  style={{ fontSize: 22, color: '#8B5CF6' }} />, bg: '#8B5CF615', title: 'Identity Stitching Audit',   body: 'See all anonymous browser sessions linked to this account — confirms pre-login journeys are correctly attributed.' },
                  { icon: <TrackChanges style={{ fontSize: 22, color: '#10B981' }} />, bg: '#10B98115', title: 'Queue Event Trace',           body: 'View every analytics event queued for this user including GA4, Meta CAPI, and BigQuery dispatch status.' },
                  { icon: <Campaign     style={{ fontSize: 22, color: '#F59E0B' }} />, bg: '#F59E0B15', title: 'Confidence Score Breakdown',  body: 'See how many orders had HIGH, MEDIUM, or LOW attribution confidence. Identify mis-attributed users.' },
                ].map(({ icon, bg, title, body }) => (
                  <div key={title} className="uet-intro-card">
                    <span className="uet-intro-icon" style={{ background: bg }}>{icon}</span>
                    <div className="uet-intro-title">{title}</div>
                    <div className="uet-intro-body">{body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}