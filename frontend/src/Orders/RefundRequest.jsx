import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  FiImage,
  FiVideo,
  FiDownload,
  FiMessageSquare,
  FiDollarSign,
  FiInfo,
  FiArrowLeft,
} from 'react-icons/fi';

import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';

import { getOrderDetails, requestRefund } from '../features/cart/orderSlice';


import '../OrderStyles/RefundRequest.css';

const REFUND_REASONS = [
  { value: 'defective_product', label: 'Defective or Damaged Product' },
  { value: 'wrong_item', label: 'Wrong Item Received' },
  { value: 'not_as_described', label: 'Product Not As Described' },
  { value: 'damaged_in_shipping', label: 'Damaged During Shipping' },
  { value: 'changed_mind', label: 'Changed My Mind' },
  { value: 'duplicate_order', label: 'Duplicate Order' },
  { value: 'unauthorized_purchase', label: 'Unauthorized Purchase' },
  { value: 'other', label: 'Other' }
];

const MAX_FILES = 5;
const ALLOWED_FILE_TYPES = {
  images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos: ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf']
};

// Inline RefundStatusBadge Component
const RefundStatusBadge = ({ status }) => {
  const getStatusConfig = (status) => {
    const configs = {
      none: { label: 'No Refund', className: 'rr-refund-badge-none', icon: '○' },
      requested: { label: 'Refund Requested', className: 'rr-refund-badge-requested', icon: '⏳' },
      approved: { label: 'Approved', className: 'rr-refund-badge-approved', icon: '✓' },
      rejected: { label: 'Rejected', className: 'rr-refund-badge-rejected', icon: '✗' },
      processing: { label: 'Processing', className: 'rr-refund-badge-processing', icon: '⟳' },
      completed: { label: 'Refunded', className: 'rr-refund-badge-completed', icon: '✓' },
      failed: { label: 'Failed', className: 'rr-refund-badge-failed', icon: '✗' }
    };
    return configs[status] || configs.none;
  };

  const config = getStatusConfig(status);

  return (
    <span className={`rr-refund-badge ${config.className}`}>
      <span className="rr-refund-badge-icon">{config.icon}</span>
      <span className="rr-refund-badge-label">{config.label}</span>
    </span>
  );
};

