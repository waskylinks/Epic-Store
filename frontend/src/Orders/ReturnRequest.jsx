// ReturnRequest.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FiPackage,
  FiAlertCircle,
  FiClock,
  FiSend,
  FiPaperclip,
  FiX,
  FiFile,
  FiVideo,
  FiMessageSquare,
  FiRotateCcw,
  FiInfo,
  FiArrowLeft,
  FiBox,
} from 'react-icons/fi';

import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import RefundReturnMessagesModal from './RefundReturnMessagesModal';

import { getOrderDetails } from '../features/cart/orderSlice';
import {
  requestReturn,
  getReturnMessages,
  addReturnMessage,
  uploadReturnFiles,
  cancelReturn,
  clearReturnState,
} from '../features/returns/returnSlice';

import '../OrderStyles/ReturnRequest.css';

const RETURN_REASONS = [
  { value: 'defective_product', label: 'Defective or Damaged Product' },
  { value: 'wrong_item',        label: 'Wrong Item Received' },
  { value: 'wrong_size',        label: 'Wrong Size/Fit' },
  { value: 'not_as_described',  label: 'Product Not As Described' },
  { value: 'quality_issues',    label: 'Quality Issues' },
  { value: 'changed_mind',      label: 'Changed My Mind' },
  { value: 'better_price',      label: 'Found Better Price' },
  { value: 'duplicate_order',   label: 'Duplicate Order' },
  { value: 'no_longer_needed',  label: 'No Longer Needed' },
  { value: 'other',             label: 'Other' }
];

// FIX BUG-16: keep in sync with router UPLOAD_LIMIT (both now 8)
const MAX_FILES = 8;

const ALLOWED_FILE_TYPES = {
  images:    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos:    ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf']
};

// ─────────────────────────────────────────────
// ReturnStatusBadge
// ─────────────────────────────────────────────
const ReturnStatusBadge = ({ status }) => {
  const configs = {
    none:       { label: 'No Return',        className: 'rtr-return-badge-none',      icon: '○'  },
    requested:  { label: 'Return Requested', className: 'rtr-return-badge-requested', icon: '⏳' },
    approved:   { label: 'Approved',         className: 'rtr-return-badge-approved',  icon: '✓'  },
    rejected:   { label: 'Rejected',         className: 'rtr-return-badge-rejected',  icon: '✗'  },
    in_transit: { label: 'In Transit',       className: 'rtr-return-badge-transit',   icon: '🚚' },
    received:   { label: 'Received',         className: 'rtr-return-badge-received',  icon: '📦' },
    inspected:  { label: 'Inspecting',       className: 'rtr-return-badge-inspecting',icon: '🔍' },
    completed:  { label: 'Completed',        className: 'rtr-return-badge-completed', icon: '✓'  },
    cancelled:  { label: 'Cancelled',        className: 'rtr-return-badge-cancelled', icon: '✗'  }
  };
  const config = configs[status] ?? configs.none;

  return (
    <span className={`rtr-return-badge ${config.className}`}>
      <span className="rtr-return-badge-icon">{config.icon}</span>
      <span className="rtr-return-badge-label">{config.label}</span>
    </span>
  );
};

