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
  FiRotateCcw,
  FiInfo,
  FiArrowLeft,
  FiBox,
  FiTruck,
} from 'react-icons/fi';

import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';

import { 
  getOrderDetails, 
  requestReturn,
  getReturnMessages,
  addReturnMessage,
  cancelReturnRequest
} from '../features/cart/orderSlice';

import '../OrderStyles/ReturnRequest.css';

const RETURN_REASONS = [
  { value: 'defective_product', label: 'Defective or Damaged Product' },
  { value: 'wrong_item', label: 'Wrong Item Received' },
  { value: 'wrong_size', label: 'Wrong Size/Fit' },
  { value: 'not_as_described', label: 'Product Not As Described' },
  { value: 'quality_issues', label: 'Quality Issues' },
  { value: 'changed_mind', label: 'Changed My Mind' },
  { value: 'better_price', label: 'Found Better Price' },
  { value: 'duplicate_order', label: 'Duplicate Order' },
  { value: 'no_longer_needed', label: 'No Longer Needed' },
  { value: 'other', label: 'Other' }
];

const MAX_FILES = 8;
const ALLOWED_FILE_TYPES = {
  images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos: ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf']
};

// Inline ReturnStatusBadge Component
const ReturnStatusBadge = ({ status }) => {
  const getStatusConfig = (status) => {
    const configs = {
      none: { label: 'No Return', className: 'rtr-return-badge-none', icon: '○' },
      requested: { label: 'Return Requested', className: 'rtr-return-badge-requested', icon: '⏳' },
      approved: { label: 'Approved', className: 'rtr-return-badge-approved', icon: '✓' },
      rejected: { label: 'Rejected', className: 'rtr-return-badge-rejected', icon: '✗' },
      in_transit: { label: 'In Transit', className: 'rtr-return-badge-transit', icon: '🚚' },
      received: { label: 'Received', className: 'rtr-return-badge-received', icon: '📦' },
      inspecting: { label: 'Inspecting', className: 'rtr-return-badge-inspecting', icon: '🔍' },
      completed: { label: 'Completed', className: 'rtr-return-badge-completed', icon: '✓' },
      cancelled: { label: 'Cancelled', className: 'rtr-return-badge-cancelled', icon: '✗' }
    };
    return configs[status] || configs.none;
  };

  const config = getStatusConfig(status);

  return (
    <span className={`rtr-return-badge ${config.className}`}>
      <span className="rtr-return-badge-icon">{config.icon}</span>
      <span className="rtr-return-badge-label">{config.label}</span>
    </span>
  );
};

