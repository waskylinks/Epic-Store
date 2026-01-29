import React, { useEffect, useState, useRef } from 'react';
import '../OrderStyles/OrderDetails.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  getOrderDetails,
  removeErrors,
  getOrderTimeline,
  getOrderMessages,
  addOrderMessage,
  markOrderMessagesRead,
} from '../features/cart/orderSlice';
import { getRefundStatus } from '../features/refunds/refundSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import RefundStatusBadge from '../components/RefundStatusBadge';
import {
  FiChevronDown,
  FiChevronUp,
  FiClock,
  FiPackage,
  FiTruck,
  FiCheckCircle,
  FiMapPin,
  FiMessageSquare,
  FiSend,
  FiPaperclip,
  FiUser,
  FiDownload,
  FiRotateCw,
} from 'react-icons/fi';

function OrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const { order = {}, timeline = [], orderMessages = [], loading, error, actionLoading } = useSelector((state) => state.order);
  const { refundStatus, statusLoading } = useSelector((state) => state.refund);

  // Accordion state
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);

  // Message state
  const [newMessage, setNewMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);

  // Fetch order details, refund status, timeline, and messages
  useEffect(() => {
    if (id) {
      dispatch(getOrderDetails(id));
      dispatch(getRefundStatus(id));
    }
  }, [dispatch, id]);

  // Fetch timeline when accordion opens
  useEffect(() => {
    if (isTimelineOpen && id && timeline.length === 0) {
      dispatch(getOrderTimeline(id));
    }
  }, [isTimelineOpen, id, timeline.length, dispatch]);

  // Fetch messages when accordion opens
  useEffect(() => {
    if (isMessagesOpen && id && orderMessages.length === 0) {
      dispatch(getOrderMessages(id));
    }
  }, [isMessagesOpen, id, orderMessages.length, dispatch]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (isMessagesOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [orderMessages, isMessagesOpen]);

  // Mark messages as read when opening
  useEffect(() => {
    if (isMessagesOpen && id && orderMessages.some(msg => !msg.isRead && msg.sender !== 'customer')) {
      dispatch(markOrderMessagesRead(id));
    }
  }, [isMessagesOpen, id, orderMessages, dispatch]);

  // Handle API errors
  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 2000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  // Safe destructuring
  const {
    shippingInfo = {},
    orderItems = [],
    paymentInfo = {},
    orderStatus,
    totalPrice,
    taxPrice,
    shippingPrice,
    itemPrice,
  } = order;

  // Loading state
  if (loading) return <Loader />;
  if (!order?._id) return null;

  // Payment status
  const isPaid = paymentInfo?.status === 'success';
  const paymentStatus = isPaid ? 'Paid' : 'Not Paid';
  const paidAt = paymentInfo?.paidAt;

  // Refund eligibility check
  const hasActiveRefund = refundStatus?.hasRefund === true || 
                          (refundStatus?.status && refundStatus.status !== 'none');

  const refundableStatuses = ['Delivered', 'Shipped', 'Cancelled'];
  const isRefundable = isPaid && 
    !hasActiveRefund && 
    refundableStatuses.includes(orderStatus);

  // Return eligibility check
  const hasActiveReturn = order?.returnInfo?.status && order.returnInfo.status !== 'none';
  const returnableStatuses = ['Delivered'];
  const isReturnable = isPaid && 
    !hasActiveRefund && 
    !hasActiveReturn &&
    returnableStatuses.includes(orderStatus);

  // Status badge classes
  const orderStatusClass =
    orderStatus === 'Delivered'
      ? 'od-status-tag od-delivered'
      : `od-status-tag od-${orderStatus?.toLowerCase()}`;

  const paymentStatusClass = `od-pay-tag ${isPaid ? 'od-paid' : 'od-not-paid'}`;

  // Count unread messages
  const unreadCount = orderMessages.filter(msg => !msg.isRead && msg.sender !== 'customer').length;

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + selectedFiles.length > 5) {
      toast.error('Maximum 5 files allowed', { position: 'top-center' });
      return;
    }
    setSelectedFiles(prev => [...prev, ...files]);
  };

  // Remove selected file
  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() && selectedFiles.length === 0) return;

    try {
      await dispatch(addOrderMessage({
        orderId: id,
        content: newMessage,
        attachments: selectedFiles,
      })).unwrap();

      setNewMessage('');
      setSelectedFiles([]);
      toast.success('Message sent', { position: 'top-center' });
    } catch (err) {
      toast.error(err || 'Failed to send message', { position: 'top-center' });
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

  // Get status icon for timeline
  const getStatusIcon = (status) => {
    const statusLower = status?.toLowerCase() || '';
    if (statusLower.includes('delivered') || statusLower.includes('completed')) {
      return <FiCheckCircle className="ot-status-icon ot-completed" />;
    } else if (statusLower.includes('shipped') || statusLower.includes('transit')) {
      return <FiTruck className="ot-status-icon ot-shipping" />;
    } else if (statusLower.includes('processing') || statusLower.includes('confirmed')) {
      return <FiPackage className="ot-status-icon ot-processing" />;
    }
    return <FiClock className="ot-status-icon ot-pending" />;
  };

  return (
    <>
      <PageTitle title={`Order ${id}`} />
      <Navbar />

      <div className="od-order-box">
        {/* Refund Alert */}
        {hasActiveRefund && (
          <div className="od-refund-alert">
            <div className="od-refund-alert-header">
              <h3>Refund Status</h3>
              <RefundStatusBadge status={refundStatus.status} />
            </div>
            <div className="od-refund-alert-body">
              <p><strong>Reason:</strong> {refundStatus.reason?.replace(/_/g, ' ')}</p>
              {refundStatus.description && (
                <p><strong>Description:</strong> {refundStatus.description}</p>
              )}
              {refundStatus.refundAmount && (
                <p><strong>Refund Amount:</strong> ₦{refundStatus.refundAmount?.toLocaleString()}</p>
              )}
              {refundStatus.requestedAt && (
                <p><strong>Requested On:</strong> {new Date(refundStatus.requestedAt).toLocaleDateString()}</p>
              )}
              {refundStatus.adminNote && (
                <p><strong>Admin Note:</strong> {refundStatus.adminNote}</p>
              )}
            </div>
          </div>
        )}

        {/* ORDER ITEMS */}
        <div className="od-table-block">
          <h2 className="od-table-title">Order Items</h2>
          <table className="od-table-main">
            <thead>
              <tr>
                <th className="od-head-cell">Image</th>
                <th className="od-head-cell">Product Name</th>
                <th className="od-head-cell">Quantity</th>
                <th className="od-head-cell">Price</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.map((item) => (
                <tr key={item._id} className="od-table-row">
                  <td className="od-table-cell">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="od-item-img"
                    />
                  </td>
                  <td className="od-table-cell">{item.name}</td>
                  <td className="od-table-cell">{item.quantity}</td>
                  <td className="od-table-cell">₦{item.price?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* SHIPPING INFO */}
        <div className="od-table-block">
          <h2 className="od-table-title">Shipping Info</h2>
          <table className="od-table-main">
            <tbody>
              <tr className="od-table-row">
                <th className="od-table-cell">Address</th>
                <td className="od-table-cell">
                  {shippingInfo.address}, {shippingInfo.city},{' '}
                  {shippingInfo.state}, {shippingInfo.country},{' '}
                  {shippingInfo.pinCode}
                </td>
              </tr>
              <tr className="od-table-row">
                <th className="od-table-cell">Phone</th>
                <td className="od-table-cell">{shippingInfo.phoneNo}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ORDER SUMMARY */}
        <div className="od-table-block">
          <h2 className="od-table-title">Order Summary</h2>
          <table className="od-table-main">
            <tbody>
              <tr className="od-table-row">
                <th className="od-table-cell">Order Status</th>
                <td className="od-table-cell">
                  <span className={orderStatusClass}>
                    {orderStatus}
                  </span>
                </td>
              </tr>

              <tr className="od-table-row">
                <th className="od-table-cell">Payment Status</th>
                <td className="od-table-cell">
                  <span className={paymentStatusClass}>
                    {paymentStatus}
                  </span>
                </td>
              </tr>

              {paidAt && (
                <tr className="od-table-row">
                  <th className="od-table-cell">Paid At</th>
                  <td className="od-table-cell">
                    {new Date(paidAt).toLocaleString()}
                  </td>
                </tr>
              )}

              <tr className="od-table-row">
                <th className="od-table-cell">Item Price</th>
                <td className="od-table-cell">₦{itemPrice?.toLocaleString()}</td>
              </tr>

              <tr className="od-table-row">
                <th className="od-table-cell">Tax</th>
                <td className="od-table-cell">₦{taxPrice?.toLocaleString()}</td>
              </tr>

              <tr className="od-table-row">
                <th className="od-table-cell">Shipping</th>
                <td className="od-table-cell">₦{shippingPrice?.toLocaleString()}</td>
              </tr>

              <tr className="od-table-row">
                <th className="od-table-cell">Total</th>
                <td className="od-table-cell">₦{totalPrice?.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 🆕 TIMELINE/TRACKING ACCORDION */}
        <div className="od-table-block ot-accordion">
          <button
            className="ot-accordion-header"
            onClick={() => setIsTimelineOpen(!isTimelineOpen)}
            aria-expanded={isTimelineOpen}
          >
            <div className="ot-header-content">
              <FiTruck className="ot-header-icon" />
              <div>
                <h2 className="ot-accordion-title">Order Timeline & Tracking</h2>
                <p className="ot-accordion-subtitle">View your order's journey</p>
              </div>
            </div>
            {isTimelineOpen ? <FiChevronUp /> : <FiChevronDown />}
          </button>

          {isTimelineOpen && (
            <div className="ot-accordion-content">
              {actionLoading && timeline.length === 0 ? (
                <div className="ot-loading">
                  <FiRotateCw className="ot-spin" />
                  <p>Loading timeline...</p>
                </div>
              ) : timeline.length === 0 ? (
                <div className="ot-empty">
                  <FiClock className="ot-empty-icon" />
                  <p>No timeline events available yet</p>
                </div>
              ) : (
                <div className="ot-timeline">
                  {timeline.map((event, index) => (
                    <div key={index} className="ot-timeline-item">
                      <div className="ot-timeline-marker">
                        {getStatusIcon(event.status)}
                        {index < timeline.length - 1 && <div className="ot-timeline-line" />}
                      </div>
                      <div className="ot-timeline-content">
                        <div className="ot-timeline-header">
                          <h3 className="ot-timeline-status">{event.status}</h3>
                          <span className="ot-timeline-date">
                            {new Date(event.timestamp).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {event.description && (
                          <p className="ot-timeline-description">{event.description}</p>
                        )}
                        {event.location && (
                          <div className="ot-timeline-location">
                            <FiMapPin />
                            <span>{event.location}</span>
                          </div>
                        )}
                        {event.trackingNumber && (
                          <div className="ot-timeline-tracking">
                            <strong>Tracking:</strong> {event.trackingNumber}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 🆕 MESSAGES ACCORDION */}
        <div className="od-table-block om-accordion">
          <button
            className="om-accordion-header"
            onClick={() => setIsMessagesOpen(!isMessagesOpen)}
            aria-expanded={isMessagesOpen}
          >
            <div className="om-header-content">
              <FiMessageSquare className="om-header-icon" />
              <div>
                <h2 className="om-accordion-title">Messages</h2>
                <p className="om-accordion-subtitle">Chat with support about this order</p>
              </div>
              {unreadCount > 0 && (
                <span className="om-unread-badge">{unreadCount}</span>
              )}
            </div>
            {isMessagesOpen ? <FiChevronUp /> : <FiChevronDown />}
          </button>

          {isMessagesOpen && (
            <div className="om-accordion-content">
              <div className="om-messages-container">
                <div className="om-messages-list">
                  {actionLoading && orderMessages.length === 0 ? (
                    <div className="om-loading">
                      <FiRotateCw className="om-spin" />
                      <p>Loading messages...</p>
                    </div>
                  ) : orderMessages.length === 0 ? (
                    <div className="om-empty">
                      <FiMessageSquare className="om-empty-icon" />
                      <p>No messages yet. Start a conversation!</p>
                    </div>
                  ) : (
                    <>
                      {orderMessages.map((msg, index) => (
                        <div
                          key={msg._id || index}
                          className={`om-message ${
                            msg.sender === 'customer' ? 'om-message-sent' : 'om-message-received'
                          }`}
                        >
                          {msg.sender !== 'customer' && (
                            <div className="om-message-avatar">
                              <FiUser />
                            </div>
                          )}
                          <div className="om-message-content">
                            {msg.sender !== 'customer' && (
                              <span className="om-message-sender">Support Team</span>
                            )}
                            <div className="om-message-bubble">
                              <p>{msg.content || msg.text}</p>
                              {msg.attachments?.map((file, i) => (
                                <a
                                  key={i}
                                  href={file.url}
                                  className="om-message-attachment"
                                  download
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <FiPaperclip />
                                  {file.name}
                                </a>
                              ))}
                            </div>
                            <div className="om-message-footer">
                              <span className="om-message-time">
                                {formatTimestamp(msg.createdAt || msg.timestamp)}
                              </span>
                              {msg.sender === 'customer' && (
                                <span className="om-message-status">
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

                {/* Message Input */}
                <div className="om-input-area">
                  {selectedFiles.length > 0 && (
                    <div className="om-selected-files">
                      {selectedFiles.map((file, index) => (
                        <div key={index} className="om-selected-file">
                          <span>{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="om-remove-file"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="om-input-row">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="om-attach-btn"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach files"
                    >
                      <FiPaperclip />
                    </button>
                    <input
                      type="text"
                      className="om-message-input"
                      placeholder="Type your message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    />
                    <button
                      type="button"
                      className="om-send-btn"
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() && selectedFiles.length === 0}
                    >
                      <FiSend />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div className="od-action-buttons">
          {isRefundable && !statusLoading && (
            <button
              onClick={() => navigate(`/orders/${id}/refund/request`)}
              className="od-btn od-btn-refund"
            >
              Request Refund
            </button>
          )}

          {isReturnable && (
            <button
              onClick={() => navigate(`/orders/${id}/return/request`)}
              className="od-btn od-btn-return"
            >
              Request Return
            </button>
          )}

          <button
            onClick={() => {/* Handle download invoice */}}
            className="od-btn od-btn-invoice"
          >
            <FiDownload />
            Download Invoice
          </button>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default OrderDetails;