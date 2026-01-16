import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import "../CartStyles/Payment.css";

import Navbar from "../components/Navbar";
import PageTitle from "../components/PageTitle";
import Footer from "../components/footer";
import CheckoutPath from "./CheckoutPath";

import { toast } from "react-toastify";
import { 
  initializePayment,
  verifyPayment, 
  removePaymentError, 
  removePaymentMessage,
  clearPaymentData 
} from "../features/cart/paymentSlice";
import { clearCart } from "../features/cart/cartSlice";

function Payment() {
    const orderItem = JSON.parse(sessionStorage.getItem("orderItem"));
    const { shippingInfo, cartItems } = useSelector((state) => state.cart);
    const { user } = useSelector((state) => state.user);
    const { loading, initLoading, error, message, paymentData } = useSelector((state) => state.payment);

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [localError, setLocalError] = useState("");
    const [selectedGateway, setSelectedGateway] = useState("paystack");
    const [selectedCurrency, setSelectedCurrency] = useState("NGN");

    // Load Paystack script
    useEffect(() => {
        if (selectedGateway === "paystack" && !window.PaystackPop) {
            const script = document.createElement("script");
            script.src = "https://js.paystack.co/v1/inline.js";
            script.async = true;
            script.onload = () => console.log("Paystack loaded");
            script.onerror = () => setLocalError("Failed to load Paystack");
            document.body.appendChild(script);
        }
    }, [selectedGateway]);

    // Handle errors and messages
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

    // Auto-open payment popup when paymentData is available (Paystack)
    useEffect(() => {
        if (paymentData && selectedGateway === "paystack" && paymentData.authorization_url) {
            openPaystackPopup();
        } else if (paymentData && selectedGateway === "flutterwave" && paymentData.payment_link) {
            // Redirect to Flutterwave payment page
            window.location.href = paymentData.payment_link;
        } else if (paymentData && selectedGateway === "stripe" && paymentData.client_secret) {
            // Handle Stripe payment (would need Stripe Elements setup)
            console.log("Stripe payment initialized:", paymentData);
            // TODO: Implement Stripe Elements integration
        }
    }, [paymentData, selectedGateway]);

    const handleInitializePayment = () => {
        if (!orderItem) return toast.error("No order found");
        if (cartItems.length === 0) return toast.error("Cart is empty");

        // Transform cart items to only send product ID and quantity
        const cartPayload = cartItems.map(item => ({
            product: item.product,
            quantity: item.quantity
        }));

        // Initialize payment with backend
        dispatch(
            initializePayment({
                gateway: selectedGateway,
                currency: selectedCurrency,
                shippingInfo,
                cartItems: cartPayload
            })
        )
        .unwrap()
        .catch((err) => {
            toast.error(err.message || "Failed to initialize payment");
        });
    };

    const openPaystackPopup = () => {
        if (!window.PaystackPop) {
            toast.error("Paystack script not loaded");
            return;
        }

        const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
        if (!key) {
            toast.error("Paystack key missing");
            return;
        }

        const handler = window.PaystackPop.setup({
            key,
            email: user.email,
            amount: paymentData.amount * 100, // Convert to kobo
            currency: paymentData.currency,
            ref: paymentData.reference,
            callback: (response) => {
                // Verify payment with backend
                dispatch(
                    verifyPayment({
                        gateway: selectedGateway,
                        reference: response.reference
                    })
                )
                .unwrap()
                .then(() => {
                    // Clear cart after successful payment verification
                    dispatch(clearCart());
                    dispatch(clearPaymentData());
                    sessionStorage.removeItem("orderItem");

                    // Navigate to success page
                    navigate(`/order/success?reference=${response.reference}`);
                })
                .catch(() => toast.error("Payment verification failed"));
            },
            onClose: () => {
                toast.info("Payment cancelled");
                dispatch(clearPaymentData());
            }
        });

        handler.openIframe();
    };

    const formatCurrency = (amount, currency = "NGN") => {
        const localeMap = {
            NGN: "en-NG",
            USD: "en-US",
            GBP: "en-GB",
            EUR: "en-DE"
        };

        return new Intl.NumberFormat(localeMap[currency] || "en-US", {
            style: "currency",
            currency: currency,
            minimumFractionDigits: 2
        }).format(amount);
    };

    // Gateway selection UI
    const gateways = [
        { value: "paystack", label: "Paystack", currencies: ["NGN", "GHS", "ZAR", "USD"] },
        { value: "flutterwave", label: "Flutterwave", currencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES"] },
        { value: "stripe", label: "Stripe", currencies: ["USD", "EUR", "GBP"] }
    ];

    const selectedGatewayConfig = gateways.find(g => g.value === selectedGateway);

    return (
        <>
            <PageTitle title="Payment" />
            <Navbar />
            <CheckoutPath activePath={2} />

            <div className="payment-container">
                {localError && <p className="payment-error">{localError}</p>}

                <div className="payment-options">
                    <h2>Select Payment Gateway</h2>
                    <div className="gateway-selection">
                        {gateways.map((gateway) => (
                            <label key={gateway.value} className="gateway-option">
                                <input
                                    type="radio"
                                    name="gateway"
                                    value={gateway.value}
                                    checked={selectedGateway === gateway.value}
                                    onChange={(e) => {
                                        setSelectedGateway(e.target.value);
                                        // Reset currency to first available for new gateway
                                        setSelectedCurrency(gateway.currencies[0]);
                                    }}
                                />
                                <span>{gateway.label}</span>
                            </label>
                        ))}
                    </div>

                    <h3>Select Currency</h3>
                    <div className="currency-selection">
                        {selectedGatewayConfig?.currencies.map((currency) => (
                            <label key={currency} className="currency-option">
                                <input
                                    type="radio"
                                    name="currency"
                                    value={currency}
                                    checked={selectedCurrency === currency}
                                    onChange={(e) => setSelectedCurrency(e.target.value)}
                                />
                                <span>{currency}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="payment-summary">
                    <h3>Order Summary</h3>
                    <p>Subtotal: {formatCurrency(orderItem?.subtotal, selectedCurrency)}</p>
                    <p>Tax: {formatCurrency(orderItem?.tax, selectedCurrency)}</p>
                    <p>Shipping: {formatCurrency(orderItem?.shipping, selectedCurrency)}</p>
                    <h4>Total: {formatCurrency(orderItem?.total, selectedCurrency)}</h4>
                </div>

                <button
                    className="payment-btn"
                    onClick={handleInitializePayment}
                    disabled={loading || initLoading || !orderItem}
                >
                    {initLoading ? "Initializing..." : loading ? "Verifying..." : `Pay ${formatCurrency(orderItem?.total, selectedCurrency)}`}
                </button>
            </div>

            <Footer />
        </>
    );
}

export default Payment;