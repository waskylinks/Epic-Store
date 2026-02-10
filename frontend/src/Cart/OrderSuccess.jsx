import React, { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";

import PageTitle from "../components/PageTitle";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";

import "../CartStyles/PaymentSuccess.css";

import { downloadReceiptPdf, fetchReceiptByReference } from "../features/cart/receiptSlice";
import { clearCheckout } from "../features/checkout/checkoutSlice";
import axios from "axios";

function OrderSuccess() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference");
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { selectedReceipt, loading: receiptLoading } = useSelector((state) => state.receipt || {});
  
  const [orderDetails, setOrderDetails] = useState(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [receiptReady, setReceiptReady] = useState(false);
  const [pollingAttempts, setPollingAttempts] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  // Clear checkout session on mount
  useEffect(() => {
    dispatch(clearCheckout());
  }, [dispatch]);

  // Fetch order by payment reference
  const fetchOrderByReference = useCallback(async () => {
    if (!reference) return;
    
    setOrderLoading(true);
    try {
      const { data } = await axios.get(
        `/api/v1/orders/reference/${reference}`,
        { withCredentials: true }
      );
      setOrderDetails(data.order);
    } catch (err) {
      console.error("Failed to fetch order:", err);
      
      if (err.response?.status !== 404) {
        toast.error(
          err.response?.data?.message || "Unable to load order details", 
          { position: "top-center" }
        );
      }
    } finally {
      setOrderLoading(false);
    }
  }, [reference]);

  // Validate reference on mount
  useEffect(() => {
    if (!reference || reference.trim() === "") {
      toast.error("Invalid order reference", { position: "top-center" });
      navigate("/");
      return;
    }

    fetchOrderByReference();
  }, [reference, navigate, fetchOrderByReference]);

  // Poll for receipt availability
  useEffect(() => {
    if (!reference || receiptReady || pollingAttempts >= 10) return;

    const pollReceipt = async () => {
      try {
        const response = await axios.get(
          `/api/v1/receipts/${reference}/exists`,
          { withCredentials: true }
        );
        
        if (response.data.exists) {
          setReceiptReady(true);
          dispatch(fetchReceiptByReference(reference));
          
          if (!orderDetails) {
            fetchOrderByReference();
          }
        } else {
          setPollingAttempts(prev => prev + 1);
        }
      } catch (err) {
        console.error("Receipt polling error:", err);
        setPollingAttempts(prev => prev + 1);
      }
    };

    const timerId = setTimeout(() => {
      pollReceipt();
    }, 2000);

    return () => clearTimeout(timerId);
  }, [reference, receiptReady, pollingAttempts, dispatch, orderDetails, fetchOrderByReference]);

  const handleDownloadReceipt = async () => {
    if (!reference) {
      toast.error("Receipt not found", { position: "top-center" });
      return;
    }

    if (!receiptReady) {
      toast.info("Receipt is being prepared", { position: "top-center" });
      return;
    }

    setDownloadLoading(true);

    try {
      await dispatch(downloadReceiptPdf({ reference })).unwrap();
      toast.success("Receipt downloaded", { position: "top-center" });
    } catch (err) {
      toast.error(err || "Failed to download receipt", { position: "top-center" });
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleEmailReceipt = async () => {
    if (!reference) {
      toast.error("Invalid receipt reference", { position: "top-center" });
      return;
    }

    if (!receiptReady) {
      toast.info("Receipt is being prepared", { position: "top-center" });
      return;
    }

    setEmailLoading(true);

    try {
      const response = await axios.post(
        `/api/v1/receipts/${reference}/email`,
        {},
        { withCredentials: true }
      );
      
      toast.success(response.data.message || "Receipt sent to your email", {
        position: "top-center"
      });
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send receipt", {
        position: "top-center"
      });
    } finally {
      setEmailLoading(false);
    }
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

  const getPaymentMethodDisplay = (method) => {
    const methods = {
      paystack: "Paystack",
      flutterwave: "Flutterwave",
      stripe: "Stripe",
      manual: "Manual",
    };
    return methods[method] || method;
  };

  if (orderLoading) {
    return (
      <>
        <PageTitle title="Order Confirmed" />
        <Navbar />
        <div className="payment-success-container">
          <div className="success-content">
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading order details...</p>
            </div>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title="Order Confirmed" />
      <Navbar />

      <div className="payment-success-container">
        <div className="success-content">
          {/* Success Header */}
          <div className="success-header">
            <div className="success-icon">✓</div>
            <h1>Payment Successful!</h1>
            <p className="success-subtitle">
              Thank you for your order. Your payment has been confirmed.
            </p>
          </div>

          {/* Order Reference */}
          <div className="order-reference-box">
            <p className="reference-label">Order Reference</p>
            <p className="reference-value">{reference}</p>
          </div>

          {/* Order Details */}
          {orderDetails ? (
            <div className="order-details-section">
              <h2>Order Details</h2>
              
              <div className="order-info-grid">
                <div className="info-item">
                  <span className="info-label">Payment Method:</span>
                  <span className="info-value">
                    {getPaymentMethodDisplay(orderDetails.paymentInfo?.method)}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Amount Paid:</span>
                  <span className="info-value">
                    {formatCurrency(
                      orderDetails.totalPrice,
                      orderDetails.paymentInfo?.currency
                    )}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Currency:</span>
                  <span className="info-value">
                    {orderDetails.paymentInfo?.currency}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Items:</span>
                  <span className="info-value">
                    {orderDetails.orderItems?.length || 0} item(s)
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Order Status:</span>
                  <span className="info-value status-badge">
                    {orderDetails.orderStatus}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Payment Status:</span>
                  <span className="info-value payment-status-success">
                    {orderDetails.paymentInfo?.status}
                  </span>
                </div>
              </div>

              {/* Order Items Preview */}
              {orderDetails.orderItems && orderDetails.orderItems.length > 0 && (
                <div className="order-items-preview">
                  <h3>Ordered Items</h3>
                  <div className="items-list">
                    {orderDetails.orderItems.map((item, index) => (
                      <div key={index} className="item-row">
                        <img 
                          src={item.image} 
                          alt={item.name} 
                          className="item-thumbnail"
                        />
                        <div className="item-details">
                          <p className="item-name">{item.name}</p>
                          <p className="item-quantity">Qty: {item.quantity}</p>
                        </div>
                        <p className="item-price">
                          {formatCurrency(
                            item.price * item.quantity,
                            orderDetails.paymentInfo?.currency
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Price Breakdown */}
              <div className="price-breakdown">
                <div className="breakdown-row">
                  <span>Subtotal:</span>
                  <span>
                    {formatCurrency(
                      orderDetails.itemPrice || 0,
                      orderDetails.paymentInfo?.currency
                    )}
                  </span>
                </div>
                <div className="breakdown-row">
                  <span>Tax:</span>
                  <span>
                    {formatCurrency(
                      orderDetails.taxPrice || 0,
                      orderDetails.paymentInfo?.currency
                    )}
                  </span>
                </div>
                <div className="breakdown-row">
                  <span>Shipping:</span>
                  <span>
                    {formatCurrency(
                      orderDetails.shippingPrice || 0,
                      orderDetails.paymentInfo?.currency
                    )}
                  </span>
                </div>
                <div className="breakdown-row total">
                  <span>Total:</span>
                  <span>
                    {formatCurrency(
                      orderDetails.totalPrice || 0,
                      orderDetails.paymentInfo?.currency
                    )}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="order-details-error">
              <p>Your order is being processed. Details will appear shortly.</p>
              <button 
                className="retry-btn" 
                onClick={fetchOrderByReference}
                style={{ marginTop: '1rem' }}
              >
                Refresh Order Details
              </button>
            </div>
          )}

          {/* Receipt Section */}
          <div className="receipt-section">
            <h2>Receipt</h2>
            
            {!receiptReady && pollingAttempts < 10 && (
              <div className="receipt-preparing">
                <div className="spinner"></div>
                <p>Preparing your receipt...</p>
              </div>
            )}

            {receiptReady && (
              <div className="receipt-actions">
                <button
                  className="download-receipt-btn"
                  onClick={handleDownloadReceipt}
                  disabled={downloadLoading}
                >
                  {downloadLoading ? "Downloading..." : "Download Receipt (PDF)"}
                </button>

                <button
                  className="email-receipt-btn"
                  onClick={handleEmailReceipt}
                  disabled={emailLoading}
                >
                  {emailLoading ? "Sending..." : "Email Receipt"}
                </button>
              </div>
            )}

            {!receiptReady && pollingAttempts >= 10 && (
              <div className="receipt-retry">
                <p>Receipt generation is taking longer than expected.</p>
                <button
                  className="retry-btn"
                  onClick={() => {
                    setPollingAttempts(0);
                    setReceiptReady(false);
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <Link className="view-orders-btn" to="/orders/user">
              View All Orders
            </Link>

            <Link className="continue-shopping-btn" to="/products">
              Continue Shopping
            </Link>
          </div>

          {/* What's Next */}
          <div className="whats-next-section">
            <h3>What happens next?</h3>
            <ul className="next-steps-list">
              <li>✓ You'll receive an order confirmation email shortly</li>
              <li>✓ Your order is being processed</li>
              <li>✓ You'll be notified when your order ships</li>
              <li>✓ Track your order status in "My Orders"</li>
            </ul>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default OrderSuccess;