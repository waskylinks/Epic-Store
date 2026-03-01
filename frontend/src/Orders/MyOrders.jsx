import React, { useEffect, useState, useCallback } from "react";
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
  FiBarChart2,
  FiChevronDown,
  FiChevronUp,
} from "react-icons/fi";
import PageTitle from "../components/PageTitle";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import MessagesModal from "../components/MessagesModal";
import { getAllMyOrders, getCustomerOrderAnalytics } from "../features/cart/orderSlice";
import "../OrderStyles/MyOrders.css";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Count unread messages from admin for a single order's message array.
 * Handles both `senderType` and legacy `sender` field.
 */
const countAdminUnread = (messages = []) =>
  messages.filter(
    (msg) => !msg.isRead && (msg.senderType === "admin" || msg.sender === "admin")
  ).length;

// ─── Component ───────────────────────────────────────────────────────────────

function MyOrders() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { orders, loading, error, customerAnalytics } = useSelector(
    (state) => state.order
  );
  const authState = useSelector((state) => state.auth);
  const user = authState?.user || null;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const [trackingModal, setTrackingModal] = useState({ open: false, order: null });

  // FIX #2: messagesModal no longer maintains its own `messages` array.
  // MessagesModal itself owns the local message list (via its internal state).
  // We only hold the seed messages here (fetched on open) and pass them as
  // the initial `messages` prop — after that the component is self-contained.
  const [messagesModal, setMessagesModal] = useState({
    open: false,
    order: null,
    messages: [],   // seed only — MessagesModal takes ownership after mount
    loading: false,
  });

  const [refreshing, setRefreshing] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch(getAllMyOrders());
    if (user?._id) {
      dispatch(getCustomerOrderAnalytics(user._id));
    }
  }, [dispatch, user?._id]);

  // ── Error toast ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      toast.error(error, { position: "top-center" });
    }
  }, [error]);

  // ── Refresh ─────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await dispatch(getAllMyOrders()).unwrap();
      if (user?._id) {
        await dispatch(getCustomerOrderAnalytics(user._id)).unwrap();
      }
      toast.success("Orders refreshed", { position: "top-center" });
    } catch {
      toast.error("Failed to refresh orders", { position: "top-center" });
    } finally {
      setRefreshing(false);
    }
  };

  // ── Tracking modal ──────────────────────────────────────────────────────
  const openTrackingModal = (order) => setTrackingModal({ open: true, order });
  const closeTrackingModal = () => setTrackingModal({ open: false, order: null });

  // ── Messages modal ──────────────────────────────────────────────────────
  const openMessagesModal = useCallback(async (order) => {
    setMessagesModal({ open: true, order, messages: [], loading: true });

    try {
      const res = await fetch(`/api/v1/orders/${order._id}/messages`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();

      // Seed MessagesModal with the fetched messages.
      // After this point, MessagesModal owns its local copy — we do NOT
      // append to messagesModal.messages on send (that was the double-render bug).
      setMessagesModal((prev) => ({
        ...prev,
        messages: data.messages || [],
        loading: false,
      }));

      // Mark as read on server (fire-and-forget; badge is already cleared)
      fetch(`/api/v1/orders/${order._id}/messages/read`, {
        method: "PUT",
        credentials: "include",
      }).catch(() => {});
    } catch {
      setMessagesModal((prev) => ({ ...prev, loading: false }));
      toast.error("Failed to load messages", { position: "top-center" });
    }
  }, []);

  const closeMessagesModal = useCallback(() => {
    setMessagesModal({ open: false, order: null, messages: [], loading: false });
  }, []);

  // ── Send message ────────────────────────────────────────────────────────
  // FIX #2: We no longer append to messagesModal.messages here.
  // MessagesModal adds an optimistic bubble internally and syncs when the
  // promise resolves. We just POST and return the real message so the modal
  // can replace its optimistic entry.
  const handleSendMessage = useCallback(
    async (content) => {
      if (!messagesModal.order) return;

      const res = await fetch(
        `/api/v1/orders/${messagesModal.order._id}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            sender: "customer",     // legacy field
            senderType: "customer", // canonical field
            attachments: [],
          }),
        }
      );

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      // Return value is used by MessagesModal to replace the optimistic bubble
      // with the real persisted message (correct _id, isRead, timestamps etc.)
      // We intentionally do NOT call setMessagesModal here — that's the fix.
      const data = await res.json();
      return data.orderMessage;
    },
    [messagesModal.order]
  );

  // ── Status helpers ──────────────────────────────────────────────────────
  const getStatusIcon = (status) => {
    const s = status?.toLowerCase() || "";
    if (s.includes("delivered") || s.includes("completed"))
      return <FiCheckCircle className="mo-status-icon mo-success" />;
    if (s.includes("cancelled") || s.includes("failed"))
      return <FiXCircle className="mo-status-icon mo-danger" />;
    if (s.includes("processing") || s.includes("pending"))
      return <FiClock className="mo-status-icon mo-warning" />;
    if (s.includes("shipped") || s.includes("transit"))
      return <FiTruck className="mo-status-icon mo-info" />;
    return <FiAlertCircle className="mo-status-icon" />;
  };

  const getStatusClass = (status) => {
    const s = status?.toLowerCase() || "";
    if (s.includes("delivered") || s.includes("completed"))
      return "mo-status-badge mo-success";
    if (s.includes("cancelled") || s.includes("failed"))
      return "mo-status-badge mo-danger";
    if (s.includes("processing") || s.includes("pending"))
      return "mo-status-badge mo-warning";
    if (s.includes("shipped") || s.includes("transit"))
      return "mo-status-badge mo-info";
    return "mo-status-badge";
  };

  // ── Formatting helpers ──────────────────────────────────────────────────
  const formatCurrency = (amount) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);

  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const formatDateWithTime = (dateString) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // ── Filtering / sorting ─────────────────────────────────────────────────
  const filteredOrders = orders
    ?.filter((order) => {
      const matchesSearch =
        order._id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.paymentInfo?.reference
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ||
        order.orderStatus?.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === "highest") return b.totalPrice - a.totalPrice;
      if (sortBy === "lowest") return a.totalPrice - b.totalPrice;
      return 0;
    });

  // ── Quick stats ─────────────────────────────────────────────────────────
  const getOrderStats = () => {
    if (!orders?.length) return null;
    return {
      total: orders.length,
      processing: orders.filter((o) =>
        o.orderStatus?.toLowerCase().includes("processing")
      ).length,
      shipped: orders.filter((o) =>
        o.orderStatus?.toLowerCase().includes("shipped")
      ).length,
      delivered: orders.filter((o) =>
        o.orderStatus?.toLowerCase().includes("delivered")
      ).length,
    };
  };

  const stats = getOrderStats();

  // ── Loading state ───────────────────────────────────────────────────────
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

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle title="My Orders" />
      <Navbar />

      <div className="mo-orders-container">
        {/* Header */}
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

          {/* Stats grid */}
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

          {/* Analytics – collapsible */}
          {customerAnalytics && (
            <div className="mo-analytics-section">
              <button
                className="mo-analytics-toggle"
                onClick={() => setShowAnalytics(!showAnalytics)}
              >
                <FiBarChart2 />
                <span>Your Order Analytics</span>
                {showAnalytics ? <FiChevronUp /> : <FiChevronDown />}
              </button>

              {showAnalytics && (
                <div className="mo-analytics-content">
                  <div className="mo-analytics-grid">
                    <div className="mo-analytics-card">
                      <span className="mo-analytics-label">Total Spent</span>
                      <span className="mo-analytics-value">
                        {formatCurrency(customerAnalytics.totalSpent || 0)}
                      </span>
                    </div>
                    <div className="mo-analytics-card">
                      <span className="mo-analytics-label">Average Order</span>
                      <span className="mo-analytics-value">
                        {formatCurrency(customerAnalytics.averageOrderValue || 0)}
                      </span>
                    </div>
                    <div className="mo-analytics-card">
                      <span className="mo-analytics-label">First Order</span>
                      <span className="mo-analytics-value">
                        {customerAnalytics.firstOrderDate
                          ? formatDate(customerAnalytics.firstOrderDate)
                          : "N/A"}
                      </span>
                    </div>
                    <div className="mo-analytics-card">
                      <span className="mo-analytics-label">Last Order</span>
                      <span className="mo-analytics-value">
                        {customerAnalytics.lastOrderDate
                          ? formatDate(customerAnalytics.lastOrderDate)
                          : "N/A"}
                      </span>
                    </div>
                  </div>

                  {(customerAnalytics.returnedOrders > 0 ||
                    customerAnalytics.refundedOrders > 0 ||
                    customerAnalytics.cancelledOrders > 0) && (
                    <div className="mo-analytics-additional">
                      <h4>Additional Stats</h4>
                      <div className="mo-analytics-stats">
                        {customerAnalytics.refundedOrders > 0 && (
                          <div className="mo-analytics-stat-item">
                            <span>Refunded Orders:</span>
                            <span>{customerAnalytics.refundedOrders}</span>
                          </div>
                        )}
                        {customerAnalytics.returnedOrders > 0 && (
                          <div className="mo-analytics-stat-item">
                            <span>Returned Orders:</span>
                            <span>{customerAnalytics.returnedOrders}</span>
                          </div>
                        )}
                        {customerAnalytics.cancelledOrders > 0 && (
                          <div className="mo-analytics-stat-item">
                            <span>Cancelled Orders:</span>
                            <span>{customerAnalytics.cancelledOrders}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
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

        {/* Orders list */}
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
            {filteredOrders.map((order) => {
              // Derive unread count directly from order data — same approach as admin.
              // orderMessages is populated by getAllMyOrders; no separate fetch needed.
              const unread = countAdminUnread(order.orderMessages || []);
              return (
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
                      {unread > 0 && (
                        <span className="mo-unread-badge">{unread}</span>
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
              );
            })}
          </div>
        )}
      </div>

      {/* Tracking Modal */}
      {trackingModal.open && trackingModal.order && (
        <div className="mo-modal-overlay" onClick={closeTrackingModal}>
          <div
            className="mo-tracking-modal"
            onClick={(e) => e.stopPropagation()}
          >
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