function RefundRequest() {
  const { id: orderId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const { order, loading: orderLoading, actionLoading } = useSelector((state) => state.order);

  const [formData, setFormData] = useState({
    reason: '',
    description: '',
    refundType: 'full',
    requestedAmount: ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  // Determine if this is a new request or tracking existing refund
  const hasActiveRefund = order?.refundInfo?.status && order.refundInfo.status !== 'none';
  const isTracking = hasActiveRefund;

  // Fetch order details
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  // Load existing messages when order data becomes available
  useEffect(() => {
    if (isTracking && order?.refundInfo?.messages && messages.length === 0) {
      setMessages(order.refundInfo.messages);
    }
  }, [isTracking, order?.refundInfo?.messages, messages.length]);

  // Pre-fill form data when order refund info becomes available
  useEffect(() => {
    if (isTracking && order?.refundInfo && !formData.reason) {
      setFormData({
        reason: order.refundInfo.reason || '',
        description: order.refundInfo.description || '',
        refundType: order.refundInfo.refundType || 'full',
        requestedAmount: order.refundInfo.requestedAmount || ''
      });
    }
  }, [isTracking, order?.refundInfo?.reason, order?.refundInfo?.description, order?.refundInfo?.refundType, order?.refundInfo?.requestedAmount, formData.reason, order.refundInfo]);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const isFileTypeAllowed = (file) => {
    const allAllowedTypes = [
      ...ALLOWED_FILE_TYPES.images,
      ...ALLOWED_FILE_TYPES.videos,
      ...ALLOWED_FILE_TYPES.documents
    ];
    return allAllowedTypes.includes(file.type);
  };

  const getFileIcon = (fileType) => {
    if (ALLOWED_FILE_TYPES.images.includes(fileType)) return <FiImage />;
    if (ALLOWED_FILE_TYPES.videos.includes(fileType)) return <FiVideo />;
    if (ALLOWED_FILE_TYPES.documents.includes(fileType)) return <FiFile />;
    return <FiFile />;
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    
    if (selectedFiles.length + files.length > MAX_FILES) {
      toast.error(`You can only upload up to ${MAX_FILES} files`, {
        position: 'top-center'
      });
      return;
    }

    const validFiles = files.filter(file => {
      if (!isFileTypeAllowed(file)) {
        toast.error(`${file.name} is not a supported file type`, {
          position: 'top-center'
        });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10MB limit`, {
          position: 'top-center'
        });
        return false;
      }
      return true;
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);

    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreviews(prev => [...prev, {
          file,
          preview: reader.result,
          type: file.type
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setFilePreviews(prev => prev.filter((_, i) => i !== index));
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
      const amount = parseFloat(formData.requestedAmount);
      if (!amount || amount <= 0) {
        errors.requestedAmount = 'Please enter a valid amount';
      } else if (amount > order?.totalPrice) {
        errors.requestedAmount = `Amount cannot exceed ${order.totalPrice}`;
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

    try {
      await dispatch(requestRefund({
        orderId,
        reason: formData.reason,
        description: formData.description,
        refundType: formData.refundType,
        requestedAmount: formData.refundType === 'partial' ? parseFloat(formData.requestedAmount) : undefined,
        images: selectedFiles
      })).unwrap();

      toast.success('Refund request submitted successfully!', {
        position: 'top-center',
        autoClose: 3000
      });

      setTimeout(() => navigate(`/order/${orderId}`), 2000);
    } catch (error) {
      toast.error(error || 'Failed to submit refund request', {
        position: 'top-center',
        autoClose: 3000
      });
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const message = {
      id: Date.now(),
      text: newMessage,
      sender: 'customer',
      timestamp: new Date().toISOString(),
      read: false
    };

    setMessages(prev => [...prev, message]);
    setNewMessage('');

    toast.success('Message sent', { position: 'top-center' });
  };

  const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };


  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  if (orderLoading) return (
    <>
    <Navbar />
    <Loader />
    <Footer />
    </>
  );

  if (!order?._id) {
    return (
      <>
        <PageTitle title="Order Not Found" />
        <Navbar />
        <div className="rr-refund-error-container">
          <div className="rr-error-card">
            <FiAlertCircle className="rr-error-icon" />
            <h2>Order not found</h2>
            <p>The order you're looking for doesn't exist or you don't have permission to view it.</p>
            <button onClick={() => navigate('/orders/user')} className="rr-btn-secondary">
              Back to My Orders
            </button>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title={isTracking ? `Refund Status - Order ${orderId}` : `Request Refund - Order ${orderId}`} />
      <Navbar />

      <div className="rr-refund-request-container">
        {/* Back Button */}
        <button 
          onClick={() => navigate(`/order/${orderId}`)} 
          className="rr-btn-back-nav"
        >
          <FiArrowLeft />
          Back to Order Details
        </button>

        <div className="rr-refund-header">
          <div className="rr-header-content">
            <FiDollarSign className="rr-header-icon" />
            <div>
              <h1>{isTracking ? 'Refund Status' : 'Request Refund'}</h1>
              <p className="rr-order-reference">Order: #{orderId.slice(-8).toUpperCase()}</p>
            </div>
          </div>
        </div>

        <div className="rr-refund-content">
          {/* Refund Status Card - Only show if tracking */}
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
                    <div className="rr-timeline-dot rr-active"></div>
                    <div className="rr-timeline-content">
                      <span className="rr-timeline-label">Requested</span>
                      <span className="rr-timeline-date">
                        {order.refundInfo.requestedAt 
                          ? new Date(order.refundInfo.requestedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : 'N/A'}
                      </span>
                    </div>
                  </div>

                  {order.refundInfo.reviewedAt && (
                    <div className="rr-timeline-item">
                      <div className={`rr-timeline-dot ${order.refundInfo.status === 'approved' || order.refundInfo.status === 'processing' || order.refundInfo.status === 'completed' ? 'rr-active' : 'rr-rejected'}`}></div>
                      <div className="rr-timeline-content">
                        <span className="rr-timeline-label">
                          {order.refundInfo.status === 'approved' ? 'Approved' : order.refundInfo.status === 'rejected' ? 'Rejected' : 'Reviewed'}
                        </span>
                        <span className="rr-timeline-date">
                          {new Date(order.refundInfo.reviewedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  {order.refundInfo.processedAt && (
                    <div className="rr-timeline-item">
                      <div className={`rr-timeline-dot ${order.refundInfo.status === 'completed' ? 'rr-active' : order.refundInfo.status === 'failed' ? 'rr-rejected' : ''}`}></div>
                      <div className="rr-timeline-content">
                        <span className="rr-timeline-label">
                          {order.refundInfo.status === 'completed' ? 'Completed' : order.refundInfo.status === 'failed' ? 'Failed' : 'Processing'}
                        </span>
                        <span className="rr-timeline-date">
                          {new Date(order.refundInfo.processedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rr-refund-info-grid">
                  <div className="rr-info-item">
                    <span className="rr-info-label">Refund Type:</span>
                    <span className="rr-info-value">{order.refundInfo.refundType === 'full' ? 'Full Refund' : 'Partial Refund'}</span>
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
                    <span className="rr-info-value">{order.refundInfo.reason?.replace(/_/g, ' ')}</span>
                  </div>
                  {order.refundInfo.description && (
                    <div className="rr-info-item rr-full-width">
                      <span className="rr-info-label">Description:</span>
                      <span className="rr-info-value">{order.refundInfo.description}</span>
                    </div>
                  )}
                  {order.refundInfo.adminNote && (
                    <div className="rr-info-item rr-full-width rr-admin-note">
                      <span className="rr-info-label">Admin Response:</span>
                      <span className="rr-info-value">{order.refundInfo.adminNote}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Order Summary Card */}
          <div className="rr-summary-card">
            <div className="rr-card-header">
              <FiPackage className="rr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rr-summary-details">
              <div className="rr-summary-row">
                <span className="rr-label">Total Amount:</span>
                <span className="rr-value rr-strong">{formatCurrency(order.totalPrice, order.paymentInfo?.currency)}</span>
              </div>
              <div className="rr-summary-row">
                <span className="rr-label">Order Status:</span>
                <span className="rr-value">
                  <span className={`rr-status-badge rr-status-${order.orderStatus.toLowerCase()}`}>
                    {order.orderStatus}
                  </span>
                </span>
              </div>
              <div className="rr-summary-row">
                <span className="rr-label">Payment Status:</span>
                <span className="rr-value">
                  <span className={`rr-status-badge ${order.paymentInfo?.status === 'success' ? 'rr-status-success' : 'rr-status-danger'}`}>
                    {order.paymentInfo?.status === 'success' ? 'Paid' : 'Not Paid'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Refund Form - Only show if NOT tracking */}
          {!isTracking && (
            <div className="rr-refund-form-card">
              <div className="rr-card-header">
                <FiInfo className="rr-card-icon" />
                <h2>Refund Details</h2>
              </div>

              <form onSubmit={handleSubmit} className="rr-refund-form">
                {/* Refund Type */}
                <div className="rr-form-section">
                  <label className="rr-section-label">Refund Type</label>
                  <div className="rr-radio-group">
                    <label className={`rr-radio-option ${formData.refundType === 'full' ? 'rr-selected' : ''}`}>
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

                    <label className={`rr-radio-option ${formData.refundType === 'partial' ? 'rr-selected' : ''}`}>
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

                {/* Partial Amount */}
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
                        className={`rr-form-input rr-has-icon ${formErrors.requestedAmount ? 'rr-error' : ''}`}
                        value={formData.requestedAmount}
                        onChange={handleChange}
                        placeholder="Enter amount"
                        step="0.01"
                        min="0"
                        max={order.totalPrice}
                      />
                    </div>
                    {formErrors.requestedAmount && (
                      <span className="rr-error-message">
                        <FiAlertCircle /> {formErrors.requestedAmount}
                      </span>
                    )}
                    <span className="rr-helper-text">
                      Maximum: {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                    </span>
                  </div>
                )}

                {/* Refund Reason */}
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
                    {REFUND_REASONS.map(reason => (
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
                    className={`rr-form-textarea ${formErrors.description ? 'rr-error' : ''}`}
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

                {/* File Upload */}
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
                              <img src={item.preview} alt={item.file.name} className="rr-preview-image" />
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

                {/* Form Actions */}
                <div className="rr-form-actions">
                  <button
                    type="button"
                    onClick={() => navigate(`/order/${orderId}`)}
                    className="rr-btn-secondary"
                    disabled={actionLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rr-btn-primary"
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
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

          {/* Messaging Section - Always show for both tracking and new requests */}
          <div className="rr-messaging-card">
            <div className="rr-card-header">
              <FiMessageSquare className="rr-card-icon" />
              <h2>Messages</h2>
            </div>

            <div className="rr-messages-container">
              {messages.length === 0 ? (
                <div className="rr-empty-messages">
                  <FiMessageSquare className="rr-empty-icon" />
                  <p>{isTracking ? 'No messages yet. Start the conversation!' : 'Submit your refund request to start messaging'}</p>
                </div>
              ) : (
                <div className="rr-messages-list">
                  {messages.map((msg, index) => (
                    <div
                      key={msg.id || index}
                      className={`rr-message ${msg.sender === 'customer' ? 'rr-message-sent' : 'rr-message-received'}`}
                    >
                      <div className="rr-message-content">
                        <p>{msg.text || msg.content}</p>
                        {msg.attachments?.map((attachment, i) => (
                          <div key={i} className="rr-message-attachment">
                            {getFileIcon(attachment.type)}
                            <a href={attachment.url} download target="_blank" rel="noopener noreferrer">
                              {attachment.name}
                            </a>
                          </div>
                        ))}
                      </div>
                      <div className="rr-message-footer">
                        <span className="rr-message-time">{formatTimestamp(msg.timestamp || msg.createdAt)}</span>
                        {msg.sender === 'customer' && (
                          <span className={`rr-read-receipt ${msg.read ? 'rr-read' : ''}`}>
                            {msg.read ? 'Read' : 'Sent'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {isTracking && (
                <div className="rr-message-input-area">
                  <input
                    type="text"
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    className="rr-message-input"
                  />
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    className="rr-btn-send"
                    disabled={!newMessage.trim()}
                  >
                    <FiSend />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default RefundRequest;