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
  FiXCircle,
} from 'react-icons/fi';

import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import RefundReturnMessagesModal from './RefundReturnMessagesModal';

import { getOrderDetails } from '../features/cart/orderSlice';
import {
  requestRefund,
  sendRefundMessage,
  getRefundMessages,
  clearRefundState,
  cancelRefund,
} from '../features/refunds/refundSlice';

import '../OrderStyles/RefundRequest.css';

const REFUND_REASONS = [
  { value: 'defective_product',     label: 'Defective or Damaged Product' },
  { value: 'wrong_item',            label: 'Wrong Item Received' },
  { value: 'not_as_described',      label: 'Product Not As Described' },
  { value: 'damaged_in_shipping',   label: 'Damaged During Shipping' },
  { value: 'changed_mind',          label: 'Changed My Mind' },
  { value: 'duplicate_order',       label: 'Duplicate Order' },
  { value: 'unauthorized_purchase', label: 'Unauthorized Purchase' },
  { value: 'other',                 label: 'Other' },
];

const MAX_FILES = 5;
const ALLOWED_FILE_TYPES = {
  images:    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos:    ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf'],
};
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
    loading,
    messagesLoading,
  } = useSelector((state) => state.refund);

  const [formData, setFormData] = useState({
    reason: '',
    description: '',
    refundType: 'full',
    requestedAmount: '',
  });

  const [formErrors,        setFormErrors]        = useState({});
  const [selectedFiles,     setSelectedFiles]     = useState([]);
  const [filePreviews,      setFilePreviews]      = useState([]);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [unreadCount,       setUnreadCount]       = useState(0);

  // Cancel confirmation state — two-step to prevent accidental cancellation.
  // null = idle, 'confirm' = awaiting confirmation, 'loading' = dispatching.
  const [cancelState, setCancelState] = useState('idle'); // 'idle' | 'confirm' | 'loading'

  // FIX-6: also exclude 'failed' — a failed refund should allow the customer
  // to re-submit rather than showing a read-only status view with no action.
  const hasActiveRefund =
    order?.refundInfo?.status &&
    order.refundInfo.status !== 'none' &&
    order.refundInfo.status !== 'cancelled' &&
    order.refundInfo.status !== 'failed';
  const isTracking = hasActiveRefund;

  // Backend only allows cancellation when status is 'requested' or 'approved'.
  // Mirror that guard in the UI so the button is never shown for processing/
  // completed/rejected states.
  const canCancel =
    isTracking &&
    ['requested', 'approved'].includes(order?.refundInfo?.status);

  const fromMyRefunds = location.state?.from === 'my-refunds-returns';
  const backPath      = fromMyRefunds ? '/my-refunds-returns' : `/order/${orderId}`;
  const backLabel     = fromMyRefunds ? 'Back' : 'Back to Order Details';

  // ── Initial data fetch ───────────────────────────────────────────────────
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  useEffect(() => {
    if (orderId && order?._id && hasActiveRefund) {
      dispatch(getRefundMessages({ orderId }));
    }
  }, [dispatch, orderId, order?._id, hasActiveRefund]);

  // ── Unread badge ─────────────────────────────────────────────────────────
  // Only recalculate when the modal is NOT open. While the modal is open we
  // optimistically show 0 (set in handleOpenMessages), and we don't want an
  // in-flight re-fetch to momentarily flash the old count back.
  useEffect(() => {
    if (showMessagesModal) return; // don't recalculate while modal is visible

    if (messages && messages.length > 0) {
      const unread = messages.filter(
        (msg) => msg.senderType === 'admin' && !msg.isRead
      ).length;
      setUnreadCount(unread);
    } else {
      setUnreadCount(0);
    }
  }, [messages, showMessagesModal]);

  // ── Pre-fill form when viewing an existing refund ────────────────────────
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

  // Reset cancel state if the order status changes (e.g. after cancel completes
  // and getOrderDetails re-fetches, hasActiveRefund becomes false).
  useEffect(() => {
    if (!canCancel) setCancelState('idle');
  }, [canCancel]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const isFileTypeAllowed = (file) => ALL_ALLOWED_RR.includes(file.type);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
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
      dispatch(clearRefundState());

      await dispatch(
        requestRefund({ orderId, refundData, files: selectedFiles })
      ).unwrap();

      setSelectedFiles([]);
      setFilePreviews([]);
      setFormData({ reason: '', description: '', refundType: 'full', requestedAmount: '' });

      dispatch(getOrderDetails(orderId));

      toast.success('Refund request submitted successfully!', {
        position: 'top-center',
        autoClose: 3000,
      });
    } catch (err) {
      toast.error(
        typeof err === 'string' ? err : 'Failed to submit refund request',
        { position: 'top-center', autoClose: 3000 }
      );
    }
  };

  // ── Cancel refund ────────────────────────────────────────────────────────
  const handleCancelClick = () => {
    if (cancelState === 'idle') {
      setCancelState('confirm');
      return;
    }
  };

  const handleCancelConfirm = async () => {
    setCancelState('loading');
    try {
      dispatch(clearRefundState());
      await dispatch(cancelRefund(orderId)).unwrap();
      dispatch(getOrderDetails(orderId));
      toast.success('Refund request cancelled.', {
        position: 'top-center',
        autoClose: 3000,
      });
    } catch (err) {
      toast.error(
        typeof err === 'string' ? err : 'Failed to cancel refund request',
        { position: 'top-center', autoClose: 3000 }
      );
      setCancelState('idle');
    }
  };

  const handleCancelDismiss = () => setCancelState('idle');

  // ── Open messages modal ──────────────────────────────────────────────────
  // Optimistically zero the badge immediately so the user sees it clear as
  // soon as they open the modal. Then re-fetch so the server can mark messages
  // as read; the unread-recalculation effect is suppressed while the modal is
  // open, so there's no flicker back to the old count during the fetch.
  const handleOpenMessages = useCallback(() => {
    setUnreadCount(0);          // optimistic clear — badge disappears immediately
    setShowMessagesModal(true);
    if (orderId) {
      dispatch(getRefundMessages({ orderId })); // server marks as read
    }
  }, [dispatch, orderId]);

  // ── Close messages modal ─────────────────────────────────────────────────
  // After the modal closes, re-fetch once more so the unread-recalculation
  // effect can pick up the server-confirmed read state cleanly.
  const handleCloseMessages = useCallback(() => {
    setShowMessagesModal(false);
    if (orderId) {
      dispatch(getRefundMessages({ orderId }));
    }
  }, [dispatch, orderId]);

  const handleSendMessage = useCallback(async (content, files) => {
    try {
      await dispatch(
        sendRefundMessage({ orderId, message: content, files: files ?? [] })
      ).unwrap();
    } catch (err) {
      toast.error(
        typeof err === 'string' ? err : 'Failed to send message',
        { position: 'top-center' }
      );
      throw err;
    }
  }, [dispatch, orderId]);

  const handleRefreshMessages = useCallback(() => {
    if (orderId) {
      dispatch(getRefundMessages({ orderId }));
    }
  }, [dispatch, orderId]);

  const formatCurrency = (amount, currency = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style:                 'currency',
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

  const isCancelLoading = cancelState === 'loading';

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
            <div className="rr-header-actions">
              <button
                type="button"
                className="rr-btn-messages"
                onClick={handleOpenMessages}
              >
                <FiMessageSquare />
                <span>Messages</span>
                {unreadCount > 0 && (
                  <span className="rr-message-badge">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </div>
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

                {/* ── Cancel section ───────────────────────────────────── */}
                {canCancel && (
                  <div className="rr-cancel-section">
                    {cancelState === 'idle' && (
                      <button
                        type="button"
                        className="rr-btn-cancel-refund"
                        onClick={handleCancelClick}
                      >
                        <FiXCircle />
                        Cancel Refund Request
                      </button>
                    )}

                    {cancelState === 'confirm' && (
                      <div className="rr-cancel-confirm">
                        <p className="rr-cancel-confirm-text">
                          <FiAlertCircle className="rr-cancel-confirm-icon" />
                          Are you sure? This cannot be undone.
                        </p>
                        <div className="rr-cancel-confirm-actions">
                          <button
                            type="button"
                            className="rr-btn-cancel-keep"
                            onClick={handleCancelDismiss}
                          >
                            Keep Request
                          </button>
                          <button
                            type="button"
                            className="rr-btn-cancel-confirm"
                            onClick={handleCancelConfirm}
                          >
                            <FiXCircle />
                            Yes, Cancel It
                          </button>
                        </div>
                      </div>
                    )}

                    {cancelState === 'loading' && (
                      <button
                        type="button"
                        className="rr-btn-cancel-refund"
                        disabled
                      >
                        <FiClock className="rr-spin" />
                        Cancelling…
                      </button>
                    )}
                  </div>
                )}
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
                    Upload up to {MAX_FILES} files (images, videos, or PDFs). Max 10MB each.
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
        onClose={handleCloseMessages}
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