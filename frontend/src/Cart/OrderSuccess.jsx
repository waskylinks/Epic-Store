import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";

import PageTitle from "../components/PageTitle";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";

import "../CartStyles/PaymentSuccess.css";

import { downloadReceiptPdf } from "../features/cart/orderSlice";

function OrderSuccess() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference");
  const dispatch = useDispatch();

  const handleDownloadReceipt = () => {
    if (!reference) {
      toast.error("Receipt not found for this order", {
        position: "top-center",
      });
      return;
    }

    dispatch(downloadReceiptPdf({ reference }))
      .unwrap()
      .catch((err) => {
        toast.error(
          err || "Receipt not found for this order",
          { position: "top-center" }
        );
      });
  };

  return (
    <>
      <PageTitle title="Order Confirmed" />
      <Navbar />

      <div className="payment-success-container">
        <div className="success-content">
          <h1>Payment Successful!</h1>
          <p>Your order has been placed and confirmed.</p>

          <p>
            Order Reference ID: <strong>{reference}</strong>
          </p>

          <button
            className="download-receipt-btn"
            onClick={handleDownloadReceipt}
          >
            Download Receipt
          </button>

          <Link
            className="explore-btn"
            to="/orders/user"
          >
            View Order Status
          </Link>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default OrderSuccess;
