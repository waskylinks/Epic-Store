import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FiPackage,
  FiAlertCircle,
  FiCheckCircle,
  FiClock,
  FiSend,
  FiPaperclip,
  FiX,
  FiFile,
  FiVideo,
  FiMessageSquare,
  FiDollarSign,
  FiInfo,
  FiArrowLeft,
} from 'react-icons/fi';

import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import RefundReturnMessagesModal from './RefundReturnMessagesModal';

import { getOrderDetails } from '../features/cart/orderSlice';
import {
  requestRefund,
  // BUG 1 FIX: addRefundMessage does not exist in the slice.
  // The slice exposes sendRefundMessage which handles upload + send atomically.
  // BUG 9 FIX: remove uploadRefundFiles as a separate dispatch — sendRefundMessage
  // calls the upload endpoint internally; splitting them here bypassed the
  // partial-failure / retry logic built into the thunk.
  sendRefundMessage,
  getRefundMessages,
  clearRefundState,
} from '../features/refunds/refundSlice';

import '../OrderStyles/RefundRequest.css';

const REFUND_REASONS = [
  { value: 'defective_product',    label: 'Defective or Damaged Product' },
  { value: 'wrong_item',           label: 'Wrong Item Received' },
  { value: 'not_as_described',     label: 'Product Not As Described' },
  { value: 'damaged_in_shipping',  label: 'Damaged During Shipping' },
  { value: 'changed_mind',         label: 'Changed My Mind' },
  { value: 'duplicate_order',      label: 'Duplicate Order' },
  { value: 'unauthorized_purchase',label: 'Unauthorized Purchase' },
  { value: 'other',                label: 'Other' },
];

const MAX_FILES = 5;
const ALLOWED_FILE_TYPES = {
  images:    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos:    ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf'],
};
// FIX-2: flat allowed-types array at module level — avoids rebuilding on every
// isFileTypeAllowed call (was spread inside the function body each invocation).
const ALL_ALLOWED_RR = [
  ...ALLOWED_FILE_TYPES.images,
  ...ALLOWED_FILE_TYPES.videos,
  ...ALLOWED_FILE_TYPES.documents,
];

// ── Status badge ────────────────────────────────────────────────────────────
const RefundStatusBadge = ({ status }) => {
  const configs = {
    none:       { label: 'No Refund',        className: 'rr-refund-badge-none',       icon: '○' },
    requested:  { label: 'Refund Requested', className: 'rr-refund-badge-requested',  icon: '⏳' },
    approved:   { label: 'Approved',         className: 'rr-refund-badge-approved',   icon: '✓' },
    rejected:   { label: 'Rejected',         className: 'rr-refund-badge-rejected',   icon: '✗' },
    processing: { label: 'Processing',       className: 'rr-refund-badge-processing', icon: '⟳' },
    completed:  { label: 'Refunded',         className: 'rr-refund-badge-completed',  icon: '✓' },
    failed:     { label: 'Failed',           className: 'rr-refund-badge-failed',     icon: '✗' },
    cancelled:  { label: 'Cancelled',        className: 'rr-refund-badge-cancelled',  icon: '○' },
  };
  const config = configs[status] || configs.none;
  return (
    <span className={`rr-refund-badge ${config.className}`}>
      <span className="rr-refund-badge-icon">{config.icon}</span>
      <span className="rr-refund-badge-label">{config.label}</span>
    </span>
  );
};

