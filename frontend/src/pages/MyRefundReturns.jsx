import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import {
  AssignmentReturn as ReturnIcon,
  MoneyOff as RefundIcon,
  ArrowBack,
  Inventory2 as BoxIcon,
  Schedule as PendingIcon,
  CheckCircleOutline as DoneIcon,
  CancelOutlined as CancelIcon,
  KeyboardArrowDown,
  InfoOutlined,
  Search as SearchIcon,
  Receipt as ReceiptIcon,
} from '@mui/icons-material';
import { getAllMyOrders } from '../features/cart/orderSlice';
import { cancelRefund } from '../features/refunds/refundSlice';
import { cancelReturn } from '../features/returns/returnSlice';
import Navbar from '../components/Navbar';
import '../pageStyles/MyRefundsReturns.css';

// ── Helpers ──────────────────────────────────────────────────
const fmt = {
  currency: (v) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(v || 0),
  date: (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  },
  relativeDate: (d) => {
    if (!d) return '—';
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  },
};

const STATUS_LABEL = {
  requested: 'Requested',
  approved: 'Approved',
  in_transit: 'In Transit',
  received: 'Received',
  inspected: 'Inspected',
  processing: 'Processing',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  failed: 'Failed',
  none: 'None',
};

const REASON_LABEL = {
  defective: 'Defective / Damaged',
  wrong_item: 'Wrong Item',
  not_as_described: 'Not as Described',
  changed_mind: 'Changed Mind',
  duplicate_order: 'Duplicate Order',
  late_delivery: 'Late Delivery',
  quality_issue: 'Quality Issue',
  other: 'Other',
};

// ── Sub-components ────────────────────────────────────────────

function StatusBadge({ status }) {
  const safeStatus = status || 'none';
  return (
    <span className={`mrr-status mrr-status--${safeStatus}`}>
      <span className="mrr-status-dot" />
      {STATUS_LABEL[safeStatus] || safeStatus}
    </span>
  );
}

function KPICard({ label, value, color, icon: Icon }) {
  return (
    <div className="mrr-kpi" style={{ '--kpi-color': color }}>
      <div className="mrr-kpi-icon" style={{ background: `${color}18`, color }}>
        <Icon style={{ fontSize: 18 }} />
      </div>
      <div className="mrr-kpi-label">{label}</div>
      <div className="mrr-kpi-value">{value}</div>
    </div>
  );
}

