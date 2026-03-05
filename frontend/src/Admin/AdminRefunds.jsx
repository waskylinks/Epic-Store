import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Search, Refresh, Visibility, CheckCircle, Cancel, Inventory,
  Assessment, Message, AttachFile, CloudUpload,
  Timeline as TimelineIcon, Description, Warning, Schedule,
  ChevronLeft, ChevronRight, ArrowBack, HourglassEmpty, ReportProblem,
} from '@mui/icons-material';
import {
  getAllRefunds, getSingleRefund, reviewRefund, processRefund,
  sendRefundMessage,          
  getRefundMessages, getRefundTimeline, getRefundDocuments,
  uploadRefundFiles, getRefundsWithUnreadMessages,
  clearCurrentRefund, clearAdminRefundState, clearPendingAttachments, setPage,
} from '../features/admin/adminRefundSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import RefundReturnMessagesModal from '../Orders/RefundReturnMessagesModal';
import '../AdminStyles/AdminRefunds.css';

// ── Debounce hook (from AllOrders) ───────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
// FIX: controller populates user with firstName/lastName, not a name field.
const getCustomerName = (user) => {
  if (!user) return 'N/A';
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.email || 'N/A';
};

const STATUS_COLOR = {
  requested: 'requested', approved: 'approved', processing: 'processing',
  completed: 'completed', rejected: 'rejected', failed: 'failed', cancelled: 'cancelled',
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'rejected']);

const DRAWER_TABS = ['overview', 'review', 'process', 'timeline', 'documents'];