// ── Component ────────────────────────────────────────────────────────────────
function RefundRequest() {
  const { id: orderId } = useParams();
  const navigate        = useNavigate();
  const dispatch        = useDispatch();
  const fileInputRef    = useRef(null);
  const location        = useLocation();

  const { order, loading: orderLoading } = useSelector((state) => state.order);

  const {
    messages,
    // BUG 11 FIX: requestRefund sets `loading`, not `uploadLoading`.
    // uploadLoading is only set by the standalone uploadRefundFiles thunk
    // which is no longer dispatched from this component. Removed uploadLoading
    // from the selector to avoid reading a flag that is never true here.
    loading,
    messagesLoading,
    // BUG 6 FIX: `error` removed from selector. The global useEffect that
    // watched state.refund.error caused double-toasts (watcher + per-action
    // catch). All error display is now handled in each action's own catch block.
  } = useSelector((state) => state.refund);

  const [formData, setFormData] = useState({
    reason: '',
    description: '',
    refundType: 'full',
    requestedAmount: '',
  });

  const [formErrors,    setFormErrors]    = useState({});
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews,  setFilePreviews]  = useState([]);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [unreadCount,   setUnreadCount]   = useState(0);

  // FIX-6: also exclude 'failed' — a failed refund should allow the customer
  // to re-submit rather than showing a read-only status view with no action.
  const hasActiveRefund =
    order?.refundInfo?.status &&
    order.refundInfo.status !== 'none' &&
    order.refundInfo.status !== 'cancelled' &&
    order.refundInfo.status !== 'failed';
  const isTracking = hasActiveRefund;

  const fromMyRefunds = location.state?.from === 'my-refunds-returns';
  const backPath      = fromMyRefunds ? '/my-refunds-returns' : `/order/${orderId}`;
  const backLabel     = fromMyRefunds ? 'Back' : 'Back to Order Details';

  // ── Initial data fetch ───────────────────────────────────────────────────
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  // getRefundMessages is intentionally NOT called on mount.
  // The controller marks all admin messages isRead:true on every fetch, so a
  // mount fetch would immediately zero the unread badge before the user sees it.
  // Correct lifecycle:
  //   Mount   → unreadCount derived from messages already in Redux (last session).
  //   Modal open → onRefresh → getRefundMessages → server marks admin msgs read
  //             → Redux updates with isRead:true → unreadCount=0 → badge clears.
  // "Read" therefore means "user opened the modal", which is the intended UX.

  // ── Unread badge ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (messages && messages.length > 0) {
      // BUG 3 FIX: the schema has no `readBy` array. The correct field is `isRead`
      // (Boolean). Using readBy?.includes('customer') always returns undefined,
      // making every admin message appear unread regardless of actual read state.
      const unread = messages.filter(
        (msg) => msg.senderType === 'admin' && !msg.isRead
      ).length;
      setUnreadCount(unread);
    } else {
      setUnreadCount(0);
    }
  }, [messages]);

  // ── Pre-fill form when viewing an existing refund ────────────────────────
  // FIX-5: a ref guards one-time pre-fill so removing formData.reason from
  // the deps list doesn't break the guard. The old dep on formData.reason
  // caused the effect to re-run whenever the user cleared the field and
  // immediately re-populate it, preventing them from changing their reason.
  const hasPreFilledRef = React.useRef(false);
  useEffect(() => {
    if (isTracking && order?.refundInfo && !hasPreFilledRef.current) {
      hasPreFilledRef.current = true;
      setFormData({
        reason:          order.refundInfo.reason          || '',
        description:     order.refundInfo.description     || '',
        refundType:      order.refundInfo.refundType      || 'full',
        requestedAmount: order.refundInfo.requestedAmount || '',
      });
    }
  }, [isTracking, order?._id]);

  // BUG 6 FIX: removed global useEffect error watcher. It caused double-toasts
  // because every async action (handleSubmit, handleSendMessage) already has its
  // own try/catch that shows the error. Watching state.refund.error additionally
  // fired a second toast for the same rejection. All error display is now handled
  // exclusively in the per-action catch blocks below.

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  // FIX-2: uses module-level ALL_ALLOWED_RR instead of re-spreading each call.
  const isFileTypeAllowed = (file) => ALL_ALLOWED_RR.includes(file.type);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);

    // BUG 7 FIX: without resetting e.target.value the browser considers the
    // file "already selected" and won't fire onChange if the user removes it
    // then tries to pick the same file again.
    e.target.value = '';

    if (selectedFiles.length + files.length > MAX_FILES) {
      toast.error(`You can only upload up to ${MAX_FILES} files`, {
        position: 'top-center',
      });
      return;
    }

    const validFiles = files.filter((file) => {
      if (!isFileTypeAllowed(file)) {
        toast.error(`${file.name} is not a supported file type`, {
          position: 'top-center',
        });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10MB limit`, { position: 'top-center' });
        return false;
      }
      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);

    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreviews((prev) => [
          ...prev,
          { file, preview: reader.result, type: file.type },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev)  => prev.filter((_, i) => i !== index));
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.reason) {
      errors.reason = 'Please select a refund reason';
    }
    if (!formData.description || formData.description.length < 10) {
      errors.description = 'Description must be at least 10 characters';
    }
    if (formData.refundType === 'partial') {
      const amount     = parseFloat(formData.requestedAmount);
      const maxAllowed = order?.amountPaid ?? order?.totalPrice;
      if (!amount || amount <= 0) {
        errors.requestedAmount = 'Please enter a valid amount';
      } else if (amount > maxAllowed) {
        errors.requestedAmount = `Amount cannot exceed ${maxAllowed}`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form', { position: 'top-center' });
      return;
    }

    const refundData = {
      reason:      formData.reason,
      description: formData.description,
      refundType:  formData.refundType,
      requestedAmount:
        formData.refundType === 'partial'
          ? parseFloat(formData.requestedAmount)
          : undefined,
    };

    try {
      // BUG 6 FIX: dispatch(clearRefundState()) before the call so that the
      // Redux error watcher useEffect above does NOT fire for a leftover stale
      // error, and we handle the fresh error exclusively in this catch block.
      dispatch(clearRefundState());

      await dispatch(
        requestRefund({ orderId, refundData, files: selectedFiles })
      ).unwrap();

      // BUG 8 FIX: clear staged files and form after a successful submission
      // so stale data isn't visible if the user returns to this page.
      setSelectedFiles([]);
      setFilePreviews([]);
      setFormData({ reason: '', description: '', refundType: 'full', requestedAmount: '' });

      dispatch(getOrderDetails(orderId));

      toast.success('Refund request submitted successfully!', {
        position: 'top-center',
        autoClose: 3000,
      });
    } catch (err) {
      // BUG 6 FIX: error is handled here only. clearRefundState() is called
      // before the dispatch above so the Redux error watcher doesn't also fire.
      toast.error(
        typeof err === 'string' ? err : 'Failed to submit refund request',
        { position: 'top-center', autoClose: 3000 }
      );
    }
  };

  const handleSendMessage = useCallback(async (content, files) => {
    try {
      await dispatch(
        sendRefundMessage({ orderId, message: content, files: files ?? [] })
      ).unwrap();
      // No success toast — the double-tick read receipt in the modal is the
      // correct send confirmation. A toast is redundant noise over the in-thread
      // visual feedback. Errors still surface via the catch block below.
      // No re-fetch: sendRefundMessage.fulfilled pushes the message optimistically.
      // The modal's onRefresh (called on next open) guarantees freshness.
    } catch (err) {
      toast.error(
        typeof err === 'string' ? err : 'Failed to send message',
        { position: 'top-center' }
      );
      throw err;
    }
  }, [dispatch, orderId]);

  // BUG 2 FIX: was dispatch(getRefundMessages(orderId)) — string arg.
  const handleRefreshMessages = useCallback(() => {
    if (orderId) {
      dispatch(getRefundMessages({ orderId }));
    }
  }, [dispatch, orderId]);

  const formatCurrency = (amount, currency = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style:                'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);

  // ── Render guards ────────────────────────────────────────────────────────
  if (orderLoading) {
    return (
      <>
        <Navbar />
        <Loader type="snake" size="md" />
        <Footer />
      </>
    );
  }

  if (!order?._id) {
    return (
      <>
        <PageTitle title="Order Not Found" />
        <Navbar />
        <div className="rr-refund-error-container">
          <div className="rr-error-card">
            <FiAlertCircle className="rr-error-icon" />
            <h2>Order not found</h2>
            <p>
              The order you&apos;re looking for doesn&apos;t exist or you
              don&apos;t have permission to view it.
            </p>
            <button onClick={() => navigate(backPath)} className="rr-btn-back-nav">
              <FiArrowLeft />
              {backLabel}
            </button>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle
        title={
          isTracking
            ? `Refund Status - Order ${orderId}`
            : `Request Refund - Order ${orderId}`
        }
      />
      <Navbar />

      <div className="rr-refund-request-container">
        {/* Back button */}
        <button onClick={() => navigate(backPath)} className="rr-btn-back-nav">
          <FiArrowLeft />
          {backLabel}
        </button>

        <div className="rr-refund-header">
          <div className="rr-header-content">
            {/* FIX-1: rr-header-icon is styled as a flex container div (38×38px with
                background + border-radius). Applying it directly to an SVG element
                rendered the SVG without the coloured pill box. */}
            <div className="rr-header-icon">
              <FiDollarSign />
            </div>
            <div>
              <h1>{isTracking ? 'Refund Status' : 'Request Refund'}</h1>
              <p className="rr-order-reference">
                Order: #{orderId.slice(-8).toUpperCase()}
              </p>
            </div>
          </div>

          {isTracking && (
            // FIX-4: type="button" prevents accidental form submit if ever
            // rendered inside a form context in future.
            <button
              type="button"
              className="rr-btn-messages"
              onClick={() => setShowMessagesModal(true)}
            >
              <FiMessageSquare />
              <span>Messages</span>
              {/* FIX-3: cap badge at 9+ to prevent the pill stretching on large counts */}
              {unreadCount > 0 && (
                <span className="rr-message-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="rr-refund-content">
          {/* ── Tracking view ───────────────────────────────────────── */}
          {isTracking && (
            <div className="rr-refund-status-card">
              <div className="rr-card-header">
                <FiInfo className="rr-card-icon" />
                <h2>Refund Information</h2>
                <RefundStatusBadge status={order.refundInfo.status} />
              </div>

              <div className="rr-status-details">
                <div className="rr-status-timeline">
                  <div className="rr-timeline-item">
                    <div className="rr-timeline-dot rr-active" />
                    <div className="rr-timeline-content">
                      <span className="rr-timeline-label">Requested</span>
                      <span className="rr-timeline-date">
                        {order.refundInfo.requestedAt
                          ? new Date(order.refundInfo.requestedAt).toLocaleDateString(
                              'en-US',
                              { month: 'short', day: 'numeric', year: 'numeric' }
                            )
                          : 'N/A'}
                      </span>
                    </div>
                  </div>

                  {order.refundInfo.reviewedAt && (
                    <div className="rr-timeline-item">
                      <div
                        className={`rr-timeline-dot ${
                          ['approved', 'processing', 'completed'].includes(
                            order.refundInfo.status
                          )
                            ? 'rr-active'
                            : 'rr-rejected'
                        }`}
                      />
                      <div className="rr-timeline-content">
                        <span className="rr-timeline-label">
                          {order.refundInfo.status === 'approved'
                            ? 'Approved'
                            : order.refundInfo.status === 'rejected'
                            ? 'Rejected'
                            : 'Reviewed'}
                        </span>
                        <span className="rr-timeline-date">
                          {new Date(order.refundInfo.reviewedAt).toLocaleDateString(
                            'en-US',
                            { month: 'short', day: 'numeric', year: 'numeric' }
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {order.refundInfo.processedAt && (
                    <div className="rr-timeline-item">
                      <div
                        className={`rr-timeline-dot ${
                          order.refundInfo.status === 'completed'
                            ? 'rr-active'
                            : order.refundInfo.status === 'failed'
                            ? 'rr-rejected'
                            : ''
                        }`}
                      />
                      <div className="rr-timeline-content">
                        <span className="rr-timeline-label">
                          {order.refundInfo.status === 'completed'
                            ? 'Completed'
                            : order.refundInfo.status === 'failed'
                            ? 'Failed'
                            : 'Processing'}
                        </span>
                        <span className="rr-timeline-date">
                          {new Date(order.refundInfo.processedAt).toLocaleDateString(
                            'en-US',
                            { month: 'short', day: 'numeric', year: 'numeric' }
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rr-refund-info-grid">
                  <div className="rr-info-item">
                    <span className="rr-info-label">Refund Type:</span>
                    <span className="rr-info-value">
                      {order.refundInfo.refundType === 'full'
                        ? 'Full Refund'
                        : 'Partial Refund'}
                    </span>
                  </div>
                  <div className="rr-info-item">
                    <span className="rr-info-label">Refund Amount:</span>
                    <span className="rr-info-value rr-strong">
                      {formatCurrency(
                        order.refundInfo.refundAmount || order.totalPrice,
                        order.paymentInfo?.currency
                      )}
                    </span>
                  </div>
                  <div className="rr-info-item">
                    <span className="rr-info-label">Reason:</span>
                    <span className="rr-info-value">
                      {order.refundInfo.reason?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {order.refundInfo.description && (
                    <div className="rr-info-item rr-full-width">
                      <span className="rr-info-label">Description:</span>
                      <span className="rr-info-value">
                        {order.refundInfo.description}
                      </span>
                    </div>
                  )}
                  {order.refundInfo.adminNote && (
                    <div className="rr-info-item rr-full-width rr-admin-note">
                      <span className="rr-info-label">Admin Response:</span>
                      <span className="rr-info-value">
                        {order.refundInfo.adminNote}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Order summary ────────────────────────────────────────── */}
          <div className="rr-summary-card">
            <div className="rr-card-header">
              <FiPackage className="rr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rr-summary-details">
              <div className="rr-summary-row">
                <span className="rr-label">Total Amount:</span>
                <span className="rr-value rr-strong">
                  {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                </span>
              </div>
              <div className="rr-summary-row">
                <span className="rr-label">Order Status:</span>
                <span className="rr-value">
                  <span
                    className={`rr-status-badge rr-status-${order.orderStatus.toLowerCase()}`}
                  >
                    {order.orderStatus}
                  </span>
                </span>
              </div>
              <div className="rr-summary-row">
                <span className="rr-label">Payment Status:</span>
                <span className="rr-value">
                  <span
                    className={`rr-status-badge ${
                      order.paymentInfo?.status === 'success'
                        ? 'rr-status-success'
                        : 'rr-status-danger'
                    }`}
                  >
                    {order.paymentInfo?.status === 'success' ? 'Paid' : 'Not Paid'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* ── Request form (only when no active refund) ────────────── */}
          {!isTracking && (
            <div className="rr-refund-form-card">
              <div className="rr-card-header">
                <FiInfo className="rr-card-icon" />
                <h2>Refund Details</h2>
              </div>

              <form onSubmit={handleSubmit} className="rr-refund-form">
                {/* Refund type */}
                <div className="rr-form-section">
                  <label className="rr-section-label">Refund Type</label>
                  <div className="rr-radio-group">
                    <label
                      className={`rr-radio-option ${
                        formData.refundType === 'full' ? 'rr-selected' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="refundType"
                        value="full"
                        checked={formData.refundType === 'full'}
                        onChange={handleChange}
                      />
                      <div className="rr-radio-content">
                        <span className="rr-radio-title">Full Refund</span>
                        <span className="rr-radio-subtitle">
                          {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                        </span>
                      </div>
                      <FiCheckCircle className="rr-radio-check" />
                    </label>

                    <label
                      className={`rr-radio-option ${
                        formData.refundType === 'partial' ? 'rr-selected' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="refundType"
                        value="partial"
                        checked={formData.refundType === 'partial'}
                        onChange={handleChange}
                      />
                      <div className="rr-radio-content">
                        <span className="rr-radio-title">Partial Refund</span>
                        <span className="rr-radio-subtitle">Specify custom amount</span>
                      </div>
                      <FiCheckCircle className="rr-radio-check" />
                    </label>
                  </div>
                </div>

                {/* Partial amount */}
                {formData.refundType === 'partial' && (
                  <div className="rr-form-group">
                    <label htmlFor="requestedAmount" className="rr-form-label">
                      Refund Amount ({order.paymentInfo?.currency})
                    </label>
                    <div className="rr-input-wrapper">
                      <FiDollarSign className="rr-input-icon" />
                      <input
                        type="number"
                        id="requestedAmount"
                        name="requestedAmount"
                        className={`rr-form-input rr-has-icon ${
                          formErrors.requestedAmount ? 'rr-error' : ''
                        }`}
                        value={formData.requestedAmount}
                        onChange={handleChange}
                        placeholder="Enter amount"
                        step="0.01"
                        min="0"
                        max={order.amountPaid ?? order.totalPrice}
                      />
                    </div>
                    {formErrors.requestedAmount && (
                      <span className="rr-error-message">
                        <FiAlertCircle /> {formErrors.requestedAmount}
                      </span>
                    )}
                    <span className="rr-helper-text">
                      Maximum:{' '}
                      {formatCurrency(
                        order.amountPaid ?? order.totalPrice,
                        order.paymentInfo?.currency
                      )}
                    </span>
                  </div>
                )}

                {/* Reason */}
                <div className="rr-form-group">
                  <label htmlFor="reason" className="rr-form-label">
                    Reason for Refund *
                  </label>
                  <select
                    id="reason"
                    name="reason"
                    className={`rr-form-select ${formErrors.reason ? 'rr-error' : ''}`}
                    value={formData.reason}
                    onChange={handleChange}
                  >
                    <option value="">Select a reason</option>
                    {REFUND_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                  {formErrors.reason && (
                    <span className="rr-error-message">
                      <FiAlertCircle /> {formErrors.reason}
                    </span>
                  )}
                </div>

                {/* Description */}
                <div className="rr-form-group">
                  <label htmlFor="description" className="rr-form-label">
                    Detailed Description *
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    className={`rr-form-textarea ${
                      formErrors.description ? 'rr-error' : ''
                    }`}
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="Please provide details about why you're requesting a refund (minimum 10 characters)"
                    rows="5"
                    maxLength="500"
                  />
                  <div className="rr-textarea-footer">
                    <span className="rr-char-count">
                      {formData.description.length} / 500
                    </span>
                    {formErrors.description && (
                      <span className="rr-error-message">
                        <FiAlertCircle /> {formErrors.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* File upload */}
                <div className="rr-form-group">
                  <label className="rr-form-label">
                    Supporting Documents (Optional)
                  </label>
                  <p className="rr-helper-text">
                    Upload up to {MAX_FILES} files (images, videos, or PDFs). Max 10MB
                    each.
                  </p>

                  <div className="rr-file-upload-area">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />

                    <button
                      type="button"
                      className="rr-btn-upload"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={selectedFiles.length >= MAX_FILES}
                    >
                      <FiPaperclip />
                      Choose Files
                    </button>

                    {selectedFiles.length > 0 && (
                      <div className="rr-file-previews">
                        {filePreviews.map((item, index) => (
                          <div key={index} className="rr-file-preview-item">
                            {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                              <img
                                src={item.preview}
                                alt={item.file.name}
                                className="rr-preview-image"
                              />
                            ) : ALLOWED_FILE_TYPES.videos.includes(item.type) ? (
                              <div className="rr-preview-placeholder">
                                <FiVideo />
                              </div>
                            ) : (
                              <div className="rr-preview-placeholder">
                                <FiFile />
                              </div>
                            )}
                            <div className="rr-file-info">
                              <span className="rr-file-name">{item.file.name}</span>
                              <span className="rr-file-size">
                                {(item.file.size / 1024 / 1024).toFixed(2)} MB
                              </span>
                            </div>
                            <button
                              type="button"
                              className="rr-btn-remove-file"
                              onClick={() => removeFile(index)}
                            >
                              <FiX />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="rr-form-actions">
                  <button
                    type="button"
                    onClick={() => navigate(backPath)}
                    className="rr-btn-secondary"
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  {/* BUG 11 FIX: was disabled={loading || uploadLoading}.
                      uploadLoading is set by the standalone uploadRefundFiles
                      thunk which is no longer dispatched here. requestRefund
                      handles files internally and only sets `loading`. */}
                  <button
                    type="submit"
                    className="rr-btn-primary"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <FiClock className="rr-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <FiSend />
                        Submit Refund Request
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      <RefundReturnMessagesModal
        isOpen={showMessagesModal}
        onClose={() => setShowMessagesModal(false)}
        orderId={orderId}
        messages={messages}
        loading={messagesLoading}
        onSendMessage={handleSendMessage}
        onRefresh={handleRefreshMessages}
        type="refund"
      />

      <Footer />
    </>
  );
}

export default RefundRequest;