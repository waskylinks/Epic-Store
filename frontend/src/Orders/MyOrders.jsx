import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
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
  FiEye,
  FiMessageCircle,
  FiX,
  FiRefreshCw,
  FiChevronRight,
  FiCalendar,
  FiBox,
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
  const navigate = useNavigate();
  const { orders, loading, error } = useSelector((state) => state.order);
  const { downloadLoading } = useSelector((state) => state.receipt);
  const authState = useSelector((state) => state.auth);
  const user = authState?.user || null;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [unreadCounts, setUnreadCounts] = useState({});
  const [trackingModal, setTrackingModal] = useState({ open: false, order: null });
  const [messagesModal, setMessagesModal] = useState({ 
    open: false, 
    order: null, 
    messages: [], 
    loading: false 
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    dispatch(getAllMyOrders());
  }, [dispatch]);

  useEffect(() => {
    if (error) {
      toast.error(error, { position: "top-center" });
    }
  }, [error]);

  // Fetch unread message counts for each order (ONLY ADMIN MESSAGES)
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
            // Only count unread messages from admin
            const unread = data.messages?.filter(msg => 
              !msg.isRead && (msg.sender === 'admin' || msg.senderType === 'admin')
            ).length || 0;
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

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await dispatch(getAllMyOrders()).unwrap();
      toast.success("Orders refreshed", { position: "top-center" });
    } catch (err) {
      toast.error("Failed to refresh orders", { position: "top-center" });
    } finally {
      setRefreshing(false);
    }
  };

  const openTrackingModal = (order) => {
    setTrackingModal({ open: true, order });
  };

  const closeTrackingModal = () => {
    setTrackingModal({ open: false, order: null });
  };

  const openMessagesModal = async (order) => {
    setMessagesModal({ open: true, order, messages: [], loading: true });
    
    // Immediately mark as read in UI
    setUnreadCounts(prev => ({ ...prev, [order._id]: 0 }));
    
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
        
        // Mark messages as read on server
        await fetch(`/api/v1/orders/${order._id}/messages/read`, {
          method: 'PUT',
          credentials: 'include'
        });
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
        sender: 'customer',
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

  const formatDateWithTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

  const getOrderStats = () => {
    if (!orders || orders.length === 0) return null;
    
    return {
      total: orders.length,
      processing: orders.filter(o => o.orderStatus?.toLowerCase().includes('processing')).length,
      shipped: orders.filter(o => o.orderStatus?.toLowerCase().includes('shipped')).length,
      delivered: orders.filter(o => o.orderStatus?.toLowerCase().includes('delivered')).length,
    };
  };

  const stats = getOrderStats();

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
          <div className="mo-header-content">
            <div className="mo-header-title-section">
              <div className="mo-header-title">
                <FiPackage className="mo-header-icon" />
                <h1>My Orders</h1>
              </div>
              <p className="mo-header-subtitle">
                Track and manage all your orders in one place
              </p>
            </div>
            <button 
              className="mo-refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <FiRefreshCw className={refreshing ? "mo-spinning" : ""} />
              Refresh
            </button>
          </div>

          {stats && (
            <div className="mo-stats-grid">
              <div className="mo-stat-card">
                <div className="mo-stat-icon mo-stat-total">
                  <FiBox />
                </div>
                <div className="mo-stat-content">
                  <span className="mo-stat-value">{stats.total}</span>
                  <span className="mo-stat-label">Total Orders</span>
                </div>
              </div>
              <div className="mo-stat-card">
                <div className="mo-stat-icon mo-stat-processing">
                  <FiClock />
                </div>
                <div className="mo-stat-content">
                  <span className="mo-stat-value">{stats.processing}</span>
                  <span className="mo-stat-label">Processing</span>
                </div>
              </div>
              <div className="mo-stat-card">
                <div className="mo-stat-icon mo-stat-shipped">
                  <FiTruck />
                </div>
                <div className="mo-stat-content">
                  <span className="mo-stat-value">{stats.shipped}</span>
                  <span className="mo-stat-label">Shipped</span>
                </div>
              </div>
              <div className="mo-stat-card">
                <div className="mo-stat-icon mo-stat-delivered">
                  <FiCheckCircle />
                </div>
                <div className="mo-stat-content">
                  <span className="mo-stat-value">{stats.delivered}</span>
                  <span className="mo-stat-label">Delivered</span>
                </div>
              </div>
            </div>
          )}
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
            {searchTerm && (
              <button
                className="mo-search-clear"
                onClick={() => setSearchTerm("")}
                aria-label="Clear search"
              >
                <FiX />
              </button>
            )}
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
            <div className="mo-empty-icon-wrapper">
              <FiPackage className="mo-empty-icon" />
            </div>
            <h2>No orders found</h2>
            <p>
              {searchTerm || statusFilter !== "all"
                ? "Try adjusting your filters to find what you're looking for"
                : "You haven't placed any orders yet. Start shopping to see your orders here!"}
            </p>
            <Link to="/products" className="mo-shop-now-btn">
              Browse Products
            </Link>
          </div>
        ) : (
          <div className="mo-orders-list">
            {filteredOrders.map((order) => (
              <div key={order._id} className="mo-order-card">
                <div className="mo-order-card-header">
                  <div className="mo-order-meta">
                    <div className="mo-order-id-section">
                      <span className="mo-order-label">Order</span>
                      <span className="mo-order-id">
                        #{order._id.slice(-8).toUpperCase()}
                      </span>
                    </div>
                    <div className="mo-order-date">
                      <FiCalendar className="mo-date-icon" />
                      {formatDate(order.createdAt)}
                    </div>
                  </div>

                  <div className={getStatusClass(order.orderStatus)}>
                    {getStatusIcon(order.orderStatus)}
                    {order.orderStatus}
                  </div>
                </div>

                <div className="mo-order-card-body">
                  <div className="mo-order-items-preview">
                    {order.orderItems?.slice(0, 2).map((item, index) => (
                      <div key={index} className="mo-order-item-mini">
                        <div className="mo-item-mini-img-wrapper">
                          <img
                            src={item.image}
                            alt={item.name}
                            className="mo-item-mini-img"
                          />
                        </div>
                        <div className="mo-item-mini-info">
                          <p className="mo-item-mini-name">{item.name}</p>
                          <p className="mo-item-mini-qty">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                    {order.orderItems?.length > 2 && (
                      <div className="mo-more-items">
                        <FiBox className="mo-more-icon" />
                        <span>+{order.orderItems.length - 2} more item(s)</span>
                      </div>
                    )}
                  </div>

                  <div className="mo-order-summary-section">
                    <div className="mo-summary-item">
                      <FiBox className="mo-summary-icon" />
                      <div className="mo-summary-details">
                        <span className="mo-summary-label">Items</span>
                        <span className="mo-summary-value">
                          {order.orderItems?.length}
                        </span>
                      </div>
                    </div>
                    <div className="mo-summary-item mo-summary-total">
                      <div className="mo-summary-details">
                        <span className="mo-summary-label">Total</span>
                        <span className="mo-summary-value mo-total-amount">
                          {formatCurrency(order.totalPrice)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mo-order-card-actions">
                  <Link
                    to={`/order/${order._id}`}
                    className="mo-action-btn mo-view-details-btn"
                  >
                    <FiEye />
                    <span>View Details</span>
                    <FiChevronRight className="mo-chevron-icon" />
                  </Link>

                  <button
                    onClick={() => openMessagesModal(order)}
                    className="mo-action-btn mo-secondary-btn mo-messages-btn"
                  >
                    <FiMessageCircle />
                    <span>Messages</span>
                    {unreadCounts[order._id] > 0 && (
                      <span className="mo-unread-badge">{unreadCounts[order._id]}</span>
                    )}
                  </button>

                  <button
                    onClick={() => openTrackingModal(order)}
                    className="mo-action-btn mo-secondary-btn"
                  >
                    <FiTruck />
                    <span>Track</span>
                  </button>
                </div>
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
                <div className="mo-tracking-info-item">
                  <span className="mo-tracking-label">Order ID</span>
                  <span className="mo-tracking-value">
                    #{trackingModal.order._id.slice(-8).toUpperCase()}
                  </span>
                </div>
                <div className="mo-tracking-info-item">
                  <span className="mo-tracking-label">Status</span>
                  <span className={getStatusClass(trackingModal.order.orderStatus)}>
                    {getStatusIcon(trackingModal.order.orderStatus)}
                    {trackingModal.order.orderStatus}
                  </span>
                </div>
                <div className="mo-tracking-info-item">
                  <span className="mo-tracking-label">Order Date</span>
                  <span className="mo-tracking-value">
                    {formatDateWithTime(trackingModal.order.createdAt)}
                  </span>
                </div>
              </div>

              {trackingModal.order.tracking ? (
                <div className="mo-tracking-details">
                  <h3>Shipping Details</h3>
                  <div className="mo-tracking-details-grid">
                    <div className="mo-tracking-detail-item">
                      <span className="mo-tracking-label">Carrier</span>
                      <span className="mo-tracking-value">
                        {trackingModal.order.tracking.carrier}
                      </span>
                    </div>
                    <div className="mo-tracking-detail-item">
                      <span className="mo-tracking-label">Tracking Number</span>
                      <span className="mo-tracking-value mo-tracking-number">
                        {trackingModal.order.tracking.trackingNumber}
                      </span>
                    </div>
                    {trackingModal.order.tracking.estimatedDelivery && (
                      <div className="mo-tracking-detail-item">
                        <span className="mo-tracking-label">Estimated Delivery</span>
                        <span className="mo-tracking-value">
                          {formatDate(trackingModal.order.tracking.estimatedDelivery)}
                        </span>
                      </div>
                    )}
                  </div>
                  {trackingModal.order.tracking.trackingUrl && (
                    <a 
                      href={trackingModal.order.tracking.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mo-track-link"
                    >
                      Track on {trackingModal.order.tracking.carrier} Website
                      <FiChevronRight />
                    </a>
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