function TimelineDrawer({ timeline }) {
  const [open, setOpen] = useState(false);
  if (!timeline || timeline.length === 0) return null;

  return (
    <div className="mrr-timeline-wrap">
      <button
        className={`mrr-timeline-toggle ${open ? 'mrr-timeline-toggle--open' : ''}`}
        onClick={() => setOpen((p) => !p)}
        type="button"
      >
        <ReceiptIcon style={{ fontSize: 14 }} />
        {open ? 'Hide' : 'Show'} timeline ({timeline.length} events)
        <KeyboardArrowDown style={{ fontSize: 16 }} />
      </button>
      {open && (
        <div className="mrr-timeline">
          {[...timeline].reverse().map((item, i) => (
            <div className="mrr-tl-item" key={item._id || i}>
              <span className={`mrr-tl-dot ${i === 0 ? 'mrr-tl-dot--active' : ''}`} />
              <div className="mrr-tl-content">
                <div className="mrr-tl-label">{item.description || item.action}</div>
                <div className="mrr-tl-time">{fmt.relativeDate(item.performedAt || item.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({ order, type, onCancel, cancelling }) {
  const info = type === 'refund' ? order.refundInfo : order.returnInfo;
  if (!info) return null;

  const firstItem = order.orderItems?.[0];
  const imgSrc = firstItem?.image || firstItem?.product?.images?.[0]?.url;
  const productName =
    firstItem?.name || firstItem?.product?.name || 'Order Items';

  const itemCount = order.orderItems?.length || 0;
  const canCancel = info.status === 'requested';

  const amount =
    type === 'refund'
      ? info.requestedAmount || info.refundAmount
      : null;

  const timeline = info.timeline;

  return (
    <div className="mrr-card">
      <div className="mrr-card-top">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={productName}
            className="mrr-card-img"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        ) : (
          <div className="mrr-card-img-placeholder">
            <BoxIcon style={{ fontSize: 22 }} />
          </div>
        )}

        <div className="mrr-card-main">
          <div className="mrr-card-row1">
            <span className={`mrr-type-chip mrr-type-chip--${type}`}>
              {type === 'refund' ? (
                <RefundIcon style={{ fontSize: 11 }} />
              ) : (
                <ReturnIcon style={{ fontSize: 11 }} />
              )}
              {type === 'refund' ? 'Refund' : 'Return'}
            </span>
            <span className="mrr-order-id">
              Order #{String(order._id).slice(-8).toUpperCase()}
            </span>
          </div>

          <div className="mrr-card-title" title={productName}>
            {productName}
            {itemCount > 1 && (
              <span style={{ color: '#9CA3AF', fontWeight: 500, fontSize: 12 }}>
                {' '}+{itemCount - 1} more
              </span>
            )}
          </div>

          <div className="mrr-card-meta">
            <span className="mrr-card-meta-item">
              <PendingIcon style={{ fontSize: 13, color: '#9CA3AF' }} />
              Submitted {fmt.relativeDate(info.requestedAt)}
            </span>
            {info.completedAt && (
              <span className="mrr-card-meta-item">
                <DoneIcon style={{ fontSize: 13, color: '#22C55E' }} />
                Completed {fmt.date(info.completedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="mrr-card-right">
          <StatusBadge status={info.status} />
          {amount != null && (
            <span className={`mrr-amount ${type === 'refund' ? 'mrr-amount--refund' : ''}`}>
              {fmt.currency(amount)}
            </span>
          )}
        </div>
      </div>

      {/* Admin note banner */}
      {info.adminNote && (
        <div className="mrr-admin-note">
          <InfoOutlined style={{ fontSize: 15, color: '#92400E' }} />
          <span>
            <strong>Admin note: </strong>
            {info.adminNote}
          </span>
        </div>
      )}

      <div className="mrr-card-divider" />

      <div className="mrr-card-footer">
        <div className="mrr-card-footer-left">
          {info.reason && (
            <span className="mrr-reason-tag">
              {REASON_LABEL[info.reason] || info.reason}
            </span>
          )}
          {info.rmaNumber && (
            <span className="mrr-rma">
              RMA: <strong>{info.rmaNumber}</strong>
            </span>
          )}
        </div>

        <div className="mrr-card-footer-actions">
          <Link
            to={type === 'refund' ? `/order/${order._id}/refund` : `/order/${order._id}/return`}
            state={{ from: 'my-refunds-returns' }}
            className="mrr-btn mrr-btn--outline"
          >
            View {type === 'refund' ? 'Refund' : 'Return'}
          </Link>

          {canCancel && (
            <button
              type="button"
              className="mrr-btn mrr-btn--danger"
              onClick={() => onCancel(order._id, type)}
              disabled={cancelling === `${order._id}-${type}`}
            >
              <CancelIcon style={{ fontSize: 14 }} />
              {cancelling === `${order._id}-${type}` ? 'Cancelling…' : 'Cancel Request'}
            </button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <TimelineDrawer timeline={timeline} />
    </div>
  );
}

// ── Cancel Confirmation Modal ────────────────────────────────
function CancelModal({ target, onConfirm, onClose, loading }) {
  if (!target) return null;
  return (
    <div className="mrr-modal-overlay" onClick={onClose}>
      <div className="mrr-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="mrr-modal-title">Cancel {target.type} request?</h3>
        <p className="mrr-modal-sub">
          This will cancel your {target.type} request for order #
          {String(target.orderId).slice(-8).toUpperCase()}. This action
          cannot be undone.
        </p>
        <div className="mrr-modal-actions">
          <button
            type="button"
            className="mrr-btn mrr-btn--outline"
            onClick={onClose}
            disabled={loading}
          >
            Keep Request
          </button>
          <button
            type="button"
            className="mrr-btn mrr-btn--danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Cancelling…' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast ────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`mrr-toast mrr-toast--${toast.type}`}>
      {toast.type === 'success' ? (
        <DoneIcon style={{ fontSize: 16 }} />
      ) : (
        <CancelIcon style={{ fontSize: 16 }} />
      )}
      {toast.message}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function MyRefundsReturns() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { orders, loading } = useSelector((state) => state.order);

  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [toast, setToast] = useState(null);

  // Always fetch fresh on mount so cancellations from other pages are reflected
  useEffect(() => {
    dispatch(getAllMyOrders());
  }, [dispatch]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  // Build unified list from orders
  const allRequests = useMemo(() => {
    if (!orders) return [];
    const list = [];

    orders.forEach((order) => {
      if (order.refundInfo && order.refundInfo.status !== 'none') {
        list.push({ order, type: 'refund' });
      }
      if (order.returnInfo && order.returnInfo.status !== 'none') {
        list.push({ order, type: 'return' });
      }
    });

    // Sort by most recent request date
    list.sort((a, b) => {
      const aDate = a.type === 'refund'
        ? a.order.refundInfo?.requestedAt
        : a.order.returnInfo?.requestedAt;
      const bDate = b.type === 'refund'
        ? b.order.refundInfo?.requestedAt
        : b.order.returnInfo?.requestedAt;
      return new Date(bDate) - new Date(aDate);
    });

    return list;
  }, [orders]);

  // KPI counts
  const stats = useMemo(() => {
    const total = allRequests.length;
    const pending = allRequests.filter(({ order, type }) => {
      const info = type === 'refund' ? order.refundInfo : order.returnInfo;
      return ['requested', 'approved', 'in_transit', 'received', 'inspected', 'processing'].includes(info?.status);
    }).length;
    const completed = allRequests.filter(({ order, type }) => {
      const info = type === 'refund' ? order.refundInfo : order.returnInfo;
      return info?.status === 'completed';
    }).length;
    const refunds = allRequests.filter((r) => r.type === 'refund').length;
    const returns = allRequests.filter((r) => r.type === 'return').length;
    return { total, pending, completed, refunds, returns };
  }, [allRequests]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = allRequests;

    if (activeTab === 'refunds') {
      list = list.filter((r) => r.type === 'refund');
    } else if (activeTab === 'returns') {
      list = list.filter((r) => r.type === 'return');
    } else if (activeTab === 'pending') {
      list = list.filter(({ order, type }) => {
        const info = type === 'refund' ? order.refundInfo : order.returnInfo;
        return ['requested', 'approved', 'in_transit', 'received', 'inspected', 'processing'].includes(info?.status);
      });
    } else if (activeTab === 'completed') {
      list = list.filter(({ order, type }) => {
        const info = type === 'refund' ? order.refundInfo : order.returnInfo;
        return ['completed', 'rejected', 'cancelled', 'failed'].includes(info?.status);
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(({ order, type }) => {
        const info = type === 'refund' ? order.refundInfo : order.returnInfo;
        return (
          order._id.toLowerCase().includes(q) ||
          (info?.reason || '').toLowerCase().includes(q) ||
          (info?.rmaNumber || '').toLowerCase().includes(q) ||
          order.orderItems?.some((item) =>
            (item.name || item.product?.name || '').toLowerCase().includes(q)
          )
        );
      });
    }

    return list;
  }, [allRequests, activeTab, search]);

  // Cancel handlers
  const handleCancelClick = useCallback((orderId, type) => {
    setCancelTarget({ orderId, type });
  }, []);

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelTarget) return;
    const { orderId, type } = cancelTarget;
    const key = `${orderId}-${type}`;
    setCancelling(key);

    try {
      if (type === 'refund') {
        await dispatch(cancelRefund(orderId)).unwrap();
      } else {
        await dispatch(cancelReturn(orderId)).unwrap();
      }

      showToast('Request cancelled successfully', 'success');
      dispatch(getAllMyOrders());
    } catch (err) {
      showToast(err?.message || err || 'Something went wrong', 'error');
    } finally {
      setCancelling(null);
      setCancelTarget(null);
    }
  }, [cancelTarget, dispatch, showToast]);

  const TABS = [
    { key: 'all', label: 'All' },
    { key: 'refunds', label: 'Refunds' },
    { key: 'returns', label: 'Returns' },
    { key: 'pending', label: 'Pending' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <>
      <Navbar />
      <div className="mrr-page">
        <div className="mrr-body">

          {/* Back */}
          <button
            type="button"
            className="mrr-back-btn"
            onClick={() => navigate(-1)}
          >
            <ArrowBack style={{ fontSize: 15 }} />
            Back
          </button>

          {/* Header */}
          <div className="mrr-hd">
            <div className="mrr-hd-left">
              <span
                className="mrr-hd-icon"
                style={{ background: '#FFF7ED', color: '#C2410C' }}
              >
                <ReturnIcon style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="mrr-hd-title">My Refunds & Returns</h1>
                <p className="mrr-hd-sub">Track and manage your refund and return requests</p>
              </div>
            </div>
          </div>

          {/* KPI Summary */}
          <div className="mrr-kpi-grid">
            <KPICard
              label="Total Requests"
              value={stats.total}
              color="#6366F1"
              icon={ReceiptIcon}
            />
            <KPICard
              label="Pending"
              value={stats.pending}
              color="#F59E0B"
              icon={PendingIcon}
            />
            <KPICard
              label="Completed"
              value={stats.completed}
              color="#22C55E"
              icon={DoneIcon}
            />
            <KPICard
              label="Refunds"
              value={stats.refunds}
              color="#3B82F6"
              icon={RefundIcon}
            />
            <KPICard
              label="Returns"
              value={stats.returns}
              color="#C2410C"
              icon={ReturnIcon}
            />
          </div>

          {/* Section label */}
          <div className="mrr-section">
            <span className="mrr-section-text">Your Requests</span>
            <span className="mrr-section-line" />
          </div>

          {/* Filter bar */}
          <div className="mrr-filter-bar">
            <div className="mrr-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`mrr-tab ${activeTab === tab.key ? 'mrr-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span className="mrr-filter-spacer" />

            <div className="mrr-search-wrap">
              <span className="mrr-search-icon">
                <SearchIcon style={{ fontSize: 15 }} />
              </span>
              <input
                type="text"
                className="mrr-search-input"
                placeholder="Search requests…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="mrr-loading">
              <div className="mrr-spinner" />
              <span>Loading your requests…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mrr-empty">
              <div className="mrr-empty-icon">
                <ReturnIcon style={{ fontSize: 30 }} />
              </div>
              <p className="mrr-empty-title">
                {search
                  ? 'No results found'
                  : activeTab !== 'all'
                  ? `No ${activeTab} requests`
                  : 'No refund or return requests yet'}
              </p>
              <p className="mrr-empty-sub">
                {search
                  ? 'Try a different search term.'
                  : 'When you submit a refund or return request, it will appear here.'}
              </p>
              {!search && (
                <Link to="/orders/user" className="mrr-btn mrr-btn--primary" style={{ marginTop: 8 }}>
                  View My Orders
                </Link>
              )}
            </div>
          ) : (
            <div className="mrr-list">
              {filtered.map(({ order, type }) => (
                <RequestCard
                  key={`${order._id}-${type}`}
                  order={order}
                  type={type}
                  onCancel={handleCancelClick}
                  cancelling={cancelling}
                />
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Cancel Modal */}
      <CancelModal
        target={cancelTarget}
        onConfirm={handleCancelConfirm}
        onClose={() => setCancelTarget(null)}
        loading={!!cancelling}
      />

      {/* Toast */}
      <Toast toast={toast} />
    </>
  );
}