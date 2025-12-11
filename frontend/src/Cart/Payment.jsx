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

        script.onload = () => console.log("Paystack script loaded");
        script.onerror = () => setError("Failed to load Paystack payment gateway.");

        document.body.appendChild(script);
    }, []);

    const handlePayment = () => {
        setLoading(true);
        setError('');

        if (!window.PaystackPop) {
            setError('Paystack script not loaded');
            setLoading(false);
            return;
        }

        const paystackKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
        if (!paystackKey) {
            setError('Paystack public key not found.');
            setLoading(false);
            return;
        }

        if (!user?.email) {
            setError('User email not found.');
            setLoading(false);
            return;
        }

        if (!orderItem?.total) {
            setError('Invalid order total.');
            setLoading(false);
            return;
        }

        try {
            const handler = window.PaystackPop.setup({
                key: paystackKey,
                email: user.email,
                amount: Number(orderItem.total) * 100, // kobo
                currency: 'NGN',
                channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer', 'zap'],

                callback: function(response) {
                    console.log('Payment reference:', response.reference);

                    (async () => {
                        try {
                            // Map phoneNumber to phoneNo to match backend schema
                            const payload = {
                                reference: response.reference,
                                shippingInfo: {
                                    ...shippingInfo,
                                },
                                orderItems: cartItems,
                                itemPrice: orderItem.subtotal,
                                taxPrice: orderItem.tax,
                                shippingPrice: orderItem.shipping,
                                totalPrice: orderItem.total,
                                amountPaid: orderItem.total
                            };

                            console.log('Sending payload to backend:', payload);

                            const res = await axios.post(
                                '/api/v1/paystack/verify',
                                payload,
                                {
                                    headers: {
                                        Authorization: `Bearer ${localStorage.getItem('token')}`
                                    }
                                }
                            );

                            console.log('Backend response:', res.data);

                            if (res.data.success) {
                                setLoading(false);
                                navigate('/order/success');
                            } else {
                                setError('Payment verification failed. Order not saved.');
                                setLoading(false);
                            }
                        } catch (err) {
                            console.error('Error sending payment to backend:', err);
                            setError('Error sending payment to backend.');
                            setLoading(false);
                        }
                    })();
                },

                onClose: function() {
                    console.log('Payment cancelled by user');
                    setError('Payment cancelled.');
                    setLoading(false);
                }
            });

            handler.openIframe();
        } catch (err) {
            console.error('Payment setup error:', err);
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
