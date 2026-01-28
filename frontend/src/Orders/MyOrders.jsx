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

import { getAllMyOrders } from "../features/cart/orderSlice";
import { downloadReceiptPdf } from "../features/cart/receiptSlice";

import "../OrderStyles/MyOrders.css";

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
                        {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
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
                    className="mo-action-btn mo-email-receipt"
                    onClick={() => handleEmailReceipt(order.paymentInfo?.reference)}
                  >
                    <FiMail />
                    Email
                  </button>

                  <Link
                    to={`/order/${order._id}`}
                    className="mo-action-btn mo-track-order"
                  >
                    <FiTruck />
                    Track Order
                  </Link>
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
                                Quantity: {item.quantity} ×{" "}
                                {formatCurrency(item.price, order.paymentInfo?.currency)}
                              </p>
                            </div>
                            <p className="mo-expanded-item-total">
                              {formatCurrency(
                                item.price * item.quantity,
                                order.paymentInfo?.currency
                              )}
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
                          <span>
                            {formatCurrency(order.itemPrice, order.paymentInfo?.currency)}
                          </span>
                        </div>
                        <div className="mo-breakdown-row">
                          <span>Tax:</span>
                          <span>
                            {formatCurrency(order.taxPrice, order.paymentInfo?.currency)}
                          </span>
                        </div>
                        <div className="mo-breakdown-row">
                          <span>Shipping:</span>
                          <span>
                            {formatCurrency(
                              order.shippingPrice,
                              order.paymentInfo?.currency
                            )}
                          </span>
                        </div>
                        <div className="mo-breakdown-row mo-total">
                          <span>Total:</span>
                          <span>
                            {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                          </span>
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
