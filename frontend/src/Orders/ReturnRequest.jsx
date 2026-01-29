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

import { 
  getOrderDetails, 
  requestRefund,
  getRefundMessages,
  addRefundMessage,
  uploadRefundFiles,
  cancelRefundRequest,
  getRefundTimeline,
  getRefundDocuments,
  removeErrors,
  clearMessage
} from '../features/cart/orderSlice';

import '../OrderStyles/RefundRequest.css';

// Note: Add these styles to your RefundRequest.css:
/*
.rr-upload-progress {
  margin-top: 1rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.rr-progress-bar {
  width: 100%;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.rr-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #495057 0%, #6c757d 100%);
  transition: width 0.3s ease;
}

.rr-progress-text {
  font-size: 0.85rem;
  color: #666;
  font-weight: 600;
}

.rr-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 1rem;
}

.rr-modal-content {
  background: white;
  border-radius: 16px;
  max-width: 500px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: rr-modalSlideUp 0.3s ease;
}

@keyframes rr-modalSlideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.rr-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid #e9ecef;
}

.rr-modal-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1a1a1a;
  margin: 0;
}

.rr-modal-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: #666;
  cursor: pointer;
  transition: all 0.3s ease;
}

.rr-modal-close:hover {
  background: #f8f9fa;
  color: #1a1a1a;
}

.rr-modal-body {
  padding: 1.5rem;
}

.rr-modal-body p {
  margin: 0 0 1rem 0;
  color: #333;
  line-height: 1.6;
}

.rr-modal-warning {
  color: #f59e0b;
  font-weight: 600;
  font-size: 0.95rem;
}

.rr-modal-actions {
  display: flex;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 1px solid #e9ecef;
}

.rr-btn-danger {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem 1.5rem;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  border: none;
  outline: none;
  background: #dc2626;
  color: white;
}

.rr-btn-danger:hover:not(:disabled) {
  background: #b91c1c;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(220, 38, 38, 0.3);
}

.rr-btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
*/

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
  const pollingIntervalRef = useRef(null);

  const { 
    order, 
    loading: orderLoading, 
    actionLoading,
    refundMessages,
    refundTimeline,
    refundDocuments,
    uploadProgress,
    error,
    message: successMessage
  } = useSelector((state) => state.order);

  const [formData, setFormData] = useState({
    reason: '',
    description: '',
    refundType: 'full',
    requestedAmount: ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Determine if this is a new request or tracking existing refund
  const hasActiveRefund = order?.refundInfo?.status && order.refundInfo.status !== 'none';
  const isTracking = hasActiveRefund;
  const canCancelRefund = isTracking && order?.refundInfo?.status === 'requested';

  // Get currency symbol helper
  const getCurrencySymbol = (currency = 'NGN') => {
    const symbols = {
      NGN: '₦',
      USD: '$',
      EUR: '€',
      GBP: '£',
      GHS: '₵',
      KES: 'KSh',
      ZAR: 'R'
    };
    return symbols[currency] || currency;
  };

  // Fetch order details
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  // Fetch refund messages separately (lazy load)
  useEffect(() => {
    if (isTracking && orderId) {
      dispatch(getRefundMessages(orderId));
      dispatch(getRefundTimeline(orderId));
      dispatch(getRefundDocuments(orderId));
    }
  }, [isTracking, orderId, dispatch]);

  // Polling for real-time updates (every 15 seconds)
  useEffect(() => {
    if (isTracking && orderId) {
      pollingIntervalRef.current = setInterval(() => {
        dispatch(getRefundMessages(orderId));
        dispatch(getOrderDetails(orderId)); // Refresh order status
      }, 15000);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [isTracking, orderId, dispatch]);

  // Pre-fill form data when order refund info becomes available (fixed dependency loop)
  useEffect(() => {
    if (isTracking && order?.refundInfo) {
      setFormData(prev => {
        // Only update if values are different to avoid infinite loop
        if (prev.reason !== order.refundInfo.reason) {
          return {
            reason: order.refundInfo.reason || '',
            description: order.refundInfo.description || '',
            refundType: order.refundInfo.refundType || 'full',
            requestedAmount: order.refundInfo.requestedAmount || ''
          };
        }
        return prev;
      });
    }
  }, [isTracking, order?.refundInfo]);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [refundMessages]);

  // Handle errors
  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center' });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  // Handle success messages
  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage, { position: 'top-center' });
      dispatch(clearMessage());
    }
  }, [successMessage, dispatch]);

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
        errors.requestedAmount = `Amount cannot exceed ${formatCurrency(order.totalPrice, order.paymentInfo?.currency)}`;
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

      // Refresh order details
      dispatch(getOrderDetails(orderId));

      // Clear form
      setFormData({
        reason: '',
        description: '',
        refundType: 'full',
        requestedAmount: ''
      });
      setSelectedFiles([]);
      setFilePreviews([]);
    } catch (error) {
      // Error handled by useEffect
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      await dispatch(addRefundMessage({
        orderId,
        message: newMessage,
        attachments: []
      })).unwrap();

      setNewMessage('');
    } catch (error) {
      // Error handled by useEffect
    }
  };

  const handleCancelRefund = async () => {
    try {
      await dispatch(cancelRefundRequest(orderId)).unwrap();
      
      toast.success('Refund request cancelled successfully', {
        position: 'top-center'
      });

      setShowCancelModal(false);
      
      // Refresh order
      dispatch(getOrderDetails(orderId));
      
      setTimeout(() => navigate(`/order/${orderId}`), 1500);
    } catch (error) {
      // Error handled by useEffect
    }
  };

  const formatCurrency = (amount, currency = 'NGN') => {
    if (!amount) return `${getCurrencySymbol(currency)}0.00`;
    
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    
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

  if (orderLoading) return <Loader />;

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

                  {order.refundInfo.approvedAt && (
                    <div className="rr-timeline-item">
                      <div className={`rr-timeline-dot ${order.refundInfo.status === 'approved' || order.refundInfo.status === 'processing' || order.refundInfo.status === 'completed' ? 'rr-active' : 'rr-rejected'}`}></div>
                      <div className="rr-timeline-content">
                        <span className="rr-timeline-label">
                          {order.refundInfo.status === 'rejected' ? 'Rejected' : 'Approved'}
                        </span>
                        <span className="rr-timeline-date">
                          {new Date(order.refundInfo.approvedAt).toLocaleDateString('en-US', {
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
                        order.refundInfo.requestedAmount || order.refundInfo.refundAmount || order.totalPrice,
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

                {/* Cancel Refund Button */}
                {canCancelRefund && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="rr-btn-secondary"
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      <FiXCircle />
                      Cancel Refund Request
                    </button>
                  </div>
                )}
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
                        aria-label="Full refund option"
                      />
                      <div className="rr-radio-content">
                        <span className="rr-radio-title">Full Refund</span>
                        <span className="rr-radio-subtitle">
                          {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                        </span>
                      </div>
                      <FiCheckCircle className="rr-radio-check" aria-hidden="true" />
                    </label>

                    <label className={`rr-radio-option ${formData.refundType === 'partial' ? 'rr-selected' : ''}`}>
                      <input
                        type="radio"
                        name="refundType"
                        value="partial"
                        checked={formData.refundType === 'partial'}
                        onChange={handleChange}
                        aria-label="Partial refund option"
                      />
                      <div className="rr-radio-content">
                        <span className="rr-radio-title">Partial Refund</span>
                        <span className="rr-radio-subtitle">Specify custom amount</span>
                      </div>
                      <FiCheckCircle className="rr-radio-check" aria-hidden="true" />
                    </label>
                  </div>
                </div>

                {/* Partial Amount */}
                {formData.refundType === 'partial' && (
                  <div className="rr-form-group">
                    <label htmlFor="requestedAmount" className="rr-form-label">
                      Refund Amount ({getCurrencySymbol(order.paymentInfo?.currency)})
                    </label>
                    <div className="rr-input-wrapper">
                      <FiDollarSign className="rr-input-icon" aria-hidden="true" />
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
                        aria-describedby={formErrors.requestedAmount ? "amount-error" : "amount-helper"}
                      />
                    </div>
                    {formErrors.requestedAmount && (
                      <span className="rr-error-message" id="amount-error" role="alert">
                        <FiAlertCircle aria-hidden="true" /> {formErrors.requestedAmount}
                      </span>
                    )}
                    <span className="rr-helper-text" id="amount-helper">
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
                    aria-describedby={formErrors.reason ? "reason-error" : undefined}
                    required
                  >
                    <option value="">Select a reason</option>
                    {REFUND_REASONS.map(reason => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                  {formErrors.reason && (
                    <span className="rr-error-message" id="reason-error" role="alert">
                      <FiAlertCircle aria-hidden="true" /> {formErrors.reason}
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
                    aria-describedby="description-count"
                    required
                  />
                  <div className="rr-textarea-footer">
                    <span className="rr-char-count" id="description-count" aria-live="polite">
                      {formData.description.length} / 500
                    </span>
                    {formErrors.description && (
                      <span className="rr-error-message" role="alert">
                        <FiAlertCircle aria-hidden="true" /> {formErrors.description}
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
                      aria-label="Upload supporting documents"
                    />
                    
                    <button
                      type="button"
                      className="rr-btn-upload"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={selectedFiles.length >= MAX_FILES}
                      aria-label={`Choose files to upload. ${selectedFiles.length} of ${MAX_FILES} files selected`}
                    >
                      <FiPaperclip aria-hidden="true" />
                      Choose Files
                    </button>

                    {/* Upload Progress */}
                    {uploadProgress > 0 && uploadProgress < 100 && (
                      <div className="rr-upload-progress">
                        <div className="rr-progress-bar">
                          <div 
                            className="rr-progress-fill" 
                            style={{ width: `${uploadProgress}%` }}
                            role="progressbar"
                            aria-valuenow={uploadProgress}
                            aria-valuemin="0"
                            aria-valuemax="100"
                          />
                        </div>
                        <span className="rr-progress-text">{uploadProgress}% uploaded</span>
                      </div>
                    )}

                    {selectedFiles.length > 0 && (
                      <div className="rr-file-previews">
                        {filePreviews.map((item, index) => (
                          <div key={index} className="rr-file-preview-item">
                            {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                              <img 
                                src={item.preview} 
                                alt={`Preview of ${item.file.name}`} 
                                className="rr-preview-image" 
                              />
                            ) : ALLOWED_FILE_TYPES.videos.includes(item.type) ? (
                              <div className="rr-preview-placeholder" aria-label="Video file">
                                <FiVideo aria-hidden="true" />
                              </div>
                            ) : (
                              <div className="rr-preview-placeholder" aria-label="Document file">
                                <FiFile aria-hidden="true" />
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
                              aria-label={`Remove ${item.file.name}`}
                            >
                              <FiX aria-hidden="true" />
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
                        <FiClock className="rr-spin" aria-hidden="true" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <FiSend aria-hidden="true" />
                        Submit Refund Request
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Messaging Section */}
          <div className="rr-messaging-card">
            <div className="rr-card-header">
              <FiMessageSquare className="rr-card-icon" aria-hidden="true" />
              <h2>Messages</h2>
            </div>

            <div className="rr-messages-container">
              {!refundMessages || refundMessages.length === 0 ? (
                <div className="rr-empty-messages">
                  <FiMessageSquare className="rr-empty-icon" aria-hidden="true" />
                  <p>{isTracking ? 'No messages yet. Start the conversation!' : 'Submit your refund request to start messaging'}</p>
                </div>
              ) : (
                <div className="rr-messages-list" role="log" aria-label="Refund messages">
                  {refundMessages.map((msg, index) => (
                    <div
                      key={msg._id || index}
                      className={`rr-message ${msg.senderType === 'customer' ? 'rr-message-sent' : 'rr-message-received'}`}
                    >
                      <div className="rr-message-content">
                        <p>{msg.message || msg.content}</p>
                        {msg.attachments?.map((attachment, i) => (
                          <div key={i} className="rr-message-attachment">
                            {getFileIcon(attachment.type)}
                            <a 
                              href={attachment.url} 
                              download 
                              target="_blank" 
                              rel="noopener noreferrer"
                              aria-label={`Download ${attachment.filename || 'attachment'}`}
                            >
                              {attachment.filename || attachment.name || 'Download'}
                            </a>
                          </div>
                        ))}
                      </div>
                      <div className="rr-message-footer">
                        <span className="rr-message-time">
                          {formatTimestamp(msg.createdAt)}
                        </span>
                        {msg.senderType === 'customer' && (
                          <span className={`rr-read-receipt ${msg.isRead ? 'rr-read' : ''}`}>
                            {msg.isRead ? 'Read' : 'Sent'}
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
                    onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    className="rr-message-input"
                    aria-label="Type message"
                  />
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    className="rr-btn-send"
                    disabled={!newMessage.trim() || actionLoading}
                    aria-label="Send message"
                  >
                    <FiSend aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cancel Refund Modal */}
      {showCancelModal && (
        <div className="rr-modal-overlay" onClick={() => setShowCancelModal(false)} role="dialog" aria-modal="true" aria-labelledby="cancel-modal-title">
          <div className="rr-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="rr-modal-header">
              <h2 id="cancel-modal-title">Cancel Refund Request?</h2>
              <button 
                onClick={() => setShowCancelModal(false)} 
                className="rr-modal-close"
                aria-label="Close modal"
              >
                <FiX />
              </button>
            </div>
            <div className="rr-modal-body">
              <p>Are you sure you want to cancel your refund request? This action cannot be undone.</p>
              <p className="rr-modal-warning">You can submit a new refund request later if needed.</p>
            </div>
            <div className="rr-modal-actions">
              <button
                onClick={() => setShowCancelModal(false)}
                className="rr-btn-secondary"
                disabled={actionLoading}
              >
                Keep Request
              </button>
              <button
                onClick={handleCancelRefund}
                className="rr-btn-danger"
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <>
                    <FiClock className="rr-spin" aria-hidden="true" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <FiXCircle aria-hidden="true" />
                    Cancel Request
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}

export default RefundRequest;