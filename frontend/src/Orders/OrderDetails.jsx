import React, { useEffect } from 'react';
import '../OrderStyles/OrderDetails.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { getOrderDetails, removeErrors } from '../features/cart/orderSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function OrderDetails() {
  // ✅ Route param matches: /order/:id
  const { id } = useParams();
  const dispatch = useDispatch();

  // ✅ Defensive default to avoid destructuring undefined
  const { order = {}, loading, error } = useSelector((state) => state.order);

  // ✅ Fetch order details once ID is available
  useEffect(() => {
    if (id) {
      dispatch(getOrderDetails(id));
    }
  }, [dispatch, id]);

  // ✅ Handle API errors cleanly
  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center', autoClose: 2000 });
      dispatch(removeErrors());
    }
  }, [error, dispatch]);

  // ✅ Safe destructuring from order object
  const {
    shippingInfo = {},
    orderItems = [],
    paymentInfo = {}, // payment data lives here (NOT at root)
    orderStatus,
    totalPrice,
    taxPrice,
    shippingPrice,
    itemPrice,
  } = order;

  // ✅ Loading & safety guard
  if (loading) return <Loader />;
  if (!order?._id) return null;

  /**
   * =====================================================
   * PAYMENT LOGIC (FIXED)
   * =====================================================
   * Your MongoDB schema:
   * paymentInfo.status === "success"
   * paymentInfo.paidAt exists
   *
   * ❌ order.isPaid DOES NOT EXIST
   * ❌ order.paidAt DOES NOT EXIST
   */

  // ✅ Correct payment state check
  const isPaid = paymentInfo?.status === 'success';

  // ✅ User-facing payment status
  const paymentStatus = isPaid ? 'Paid' : 'Not Paid';

  // ✅ Paid timestamp (nested correctly)
  const paidAt = paymentInfo?.paidAt;

  /**
   * =====================================================
   * ORDER STATUS
   * =====================================================
   * Do NOT override orderStatus based on payment.
   * Backend already controls order lifecycle.
   */
  const finalOrderStatus = orderStatus;

  // ✅ Status badge classes
  const orderStatusClass =
    finalOrderStatus === 'Delivered'
      ? 'status-tag delivered'
      : `status-tag ${finalOrderStatus?.toLowerCase()}`;

  const paymentStatusClass = `pay-tag ${
    isPaid ? 'paid' : 'not-paid'
  }`;

  return (
    <>
      <PageTitle title={`Order ${id}`} />
      <Navbar />

      <div className="order-box">
        {/* ===================== ORDER ITEMS ===================== */}
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
                  <td className="table-cell">{item.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ===================== SHIPPING INFO ===================== */}
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

        {/* ===================== ORDER SUMMARY ===================== */}
        <div className="table-block">
          <h2 className="table-title">Order Summary</h2>
          <table className="table-main">
            <tbody>
              <tr className="table-row">
                <th className="table-cell">Order Status</th>
                <td className="table-cell">
                  <span className={orderStatusClass}>
                    {finalOrderStatus}
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

              {/* ✅ Correct Paid At rendering */}
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
                <td className="table-cell">{itemPrice}</td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Tax</th>
                <td className="table-cell">{taxPrice}</td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Shipping</th>
                <td className="table-cell">{shippingPrice}</td>
              </tr>

              <tr className="table-row">
                <th className="table-cell">Total</th>
                <td className="table-cell">{totalPrice}</td>
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
