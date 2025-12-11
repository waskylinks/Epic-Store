import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import '../CartStyles/Payment.css';
import Navbar from '../components/Navbar';
import PageTitle from '../components/PageTitle';
import Footer from '../components/footer';
import CheckoutPath from './CheckoutPath';

function Payment() {
    const orderItem = JSON.parse(sessionStorage.getItem('orderItem'));
    const { shippingInfo, cartItems } = useSelector(state => state.cart);
    const { user } = useSelector(state => state.user);
    const navigate = useNavigate();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Load Paystack script
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://js.paystack.co/v1/inline.js";
        script.async = true;

        script.onload = () => {
            console.log("Paystack script loaded");
        };

        script.onerror = () => {
            console.error("Failed to load Paystack script");
            setError("Failed to load Paystack payment gateway. Check your connection.");
        };

        document.body.appendChild(script);
    }, []);

    const handlePayment = async () => {
        setLoading(true);
        setError('');

        // Ensure Paystack script is loaded
        if (!window.PaystackPop) {
            setError('Paystack script not loaded');
            setLoading(false);
            return;
        }

        // Ensure key and email are defined
        const paystackKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
        if (!paystackKey) {
            setError('Paystack public key not found. Check your .env file.');
            setLoading(false);
            return;
        }

        if (!user?.email) {
            setError('User email not found.');
            setLoading(false);
            return;
        }

        try {
            const handler = window.PaystackPop.setup({
                key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
                email: user.email,
                amount: Number(orderItem.total) * 100,
                currency: 'NGN',

                callback: function(response) {
                    console.log('Payment reference:', response.reference);
                },

                onClose: function() {
                    console.log('Payment closed by user');
                }
        });

        handler.openIframe();

        } catch (err) {
            console.error(err);
            setError('Something went wrong. Please try again.');
            setLoading(false);
        }
    };

    return (
        <>
            <PageTitle title="Payment Processing" />
            <Navbar />
            <CheckoutPath activePath={2} />

            <div className="payment-container">
                {error && <p className="payment-error">{error}</p>}
                <button
                    className="payment-btn"
                    onClick={handlePayment}
                    disabled={loading}
                >
                    {loading ? 'Processing...' : `Pay (${orderItem.total})/-`}
                </button>
            </div>

            <Footer />
        </>
    );
}

export default Payment;
