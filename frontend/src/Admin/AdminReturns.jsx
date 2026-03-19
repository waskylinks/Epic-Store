import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, Refresh, Visibility, CheckCircle, Cancel, Inventory,
  Assessment, Message, AttachFile, CloudUpload,
  Timeline as TimelineIcon, Description, Warning, Schedule,
  ChevronLeft, ChevronRight, ArrowBack, HourglassEmpty,
  ReportProblem, SwapHoriz, Discount, Gavel, RateReview,
  PendingActions, LocalShipping, ThumbUp,
} from '@mui/icons-material';
import {
  getAllReturns, getSingleReturn, reviewReturn, submitAdminPleaReview,
  generateDiscountCode, updateReturnStatus, sendReturnMessage,
  getReturnMessages, getReturnTimeline, getReturnDocuments,
  uploadReturnFiles, getReturnsWithUnreadMessages, clearCurrentReturn,
  clearAdminReturnState, clearReturnMessages, clearPendingAttachments,
} from '../features/admin/adminReturnSlice';
import ReturnMessagesModal from '../Orders/ReturnMessagesModal';
import Footer from '../components/footer';
import Navbar from '../components/Navbar';
import '../AdminStyles/AdminReturns.css';

// ── Debounce hook ────────────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// FIX: reads firstName+lastName first, falls back to name then email
const getCustomerName = (user) => {
  if (!user) return 'N/A';
  const first = user.firstName?.trim() ?? '';
  const last  = user.lastName?.trim()  ?? '';
  if (first || last) return [first, last].filter(Boolean).join(' ');
  return user.name?.trim() || user.email || 'N/A';
};

// FIX: reads shippingInfo first, then user.phoneNo
const getCustomerPhone = (order) => {
  if (!order) return 'N/A';
  const s = order.shippingInfo;
  if (s?.phoneNo) return s.phoneNo;
  if (s?.phone)   return s.phone;
  if (s?.mobile)  return s.mobile;
  const u = order.user;
  if (u?.phoneNo) return u.phoneNo;
  if (u?.phone)   return u.phone;
  return 'N/A';
};

const fmt         = (n) => (typeof n === 'number' ? n.toFixed(2) : '0.00');
const fmtCurrency = (n) => `$${fmt(typeof n === 'number' ? n : 0)}`;

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_COLOR = {
  requested: 'requested', items_reviewed: 'items_reviewed',
  plea_submitted: 'plea_submitted', awaiting_discount: 'awaiting_discount',
  approved: 'approved', in_transit: 'in_transit', received: 'received',
  inspected: 'inspected', completed: 'completed', rejected: 'rejected', cancelled: 'cancelled',
};

const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled']);

// FIX: Correct lifecycle — approved → in_transit → received → inspected → awaiting_discount → completed
const LIFECYCLE_STATUSES = ['approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed'];

// FIX: Correct NEXT_STATUS_MAP including awaiting_discount after inspected
const NEXT_STATUS_MAP = {
  approved:   ['in_transit'],
  in_transit: ['received'],
  received:   ['inspected'],
  inspected:  ['awaiting_discount'],
  // awaiting_discount → completed is handled by generate discount button, not dropdown
};

const DRAWER_TABS = ['overview', 'review', 'plea', 'status', 'timeline', 'documents'];

const STATUS_FILTERS = [
  { value: '',                  label: 'All'               },
  { value: 'requested',         label: 'Requested'         },
  { value: 'items_reviewed',    label: 'Items Reviewed'    },
  { value: 'plea_submitted',    label: 'Plea Submitted'    },
  { value: 'approved',          label: 'Approved'          },
  { value: 'in_transit',        label: 'In Transit'        },
  { value: 'received',          label: 'Received'          },
  { value: 'inspected',         label: 'Inspected'         },
  { value: 'awaiting_discount', label: 'Awaiting Discount' },
  { value: 'completed',         label: 'Completed'         },
  { value: 'rejected',          label: 'Rejected'          },
  { value: 'cancelled',         label: 'Cancelled'         },
];

const SORT_OPTIONS = [
  { value: 'requestedAt', label: 'Date Requested' },
  { value: 'totalPrice',  label: 'Order Total'    },
  { value: 'status',      label: 'Status'         },
];

const LIMIT = 20;