const STATUS_FILTERS = [
  { value: '',           label: 'All' },
  { value: 'requested',  label: 'Requested' },
  { value: 'approved',   label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed',  label: 'Completed' },
  { value: 'rejected',   label: 'Rejected' },
  { value: 'failed',     label: 'Failed' },
  { value: 'cancelled',  label: 'Cancelled' },
];

// ── Component ────────────────────────────────────────────────────────────────
const AdminRefunds = () => {
  const dispatch = useDispatch();

  const {
    refunds, unreadRefunds, stats, currentRefund,
    messages, messagesPage, hasMoreMessages, pendingAttachments, errorStage,
    timeline, documents, pagination,
    loading, refundsLoading, unreadLoading, messageSendLoading,
    messagesLoading, timelineLoading, documentsLoading, uploadLoading,
    error, success, message: successMessage,
  } = useSelector((state) => state.adminRefund);

  // FIX: currentPage/totalPages from Redux, not local frozen useState.
  const { currentPage, totalPages, totalRefunds } = pagination;

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchRaw,      setSearchRaw]      = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [startDate,      setStartDate]      = useState('');
  const [endDate,        setEndDate]        = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // ── Panel / modal state ───────────────────────────────────────────────────
  const [selectedId,       setSelectedId]       = useState(null);
  const [showDetailPanel,  setShowDetailPanel]  = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [activeTab,        setActiveTab]        = useState('overview');

  // ── Form state ────────────────────────────────────────────────────────────
  const [reviewAction, setReviewAction] = useState('');
  const [adminNote,    setAdminNote]    = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [merchantNote, setMerchantNote] = useState('');

  // FIX: debounce search — was firing on every keystroke.
  const searchTerm = useDebounce(searchRaw, 400);

  const LIMIT = 20;

  // ── Params builder ────────────────────────────────────────────────────────
  const buildListParams = useCallback(() => {
    const p = { page: currentPage, limit: LIMIT };
    if (filterStatus)      p.status    = filterStatus;
    if (startDate)         p.startDate = startDate;
    if (endDate)           p.endDate   = endDate;
    if (searchTerm.trim()) p.search    = searchTerm.trim();
    return p;
  }, [currentPage, filterStatus, startDate, endDate, searchTerm]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const handleFetchRefunds = useCallback(() => {
    if (showUnreadOnly) dispatch(getRefundsWithUnreadMessages());
    else                dispatch(getAllRefunds(buildListParams()));
  }, [dispatch, showUnreadOnly, buildListParams]);

  useEffect(() => { handleFetchRefunds(); }, [handleFetchRefunds]);

  // FIX: reset to page 1 on any filter change.
  useEffect(() => {
    dispatch(setPage(1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, startDate, endDate, searchTerm, showUnreadOnly]);

  // ── Toast auto-dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!success) return undefined;
    const t = setTimeout(() => dispatch(clearAdminRefundState()), 3000);
    return () => clearTimeout(t);
  }, [success, dispatch]);

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => dispatch(clearAdminRefundState()), 5000);
    return () => clearTimeout(t);
  }, [error, dispatch]);

  // FIX: pre-fill refund amount when process tab opens on an approved refund.
  useEffect(() => {
    if (
      activeTab === 'process' &&
      currentRefund?.refundInfo?.status === 'approved' &&
      !refundAmount
    ) {
      setRefundAmount(
        String(currentRefund.refundInfo.requestedAmount ?? currentRefund.amountPaid ?? '')
      );
    }
  }, [activeTab, currentRefund, refundAmount]);

  // ── Derived state ─────────────────────────────────────────────────────────
  // FIX: use the correct array depending on mode.
  const displayList = showUnreadOnly ? unreadRefunds : refunds;

  // Per-status unread awareness for tab dots.
  const hasUnreadByStatus = useMemo(() => {
    const map = { all: false };
    displayList.forEach((order) => {
      if ((order.unreadMessages ?? 0) > 0) {
        map.all = true;
        const s = order.refundInfo?.status;
        if (s) map[s] = true;
      }
    });
    return map;
  }, [displayList]);

  // FIX: ellipsis-aware pagination (from AllOrders).
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

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePageChange = useCallback((page) => {
    if (page < 1 || page > totalPages) return;
    dispatch(setPage(page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [dispatch, totalPages]);

  const fetchRefundDetails = useCallback(async (orderId) => {
    await dispatch(getSingleRefund(orderId));
    dispatch(getRefundTimeline(orderId));
    dispatch(getRefundDocuments(orderId));
    dispatch(getRefundMessages({ orderId, page: 1 }));
  }, [dispatch]);

  const handleViewRefund = useCallback(async (orderId) => {
    setSelectedId(orderId);
    setActiveTab('overview');
    setShowDetailPanel(true);
    await fetchRefundDetails(orderId);
  }, [fetchRefundDetails]);

  // FIX: await getSingleRefund before showing MessageModal so currentRefund
  // is never null when the modal mounts.
  const handleOpenMessageModal = useCallback(async (orderId) => {
    setSelectedId(orderId);
    await dispatch(getSingleRefund(orderId));
    dispatch(getRefundMessages({ orderId, page: 1 }));
    setShowMessageModal(true);
  }, [dispatch]);

  const handleLoadMoreMessages = useCallback(() => {
    if (!selectedId || !hasMoreMessages) return;
    dispatch(getRefundMessages({ orderId: selectedId, page: messagesPage + 1 }));
  }, [dispatch, selectedId, hasMoreMessages, messagesPage]);

  const handleReviewRefund = useCallback(async () => {
    if (!reviewAction || !selectedId) return;
    try {
      await dispatch(reviewRefund({ orderId: selectedId, action: reviewAction, adminNote })).unwrap();
      setReviewAction('');
      setAdminNote('');
      dispatch(getAllRefunds(buildListParams()));
    } catch (_) { /* error surfaced via slice → error banner */ }
  }, [dispatch, reviewAction, adminNote, selectedId, buildListParams]);

  const handleProcessRefund = useCallback(async () => {
    if (!refundAmount || !selectedId) return;
    try {
      await dispatch(processRefund({ orderId: selectedId, refundAmount: Number(refundAmount), merchantNote })).unwrap();
      setRefundAmount('');
      setMerchantNote('');
      dispatch(getAllRefunds(buildListParams()));
    } catch (_) { /* error surfaced via slice → error banner */ }
  }, [dispatch, refundAmount, merchantNote, selectedId, buildListParams]);

  // FIX: correct thunk name sendRefundMessage. No extra getRefundMessages after
  // send — slice appends optimistically, re-fetch would cause visible flicker.
  const handleSendMessage = useCallback(async (content, files) => {
    if (!selectedId) return;
    await dispatch(sendRefundMessage({ orderId: selectedId, message: content, files })).unwrap();
  }, [dispatch, selectedId]);

  const handleRetryMessage = useCallback(() => {
    if (!selectedId || !pendingAttachments.length) return;
    dispatch(sendRefundMessage({ orderId: selectedId, message: '', pendingUrls: pendingAttachments }));
  }, [dispatch, selectedId, pendingAttachments]);

  const handleFileUpload = useCallback(async (files) => {
    if (!selectedId) return;
    try {
      await dispatch(uploadRefundFiles({ orderId: selectedId, files })).unwrap();
      dispatch(getRefundDocuments(selectedId));
    } catch (_) { /* error surfaced via slice */ }
  }, [dispatch, selectedId]);

  // FIX: re-fetch list on modal close so unread badges update.
  const handleCloseMessageModal = useCallback(() => {
    setShowMessageModal(false);
    dispatch(getAllRefunds(buildListParams()));
  }, [dispatch, buildListParams]);

  const handleClosePanel = useCallback(() => {
    setShowDetailPanel(false);
    setShowMessageModal(false);
    setSelectedId(null);
    setActiveTab('overview');
    setReviewAction('');
    setAdminNote('');
    setRefundAmount('');
    setMerchantNote('');
    dispatch(clearCurrentRefund());
    dispatch(getAllRefunds(buildListParams()));
  }, [dispatch, buildListParams]);

  // FIX: onRefresh for MessageModal — reloads messages when modal re-opens.
  const handleModalRefresh = useCallback(() => {
    if (selectedId) dispatch(getRefundMessages({ orderId: selectedId, page: 1 }));
  }, [dispatch, selectedId]);

  // ── KPI Cards ─────────────────────────────────────────────────────────────
  const renderKPICards = () => {
    if (!stats) {
      return Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rf-kpi" style={{ '--kpi-color': '#E5E7EB' }}>
          <div className="rf-kpi-top">
            <div className="rf-skel" style={{ width: 40, height: 40, borderRadius: 10 }} />
            <div className="rf-skel" style={{ width: 52, height: 20 }} />
          </div>
          <div className="rf-skel" style={{ width: '55%', height: 12, marginBottom: 8 }} />
          <div className="rf-skel" style={{ width: '75%', height: 28 }} />
        </div>
      ));
    }
    const cards = [
      { label: 'Total Requests', value: stats.total     ?? 0, icon: Assessment,  color: '#6366F1' },
      { label: 'Pending Review', value: stats.requested ?? 0, icon: Schedule,    color: '#F59E0B' },
      { label: 'Approved',       value: stats.approved  ?? 0, icon: CheckCircle, color: '#10B981' },
      { label: 'Rejected',       value: stats.rejected  ?? 0, icon: Cancel,      color: '#EF4444' },
      { label: 'Completed',      value: stats.completed ?? 0, icon: Inventory,   color: '#3B82F6' },
    ];
    return cards.map((c) => (
      <div key={c.label} className="rf-kpi" style={{ '--kpi-color': c.color }}>
        <div className="rf-kpi-top">
          <span className="rf-kpi-icon" style={{ background: c.color + '18', color: c.color }}>
            <c.icon style={{ fontSize: 20 }} />
          </span>
        </div>
        <div className="rf-kpi-label">{c.label}</div>
        <div className="rf-kpi-value">{c.value.toLocaleString()}</div>
      </div>
    ));
  };

  // ── Table ─────────────────────────────────────────────────────────────────
  const renderTable = () => {
    const tableLoading = showUnreadOnly ? unreadLoading : refundsLoading;

    if (tableLoading && displayList.length === 0) {
      return (
        <div style={{ padding: '20px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {Array.from({ length: 6 }).map((__, j) => (
                <div key={j} className="rf-skel" style={{ height: 16, flex: 1 }} />
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (displayList.length === 0) {
      return (
        <div className="rf-empty">
          <Assessment style={{ fontSize: 36, color: '#D1D5DB' }} />
          <span>{showUnreadOnly ? 'No refunds with unread messages' : 'No refund requests found'}</span>
        </div>
      );
    }

    return (
      <div className="rf-tbl-wrap">
        {/* FIX: thin bar instead of full skeleton during pagination reloads. */}
        {tableLoading && displayList.length > 0 && <div className="rf-loading-bar" />}
        <table className="rf-tbl">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Msgs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((item) => {
              const status      = item.refundInfo?.status ?? 'unknown';
              const orderRef    = item._id ? item._id.toString().slice(-6).toUpperCase() : 'N/A';
              // FIX: use numeric count (normalised in slice), not just boolean.
              const unreadCount = item.unreadMessages ?? 0;
              return (
                <tr key={item._id}>
                  <td className="rf-td-name">#{orderRef}</td>
                  {/* FIX: getCustomerName uses firstName + lastName */}
                  <td>{getCustomerName(item.user)}</td>
                  <td className="rf-td-money">
                    ${(item.refundInfo?.requestedAmount ?? 0).toFixed(2)}
                  </td>
                  <td>{item.refundInfo?.reason?.replace(/_/g, ' ') ?? 'N/A'}</td>
                  <td>
                    {item.refundInfo?.requestedAt
                      ? new Date(item.refundInfo.requestedAt).toLocaleDateString()
                      : 'N/A'}
                  </td>
                  <td>
                    <span className={`rf-status rf-status--${STATUS_COLOR[status] ?? 'cancelled'}`}>
                      {status}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rf-icon-btn"
                      style={{ position: 'relative' }}
                      onClick={() => handleOpenMessageModal(item._id)}
                      title="Open Messages"
                    >
                      <Message style={{ fontSize: 16 }} />
                      {/* FIX: show actual count badge */}
                      {unreadCount > 0 && (
                        <span className="rf-msg-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                      )}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rf-icon-btn"
                      onClick={() => handleViewRefund(item._id)}
                      title="View Details"
                    >
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

  // ── Pagination ────────────────────────────────────────────────────────────
  const renderPagination = () => {
    if (showUnreadOnly || totalPages <= 1) return null;
    return (
      <div className="rf-pagination">
        <button type="button" className="rf-page-btn rf-page-btn--nav"
          onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} title="Previous">
          <ChevronLeft style={{ fontSize: 18 }} />
        </button>
        {pageNumbers.map((p, idx) =>
          p === '...'
            // eslint-disable-next-line react/no-array-index-key
            ? <span key={`e${idx}`} className="rf-page-ellipsis">…</span>
            : <button key={p} type="button"
                className={`rf-page-btn${currentPage === p ? ' rf-page-btn--active' : ''}`}
                onClick={() => handlePageChange(p)}>{p}</button>
        )}
        <button type="button" className="rf-page-btn rf-page-btn--nav"
          onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} title="Next">
          <ChevronRight style={{ fontSize: 18 }} />
        </button>
        <span className="rf-page-info">Page {currentPage} of {totalPages}</span>
      </div>
    );
  };

  // ── Detail Panel ──────────────────────────────────────────────────────────
  const renderDetailPanel = () => {
    if (!showDetailPanel) return null;

    if (!currentRefund) {
      return (
        <div className="rf-drawer-overlay" onClick={handleClosePanel} role="presentation">
          <div className="rf-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="rf-drawer-hd">
              <h2 className="rf-drawer-title">Loading…</h2>
              <button type="button" className="rf-drawer-close" onClick={handleClosePanel} aria-label="Close">×</button>
            </div>
            <div className="rf-drawer-body">
              <div className="rf-loading"><div className="rf-spinner" /><span>Fetching refund…</span></div>
            </div>
          </div>
        </div>
      );
    }

    const orderRef    = currentRefund._id ? currentRefund._id.toString().slice(-6).toUpperCase() : 'N/A';
    const refStatus   = currentRefund.refundInfo?.status ?? 'unknown';
    const isTerminal  = TERMINAL_STATUSES.has(refStatus);

    return (
      <div className="rf-drawer-overlay" onClick={handleClosePanel} role="presentation">
        <div className="rf-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rf-drawer-heading">

          <div className="rf-drawer-hd">
            <h2 className="rf-drawer-title" id="rf-drawer-heading">Refund — #{orderRef}</h2>
            <button type="button" className="rf-drawer-close" onClick={handleClosePanel} aria-label="Close panel">×</button>
          </div>

          {/* Scrollable tab nav */}
          <div className="rf-drawer-tabs">
            <div className="rf-tf">
              {DRAWER_TABS.map((tab) => (
                <button key={tab} type="button"
                  className={`rf-tf-btn${activeTab === tab ? ' rf-tf-btn--active' : ''}`}
                  onClick={() => setActiveTab(tab)}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="rf-drawer-body">

            {/* OVERVIEW */}
            {activeTab === 'overview' && (
              <>
                <div className="rf-section"><span className="rf-section-text">Refund Info</span><span className="rf-section-line" /></div>
                <div className="rf-card">
                  <div className="rf-card-body">
                    {[
                      ['Customer',        getCustomerName(currentRefund.user)],
                      ['Email',           currentRefund.user?.email ?? 'N/A'],
                      ['Order Total',     `$${(currentRefund.totalPrice ?? 0).toFixed(2)}`],
                      ['Amount Paid',     `$${(currentRefund.amountPaid ?? 0).toFixed(2)}`],
                      ['Requested Amt',   `$${(currentRefund.refundInfo?.requestedAmount ?? 0).toFixed(2)}`],
                      ['Refund Type',     currentRefund.refundInfo?.refundType === 'full' ? 'Full Refund' : 'Partial Refund'],
                      ['Reason',          currentRefund.refundInfo?.reason?.replace(/_/g, ' ') ?? 'N/A'],
                    ].map(([label, val]) => (
                      <div key={label} className="rf-metric-row">
                        <span className="rf-metric-label">{label}</span>
                        <span className="rf-metric-val">{val}</span>
                      </div>
                    ))}
                    <div className="rf-metric-row">
                      <span className="rf-metric-label">Status</span>
                      <span className={`rf-status rf-status--${STATUS_COLOR[refStatus] ?? 'cancelled'}`}>{refStatus}</span>
                    </div>
                    <div className="rf-metric-row">
                      <span className="rf-metric-label">Requested On</span>
                      <span className="rf-metric-val">
                        {currentRefund.refundInfo?.requestedAt ? new Date(currentRefund.refundInfo.requestedAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    {currentRefund.refundInfo?.adminNote && (
                      <div className="rf-metric-row">
                        <span className="rf-metric-label">Admin Note</span>
                        <span className="rf-metric-val">{currentRefund.refundInfo.adminNote}</span>
                      </div>
                    )}
                  </div>
                </div>

                {currentRefund.refundInfo?.description && (
                  <>
                    <div className="rf-section"><span className="rf-section-text">Customer Description</span><span className="rf-section-line" /></div>
                    <div className="rf-card">
                      <div className="rf-card-body">
                        <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{currentRefund.refundInfo.description}</p>
                      </div>
                    </div>
                  </>
                )}

                {(currentRefund.refundInfo?.refundAmount ?? 0) > 0 && (
                  <>
                    <div className="rf-section"><span className="rf-section-text">Refund Progress</span><span className="rf-section-line" /></div>
                    <div className="rf-card">
                      <div className="rf-card-body">
                        <div className="rf-bar-row">
                          <span className="rf-bar-label">Refunded</span>
                          <div className="rf-bar-track">
                            <div className="rf-bar-fill" style={{
                              width: `${Math.min(100, ((currentRefund.refundInfo.refundAmount ?? 0) / (currentRefund.amountPaid || 1)) * 100)}%`,
                              background: '#10B981',
                            }} />
                          </div>
                          <span className="rf-bar-val">${(currentRefund.refundInfo.refundAmount ?? 0).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* REVIEW */}
            {activeTab === 'review' && (
              <div className="rf-card">
                <div className="rf-card-hd">
                  <div><h3 className="rf-card-title">Review Refund Request</h3><p className="rf-card-sub">Approve or reject this refund</p></div>
                </div>
                <div className="rf-card-body">
                  {refStatus !== 'requested' && (
                    <div className={`rf-info-banner rf-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                      {isTerminal ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} /> : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                      <span>This refund is <strong>{refStatus}</strong> and cannot be re-reviewed.</span>
                    </div>
                  )}
                  <div className="rf-form-group">
                    <label className="rf-form-label" htmlFor="rf-review-action">Decision *</label>
                    <select id="rf-review-action" className="rf-form-select" value={reviewAction}
                      onChange={(e) => setReviewAction(e.target.value)} disabled={refStatus !== 'requested'}>
                      <option value="">Select action</option>
                      <option value="approve">Approve Refund</option>
                      <option value="reject">Reject Refund</option>
                    </select>
                  </div>
                  <div className="rf-form-group">
                    <label className="rf-form-label" htmlFor="rf-admin-note">Admin Note</label>
                    <textarea id="rf-admin-note" className="rf-form-textarea" rows={3} value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)} placeholder="Add a note for the customer…"
                      disabled={refStatus !== 'requested'} />
                  </div>
                  <button type="button"
                    className={`rf-btn ${reviewAction === 'approve' ? 'rf-btn--success' : 'rf-btn--danger'}`}
                    onClick={handleReviewRefund}
                    disabled={!reviewAction || loading || refStatus !== 'requested'}>
                    {loading ? 'Processing…' : reviewAction === 'approve' ? 'Approve Refund' : reviewAction === 'reject' ? 'Reject Refund' : 'Select an action'}
                  </button>
                </div>
              </div>
            )}

            {/* PROCESS */}
            {activeTab === 'process' && (
              <div className="rf-card">
                <div className="rf-card-hd">
                  <div><h3 className="rf-card-title">Process Refund Payment</h3><p className="rf-card-sub">Initiate the payment transfer</p></div>
                </div>
                <div className="rf-card-body">
                  {refStatus !== 'approved' && (
                    <div className={`rf-info-banner rf-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                      {isTerminal ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} /> : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                      <span>Refund must be <strong>approved</strong> before processing. Current: <strong>{refStatus}</strong>.</span>
                    </div>
                  )}
                  <div className="rf-form-group">
                    <label className="rf-form-label" htmlFor="rf-refund-amount">Refund Amount ($) *</label>
                    <input id="rf-refund-amount" type="number" className="rf-form-input" value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)} min="0.01" step="0.01"
                      // FIX: use refundableAmount not amountPaid — matches controller enforcement.
                      max={currentRefund.refundableAmount ?? currentRefund.amountPaid}
                      disabled={refStatus !== 'approved'} />
                    <span className="rf-helper-text">
                      Max: ${(currentRefund.refundableAmount ?? currentRefund.amountPaid ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="rf-form-group">
                    <label className="rf-form-label" htmlFor="rf-merchant-note">Merchant Note</label>
                    <textarea id="rf-merchant-note" className="rf-form-textarea" rows={3} value={merchantNote}
                      onChange={(e) => setMerchantNote(e.target.value)} placeholder="Internal note…"
                      disabled={refStatus !== 'approved'} />
                  </div>
                  <button type="button" className="rf-btn rf-btn--primary" onClick={handleProcessRefund}
                    disabled={!refundAmount || loading || refStatus !== 'approved'}>
                    {loading ? 'Processing…' : 'Process Refund'}
                  </button>
                </div>
              </div>
            )}

            {/* TIMELINE */}
            {activeTab === 'timeline' && (
              <div className="rf-card">
                <div className="rf-card-hd">
                  <div><h3 className="rf-card-title"><TimelineIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Timeline</h3></div>
                </div>
                <div className="rf-card-body">
                  {timelineLoading ? (
                    <div className="rf-loading"><div className="rf-spinner" /><span>Loading…</span></div>
                  ) : timeline.length > 0 ? (
                    <div className="rf-timeline">
                      {timeline.map((ev, idx) => (
                        <div key={ev._id ?? idx} className="rf-timeline-item">
                          <div className="rf-timeline-dot" />
                          <div className="rf-timeline-content">
                            <div className="rf-metric-row" style={{ padding: 0 }}>
                              <strong style={{ fontSize: 13 }}>{ev.title ?? ev.action ?? 'Event'}</strong>
                              <span className="rf-td-muted" style={{ fontSize: 11 }}>
                                {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''}
                              </span>
                            </div>
                            {ev.description && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280' }}>{ev.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rf-empty" style={{ minHeight: 120 }}>
                      <TimelineIcon style={{ fontSize: 28, color: '#D1D5DB' }} />
                      <span>No timeline events yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DOCUMENTS */}
            {activeTab === 'documents' && (
              <div className="rf-card">
                <div className="rf-card-hd">
                  <div><h3 className="rf-card-title"><Description style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Documents</h3></div>
                </div>
                <div className="rf-card-body">
                  <input type="file" multiple id="rf-file-upload" style={{ display: 'none' }}
                    aria-label="Upload refund documents"
                    onChange={(e) => handleFileUpload(Array.from(e.target.files))} />
                  <label htmlFor="rf-file-upload">
                    <div className="rf-upload-zone" role="button" tabIndex={0}>
                      <CloudUpload className="rf-upload-icon" />
                      <p className="rf-upload-text">Click to upload documents</p>
                    </div>
                  </label>
                  {uploadLoading && <div className="rf-loading" style={{ padding: '1rem' }}><div className="rf-spinner" /><span>Uploading…</span></div>}
                  {documentsLoading ? (
                    <div className="rf-loading"><div className="rf-spinner" /><span>Loading documents…</span></div>
                  ) : documents.length > 0 ? (
                    <div className="rf-file-list">
                      {documents.map((doc, idx) => (
                        <div key={doc._id ?? idx} className="rf-file-item">
                          <div className="rf-file-info"><AttachFile style={{ fontSize: 16 }} /><span>{doc.filename ?? 'File'}</span></div>
                          <a href={doc.url} download className="rf-btn rf-btn--ghost" target="_blank" rel="noopener noreferrer">Download</a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rf-empty" style={{ minHeight: 120 }}>
                      <Description style={{ fontSize: 28, color: '#D1D5DB' }} />
                      <span>No documents uploaded yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rf-drawer-footer">
            <button type="button" className="rf-btn rf-btn--primary" onClick={() => setShowMessageModal(true)}>
              <Message style={{ marginRight: 6, fontSize: 16 }} />Messages
            </button>
            <button type="button" className="rf-btn rf-btn--secondary" onClick={handleClosePanel}>Close</button>
          </div>
        </div>
      </div>

    );
  };

  // ── Main Render ───────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="rf-page">
        <div className="rf-body">

          <Link to="/admin/dashboard" className="rf-back-btn">
            <ArrowBack style={{ fontSize: 15 }} />Dashboard
          </Link>

          <div className="rf-hd">
            <div className="rf-hd-left">
              <span className="rf-hd-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                <Assessment style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="rf-hd-title">Refunds Management</h1>
                <p className="rf-hd-sub">Review, approve and process customer refund requests</p>
              </div>
            </div>
            <div className="rf-hd-right">
              <button type="button"
                className={`rf-icon-btn${refundsLoading || unreadLoading ? ' rf-icon-btn--spin' : ''}`}
                onClick={handleFetchRefunds} disabled={refundsLoading || unreadLoading} title="Refresh">
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          <div className="rf-kpi-grid">{renderKPICards()}</div>

          <div className="rf-section"><span className="rf-section-text">Refund Requests</span><span className="rf-section-line" /></div>

          {/* Filters */}
          <div className="rf-filters">
            <div className="rf-search-wrap">
              <Search className="rf-search-icon" style={{ fontSize: 16 }} />
              <input type="text" className="rf-search-input" placeholder="Search by order ID or customer…"
                value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} aria-label="Search refunds" />
            </div>

            <div className="rf-tf rf-filter-pills">
              {STATUS_FILTERS.map((opt) => (
                <button key={opt.value || 'all'} type="button"
                  className={`rf-tf-btn${filterStatus === opt.value ? ' rf-tf-btn--active' : ''}`}
                  onClick={() => setFilterStatus(opt.value)}>
                  {opt.label}
                  {hasUnreadByStatus[opt.value || 'all'] && <span className="rf-tab-dot" />}
                </button>
              ))}
            </div>

            <div className="rf-date-wrap">
              <input type="date" className="rf-date-input" value={startDate}
                onChange={(e) => setStartDate(e.target.value)} aria-label="From date" />
              <span className="rf-date-sep">—</span>
              <input type="date" className="rf-date-input" value={endDate}
                onChange={(e) => setEndDate(e.target.value)} aria-label="To date" />
            </div>

            <div className="rf-toggle-wrap">
              <button type="button" role="switch" aria-checked={showUnreadOnly}
                className={`rf-toggle${showUnreadOnly ? ' rf-toggle--active' : ''}`}
                onClick={() => setShowUnreadOnly((v) => !v)} aria-label="Show unread only">
                <span className="rf-toggle-knob" />
              </button>
              <span className="rf-toggle-label">Unread Only</span>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="rf-error-banner" role="alert">
              <Warning style={{ fontSize: 18, flexShrink: 0 }} />
              <div><strong className="rf-error-title">Error</strong><p className="rf-error-msg">{error}</p></div>
            </div>
          )}

          {/* Pending attachment retry banner */}
          {errorStage === 'send' && pendingAttachments.length > 0 && (
            <div className="rf-retry-banner" role="alert">
              <Warning style={{ fontSize: 16, flexShrink: 0 }} />
              <span className="rf-retry-msg">Files uploaded but message failed to send.</span>
              <div className="rf-retry-actions">
                <button type="button" className="rf-btn rf-btn--primary" onClick={handleRetryMessage} disabled={messageSendLoading}>
                  {messageSendLoading ? 'Retrying…' : 'Retry Send'}
                </button>
                <button type="button" className="rf-btn rf-btn--ghost" onClick={() => dispatch(clearPendingAttachments())}>Dismiss</button>
              </div>
            </div>
          )}

          {/* Load-more messages banner (shown when detail panel is open) */}
          {showDetailPanel && hasMoreMessages && (
            <div className="rf-load-more-wrap">
              <button type="button" className="rf-btn rf-btn--ghost" onClick={handleLoadMoreMessages} disabled={messagesLoading}>
                {messagesLoading ? 'Loading…' : 'Load older messages'}
              </button>
            </div>
          )}

          {/* Table card */}
          <div className="rf-card">
            <div className="rf-card-hd">
              <div>
                <h3 className="rf-card-title">{showUnreadOnly ? 'Unread Refunds' : 'All Refunds'}</h3>
                <p className="rf-card-sub">
                  {refundsLoading || unreadLoading ? 'Loading…'
                    : showUnreadOnly ? `${unreadRefunds.length} with unread messages`
                    : `${totalRefunds} total`}
                </p>
              </div>
            </div>
            <div className="rf-card-body--np">
              {renderTable()}
              {renderPagination()}
            </div>
          </div>

          {/* Success toast */}
          {success && successMessage && (
            <div className="rf-toast-wrap" role="status" aria-live="polite">
              <div className="rf-toast rf-toast--success">
                <CheckCircle style={{ fontSize: 18 }} />
                <div><strong>Success</strong><p>{successMessage}</p></div>
              </div>
            </div>
          )}
        </div>

        {renderDetailPanel()}

        {/* FIX: MessageModal only mounts when currentRefund is populated */}
        {showMessageModal && currentRefund && (
          <RefundReturnMessagesModal
            isOpen={showMessageModal}
            onClose={handleCloseMessageModal}
            orderId={selectedId}
            orderInfo={{
              orderNumber: currentRefund._id?.toString().slice(-6).toUpperCase(),
              // FIX: getCustomerName — was user?.name which doesn't exist
              customerName: getCustomerName(currentRefund.user),
            }}
            messages={messages}
            onSendMessage={handleSendMessage}
            // FIX: onRefresh now passed — modal reloads messages on open
            onRefresh={handleModalRefresh}
            loading={messagesLoading}
            currentUserRole="admin"
            type="refund"
          />
        )}
      </div>
      <Footer />
    </>
  );
};

export default AdminRefunds;