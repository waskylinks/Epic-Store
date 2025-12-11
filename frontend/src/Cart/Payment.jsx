import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import "../CartStyles/Payment.css";

import Navbar from "../components/Navbar";
import PageTitle from "../components/PageTitle";
import Footer from "../components/footer";
import CheckoutPath from "./CheckoutPath";

import { toast } from "react-toastify";
import { verifyPayment } from "../features/cart/paymentSlice";


function Payment() {
    const orderItem = JSON.parse(sessionStorage.getItem("orderItem"));
    const { shippingInfo, cartItems } = useSelector((state) => state.cart);
    const { user } = useSelector((state) => state.user);
    const { loading, error, message } = useSelector((state) => state.payment);

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [localError, setLocalError] = useState("");

    // Load Paystack Script
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://js.paystack.co/v1/inline.js";
        script.async = true;

        script.onload = () => console.log("Paystack loaded");
        script.onerror = () => setLocalError("Failed to load Paystack");

        document.body.appendChild(script);
    }, []);

    // Handle toast on redux error or success
    useEffect(() => {
        if (error) {
            toast.error(error, { position: "top-center" });
        }
        if (message) {
            toast.success(message, { position: "top-center" });
        }
    }, [error, message]);

    const handlePayment = () => {
        setLocalError("");

        if (!window.PaystackPop) {
            setLocalError("Paystack script not loaded");
            toast.error("Payment gateway unavailable");
            return;
        }

        const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
        if (!key) {
            toast.error("Paystack key missing");
            return;
        }

        if (!user?.email) {
            toast.error("User email not found");
            return;
        }

        try {
            const handler = window.PaystackPop.setup({
                key,
                email: user.email,
                amount: Number(orderItem.total) * 100,
                currency: "NGN",

                callback: (response) => {
                    dispatch(
                        verifyPayment({
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
                        .then(() => {
                            navigate("/order/success");
                        })
                        .catch(() => {
                            toast.error("Payment verification failed");
                        });
                },

                onClose: () => {
                    toast.error("Payment cancelled");
                }
            });

            handler.openIframe();
        } catch{
            toast.error("Payment setup failed");
        }
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
                    disabled={loading}
                >
                    {loading ? "Verifying..." : `Pay (${orderItem.total})/-`}
                </button>
            </div>

            <Footer />
        </>
    );
}

export default Payment;
