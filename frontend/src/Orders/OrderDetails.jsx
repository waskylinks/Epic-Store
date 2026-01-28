import React, { useEffect } from 'react';
import '../OrderStyles/OrderDetails.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { getOrderDetails, removeErrors } from '../features/cart/orderSlice';
import { getRefundStatus } from '../features/refunds/refundSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import RefundStatusBadge from '../components/RefundStatusBadge';

function OrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { order = {}, loading, error } = useSelector((state) => state.order);
  const { refundStatus, statusLoading } = useSelector((state) => state.refund);

  // Fetch order details and refund status
  useEffect(() => {
    if (id) {
      dispatch(getOrderDetails(id));
      dispatch(getRefundStatus(id));
    }
  }, [dispatch, id]);

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

  // ✅ FIX: Robust refund eligibility check
  // Check if there's an active refund (not 'none' status)
  const hasActiveRefund = refundStatus?.hasRefund === true || 
                          (refundStatus?.status && refundStatus.status !== 'none');

  // Order must be paid, delivered/shipped/cancelled, and no active refund
  const refundableStatuses = ['Delivered', 'Shipped', 'Cancelled'];
  const isRefundable = isPaid && 
    !hasActiveRefund && 
    refundableStatuses.includes(orderStatus);

  // Status badge classes
  const orderStatusClass =
    orderStatus === 'Delivered'
      ? 'od-status-tag od-delivered'
      : `od-status-tag od-${orderStatus?.toLowerCase()}`;

  const paymentStatusClass = `od-pay-tag ${isPaid ? 'od-paid' : 'od-not-paid'}`;

  return (
    <>
      <PageTitle title={`Order ${id}`} />
      <Navbar />

      <div className="od-order-box">
        {/* ✅ FIX: Only show refund alert if there's an ACTIVE refund */}
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

        {/* ✅ FIX: Show refund button only when eligible */}
        {isRefundable && !statusLoading && (
          <div className="od-refund-action">
            <button
              onClick={() => navigate(`/orders/${id}/refund/request`)}
              className="od-btn-refund"
            >
              Request Refund
            </button>
            <p className="od-refund-notice">
              You have {order.daysUntilRefundDeadline || 30} days remaining to request a refund
            </p>
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
      </div>

      <Footer />
    </>
  );
}

export default OrderDetails;
