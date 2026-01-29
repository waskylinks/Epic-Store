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
  FiDownload,
  FiMessageSquare,
  FiInfo,
  FiArrowLeft,
  FiRotateCw,
  FiUser,
  FiMapPin,
  FiTruck,
  FiBox,
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
  getReturnTimeline,
  getReturnDocuments,
  cancelReturnRequest,
} from '../features/cart/orderSlice';

import '../OrderStyles/ReturnRequest.css';

const RETURN_REASONS = [
  { value: 'defective', label: 'Defective or Faulty' },
  { value: 'wrong_item', label: 'Wrong Item Received' },
  { value: 'not_as_described', label: 'Not As Described' },
  { value: 'damaged_shipping', label: 'Damaged During Shipping' },
  { value: 'size_fit', label: 'Size/Fit Issues' },
  { value: 'quality_issues', label: 'Quality Not Satisfactory' },
  { value: 'changed_mind', label: 'Changed My Mind' },
  { value: 'better_price', label: 'Found Better Price' },
  { value: 'other', label: 'Other Reason' }
];

const ITEM_CONDITIONS = [
  { value: 'unopened', label: 'Unopened/Sealed' },
  { value: 'opened_unused', label: 'Opened but Unused' },
  { value: 'lightly_used', label: 'Lightly Used' },
  { value: 'damaged', label: 'Damaged/Defective' }
];

const MAX_FILES_PER_ITEM = 3;
const MAX_TOTAL_FILES = 10;