// ── CountdownTimer ───────────────────────────────────────────────────────────
const CountdownTimer = ({ deadline, label, expiredLabel = 'Expired' }) => {
  const [timeLeft, setTimeLeft] = useState(null);
  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => {
      const diff = new Date(deadline) - Date.now();
      if (diff <= 0) { setTimeLeft(null); return; }
      setTimeLeft({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  const isExpired = !timeLeft;
  return (
    <div className={`rt-countdown${isExpired ? ' rt-countdown--expired' : ''}`}>
      <Schedule style={{ fontSize: 14, flexShrink: 0 }} />
      {label && <span className="rt-countdown-label">{label}</span>}
      <span className="rt-countdown-value">
        {isExpired ? expiredLabel : `${timeLeft.d}d ${timeLeft.h}h ${timeLeft.m}m ${timeLeft.s}s`}
      </span>
    </div>
  );
};

// ── PerItemDecisionForm ──────────────────────────────────────────────────────
// FIX: lockedProductIds — approved items from first round are shown locked
// in the plea review tab. Clean slate for rejected items.
const PerItemDecisionForm = ({ items, decisions, onDecisionChange, disabled, lockedProductIds = new Set() }) => {
  if (!items?.length) return <div className="rt-empty" style={{ minHeight: 80 }}><span>No items to review</span></div>;

  return (
    <div className="rt-per-item-decisions">
      {items.map((item, idx) => {
        const pid      = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        const name     = item.product?.name ?? item.name ?? `Item ${idx + 1}`;
        const image    = item.product?.images?.[0]?.url ?? item.image ?? null;
        const dec      = decisions[pid] ?? { decision: '', rejectionReason: '' };
        const isLocked = lockedProductIds.has(pid);

        return (
          <div key={pid} className={`rt-item-decision-card${isLocked ? ' rt-item-decision-card--locked' : ''}`}>
            <div className="rt-item-decision-info">
              {image && <img src={image} alt={name} className="rt-item-decision-img" />}
              <div className="rt-item-decision-meta">
                <span className="rt-item-name">{name}</span>
                <span className="rt-item-meta">
                  Qty: {item.quantity ?? 1}{item.price ? ` · ${fmtCurrency(item.price)} ea` : ''}
                </span>
                {item.reason && <span className="rt-item-reason">{item.reason.replace(/_/g, ' ')}</span>}
                {isLocked && (
                  <span className="rt-item-locked-badge">
                    <CheckCircle style={{ fontSize: 11 }} /> Approved — locked
                  </span>
                )}
              </div>
            </div>

            {!isLocked && (
              <div className="rt-item-decision-controls">
                <button
                  type="button"
                  className={`rt-decision-btn rt-decision-btn--approve${dec.decision === 'approved' ? ' rt-decision-btn--active-approve' : ''}`}
                  onClick={() => onDecisionChange(pid, 'decision', 'approved')}
                  disabled={disabled}
                >
                  <CheckCircle style={{ fontSize: 14 }} /> Approve
                </button>
                <button
                  type="button"
                  className={`rt-decision-btn rt-decision-btn--reject${dec.decision === 'rejected' ? ' rt-decision-btn--active-reject' : ''}`}
                  onClick={() => onDecisionChange(pid, 'decision', 'rejected')}
                  disabled={disabled}
                >
                  <Cancel style={{ fontSize: 14 }} /> Reject
                </button>
              </div>
            )}

            {!isLocked && dec.decision === 'rejected' && (
              <div className="rt-item-rejection-reason">
                <input
                  type="text" className="rt-form-input"
                  placeholder="Rejection reason (required)…"
                  value={dec.rejectionReason ?? ''}
                  onChange={(e) => onDecisionChange(pid, 'rejectionReason', e.target.value)}
                  disabled={disabled} maxLength={500}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── PleaPreviewModal ─────────────────────────────────────────────────────────
// FIX: Admin must preview final plea decisions before submitting
const PleaPreviewModal = ({ items, decisions, adminNote, onConfirm, onCancel, loading }) => {
  const approved = items.filter((item, idx) => {
    const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
    return decisions[pid]?.decision === 'approved';
  });
  const rejected = items.filter((item, idx) => {
    const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
    return decisions[pid]?.decision === 'rejected';
  });

  return (
    <div className="rt-modal-overlay" onClick={onCancel} role="presentation">
      <div className="rt-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="rt-modal-hd">
          <h3>Review Final Decisions</h3>
          <button type="button" className="rt-drawer-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="rt-modal-body">
          <p className="rt-modal-intro">Please review your final plea decisions before submitting. This cannot be changed afterwards.</p>

          {approved.length > 0 && (
            <div className="rt-modal-decision-group rt-modal-approved">
              <div className="rt-modal-decision-group-hd">
                <CheckCircle style={{ fontSize: 14 }} />
                <span>Approved ({approved.length})</span>
              </div>
              {approved.map((item, i) => (
                <div key={i} className="rt-modal-item">
                  <span>{item.product?.name ?? item.name ?? `Item ${i + 1}`}</span>
                  <span className="rt-td-muted">×{item.quantity ?? 1}</span>
                </div>
              ))}
            </div>
          )}

          {rejected.length > 0 && (
            <div className="rt-modal-decision-group rt-modal-rejected">
              <div className="rt-modal-decision-group-hd">
                <Cancel style={{ fontSize: 14 }} />
                <span>Rejected ({rejected.length})</span>
              </div>
              {rejected.map((item, idx) => {
                const pid    = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
                const reason = decisions[pid]?.rejectionReason;
                return (
                  <div key={idx} className="rt-modal-item">
                    <span>{item.product?.name ?? item.name ?? `Item ${idx + 1}`}</span>
                    {reason && <span className="rt-td-muted rt-modal-reason">— {reason}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {adminNote && (
            <div className="rt-modal-note">
              <span className="rt-form-label">Your Note:</span>
              <p>{adminNote}</p>
            </div>
          )}
        </div>
        <div className="rt-modal-footer">
          <button type="button" className="rt-btn rt-btn--secondary" onClick={onCancel} disabled={loading}>Go Back</button>
          <button type="button" className="rt-btn rt-btn--primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Submitting…' : 'Confirm & Submit Final Decisions'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Component ────────────────────────────────────────────────────────────────
const AdminReturns = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const {
    returns, unreadReturns, stats, totalRequestedAmount, currentReturn,
    messages, messagesPage, hasMoreMessages, totalMessages, pendingAttachments,
    errorStage, timeline, documents, pagination, loading, returnsLoading,
    unreadLoading, messageSendLoading, messagesLoading, timelineLoading,
    documentsLoading, uploadLoading, pleaReviewLoading, discountCodeLoading,
    error, success, message: successMessage,
  } = useSelector((state) => state.adminReturn);

  const { currentPage, totalPages, totalReturns } = pagination;

  // Filters
  const [localPage,      setLocalPage]      = useState(1);
  const [filterStatus,   setFilterStatus]   = useState('');
  const [fromDate,       setFromDate]       = useState('');
  const [toDate,         setToDate]         = useState('');
  const [rmaSearch,      setRmaSearch]      = useState('');
  const [sortBy,         setSortBy]         = useState('requestedAt');
  const [sortOrder,      setSortOrder]      = useState('desc');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // Panel / modal
  const [selectedId,          setSelectedId]          = useState(null);
  const [showDetailPanel,     setShowDetailPanel]     = useState(false);
  const [showMessageModal,    setShowMessageModal]    = useState(false);
  const [showPleaPreview,     setShowPleaPreview]     = useState(false);
  const [activeTab,           setActiveTab]           = useState('overview');

  // Review tab
  const [itemDecisions, setItemDecisions] = useState({});
  const [adminNote,     setAdminNote]     = useState('');

  // Plea review tab
  const [pleaDecisions, setPleaDecisions] = useState({});
  const [pleaAdminNote, setPleaAdminNote] = useState('');

  // Status tab
  const [newStatus,       setNewStatus]       = useState('');
  const [inspectionNotes, setInspectionNotes] = useState('');

  const rmaDebounced = useDebounce(rmaSearch, 400);
  const filtersRef   = useRef({});
  filtersRef.current = { localPage, filterStatus, fromDate, toDate, rmaDebounced, sortBy, sortOrder, showUnreadOnly };

  const buildListParams = () => {
    const f = filtersRef.current;
    const p = { page: f.localPage, limit: LIMIT, sortBy: f.sortBy, order: f.sortOrder };
    if (f.filterStatus)        p.status = f.filterStatus;
    if (f.fromDate)            p.from   = f.fromDate;
    if (f.toDate)              p.to     = f.toDate;
    if (f.rmaDebounced.trim()) p.rma    = f.rmaDebounced.trim();
    return p;
  };

  const [fetchTick, setFetchTick] = useState(0);
  const triggerFetch = useCallback(() => setFetchTick((n) => n + 1), []);

  useEffect(() => {
    if (filtersRef.current.showUnreadOnly) dispatch(getReturnsWithUnreadMessages());
    else dispatch(getAllReturns(buildListParams()));
  }, [fetchTick, dispatch]);

  useEffect(() => { setLocalPage(1); triggerFetch(); }, [filterStatus, fromDate, toDate, rmaDebounced, sortBy, sortOrder, showUnreadOnly]);
  useEffect(() => { triggerFetch(); }, [localPage]);

  const handleFetchReturns = useCallback(() => triggerFetch(), [triggerFetch]);

  useEffect(() => {
    if (!success) return undefined;
    const t = setTimeout(() => dispatch(clearAdminReturnState()), 3000);
    return () => clearTimeout(t);
  }, [success, dispatch]);

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => dispatch(clearAdminReturnState()), 5000);
    return () => clearTimeout(t);
  }, [error, dispatch]);

  // Pre-populate next status when status tab opens
  useEffect(() => {
    if (activeTab === 'status' && currentReturn) {
      const current = currentReturn.returnInfo?.status;
      const options = NEXT_STATUS_MAP[current] ?? [];
      if (options.length === 1 && !newStatus) setNewStatus(options[0]);
    }
  }, [activeTab, currentReturn]);

  // Seed item decisions
  useEffect(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn) return;
    const items = currentReturn.returnInfo.itemsToReturn;

    setItemDecisions((prev) => {
      const next = { ...prev };
      items.forEach((item, idx) => {
        const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        if (!next[pid]) {
          next[pid] = { decision: item.adminDecision ?? '', rejectionReason: item.adminRejectionReason ?? '' };
        }
      });
      return next;
    });

    // FIX: Plea tab clean slate — approved items locked (pre-seeded), rejected items empty
    if (activeTab === 'plea') {
      const fresh = {};
      items.forEach((item, idx) => {
        const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        fresh[pid] = item.adminDecision === 'approved'
          ? { decision: 'approved', rejectionReason: '' }
          : { decision: '', rejectionReason: '' };
      });
      setPleaDecisions(fresh);
    }
  }, [currentReturn, activeTab]);

  // Derived
  const displayList  = showUnreadOnly ? unreadReturns : returns;
  const tableLoading = showUnreadOnly ? unreadLoading : returnsLoading;

  const hasUnreadByStatus = useMemo(() => {
    const map = { all: false };
    displayList.forEach((item) => {
      const count = item.unreadMessages ?? 0;
      if (count > 0) {
        map.all = true;
        const s = item.returnInfo?.status;
        if (s) map[s] = true;
      }
    });
    return map;
  }, [displayList]);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = [];
    const left  = Math.max(2, currentPage - 2);
    const right = Math.min(totalPages - 1, currentPage + 2);
    pages.push(1);
    if (left > 2) pages.push('...');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [totalPages, currentPage]);

  const validNextStatuses = useMemo(() => {
    if (!currentReturn) return [];
    return NEXT_STATUS_MAP[currentReturn.returnInfo?.status] ?? [];
  }, [currentReturn]);

  const reviewDecisionsComplete = useMemo(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn?.length) return false;
    return currentReturn.returnInfo.itemsToReturn.every((item, idx) => {
      const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const dec = itemDecisions[pid];
      return dec?.decision && !(dec.decision === 'rejected' && !dec.rejectionReason?.trim());
    });
  }, [currentReturn, itemDecisions]);

  // FIX: Plea decisions complete — locked items automatically satisfy the check
  const pleaDecisionsComplete = useMemo(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn?.length) return false;
    return currentReturn.returnInfo.itemsToReturn.every((item, idx) => {
      const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const dec = pleaDecisions[pid];
      return dec?.decision && !(dec.decision === 'rejected' && !dec.rejectionReason?.trim());
    });
  }, [currentReturn, pleaDecisions]);

  // FIX: Set of locked product IDs for plea review (approved in first round)
  const pleaLockedProductIds = useMemo(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn) return new Set();
    return new Set(
      currentReturn.returnInfo.itemsToReturn
        .filter((i) => i.adminDecision === 'approved')
        .map((item, idx) => item.product?._id?.toString() ?? item.product?.toString() ?? String(idx))
    );
  }, [currentReturn]);

  // Handlers
  const handlePageChange = useCallback((page) => {
    if (page < 1 || page > totalPages) return;
    setLocalPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [totalPages]);

  const handleViewReturn = useCallback(async (orderId) => {
    setSelectedId(orderId); setActiveTab('overview');
    setItemDecisions({}); setAdminNote('');
    setPleaDecisions({}); setPleaAdminNote('');
    setNewStatus(''); setInspectionNotes('');
    setShowDetailPanel(true);
    await dispatch(getSingleReturn(orderId));
    triggerFetch();
    dispatch(getReturnTimeline(orderId));
    dispatch(getReturnDocuments(orderId));
    dispatch(getReturnMessages({ orderId, page: 1 }));
  }, [dispatch, triggerFetch]);

  const handleOpenMessageModal = useCallback(async (orderId) => {
    setSelectedId(orderId);
    await dispatch(getSingleReturn(orderId));
    triggerFetch();
    dispatch(getReturnMessages({ orderId, page: 1 }));
    setShowMessageModal(true);
  }, [dispatch, triggerFetch]);

  const handleLoadMoreMessages = useCallback(() => {
    if (!selectedId || !hasMoreMessages || messagesLoading) return;
    dispatch(getReturnMessages({ orderId: selectedId, page: messagesPage + 1 }));
  }, [dispatch, selectedId, hasMoreMessages, messagesPage, messagesLoading]);

  const handleItemDecisionChange = useCallback((pid, field, value) =>
    setItemDecisions((p) => ({ ...p, [pid]: { ...p[pid], [field]: value } })), []);

  const handlePleaDecisionChange = useCallback((pid, field, value) =>
    setPleaDecisions((p) => ({ ...p, [pid]: { ...p[pid], [field]: value } })), []);

  const buildDecisionsArray = (decisionsMap, items) =>
    items.map((item, idx) => {
      const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const dec = decisionsMap[pid] ?? {};
      return { productId: pid, decision: dec.decision, rejectionReason: dec.rejectionReason ?? '' };
    });

  const handleReviewReturn = useCallback(async () => {
    if (!selectedId || !currentReturn?.returnInfo?.itemsToReturn) return;
    const decisionsArray = buildDecisionsArray(itemDecisions, currentReturn.returnInfo.itemsToReturn);
    try {
      await dispatch(reviewReturn({ orderId: selectedId, itemDecisions: decisionsArray, adminNote: adminNote || undefined })).unwrap();
      setItemDecisions({}); setAdminNote('');
      triggerFetch();
    } catch {}
  }, [dispatch, selectedId, currentReturn, itemDecisions, adminNote, triggerFetch]);

  // FIX: Show preview modal before submitting plea review
  const handlePleaReviewConfirm = useCallback(async () => {
    if (!selectedId || !currentReturn?.returnInfo?.itemsToReturn) return;
    const decisionsArray = buildDecisionsArray(pleaDecisions, currentReturn.returnInfo.itemsToReturn);
    try {
      await dispatch(submitAdminPleaReview({
        orderId: selectedId, itemDecisions: decisionsArray, adminNote: pleaAdminNote || undefined,
      })).unwrap();
      setPleaDecisions({}); setPleaAdminNote('');
      setShowPleaPreview(false);
      triggerFetch();
    } catch { setShowPleaPreview(false); }
  }, [dispatch, selectedId, currentReturn, pleaDecisions, pleaAdminNote, triggerFetch]);

  const handleGenerateDiscount = useCallback(async () => {
    if (!selectedId) return;
    try {
      const action = await dispatch(generateDiscountCode(selectedId)).unwrap();
      triggerFetch();
      navigate('/admin/discounts/new', {
        state: { fromReturn: true, returnData: action.returnDataForDiscount ?? action },
      });
    } catch {}
  }, [dispatch, selectedId, navigate, triggerFetch]);

  const handleUpdateStatus = useCallback(async () => {
    if (!newStatus || !selectedId) return;
    try {
      await dispatch(updateReturnStatus({
        orderId: selectedId, status: newStatus,
        inspectionNotes: newStatus === 'inspected' ? (inspectionNotes || undefined) : undefined,
      })).unwrap();
      setNewStatus(''); setInspectionNotes('');
      triggerFetch();
    } catch {}
  }, [dispatch, newStatus, inspectionNotes, selectedId, triggerFetch]);

  const handleSendMessage = useCallback(async (text, files, pendingUrls = []) => {
    if (!selectedId) return;
    await dispatch(sendReturnMessage({ orderId: selectedId, content: text, files: files ?? [], pendingUrls: pendingUrls ?? [] })).unwrap();
  }, [dispatch, selectedId]);

  const handleRetryMessage = useCallback(() => {
    if (!selectedId || !pendingAttachments.length) return;
    dispatch(sendReturnMessage({ orderId: selectedId, content: '', pendingUrls: pendingAttachments }));
  }, [dispatch, selectedId, pendingAttachments]);

  const handleFileUpload = useCallback(async (files) => {
    if (!selectedId) return;
    try {
      await dispatch(uploadReturnFiles({ orderId: selectedId, files })).unwrap();
      dispatch(getReturnDocuments(selectedId));
    } catch {}
  }, [dispatch, selectedId]);

  const handleCloseMessageModal = useCallback(() => {
    setShowMessageModal(false); dispatch(clearReturnMessages()); triggerFetch();
  }, [dispatch, triggerFetch]);

  const handleClosePanel = useCallback(() => {
    setShowDetailPanel(false); setShowMessageModal(false); setSelectedId(null);
    setActiveTab('overview'); setItemDecisions({}); setAdminNote('');
    setPleaDecisions({}); setPleaAdminNote('');
    setNewStatus(''); setInspectionNotes('');
    setShowPleaPreview(false);
    dispatch(clearCurrentReturn()); triggerFetch();
  }, [dispatch, triggerFetch]);

  // ── KPI cards ────────────────────────────────────────────────────────────
  // FIX: Removed "In Progress". Added correct flow-stage cards.
  // FIX: Restored revenue KPI. $0 fix is in product ID handling on submission.
  const renderKPICards = () => {
    if (!stats) {
      return Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rt-kpi" style={{ '--kpi-color': '#E5E7EB' }}>
          <div className="rt-kpi-top"><div className="rt-skel" style={{ width: 40, height: 40, borderRadius: 10 }} /></div>
          <div className="rt-skel" style={{ width: '55%', height: 11, marginBottom: 8 }} />
          <div className="rt-skel" style={{ width: '70%', height: 26 }} />
        </div>
      ));
    }
    const cards = [
      { label: 'Total Returns',     value: stats.total             ?? 0,     icon: Assessment,    color: '#6366F1', isCount: true  },
      { label: 'Pending Review',    value: stats.requested         ?? 0,     icon: Schedule,      color: '#F59E0B', isCount: true  },
      { label: 'Items Reviewed',    value: stats.items_reviewed    ?? 0,     icon: RateReview,    color: '#3B82F6', isCount: true  },
      { label: 'Plea Submitted',    value: stats.plea_submitted    ?? 0,     icon: Gavel,         color: '#8B5CF6', isCount: true  },
      { label: 'Awaiting Discount', value: stats.awaiting_discount ?? 0,     icon: PendingActions,color: '#F97316', isCount: true  },
      { label: 'Completed',         value: stats.completed         ?? 0,     icon: CheckCircle,   color: '#10B981', isCount: true  },
      { label: 'Rejected',          value: stats.rejected          ?? 0,     icon: Cancel,        color: '#EF4444', isCount: true  },
      // FIX: Restored revenue KPI
      { label: 'Total Requested',   value: typeof totalRequestedAmount === 'number' ? totalRequestedAmount : 0,
                                                                              icon: Discount,      color: '#0EA5E9', isCount: false },
    ];
    return cards.map((c) => (
      <div key={c.label} className="rt-kpi" style={{ '--kpi-color': c.color }}>
        <div className="rt-kpi-top">
          <span className="rt-kpi-icon" style={{ background: `${c.color}18`, color: c.color }}>
            <c.icon style={{ fontSize: 20 }} />
          </span>
        </div>
        <div className="rt-kpi-label">{c.label}</div>
        <div className="rt-kpi-value">
          {c.isCount ? c.value.toLocaleString() : fmtCurrency(c.value)}
        </div>
      </div>
    ));
  };

  // ── Table ─────────────────────────────────────────────────────────────────
  const renderTable = () => {
    if (tableLoading && !displayList.length) {
      return (
        <div style={{ padding: '20px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {Array.from({ length: 8 }).map((__, j) => <div key={j} className="rt-skel" style={{ height: 16, flex: 1 }} />)}
            </div>
          ))}
        </div>
      );
    }
    if (!tableLoading && !displayList.length) {
      return (
        <div className="rt-empty">
          <Inventory style={{ fontSize: 36, color: '#D1D5DB' }} />
          <span>{showUnreadOnly ? 'No returns with unread messages' : 'No return requests found'}</span>
        </div>
      );
    }
    return (
      <div className="rt-tbl-wrap">
        {tableLoading && displayList.length > 0 && <div className="rt-loading-bar" />}
        <table className="rt-tbl">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>RMA</th>
              {/* FIX: Restored Requested Amt column */}
              <th>Requested Amt</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Msgs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((item) => {
              const s        = item.returnInfo?.status ?? 'unknown';
              const orderRef = (item.orderId ?? item._id)?.toString().slice(-6).toUpperCase() ?? 'N/A';
              const rowId    = item.orderId ?? item._id;
              const unread   = item.unreadMessages ?? 0;
              return (
                <tr key={rowId}>
                  <td className="rt-td-name">#{orderRef}</td>
                  <td>{getCustomerName(item.user)}</td>
                  <td className="rt-td-mono">{item.returnInfo?.rmaNumber ?? '—'}</td>
                  {/* FIX: Restored requestedAmount in table */}
                  <td className="rt-td-money">{fmtCurrency(item.returnInfo?.requestedAmount ?? 0)}</td>
                  <td className="rt-td-reason">{item.returnInfo?.reason?.replace(/_/g, ' ') ?? 'N/A'}</td>
                  <td className="rt-td-muted">
                    {item.returnInfo?.requestedAt ? new Date(item.returnInfo.requestedAt).toLocaleDateString() : 'N/A'}
                  </td>
                  <td>
                    <span className={`rt-status rt-status--${STATUS_COLOR[s] ?? 'cancelled'}`}>
                      {s.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="rt-icon-btn" onClick={() => handleOpenMessageModal(rowId)} title="Open Messages">
                      <Message style={{ fontSize: 16 }} />
                      {unread > 0 && <span className="rt-msg-badge">{unread > 99 ? '99+' : unread}</span>}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="rt-icon-btn" onClick={() => handleViewReturn(rowId)} title="View Details">
                      <Visibility style={{ fontSize: 16 }} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderPagination = () => {
    if (showUnreadOnly || totalPages <= 1) return null;
    return (
      <div className="rt-pagination">
        <button type="button" className="rt-page-btn rt-page-btn--nav" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
          <ChevronLeft style={{ fontSize: 18 }} />
        </button>
        {pageNumbers.map((p, i) =>
          p === '...'
            ? <span key={`e${i}`} className="rt-page-ellipsis">…</span>
            : <button key={p} type="button" className={`rt-page-btn${currentPage === p ? ' rt-page-btn--active' : ''}`} onClick={() => handlePageChange(p)}>{p}</button>
        )}
        <button type="button" className="rt-page-btn rt-page-btn--nav" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>
          <ChevronRight style={{ fontSize: 18 }} />
        </button>
        <span className="rt-page-info">Page {currentPage} of {totalPages}</span>
      </div>
    );
  };

  const renderItemDecisionBadges = (returnInfo) => {
    const items    = returnInfo?.itemsToReturn ?? [];
    const reviewed = items.filter((i) => i.adminDecision);
    if (!reviewed.length) return null;
    return (
      <div className="rt-item-decision-badges">
        {items.map((item, idx) => {
          const pid  = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
          const name = item.product?.name ?? item.name ?? `Item ${idx + 1}`;
          const dec  = item.adminDecision;
          if (!dec) return null;
          return (
            <div key={pid} className={`rt-decision-badge rt-decision-badge--${dec}`}>
              {dec === 'approved' ? <CheckCircle style={{ fontSize: 13 }} /> : <Cancel style={{ fontSize: 13 }} />}
              <span>{name}</span>
              {dec === 'rejected' && item.adminRejectionReason && (
                <span className="rt-decision-badge-reason">— {item.adminRejectionReason}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Detail panel ──────────────────────────────────────────────────────────
  const renderDetailPanel = () => {
    if (!showDetailPanel) return null;

    if (!currentReturn) {
      return (
        <div className="rt-drawer-overlay" onClick={handleClosePanel} role="presentation">
          <div className="rt-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="rt-drawer-hd">
              <h2 className="rt-drawer-title">Loading…</h2>
              <button type="button" className="rt-drawer-close" onClick={handleClosePanel} aria-label="Close">×</button>
            </div>
            <div className="rt-drawer-body">
              <div className="rt-loading"><div className="rt-spinner" /><span>Fetching return…</span></div>
            </div>
          </div>
        </div>
      );
    }

    const returnInfo    = currentReturn.returnInfo ?? {};
    const retStatus     = returnInfo.status ?? 'unknown';
    const isTerminal    = TERMINAL_STATUSES.has(retStatus);
    const orderRef      = currentReturn._id?.toString().slice(-6).toUpperCase() ?? 'N/A';
    const rma           = returnInfo.rmaNumber ?? null;
    const approvedItems = (returnInfo.itemsToReturn ?? []).filter((i) => i.adminDecision === 'approved');

    // FIX: Plea tab only when status=plea_submitted
    const visibleTabs = DRAWER_TABS.filter((t) => t !== 'plea' || retStatus === 'plea_submitted');

    return (
      <div className="rt-drawer-overlay" onClick={handleClosePanel} role="presentation">
        <div className="rt-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rt-drawer-heading">
          <div className="rt-drawer-hd">
            <div className="rt-drawer-hd-info">
              <h2 className="rt-drawer-title" id="rt-drawer-heading">Return — #{orderRef}</h2>
              {rma && <span className="rt-rma-badge">RMA: {rma}</span>}
            </div>
            <button type="button" className="rt-drawer-close" onClick={handleClosePanel} aria-label="Close">×</button>
          </div>

          <div className="rt-drawer-tabs">
            <div className="rt-tf rt-drawer-tab-row">
              {visibleTabs.map((tab) => (
                <button
                  key={tab} type="button"
                  className={`rt-tf-btn${activeTab === tab ? ' rt-tf-btn--active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'plea' ? 'Plea Review' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="rt-drawer-body">

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <>
                <div className="rt-section"><span className="rt-section-text">Return Info</span><span className="rt-section-line" /></div>
                <div className="rt-card">
                  <div className="rt-card-body">
                    {/* FIX: name from firstName+lastName, phone from shippingInfo */}
                    {[
                      ['Customer',    getCustomerName(currentReturn.user)],
                      ['Email',       currentReturn.user?.email ?? 'N/A'],
                      ['Phone',       getCustomerPhone(currentReturn)],
                      ['Order Total', fmtCurrency(currentReturn.totalPrice)],
                      // FIX: Removed "Requested Amt" from overview — irrelevant
                      ['Reason',      returnInfo.reason?.replace(/_/g, ' ') ?? 'N/A'],
                    ].map(([label, val]) => (
                      <div key={label} className="rt-metric-row">
                        <span className="rt-metric-label">{label}</span>
                        <span className="rt-metric-val">{val}</span>
                      </div>
                    ))}

                    {/* FIX: Discount value — only show when post-review and > 0 */}
                    {['approved','in_transit','received','inspected','awaiting_discount','completed'].includes(retStatus)
                      && typeof returnInfo.discountValue === 'number'
                      && returnInfo.discountValue > 0 && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Discount Value</span>
                        <span className="rt-metric-val rt-td-money">{fmtCurrency(returnInfo.discountValue)}</span>
                      </div>
                    )}

                    <div className="rt-metric-row">
                      <span className="rt-metric-label">Status</span>
                      <span className={`rt-status rt-status--${STATUS_COLOR[retStatus] ?? 'cancelled'}`}>
                        {retStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="rt-metric-row">
                      <span className="rt-metric-label">Requested On</span>
                      <span className="rt-metric-val">
                        {returnInfo.requestedAt ? new Date(returnInfo.requestedAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    {returnInfo.adminNote && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Admin Note</span>
                        <span className="rt-metric-val">{returnInfo.adminNote}</span>
                      </div>
                    )}
                    {returnInfo.trackingNumber && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Tracking #</span>
                        <span className="rt-metric-val rt-td-mono">{returnInfo.trackingNumber}</span>
                      </div>
                    )}
                  </div>
                </div>

                {returnInfo.description && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Customer Description</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{returnInfo.description}</p>
                      </div>
                    </div>
                  </>
                )}

                {retStatus === 'items_reviewed' && returnInfo.itemsToReturn?.length > 0 && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Item Decisions</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        {renderItemDecisionBadges(returnInfo)}
                        {returnInfo.pleaDeadline && (
                          <div style={{ marginTop: 12 }}>
                            <CountdownTimer deadline={returnInfo.pleaDeadline} label="Customer plea window:" expiredLabel="Plea window closed" />
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {retStatus === 'plea_submitted' && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Plea Submitted</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        <div className="rt-plea-submitted-badge">
                          <Gavel style={{ fontSize: 15 }} />
                          <span>Customer has submitted a plea for reconsideration</span>
                        </div>
                        {returnInfo.pleaInfo?.pleaDescription && (
                          <p style={{ margin: '10px 0 0', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                            {returnInfo.pleaInfo.pleaDescription}
                          </p>
                        )}
                        {returnInfo.pleaDeadline && (
                          <div style={{ marginTop: 12 }}>
                            <CountdownTimer deadline={returnInfo.pleaDeadline} label="Admin response window:" expiredLabel="Response window closed" />
                          </div>
                        )}
                        {renderItemDecisionBadges(returnInfo)}
                      </div>
                    </div>
                  </>
                )}

                {returnInfo.inspectionNotes && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Inspection Notes</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{returnInfo.inspectionNotes}</p>
                      </div>
                    </div>
                  </>
                )}

                {!['items_reviewed', 'plea_submitted'].includes(retStatus) && returnInfo.itemsToReturn?.length > 0 && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Items to Return</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        {returnInfo.itemsToReturn.map((item, idx) => (
                          <div key={item.product?._id ?? idx} className="rt-item-row">
                            <div className="rt-item-info">
                              <span className="rt-item-name">{item.product?.name ?? `Item ${idx + 1}`}</span>
                              <span className="rt-item-meta">Qty: {item.quantity ?? 1}{item.condition ? ` · ${item.condition}` : ''}</span>
                            </div>
                            {item.reason && <span className="rt-item-reason">{item.reason.replace(/_/g, ' ')}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {currentReturn.orderItems?.length > 0 && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Order Items</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        {currentReturn.orderItems.map((item, idx) => (
                          <div key={item._id ?? idx} className="rt-item-row">
                            <div className="rt-item-info">
                              <span className="rt-item-name">{item.product?.name ?? `Item ${idx + 1}`}</span>
                              <span className="rt-item-meta">Qty: {item.quantity ?? 1} · {fmtCurrency(item.price ?? 0)} ea</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── REVIEW TAB ── */}
            {activeTab === 'review' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title">Review Return Request</h3>
                    <p className="rt-card-sub">Make a per-item approve / reject decision</p>
                  </div>
                </div>
                <div className="rt-card-body">
                  {retStatus !== 'requested' && (
                    <div className={`rt-info-banner rt-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                      {isTerminal ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} /> : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                      <span>This return is <strong>{retStatus.replace(/_/g, ' ')}</strong> and cannot be re-reviewed here.</span>
                    </div>
                  )}
                  {retStatus === 'requested' && (
                    <>
                      <PerItemDecisionForm
                        items={returnInfo.itemsToReturn ?? []} decisions={itemDecisions}
                        onDecisionChange={handleItemDecisionChange} disabled={loading}
                      />
                      <div className="rt-form-group" style={{ marginTop: 14 }}>
                        <label className="rt-form-label" htmlFor="rt-admin-note">Admin Note</label>
                        <textarea id="rt-admin-note" className="rt-form-textarea" rows={3} value={adminNote}
                          onChange={(e) => setAdminNote(e.target.value)} placeholder="Add a note for the customer…" disabled={loading}
                        />
                      </div>
                      <button type="button" className="rt-btn rt-btn--primary" onClick={handleReviewReturn}
                        disabled={loading || !reviewDecisionsComplete}
                        title={!reviewDecisionsComplete ? 'All items must have a decision' : ''}
                      >
                        {loading ? 'Processing…' : 'Submit Item Decisions'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── PLEA REVIEW TAB ── */}
            {activeTab === 'plea' && retStatus === 'plea_submitted' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title"><Gavel style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Plea Review</h3>
                    <p className="rt-card-sub">Second-round decisions — approved items are locked</p>
                  </div>
                </div>
                <div className="rt-card-body">
                  {returnInfo.pleaInfo?.pleaDescription && (
                    <div className="rt-plea-text-block">
                      <span className="rt-form-label">Customer Plea:</span>
                      <p>{returnInfo.pleaInfo.pleaDescription}</p>
                    </div>
                  )}
                  {returnInfo.pleaInfo?.pleaDocuments?.length > 0 && (
                    <div className="rt-plea-evidence">
                      <span className="rt-form-label">Submitted Evidence:</span>
                      <div className="rt-plea-evidence-grid">
                        {returnInfo.pleaInfo.pleaDocuments.map((doc, i) => (
                          <a key={doc._id ?? i} href={doc.url} target="_blank" rel="noopener noreferrer" className="rt-plea-evidence-thumb">
                            {doc.mimeType?.startsWith('image/') || doc.fileType === 'image'
                              ? <img src={doc.url} alt={doc.filename ?? 'Evidence'} />
                              : <div className="rt-plea-evidence-placeholder"><AttachFile style={{ fontSize: 20 }} /><span>{doc.filename ?? 'File'}</span></div>}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {pleaLockedProductIds.size > 0 && (
                    <div className="rt-info-banner rt-info-banner--info" style={{ marginBottom: 12 }}>
                      <CheckCircle style={{ fontSize: 16, flexShrink: 0 }} />
                      <span>Previously <strong>approved items are locked</strong> and cannot be changed. Only rejected items need a new decision.</span>
                    </div>
                  )}

                  <div className="rt-section" style={{ margin: '14px 0 10px' }}>
                    <span className="rt-section-text">Second-Round Decisions</span>
                    <span className="rt-section-line" />
                  </div>

                  <PerItemDecisionForm
                    items={returnInfo.itemsToReturn ?? []} decisions={pleaDecisions}
                    onDecisionChange={handlePleaDecisionChange} disabled={pleaReviewLoading}
                    lockedProductIds={pleaLockedProductIds}
                  />

                  <div className="rt-form-group" style={{ marginTop: 14 }}>
                    <label className="rt-form-label" htmlFor="rt-plea-admin-note">Admin Note</label>
                    <textarea id="rt-plea-admin-note" className="rt-form-textarea" rows={3} value={pleaAdminNote}
                      onChange={(e) => setPleaAdminNote(e.target.value)} placeholder="Final note for the customer…" disabled={pleaReviewLoading}
                    />
                  </div>
                  {/* FIX: Show preview modal before confirming */}
                  <button type="button" className="rt-btn rt-btn--primary"
                    onClick={() => setShowPleaPreview(true)}
                    disabled={pleaReviewLoading || !pleaDecisionsComplete}
                    title={!pleaDecisionsComplete ? 'All items must have a decision' : ''}
                  >
                    Review & Submit Final Decisions
                  </button>
                </div>
              </div>
            )}

            {/* ── STATUS TAB ── */}
            {activeTab === 'status' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title"><SwapHoriz style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Update Status</h3>
                    <p className="rt-card-sub">Advance through the return lifecycle</p>
                  </div>
                </div>
                <div className="rt-card-body">
                  {/* Generate Discount button appears at 'inspected'. Clicking it calls
                      generateDiscountCode which transitions inspected → awaiting_discount.
                      At awaiting_discount, admin marks completed after discount is issued. */}
                  {retStatus === 'inspected' ? (
                    <>
                      <div className="rt-info-banner rt-info-banner--info">
                        <Discount style={{ fontSize: 16, flexShrink: 0 }} />
                        <span>Items inspected and verified. Generate a discount code for the customer's approved items.</span>
                      </div>
                      {approvedItems.length > 0 && (
                        <div className="rt-approved-summary">
                          <span className="rt-form-label">Approved Items:</span>
                          {approvedItems.map((item, idx) => {
                            const pid  = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
                            const name = item.product?.name ?? item.name ?? `Item ${idx + 1}`;
                            return (
                              <div key={pid} className="rt-approved-summary-item">
                                <CheckCircle style={{ fontSize: 13, color: '#10B981' }} />
                                <span>{name}</span>
                                <span className="rt-td-muted">×{item.quantity ?? 1}</span>
                                {item.price && <span className="rt-td-money">{fmtCurrency((item.price ?? 0) * (item.quantity ?? 1))}</span>}
                              </div>
                            );
                          })}
                          {typeof returnInfo.discountValue === 'number' && returnInfo.discountValue > 0 && (
                            <div className="rt-approved-summary-total">
                              <span>Total Discount Value:</span>
                              <strong className="rt-td-money">{fmtCurrency(returnInfo.discountValue)}</strong>
                            </div>
                          )}
                        </div>
                      )}
                      <button type="button" className="rt-btn rt-btn--generate-discount" onClick={handleGenerateDiscount} disabled={discountCodeLoading}>
                        <Discount style={{ fontSize: 16, marginRight: 6 }} />
                        {discountCodeLoading ? 'Generating…' : 'Generate Discount Code'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* FIX: Lifecycle bar now includes approved and awaiting_discount */}
                      <div className="rt-progress-row">
                        {LIFECYCLE_STATUSES.map((s, idx) => {
                          const currentIdx = LIFECYCLE_STATUSES.indexOf(retStatus);
                          const isPast     = idx < currentIdx;
                          const isCurrent  = s === retStatus;
                          return (
                            <React.Fragment key={s}>
                              <div className={`rt-progress-step${isCurrent ? ' rt-progress-step--current' : isPast ? ' rt-progress-step--done' : ''}`}>
                                <div className="rt-progress-dot" />
                                <span className="rt-progress-label">{s.replace(/_/g, ' ')}</span>
                              </div>
                              {idx < LIFECYCLE_STATUSES.length - 1 && (
                                <div className={`rt-progress-line${isPast || isCurrent ? ' rt-progress-line--done' : ''}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {validNextStatuses.length === 0 && (
                        <div className={`rt-info-banner rt-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                          {isTerminal ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} /> : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                          <span>
                            {isTerminal
                              ? `This return is ${retStatus.replace(/_/g, ' ')} — no further updates.`
                              : `Return must reach 'approved' status before the lifecycle can begin. Current: ${retStatus.replace(/_/g, ' ')}.`}
                          </span>
                        </div>
                      )}

                      {validNextStatuses.length > 0 && (
                        <>
                          <div className="rt-form-group">
                            <label className="rt-form-label" htmlFor="rt-new-status">Next Status *</label>
                            <select id="rt-new-status" className="rt-form-select" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} disabled={loading}>
                              <option value="">Select status</option>
                              {validNextStatuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                            </select>
                          </div>
                          {newStatus === 'inspected' && (
                            <div className="rt-form-group">
                              <label className="rt-form-label" htmlFor="rt-inspection-notes">Inspection Notes</label>
                              <textarea id="rt-inspection-notes" className="rt-form-textarea" rows={3} value={inspectionNotes}
                                onChange={(e) => setInspectionNotes(e.target.value)}
                                placeholder="Describe the condition of returned items…" disabled={loading}
                              />
                            </div>
                          )}
                          <button type="button" className="rt-btn rt-btn--primary" onClick={handleUpdateStatus} disabled={!newStatus || loading}>
                            {loading ? 'Updating…' : `Mark as ${newStatus.replace(/_/g, ' ') || '…'}`}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── TIMELINE TAB ── */}
            {activeTab === 'timeline' && (
              <div className="rt-card">
                <div className="rt-card-hd"><div><h3 className="rt-card-title"><TimelineIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Timeline</h3></div></div>
                <div className="rt-card-body">
                  {timelineLoading
                    ? <div className="rt-loading"><div className="rt-spinner" /><span>Loading…</span></div>
                    : timeline.length > 0
                    ? (
                      <div className="rt-timeline">
                        {timeline.map((ev, idx) => (
                          <div key={ev._id ?? idx} className="rt-timeline-item">
                            <div className="rt-timeline-dot" />
                            <div className="rt-timeline-content">
                              <div className="rt-tl-row">
                                <strong>{ev.title ?? ev.action ?? 'Event'}</strong>
                                <span className="rt-td-muted">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''}</span>
                              </div>
                              {ev.description && <p className="rt-tl-desc">{ev.description}</p>}
                              {ev.performedBy?.name && <p className="rt-tl-by">by {ev.performedBy.name}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                    : <div className="rt-empty" style={{ minHeight: 120 }}><TimelineIcon style={{ fontSize: 28, color: '#D1D5DB' }} /><span>No timeline events yet</span></div>}
                </div>
              </div>
            )}

            {/* ── DOCUMENTS TAB ── */}
            {activeTab === 'documents' && (
              <div className="rt-card">
                <div className="rt-card-hd"><div><h3 className="rt-card-title"><Description style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Documents</h3></div></div>
                <div className="rt-card-body">
                  <input type="file" multiple id="rt-file-upload" style={{ display: 'none' }} aria-label="Upload return documents"
                    onChange={(e) => { if (e.target.files?.length) { handleFileUpload(Array.from(e.target.files)); e.target.value = ''; } }}
                  />
                  <label htmlFor="rt-file-upload">
                    <div className="rt-upload-zone" role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}>
                      <CloudUpload className="rt-upload-icon" />
                      <p className="rt-upload-text">Click to upload documents</p>
                      <p className="rt-upload-hint">Max 8 files · Images, PDFs, Videos</p>
                    </div>
                  </label>
                  {uploadLoading && <div className="rt-loading" style={{ padding: '1rem' }}><div className="rt-spinner" /><span>Uploading…</span></div>}
                  {documentsLoading
                    ? <div className="rt-loading"><div className="rt-spinner" /><span>Loading documents…</span></div>
                    : documents.length > 0
                    ? (
                      <div className="rt-file-list">
                        {documents.map((doc, idx) => (
                          <div key={doc._id ?? idx} className="rt-file-item">
                            <div className="rt-file-info">
                              <AttachFile style={{ fontSize: 16 }} />
                              <span>{doc.filename ?? 'File'}</span>
                              {doc.fileSize && <span className="rt-file-size">{(doc.fileSize / 1024).toFixed(0)} KB</span>}
                            </div>
                            <a href={doc.url} download className="rt-btn rt-btn--ghost" target="_blank" rel="noopener noreferrer">Download</a>
                          </div>
                        ))}
                      </div>
                    )
                    : <div className="rt-empty" style={{ minHeight: 100 }}><Description style={{ fontSize: 28, color: '#D1D5DB' }} /><span>No documents uploaded yet</span></div>}
                </div>
              </div>
            )}
          </div>

          <div className="rt-drawer-footer">
            <button type="button" className="rt-btn rt-btn--primary" onClick={() => setShowMessageModal(true)}>
              <Message style={{ marginRight: 6, fontSize: 16 }} />
              Messages
              {currentReturn.returnInfo?.messages?.length > 0 && (
                <span className="rt-footer-msg-count">{currentReturn.returnInfo.messages.length}</span>
              )}
            </button>
            <button type="button" className="rt-btn rt-btn--secondary" onClick={handleClosePanel}>Close</button>
          </div>
        </div>

        {/* FIX: Plea preview modal */}
        {showPleaPreview && currentReturn && (
          <PleaPreviewModal
            items={currentReturn.returnInfo?.itemsToReturn ?? []}
            decisions={pleaDecisions}
            adminNote={pleaAdminNote}
            onConfirm={handlePleaReviewConfirm}
            onCancel={() => setShowPleaPreview(false)}
            loading={pleaReviewLoading}
          />
        )}
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="rt-page">
        <div className="rt-body">
          <Link to="/admin/dashboard" className="rt-back-btn"><ArrowBack style={{ fontSize: 15 }} />Dashboard</Link>

          <div className="rt-hd">
            <div className="rt-hd-left">
              <span className="rt-hd-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                <Inventory style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="rt-hd-title">Returns Management</h1>
                <p className="rt-hd-sub">Review, approve and process customer return requests</p>
              </div>
            </div>
            <div className="rt-hd-right">
              <button type="button"
                className={`rt-icon-btn${(returnsLoading || unreadLoading) ? ' rt-icon-btn--spin' : ''}`}
                onClick={handleFetchReturns} disabled={returnsLoading || unreadLoading} title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          <div className="rt-kpi-grid">{renderKPICards()}</div>

          <div className="rt-section"><span className="rt-section-text">Return Requests</span><span className="rt-section-line" /></div>

          <div className="rt-filters">
            <div className="rt-search-wrap">
              <Search className="rt-search-icon" style={{ fontSize: 16 }} />
              <input type="text" className="rt-search-input" placeholder="Search RMA number…" value={rmaSearch}
                onChange={(e) => setRmaSearch(e.target.value)} aria-label="Search by RMA number"
              />
            </div>
            <div className="rt-tf rt-filter-pills">
              {STATUS_FILTERS.map((opt) => (
                <button key={opt.value || 'all'} type="button"
                  className={`rt-tf-btn${filterStatus === opt.value ? ' rt-tf-btn--active' : ''}`}
                  onClick={() => setFilterStatus(opt.value)}
                >
                  {opt.label}
                  {hasUnreadByStatus[opt.value || 'all'] && <span className="rt-tab-dot" />}
                </button>
              ))}
            </div>
            <div className="rt-date-wrap">
              <input type="date" className="rt-date-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
              <span className="rt-date-sep">—</span>
              <input type="date" className="rt-date-input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
            </div>
            <div className="rt-sort-wrap">
              <select className="rt-form-select rt-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort by">
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="button" className="rt-icon-btn rt-sort-dir-btn" onClick={() => setSortOrder((o) => o === 'desc' ? 'asc' : 'desc')}>
                <span className={`rt-sort-arrow${sortOrder === 'asc' ? ' rt-sort-arrow--up' : ''}`}>↓</span>
              </button>
            </div>
            <div className="rt-toggle-wrap">
              <button type="button" role="switch" aria-checked={showUnreadOnly}
                className={`rt-toggle${showUnreadOnly ? ' rt-toggle--active' : ''}`}
                onClick={() => setShowUnreadOnly((v) => !v)} aria-label="Show unread only"
              >
                <span className="rt-toggle-knob" />
              </button>
              <span className="rt-toggle-label">Unread Only</span>
            </div>
          </div>

          {error && (
            <div className="rt-error-banner" role="alert">
              <Warning style={{ fontSize: 18, flexShrink: 0 }} />
              <div><strong className="rt-error-title">Error</strong><p className="rt-error-msg">{error}</p></div>
            </div>
          )}

          {errorStage === 'send' && pendingAttachments.length > 0 && (
            <div className="rt-retry-banner" role="alert">
              <Warning style={{ fontSize: 16, flexShrink: 0 }} />
              <span className="rt-retry-msg">Files uploaded but message failed to send.</span>
              <div className="rt-retry-actions">
                <button type="button" className="rt-btn rt-btn--primary" onClick={handleRetryMessage} disabled={messageSendLoading}>
                  {messageSendLoading ? 'Retrying…' : 'Retry Send'}
                </button>
                <button type="button" className="rt-btn rt-btn--ghost" onClick={() => dispatch(clearPendingAttachments())}>Dismiss</button>
              </div>
            </div>
          )}

          <div className="rt-card">
            <div className="rt-card-hd">
              <div>
                <h3 className="rt-card-title">{showUnreadOnly ? 'Unread Returns' : 'All Returns'}</h3>
                <p className="rt-card-sub">
                  {returnsLoading || unreadLoading ? 'Loading…' : showUnreadOnly ? `${unreadReturns.length} with unread messages` : `${totalReturns} total`}
                </p>
              </div>
            </div>
            <div className="rt-card-body--np">
              {renderTable()}
              {renderPagination()}
            </div>
          </div>

          {success && successMessage && (
            <div className="rt-toast-wrap" role="status" aria-live="polite">
              <div className="rt-toast rt-toast--success">
                <CheckCircle style={{ fontSize: 18 }} />
                <div><strong>Success</strong><p>{successMessage}</p></div>
              </div>
            </div>
          )}
        </div>

        {renderDetailPanel()}

        {showMessageModal && currentReturn && (
          <ReturnMessagesModal
            isOpen={showMessageModal} onClose={handleCloseMessageModal}
            orderId={selectedId}
            orderInfo={{ orderNumber: currentReturn._id?.toString().slice(-6).toUpperCase() ?? '', customerName: getCustomerName(currentReturn.user) }}
            messages={messages} loading={messagesLoading}
            hasMoreMessages={hasMoreMessages} totalMessages={totalMessages}
            onSendMessage={handleSendMessage} onRefresh={() => dispatch(getReturnMessages({ orderId: selectedId, page: 1 }))}
            onLoadMore={handleLoadMoreMessages} pendingAttachments={pendingAttachments}
            errorStage={errorStage} onClearPending={() => dispatch(clearPendingAttachments())}
            currentUserRole="admin" isSendingExternal={messageSendLoading}
          />
        )}
      </div>
      <Footer />
    </>
  );
};

export default AdminReturns;