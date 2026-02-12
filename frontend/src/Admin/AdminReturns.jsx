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
  getAllReturns,
  getSingleReturn,
  reviewReturn,
  updateReturnStatus,
  addReturnMessage,
  getReturnMessages,
  getReturnTimeline,
  getReturnDocuments,
  uploadReturnFiles,
  getReturnsWithUnreadMessages,
  clearCurrentReturn
} from '../features/admin/adminReturnSlice';
import MessageModal from '../Orders/RefundReturnMessagesModal';
import '../AdminStyles/AdminReturns.css';

const AdminReturns = () => {
  const dispatch = useDispatch();

  // Redux state
  const {
    returns,
    stats,
    currentReturn,
    messages,
    timeline,
    documents,
    loading,
    returnsLoading,
    messagesLoading,
    timelineLoading,
    documentsLoading,
    uploadLoading,
    error,
    success,
    message: successMessage
  } = useSelector(state => state.adminReturn);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    reason: '',
    startDate: '',
    endDate: ''
  });
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Review form state
  const [reviewAction, setReviewAction] = useState('');
  const [restockFee, setRestockFee] = useState(0);
  const [adminNote, setAdminNote] = useState('');

  // Status update state
  const [newStatus, setNewStatus] = useState('');
  const [inspectionNotes, setInspectionNotes] = useState('');

  // Pagination
  const [currentPage] = useState(1);
  const itemsPerPage = 20;

  // Fetch returns — stable reference via useCallback
  const handleFetchReturns = useCallback(() => {
    const queryFilters = {
      ...filters,
      search: searchQuery,
      page: currentPage,
      limit: itemsPerPage
    };

    if (showUnreadOnly) {
      dispatch(getReturnsWithUnreadMessages());
    } else {
      dispatch(getAllReturns(queryFilters));
    }
  }, [filters, searchQuery, showUnreadOnly, currentPage, dispatch]);

  // Fetch on mount + whenever deps change
  useEffect(() => {
    handleFetchReturns();
  }, [handleFetchReturns]);

  // Handle view return details
  const handleViewReturn = async (orderId) => {
    setSelectedReturn(orderId);
    setShowDetailPanel(true);

    await dispatch(getSingleReturn(orderId));
    dispatch(getReturnTimeline(orderId));
    dispatch(getReturnDocuments(orderId));
    dispatch(getReturnMessages(orderId));
  };

  // Handle review return
  const handleReviewReturn = async () => {
    if (!reviewAction) return;

    try {
      await dispatch(reviewReturn({
        orderId: selectedReturn,
        action: reviewAction,
        restockFee: reviewAction === 'approve' ? restockFee : 0,
        adminNote
      })).unwrap();

      setReviewAction('');
      setRestockFee(0);
      setAdminNote('');

      handleFetchReturns();
      handleViewReturn(selectedReturn);
    } catch (err) {
      console.error('Failed to review return:', err);
    }
  };

  // Handle status update
  const handleUpdateStatus = async () => {
    if (!newStatus) return;

    try {
      await dispatch(updateReturnStatus({
        orderId: selectedReturn,
        status: newStatus,
        inspectionNotes
      })).unwrap();

      setNewStatus('');
      setInspectionNotes('');

      handleFetchReturns();
      handleViewReturn(selectedReturn);
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  // Handle send message
  const handleSendMessage = async (content, attachments) => {
    try {
      await dispatch(addReturnMessage({
        orderId: selectedReturn,
        content,
        attachments
      })).unwrap();

      dispatch(getReturnMessages(selectedReturn));
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // Handle file upload
  const handleFileUpload = async (files) => {
    try {
      await dispatch(uploadReturnFiles({
        orderId: selectedReturn,
        files
      })).unwrap();

      dispatch(getReturnDocuments(selectedReturn));
    } catch (err) {
      console.error('Failed to upload files:', err);
    }
  };

  // Close detail panel
  const handleClosePanel = () => {
    setShowDetailPanel(false);
    setSelectedReturn(null);
    setActiveTab('overview');
    dispatch(clearCurrentReturn());
  };

  // ─── Render KPI Cards ──────────────────────────────────────────────────────
  const renderKPICards = () => {
    if (!stats) {
      return [...Array(6)].map((_, i) => (
        <div key={i} className="art-kpi-card art-kpi-skeleton">
          <div className="art-skeleton-icon"></div>
          <div className="art-skeleton-text" style={{ width: '60%' }}></div>
          <div className="art-skeleton-value"></div>
        </div>
      ));
    }

    const kpiData = [
      { label: 'Total Requests',  value: stats.totalRequests  || 0, icon: Assessment,  color: 'neutral'  },
      { label: 'Pending Approval', value: stats.pendingApproval || 0, icon: Schedule,    color: 'warning'  },
      { label: 'Approved',        value: stats.approved       || 0, icon: CheckCircle,  color: 'positive' },
      { label: 'Rejected',        value: stats.rejected       || 0, icon: Cancel,       color: 'neutral'  },
      { label: 'Items Received',  value: stats.received       || 0, icon: Inventory,    color: 'neutral'  },
      { label: 'Completed',       value: stats.completed      || 0, icon: CheckCircle,  color: 'positive' }
    ];

    return kpiData.map((kpi, index) => (
      <div key={index} className="art-kpi-card">
        <div className="art-kpi-header">
          <div className={`art-kpi-icon ${kpi.color}`}>
            <kpi.icon />
          </div>
        </div>
        <p className="art-kpi-label">{kpi.label}</p>
        <h3 className="art-kpi-value">{kpi.value.toLocaleString()}</h3>
      </div>
    ));
  };

  // ─── Render Table ──────────────────────────────────────────────────────────
  const renderTable = () => {
    if (returnsLoading) {
      return (
        <div className="art-table-skeleton">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="art-skeleton-row">
              {[...Array(4)].map((__, j) => (
                <div key={j} className="art-skeleton-cell"></div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (!returns || returns.length === 0) {
      return (
        <div className="art-empty-state">
          <div className="art-empty-icon">📦</div>
          <h3 className="art-empty-title">No returns found</h3>
          <p className="art-empty-desc">
            {showUnreadOnly
              ? 'No returns with unread messages'
              : 'There are no return requests at the moment'}
          </p>
        </div>
      );
    }

    return (
      <div className="art-table-wrapper">
        <table className="art-data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Products</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Inspection</th>
              <th>Messages</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((returnItem) => (
              <tr key={returnItem._id}>
                <td className="art-td-bold">
                  #{returnItem.orderInfo?.orderNumber || returnItem._id.slice(-6)}
                </td>
                <td>{returnItem.user?.name || 'N/A'}</td>
                <td>{returnItem.items?.length || 0} items</td>
                <td>{returnItem.returnReason || 'N/A'}</td>
                <td>{new Date(returnItem.requestedAt).toLocaleDateString()}</td>
                <td>
                  <span className={`art-badge art-badge--${returnItem.returnStatus?.toLowerCase()}`}>
                    <span className="art-badge-dot"></span>
                    {returnItem.returnStatus}
                  </span>
                </td>
                <td>
                  {returnItem.inspectionStatus ? (
                    <span className={`art-badge art-badge--${returnItem.inspectionStatus.toLowerCase()}`}>
                      {returnItem.inspectionStatus}
                    </span>
                  ) : (
                    <span className="art-dash">—</span>
                  )}
                </td>
                <td>
                  <div className="art-unread-wrap">
                    <Message style={{ fontSize: 18 }} />
                    {returnItem.hasUnreadMessages && <span className="art-unread-dot"></span>}
                  </div>
                </td>
                <td>
                  <div className="art-row-actions">
                    <button
                      className="art-icon-btn"
                      onClick={() => handleViewReturn(returnItem._id)}
                      title="View Details"
                    >
                      <Visibility style={{ fontSize: 18 }} />
                    </button>
                    <button
                      className="art-icon-btn"
                      onClick={() => {
                        handleViewReturn(returnItem._id);
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
    if (!showDetailPanel || !currentReturn) return null;

    return (
      <div className="art-drawer-overlay" onClick={handleClosePanel}>
        <div className="art-drawer-panel" onClick={(e) => e.stopPropagation()}>
          <div className="art-panel-header">
            <h2 className="art-panel-title">
              Return Details — #{currentReturn.orderInfo?.orderNumber}
            </h2>
            <button className="art-panel-close" onClick={handleClosePanel}>×</button>
          </div>

          <div className="art-panel-body">
            {/* Tab Nav */}
            <div className="art-tab-nav">
              {['overview', 'review', 'status', 'timeline', 'documents'].map(tab => (
                <button
                  key={tab}
                  className={`art-tab-btn${activeTab === tab ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'status' ? 'Status Update' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <>
                <div className="art-section">
                  <h3 className="art-section-title">Return Information</h3>
                  <div className="art-info-grid">
                    <div className="art-info-item">
                      <span className="art-info-label">Customer</span>
                      <span className="art-info-value">{currentReturn.user?.name}</span>
                    </div>
                    <div className="art-info-item">
                      <span className="art-info-label">Email</span>
                      <span className="art-info-value">{currentReturn.user?.email}</span>
                    </div>
                    <div className="art-info-item">
                      <span className="art-info-label">Order Total</span>
                      <span className="art-info-value">
                        ${currentReturn.orderInfo?.totalAmount?.toFixed(2)}
                      </span>
                    </div>
                    <div className="art-info-item">
                      <span className="art-info-label">Return Reason</span>
                      <span className="art-info-value">{currentReturn.returnReason}</span>
                    </div>
                    <div className="art-info-item">
                      <span className="art-info-label">Status</span>
                      <span className={`art-badge art-badge--${currentReturn.returnStatus?.toLowerCase()}`}>
                        {currentReturn.returnStatus}
                      </span>
                    </div>
                    <div className="art-info-item">
                      <span className="art-info-label">Requested On</span>
                      <span className="art-info-value">
                        {new Date(currentReturn.requestedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="art-section">
                  <h3 className="art-section-title">Items to Return</h3>
                  {currentReturn.items?.map((item, idx) => (
                    <div key={idx} className="art-item-row">
                      <div className="art-item-name">{item.name}</div>
                      <div className="art-item-meta">
                        Quantity: {item.quantity} &bull; Price: ${item.price?.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Review Tab */}
            {activeTab === 'review' && (
              <div className="art-section">
                <h3 className="art-section-title">Review Return Request</h3>
                <div className="art-form-group">
                  <label className="art-form-label">Decision *</label>
                  <select
                    className="art-form-select"
                    value={reviewAction}
                    onChange={(e) => setReviewAction(e.target.value)}
                  >
                    <option value="">Select action</option>
                    <option value="approve">Approve Return</option>
                    <option value="reject">Reject Return</option>
                  </select>
                </div>

                {reviewAction === 'approve' && (
                  <div className="art-form-group">
                    <label className="art-form-label">Restock Fee ($)</label>
                    <input
                      type="number"
                      className="art-form-input"
                      value={restockFee}
                      onChange={(e) => setRestockFee(Number(e.target.value))}
                      min="0"
                      step="0.01"
                    />
                  </div>
                )}

                <div className="art-form-group">
                  <label className="art-form-label">Admin Note</label>
                  <textarea
                    className="art-form-textarea"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add any notes for the customer..."
                  />
                </div>

                <button
                  className={`art-btn ${reviewAction === 'approve' ? 'art-btn--success' : 'art-btn--danger'}`}
                  onClick={handleReviewReturn}
                  disabled={!reviewAction || loading}
                >
                  {loading ? 'Processing...' : `${reviewAction === 'approve' ? 'Approve' : 'Reject'} Return`}
                </button>
              </div>
            )}

            {/* Status Update Tab */}
            {activeTab === 'status' && (
              <div className="art-section">
                <h3 className="art-section-title">Update Return Status</h3>
                <div className="art-form-group">
                  <label className="art-form-label">New Status *</label>
                  <select
                    className="art-form-select"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                  >
                    <option value="">Select status</option>
                    <option value="approved">Approved</option>
                    <option value="in-transit">In Transit</option>
                    <option value="received">Received at Warehouse</option>
                    <option value="inspected">Under Inspection</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>

                <div className="art-form-group">
                  <label className="art-form-label">Inspection Notes</label>
                  <textarea
                    className="art-form-textarea"
                    value={inspectionNotes}
                    onChange={(e) => setInspectionNotes(e.target.value)}
                    placeholder="Add inspection findings or notes..."
                  />
                </div>

                <button
                  className="art-btn art-btn--primary"
                  onClick={handleUpdateStatus}
                  disabled={!newStatus || loading}
                >
                  {loading ? 'Updating...' : 'Update Status'}
                </button>
              </div>
            )}

            {/* Timeline Tab */}
            {activeTab === 'timeline' && (
              <div className="art-section">
                <h3 className="art-section-title">
                  <TimelineIcon style={{ marginRight: 8 }} />
                  Return Timeline
                </h3>
                {timelineLoading ? (
                  <div className="art-loading">
                    <div className="art-spinner"></div>
                    <span>Loading timeline...</span>
                  </div>
                ) : timeline && timeline.length > 0 ? (
                  <div className="art-timeline">
                    {timeline.map((event, idx) => (
                      <div key={idx} className="art-timeline-item">
                        <div className={`art-timeline-dot${event.completed ? ' completed' : ''}`}></div>
                        <div className="art-timeline-content">
                          <h4 className="art-timeline-title">{event.title}</h4>
                          {event.description && (
                            <p className="art-timeline-desc">{event.description}</p>
                          )}
                          <span className="art-timeline-time">
                            {new Date(event.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="art-empty-state">
                    <p>No timeline events yet</p>
                  </div>
                )}
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === 'documents' && (
              <div className="art-section">
                <h3 className="art-section-title">
                  <Description style={{ marginRight: 8 }} />
                  Documents &amp; Attachments
                </h3>

                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileUpload(Array.from(e.target.files))}
                  style={{ display: 'none' }}
                  id="art-file-upload"
                />
                <label htmlFor="art-file-upload">
                  <div className="art-upload-zone">
                    <CloudUpload className="art-upload-icon" />
                    <p className="art-upload-text">Click to upload documents</p>
                  </div>
                </label>

                {uploadLoading && (
                  <div className="art-loading" style={{ padding: '1rem' }}>
                    <div className="art-spinner"></div>
                    <span>Uploading...</span>
                  </div>
                )}

                {documentsLoading ? (
                  <div className="art-loading">
                    <div className="art-spinner"></div>
                    <span>Loading documents...</span>
                  </div>
                ) : documents && documents.length > 0 ? (
                  <div className="art-file-list">
                    {documents.map((doc, idx) => (
                      <div key={idx} className="art-file-item">
                        <div className="art-file-info">
                          <AttachFile style={{ fontSize: 18 }} />
                          <span>{doc.filename}</span>
                        </div>
                        <a href={doc.url} download className="art-btn art-btn--ghost">
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="art-empty-state">
                    <p>No documents uploaded yet</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="art-panel-footer">
            <button className="art-btn art-btn--primary" onClick={() => setShowMessageModal(true)}>
              <Message style={{ marginRight: 8, fontSize: 18 }} />
              Open Messages
            </button>
            <button className="art-btn art-btn--secondary" onClick={handleClosePanel}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Main Render ───────────────────────────────────────────────────────────
  return (
    <div className="art-container">
      {/* Header */}
      <header className="art-header">
        <div className="art-header-top">
          <h1 className="art-header-title">Returns Management</h1>
          <div className="art-header-actions">
            <button className="art-btn art-btn--secondary" onClick={handleFetchReturns}>
              <Refresh style={{ fontSize: 18 }} />
              Refresh
            </button>
          </div>
        </div>

        <div className="art-controls">
          <div className="art-filter-bar">
            {/* Search */}
            <div className="art-search-wrap">
              <Search className="art-search-icon" />
              <input
                type="text"
                className="art-search-input"
                placeholder="Search by order ID or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Filter */}
            <select
              className="art-filter-select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All Statuses</option>
              <option value="requested">Requested</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="in-transit">In Transit</option>
              <option value="received">Received</option>
              <option value="inspected">Inspected</option>
              <option value="completed">Completed</option>
            </select>

            {/* Reason Filter */}
            <select
              className="art-filter-select"
              value={filters.reason}
              onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
            >
              <option value="">All Reasons</option>
              <option value="defective">Defective</option>
              <option value="wrong-item">Wrong Item</option>
              <option value="not-as-described">Not as Described</option>
              <option value="changed-mind">Changed Mind</option>
              <option value="other">Other</option>
            </select>

            {/* Date Range */}
            <div className="art-date-range">
              <input
                type="date"
                className="art-date-input"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
              <span>to</span>
              <input
                type="date"
                className="art-date-input"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>

            {/* Unread Toggle */}
            <div className="art-toggle-wrap">
              <div
                className={`art-toggle${showUnreadOnly ? ' active' : ''}`}
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              >
                <div className="art-toggle-knob"></div>
              </div>
              <span className="art-toggle-label">Unread Messages Only</span>
            </div>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="art-error-banner">
          <Warning className="art-error-icon" />
          <div>
            <h4 className="art-error-title">Error</h4>
            <p className="art-error-msg">{error}</p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="art-kpi-grid">{renderKPICards()}</div>

      {/* Table */}
      <div className="art-table-container">{renderTable()}</div>

      {/* Detail Panel */}
      {renderDetailPanel()}

      {/* Message Modal */}
      {showMessageModal && currentReturn && (
        <MessageModal
          isOpen={showMessageModal}
          onClose={() => setShowMessageModal(false)}
          orderId={selectedReturn}
          orderInfo={{
            orderNumber: currentReturn.orderInfo?.orderNumber,
            customerName: currentReturn.user?.name,
            date: new Date(currentReturn.requestedAt).toLocaleDateString()
          }}
          messages={messages}
          onSendMessage={handleSendMessage}
          loading={messagesLoading}
          currentUserRole="admin"
        />
      )}

      {/* Success Toast */}
      {success && successMessage && (
        <div className="art-toast-container">
          <div className="art-toast art-toast--success">
            <CheckCircle className="art-toast-icon" />
            <div>
              <h4 className="art-toast-title">Success</h4>
              <p className="art-toast-msg">{successMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminReturns;