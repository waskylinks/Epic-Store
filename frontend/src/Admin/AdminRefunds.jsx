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
  Schedule
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
  clearCurrentRefund
} from '../features/admin/adminRefundSlice';
import MessageModal from '../Orders/RefundReturnMessagesModal';
import '../AdminStyles/AdminRefunds.css';

const AdminRefunds = () => {
  const dispatch = useDispatch();

  // Redux state
  const {
    refunds,
    stats,
    currentRefund,
    messages,
    timeline,
    documents,
    loading,
    refundsLoading,
    messagesLoading,
    timelineLoading,
    documentsLoading,
    uploadLoading,
    error,
    success,
    message: successMessage
  } = useSelector(state => state.adminRefund);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    startDate: '',
    endDate: ''
  });
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedRefund, setSelectedRefund] = useState(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Review form state
  const [reviewAction, setReviewAction] = useState('');
  const [adminNote, setAdminNote] = useState('');

  // Process refund state
  const [refundAmount, setRefundAmount] = useState(0);
  const [merchantNote, setMerchantNote] = useState('');

  // Pagination
  const [currentPage] = useState(1);
  const itemsPerPage = 20;

  // Fetch refunds — stable reference via useCallback
  const handleFetchRefunds = useCallback(() => {
    const queryFilters = {
      ...filters,
      search: searchQuery,
      page: currentPage,
      limit: itemsPerPage
    };

    if (showUnreadOnly) {
      dispatch(getRefundsWithUnreadMessages());
    } else {
      dispatch(getAllRefunds(queryFilters));
    }
  }, [filters, searchQuery, showUnreadOnly, currentPage, dispatch]);

  // Fetch on mount
  useEffect(() => {
    handleFetchRefunds();
  }, [handleFetchRefunds]);

  // Handle view refund details
  const handleViewRefund = async (orderId) => {
    setSelectedRefund(orderId);
    setShowDetailPanel(true);

    await dispatch(getSingleRefund(orderId));
    dispatch(getRefundTimeline(orderId));
    dispatch(getRefundDocuments(orderId));
    dispatch(getRefundMessages(orderId));
  };

  // Handle review refund
  const handleReviewRefund = async () => {
    if (!reviewAction) return;

    try {
      await dispatch(reviewRefund({
        orderId: selectedRefund,
        action: reviewAction,
        adminNote
      })).unwrap();

      setReviewAction('');
      setAdminNote('');

      handleFetchRefunds();
      handleViewRefund(selectedRefund);
    } catch (err) {
      console.error('Failed to review refund:', err);
    }
  };

  // Handle process refund
  const handleProcessRefund = async () => {
    if (!refundAmount) return;

    try {
      await dispatch(processRefund({
        orderId: selectedRefund,
        refundAmount,
        merchantNote
      })).unwrap();

      setRefundAmount(0);
      setMerchantNote('');

      handleFetchRefunds();
      handleViewRefund(selectedRefund);
    } catch (err) {
      console.error('Failed to process refund:', err);
    }
  };

  // Handle send message
  const handleSendMessage = async (content, attachments) => {
    try {
      await dispatch(addRefundMessage({
        orderId: selectedRefund,
        content,
        attachments
      })).unwrap();

      dispatch(getRefundMessages(selectedRefund));
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // Handle file upload
  const handleFileUpload = async (files) => {
    try {
      await dispatch(uploadRefundFiles({
        orderId: selectedRefund,
        files
      })).unwrap();

      dispatch(getRefundDocuments(selectedRefund));
    } catch (err) {
      console.error('Failed to upload files:', err);
    }
  };

  // Close detail panel
  const handleClosePanel = () => {
    setShowDetailPanel(false);
    setSelectedRefund(null);
    setActiveTab('overview');
    dispatch(clearCurrentRefund());
  };

  // ─── Render KPI Cards ──────────────────────────────────────────────────────
  const renderKPICards = () => {
    if (!stats) {
      return [...Array(5)].map((_, i) => (
        <div key={i} className="ar-kpi-card ar-kpi-skeleton">
          <div className="ar-skeleton-icon"></div>
          <div className="ar-skeleton-text" style={{ width: '60%' }}></div>
          <div className="ar-skeleton-value"></div>
        </div>
      ));
    }

    const kpiData = [
      { label: 'Total Requests', value: stats.totalRequests || 0, icon: Assessment, color: 'neutral' },
      { label: 'Pending Review', value: stats.pendingReview || 0, icon: Schedule, color: 'warning' },
      { label: 'Approved', value: stats.approved || 0, icon: CheckCircle, color: 'positive' },
      { label: 'Rejected', value: stats.rejected || 0, icon: Cancel, color: 'neutral' },
      { label: 'Completed', value: stats.completed || 0, icon: Inventory, color: 'positive' }
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

  // ─── Render Table ──────────────────────────────────────────────────────────
  const renderTable = () => {
    if (refundsLoading) {
      return (
        <div className="ar-table-skeleton">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="ar-skeleton-row">
              {[...Array(4)].map((__, j) => (
                <div key={j} className="ar-skeleton-cell"></div>
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
            {refunds.map((refundItem) => (
              <tr key={refundItem._id}>
                <td className="ar-td-bold">
                  #{refundItem.orderInfo?.orderNumber || refundItem._id.slice(-6)}
                </td>
                <td>{refundItem.user?.name || 'N/A'}</td>
                <td>${refundItem.refundInfo?.requestedAmount?.toFixed(2) || '0.00'}</td>
                <td>{refundItem.refundInfo?.reason || 'N/A'}</td>
                <td>{new Date(refundItem.refundInfo?.requestedAt).toLocaleDateString()}</td>
                <td>
                  <span className={`ar-badge ar-badge--${refundItem.refundStatus?.toLowerCase()}`}>
                    <span className="ar-badge-dot"></span>
                    {refundItem.refundStatus}
                  </span>
                </td>
                <td>
                  <div className="ar-unread-wrap">
                    <Message style={{ fontSize: 18 }} />
                    {refundItem.hasUnreadMessages && <span className="ar-unread-dot"></span>}
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
                    <button
                      className="ar-icon-btn"
                      onClick={() => {
                        handleViewRefund(refundItem._id);
                        setShowMessageModal(true);
                      }}
                      title="Open Messages"
                    >
                      <Message style={{ fontSize: 18 }} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Render Detail Panel ───────────────────────────────────────────────────
  const renderDetailPanel = () => {
    if (!showDetailPanel || !currentRefund) return null;

    return (
      <div className="ar-drawer-overlay" onClick={handleClosePanel}>
        <div className="ar-drawer-panel" onClick={(e) => e.stopPropagation()}>
          <div className="ar-panel-header">
            <h2 className="ar-panel-title">
              Refund Details — #{currentRefund.orderInfo?.orderNumber}
            </h2>
            <button className="ar-panel-close" onClick={handleClosePanel}>×</button>
          </div>

          <div className="ar-panel-body">
            {/* Tab Nav */}
            <div className="ar-tab-nav">
              {['overview', 'review', 'process', 'timeline', 'documents'].map(tab => (
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
                      <span className="ar-info-value">{currentRefund.user?.name}</span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Email</span>
                      <span className="ar-info-value">{currentRefund.user?.email}</span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Order Total</span>
                      <span className="ar-info-value">
                        ${currentRefund.orderInfo?.totalAmount?.toFixed(2)}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Requested Amount</span>
                      <span className="ar-info-value">
                        ${currentRefund.refundInfo?.requestedAmount?.toFixed(2)}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Reason</span>
                      <span className="ar-info-value">{currentRefund.refundInfo?.reason}</span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Status</span>
                      <span className={`ar-badge ar-badge--${currentRefund.refundStatus?.toLowerCase()}`}>
                        {currentRefund.refundStatus}
                      </span>
                    </div>
                    <div className="ar-info-item">
                      <span className="ar-info-label">Requested On</span>
                      <span className="ar-info-value">
                        {new Date(currentRefund.refundInfo?.requestedAt).toLocaleString()}
                      </span>
                    </div>
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
                <div className="ar-form-group">
                  <label className="ar-form-label">Decision *</label>
                  <select
                    className="ar-form-select"
                    value={reviewAction}
                    onChange={(e) => setReviewAction(e.target.value)}
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
                  />
                </div>

                <button
                  className={`ar-btn ${reviewAction === 'approve' ? 'ar-btn--success' : 'ar-btn--danger'}`}
                  onClick={handleReviewRefund}
                  disabled={!reviewAction || loading}
                >
                  {loading ? 'Processing...' : `${reviewAction === 'approve' ? 'Approve' : 'Reject'} Refund`}
                </button>
              </div>
            )}

            {/* Process Tab */}
            {activeTab === 'process' && (
              <div className="ar-section">
                <h3 className="ar-section-title">Process Refund Payment</h3>
                <div className="ar-form-group">
                  <label className="ar-form-label">Refund Amount ($) *</label>
                  <input
                    type="number"
                    className="ar-form-input"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(Number(e.target.value))}
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="ar-form-group">
                  <label className="ar-form-label">Merchant Note</label>
                  <textarea
                    className="ar-form-textarea"
                    value={merchantNote}
                    onChange={(e) => setMerchantNote(e.target.value)}
                    placeholder="Internal note about this refund..."
                  />
                </div>

                <button
                  className="ar-btn ar-btn--primary"
                  onClick={handleProcessRefund}
                  disabled={!refundAmount || loading}
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
                    <div className="ar-spinner"></div>
                    <span>Loading timeline...</span>
                  </div>
                ) : timeline && timeline.length > 0 ? (
                  <div className="ar-timeline">
                    {timeline.map((event, idx) => (
                      <div key={idx} className="ar-timeline-item">
                        <div className={`ar-timeline-dot${event.completed ? ' completed' : ''}`}></div>
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
                    <div className="ar-spinner"></div>
                    <span>Uploading...</span>
                  </div>
                )}

                {documentsLoading ? (
                  <div className="ar-loading">
                    <div className="ar-spinner"></div>
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
            <button className="ar-btn ar-btn--primary" onClick={() => setShowMessageModal(true)}>
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

  // ─── Main Render ───────────────────────────────────────────────────────────
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
                <div className="ar-toggle-knob"></div>
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

      {/* Message Modal */}
      {showMessageModal && currentRefund && (
        <MessageModal
          isOpen={showMessageModal}
          onClose={() => setShowMessageModal(false)}
          orderId={selectedRefund}
          orderInfo={{
            orderNumber: currentRefund.orderInfo?.orderNumber,
            customerName: currentRefund.user?.name,
            date: new Date(currentRefund.refundInfo?.requestedAt).toLocaleDateString()
          }}
          messages={messages}
          onSendMessage={handleSendMessage}
          loading={messagesLoading}
          currentUserRole="admin"
        />
      )}

      {/* Success Toast */}
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