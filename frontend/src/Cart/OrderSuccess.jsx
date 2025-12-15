import React from "react";
import { Link, useSearchParams } from "react-router-dom";

import PageTitle from "../components/PageTitle";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import "../CartStyles/PaymentSuccess.css";

function OrderSuccess() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference");

  return (
    <>
      <PageTitle title="Order Status" />
      <Navbar />

      <div className="payment-success-container">
        <div className="success-content">
          <div className="success-icon">
            <div className="checkmark" />
          </div>

          <h1>Order Confirmed</h1>

          <p>
            Your payment was successful. Reference ID: <strong>{reference}</strong>
          </p>

          <Link className="explore-btn" to="/orders/user">
            View Orders
          </Link>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default OrderSuccess;
