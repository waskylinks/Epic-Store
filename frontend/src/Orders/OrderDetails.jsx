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
  const { refundStatus } = useSelector((state) => state.refund);

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

  // Refund eligibility check
  const hasRefund = refundStatus && refundStatus.status !== 'none';
  const refundableStatuses = ['Delivered', 'Shipped', 'Cancelled'];
  const isRefundable = isPaid && 
    !hasRefund && 
    refundableStatuses.includes(orderStatus) &&
    order.isRefundable !== false;

  // Status badge classes
  const orderStatusClass =
    orderStatus === 'Delivered'
      ? 'status-tag delivered'
      : `status-tag ${orderStatus?.toLowerCase()}`;

  const paymentStatusClass = `pay-tag ${isPaid ? 'paid' : 'not-paid'}`;

  return (
    <>
      <PageTitle title={`Order ${id}`} />
      <Navbar />

      <div className="order-box">
        {/* Refund Status Alert */}
        {hasRefund && (
          <div className="refund-alert">
            <div className="refund-alert-header">
              <h3>Refund Status</h3>
              <RefundStatusBadge status={refundStatus.status} />
            </div>
            <div className="refund-alert-body">
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

        {/* Refund Action Button */}
        {isRefundable && (
          <div className="refund-action">
            <button
              onClick={() => navigate(`/orders/${id}/refund/request`)}
              className="btn-refund"
            >
              Request Refund
            </button>
            <p className="refund-notice">
              You have {order.daysUntilRefundDeadline || 30} days remaining to request a refund
            </p>
          </div>
        )}

        {/* ORDER ITEMS */}
        <div className="table-block">
          <h2 className="table-title">Order Items</h2>
          <table className="table-main">
            <thead>
              <tr>
                <th className="head-cell">Image</th>
                <th className="head-cell">Product Name</th>
                <th className="head-cell">Quantity</th>
                <th className="head-cell">Price</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.map((item) => (
                <tr key={item._id} className="table-row">
                  <td className="table-cell">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="item-img"
                    />
                  </td>
                  <td className="table-cell">{item.name}</td>
                  <td className="table-cell">{item.quantity}</td>
                  <td className="table-cell">₦{item.price?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* SHIPPING INFO */}
        <div className="table-block">
          <h2 className="table-title">Shipping Info</h2>
          <table className="table-main">
            <tbody>
              <tr className="table-row">
                <th className="table-cell">Address</th>
                <td className="table-cell">
                  {shippingInfo.address}, {shippingInfo.city},{' '}
                  {shippingInfo.state}, {shippingInfo.country},{' '}
                  {shippingInfo.pinCode}
                </td>
              </tr>
              <tr className="table-row">
                <th className="table-cell">Phone</th>
                <td className="table-cell">{shippingInfo.phoneNo}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ORDER SUMMARY */}
        <div className="table-block">
          <h2 className="table-title">Order Summary</h2>
          <table className="table-main">
            <tbody>
              <tr className="table-row">
                <th className="table-cell">Order Status</th>
                <td className="table-cell">
                  <span className={orderStatusClass}>
                    {orderStatus}
                  </span>
                </td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Payment Status</th>
                <td className="table-cell">
                  <span className={paymentStatusClass}>
                    {paymentStatus}
                  </span>
                </td>
              </tr>

              {paidAt && (
                <tr className="table-row">
                  <th className="table-cell">Paid At</th>
                  <td className="table-cell">
                    {new Date(paidAt).toLocaleString()}
                  </td>
                </tr>
              )}

              <tr className="table-row">
                <th className="table-cell">Item Price</th>
                <td className="table-cell">₦{itemPrice?.toLocaleString()}</td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Tax</th>
                <td className="table-cell">₦{taxPrice?.toLocaleString()}</td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Shipping</th>
                <td className="table-cell">₦{shippingPrice?.toLocaleString()}</td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Total</th>
                <td className="table-cell">₦{totalPrice?.toLocaleString()}</td>
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