function ReturnRequest() {
  const { id: orderId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const { order, loading: orderLoading, actionLoading, uploadProgress } = useSelector((state) => state.order);

  const [formData, setFormData] = useState({
    reason: '',
    itemsToReturn: []
  });

  const [formErrors, setFormErrors] = useState({});
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Determine if this is a new request or tracking existing return
  const hasActiveReturn = order?.returnInfo?.status && order.returnInfo.status !== 'none';
  const isTracking = hasActiveReturn;

  // Fetch order details
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  // Load messages when tracking
  useEffect(() => {
    if (isTracking && orderId) {
      dispatch(getReturnMessages(orderId))
        .unwrap()
        .then((result) => {
          setMessages(result.messages || []);
        })
        .catch(() => {});
    }
  }, [isTracking, orderId, dispatch]);

  // Initialize items to return
  useEffect(() => {
    if (order?.orderItems && !isTracking && formData.itemsToReturn.length === 0) {
      const items = order.orderItems.map(item => ({
        product: item.product || item._id,
        name: item.name || '',
        price: item.price || 0,
        image: item.image || '',
        quantity: parseInt(item.quantity) || 1,
        returnQuantity: parseInt(item.quantity) || 1,
        selected: true
      }));
      setFormData(prev => ({ ...prev, itemsToReturn: items }));
    }
  }, [order?.orderItems, isTracking, formData.itemsToReturn.length]);

  // Pre-fill form when tracking
  useEffect(() => {
    if (isTracking && order?.returnInfo && !formData.reason) {
      setFormData({
        reason: order.returnInfo.reason || '',
        itemsToReturn: order.returnInfo.items || []
      });
    }
  }, [isTracking, order?.returnInfo, formData.reason]);

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

  const handleItemToggle = (index) => {
    setFormData(prev => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((item, i) => 
        i === index ? { ...item, selected: !item.selected } : item
      )
    }));
  };

  const handleQuantityChange = (index, quantity) => {
    const item = formData.itemsToReturn[index];
    const newQuantity = Math.max(1, Math.min(quantity, item.quantity));
    
    setFormData(prev => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((item, i) => 
        i === index ? { ...item, returnQuantity: newQuantity } : item
      )
    }));
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
      errors.reason = 'Please select a return reason';
    }

    const selectedItems = formData.itemsToReturn.filter(item => item.selected);
    if (selectedItems.length === 0) {
      errors.items = 'Please select at least one item to return';
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
      const selectedItems = formData.itemsToReturn
        .filter(item => item.selected)
        .map(item => ({
          product: item.product,
          quantity: item.returnQuantity
        }));

      await dispatch(requestReturn({
        orderId,
        reason: formData.reason,
        itemsToReturn: selectedItems,
        images: selectedFiles
      })).unwrap();

      toast.success('Return request submitted successfully!', {
        position: 'top-center',
        autoClose: 3000
      });

      setTimeout(() => navigate(`/order/${orderId}`), 2000);
    } catch (error) {
      toast.error(error || 'Failed to submit return request', {
        position: 'top-center',
        autoClose: 3000
      });
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      await dispatch(addReturnMessage({
        orderId,
        content: newMessage,
        attachments: []
      })).unwrap();

      setNewMessage('');
      
      // Refresh messages
      const result = await dispatch(getReturnMessages(orderId)).unwrap();
      setMessages(result.messages || []);

      toast.success('Message sent', { position: 'top-center' });
    } catch (error) {
      toast.error('Failed to send message', { position: 'top-center' });
    }
  };

  const handleCancelReturn = async () => {
    try {
      await dispatch(cancelReturnRequest(orderId)).unwrap();
      
      toast.success('Return request cancelled', {
        position: 'top-center',
        autoClose: 2000
      });

      setTimeout(() => navigate(`/order/${orderId}`), 1500);
    } catch (error) {
      toast.error(error || 'Failed to cancel return', {
        position: 'top-center'
      });
    } finally {
      setShowCancelModal(false);
    }
  };

  const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
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
  }

  return (
    <>
      <PageTitle title={isTracking ? `Return Status - Order ${orderId}` : `Request Return - Order ${orderId}`} />
      <Navbar />

      <div className="rtr-return-request-container">
        {/* Back Button */}
        <button 
          onClick={() => navigate(`/order/${orderId}`)} 
          className="rtr-btn-back-nav"
        >
          <FiArrowLeft />
          Back to Order Details
        </button>

        <div className="rtr-return-header">
          <div className="rtr-header-content">
            <FiRotateCcw className="rtr-header-icon" />
            <div>
              <h1>{isTracking ? 'Return Status' : 'Request Return'}</h1>
              <p className="rtr-order-reference">Order: #{orderId.slice(-8).toUpperCase()}</p>
            </div>
          </div>
        </div>

        <div className="rtr-return-content">
          {/* Return Status Card - Only show if tracking */}
          {isTracking && (
            <div className="rtr-return-status-card">
              <div className="rtr-card-header">
                <FiInfo className="rtr-card-icon" />
                <h2>Return Information</h2>
                <ReturnStatusBadge status={order.returnInfo.status} />
              </div>
              
              <div className="rtr-status-details">
                <div className="rtr-status-timeline">
                  <div className="rtr-timeline-item">
                    <div className="rtr-timeline-dot rtr-active"></div>
                    <div className="rtr-timeline-content">
                      <span className="rtr-timeline-label">Requested</span>
                      <span className="rtr-timeline-date">
                        {order.returnInfo.requestedAt 
                          ? new Date(order.returnInfo.requestedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : 'N/A'}
                      </span>
                    </div>
                  </div>

                  {order.returnInfo.approvedAt && (
                    <div className="rtr-timeline-item">
                      <div className={`rtr-timeline-dot ${order.returnInfo.status !== 'rejected' ? 'rtr-active' : 'rtr-rejected'}`}></div>
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">
                          {order.returnInfo.status === 'rejected' ? 'Rejected' : 'Approved'}
                        </span>
                        <span className="rtr-timeline-date">
                          {new Date(order.returnInfo.approvedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  {order.returnInfo.shippedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active"></div>
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">In Transit</span>
                        <span className="rtr-timeline-date">
                          {new Date(order.returnInfo.shippedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  {order.returnInfo.receivedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active"></div>
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Received</span>
                        <span className="rtr-timeline-date">
                          {new Date(order.returnInfo.receivedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  {order.returnInfo.completedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active"></div>
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Completed</span>
                        <span className="rtr-timeline-date">
                          {new Date(order.returnInfo.completedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rtr-return-info-grid">
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Return Reason:</span>
                    <span className="rtr-info-value">{order.returnInfo.reason?.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Items to Return:</span>
                    <span className="rtr-info-value">{order.returnInfo.items?.length || 0} item(s)</span>
                  </div>
                  {order.returnInfo.trackingNumber && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">Tracking Number:</span>
                      <span className="rtr-info-value rtr-tracking">{order.returnInfo.trackingNumber}</span>
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

                {/* Return Items List */}
                {order.returnInfo.items && order.returnInfo.items.length > 0 && (
                  <div className="rtr-return-items">
                    <h3>Items Being Returned</h3>
                    <div className="rtr-items-list">
                      {order.returnInfo.items.map((item, index) => (
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

                {/* Cancel Return Button */}
                {order.returnInfo.status === 'requested' && (
                  <button 
                    onClick={() => setShowCancelModal(true)}
                    className="rtr-btn-cancel-return"
                    disabled={actionLoading}
                  >
                    <FiX />
                    Cancel Return Request
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Order Summary Card */}
          <div className="rtr-summary-card">
            <div className="rtr-card-header">
              <FiPackage className="rtr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rtr-summary-details">
              <div className="rtr-summary-row">
                <span className="rtr-label">Total Amount:</span>
                <span className="rtr-value rtr-strong">{formatCurrency(order.totalPrice, order.paymentInfo?.currency)}</span>
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
                  {new Date(order.createdAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Return Form - Only show if NOT tracking */}
          {!isTracking && (
            <div className="rtr-return-form-card">
              <div className="rtr-card-header">
                <FiBox className="rtr-card-icon" />
                <h2>Select Items to Return</h2>
              </div>

              <form onSubmit={handleSubmit} className="rtr-return-form">
                {/* Items Selection */}
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
                            checked={item.selected}
                            onChange={() => handleItemToggle(index)}
                            id={`item-${index}`}
                          />
                          <label htmlFor={`item-${index}`}></label>
                        </div>
                        
                        {item.image && (
                          <img src={item.image} alt={item.name} className="rtr-item-image" />
                        )}
                        
                        <div className="rtr-item-info">
                          <span className="rtr-item-name">{item.name}</span>
                          <span className="rtr-item-price">{formatCurrency(item.price, order.paymentInfo?.currency)}</span>
                        </div>

                        {item.selected && (
                          <div className="rtr-quantity-selector">
                            <label>Quantity:</label>
                            <div className="rtr-quantity-controls">
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(index, item.returnQuantity - 1)}
                                disabled={item.returnQuantity <= 1}
                              >
                                -
                              </button>
                              <span>{item.returnQuantity}</span>
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(index, item.returnQuantity + 1)}
                                disabled={item.returnQuantity >= item.quantity}
                              >
                                +
                              </button>
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

                {/* Return Reason */}
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
                    {RETURN_REASONS.map(reason => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                  {formErrors.reason && (
                    <span className="rtr-error-message">
                      <FiAlertCircle /> {formErrors.reason}
                    </span>
                  )}
                </div>

                {/* File Upload */}
                <div className="rtr-form-group">
                  <label className="rtr-form-label">
                    Supporting Documents (Optional)
                  </label>
                  <p className="rtr-helper-text">
                    Upload up to {MAX_FILES} files (images, videos, or PDFs). Max 10MB each.
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
                      <FiPaperclip />
                      Choose Files
                    </button>

                    {uploadProgress > 0 && uploadProgress < 100 && (
                      <div className="rtr-upload-progress">
                        <div className="rtr-progress-bar">
                          <div 
                            className="rtr-progress-fill" 
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <span className="rtr-progress-text">{uploadProgress}%</span>
                      </div>
                    )}

                    {selectedFiles.length > 0 && (
                      <div className="rtr-file-previews">
                        {filePreviews.map((item, index) => (
                          <div key={index} className="rtr-file-preview-item">
                            {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                              <img src={item.preview} alt={item.file.name} className="rtr-preview-image" />
                            ) : ALLOWED_FILE_TYPES.videos.includes(item.type) ? (
                              <div className="rtr-preview-placeholder">
                                <FiVideo />
                              </div>
                            ) : (
                              <div className="rtr-preview-placeholder">
                                <FiFile />
                              </div>
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

                {/* Important Notice */}
                <div className="rtr-notice-box">
                  <FiInfo className="rtr-notice-icon" />
                  <div className="rtr-notice-content">
                    <h4>Return Policy</h4>
                    <ul>
                      <li>Items must be unused and in original packaging</li>
                      <li>Return shipping costs may apply</li>
                      <li>Returns are processed within 5-7 business days</li>
                      <li>Refunds will be issued to original payment method</li>
                    </ul>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="rtr-form-actions">
                  <button
                    type="button"
                    onClick={() => navigate(`/order/${orderId}`)}
                    className="rtr-btn-secondary"
                    disabled={actionLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rtr-btn-primary"
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <>
                        <FiClock className="rtr-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <FiSend />
                        Submit Return Request
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Messaging Section */}
          {isTracking && (
            <div className="rtr-messaging-card">
              <div className="rtr-card-header">
                <FiMessageSquare className="rtr-card-icon" />
                <h2>Messages</h2>
              </div>

              <div className="rtr-messages-container">
                {messages.length === 0 ? (
                  <div className="rtr-empty-messages">
                    <FiMessageSquare className="rtr-empty-icon" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  <div className="rtr-messages-list">
                    {messages.map((msg, index) => (
                      <div
                        key={msg._id || index}
                        className={`rtr-message ${msg.sender === 'customer' ? 'rtr-message-sent' : 'rtr-message-received'}`}
                      >
                        <div className="rtr-message-content">
                          <p>{msg.content}</p>
                          {msg.attachments?.map((attachment, i) => (
                            <div key={i} className="rtr-message-attachment">
                              {getFileIcon(attachment.type)}
                              <a href={attachment.url} download target="_blank" rel="noopener noreferrer">
                                {attachment.name}
                              </a>
                            </div>
                          ))}
                        </div>
                        <div className="rtr-message-footer">
                          <span className="rtr-message-time">{formatTimestamp(msg.createdAt)}</span>
                          {msg.sender === 'customer' && (
                            <span className={`rtr-read-receipt ${msg.isRead ? 'rtr-read' : ''}`}>
                              {msg.isRead ? 'Read' : 'Sent'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                <div className="rtr-message-input-area">
                  <input
                    type="text"
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    className="rtr-message-input"
                  />
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    className="rtr-btn-send"
                    disabled={!newMessage.trim() || actionLoading}
                  >
                    <FiSend />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="rtr-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="rtr-modal-content" onClick={(e) => e.stopPropagation()}>
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
                disabled={actionLoading}
              >
                Keep Request
              </button>
              <button 
                onClick={handleCancelReturn} 
                className="rtr-btn-danger"
                disabled={actionLoading}
              >
                {actionLoading ? 'Cancelling...' : 'Yes, Cancel Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}

export default ReturnRequest;