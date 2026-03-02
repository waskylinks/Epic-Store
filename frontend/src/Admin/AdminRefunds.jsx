import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
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
} from '@mui/icons-material';
import {
  getAllRefunds,
  getSingleRefund,
  reviewRefund,
  processRefund,
  addRefundMessage,
  getRefundMessages,
  getRefundTimeline,
  getRefundDocuments,
  uploadRefundFiles,
  getRefundsWithUnreadMessages,
  clearCurrentRefund,
  clearAdminRefundState,
} from '../features/admin/adminRefundSlice';
import MessageModal from '../Orders/RefundReturnMessagesModal';
import '../AdminStyles/AdminRefunds.css';

const AdminRefunds = () => {
  const dispatch = useDispatch();

  const {
    refunds,
    stats,
    currentRefund,
    messages,
    timeline,
    documents,
    loading,
    refundsLoading,
    unreadLoading,
    messagesLoading,
    timelineLoading,
    documentsLoading,
    uploadLoading,
    error,
    success,
    message: successMessage,
  } = useSelector((state) => state.adminRefund);

  // ── Local state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({ status: '', startDate: '', endDate: '' });
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedRefundId, setSelectedRefundId] = useState(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Review form
  const [reviewAction, setReviewAction] = useState('');
  const [adminNote, setAdminNote] = useState('');

  // Process form
  const [refundAmount, setRefundAmount] = useState(0);
  const [merchantNote, setMerchantNote] = useState('');

  // Pagination
  const [currentPage] = useState(1);
  const itemsPerPage = 20;

  // ── Data fetching ──────────────────────────────────────────────────────────
  const handleFetchRefunds = useCallback(() => {
    if (showUnreadOnly) {
      dispatch(getRefundsWithUnreadMessages());
    } else {
      dispatch(
        getAllRefunds({
          ...filters,
          search: searchQuery,
          page: currentPage,
          limit: itemsPerPage,
        })
      );
    }
  }, [filters, searchQuery, showUnreadOnly, currentPage, dispatch]);

  useEffect(() => {
    handleFetchRefunds();
  }, [handleFetchRefunds]);

  // ── Auto-dismiss success toast ─────────────────────────────────────────────
  // Fix: clearAdminRefundState was never called, so the toast stayed permanently.
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => dispatch(clearAdminRefundState()), 3000);
      return () => clearTimeout(timer);
    }
  }, [success, dispatch]);

  // Clear error after display
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => dispatch(clearAdminRefundState()), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, dispatch]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  // Fix: separated fetching sub-resources from opening the panel so the
  // modal open path can await getSingleRefund before showing MessageModal,
  // preventing a null currentRefund crash.
  const fetchRefundDetails = useCallback(
    async (orderId) => {
      await dispatch(getSingleRefund(orderId));
      dispatch(getRefundTimeline(orderId));
      dispatch(getRefundDocuments(orderId));
      dispatch(getRefundMessages(orderId));
    },
    [dispatch]
  );

  const handleViewRefund = async (orderId) => {
    setSelectedRefundId(orderId);
    setShowDetailPanel(true);
    await fetchRefundDetails(orderId);
  };

  // Fix: await getSingleRefund before opening the modal so currentRefund is
  // populated and the modal does not receive null props and crash.
  const handleOpenMessageModalFromRow = async (orderId) => {
    setSelectedRefundId(orderId);
    // Ensure the detail panel is also open so panel close works correctly
    setShowDetailPanel(true);
    await dispatch(getSingleRefund(orderId));
    dispatch(getRefundMessages(orderId));
    dispatch(getRefundTimeline(orderId));
    dispatch(getRefundDocuments(orderId));
    setShowMessageModal(true);
  };

  const handleReviewRefund = async () => {
    if (!reviewAction) return;
    try {
      await dispatch(
        reviewRefund({ orderId: selectedRefundId, action: reviewAction, adminNote })
      ).unwrap();
      setReviewAction('');
      setAdminNote('');
      // Fix: currentRefund is now updated in the slice from the response payload,
      // so we only need to refresh the table — not all 4 sub-resources.
      handleFetchRefunds();
    } catch (err) {
      console.error('Failed to review refund:', err);
    }
  };

  const handleProcessRefund = async () => {
    if (!refundAmount) return;
    try {
      await dispatch(
        processRefund({ orderId: selectedRefundId, refundAmount, merchantNote })
      ).unwrap();
      setRefundAmount(0);
      setMerchantNote('');
      handleFetchRefunds();
    } catch (err) {
      console.error('Failed to process refund:', err);
    }
  };

  // Fix: field renamed from "content" to "message" to match backend controller
  const handleSendMessage = async (content, attachments) => {
    try {
      await dispatch(
        addRefundMessage({ orderId: selectedRefundId, message: content, attachments })
      ).unwrap();
      dispatch(getRefundMessages(selectedRefundId));
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleFileUpload = async (files) => {
    try {
      await dispatch(uploadRefundFiles({ orderId: selectedRefundId, files })).unwrap();
      dispatch(getRefundDocuments(selectedRefundId));
    } catch (err) {
      console.error('Failed to upload files:', err);
    }
  };

  const handleClosePanel = () => {
    setShowDetailPanel(false);
    setShowMessageModal(false);
    setSelectedRefundId(null);
    setActiveTab('overview');
    dispatch(clearCurrentRefund());
  };

  // ── KPI Cards ──────────────────────────────────────────────────────────────
  const renderKPICards = () => {
    if (!stats) {
      return [...Array(5)].map((_, i) => (
        <div key={i} className="ar-kpi-card ar-kpi-skeleton">
          <div className="ar-skeleton-icon" />
          <div className="ar-skeleton-text" style={{ width: '60%' }} />
          <div className="ar-skeleton-value" />
        </div>
      ));
    }

    // Fix: corrected key names to match controller response:
    //   stats.totalRequests → stats.total
    //   stats.pendingReview → stats.requested
    const kpiData = [
      { label: 'Total Requests', value: stats.total || 0,      icon: Assessment, color: 'neutral'  },
      { label: 'Pending Review', value: stats.requested || 0,  icon: Schedule,   color: 'warning'  },
      { label: 'Approved',       value: stats.approved || 0,   icon: CheckCircle, color: 'positive' },
      { label: 'Rejected',       value: stats.rejected || 0,   icon: Cancel,     color: 'neutral'  },
      { label: 'Completed',      value: stats.completed || 0,  icon: Inventory,  color: 'positive' },
    ];

    return kpiData.map((kpi, index) => (
      <div key={index} className="ar-kpi-card">
        <div className="ar-kpi-header">
          <div className={`ar-kpi-icon ${kpi.color}`}>
            <kpi.icon />
          </div>
        </div>
        <p className="ar-kpi-label">{kpi.label}</p>
        <h3 className="ar-kpi-value">{kpi.value.toLocaleString()}</h3>
      </div>
    ));
  };

  // ── Table ──────────────────────────────────────────────────────────────────
  const renderTable = () => {
    // Fix: use unreadLoading for the unread fetch path so the table skeleton
    // only shows when the table data itself is loading.
    const tableIsLoading = showUnreadOnly ? unreadLoading : refundsLoading;

    if (tableIsLoading) {
      return (
        <div className="ar-table-skeleton">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="ar-skeleton-row">
              {[...Array(4)].map((__, j) => (
                <div key={j} className="ar-skeleton-cell" />
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (!refunds || refunds.length === 0) {
      return (
        <div className="ar-empty-state">
          <div className="ar-empty-icon">💳</div>
          <h3 className="ar-empty-title">No refunds found</h3>
          <p className="ar-empty-desc">
            {showUnreadOnly
              ? 'No refunds with unread messages'
              : 'There are no refund requests at the moment'}
          </p>
        </div>
      );
    }

    return (
      <div className="ar-table-wrapper">
        <table className="ar-data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Messages</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((refundItem) => {
              // Fix: status lives at refundItem.refundInfo.status, not
              // refundItem.refundStatus (which doesn't exist in the response).
              const refundStatus = refundItem.refundInfo?.status || 'unknown';

              // Fix: no orderInfo object in response — use _id for the order ref.
              const orderRef = refundItem._id
                ? refundItem._id.toString().slice(-6).toUpperCase()
                : 'N/A';

              // Fix: response has unreadMessages (number), not hasUnreadMessages (bool).
              const hasUnread = (refundItem.unreadMessages || 0) > 0;

              return (
                <tr key={refundItem._id}>
                  <td className="ar-td-bold">#{orderRef}</td>
                  <td>{refundItem.user?.name || 'N/A'}</td>
                  <td>
                    ${refundItem.refundInfo?.requestedAmount?.toFixed(2) || '0.00'}
                  </td>
                  <td>
                    {refundItem.refundInfo?.reason?.replace(/_/g, ' ') || 'N/A'}
                  </td>
                  <td>
                    {refundItem.refundInfo?.requestedAt
                      ? new Date(refundItem.refundInfo.requestedAt).toLocaleDateString()
                      : 'N/A'}
                  </td>
                  <td>
                    <span className={`ar-badge ar-badge--${refundStatus.toLowerCase()}`}>
                      <span className="ar-badge-dot" />
                      {refundStatus}
                    </span>
                  </td>
                  <td>
                    <div className="ar-unread-wrap">
                      <Message style={{ fontSize: 18 }} />
                      {hasUnread && <span className="ar-unread-dot" />}
                    </div>
                  </td>
                  <td>
                    <div className="ar-row-actions">
                      <button
                        className="ar-icon-btn"
                        onClick={() => handleViewRefund(refundItem._id)}
                        title="View Details"
                      >
                        <Visibility style={{ fontSize: 18 }} />
                      </button>
                      {/* Fix: await getSingleRefund before opening modal
                          so currentRefund is not null when MessageModal renders */}
                      <button
                        className="ar-icon-btn"
                        onClick={() => handleOpenMessageModalFromRow(refundItem._id)}
                        title="Open Messages"
                      >
                        <Message style={{ fontSize: 18 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Detail Panel ───────────────────────────────────────────────────────────
  const renderDetailPanel = () => {
    if (!showDetailPanel) return null;

    // While the initial getSingleRefund is still loading, show a panel skeleton
    // rather than crashing on null currentRefund accesses.
    if (!currentRefund) {
      return (
        <div className="ar-drawer-overlay" onClick={handleClosePanel}>
          <div className="ar-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ar-panel-header">
              <h2 className="ar-panel-title">Loading refund details…</h2>
              <button className="ar-panel-close" onClick={handleClosePanel}>×</button>
            </div>
            <div className="ar-panel-body">
              <div className="ar-loading">
                <div className="ar-spinner" />
                <span>Fetching refund…</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Fix: currentRefund is the raw order object from getSingleRefund.
    // Fields are: _id, user, totalPrice, amountPaid, refundInfo, orderStatus, etc.
    // There is no orderInfo wrapper — use the fields directly.
    const orderRef = currentRefund._id
      ? currentRefund._id.toString().slice(-6).toUpperCase()
      : 'N/A';
    const refundStatus = currentRefund.refundInfo?.status || 'unknown';

    return (
      <div className="ar-drawer-overlay" onClick={handleClosePanel}>
        <div className="ar-drawer-panel" onClick={(e) => e.stopPropagation()}>
          <div className="ar-panel-header">
            <h2 className="ar-panel-title">Refund Details — #{orderRef}</h2>
            <button className="ar-panel-close" onClick={handleClosePanel}>×</button>
          </div>

          <div className="ar-panel-body">
            {/* Tab Nav */}
            <div className="ar-tab-nav">
              {['overview', 'review', 'process', 'timeline', 'documents'].map((tab) => (
                <button
                  key={tab}
                  className={`ar-tab-btn${activeTab === tab ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <>
                <div className="ar-section">
                  <h3 className="ar-section-title">Refund Information</h3>
                  <div className="ar-info-grid">
                    <div className="ar-info-item">
                      <span className="ar-info-label">Customer</span>
                      <span className="ar-info-value">{currentRefund.user?.name || 'N/A'}</span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Email</span>
                      <span className="ar-info-value">{currentRefund.user?.email || 'N/A'}</span>
                    </div>
                    {/* Fix: use currentRefund.totalPrice, not orderInfo.totalAmount */}
                    <div className="ar-info-item">
                      <span className="ar-info-label">Order Total</span>
                      <span className="ar-info-value">
                        ${currentRefund.totalPrice?.toFixed(2) ?? 'N/A'}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Amount Paid</span>
                      <span className="ar-info-value">
                        ${currentRefund.amountPaid?.toFixed(2) ?? 'N/A'}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Requested Amount</span>
                      <span className="ar-info-value">
                        ${currentRefund.refundInfo?.requestedAmount?.toFixed(2) ?? 'N/A'}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Refund Type</span>
                      <span className="ar-info-value">
                        {currentRefund.refundInfo?.refundType === 'full'
                          ? 'Full Refund'
                          : 'Partial Refund'}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Reason</span>
                      <span className="ar-info-value">
                        {currentRefund.refundInfo?.reason?.replace(/_/g, ' ') || 'N/A'}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Status</span>
                      <span className={`ar-badge ar-badge--${refundStatus.toLowerCase()}`}>
                        {refundStatus}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Requested On</span>
                      <span className="ar-info-value">
                        {currentRefund.refundInfo?.requestedAt
                          ? new Date(currentRefund.refundInfo.requestedAt).toLocaleString()
                          : 'N/A'}
                      </span>
                    </div>
                    {currentRefund.refundInfo?.adminNote && (
                      <div className="ar-info-item" style={{ gridColumn: '1 / -1' }}>
                        <span className="ar-info-label">Admin Note</span>
                        <span className="ar-info-value">
                          {currentRefund.refundInfo.adminNote}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {currentRefund.refundInfo?.description && (
                  <div className="ar-section">
                    <h3 className="ar-section-title">Customer Description</h3>
                    <p className="ar-desc-text">{currentRefund.refundInfo.description}</p>
                  </div>
                )}
              </>
            )}

            {/* Review Tab */}
            {activeTab === 'review' && (
              <div className="ar-section">
                <h3 className="ar-section-title">Review Refund Request</h3>

                {refundStatus !== 'requested' && (
                  <div className="ar-info-banner">
                    This refund is currently <strong>{refundStatus}</strong> and cannot
                    be re-reviewed.
                  </div>
                )}

                <div className="ar-form-group">
                  <label className="ar-form-label">Decision *</label>
                  <select
                    className="ar-form-select"
                    value={reviewAction}
                    onChange={(e) => setReviewAction(e.target.value)}
                    disabled={refundStatus !== 'requested'}
                  >
                    <option value="">Select action</option>
                    <option value="approve">Approve Refund</option>
                    <option value="reject">Reject Refund</option>
                  </select>
                </div>

                <div className="ar-form-group">
                  <label className="ar-form-label">Admin Note</label>
                  <textarea
                    className="ar-form-textarea"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add a note for the customer..."
                    disabled={refundStatus !== 'requested'}
                  />
                </div>

                <button
                  className={`ar-btn ${
                    reviewAction === 'approve' ? 'ar-btn--success' : 'ar-btn--danger'
                  }`}
                  onClick={handleReviewRefund}
                  disabled={!reviewAction || loading || refundStatus !== 'requested'}
                >
                  {loading
                    ? 'Processing...'
                    : `${reviewAction === 'approve' ? 'Approve' : 'Reject'} Refund`}
                </button>
              </div>
            )}

            {/* Process Tab */}
            {activeTab === 'process' && (
              <div className="ar-section">
                <h3 className="ar-section-title">Process Refund Payment</h3>

                {refundStatus !== 'approved' && (
                  <div className="ar-info-banner">
                    Refund must be <strong>approved</strong> before processing.
                    Current status: <strong>{refundStatus}</strong>.
                  </div>
                )}

                <div className="ar-form-group">
                  <label className="ar-form-label">Refund Amount ($) *</label>
                  <input
                    type="number"
                    className="ar-form-input"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(Number(e.target.value))}
                    min="0"
                    step="0.01"
                    max={currentRefund.amountPaid}
                    disabled={refundStatus !== 'approved'}
                  />
                  <span className="ar-helper-text">
                    Max refundable: ${currentRefund.amountPaid?.toFixed(2) ?? 'N/A'}
                  </span>
                </div>

                <div className="ar-form-group">
                  <label className="ar-form-label">Merchant Note</label>
                  <textarea
                    className="ar-form-textarea"
                    value={merchantNote}
                    onChange={(e) => setMerchantNote(e.target.value)}
                    placeholder="Internal note about this refund..."
                    disabled={refundStatus !== 'approved'}
                  />
                </div>

                <button
                  className="ar-btn ar-btn--primary"
                  onClick={handleProcessRefund}
                  disabled={!refundAmount || loading || refundStatus !== 'approved'}
                >
                  {loading ? 'Processing...' : 'Process Refund'}
                </button>
              </div>
            )}

            {/* Timeline Tab */}
            {activeTab === 'timeline' && (
              <div className="ar-section">
                <h3 className="ar-section-title">
                  <TimelineIcon style={{ marginRight: 8 }} />
                  Refund Timeline
                </h3>
                {timelineLoading ? (
                  <div className="ar-loading">
                    <div className="ar-spinner" />
                    <span>Loading timeline...</span>
                  </div>
                ) : timeline && timeline.length > 0 ? (
                  <div className="ar-timeline">
                    {timeline.map((event, idx) => (
                      <div key={idx} className="ar-timeline-item">
                        <div
                          className={`ar-timeline-dot${event.completed ? ' completed' : ''}`}
                        />
                        <div className="ar-timeline-content">
                          <h4 className="ar-timeline-title">{event.title}</h4>
                          {event.description && (
                            <p className="ar-timeline-desc">{event.description}</p>
                          )}
                          <span className="ar-timeline-time">
                            {new Date(event.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ar-empty-state">
                    <p>No timeline events yet</p>
                  </div>
                )}
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === 'documents' && (
              <div className="ar-section">
                <h3 className="ar-section-title">
                  <Description style={{ marginRight: 8 }} />
                  Documents &amp; Attachments
                </h3>

                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileUpload(Array.from(e.target.files))}
                  style={{ display: 'none' }}
                  id="ar-file-upload"
                />
                <label htmlFor="ar-file-upload">
                  <div className="ar-upload-zone">
                    <CloudUpload className="ar-upload-icon" />
                    <p className="ar-upload-text">Click to upload documents</p>
                  </div>
                </label>

                {uploadLoading && (
                  <div className="ar-loading" style={{ padding: '1rem' }}>
                    <div className="ar-spinner" />
                    <span>Uploading...</span>
                  </div>
                )}

                {documentsLoading ? (
                  <div className="ar-loading">
                    <div className="ar-spinner" />
                    <span>Loading documents...</span>
                  </div>
                ) : documents && documents.length > 0 ? (
                  <div className="ar-file-list">
                    {documents.map((doc, idx) => (
                      <div key={idx} className="ar-file-item">
                        <div className="ar-file-info">
                          <AttachFile style={{ fontSize: 18 }} />
                          <span>{doc.filename}</span>
                        </div>
                        <a href={doc.url} download className="ar-btn ar-btn--ghost">
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ar-empty-state">
                    <p>No documents uploaded yet</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ar-panel-footer">
            <button
              className="ar-btn ar-btn--primary"
              onClick={() => setShowMessageModal(true)}
            >
              <Message style={{ marginRight: 8, fontSize: 18 }} />
              Open Messages
            </button>
            <button className="ar-btn ar-btn--secondary" onClick={handleClosePanel}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main Render ────────────────────────────────────────────────────────────
  return (
    <div className="ar-container">
      {/* Header */}
      <header className="ar-header">
        <div className="ar-header-top">
          <h1 className="ar-header-title">Refunds Management</h1>
          <div className="ar-header-actions">
            <button className="ar-btn ar-btn--secondary" onClick={handleFetchRefunds}>
              <Refresh style={{ fontSize: 18 }} />
              Refresh
            </button>
          </div>
        </div>

        <div className="ar-controls">
          <div className="ar-filter-bar">
            {/* Search */}
            <div className="ar-search-wrap">
              <Search className="ar-search-icon" />
              <input
                type="text"
                className="ar-search-input"
                placeholder="Search by order ID or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Filter */}
            {/* Fix: added 'cancelled' option to match updated controller statuses */}
            <select
              className="ar-filter-select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All Statuses</option>
              <option value="requested">Requested</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            {/* Date Range */}
            <div className="ar-date-range">
              <input
                type="date"
                className="ar-date-input"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
              <span>to</span>
              <input
                type="date"
                className="ar-date-input"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>

            {/* Unread Toggle */}
            <div className="ar-toggle-wrap">
              <div
                className={`ar-toggle${showUnreadOnly ? ' active' : ''}`}
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              >
                <div className="ar-toggle-knob" />
              </div>
              <span className="ar-toggle-label">Unread Only</span>
            </div>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="ar-error-banner">
          <Warning className="ar-error-icon" />
          <div>
            <h4 className="ar-error-title">Error</h4>
            <p className="ar-error-msg">{error}</p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="ar-kpi-grid">{renderKPICards()}</div>

      {/* Table */}
      <div className="ar-table-container">{renderTable()}</div>

      {/* Detail Panel */}
      {renderDetailPanel()}

      {/* Message Modal — only render when currentRefund is populated */}
      {showMessageModal && currentRefund && (
        <MessageModal
          isOpen={showMessageModal}
          onClose={() => setShowMessageModal(false)}
          orderId={selectedRefundId}
          orderInfo={{
            // Fix: use _id directly since there is no orderInfo wrapper
            orderNumber: currentRefund._id?.toString().slice(-6).toUpperCase(),
            customerName: currentRefund.user?.name,
            date: currentRefund.refundInfo?.requestedAt
              ? new Date(currentRefund.refundInfo.requestedAt).toLocaleDateString()
              : 'N/A',
          }}
          messages={messages}
          onSendMessage={handleSendMessage}
          loading={messagesLoading}
          currentUserRole="admin"
        />
      )}

      {/* Success Toast — auto-dismissed after 3 s via the useEffect above */}
      {success && successMessage && (
        <div className="ar-toast-container">
          <div className="ar-toast ar-toast--success">
            <CheckCircle className="ar-toast-icon" />
            <div>
              <h4 className="ar-toast-title">Success</h4>
              <p className="ar-toast-msg">{successMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRefunds;