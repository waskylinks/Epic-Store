import React, { useEffect, useState, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import PageTitle from "../components/PageTitle";
import Footer from "../components/footer";
import CheckoutPath from "./CheckoutPath";

import "../CartStyles/Payment.css";

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

// Only initialize Stripe if key exists
const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null;

/* ===============================
   STRIPE CHECKOUT FORM
================================ */
function StripeCheckout({ clientSecret, onSuccess }) {
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
        redirect: "if_required"
      });

      if (error) {
        toast.error(error.message);
        setProcessing(false);
      } else if (paymentIntent && paymentIntent.status === "succeeded") {
        onSuccess(paymentIntent.id);
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
  
  // Refs to prevent double-triggering
  const paystackTriggered = useRef(false);
  const flutterwaveTriggered = useRef(false);

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
  const openPaystackPopup = React.useCallback(() => {
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
      amount: paymentData.amount * 100,
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
        paystackTriggered.current = false;
      }
    });

    handler.openIframe();
  }, [user.email, paymentData, dispatch, navigate]);

  /* ===============================
     FLUTTERWAVE CONFIG
  ================================ */
  const flutterwaveConfig = React.useMemo(() => {
    if (!paymentData || selectedGateway !== "flutterwave") {
      return null;
    }

    return {
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
      }
    };
  }, [paymentData, selectedGateway, user.email, user.name, shippingInfo.phoneNo]);

  /* ===============================
     FLUTTERWAVE HANDLER
  ================================ */
  const handleFlutterwavePayment = useFlutterwave(flutterwaveConfig || {
    public_key: "",
    tx_ref: "",
    amount: 0,
    currency: "NGN",
    customer: { email: "", name: "" }
  });

  const triggerFlutterwavePayment = React.useCallback(() => {
    if (!flutterwaveConfig) {
      toast.error("Payment configuration not ready");
      return;
    }

    handleFlutterwavePayment({
      callback: (response) => {
        console.log("Flutterwave response:", response);
        
        // Close modal FIRST
        closePaymentModal();
        
        if (response.status === "successful" || response.status === "completed") {
          // ✅ FIXED: Use transaction_id for verification
          // Convert to string as Flutterwave returns it as a number in test mode
          const transactionId = String(response.transaction_id);
          
          console.log("Verifying Flutterwave with transaction ID:", transactionId);
          
          dispatch(
            verifyPayment({
              gateway: "flutterwave",
              reference: transactionId  // Pass transaction_id, not tx_ref
            })
          )
            .unwrap()
            .then(() => {
              dispatch(clearCart());
              dispatch(clearPaymentData());
              sessionStorage.removeItem("orderItem");
              // Add delay to ensure modal is fully closed
              setTimeout(() => {
                navigate(`/order/success?reference=${response.tx_ref}`);
              }, 500);
            })
            .catch((err) => {
              console.error("Verification error:", err);
              toast.error(err.message || "Payment verification failed");
            });
        } else {
          toast.error("Payment was not successful");
          dispatch(clearPaymentData());
        }
      },
      onClose: () => {
        console.log("Flutterwave modal closed");
        toast.info("Payment cancelled");
        dispatch(clearPaymentData());
        flutterwaveTriggered.current = false;
      }
    });
  }, [flutterwaveConfig, handleFlutterwavePayment, dispatch, navigate]);

  /* ===============================
     AUTO-OPEN PAYMENT POPUP/MODAL
  ================================ */
  useEffect(() => {
    if (!paymentData) {
      // Reset triggers when payment data is cleared
      paystackTriggered.current = false;
      flutterwaveTriggered.current = false;
      return;
    }

    if (selectedGateway === "paystack" && paymentData.authorization_url && !paystackTriggered.current) {
      paystackTriggered.current = true;
      openPaystackPopup();
    } else if (selectedGateway === "flutterwave" && flutterwaveConfig && !flutterwaveTriggered.current) {
      flutterwaveTriggered.current = true;
      // Add small delay to prevent double trigger
      setTimeout(() => {
        triggerFlutterwavePayment();
      }, 300);
    }
  }, [paymentData, selectedGateway, flutterwaveConfig, openPaystackPopup, triggerFlutterwavePayment]);

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

    // Validate API keys
    if (selectedGateway === "stripe" && !STRIPE_KEY) {
      toast.error("Stripe is not configured. Please contact support.");
      return;
    }
    if (selectedGateway === "flutterwave" && !import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY) {
      toast.error("Flutterwave is not configured. Please contact support.");
      return;
    }
    if (selectedGateway === "paystack" && !import.meta.env.VITE_PAYSTACK_PUBLIC_KEY) {
      toast.error("Paystack is not configured. Please contact support.");
      return;
    }

    const cartPayload = cartItems.map((item) => ({
      product: item.product,
      quantity: item.quantity
    }));

    // Reset triggers
    paystackTriggered.current = false;
    flutterwaveTriggered.current = false;

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
  const handleStripeSuccess = (paymentIntentId) => {
    console.log("Stripe payment succeeded, verifying with ID:", paymentIntentId);
    dispatch(
      verifyPayment({
        gateway: "stripe",
        reference: paymentIntentId  // ✅ FIXED: Pass payment intent ID, not order reference
      })
    )
      .unwrap()
      .then(() => {
        console.log("Verification successful, clearing cart...");
        dispatch(clearCart());
        dispatch(clearPaymentData());
        sessionStorage.removeItem("orderItem");
        navigate(`/order/success?reference=${paymentData.reference}`);
      })
      .catch((err) => {
        console.error("Stripe verification error:", err);
        toast.error(err.message || "Payment verification failed");
      });
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
                    dispatch(clearPaymentData());
                    paystackTriggered.current = false;
                    flutterwaveTriggered.current = false;
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
            {stripePromise ? (
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
                />
              </Elements>
            ) : (
              <p style={{ color: 'red' }}>Stripe is not configured properly. Please check your environment variables.</p>
            )}
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