// ─────────────────────────────────────────────
// ReturnRequest
// ─────────────────────────────────────────────
function ReturnRequest() {
  const { id: orderId } = useParams();
  const navigate        = useNavigate();
  const dispatch        = useDispatch();
  const fileInputRef    = useRef(null);

  const { order, loading: orderLoading } = useSelector((s) => s.order);

  const {
    messages,
    loading,
    messagesLoading,
    uploadLoading,
    error,
    success
  } = useSelector((s) => s.return);

  const [formData, setFormData] = useState({ reason: '', itemsToReturn: [] });
  const [formErrors, setFormErrors]           = useState({});
  const [selectedFiles, setSelectedFiles]     = useState([]);
  const [filePreviews, setFilePreviews]       = useState([]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [unreadCount, setUnreadCount]         = useState(0);

  // FIX BUG-11: backend stores items under `itemsToReturn`, not `items`
  const returnItems = order?.returnInfo?.itemsToReturn ?? order?.returnInfo?.items ?? [];

  const hasActiveReturn = order?.returnInfo?.status && order.returnInfo.status !== 'none';
  const isTracking      = hasActiveReturn;

  // ── Fetch order on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (orderId) dispatch(getOrderDetails(orderId));
  }, [dispatch, orderId]);

  // ── Fetch messages when tracking ─────────────────────────────────────────
  useEffect(() => {
    if (isTracking && orderId) dispatch(getReturnMessages(orderId));
  }, [dispatch, isTracking, orderId]);

  // ── Compute unread badge ─────────────────────────────────────────────────
  useEffect(() => {
    if (messages?.length > 0) {
      const unread = messages.filter(
        msg => msg.senderType === 'admin' && !msg.readBy?.includes('customer')
      ).length;
      setUnreadCount(unread);
    }
  }, [messages]);

  // ── Pre-populate form items (new return only) ────────────────────────────
  // FIX BUG-12: remove `formData.itemsToReturn.length` from deps — it caused
  // this effect to re-run every time items were mutated (e.g. checkboxes).
  // Use a ref-guard instead so items are set exactly once after the order loads.
  const itemsPopulated = useRef(false);
  useEffect(() => {
    if (order?.orderItems && !isTracking && !itemsPopulated.current) {
      itemsPopulated.current = true;
      const items = order.orderItems.map(item => ({
        product:        item.product || item._id,
        name:           item.name  || '',
        price:          item.price || 0,
        image:          item.image || '',
        quantity:       parseInt(item.quantity) || 1,
        returnQuantity: parseInt(item.quantity) || 1,
        selected:       true
      }));
      setFormData(prev => ({ ...prev, itemsToReturn: items }));
    }
  }, [order?.orderItems, isTracking]);

  // ── Pre-populate form when viewing existing return ───────────────────────
  useEffect(() => {
    if (isTracking && order?.returnInfo && !formData.reason) {
      setFormData({
        reason:        order.returnInfo.reason || '',
        // FIX BUG-11: canonical field is `itemsToReturn`; fall back gracefully
        itemsToReturn: order.returnInfo.itemsToReturn ?? order.returnInfo.items ?? []
      });
    }
  }, [isTracking, order?.returnInfo, formData.reason]);

  // ── Global success / error toasts ────────────────────────────────────────
  // FIX BUG-10: uploadReturnFiles no longer sets success=true in the slice, so
  // this effect only fires for real user-facing actions (requestReturn, cancelReturn).
  useEffect(() => {
    if (success) {
      toast.success('Action completed successfully!', { position: 'top-center' });
      dispatch(clearReturnState());
    }
    if (error) {
      toast.error(error, { position: 'top-center' });
      dispatch(clearReturnState());
    }
  }, [success, error, dispatch]);

  // ── Form handlers ────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (formErrors[name]) setFormErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleItemToggle = (index) => {
    setFormData(prev => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      )
    }));
  };

  const handleQuantityChange = (index, quantity) => {
    const item        = formData.itemsToReturn[index];
    const newQuantity = Math.max(1, Math.min(quantity, item.quantity));
    setFormData(prev => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((it, i) =>
        i === index ? { ...it, returnQuantity: newQuantity } : it
      )
    }));
  };

  // ── File handling ────────────────────────────────────────────────────────
  const isFileTypeAllowed = (file) => {
    const all = [
      ...ALLOWED_FILE_TYPES.images,
      ...ALLOWED_FILE_TYPES.videos,
      ...ALLOWED_FILE_TYPES.documents
    ];
    return all.includes(file.type);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);

    if (selectedFiles.length + files.length > MAX_FILES) {
      toast.error(`You can only upload up to ${MAX_FILES} files`, { position: 'top-center' });
      return;
    }

    const validFiles = files.filter(file => {
      if (!isFileTypeAllowed(file)) {
        toast.error(`${file.name} is not a supported file type`, { position: 'top-center' });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10 MB limit`, { position: 'top-center' });
        return false;
      }
      return true;
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);

    validFiles.forEach(file => {
      const reader    = new FileReader();
      reader.onloadend = () => {
        setFilePreviews(prev => [...prev, { file, preview: reader.result, type: file.type }]);
      };
      reader.readAsDataURL(file);
    });

    // Reset the input so the same file can be re-selected after removal
    e.target.value = '';
  };

  const removeFile = (index) => {
    setSelectedFiles(prev  => prev.filter((_, i) => i !== index));
    setFilePreviews(prev   => prev.filter((_, i) => i !== index));
  };

  // ── Validation ───────────────────────────────────────────────────────────
  const validateForm = () => {
    const errors = {};
    if (!formData.reason) errors.reason = 'Please select a return reason';
    if (!formData.itemsToReturn.some(i => i.selected))
      errors.items = 'Please select at least one item to return';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  // FIX BUG-2 & BUG-8: Files can only be uploaded after the return exists.
  // Strategy: create the return first (no files), then — if there are files —
  // upload them in a second request. This eliminates the 404 from the upload
  // endpoint guard `if (!order.returnInfo || status === 'none')`.
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error('Please fix the errors in the form', { position: 'top-center' });
      return;
    }

    try {
      // FIX BUG-1: send field as `items` to match the updated controller
      const selectedItems = formData.itemsToReturn
        .filter(item => item.selected)
        .map(({ product, returnQuantity, name, price, image }) => ({
          product,
          quantity: returnQuantity,
          name,
          price,
          image
        }));

      // Step 1: create the return (no attachments yet)
      await dispatch(requestReturn({
        orderId,
        returnData: { reason: formData.reason, items: selectedItems, attachments: [] }
      })).unwrap();

      // Step 2: upload files now that the return exists
      if (selectedFiles.length > 0) {
        try {
          await dispatch(uploadReturnFiles({ orderId, files: selectedFiles })).unwrap();
        } catch {
          // Non-fatal: return was created; file upload failure is a minor issue
          toast.warn('Return submitted but file upload failed. You can retry from the messages panel.', {
            position: 'top-center', autoClose: 5000
          });
        }
      }

      toast.success('Return request submitted successfully!', {
        position: 'top-center', autoClose: 3000
      });

      setTimeout(() => navigate(`/order/${orderId}`), 2000);
    } catch (err) {
      toast.error(err || 'Failed to submit return request', {
        position: 'top-center', autoClose: 3000
      });
    }
  };

  // ── Message send (from modal) ────────────────────────────────────────────
  const handleSendMessage = async (content, files) => {
    try {
      let uploadedFiles = [];
      if (files?.length > 0) {
        const uploadResult = await dispatch(
          uploadReturnFiles({ orderId, files })
        ).unwrap();
        uploadedFiles = uploadResult.files || [];
      }

      await dispatch(addReturnMessage({ orderId, content, attachments: uploadedFiles })).unwrap();

      // FIX BUG-9: slice no longer optimistically pushes; re-fetch is canonical
      dispatch(getReturnMessages(orderId));
      toast.success('Message sent', { position: 'top-center', autoClose: 2000 });
    } catch (err) {
      toast.error(err || 'Failed to send message', { position: 'top-center' });
      throw err;
    }
  };

  const handleRefreshMessages = () => {
    if (orderId) dispatch(getReturnMessages(orderId));
  };

  // ── Cancel return ────────────────────────────────────────────────────────
  const handleCancelReturn = async () => {
    try {
      await dispatch(cancelReturn(orderId)).unwrap();
      toast.success('Return request cancelled', { position: 'top-center', autoClose: 2000 });
      setTimeout(() => navigate(`/order/${orderId}`), 1500);
    } catch (err) {
      toast.error(err || 'Failed to cancel return', { position: 'top-center' });
    } finally {
      setShowCancelModal(false);
    }
  };

  // ── Utilities ────────────────────────────────────────────────────────────
  const formatCurrency = (amount, currency = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2
    }).format(amount);

  const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
    d ? new Date(d).toLocaleDateString('en-US', opts) : 'N/A';

  // ── Render guards ────────────────────────────────────────────────────────
  if (orderLoading) return (
    <><Navbar /><Loader type="snake" size="md" /><Footer /></>
  );

  if (!order?._id) return (
    <>
      <PageTitle title="Order Not Found" />
      <Navbar />
      <div className="rtr-return-error-container">
        <div className="rtr-error-card">
          <FiAlertCircle className="rtr-error-icon" />
          <h2>Order not found</h2>
          <p>The order you're looking for doesn't exist or you don't have permission to view it.</p>
          <button onClick={() => navigate('/orders/user')} className="rtr-btn-secondary">
            Back to My Orders
          </button>
        </div>
      </div>
      <Footer />
    </>
  );

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle title={isTracking
        ? `Return Status - Order ${orderId}`
        : `Request Return - Order ${orderId}`}
      />
      <Navbar />

      <div className="rtr-return-request-container">
        <button onClick={() => navigate(`/order/${orderId}`)} className="rtr-btn-back-nav">
          <FiArrowLeft /> Back to Order Details
        </button>

        {/* ── Header ── */}
        <div className="rtr-return-header">
          <div className="rtr-header-content">
            <FiRotateCcw className="rtr-header-icon" />
            <div>
              <h1>{isTracking ? 'Return Status' : 'Request Return'}</h1>
              <p className="rtr-order-reference">Order: #{orderId.slice(-8).toUpperCase()}</p>
            </div>
          </div>

          {isTracking && (
            <button className="rtr-btn-messages" onClick={() => setShowMessagesModal(true)}>
              <FiMessageSquare />
              <span>Messages</span>
              {unreadCount > 0 && (
                <span className="rtr-message-badge">{unreadCount}</span>
              )}
            </button>
          )}
        </div>

        <div className="rtr-return-content">

          {/* ── Tracking view ── */}
          {isTracking && (
            <div className="rtr-return-status-card">
              <div className="rtr-card-header">
                <FiInfo className="rtr-card-icon" />
                <h2>Return Information</h2>
                <ReturnStatusBadge status={order.returnInfo.status} />
              </div>

              <div className="rtr-status-details">
                {/* Timeline */}
                <div className="rtr-status-timeline">
                  <div className="rtr-timeline-item">
                    <div className="rtr-timeline-dot rtr-active" />
                    <div className="rtr-timeline-content">
                      <span className="rtr-timeline-label">Requested</span>
                      <span className="rtr-timeline-date">
                        {fmtDate(order.returnInfo.requestedAt)}
                      </span>
                    </div>
                  </div>

                  {order.returnInfo.approvedAt && (
                    <div className="rtr-timeline-item">
                      <div className={`rtr-timeline-dot ${
                        order.returnInfo.status !== 'rejected' ? 'rtr-active' : 'rtr-rejected'
                      }`} />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">
                          {order.returnInfo.status === 'rejected' ? 'Rejected' : 'Approved'}
                        </span>
                        <span className="rtr-timeline-date">{fmtDate(order.returnInfo.approvedAt)}</span>
                      </div>
                    </div>
                  )}

                  {order.returnInfo.shippedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">In Transit</span>
                        <span className="rtr-timeline-date">{fmtDate(order.returnInfo.shippedAt)}</span>
                      </div>
                    </div>
                  )}

                  {order.returnInfo.receivedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Received</span>
                        <span className="rtr-timeline-date">{fmtDate(order.returnInfo.receivedAt)}</span>
                      </div>
                    </div>
                  )}

                  {order.returnInfo.completedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Completed</span>
                        <span className="rtr-timeline-date">{fmtDate(order.returnInfo.completedAt)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Info grid */}
                <div className="rtr-return-info-grid">
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Return Reason:</span>
                    <span className="rtr-info-value">
                      {order.returnInfo.reason?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Items to Return:</span>
                    {/* FIX BUG-11: use resolved returnItems (itemsToReturn || items) */}
                    <span className="rtr-info-value">{returnItems.length} item(s)</span>
                  </div>
                  {order.returnInfo.trackingNumber && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">Tracking Number:</span>
                      <span className="rtr-info-value rtr-tracking">
                        {order.returnInfo.trackingNumber}
                      </span>
                    </div>
                  )}
                  {order.returnInfo.returnAddress && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">Return Address:</span>
                      <span className="rtr-info-value">{order.returnInfo.returnAddress}</span>
                    </div>
                  )}
                  {order.returnInfo.adminNote && (
                    <div className="rtr-info-item rtr-full-width rtr-admin-note">
                      <span className="rtr-info-label">Admin Note:</span>
                      <span className="rtr-info-value">{order.returnInfo.adminNote}</span>
                    </div>
                  )}
                </div>

                {/* FIX BUG-11: render returnItems (resolved array) */}
                {returnItems.length > 0 && (
                  <div className="rtr-return-items">
                    <h3>Items Being Returned</h3>
                    <div className="rtr-items-list">
                      {returnItems.map((item, index) => (
                        <div key={index} className="rtr-return-item-card">
                          {item.image && (
                            <img src={item.image} alt={item.name} className="rtr-item-image" />
                          )}
                          <div className="rtr-item-details">
                            <span className="rtr-item-name">{item.name}</span>
                            <span className="rtr-item-quantity">Quantity: {item.quantity}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {order.returnInfo.status === 'requested' && (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="rtr-btn-cancel-return"
                    disabled={loading}
                  >
                    <FiX /> Cancel Return Request
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Order summary (always shown) ── */}
          <div className="rtr-summary-card">
            <div className="rtr-card-header">
              <FiPackage className="rtr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rtr-summary-details">
              <div className="rtr-summary-row">
                <span className="rtr-label">Total Amount:</span>
                <span className="rtr-value rtr-strong">
                  {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                </span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Order Status:</span>
                <span className="rtr-value">
                  <span className={`rtr-status-badge rtr-status-${order.orderStatus.toLowerCase()}`}>
                    {order.orderStatus}
                  </span>
                </span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Ordered Date:</span>
                <span className="rtr-value">
                  {fmtDate(order.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>

          {/* ── New-return form ── */}
          {!isTracking && (
            <div className="rtr-return-form-card">
              <div className="rtr-card-header">
                <FiBox className="rtr-card-icon" />
                <h2>Select Items to Return</h2>
              </div>

              <form onSubmit={handleSubmit} className="rtr-return-form">
                {/* Item selection */}
                <div className="rtr-form-section">
                  <label className="rtr-section-label">Items in Your Order</label>
                  <div className="rtr-items-grid">
                    {formData.itemsToReturn.map((item, index) => (
                      <div
                        key={index}
                        className={`rtr-item-card ${item.selected ? 'rtr-selected' : ''}`}
                      >
                        <div className="rtr-item-checkbox">
                          <input
                            type="checkbox"
                            id={`item-${index}`}
                            checked={item.selected}
                            onChange={() => handleItemToggle(index)}
                          />
                          <label htmlFor={`item-${index}`} />
                        </div>

                        {item.image && (
                          <img src={item.image} alt={item.name} className="rtr-item-image" />
                        )}

                        <div className="rtr-item-info">
                          <span className="rtr-item-name">{item.name}</span>
                          <span className="rtr-item-price">
                            {formatCurrency(item.price, order.paymentInfo?.currency)}
                          </span>
                        </div>

                        {item.selected && (
                          <div className="rtr-quantity-selector">
                            <label>Quantity:</label>
                            <div className="rtr-quantity-controls">
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(index, item.returnQuantity - 1)}
                                disabled={item.returnQuantity <= 1}
                              >-</button>
                              <span>{item.returnQuantity}</span>
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(index, item.returnQuantity + 1)}
                                disabled={item.returnQuantity >= item.quantity}
                              >+</button>
                            </div>
                            <span className="rtr-max-qty">Max: {item.quantity}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {formErrors.items && (
                    <span className="rtr-error-message">
                      <FiAlertCircle /> {formErrors.items}
                    </span>
                  )}
                </div>

                {/* Reason */}
                <div className="rtr-form-group">
                  <label htmlFor="reason" className="rtr-form-label">
                    Reason for Return *
                  </label>
                  <select
                    id="reason"
                    name="reason"
                    className={`rtr-form-select ${formErrors.reason ? 'rtr-error' : ''}`}
                    value={formData.reason}
                    onChange={handleChange}
                  >
                    <option value="">Select a reason</option>
                    {RETURN_REASONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {formErrors.reason && (
                    <span className="rtr-error-message">
                      <FiAlertCircle /> {formErrors.reason}
                    </span>
                  )}
                </div>

                {/* File upload */}
                <div className="rtr-form-group">
                  <label className="rtr-form-label">Supporting Documents (Optional)</label>
                  <p className="rtr-helper-text">
                    Upload up to {MAX_FILES} files (images, videos, or PDFs). Max 10 MB each.
                  </p>

                  <div className="rtr-file-upload-area">
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
                      className="rtr-btn-upload"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={selectedFiles.length >= MAX_FILES}
                    >
                      <FiPaperclip /> Choose Files
                    </button>

                    {filePreviews.length > 0 && (
                      <div className="rtr-file-previews">
                        {filePreviews.map((item, index) => (
                          <div key={index} className="rtr-file-preview-item">
                            {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                              <img
                                src={item.preview}
                                alt={item.file.name}
                                className="rtr-preview-image"
                              />
                            ) : ALLOWED_FILE_TYPES.videos.includes(item.type) ? (
                              <div className="rtr-preview-placeholder"><FiVideo /></div>
                            ) : (
                              <div className="rtr-preview-placeholder"><FiFile /></div>
                            )}
                            <div className="rtr-file-info">
                              <span className="rtr-file-name">{item.file.name}</span>
                              <span className="rtr-file-size">
                                {(item.file.size / 1024 / 1024).toFixed(2)} MB
                              </span>
                            </div>
                            <button
                              type="button"
                              className="rtr-btn-remove-file"
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

                {/* Policy notice */}
                <div className="rtr-notice-box">
                  <FiInfo className="rtr-notice-icon" />
                  <div className="rtr-notice-content">
                    <h4>Return Policy</h4>
                    <ul>
                      <li>Items must be unused and in original packaging</li>
                      <li>Return shipping costs may apply</li>
                      <li>Returns are processed within 5–7 business days</li>
                      <li>Refunds will be issued to the original payment method</li>
                    </ul>
                  </div>
                </div>

                {/* Actions */}
                <div className="rtr-form-actions">
                  <button
                    type="button"
                    onClick={() => navigate(`/order/${orderId}`)}
                    className="rtr-btn-secondary"
                    disabled={loading || uploadLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rtr-btn-primary"
                    disabled={loading || uploadLoading}
                  >
                    {loading || uploadLoading ? (
                      <><FiClock className="rtr-spin" /> Submitting…</>
                    ) : (
                      <><FiSend /> Submit Return Request</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ── Cancel modal ── */}
      {showCancelModal && (
        <div className="rtr-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="rtr-modal-content" onClick={e => e.stopPropagation()}>
            <div className="rtr-modal-header">
              <h3>Cancel Return Request?</h3>
              <button onClick={() => setShowCancelModal(false)} className="rtr-modal-close">
                <FiX />
              </button>
            </div>
            <div className="rtr-modal-body">
              <p>Are you sure you want to cancel this return request? This action cannot be undone.</p>
            </div>
            <div className="rtr-modal-actions">
              <button
                onClick={() => setShowCancelModal(false)}
                className="rtr-btn-secondary"
                disabled={loading}
              >
                Keep Request
              </button>
              <button
                onClick={handleCancelReturn}
                className="rtr-btn-danger"
                disabled={loading}
              >
                {loading ? 'Cancelling…' : 'Yes, Cancel Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Messages modal ── */}
      <RefundReturnMessagesModal
        isOpen={showMessagesModal}
        onClose={() => setShowMessagesModal(false)}
        orderId={orderId}
        messages={messages}
        loading={messagesLoading}
        onSendMessage={handleSendMessage}
        onRefresh={handleRefreshMessages}
        type="return"
      />

      <Footer />
    </>
  );
}

export default ReturnRequest;