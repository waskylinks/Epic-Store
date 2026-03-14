import React, { useEffect } from "react";
import '../OrderStyles/OrderDetails.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  getOrderDetails,
  removeErrors,
  downloadInvoice,
} from '../features/cart/orderSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import {
  FiDollarSign,
  FiRotateCcw,
  FiDownload,
  FiChevronLeft,
  FiTag,
} from 'react-icons/fi';

function OrderDetails() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const dispatch  = useDispatch();

  const { order = {}, loading, error, actionLoading } = useSelector((state) => state.order);

  useEffect(() => {
    if (id) dispatch(getOrderDetails(id));
  }, [dispatch, id]);

  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 2000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  if (loading) return (
    <>
      <Navbar />
      <Loader type="snake" size="md" />
      <Footer />
    </>
  );

  if (!order?._id) return null;

  const {
    shippingInfo  = {},
    orderItems    = [],
    paymentInfo   = {},
    orderStatus,
    totalPrice,
    taxPrice,
    shippingPrice,
    itemPrice,
    // FIX: read discount data saved by verifyPaymentController.
    // Shape: { codes: [{ code, amount, type, originalItemPrice }], totalDiscount }
    discounts,
  } = order;

  // FIX: resolve the first applied discount code (current schema supports one
  // active code per order; extend to .map() if multiple become supported).
  const appliedDiscount     = discounts?.codes?.[0] ?? null;
  const hasDiscount         = appliedDiscount && appliedDiscount.amount > 0;

  // FIX: when a discount was applied, itemPrice stored on the order is already
  // the discounted figure. Show the original gross subtotal so the line items
  // add up visually, then deduct the discount to reach itemPrice.
  const displaySubtotal     = hasDiscount && appliedDiscount.originalItemPrice != null
    ? appliedDiscount.originalItemPrice
    : itemPrice;

  const isPaid              = paymentInfo?.status === 'success';
  const paymentStatus       = isPaid ? 'Paid' : 'Not Paid';
  const paidAt              = paymentInfo?.paidAt;

  const orderStatusClass    =
    orderStatus === 'Delivered'
      ? 'od-status-tag od-delivered'
      : `od-status-tag od-${orderStatus?.toLowerCase()}`;

  const paymentStatusClass  = `od-pay-tag ${isPaid ? 'od-paid' : 'od-not-paid'}`;

  const handleDownloadInvoice = async () => {
    try {
      await dispatch(downloadInvoice(id)).unwrap();
      toast.success('Invoice downloaded successfully', { position: 'top-center', autoClose: 2000 });
    } catch (err) {
      const errorMessage = err || 'Failed to download invoice';
      if (errorMessage.toLowerCase?.().includes('paid orders')) {
        toast.info('Invoice can only be generated for paid orders', { position: 'top-center', autoClose: 3000 });
      } else {
        toast.error(errorMessage, { position: 'top-center', autoClose: 3000 });
      }
    }
  };

  return (
    <>
      <PageTitle title={`Order ${id}`} />
      <Navbar />

      <div className="od-order-box">
        <button onClick={() => navigate('/orders/user')} className="od-back-btn">
          <FiChevronLeft /> Back to Orders
        </button>

        {/* ── Order Items ────────────────────────────────────────── */}
        <div className="od-table-block">
          <h2 className="od-table-title">Order Items</h2>
          <div className="od-table-wrapper">
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
                    <td className="od-table-cell" data-label="Image">
                      <img src={item.image} alt={item.name} className="od-item-img" />
                    </td>
                    <td className="od-table-cell" data-label="Product">{item.name}</td>
                    <td className="od-table-cell" data-label="Quantity">{item.quantity}</td>
                    <td className="od-table-cell" data-label="Price">${item.price?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Shipping Information ───────────────────────────────── */}
        <div className="od-table-block">
          <h2 className="od-table-title">Shipping Information</h2>
          <div className="od-info-grid">
            <div className="od-info-item">
              <span className="od-info-label">Address</span>
              <span className="od-info-value">
                {shippingInfo.address}, {shippingInfo.city}, {shippingInfo.state}, {shippingInfo.country}, {shippingInfo.pinCode}
              </span>
            </div>
            <div className="od-info-item">
              <span className="od-info-label">Phone</span>
              <span className="od-info-value">{shippingInfo.phoneNo}</span>
            </div>
          </div>
        </div>

        {/* ── Order Summary ──────────────────────────────────────── */}
        <div className="od-table-block">
          <h2 className="od-table-title">Order Summary</h2>
          <div className="od-summary-grid">

            <div className="od-summary-item">
              <span className="od-summary-label">Order Status</span>
              <span className={orderStatusClass}>{orderStatus}</span>
            </div>

            <div className="od-summary-item">
              <span className="od-summary-label">Payment Status</span>
              <span className={paymentStatusClass}>{paymentStatus}</span>
            </div>

            {paidAt && (
              <div className="od-summary-item">
                <span className="od-summary-label">Paid At</span>
                <span className="od-summary-value">{new Date(paidAt).toLocaleString()}</span>
              </div>
            )}

            <div className="od-summary-divider" />

            {/*
              FIX: show original (pre-discount) subtotal so the numbers
              visibly add up. Previously itemPrice was the already-discounted
              figure and there was no discount row — the total didn't match
              subtotal + tax + shipping, which looks like a billing error.
            */}
            <div className="od-summary-item">
              <span className="od-summary-label">Item Price</span>
              <span className="od-summary-value">${displaySubtotal?.toLocaleString()}</span>
            </div>

            {/*
              FIX: discount row — only rendered when a discount was applied.
              Reads order.discounts.codes[0] written by verifyPaymentController.
              Supports the code label when available (e.g. "SUMMER20").
            */}
            {hasDiscount && (
              <div className="od-summary-item od-summary-item--discount">
                <span className="od-summary-label od-summary-label--discount">
                  <FiTag className="od-discount-tag-icon" />
                  {appliedDiscount.code
                    ? `Discount (${appliedDiscount.code})`
                    : 'Discount'}
                </span>
                <span className="od-summary-value od-summary-value--discount">
                  −${appliedDiscount.amount?.toLocaleString()}
                </span>
              </div>
            )}

            <div className="od-summary-item">
              <span className="od-summary-label">Tax</span>
              <span className="od-summary-value">${taxPrice?.toLocaleString()}</span>
            </div>

            <div className="od-summary-item">
              <span className="od-summary-label">Shipping</span>
              <span className="od-summary-value">${shippingPrice?.toLocaleString()}</span>
            </div>

            <div className="od-summary-item od-summary-total">
              <span className="od-summary-label">Total</span>
              <span className="od-summary-value">${totalPrice?.toLocaleString()}</span>
            </div>

          </div>
        </div>

        {/* ── Action Buttons ─────────────────────────────────────── */}
        <div className="od-details-action-buttons">
          <button
            onClick={() => navigate(`/order/${id}/refund`)}
            className="od-details-btn od-details-btn-refund"
          >
            <FiDollarSign />
            Request Refund
          </button>

          <button
            onClick={() => navigate(`/order/${id}/return`)}
            className="od-details-btn od-details-btn-return"
          >
            <FiRotateCcw />
            Request Return
          </button>

          <button
            onClick={handleDownloadInvoice}
            className="od-details-btn od-details-btn-invoice"
            disabled={actionLoading}
          >
            {actionLoading ? (
              <><FiDownload className="od-btn-spinner" /> Downloading...</>
            ) : (
              <><FiDownload /> Download Invoice</>
            )}
          </button>
        </div>

      </div>

      <Footer />
    </>
  );
}

export default OrderDetails;