import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FiPackage,
  FiDownload,
  FiMail,
  FiClock,
  FiTruck,
  FiCheckCircle,
  FiXCircle,
  FiAlertCircle,
  FiFilter,
  FiSearch,
  FiChevronDown,
  FiEye,
} from "react-icons/fi";

import PageTitle from "../components/PageTitle";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";

import { getAllMyOrders } from "../features/order/orderSlice";
import { downloadReceiptPdf } from "../features/cart/receiptSlice";

import "../CartStyles/MyOrders.css";

function MyOrders() {
  const dispatch = useDispatch();
  const { orders, loading, error } = useSelector((state) => state.order);
  const { downloadLoading } = useSelector((state) => state.order);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [expandedOrders, setExpandedOrders] = useState(new Set());

  useEffect(() => {
    dispatch(getAllMyOrders());
  }, [dispatch]);

  useEffect(() => {
    if (error) {
      toast.error(error, { position: "top-center" });
    }
  }, [error]);

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

  const handleEmailReceipt = async (reference) => {
    if (!reference) return;

    try {
      const response = await fetch(`/api/v1/receipts/${reference}/email`, {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        toast.success("Receipt sent to your email", {
          position: "top-center",
        });
      } else {
        throw new Error("Failed to send email");
      }
    } catch (err) {
      toast.error("Failed to send receipt email", {
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

  const getStatusIcon = (status) => {
    const statusLower = status?.toLowerCase() || "";
    
    if (statusLower.includes("delivered") || statusLower.includes("completed")) {
      return <FiCheckCircle className="status-icon success" />;
    } else if (statusLower.includes("cancelled") || statusLower.includes("failed")) {
      return <FiXCircle className="status-icon danger" />;
    } else if (statusLower.includes("processing") || statusLower.includes("pending")) {
      return <FiClock className="status-icon warning" />;
    } else if (statusLower.includes("shipped") || statusLower.includes("transit")) {
      return <FiTruck className="status-icon info" />;
    }
    return <FiAlertCircle className="status-icon" />;
  };

  const getStatusClass = (status) => {
    const statusLower = status?.toLowerCase() || "";
    
    if (statusLower.includes("delivered") || statusLower.includes("completed")) {
      return "status-badge success";
    } else if (statusLower.includes("cancelled") || statusLower.includes("failed")) {
      return "status-badge danger";
    } else if (statusLower.includes("processing") || statusLower.includes("pending")) {
      return "status-badge warning";
    } else if (statusLower.includes("shipped") || statusLower.includes("transit")) {
      return "status-badge info";
    }
    return "status-badge";
  };

  const formatCurrency = (amount, currency = "NGN") => {
    const localeMap = {
      NGN: "en-NG",
      USD: "en-US",
      GBP: "en-GB",
      EUR: "en-DE",
    };

    return new Intl.NumberFormat(localeMap[currency] || "en-US", {
      style: "currency",
      currency: currency,
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
        <div className="orders-container">
          <div className="orders-loading">
            <div className="loading-spinner"></div>
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

      <div className="orders-container">
        <div className="orders-header">
          <div className="header-title">
            <FiPackage className="header-icon" />
            <h1>My Orders</h1>
            <span className="orders-count">
              {filteredOrders?.length || 0} {filteredOrders?.length === 1 ? "order" : "orders"}
            </span>
          </div>
        </div>

        <div className="orders-controls">
          <div className="search-box">
            <FiSearch className="search-icon" />
            <input
              type="text"
              placeholder="Search by Order ID or Reference..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="filters-group">
            <div className="filter-item">
              <FiFilter className="filter-icon" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Status</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="filter-item">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="filter-select"
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
          <div className="empty-orders">
            <FiPackage className="empty-icon" />
            <h2>No orders found</h2>
            <p>
              {searchTerm || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "You haven't placed any orders yet"}
            </p>
            <Link to="/products" className="shop-now-btn">
              Start Shopping
            </Link>
          </div>
        ) : (
          <div className="orders-list">
            {filteredOrders.map((order) => (
              <div key={order._id} className="order-card">
                <div className="order-card-header">
                  <div className="order-header-left">
                    <div className="order-id-section">
                      <span className="order-label">Order ID:</span>
                      <span className="order-id">#{order._id.slice(-8).toUpperCase()}</span>
                    </div>
                    <div className="order-reference-section">
                      <span className="order-label">Reference:</span>
                      <span className="order-reference">{order.paymentInfo?.reference}</span>
                    </div>
                    <div className="order-date">
                      <FiClock className="date-icon" />
                      {formatDate(order.createdAt)}
                    </div>
                  </div>

                  <div className="order-header-right">
                    <div className={getStatusClass(order.orderStatus)}>
                      {getStatusIcon(order.orderStatus)}
                      {order.orderStatus}
                    </div>
                  </div>
                </div>

                <div className="order-card-body">
                  <div className="order-items-preview">
                    {order.orderItems?.slice(0, 3).map((item, index) => (
                      <div key={index} className="order-item-mini">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="item-mini-img"
                        />
                        <div className="item-mini-info">
                          <p className="item-mini-name">{item.name}</p>
                          <p className="item-mini-qty">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                    {order.orderItems?.length > 3 && (
                      <div className="more-items">
                        +{order.orderItems.length - 3} more item(s)
                      </div>
                    )}
                  </div>

                  <div className="order-summary">
                    <div className="summary-row">
                      <span className="summary-label">Items:</span>
                      <span className="summary-value">{order.orderItems?.length}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Total Amount:</span>
                      <span className="summary-value total-amount">
                        {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Payment:</span>
                      <span className="summary-value payment-status">
                        {order.paymentInfo?.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="order-card-actions">
                  <button
                    className="action-btn view-details"
                    onClick={() => toggleOrderExpanded(order._id)}
                  >
                    <FiEye />
                    {expandedOrders.has(order._id) ? "Hide Details" : "View Details"}
                    <FiChevronDown
                      className={`chevron ${expandedOrders.has(order._id) ? "rotated" : ""}`}
                    />
                  </button>

                  <button
                    className="action-btn download-receipt"
                    onClick={() => handleDownloadReceipt(order.paymentInfo?.reference)}
                    disabled={downloadLoading}
                  >
                    <FiDownload />
                    {downloadLoading ? "Downloading..." : "Receipt"}
                  </button>

                  <button
                    className="action-btn email-receipt"
                    onClick={() => handleEmailReceipt(order.paymentInfo?.reference)}
                  >
                    <FiMail />
                    Email
                  </button>

                  <Link
                    to={`/order/${order._id}`}
                    className="action-btn track-order"
                  >
                    <FiTruck />
                    Track Order
                  </Link>
                </div>

                {expandedOrders.has(order._id) && (
                  <div className="order-expanded-details">
                    <div className="expanded-section">
                      <h3 className="section-title">Order Items</h3>
                      <div className="expanded-items-list">
                        {order.orderItems?.map((item, index) => (
                          <div key={index} className="expanded-item">
                            <img
                              src={item.image}
                              alt={item.name}
                              className="expanded-item-img"
                            />
                            <div className="expanded-item-info">
                              <p className="expanded-item-name">{item.name}</p>
                              <p className="expanded-item-details">
                                Quantity: {item.quantity} × {formatCurrency(item.price, order.paymentInfo?.currency)}
                              </p>
                            </div>
                            <p className="expanded-item-total">
                              {formatCurrency(item.price * item.quantity, order.paymentInfo?.currency)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="expanded-section">
                      <h3 className="section-title">Shipping Information</h3>
                      <div className="shipping-info">
                        <p><strong>Address:</strong> {order.shippingInfo?.address}</p>
                        <p><strong>City:</strong> {order.shippingInfo?.city}</p>
                        <p><strong>State:</strong> {order.shippingInfo?.state}</p>
                        <p><strong>Country:</strong> {order.shippingInfo?.country}</p>
                        <p><strong>Phone:</strong> {order.shippingInfo?.phoneNo}</p>
                      </div>
                    </div>

                    <div className="expanded-section">
                      <h3 className="section-title">Payment Details</h3>
                      <div className="payment-breakdown">
                        <div className="breakdown-row">
                          <span>Subtotal:</span>
                          <span>{formatCurrency(order.itemPrice, order.paymentInfo?.currency)}</span>
                        </div>
                        <div className="breakdown-row">
                          <span>Tax:</span>
                          <span>{formatCurrency(order.taxPrice, order.paymentInfo?.currency)}</span>
                        </div>
                        <div className="breakdown-row">
                          <span>Shipping:</span>
                          <span>{formatCurrency(order.shippingPrice, order.paymentInfo?.currency)}</span>
                        </div>
                        <div className="breakdown-row total">
                          <span>Total:</span>
                          <span>{formatCurrency(order.totalPrice, order.paymentInfo?.currency)}</span>
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

      <Footer />
    </>
  );
}

export default MyOrders;