// Frontend/src/pages/RefundRequest.jsx

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import { getOrderDetails } from '../features/cart/orderSlice';
import { requestRefund, clearRefundState } from '../features/refunds/refundSlice';
import '../OrderStyles/RefundRequest.css';

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

function RefundRequest() {
  const { id: orderId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { order, loading: orderLoading } = useSelector((state) => state.order);
  const { loading: refundLoading, success, error, message } = useSelector((state) => state.refund);

  const [formData, setFormData] = useState({
    reason: '',
    description: '',
    refundType: 'full',
    requestedAmount: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Fetch order details
  useEffect(() => {
    if (orderId) {
      dispatch(getOrderDetails(orderId));
    }
  }, [dispatch, orderId]);

  // Handle success/error
  useEffect(() => {
    if (success) {
      toast.success(message || 'Refund request submitted successfully!', {
        position: 'top-center',
        autoClose: 3000
      });
      dispatch(clearRefundState());
      setTimeout(() => navigate(`/order/${orderId}`), 2000);
    }

    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 3000 });
      dispatch(clearRefundState());
    }
  }, [success, error, message, dispatch, navigate, orderId]);

  // Check if order is refundable
  const isRefundable = () => {
    if (!order) return false;
    
    const isPaid = order.paymentInfo?.status === 'success';
    const hasRefund = order.refundInfo?.status && order.refundInfo.status !== 'none';
    const refundableStatuses = ['Delivered', 'Shipped', 'Cancelled'];
    
    return isPaid && !hasRefund && refundableStatuses.includes(order.orderStatus);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error for this field
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
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
        errors.requestedAmount = `Amount cannot exceed ${order.totalPrice}`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form', { position: 'top-center' });
      return;
    }

    const refundData = {
      reason: formData.reason,
      description: formData.description,
      refundType: formData.refundType,
      ...(formData.refundType === 'partial' && {
        requestedAmount: parseFloat(formData.requestedAmount)
      })
    };

    dispatch(requestRefund({ orderId, refundData }));
  };

  if (orderLoading) return <Loader />;

  if (!order?._id) {
    return (
      <>
        <PageTitle title="Order Not Found" />
        <Navbar />
        <div className="refund-error">
          <h2>Order not found</h2>
          <button onClick={() => navigate('/orders/user')} className="btn-back">
            Back to My Orders
          </button>
        </div>
        <Footer />
      </>
    );
  }

  if (!isRefundable()) {
    return (
      <>
        <PageTitle title="Refund Not Available" />
        <Navbar />
        <div className="refund-error">
          <h2>This order is not eligible for refund</h2>
          <p>Reason: {
            order.refundInfo?.status && order.refundInfo.status !== 'none'
              ? 'Refund already requested'
              : order.paymentInfo?.status !== 'success'
              ? 'Order not paid'
              : 'Order status does not allow refunds'
          }</p>
          <button onClick={() => navigate(`/order/${orderId}`)} className="btn-back">
            Back to Order Details
          </button>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title={`Request Refund - Order ${orderId}`} />
      <Navbar />

      <div className="refund-container">
        <div className="refund-card">
          <h1 className="refund-title">Request Refund</h1>
          <p className="refund-subtitle">Order ID: {orderId}</p>

          {/* Order Summary */}
          <div className="order-summary">
            <div className="summary-item">
              <span>Total Amount:</span>
              <strong>₦{order.totalPrice?.toLocaleString()}</strong>
            </div>
            <div className="summary-item">
              <span>Order Status:</span>
              <strong>{order.orderStatus}</strong>
            </div>
            <div className="summary-item">
              <span>Payment Status:</span>
              <strong className={order.paymentInfo?.status === 'success' ? 'text-success' : 'text-danger'}>
                {order.paymentInfo?.status === 'success' ? 'Paid' : 'Not Paid'}
              </strong>
            </div>
          </div>

          {/* Refund Form */}
          <form onSubmit={handleSubmit} className="refund-form">
            {/* Refund Type */}
            <div className="form-group">
              <label className="form-label">Refund Type</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="refundType"
                    value="full"
                    checked={formData.refundType === 'full'}
                    onChange={handleChange}
                  />
                  <span>Full Refund (₦{order.totalPrice?.toLocaleString()})</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="refundType"
                    value="partial"
                    checked={formData.refundType === 'partial'}
                    onChange={handleChange}
                  />
                  <span>Partial Refund</span>
                </label>
              </div>
            </div>

            {/* Partial Amount */}
            {formData.refundType === 'partial' && (
              <div className="form-group">
                <label htmlFor="requestedAmount" className="form-label">
                  Refund Amount (₦)
                </label>
                <input
                  type="number"
                  id="requestedAmount"
                  name="requestedAmount"
                  className={`form-input ${formErrors.requestedAmount ? 'input-error' : ''}`}
                  value={formData.requestedAmount}
                  onChange={handleChange}
                  placeholder="Enter amount"
                  step="0.01"
                  min="0"
                  max={order.totalPrice}
                />
                {formErrors.requestedAmount && (
                  <span className="error-text">{formErrors.requestedAmount}</span>
                )}
              </div>
            )}

            {/* Refund Reason */}
            <div className="form-group">
              <label htmlFor="reason" className="form-label">
                Reason for Refund *
              </label>
              <select
                id="reason"
                name="reason"
                className={`form-select ${formErrors.reason ? 'input-error' : ''}`}
                value={formData.reason}
                onChange={handleChange}
              >
                <option value="">Select a reason</option>
                {REFUND_REASONS.map(reason => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
              {formErrors.reason && (
                <span className="error-text">{formErrors.reason}</span>
              )}
            </div>

            {/* Description */}
            <div className="form-group">
              <label htmlFor="description" className="form-label">
                Detailed Description *
              </label>
              <textarea
                id="description"
                name="description"
                className={`form-textarea ${formErrors.description ? 'input-error' : ''}`}
                value={formData.description}
                onChange={handleChange}
                placeholder="Please provide details about why you're requesting a refund (minimum 10 characters)"
                rows="5"
              />
              <span className="char-count">{formData.description.length} / 500</span>
              {formErrors.description && (
                <span className="error-text">{formErrors.description}</span>
              )}
            </div>

            {/* Submit Buttons */}
            <div className="form-actions">
              <button
                type="button"
                onClick={() => navigate(`/order/${orderId}`)}
                className="btn-cancel"
                disabled={refundLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-submit"
                disabled={refundLoading}
              >
                {refundLoading ? 'Submitting...' : 'Submit Refund Request'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default RefundRequest;