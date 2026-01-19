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

/* ===============================
   FLUTTERWAVE
================================ */
import { useFlutterwave, closePaymentModal } from "flutterwave-react-v3";

/* ===============================
   STRIPE
================================ */
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

/* ===============================
   STRIPE CHECKOUT FORM
================================ */
function StripeCheckout({ clientSecret, onSuccess, reference }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/order/success?reference=${reference}`
        },
        redirect: "if_required"
      });

      if (error) {
        toast.error(error.message);
        setProcessing(false);
      } else if (paymentIntent && paymentIntent.status === "succeeded") {
        onSuccess();
      }
    } catch (err) {
      console.error("Stripe payment error:", err);
      toast.error("Payment failed");
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stripe-form">
      <PaymentElement />
      <button 
        className="payment-btn stripe-pay-btn" 
        disabled={!stripe || processing}
        type="submit"
      >
        {processing ? "Processing..." : "Pay Now"}
      </button>
    </form>
  );
}

/* ===============================
   MAIN PAYMENT PAGE
================================ */
function Payment() {
  const orderItem = JSON.parse(sessionStorage.getItem("orderItem"));
  const { shippingInfo, cartItems } = useSelector((state) => state.cart);
  const { user } = useSelector((state) => state.user);
  const { loading, initLoading, error, message, paymentData } = useSelector((state) => state.payment);

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [selectedGateway, setSelectedGateway] = useState("paystack");
  const [selectedCurrency, setSelectedCurrency] = useState("NGN");

  /* ===============================
     LOAD PAYSTACK SCRIPT
  ================================ */
  useEffect(() => {
    if (selectedGateway === "paystack" && !window.PaystackPop) {
      const script = document.createElement("script");
      script.src = "https://js.paystack.co/v1/inline.js";
      script.async = true;
      script.onload = () => console.log("Paystack loaded");
      script.onerror = () => toast.error("Failed to load Paystack");
      document.body.appendChild(script);
    }
  }, [selectedGateway]);

  /* ===============================
     TOAST HANDLING
  ================================ */
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

  /* ===============================
     PAYSTACK HANDLER
  ================================ */
  const openPaystackPopup = () => {
    if (!window.PaystackPop) {
      toast.error("Paystack SDK not loaded");
      return;
    }

    const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if (!key) {
      toast.error("Paystack public key missing");
      return;
    }

    const handler = window.PaystackPop.setup({
      key,
      email: user.email,
      amount: paymentData.amount * 100, // Convert to kobo
      currency: paymentData.currency,
      ref: paymentData.reference,
      callback: (response) => {
        dispatch(
          verifyPayment({
            gateway: "paystack",
            reference: response.reference
          })
        )
          .unwrap()
          .then(() => {
            dispatch(clearCart());
            dispatch(clearPaymentData());
            sessionStorage.removeItem("orderItem");
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

  /* ===============================
     FLUTTERWAVE CONFIG & HANDLER
  ================================ */
  const flutterwaveConfig = paymentData && selectedGateway === "flutterwave"
    ? {
        public_key: import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY || "",
        tx_ref: paymentData.reference,
        amount: paymentData.amount,
        currency: paymentData.currency,
        payment_options: "card,banktransfer,ussd,mobilemoney",
        customer: {
          email: user.email,
          name: user.name || "Customer",
          phonenumber: shippingInfo.phoneNo || ""
        },
        customizations: {
          title: "EpicStore Payment",
          description: `Order ${paymentData.reference}`,
          logo: `${window.location.origin}/logo.png`
        },
        callback: (response) => {
          if (response.status === "successful") {
            dispatch(
              verifyPayment({
                gateway: "flutterwave",
                reference: response.transaction_id || response.tx_ref
              })
            )
              .unwrap()
              .then(() => {
                dispatch(clearCart());
                dispatch(clearPaymentData());
                sessionStorage.removeItem("orderItem");
                navigate(`/order/success?reference=${response.transaction_id || response.tx_ref}`);
              })
              .catch(() => toast.error("Payment verification failed"));
          } else {
            toast.error("Payment was not successful");
          }
          closePaymentModal();
        },
        onClose: () => {
          toast.info("Payment cancelled");
          dispatch(clearPaymentData());
        }
      }
    : null;

  const handleFlutterwavePayment = useFlutterwave(flutterwaveConfig || {});

  /* ===============================
     AUTO-OPEN PAYMENT POPUP/MODAL
  ================================ */
  useEffect(() => {
    if (!paymentData) return;

    if (selectedGateway === "paystack" && paymentData.authorization_url) {
      openPaystackPopup();
    } else if (selectedGateway === "flutterwave" && paymentData.payment_link) {
      handleFlutterwavePayment({
        callback: flutterwaveConfig.callback,
        onClose: flutterwaveConfig.onClose
      });
    }
    // Stripe uses Elements component, no auto-open needed
  }, [paymentData, selectedGateway]);

  /* ===============================
     INITIALIZE PAYMENT
  ================================ */
  const handleInitializePayment = () => {
    if (!orderItem) {
      toast.error("No order found");
      return;
    }
    
    if (cartItems.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    const cartPayload = cartItems.map((item) => ({
      product: item.product,
      quantity: item.quantity
    }));

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

  /* ===============================
     STRIPE SUCCESS HANDLER
  ================================ */
  const handleStripeSuccess = () => {
    dispatch(
      verifyPayment({
        gateway: "stripe",
        reference: paymentData.payment_intent_id || paymentData.reference
      })
    )
      .unwrap()
      .then(() => {
        dispatch(clearCart());
        dispatch(clearPaymentData());
        sessionStorage.removeItem("orderItem");
        navigate(`/order/success?reference=${paymentData.reference}`);
      })
      .catch(() => toast.error("Payment verification failed"));
  };

  /* ===============================
     FORMAT CURRENCY
  ================================ */
  const formatCurrency = (amount, currency = "NGN") => {
    const localeMap = {
      NGN: "en-NG",
      USD: "en-US",
      GBP: "en-GB",
      EUR: "en-DE",
      GHS: "en-GH",
      KES: "en-KE"
    };

    return new Intl.NumberFormat(localeMap[currency] || "en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 2
    }).format(amount);
  };

  /* ===============================
     GATEWAY OPTIONS
  ================================ */
  const gateways = [
    { value: "paystack", label: "Paystack", currencies: ["NGN", "GHS", "ZAR", "USD"] },
    { value: "flutterwave", label: "Flutterwave", currencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES"] },
    { value: "stripe", label: "Stripe", currencies: ["USD", "EUR", "GBP"] }
  ];

  const selectedGatewayConfig = gateways.find((g) => g.value === selectedGateway);

  return (
    <>
      <PageTitle title="Payment" />
      <Navbar />
      <CheckoutPath activePath={2} />

      <div className="payment-container">
        {/* Gateway Selection */}
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
                    setSelectedCurrency(gateway.currencies[0]);
                  }}
                />
                <span>{gateway.label}</span>
              </label>
            ))}
          </div>

          {/* Currency Selection */}
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

        {/* Order Summary */}
        <div className="payment-summary">
          <h3>Order Summary</h3>
          <p>Subtotal: {formatCurrency(orderItem?.subtotal, selectedCurrency)}</p>
          <p>Tax: {formatCurrency(orderItem?.tax, selectedCurrency)}</p>
          <p>Shipping: {formatCurrency(orderItem?.shipping, selectedCurrency)}</p>
          <h4>Total: {formatCurrency(orderItem?.total, selectedCurrency)}</h4>
        </div>

        {/* Stripe Payment Form */}
        {selectedGateway === "stripe" && paymentData?.client_secret ? (
          <div className="stripe-payment-section">
            <h3>Enter Card Details</h3>
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: paymentData.client_secret,
                appearance: {
                  theme: 'stripe',
                  variables: {
                    colorPrimary: '#007bff'
                  }
                }
              }}
            >
              <StripeCheckout
                clientSecret={paymentData.client_secret}
                onSuccess={handleStripeSuccess}
                reference={paymentData.reference}
              />
            </Elements>
          </div>
        ) : (
          /* Initialize Button (Paystack & Flutterwave) */
          <button
            className="payment-btn"
            onClick={handleInitializePayment}
            disabled={loading || initLoading || !orderItem}
          >
            {initLoading
              ? "Initializing..."
              : loading
              ? "Verifying..."
              : `Pay ${formatCurrency(orderItem?.total, selectedCurrency)}`}
          </button>
        )}
      </div>

      <Footer />
    </>
  );
}

export default Payment;