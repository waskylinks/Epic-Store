import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import "../CartStyles/Payment.css";

import Navbar from "../components/Navbar";
import PageTitle from "../components/PageTitle";
import Footer from "../components/footer";
import CheckoutPath from "./CheckoutPath";

import { toast } from "react-toastify";
import { verifyPayment, removePaymentError, removePaymentMessage } from "../features/cart/paymentSlice";

function Payment() {
    const orderItem = JSON.parse(sessionStorage.getItem("orderItem"));
    const { shippingInfo, cartItems } = useSelector((state) => state.cart);
    const { user } = useSelector((state) => state.user);
    const { loading, error, message } = useSelector((state) => state.payment);

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [localError, setLocalError] = useState("");

    // Load Paystack script dynamically
    useEffect(() => {
        if (!window.PaystackPop) {
            const script = document.createElement("script");
            script.src = "https://js.paystack.co/v1/inline.js";
            script.async = true;
            script.onload = () => console.log("Paystack loaded");
            script.onerror = () => setLocalError("Failed to load Paystack");
            document.body.appendChild(script);
        }
    }, []);

    // Toast notifications
    useEffect(() => {
        if (error) {
            toast.error(error, { position: "top-center" });
            dispatch(removePaymentError());
        }
        if (message) {
            toast.success(message, { position: "top-center" });
            dispatch(removePaymentMessage());
        }
    }, [error, message, dispatch]);

    const handlePayment = () => {
        if (!orderItem) return toast.error("No order found");
        if (!window.PaystackPop) return toast.error("Paystack script not loaded");

        const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
        if (!key) return toast.error("Paystack key missing");

        const handler = window.PaystackPop.setup({
            key,
            email: user.email,
            amount: Number(orderItem.total) * 100, // in kobo
            currency: "NGN",
            callback: (response) => {
                dispatch(
                    verifyPayment({
                        gateway: "paystack",
                        reference: response.reference,
                        shippingInfo,
                        orderItems: cartItems,
                        itemPrice: orderItem.subtotal,
                        taxPrice: orderItem.tax,
                        shippingPrice: orderItem.shipping,
                        totalPrice: orderItem.total,
                        amountPaid: orderItem.total
                    })
                )
                    .unwrap()
                    .then(() => navigate(`/order/success?reference=${response.reference}`))
                    .catch(() => toast.error("Payment verification failed"));
            },
            onClose: () => toast.info("Payment cancelled")
        });

        handler.openIframe();
    };

    return (
        <>
            <PageTitle title="Payment" />
            <Navbar />
            <CheckoutPath activePath={2} />

            <div className="payment-container">
                {localError && <p className="payment-error">{localError}</p>}

                <button
                    className="payment-btn"
                    onClick={handlePayment}
                    disabled={loading || !orderItem}
                >
                    {loading ? "Verifying..." : `Pay (₦${orderItem?.total.toFixed(2)})`}
                </button>
            </div>

            <Footer />
        </>
    );
}

export default Payment;