function ReturnRequest() {
  const { id: orderId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const messagesEndRef = useRef(null);
  const messageFileInputRef = useRef(null);

  const { order, returnMessages = [], returnTimeline = [], returnDocuments = [], loading: orderLoading, actionLoading } = useSelector((state) => state.order);

  // Determine if tracking existing return
  const hasActiveReturn = order?.returnInfo?.status && order.returnInfo.status !== 'none';
  const isTracking = hasActiveReturn;

  // Selected items state
  const [selectedItems, setSelectedItems] = useState([]);
  const [itemDetails, setItemDetails] = useState({});
  const [itemFiles, setItemFiles] = useState({});

  // Form state
  const [generalReason, setGeneralReason] = useState('');
  const [generalDescription, setGeneralDescription] = useState('');
  const [formErrors, setFormErrors] = useState({});

  // Message state
  const [newMessage, setNewMessage] = useState('');
  const [messageFiles, setMessageFiles] = useState([]);

  // Fetch order details
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  // Fetch return data when tracking
  useEffect(() => {
    if (isTracking && orderId) {
      dispatch(getReturnMessages(orderId));
      dispatch(getReturnTimeline(orderId));
      dispatch(getReturnDocuments(orderId));
    }
  }, [isTracking, orderId, dispatch]);

  // Pre-populate form when tracking
  useEffect(() => {
    if (isTracking && order?.returnInfo) {
      setGeneralReason(order.returnInfo.reason || '');
      setGeneralDescription(order.returnInfo.description || '');
      
      if (order.returnInfo.items) {
        const selectedIds = order.returnInfo.items.map(item => item.productId);
        setSelectedItems(selectedIds);
        
        const details = {};
        order.returnInfo.items.forEach(item => {
          details[item.productId] = {
            reason: item.reason || '',
            condition: item.condition || '',
            notes: item.notes || ''
          };
        });
        setItemDetails(details);
      }
    }
  }, [isTracking, order?.returnInfo]);

  // Auto-scroll messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [returnMessages]);

  // Handle item selection
  const toggleItemSelection = (itemId) => {
    setSelectedItems(prev => {
      if (prev.includes(itemId)) {
        // Remove item
        const newSelected = prev.filter(id => id !== itemId);
        
        // Clean up item details and files
        const newDetails = { ...itemDetails };
        const newFiles = { ...itemFiles };
        delete newDetails[itemId];
        delete newFiles[itemId];
        setItemDetails(newDetails);
        setItemFiles(newFiles);
        
        return newSelected;
      } else {
        // Add item
        return [...prev, itemId];
      }
    });
  };

  // Handle item detail change
  const handleItemDetailChange = (itemId, field, value) => {
    setItemDetails(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value
      }
    }));

    // Clear errors
    if (formErrors[`item_${itemId}_${field}`]) {
      setFormErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[`item_${itemId}_${field}`];
        return newErrors;
      });
    }
  };

  // Handle item file selection
  const handleItemFileSelect = (itemId, e) => {
    const files = Array.from(e.target.files);
    const currentItemFiles = itemFiles[itemId] || [];
    
    if (currentItemFiles.length + files.length > MAX_FILES_PER_ITEM) {
      toast.error(`Maximum ${MAX_FILES_PER_ITEM} files per item`, { position: 'top-center' });
      return;
    }

    const totalFiles = Object.values(itemFiles).flat().length + files.length;
    if (totalFiles > MAX_TOTAL_FILES) {
      toast.error(`Maximum ${MAX_TOTAL_FILES} files total`, { position: 'top-center' });
      return;
    }

    const validFiles = files.filter(file => {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10MB`, { position: 'top-center' });
        return false;
      }
      return true;
    });

    setItemFiles(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), ...validFiles]
    }));
  };

  // Remove item file
  const removeItemFile = (itemId, fileIndex) => {
    setItemFiles(prev => ({
      ...prev,
      [itemId]: prev[itemId].filter((_, i) => i !== fileIndex)
    }));
  };

  // Validate form
  const validateForm = () => {
    const errors = {};

    if (selectedItems.length === 0) {
      errors.items = 'Please select at least one item to return';
    }

    selectedItems.forEach(itemId => {
      const details = itemDetails[itemId] || {};
      
      if (!details.reason) {
        errors[`item_${itemId}_reason`] = 'Required';
      }
      
      if (!details.condition) {
        errors[`item_${itemId}_condition`] = 'Required';
      }
    });

    if (!generalDescription || generalDescription.length < 20) {
      errors.generalDescription = 'Please provide at least 20 characters';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit return request
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form', { position: 'top-center' });
      return;
    }

    try {
      const itemsToReturn = selectedItems.map(itemId => {
        const item = order.orderItems.find(oi => oi._id === itemId);
        const details = itemDetails[itemId] || {};
        
        return {
          productId: itemId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          reason: details.reason,
          condition: details.condition,
          notes: details.notes || ''
        };
      });

      const allFiles = Object.values(itemFiles).flat();

      await dispatch(requestReturn({
        orderId,
        reason: generalReason || 'multiple_items',
        itemsToReturn,
        description: generalDescription,
        images: allFiles
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

  // Handle message file selection
  const handleMessageFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + messageFiles.length > 5) {
      toast.error('Maximum 5 files per message', { position: 'top-center' });
      return;
    }
    setMessageFiles(prev => [...prev, ...files]);
  };

  // Remove message file
  const removeMessageFile = (index) => {
    setMessageFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() && messageFiles.length === 0) return;

    try {
      await dispatch(addReturnMessage({
        orderId,
        content: newMessage,
        attachments: messageFiles
      })).unwrap();

      setNewMessage('');
      setMessageFiles([]);
      toast.success('Message sent', { position: 'top-center' });
    } catch (err) {
      toast.error(err || 'Failed to send message', { position: 'top-center' });
    }
  };

  // Cancel return request
  const handleCancelReturn = async () => {
    if (!window.confirm('Are you sure you want to cancel this return request?')) return;

    try {
      await dispatch(cancelReturnRequest(orderId)).unwrap();
      toast.success('Return request cancelled', { position: 'top-center' });
      navigate(`/order/${orderId}`);
    } catch (err) {
      toast.error(err || 'Failed to cancel return', { position: 'top-center' });
    }
  };

  // Format timestamp
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

  // Format currency
  const formatCurrency = (amount, currency = 'NGN') => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Get status icon
  const getStatusIcon = (status) => {
    const statusLower = status?.toLowerCase() || '';
    if (statusLower.includes('approved') || statusLower.includes('completed')) {
      return <FiCheckCircle className="rrr-status-icon rrr-success" />;
    } else if (statusLower.includes('shipped') || statusLower.includes('transit')) {
      return <FiTruck className="rrr-status-icon rrr-info" />;
    } else if (statusLower.includes('received') || statusLower.includes('inspecting')) {
      return <FiBox className="rrr-status-icon rrr-warning" />;
    }
    return <FiClock className="rrr-status-icon rrr-pending" />;
  };

  // Loading state
  if (orderLoading) return <Loader />;

  if (!order?._id) {
    return (
      <>
        <PageTitle title="Order Not Found" />
        <Navbar />
        <div className="rrr-error-container">
          <div className="rrr-error-card">
            <FiAlertCircle className="rrr-error-icon" />
            <h2>Order not found</h2>
            <p>The order you're looking for doesn't exist or you don't have permission to view it.</p>
            <button onClick={() => navigate('/orders/user')} className="rrr-btn-secondary">
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
      <PageTitle title={isTracking ? `Return Tracking - Order ${orderId}` : `Request Return - Order ${orderId}`} />
      <Navbar />

      <div className="rrr-return-container">
        {/* Back Button */}
        <button 
          onClick={() => navigate(`/order/${orderId}`)} 
          className="rrr-btn-back"
        >
          <FiArrowLeft />
          Back to Order Details
        </button>

        {/* Header */}
        <div className="rrr-header">
          <div className="rrr-header-content">
            <FiPackage className="rrr-header-icon" />
            <div>
              <h1>{isTracking ? 'Return Status' : 'Request Return'}</h1>
              <p className="rrr-order-ref">Order: #{orderId.slice(-8).toUpperCase()}</p>
            </div>
          </div>
        </div>

        <div className="rrr-content">
          {/* Return Status Card - Only show if tracking */}
          {isTracking && (
            <div className="rrr-status-card">
              <div className="rrr-card-header">
                <FiInfo className="rrr-card-icon" />
                <h2>Return Information</h2>
                <span className={`rrr-status-badge rrr-status-${order.returnInfo.status}`}>
                  {order.returnInfo.status?.replace(/_/g, ' ')}
                </span>
              </div>
              
              <div className="rrr-status-details">
                {/* RMA Number */}
                {order.returnInfo.rmaNumber && (
                  <div className="rrr-rma-section">
                    <span className="rrr-rma-label">RMA Number:</span>
                    <span className="rrr-rma-number">{order.returnInfo.rmaNumber}</span>
                  </div>
                )}

                {/* Timeline */}
                <div className="rrr-timeline">
                  <h3 className="rrr-timeline-title">Return Progress</h3>
                  {returnTimeline.length === 0 ? (
                    <div className="rrr-empty">
                      <FiClock className="rrr-empty-icon" />
                      <p>No timeline events yet</p>
                    </div>
                  ) : (
                    <div className="rrr-timeline-list">
                      {returnTimeline.map((event, index) => (
                        <div key={index} className="rrr-timeline-item">
                          <div className="rrr-timeline-marker">
                            {getStatusIcon(event.status)}
                            {index < returnTimeline.length - 1 && <div className="rrr-timeline-line" />}
                          </div>
                          <div className="rrr-timeline-content">
                            <h4>{event.status}</h4>
                            <p className="rrr-timeline-date">
                              {new Date(event.timestamp).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                            {event.description && <p className="rrr-timeline-desc">{event.description}</p>}
                            {event.location && (
                              <div className="rrr-timeline-location">
                                <FiMapPin />
                                <span>{event.location}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Return Info Grid */}
                <div className="rrr-info-grid">
                  <div className="rrr-info-item">
                    <span className="rrr-info-label">Items to Return:</span>
                    <span className="rrr-info-value">{order.returnInfo.items?.length || 0}</span>
                  </div>
                  <div className="rrr-info-item">
                    <span className="rrr-info-label">Requested On:</span>
                    <span className="rrr-info-value">
                      {order.returnInfo.requestedAt 
                        ? new Date(order.returnInfo.requestedAt).toLocaleDateString()
                        : 'N/A'}
                    </span>
                  </div>
                  {order.returnInfo.inspectionNotes && (
                    <div className="rrr-info-item rrr-full-width rrr-inspection">
                      <span className="rrr-info-label">Inspection Notes:</span>
                      <span className="rrr-info-value">{order.returnInfo.inspectionNotes}</span>
                    </div>
                  )}
                </div>

                {/* Cancel button if pending */}
                {order.returnInfo.status === 'requested' && (
                  <button onClick={handleCancelReturn} className="rrr-btn-cancel" disabled={actionLoading}>
                    {actionLoading ? 'Cancelling...' : 'Cancel Return Request'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Order Summary */}
          <div className="rrr-summary-card">
            <div className="rrr-card-header">
              <FiPackage className="rrr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rrr-summary-details">
              <div className="rrr-summary-row">
                <span>Total Amount:</span>
                <span className="rrr-strong">{formatCurrency(order.totalPrice, order.paymentInfo?.currency)}</span>
              </div>
              <div className="rrr-summary-row">
                <span>Order Status:</span>
                <span className={`rrr-status-badge rrr-status-${order.orderStatus?.toLowerCase()}`}>
                  {order.orderStatus}
                </span>
              </div>
              <div className="rrr-summary-row">
                <span>Items in Order:</span>
                <span>{order.orderItems?.length || 0}</span>
              </div>
            </div>
          </div>

          {/* Return Form - Only show if NOT tracking */}
          {!isTracking && (
            <div className="rrr-form-card">
              <div className="rrr-card-header">
                <FiInfo className="rrr-card-icon" />
                <h2>Select Items to Return</h2>
              </div>

              <form onSubmit={handleSubmit} className="rrr-form">
                {/* Items Selection */}
                <div className="rrr-items-section">
                  {formErrors.items && (
                    <div className="rrr-error-alert">
                      <FiAlertCircle />
                      {formErrors.items}
                    </div>
                  )}

                  {order.orderItems?.map((item) => (
                    <div key={item._id} className={`rrr-item-card ${selectedItems.includes(item._id) ? 'rrr-selected' : ''}`}>
                      {/* Item Header */}
                      <div className="rrr-item-header">
                        <label className="rrr-checkbox-wrapper">
                          <input
                            type="checkbox"
                            checked={selectedItems.includes(item._id)}
                            onChange={() => toggleItemSelection(item._id)}
                          />
                          <span className="rrr-checkmark"></span>
                        </label>
                        <img src={item.image} alt={item.name} className="rrr-item-img" />
                        <div className="rrr-item-info">
                          <h3>{item.name}</h3>
                          <p>Qty: {item.quantity} × {formatCurrency(item.price, order.paymentInfo?.currency)}</p>
                        </div>
                      </div>

                      {/* Item Details - Show when selected */}
                      {selectedItems.includes(item._id) && (
                        <div className="rrr-item-details">
                          <div className="rrr-form-row">
                            <div className="rrr-form-group">
                              <label>Return Reason *</label>
                              <select
                                value={itemDetails[item._id]?.reason || ''}
                                onChange={(e) => handleItemDetailChange(item._id, 'reason', e.target.value)}
                                className={formErrors[`item_${item._id}_reason`] ? 'rrr-error' : ''}
                              >
                                <option value="">Select reason</option>
                                {RETURN_REASONS.map(r => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                              {formErrors[`item_${item._id}_reason`] && (
                                <span className="rrr-error-text">{formErrors[`item_${item._id}_reason`]}</span>
                              )}
                            </div>

                            <div className="rrr-form-group">
                              <label>Item Condition *</label>
                              <select
                                value={itemDetails[item._id]?.condition || ''}
                                onChange={(e) => handleItemDetailChange(item._id, 'condition', e.target.value)}
                                className={formErrors[`item_${item._id}_condition`] ? 'rrr-error' : ''}
                              >
                                <option value="">Select condition</option>
                                {ITEM_CONDITIONS.map(c => (
                                  <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                              </select>
                              {formErrors[`item_${item._id}_condition`] && (
                                <span className="rrr-error-text">{formErrors[`item_${item._id}_condition`]}</span>
                              )}
                            </div>
                          </div>

                          <div className="rrr-form-group">
                            <label>Additional Notes (Optional)</label>
                            <textarea
                              value={itemDetails[item._id]?.notes || ''}
                              onChange={(e) => handleItemDetailChange(item._id, 'notes', e.target.value)}
                              placeholder="Any specific details about this item..."
                              rows="2"
                            />
                          </div>

                          {/* File Upload */}
                          <div className="rrr-form-group">
                            <label>Photos (Optional - Max {MAX_FILES_PER_ITEM})</label>
                            <input
                              type="file"
                              multiple
                              accept="image/*"
                              onChange={(e) => handleItemFileSelect(item._id, e)}
                              style={{ display: 'none' }}
                              id={`file-${item._id}`}
                            />
                            <button
                              type="button"
                              onClick={() => document.getElementById(`file-${item._id}`).click()}
                              className="rrr-upload-btn"
                              disabled={(itemFiles[item._id]?.length || 0) >= MAX_FILES_PER_ITEM}
                            >
                              <FiPaperclip />
                              Upload Photos
                            </button>

                            {itemFiles[item._id]?.length > 0 && (
                              <div className="rrr-file-previews">
                                {itemFiles[item._id].map((file, index) => (
                                  <div key={index} className="rrr-file-preview">
                                    <FiImage />
                                    <span>{file.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeItemFile(item._id, index)}
                                      className="rrr-remove-file"
                                    >
                                      <FiX />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* General Description */}
                <div className="rrr-form-group">
                  <label>Overall Description *</label>
                  <textarea
                    value={generalDescription}
                    onChange={(e) => {
                      setGeneralDescription(e.target.value);
                      if (formErrors.generalDescription) {
                        setFormErrors(prev => ({ ...prev, generalDescription: '' }));
                      }
                    }}
                    placeholder="Provide a detailed explanation for your return request (minimum 20 characters)..."
                    rows="4"
                    maxLength="500"
                    className={formErrors.generalDescription ? 'rrr-error' : ''}
                  />
                  <div className="rrr-textarea-footer">
                    <span className="rrr-char-count">{generalDescription.length} / 500</span>
                    {formErrors.generalDescription && (
                      <span className="rrr-error-text">{formErrors.generalDescription}</span>
                    )}
                  </div>
                </div>

                {/* Form Actions */}
                <div className="rrr-form-actions">
                  <button
                    type="button"
                    onClick={() => navigate(`/order/${orderId}`)}
                    className="rrr-btn-secondary"
                    disabled={actionLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rrr-btn-primary"
                    disabled={actionLoading || selectedItems.length === 0}
                  >
                    {actionLoading ? (
                      <>
                        <FiRotateCw className="rrr-spin" />
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

          {/* Messages Section */}
          <div className="rrr-messages-card">
            <div className="rrr-card-header">
              <FiMessageSquare className="rrr-card-icon" />
              <h2>Messages</h2>
            </div>

            <div className="rrr-messages-container">
              <div className="rrr-messages-list">
                {returnMessages.length === 0 ? (
                  <div className="rrr-empty">
                    <FiMessageSquare className="rrr-empty-icon" />
                    <p>{isTracking ? 'No messages yet. Start a conversation!' : 'Submit your return request to start messaging'}</p>
                  </div>
                ) : (
                  <>
                    {returnMessages.map((msg, index) => (
                      <div
                        key={msg._id || index}
                        className={`rrr-message ${msg.sender === 'customer' ? 'rrr-sent' : 'rrr-received'}`}
                      >
                        {msg.sender !== 'customer' && (
                          <div className="rrr-avatar">
                            <FiUser />
                          </div>
                        )}
                        <div className="rrr-message-content">
                          {msg.sender !== 'customer' && (
                            <span className="rrr-sender">Support Team</span>
                          )}
                          <div className="rrr-bubble">
                            <p>{msg.content || msg.text}</p>
                            {msg.attachments?.map((file, i) => (
                              <a
                                key={i}
                                href={file.url}
                                className="rrr-attachment"
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <FiPaperclip />
                                {file.name}
                              </a>
                            ))}
                          </div>
                          <div className="rrr-message-footer">
                            <span className="rrr-time">{formatTimestamp(msg.createdAt || msg.timestamp)}</span>
                            {msg.sender === 'customer' && (
                              <span className="rrr-status">
                                {msg.isRead ? '✓✓ Read' : msg.delivered ? '✓✓ Delivered' : '✓ Sent'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {isTracking && (
                <div className="rrr-input-area">
                  {messageFiles.length > 0 && (
                    <div className="rrr-selected-files">
                      {messageFiles.map((file, index) => (
                        <div key={index} className="rrr-selected-file">
                          <span>{file.name}</span>
                          <button type="button" onClick={() => removeMessageFile(index)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="rrr-input-row">
                    <input
                      ref={messageFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      onChange={handleMessageFileSelect}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="rrr-attach-btn"
                      onClick={() => messageFileInputRef.current?.click()}
                    >
                      <FiPaperclip />
                    </button>
                    <input
                      type="text"
                      className="rrr-message-input"
                      placeholder="Type your message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    />
                    <button
                      type="button"
                      className="rrr-send-btn"
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() && messageFiles.length === 0}
                    >
                      <FiSend />
                    </button>
                  </div>
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

export default ReturnRequest;