import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FiPackage,
  FiDownload,
  FiClock,
  FiTruck,
  FiCheckCircle,
  FiXCircle,
  FiAlertCircle,
  FiFilter,
  FiSearch,
  FiChevronDown,
  FiEye,
  FiMessageCircle,
  FiX,
} from "react-icons/fi";

import PageTitle from "../components/PageTitle";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import MessagesModal from "../components/MessagesModal";

import { getAllMyOrders } from "../features/cart/orderSlice";
import { downloadReceiptPdf } from "../features/cart/receiptSlice";

import "../OrderStyles/MyOrders.css";

function MyOrders() {
  const dispatch = useDispatch();
  const { orders, loading, error } = useSelector((state) => state.order);
  const { downloadLoading } = useSelector((state) => state.receipt);
  const authState = useSelector((state) => state.auth);
  const user = authState?.user || null;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [unreadCounts, setUnreadCounts] = useState({});
  const [trackingModal, setTrackingModal] = useState({ open: false, order: null });
  const [messagesModal, setMessagesModal] = useState({ 
    open: false, 
    order: null, 
    messages: [], 
    loading: false 
  });

  useEffect(() => {
    dispatch(getAllMyOrders());
  }, [dispatch]);

  useEffect(() => {
    if (error) {
      toast.error(error, { position: "top-center" });
    }
  }, [error]);

  // Fetch unread message counts for each order
  useEffect(() => {
    const fetchUnreadCounts = async () => {
      const counts = {};
      for (const order of orders) {
        try {
          const response = await fetch(`/api/v1/orders/${order._id}/messages`, {
            credentials: 'include'
          });
          if (response.ok) {
            const data = await response.json();
            const unread = data.messages?.filter(msg => !msg.isRead && msg.sender !== 'customer').length || 0;
            counts[order._id] = unread;
          }
        } catch (err) {
          console.error('Failed to fetch messages:', err);
        }
      }
      setUnreadCounts(counts);
    };

    if (orders && orders.length > 0) {
      fetchUnreadCounts();
    }
  }, [orders]);

  const handleDownloadReceipt = async (reference) => {
    if (!reference) {
      toast.error("Receipt not found for this order", {
        position: "top-center",
      });
      return;
    }

    try {
      await dispatch(downloadReceiptPdf({ reference })).unwrap();
      toast.success("Receipt downloaded successfully", {
        position: "top-center",
      });
    } catch (err) {
      toast.error(err || "Failed to download receipt", {
        position: "top-center",
      });
    }
  };

  const toggleOrderExpanded = (orderId) => {
    setExpandedOrders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const openTrackingModal = (order) => {
    setTrackingModal({ open: true, order });
  };

  const closeTrackingModal = () => {
    setTrackingModal({ open: false, order: null });
  };

  const openMessagesModal = async (order) => {
    setMessagesModal({ open: true, order, messages: [], loading: true });
    
    try {
      const response = await fetch(`/api/v1/orders/${order._id}/messages`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setMessagesModal(prev => ({ 
          ...prev, 
          messages: data.messages || [], 
          loading: false 
        }));
        
        // Mark messages as read
        await fetch(`/api/v1/orders/${order._id}/messages/read`, {
          method: 'PUT',
          credentials: 'include'
        });
        
        // Update unread count
        setUnreadCounts(prev => ({ ...prev, [order._id]: 0 }));
      } else {
        throw new Error('Failed to fetch messages');
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      setMessagesModal(prev => ({ ...prev, loading: false }));
      toast.error('Failed to load messages', { position: 'top-center' });
    }
  };

  const closeMessagesModal = () => {
    setMessagesModal({ open: false, order: null, messages: [], loading: false });
  };

  const handleSendMessage = async (content) => {
    if (!messagesModal.order) return;

    const response = await fetch(`/api/v1/orders/${messagesModal.order._id}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: content,
        attachments: []
      })
    });

    if (response.ok) {
      const data = await response.json();
      setMessagesModal(prev => ({
        ...prev,
        messages: [...prev.messages, data.orderMessage]
      }));
      toast.success('Message sent', { position: 'top-center' });
    } else {
      throw new Error('Failed to send message');
    }
  };

  const getStatusIcon = (status) => {
    const statusLower = status?.toLowerCase() || "";

    if (statusLower.includes("delivered") || statusLower.includes("completed")) {
      return <FiCheckCircle className="mo-status-icon mo-success" />;
    } else if (statusLower.includes("cancelled") || statusLower.includes("failed")) {
      return <FiXCircle className="mo-status-icon mo-danger" />;
    } else if (statusLower.includes("processing") || statusLower.includes("pending")) {
      return <FiClock className="mo-status-icon mo-warning" />;
    } else if (statusLower.includes("shipped") || statusLower.includes("transit")) {
      return <FiTruck className="mo-status-icon mo-info" />;
    }
    return <FiAlertCircle className="mo-status-icon" />;
  };

  const getStatusClass = (status) => {
    const statusLower = status?.toLowerCase() || "";

    if (statusLower.includes("delivered") || statusLower.includes("completed")) {
      return "mo-status-badge mo-success";
    } else if (statusLower.includes("cancelled") || statusLower.includes("failed")) {
      return "mo-status-badge mo-danger";
    } else if (statusLower.includes("processing") || statusLower.includes("pending")) {
      return "mo-status-badge mo-warning";
    } else if (statusLower.includes("shipped") || statusLower.includes("transit")) {
      return "mo-status-badge mo-info";
    }
    return "mo-status-badge";
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const filteredOrders = orders
    ?.filter((order) => {
      const matchesSearch =
        order._id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.paymentInfo?.reference?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === "all" ||
        order.orderStatus?.toLowerCase() === statusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.createdAt) - new Date(a.createdAt);
      } else if (sortBy === "oldest") {
        return new Date(a.createdAt) - new Date(b.createdAt);
      } else if (sortBy === "highest") {
        return b.totalPrice - a.totalPrice;
      } else if (sortBy === "lowest") {
        return a.totalPrice - b.totalPrice;
      }
      return 0;
    });

  if (loading && !orders?.length) {
    return (
      <>
        <PageTitle title="My Orders" />
        <Navbar />
        <div className="mo-orders-container">
          <div className="mo-orders-loading">
            <div className="mo-loading-spinner"></div>
            <p>Loading your orders...</p>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title="My Orders" />
      <Navbar />

      <div className="mo-orders-container">
        <div className="mo-orders-header">
          <div className="mo-header-title">
            <FiPackage className="mo-header-icon" />
            <h1>My Orders</h1>
            <span className="mo-orders-count">
              {filteredOrders?.length || 0}{" "}
              {filteredOrders?.length === 1 ? "order" : "orders"}
            </span>
          </div>
        </div>

        <div className="mo-orders-controls">
          <div className="mo-search-box">
            <FiSearch className="mo-search-icon" />
            <input
              type="text"
              placeholder="Search by Order ID or Reference..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="mo-search-input"
            />
          </div>

          <div className="mo-filters-group">
            <div className="mo-filter-item">
              <FiFilter className="mo-filter-icon" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mo-filter-select"
              >
                <option value="all">All Status</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="mo-filter-item">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="mo-filter-select"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest">Highest Amount</option>
                <option value="lowest">Lowest Amount</option>
              </select>
            </div>
          </div>
        </div>

        {!filteredOrders || filteredOrders.length === 0 ? (
          <div className="mo-empty-orders">
            <FiPackage className="mo-empty-icon" />
            <h2>No orders found</h2>
            <p>
              {searchTerm || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "You haven't placed any orders yet"}
            </p>
            <Link to="/products" className="mo-shop-now-btn">
              Start Shopping
            </Link>
          </div>
        ) : (
          <div className="mo-orders-list">
            {filteredOrders.map((order) => (
              <div key={order._id} className="mo-order-card">
                <div className="mo-order-card-header">
                  <div className="mo-order-header-left">
                    <div className="mo-order-id-section">
                      <span className="mo-order-label">Order ID:</span>
                      <span className="mo-order-id">
                        #{order._id.slice(-8).toUpperCase()}
                      </span>
                    </div>
                    <div className="mo-order-reference-section">
                      <span className="mo-order-label">Reference:</span>
                      <span className="mo-order-reference">
                        {order.paymentInfo?.reference}
                      </span>
                    </div>
                    <div className="mo-order-date">
                      <FiClock className="mo-date-icon" />
                      {formatDate(order.createdAt)}
                    </div>
                  </div>

                  <div className="mo-order-header-right">
                    <div className={getStatusClass(order.orderStatus)}>
                      {getStatusIcon(order.orderStatus)}
                      {order.orderStatus}
                    </div>
                  </div>
                </div>

                <div className="mo-order-card-body">
                  <div className="mo-order-items-preview">
                    {order.orderItems?.slice(0, 3).map((item, index) => (
                      <div key={index} className="mo-order-item-mini">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="mo-item-mini-img"
                        />
                        <div className="mo-item-mini-info">
                          <p className="mo-item-mini-name">{item.name}</p>
                          <p className="mo-item-mini-qty">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                    {order.orderItems?.length > 3 && (
                      <div className="mo-more-items">
                        +{order.orderItems.length - 3} more item(s)
                      </div>
                    )}
                  </div>

                  <div className="mo-order-summary">
                    <div className="mo-summary-row">
                      <span className="mo-summary-label">Items:</span>
                      <span className="mo-summary-value">
                        {order.orderItems?.length}
                      </span>
                    </div>
                    <div className="mo-summary-row">
                      <span className="mo-summary-label">Total Amount:</span>
                      <span className="mo-summary-value mo-total-amount">
                        {formatCurrency(order.totalPrice)}
                      </span>
                    </div>
                    <div className="mo-summary-row">
                      <span className="mo-summary-label">Payment:</span>
                      <span className="mo-summary-value mo-payment-status">
                        {order.paymentInfo?.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mo-order-card-actions">
                  <button
                    className="mo-action-btn mo-view-details"
                    onClick={() => toggleOrderExpanded(order._id)}
                  >
                    <FiEye />
                    {expandedOrders.has(order._id) ? "Hide Details" : "View Details"}
                    <FiChevronDown
                      className={`mo-chevron ${
                        expandedOrders.has(order._id) ? "mo-rotated" : ""
                      }`}
                    />
                  </button>

                  <button
                    className="mo-action-btn mo-download-receipt"
                    onClick={() => handleDownloadReceipt(order.paymentInfo?.reference)}
                    disabled={downloadLoading}
                  >
                    <FiDownload />
                    {downloadLoading ? "Downloading..." : "Receipt"}
                  </button>

                  <button
                    onClick={() => openMessagesModal(order)}
                    className="mo-action-btn mo-messages-btn"
                  >
                    <FiMessageCircle />
                    Messages
                    {unreadCounts[order._id] > 0 && (
                      <span className="mo-unread-badge">{unreadCounts[order._id]}</span>
                    )}
                  </button>

                  <button
                    onClick={() => openTrackingModal(order)}
                    className="mo-action-btn mo-track-order"
                  >
                    <FiTruck />
                    Track Order
                  </button>
                </div>

                {expandedOrders.has(order._id) && (
                  <div className="mo-order-expanded-details">
                    <div className="mo-expanded-section">
                      <h3 className="mo-section-title">Order Items</h3>
                      <div className="mo-expanded-items-list">
                        {order.orderItems?.map((item, index) => (
                          <div key={index} className="mo-expanded-item">
                            <img
                              src={item.image}
                              alt={item.name}
                              className="mo-expanded-item-img"
                            />
                            <div className="mo-expanded-item-info">
                              <p className="mo-expanded-item-name">{item.name}</p>
                              <p className="mo-expanded-item-details">
                                Quantity: {item.quantity} × {formatCurrency(item.price)}
                              </p>
                            </div>
                            <p className="mo-expanded-item-total">
                              {formatCurrency(item.price * item.quantity)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mo-expanded-section">
                      <h3 className="mo-section-title">Shipping Information</h3>
                      <div className="mo-shipping-info">
                        <p>
                          <strong>Address:</strong> {order.shippingInfo?.address}
                        </p>
                        <p>
                          <strong>City:</strong> {order.shippingInfo?.city}
                        </p>
                        <p>
                          <strong>State:</strong> {order.shippingInfo?.state}
                        </p>
                        <p>
                          <strong>Country:</strong> {order.shippingInfo?.country}
                        </p>
                        <p>
                          <strong>Phone:</strong> {order.shippingInfo?.phoneNo}
                        </p>
                      </div>
                    </div>

                    <div className="mo-expanded-section">
                      <h3 className="mo-section-title">Payment Details</h3>
                      <div className="mo-payment-breakdown">
                        <div className="mo-breakdown-row">
                          <span>Subtotal:</span>
                          <span>{formatCurrency(order.itemPrice)}</span>
                        </div>
                        <div className="mo-breakdown-row">
                          <span>Tax:</span>
                          <span>{formatCurrency(order.taxPrice)}</span>
                        </div>
                        <div className="mo-breakdown-row">
                          <span>Shipping:</span>
                          <span>{formatCurrency(order.shippingPrice)}</span>
                        </div>
                        <div className="mo-breakdown-row mo-total">
                          <span>Total:</span>
                          <span>{formatCurrency(order.totalPrice)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tracking Modal */}
      {trackingModal.open && trackingModal.order && (
        <div className="mo-modal-overlay" onClick={closeTrackingModal}>
          <div className="mo-tracking-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mo-modal-header">
              <h2>Order Tracking</h2>
              <button 
                className="mo-modal-close"
                onClick={closeTrackingModal}
                aria-label="Close modal"
              >
                <FiX />
              </button>
            </div>
            
            <div className="mo-modal-body">
              <div className="mo-tracking-info">
                <p><strong>Order ID:</strong> #{trackingModal.order._id.slice(-8).toUpperCase()}</p>
                <p>
                  <strong>Status:</strong>{" "}
                  <span className={getStatusClass(trackingModal.order.orderStatus)}>
                    {getStatusIcon(trackingModal.order.orderStatus)}
                    {trackingModal.order.orderStatus}
                  </span>
                </p>
                <p><strong>Order Date:</strong> {formatDate(trackingModal.order.createdAt)}</p>
              </div>

              {trackingModal.order.tracking ? (
                <div className="mo-tracking-details">
                  <h3>Shipping Details</h3>
                  <p><strong>Carrier:</strong> {trackingModal.order.tracking.carrier}</p>
                  <p><strong>Tracking Number:</strong> {trackingModal.order.tracking.trackingNumber}</p>
                  {trackingModal.order.tracking.trackingUrl && (
                    <a 
                      href={trackingModal.order.tracking.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mo-track-link"
                    >
                      Track on {trackingModal.order.tracking.carrier} Website
                    </a>
                  )}
                  {trackingModal.order.tracking.estimatedDelivery && (
                    <p><strong>Estimated Delivery:</strong> {formatDate(trackingModal.order.tracking.estimatedDelivery)}</p>
                  )}
                </div>
              ) : (
                <div className="mo-no-tracking">
                  <FiTruck className="mo-no-tracking-icon" />
                  <p>Tracking information not available yet</p>
                  <small>We'll update this once your order ships</small>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages Modal */}
      <MessagesModal
        isOpen={messagesModal.open}
        onClose={closeMessagesModal}
        order={messagesModal.order}
        messages={messagesModal.messages}
        loading={messagesModal.loading}
        user={user}
        userType="customer"
        onSendMessage={handleSendMessage}
      />

      <Footer />
    </>
  );
}

export default MyOrders;