import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Search,
  Refresh,
  Visibility,
  CheckCircle,
  Cancel,
  Inventory,
  Assessment,
  Message,
  AttachFile,
  CloudUpload,
  Timeline as TimelineIcon,
  Description,
  Warning,
  Schedule,
  ChevronLeft,
  ChevronRight,
  ArrowBack,
  HourglassEmpty,
  ReportProblem,
  LocalShipping,
  SwapHoriz,
} from '@mui/icons-material';
import {
  getAllReturns,
  getSingleReturn,
  reviewReturn,
  updateReturnStatus,
  sendReturnMessage,
  getReturnMessages,
  getReturnTimeline,
  getReturnDocuments,
  uploadReturnFiles,
  getReturnsWithUnreadMessages,
  clearCurrentReturn,
  clearAdminReturnState,
  clearReturnMessages,
  clearPendingAttachments,
} from '../features/admin/adminReturnSlice';
import ReturnMessagesModal from '../Orders/ReturnMessagesModal';
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

// ── Pure helpers ─────────────────────────────────────────────────────────────
const getCustomerName = (user) => {
  if (!user) return 'N/A';
  return user.name?.trim() || user.email || 'N/A';
};

const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : '0.00');

const STATUS_COLOR = {
  requested:  'requested',
  approved:   'approved',
  in_transit: 'in_transit',
  received:   'received',
  inspected:  'inspected',
  completed:  'completed',
  rejected:   'rejected',
  cancelled:  'cancelled',
};

const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled']);
const LIFECYCLE_STATUSES = ['in_transit', 'received', 'inspected', 'completed'];

const NEXT_STATUS_MAP = {
  approved:   ['in_transit'],
  in_transit: ['received'],
  received:   ['inspected'],
  inspected:  ['completed'],
};

const DRAWER_TABS = ['overview', 'review', 'status', 'timeline', 'documents'];

const STATUS_FILTERS = [
  { value: '',           label: 'All' },
  { value: 'requested',  label: 'Requested' },
  { value: 'approved',   label: 'Approved' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'received',   label: 'Received' },
  { value: 'inspected',  label: 'Inspected' },
  { value: 'completed',  label: 'Completed' },
  { value: 'rejected',   label: 'Rejected' },
  { value: 'cancelled',  label: 'Cancelled' },
];

const SORT_OPTIONS = [
  { value: 'requestedAt', label: 'Date Requested' },
  { value: 'totalPrice',  label: 'Order Total' },
  { value: 'status',      label: 'Status' },
];

const LIMIT = 20;

// ── Component ────────────────────────────────────────────────────────────────
const AdminReturns = () => {
  const dispatch = useDispatch();

  const {
    returns,
    unreadReturns,
    stats,
    currentReturn,
    messages,
    messagesPage,
    hasMoreMessages,
    totalMessages,
    pendingAttachments,
    errorStage,
    timeline,
    documents,
    pagination,
    loading,
    returnsLoading,
    unreadLoading,
    messageSendLoading,
    messagesLoading,
    timelineLoading,
    documentsLoading,
    uploadLoading,
    error,
    success,
    message: successMessage,
  } = useSelector((state) => state.adminReturn);

  const { currentPage, totalPages, totalReturns } = pagination;

  // ── Filter / sort / page state ────────────────────────────────────────────
  const [localPage,      setLocalPage]      = useState(1);
  const [searchRaw,      setSearchRaw]      = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [fromDate,       setFromDate]       = useState('');
  const [toDate,         setToDate]         = useState('');
  const [rmaSearch,      setRmaSearch]      = useState('');
  const [sortBy,         setSortBy]         = useState('requestedAt');
  const [sortOrder,      setSortOrder]      = useState('desc');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // ── Panel / modal state ───────────────────────────────────────────────────
  const [selectedId,       setSelectedId]       = useState(null);
  const [showDetailPanel,  setShowDetailPanel]  = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [activeTab,        setActiveTab]        = useState('overview');

  // ── Form state (drawer) ───────────────────────────────────────────────────
  const [reviewAction,     setReviewAction]     = useState('');
  const [adminNote,        setAdminNote]        = useState('');
  const [restockFee,       setRestockFee]       = useState('');
  const [newStatus,        setNewStatus]        = useState('');
  const [inspectionNotes,  setInspectionNotes]  = useState('');

  const rmaDebounced = useDebounce(rmaSearch, 400);

  // ── FIX: Use a ref to track which filters were last fetched ──────────────
  // This breaks the circular dependency:
  // buildListParams → useCallback → handleFetchReturns → useCallback → useEffect → fetch
  // The ref approach lets us read current filter values at fetch time
  // without making them reactive dependencies of the fetch effect itself.
  const filtersRef = useRef({});
  filtersRef.current = {
    localPage,
    filterStatus,
    fromDate,
    toDate,
    rmaDebounced,
    sortBy,
    sortOrder,
    showUnreadOnly,
  };

  // ── Build filter params (pure function, no useCallback needed) ────────────
  const buildListParams = () => {
    const f = filtersRef.current;
    const p = { page: f.localPage, limit: LIMIT, sortBy: f.sortBy, order: f.sortOrder };
    if (f.filterStatus)        p.status = f.filterStatus;
    if (f.fromDate)            p.from   = f.fromDate;
    if (f.toDate)              p.to     = f.toDate;
    if (f.rmaDebounced.trim()) p.rma    = f.rmaDebounced.trim();
    return p;
  };

  // ── FIX: Single stable fetch trigger using a counter ─────────────────────
  // Instead of depending on derived callbacks, we increment a counter whenever
  // we want a fetch to happen. The fetch effect only depends on this counter,
  // preventing the circular rebuild chain that caused infinite loading.
  const [fetchTick, setFetchTick] = useState(0);
  const triggerFetch = useCallback(() => setFetchTick((n) => n + 1), []);

  // ── Fetch list ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (filtersRef.current.showUnreadOnly) {
      dispatch(getReturnsWithUnreadMessages());
    } else {
      dispatch(getAllReturns(buildListParams()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTick, dispatch]);

  // ── FIX: Trigger fetch when filters change (debounced values settle) ──────
  // Previously this was handled by making handleFetchReturns depend on
  // buildListParams which depended on all filters — causing the loop.
  // Now we just trigger the stable counter, which fires the fetch effect once.
  useEffect(() => {
    // Reset to page 1 on filter changes (not on page change itself)
    setLocalPage(1);
    // Delay slightly so setLocalPage(1) has time to update filtersRef
    // before the fetch effect reads it. Using setTimeout(0) is safe here
    // because the fetch effect reads from filtersRef.current (always fresh).
    triggerFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, fromDate, toDate, rmaDebounced, sortBy, sortOrder, showUnreadOnly]);

  // ── Trigger fetch on page change ──────────────────────────────────────────
  useEffect(() => {
    triggerFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPage]);

  // ── Manual refresh ────────────────────────────────────────────────────────
  const handleFetchReturns = useCallback(() => {
    triggerFetch();
  }, [triggerFetch]);

  // ── Toast auto-dismiss ────────────────────────────────────────────────────
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

  // Pre-populate available next statuses when status tab opens
  useEffect(() => {
    if (activeTab === 'status' && currentReturn) {
      const current = currentReturn.returnInfo?.status;
      const options = NEXT_STATUS_MAP[current] ?? [];
      if (options.length === 1 && !newStatus) {
        setNewStatus(options[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentReturn]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const displayList = showUnreadOnly ? unreadReturns : returns;
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
    for (let i = left; i <= right; i += 1) pages.push(i);
    if (right < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [totalPages, currentPage]);

  const validNextStatuses = useMemo(() => {
    if (!currentReturn) return [];
    const current = currentReturn.returnInfo?.status;
    return NEXT_STATUS_MAP[current] ?? [];
  }, [currentReturn]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePageChange = useCallback((page) => {
    if (page < 1 || page > totalPages) return;
    setLocalPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [totalPages]);

  const fetchReturnDetails = useCallback(async (orderId) => {
    await dispatch(getSingleReturn(orderId));
    dispatch(getReturnTimeline(orderId));
    dispatch(getReturnDocuments(orderId));
    dispatch(getReturnMessages({ orderId, page: 1 }));
  }, [dispatch]);

  const handleViewReturn = useCallback(async (orderId) => {
    setSelectedId(orderId);
    setActiveTab('overview');
    setShowDetailPanel(true);
    await fetchReturnDetails(orderId);
  }, [fetchReturnDetails]);

  const handleOpenMessageModal = useCallback(async (orderId) => {
    setSelectedId(orderId);
    await dispatch(getSingleReturn(orderId));
    dispatch(getReturnMessages({ orderId, page: 1 }));
    dispatch(getReturnTimeline(orderId));
    dispatch(getReturnDocuments(orderId));
    setShowDetailPanel(true);
    setShowMessageModal(true);
  }, [dispatch]);

  const handleLoadMoreMessages = useCallback(() => {
    if (!selectedId || !hasMoreMessages || messagesLoading) return;
    dispatch(getReturnMessages({ orderId: selectedId, page: messagesPage + 1 }));
  }, [dispatch, selectedId, hasMoreMessages, messagesPage, messagesLoading]);

  const handleReviewReturn = useCallback(async () => {
    if (!reviewAction || !selectedId) return;
    try {
      await dispatch(reviewReturn({
        orderId:    selectedId,
        action:     reviewAction,
        restockFee: restockFee ? Number(restockFee) : undefined,
        adminNote:  adminNote || undefined,
      })).unwrap();
      setReviewAction('');
      setAdminNote('');
      setRestockFee('');
      dispatch(getAllReturns(buildListParams()));
    } catch (_) { /* error surfaced via slice error state */ }
  }, [dispatch, reviewAction, adminNote, restockFee, selectedId]);

  const handleUpdateStatus = useCallback(async () => {
    if (!newStatus || !selectedId) return;
    try {
      await dispatch(updateReturnStatus({
        orderId:         selectedId,
        status:          newStatus,
        inspectionNotes: newStatus === 'inspected' ? (inspectionNotes || undefined) : undefined,
      })).unwrap();
      setNewStatus('');
      setInspectionNotes('');
      dispatch(getAllReturns(buildListParams()));
    } catch (_) { /* error surfaced via slice */ }
  }, [dispatch, newStatus, inspectionNotes, selectedId]);

  const handleSendMessage = useCallback(async (text, files, pendingUrls = []) => {
    if (!selectedId) return;
    await dispatch(sendReturnMessage({
      orderId:     selectedId,
      content:     text,
      files:       files ?? [],
      pendingUrls: pendingUrls ?? [],
    })).unwrap();
  }, [dispatch, selectedId]);

  const handleRetryMessage = useCallback(() => {
    if (!selectedId || !pendingAttachments.length) return;
    dispatch(sendReturnMessage({
      orderId:     selectedId,
      content:     '',
      pendingUrls: pendingAttachments,
    }));
  }, [dispatch, selectedId, pendingAttachments]);

  const handleFileUpload = useCallback(async (files) => {
    if (!selectedId) return;
    try {
      await dispatch(uploadReturnFiles({ orderId: selectedId, files })).unwrap();
      dispatch(getReturnDocuments(selectedId));
    } catch (_) { /* error surfaced via slice */ }
  }, [dispatch, selectedId]);

  const handleCloseMessageModal = useCallback(() => {
    setShowMessageModal(false);
    dispatch(clearReturnMessages());
    triggerFetch();
  }, [dispatch, triggerFetch]);

  const handleClosePanel = useCallback(() => {
    setShowDetailPanel(false);
    setShowMessageModal(false);
    setSelectedId(null);
    setActiveTab('overview');
    setReviewAction('');
    setAdminNote('');
    setRestockFee('');
    setNewStatus('');
    setInspectionNotes('');
    dispatch(clearCurrentReturn());
    triggerFetch();
  }, [dispatch, triggerFetch]);

  const handleModalRefresh = useCallback(() => {
    if (selectedId) dispatch(getReturnMessages({ orderId: selectedId, page: 1 }));
  }, [dispatch, selectedId]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderKPICards = () => {
    if (!stats) {
      return Array.from({ length: 5 }).map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="rt-kpi" style={{ '--kpi-color': '#E5E7EB' }}>
          <div className="rt-kpi-top">
            <div className="rt-skel" style={{ width: 40, height: 40, borderRadius: 10 }} />
          </div>
          <div className="rt-skel" style={{ width: '55%', height: 11, marginBottom: 8 }} />
          <div className="rt-skel" style={{ width: '70%', height: 26 }} />
        </div>
      ));
    }
    const cards = [
      { label: 'Total Returns',  value: stats.total      ?? 0, icon: Assessment,    color: '#6366F1' },
      { label: 'Pending Review', value: stats.requested  ?? 0, icon: Schedule,      color: '#F59E0B' },
      { label: 'In Progress',    value: (stats.approved ?? 0) + (stats.in_transit ?? 0) + (stats.received ?? 0) + (stats.inspected ?? 0), icon: LocalShipping, color: '#8B5CF6' },
      { label: 'Completed',      value: stats.completed  ?? 0, icon: CheckCircle,   color: '#10B981' },
      { label: 'Rejected',       value: stats.rejected   ?? 0, icon: Cancel,        color: '#EF4444' },
    ];
    return cards.map((c) => (
      <div key={c.label} className="rt-kpi" style={{ '--kpi-color': c.color }}>
        <div className="rt-kpi-top">
          <span className="rt-kpi-icon" style={{ background: `${c.color}18`, color: c.color }}>
            <c.icon style={{ fontSize: 20 }} />
          </span>
        </div>
        <div className="rt-kpi-label">{c.label}</div>
        <div className="rt-kpi-value">{c.value.toLocaleString()}</div>
      </div>
    ));
  };

  const renderTable = () => {
    if (tableLoading && displayList.length === 0) {
      return (
        <div style={{ padding: '20px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {Array.from({ length: 7 }).map((__, j) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={j} className="rt-skel" style={{ height: 16, flex: 1 }} />
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (!tableLoading && displayList.length === 0) {
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
              const status      = item.returnInfo?.status ?? 'unknown';
              const orderRef    = item.orderId ? item.orderId.toString().slice(-6).toUpperCase() : (item._id ? item._id.toString().slice(-6).toUpperCase() : 'N/A');
              const rma         = item.returnInfo?.rmaNumber ?? '—';
              const unreadCount = item.unreadMessages ?? 0;
              return (
                <tr key={item.orderId ?? item._id}>
                  <td className="rt-td-name">#{orderRef}</td>
                  <td>{getCustomerName(item.user)}</td>
                  <td className="rt-td-mono">{rma}</td>
                  <td className="rt-td-money">
                    ${fmt(item.returnInfo?.requestedAmount ?? 0)}
                  </td>
                  <td className="rt-td-reason">
                    {item.returnInfo?.reason?.replace(/_/g, ' ') ?? 'N/A'}
                  </td>
                  <td className="rt-td-muted">
                    {item.returnInfo?.requestedAt
                      ? new Date(item.returnInfo.requestedAt).toLocaleDateString()
                      : 'N/A'}
                  </td>
                  <td>
                    <span className={`rt-status rt-status--${STATUS_COLOR[status] ?? 'cancelled'}`}>
                      {status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rt-icon-btn"
                      onClick={() => handleOpenMessageModal(item.orderId ?? item._id)}
                      title="Open Messages"
                    >
                      <Message style={{ fontSize: 16 }} />
                      {unreadCount > 0 && (
                        <span className="rt-msg-badge">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rt-icon-btn"
                      onClick={() => handleViewReturn(item.orderId ?? item._id)}
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

  const renderPagination = () => {
    if (showUnreadOnly || totalPages <= 1) return null;
    return (
      <div className="rt-pagination">
        <button
          type="button"
          className="rt-page-btn rt-page-btn--nav"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 1}
          title="Previous"
        >
          <ChevronLeft style={{ fontSize: 18 }} />
        </button>
        {pageNumbers.map((p, idx) =>
          p === '...'
            // eslint-disable-next-line react/no-array-index-key
            ? <span key={`e${idx}`} className="rt-page-ellipsis">…</span>
            : (
              <button
                key={p}
                type="button"
                className={`rt-page-btn${currentPage === p ? ' rt-page-btn--active' : ''}`}
                onClick={() => handlePageChange(p)}
              >
                {p}
              </button>
            )
        )}
        <button
          type="button"
          className="rt-page-btn rt-page-btn--nav"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          title="Next"
        >
          <ChevronRight style={{ fontSize: 18 }} />
        </button>
        <span className="rt-page-info">Page {currentPage} of {totalPages}</span>
      </div>
    );
  };

  const renderDetailPanel = () => {
    if (!showDetailPanel) return null;

    if (!currentReturn) {
      return (
        <div
          className="rt-drawer-overlay"
          onClick={handleClosePanel}
          role="presentation"
        >
          <div
            className="rt-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
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

    const returnInfo  = currentReturn.returnInfo ?? {};
    const retStatus   = returnInfo.status ?? 'unknown';
    const isTerminal  = TERMINAL_STATUSES.has(retStatus);
    const orderRef    = currentReturn._id ? currentReturn._id.toString().slice(-6).toUpperCase() : 'N/A';
    const rma         = returnInfo.rmaNumber ?? null;

    return (
      <div
        className="rt-drawer-overlay"
        onClick={handleClosePanel}
        role="presentation"
      >
        <div
          className="rt-drawer"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rt-drawer-heading"
        >
          <div className="rt-drawer-hd">
            <div className="rt-drawer-hd-info">
              <h2 className="rt-drawer-title" id="rt-drawer-heading">
                Return — #{orderRef}
              </h2>
              {rma && <span className="rt-rma-badge">RMA: {rma}</span>}
            </div>
            <button type="button" className="rt-drawer-close" onClick={handleClosePanel} aria-label="Close panel">×</button>
          </div>

          <div className="rt-drawer-tabs">
            <div className="rt-tf rt-drawer-tab-row">
              {DRAWER_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`rt-tf-btn${activeTab === tab ? ' rt-tf-btn--active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="rt-drawer-body">

            {activeTab === 'overview' && (
              <>
                <div className="rt-section"><span className="rt-section-text">Return Info</span><span className="rt-section-line" /></div>
                <div className="rt-card">
                  <div className="rt-card-body">
                    {[
                      ['Customer',       getCustomerName(currentReturn.user)],
                      ['Email',          currentReturn.user?.email ?? 'N/A'],
                      ['Phone',          currentReturn.user?.phone ?? 'N/A'],
                      ['Order Total',    `$${fmt(currentReturn.totalPrice)}`],
                      ['Requested Amt',  `$${fmt(returnInfo.requestedAmount)}`],
                      ['Restock Fee',    returnInfo.restockFee ? `$${fmt(returnInfo.restockFee)}` : 'None'],
                      ['Reason',         returnInfo.reason?.replace(/_/g, ' ') ?? 'N/A'],
                    ].map(([label, val]) => (
                      <div key={label} className="rt-metric-row">
                        <span className="rt-metric-label">{label}</span>
                        <span className="rt-metric-val">{val}</span>
                      </div>
                    ))}
                    <div className="rt-metric-row">
                      <span className="rt-metric-label">Status</span>
                      <span className={`rt-status rt-status--${STATUS_COLOR[retStatus] ?? 'cancelled'}`}>
                        {retStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="rt-metric-row">
                      <span className="rt-metric-label">Requested On</span>
                      <span className="rt-metric-val">
                        {returnInfo.requestedAt
                          ? new Date(returnInfo.requestedAt).toLocaleString()
                          : 'N/A'}
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
                        <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                          {returnInfo.description}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {returnInfo.inspectionNotes && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Inspection Notes</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                          {returnInfo.inspectionNotes}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {returnInfo.itemsToReturn?.length > 0 && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Items to Return</span><span className="rt-section-line" /></div>
                    <div className="rt-card">
                      <div className="rt-card-body">
                        {returnInfo.itemsToReturn.map((item, idx) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={item.product ?? idx} className="rt-item-row">
                            <div className="rt-item-info">
                              <span className="rt-item-name">
                                {item.product?.name ?? `Item ${idx + 1}`}
                              </span>
                              <span className="rt-item-meta">
                                Qty: {item.quantity ?? 1}
                                {item.condition ? ` · ${item.condition}` : ''}
                              </span>
                            </div>
                            {item.reason && (
                              <span className="rt-item-reason">{item.reason.replace(/_/g, ' ')}</span>
                            )}
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
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={item._id ?? idx} className="rt-item-row">
                            <div className="rt-item-info">
                              <span className="rt-item-name">
                                {item.product?.name ?? `Item ${idx + 1}`}
                              </span>
                              <span className="rt-item-meta">
                                Qty: {item.quantity ?? 1} · ${fmt(item.price ?? 0)} ea
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {activeTab === 'review' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title">Review Return Request</h3>
                    <p className="rt-card-sub">Approve or reject this return</p>
                  </div>
                </div>
                <div className="rt-card-body">
                  {retStatus !== 'requested' && (
                    <div className={`rt-info-banner rt-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                      {isTerminal
                        ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} />
                        : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                      <span>
                        This return is <strong>{retStatus.replace(/_/g, ' ')}</strong> and cannot be re-reviewed.
                      </span>
                    </div>
                  )}
                  <div className="rt-form-group">
                    <label className="rt-form-label" htmlFor="rt-review-action">Decision *</label>
                    <select
                      id="rt-review-action"
                      className="rt-form-select"
                      value={reviewAction}
                      onChange={(e) => setReviewAction(e.target.value)}
                      disabled={retStatus !== 'requested' || loading}
                    >
                      <option value="">Select action</option>
                      <option value="approve">Approve Return</option>
                      <option value="reject">Reject Return</option>
                    </select>
                  </div>
                  {reviewAction === 'approve' && (
                    <div className="rt-form-group">
                      <label className="rt-form-label" htmlFor="rt-restock-fee">Restock Fee ($)</label>
                      <input
                        id="rt-restock-fee"
                        type="number"
                        className="rt-form-input"
                        value={restockFee}
                        onChange={(e) => setRestockFee(e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        disabled={retStatus !== 'requested' || loading}
                      />
                      <span className="rt-helper-text">Leave blank or 0 for no restock fee</span>
                    </div>
                  )}
                  <div className="rt-form-group">
                    <label className="rt-form-label" htmlFor="rt-admin-note">Admin Note</label>
                    <textarea
                      id="rt-admin-note"
                      className="rt-form-textarea"
                      rows={3}
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Add a note for the customer…"
                      disabled={retStatus !== 'requested' || loading}
                    />
                  </div>
                  <button
                    type="button"
                    className={`rt-btn ${reviewAction === 'approve' ? 'rt-btn--success' : reviewAction === 'reject' ? 'rt-btn--danger' : 'rt-btn--primary'}`}
                    onClick={handleReviewReturn}
                    disabled={!reviewAction || loading || retStatus !== 'requested'}
                  >
                    {loading
                      ? 'Processing…'
                      : reviewAction === 'approve'
                        ? 'Approve Return'
                        : reviewAction === 'reject'
                          ? 'Reject Return'
                          : 'Select an action'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'status' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title">
                      <SwapHoriz style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />
                      Update Return Status
                    </h3>
                    <p className="rt-card-sub">Advance through the return lifecycle</p>
                  </div>
                </div>
                <div className="rt-card-body">
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
                      {isTerminal
                        ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} />
                        : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                      <span>
                        {isTerminal
                          ? `This return is ${retStatus.replace(/_/g, ' ')} — no further status updates.`
                          : `Return must be approved before the lifecycle can begin. Current: ${retStatus.replace(/_/g, ' ')}.`}
                      </span>
                    </div>
                  )}

                  {validNextStatuses.length > 0 && (
                    <>
                      <div className="rt-form-group">
                        <label className="rt-form-label" htmlFor="rt-new-status">Next Status *</label>
                        <select
                          id="rt-new-status"
                          className="rt-form-select"
                          value={newStatus}
                          onChange={(e) => setNewStatus(e.target.value)}
                          disabled={loading}
                        >
                          <option value="">Select status</option>
                          {validNextStatuses.map((s) => (
                            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </div>
                      {newStatus === 'inspected' && (
                        <div className="rt-form-group">
                          <label className="rt-form-label" htmlFor="rt-inspection-notes">Inspection Notes</label>
                          <textarea
                            id="rt-inspection-notes"
                            className="rt-form-textarea"
                            rows={3}
                            value={inspectionNotes}
                            onChange={(e) => setInspectionNotes(e.target.value)}
                            placeholder="Describe the condition of returned items…"
                            disabled={loading}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="rt-btn rt-btn--primary"
                        onClick={handleUpdateStatus}
                        disabled={!newStatus || loading}
                      >
                        {loading ? 'Updating…' : `Mark as ${newStatus.replace(/_/g, ' ') || '…'}`}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'timeline' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title">
                      <TimelineIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />
                      Timeline
                    </h3>
                  </div>
                </div>
                <div className="rt-card-body">
                  {timelineLoading ? (
                    <div className="rt-loading"><div className="rt-spinner" /><span>Loading…</span></div>
                  ) : timeline.length > 0 ? (
                    <div className="rt-timeline">
                      {timeline.map((ev, idx) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <div key={ev._id ?? idx} className="rt-timeline-item">
                          <div className="rt-timeline-dot" />
                          <div className="rt-timeline-content">
                            <div className="rt-tl-row">
                              <strong>{ev.title ?? ev.action ?? 'Event'}</strong>
                              <span className="rt-td-muted">
                                {ev.timestamp
                                  ? new Date(ev.timestamp).toLocaleString()
                                  : ''}
                              </span>
                            </div>
                            {ev.description && (
                              <p className="rt-tl-desc">{ev.description}</p>
                            )}
                            {ev.performedBy?.name && (
                              <p className="rt-tl-by">by {ev.performedBy.name}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rt-empty" style={{ minHeight: 120 }}>
                      <TimelineIcon style={{ fontSize: 28, color: '#D1D5DB' }} />
                      <span>No timeline events yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title">
                      <Description style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />
                      Documents
                    </h3>
                  </div>
                </div>
                <div className="rt-card-body">
                  <input
                    type="file"
                    multiple
                    id="rt-file-upload"
                    style={{ display: 'none' }}
                    aria-label="Upload return documents"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        handleFileUpload(Array.from(e.target.files));
                        // eslint-disable-next-line no-param-reassign
                        e.target.value = '';
                      }
                    }}
                  />
                  <label htmlFor="rt-file-upload">
                    <div
                      className="rt-upload-zone"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
                    >
                      <CloudUpload className="rt-upload-icon" />
                      <p className="rt-upload-text">Click to upload documents</p>
                      <p className="rt-upload-hint">Max 8 files · Images, PDFs, Videos</p>
                    </div>
                  </label>
                  {uploadLoading && (
                    <div className="rt-loading" style={{ padding: '1rem' }}>
                      <div className="rt-spinner" /><span>Uploading…</span>
                    </div>
                  )}
                  {documentsLoading ? (
                    <div className="rt-loading"><div className="rt-spinner" /><span>Loading documents…</span></div>
                  ) : documents.length > 0 ? (
                    <div className="rt-file-list">
                      {documents.map((doc, idx) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <div key={doc._id ?? idx} className="rt-file-item">
                          <div className="rt-file-info">
                            <AttachFile style={{ fontSize: 16 }} />
                            <span>{doc.filename ?? 'File'}</span>
                            {doc.fileSize && (
                              <span className="rt-file-size">
                                {(doc.fileSize / 1024).toFixed(0)} KB
                              </span>
                            )}
                          </div>
                          <a
                            href={doc.url}
                            download
                            className="rt-btn rt-btn--ghost"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Download
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rt-empty" style={{ minHeight: 100 }}>
                      <Description style={{ fontSize: 28, color: '#D1D5DB' }} />
                      <span>No documents uploaded yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rt-drawer-footer">
            <button
              type="button"
              className="rt-btn rt-btn--primary"
              onClick={() => setShowMessageModal(true)}
            >
              <Message style={{ marginRight: 6, fontSize: 16 }} />
              Messages
              {(currentReturn.returnInfo?.messages?.length > 0) && (
                <span className="rt-footer-msg-count">
                  {currentReturn.returnInfo.messages.length}
                </span>
              )}
            </button>
            <button type="button" className="rt-btn rt-btn--secondary" onClick={handleClosePanel}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="rt-page">
      <div className="rt-body">

        <Link to="/admin/dashboard" className="rt-back-btn">
          <ArrowBack style={{ fontSize: 15 }} />Dashboard
        </Link>

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
            <button
              type="button"
              className={`rt-icon-btn${(returnsLoading || unreadLoading) ? ' rt-icon-btn--spin' : ''}`}
              onClick={handleFetchReturns}
              disabled={returnsLoading || unreadLoading}
              title="Refresh"
            >
              <Refresh style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div className="rt-kpi-grid">{renderKPICards()}</div>

        <div className="rt-section">
          <span className="rt-section-text">Return Requests</span>
          <span className="rt-section-line" />
        </div>

        <div className="rt-filters">
          <div className="rt-search-wrap">
            <Search className="rt-search-icon" style={{ fontSize: 16 }} />
            <input
              type="text"
              className="rt-search-input"
              placeholder="Search RMA number…"
              value={rmaSearch}
              onChange={(e) => setRmaSearch(e.target.value)}
              aria-label="Search by RMA number"
            />
          </div>

          <div className="rt-tf rt-filter-pills">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value || 'all'}
                type="button"
                className={`rt-tf-btn${filterStatus === opt.value ? ' rt-tf-btn--active' : ''}`}
                onClick={() => setFilterStatus(opt.value)}
              >
                {opt.label}
                {hasUnreadByStatus[opt.value || 'all'] && <span className="rt-tab-dot" />}
              </button>
            ))}
          </div>

          <div className="rt-date-wrap">
            <input
              type="date"
              className="rt-date-input"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="From date"
            />
            <span className="rt-date-sep">—</span>
            <input
              type="date"
              className="rt-date-input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="To date"
            />
          </div>

          <div className="rt-sort-wrap">
            <select
              className="rt-form-select rt-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort by"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="rt-icon-btn rt-sort-dir-btn"
              onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
            >
              <span className={`rt-sort-arrow${sortOrder === 'asc' ? ' rt-sort-arrow--up' : ''}`}>↓</span>
            </button>
          </div>

          <div className="rt-toggle-wrap">
            <button
              type="button"
              role="switch"
              aria-checked={showUnreadOnly}
              className={`rt-toggle${showUnreadOnly ? ' rt-toggle--active' : ''}`}
              onClick={() => setShowUnreadOnly((v) => !v)}
              aria-label="Show unread only"
            >
              <span className="rt-toggle-knob" />
            </button>
            <span className="rt-toggle-label">Unread Only</span>
          </div>
        </div>

        {error && (
          <div className="rt-error-banner" role="alert">
            <Warning style={{ fontSize: 18, flexShrink: 0 }} />
            <div>
              <strong className="rt-error-title">Error</strong>
              <p className="rt-error-msg">{error}</p>
            </div>
          </div>
        )}

        {errorStage === 'send' && pendingAttachments.length > 0 && (
          <div className="rt-retry-banner" role="alert">
            <Warning style={{ fontSize: 16, flexShrink: 0 }} />
            <span className="rt-retry-msg">Files uploaded but message failed to send.</span>
            <div className="rt-retry-actions">
              <button
                type="button"
                className="rt-btn rt-btn--primary"
                onClick={handleRetryMessage}
                disabled={messageSendLoading}
              >
                {messageSendLoading ? 'Retrying…' : 'Retry Send'}
              </button>
              <button
                type="button"
                className="rt-btn rt-btn--ghost"
                onClick={() => dispatch(clearPendingAttachments())}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="rt-card">
          <div className="rt-card-hd">
            <div>
              <h3 className="rt-card-title">
                {showUnreadOnly ? 'Unread Returns' : 'All Returns'}
              </h3>
              <p className="rt-card-sub">
                {returnsLoading || unreadLoading
                  ? 'Loading…'
                  : showUnreadOnly
                    ? `${unreadReturns.length} with unread messages`
                    : `${totalReturns} total`}
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
              <div>
                <strong>Success</strong>
                <p>{successMessage}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {renderDetailPanel()}

      {showMessageModal && currentReturn && (
        <ReturnMessagesModal
          isOpen={showMessageModal}
          onClose={handleCloseMessageModal}
          orderId={selectedId}
          orderInfo={{
            orderNumber:  currentReturn._id?.toString().slice(-6).toUpperCase() ?? '',
            customerName: getCustomerName(currentReturn.user),
          }}
          messages={messages}
          loading={messagesLoading}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          onSendMessage={handleSendMessage}
          onRefresh={handleModalRefresh}
          onLoadMore={handleLoadMoreMessages}
          pendingAttachments={pendingAttachments}
          errorStage={errorStage}
          onClearPending={() => dispatch(clearPendingAttachments())}
          currentUserRole="admin"
          isSendingExternal={messageSendLoading}
        />
      )}
    </div>
  );
};

export default AdminReturns;