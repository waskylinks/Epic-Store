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
import {
  updateCheckoutStep,
  setSelectedGateway,
  clearCheckout,
  selectCheckoutSession,
  selectCheckoutPricing,
  selectSelectedGateway,
  selectCheckoutId
} from "../features/checkout/checkoutSlice";

import { 
  FiCreditCard, 
  FiLock, 
  FiCheckCircle,
  FiAlertCircle 
} from 'react-icons/fi';

import { useFlutterwave, closePaymentModal } from "flutterwave-react-v3";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

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
      toast.error("Stripe is not ready yet. Please wait.");
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
    <form onSubmit={handleSubmit} className="ep-stripe-form">
      <PaymentElement />
      <button 
        className="ep-pay-btn" 
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
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const { user } = useSelector((state) => state.user);
  const { cartItems } = useSelector((state) => state.cart);
  const checkoutSession = useSelector(selectCheckoutSession);
  const checkoutPricing = useSelector(selectCheckoutPricing);
  const selectedGatewayFromCheckout = useSelector(selectSelectedGateway);
  const checkoutId = useSelector(selectCheckoutId);
  const { loading, initLoading, error, message, paymentData } = useSelector((state) => state.payment);

  const [selectedGateway, setSelectedGatewayLocal] = useState(selectedGatewayFromCheckout || "paystack");
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  
  const paystackTriggered = useRef(false);
  const flutterwaveTriggered = useRef(false);
  const stripeFormRef = useRef(null);

  // Redirect if no checkout session
  useEffect(() => {
    if (!checkoutSession && !checkoutId) {
      toast.warning('Please complete checkout first', { position: 'top-center' });
      navigate('/order/confirm');
    }
  }, [checkoutSession, checkoutId, navigate]);

  // Redirect if cart is empty
  useEffect(() => {
    if (cartItems.length === 0) {
      toast.warning('Your cart is empty', { position: 'top-center' });
      navigate('/cart');
    }
  }, [cartItems, navigate]);

  // Load Paystack script
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

  // Scroll to Stripe form when ready
  useEffect(() => {
    if (selectedGateway === "stripe" && paymentData?.client_secret && stripeFormRef.current) {
      setTimeout(() => {
        stripeFormRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        toast.info("Please fill in your card details below", {
          position: "top-center",
          autoClose: 3000
        });
      }, 500);
    }
  }, [selectedGateway, paymentData?.client_secret]);

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
            dispatch(clearCheckout());
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
        phonenumber: checkoutSession?.shippingInfo?.phoneNo || ""
      },
      customizations: {
        title: "EpicStore Payment",
        description: `Order ${paymentData.reference}`,
        logo: `${window.location.origin}/logo.png`
      }
    };
  }, [paymentData, selectedGateway, user.email, user.name, checkoutSession]);

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
        
        closePaymentModal();
        
        if (response.status === "successful" || response.status === "completed") {
          const transactionId = String(response.transaction_id);
          
          dispatch(
            verifyPayment({
              gateway: "flutterwave",
              reference: transactionId
            })
          )
            .unwrap()
            .then(() => {
              dispatch(clearCart());
              dispatch(clearPaymentData());
              dispatch(clearCheckout());
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
      paystackTriggered.current = false;
      flutterwaveTriggered.current = false;
      return;
    }

    if (selectedGateway === "paystack" && paymentData.authorization_url && !paystackTriggered.current) {
      paystackTriggered.current = true;
      openPaystackPopup();
    } else if (selectedGateway === "flutterwave" && flutterwaveConfig && !flutterwaveTriggered.current) {
      flutterwaveTriggered.current = true;
      setTimeout(() => {
        triggerFlutterwavePayment();
      }, 300);
    }
  }, [paymentData, selectedGateway, flutterwaveConfig, openPaystackPopup, triggerFlutterwavePayment]);

  /* ===============================
     INITIALIZE PAYMENT
  ================================ */
  const handleInitializePayment = async () => {
    if (!checkoutSession) {
      toast.error("No checkout session found");
      return;
    }
    
    if (cartItems.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    // Validate API keys
    if (selectedGateway === "stripe" && !STRIPE_KEY) {
      toast.error("Stripe is not configured");
      return;
    }
    if (selectedGateway === "flutterwave" && !import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY) {
      toast.error("Flutterwave is not configured");
      return;
    }
    if (selectedGateway === "paystack" && !import.meta.env.VITE_PAYSTACK_PUBLIC_KEY) {
      toast.error("Paystack is not configured");
      return;
    }

    // Update checkout step to payment_selection
    if (checkoutId) {
      try {
        await dispatch(updateCheckoutStep({
          checkoutId,
          step: 'payment_selection',
          gateway: selectedGateway
        })).unwrap();
      } catch (err) {
        console.error('Failed to update checkout step:', err);
      }
    }

    // Prepare cart items
    const cartPayload = cartItems.map((item) => ({
      product: item.product,
      quantity: item.qty || item.quantity || 1
    }));

    // Prepare shipping info from checkout session
    const shippingInfo = checkoutSession.shippingInfo || {};

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
      .then((data) => {
        console.log("Payment initialized:", data);
        
        // Update checkout step to payment_gateway
        if (checkoutId) {
          dispatch(updateCheckoutStep({
            checkoutId,
            step: 'payment_gateway',
            gateway: selectedGateway
          })).catch(err => console.error('Failed to update step:', err));
        }
        
        if (selectedGateway === "stripe" && !data.client_secret) {
          toast.error("Failed to initialize Stripe payment");
        }
      })
      .catch((err) => {
        console.error("Payment initialization error:", err);
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
        reference: paymentIntentId
      })
    )
      .unwrap()
      .then(() => {
        console.log("Verification successful, clearing cart...");
        dispatch(clearCart());
        dispatch(clearPaymentData());
        dispatch(clearCheckout());
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
  const formatCurrency = (amount, currency = "USD") => {
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

  /* ===============================
     GATEWAY OPTIONS
  ================================ */
  const gateways = [
    { 
      value: "paystack", 
      label: "Paystack", 
      currencies: ["NGN", "GHS", "ZAR", "USD"], 
      logo: "https://paystack.com/assets/developer/paystack-icon-blue.png" 
    },
    { 
      value: "flutterwave", 
      label: "Flutterwave", 
      currencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES"], 
      logo: "https://flutterwave.com/images/logo/full.svg" 
    },
    { 
      value: "stripe", 
      label: "Stripe", 
      currencies: ["USD", "EUR", "GBP"], 
      logo: "https://stripe.com/img/v3/home/social.png" 
    }
  ];

  const selectedGatewayConfig = gateways.find((g) => g.value === selectedGateway);

  // Use checkout session pricing if available, otherwise calculate from cart
  const orderSummary = checkoutPricing?.totalPrice ? {
    subtotal: checkoutPricing.itemPrice || 0,
    tax: checkoutPricing.taxPrice || 0,
    shipping: checkoutPricing.shippingPrice || 0,
    total: checkoutPricing.totalPrice || 0
  } : {
    subtotal: 0,
    tax: 0,
    shipping: 0,
    total: 0
  };

  return (
    <>
      <PageTitle title="Payment" />
      <Navbar />
      <CheckoutPath activePath={2} />

      <div className="ep-container">
        <div className="ep-header">
          <FiCreditCard className="ep-header-icon" />
          <h1>Complete Your Payment</h1>
          <p>Choose your preferred payment method</p>
        </div>

        <div className="ep-content">
          {/* Left Column - Payment Method Selection */}
          <div className="ep-payment-section">
            <div className="ep-section-card">
              <h2 className="ep-section-title">
                <FiCreditCard />
                Select Payment Gateway
              </h2>
              
              <div className="ep-gateway-grid">
                {gateways.map((gateway) => (
                  <label 
                    key={gateway.value} 
                    className={`ep-gateway-card ${selectedGateway === gateway.value ? 'ep-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="gateway"
                      value={gateway.value}
                      checked={selectedGateway === gateway.value}
                      onChange={(e) => {
                        setSelectedGatewayLocal(e.target.value);
                        dispatch(setSelectedGateway(e.target.value));
                        setSelectedCurrency(gateway.currencies[0]);
                        dispatch(clearPaymentData());
                        paystackTriggered.current = false;
                        flutterwaveTriggered.current = false;
                      }}
                    />
                    <div className="ep-gateway-content">
                      <img 
                        src={gateway.logo} 
                        alt={gateway.label}
                        className="ep-gateway-logo-img"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                      <span className="ep-gateway-name">{gateway.label}</span>
                      {selectedGateway === gateway.value && (
                        <FiCheckCircle className="ep-check-icon" />
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Currency Selection */}
            <div className="ep-section-card">
              <h3 className="ep-section-subtitle">Select Currency</h3>
              <div className="ep-currency-grid">
                {selectedGatewayConfig?.currencies.map((currency) => (
                  <label 
                    key={currency} 
                    className={`ep-currency-option ${selectedCurrency === currency ? 'ep-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="currency"
                      value={currency}
                      checked={selectedCurrency === currency}
                      onChange={(e) => setSelectedCurrency(e.target.value)}
                    />
                    <span>{currency}</span>
                    {selectedCurrency === currency && (
                      <FiCheckCircle className="ep-check-icon-small" />
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Initialize Payment Button (for Stripe) */}
            {selectedGateway === "stripe" && !paymentData?.client_secret && (
              <div className="ep-section-card">
                <button
                  className="ep-pay-btn"
                  onClick={handleInitializePayment}
                  disabled={loading || initLoading}
                >
                  {initLoading
                    ? "Initializing Stripe..."
                    : `Initialize Payment - ${formatCurrency(orderSummary.total, selectedCurrency)}`}
                </button>
              </div>
            )}

            {/* Stripe Payment Form */}
            {selectedGateway === "stripe" && paymentData?.client_secret && (
              <div className="ep-section-card" ref={stripeFormRef}>
                <h3 className="ep-section-subtitle">
                  <FiLock />
                  Enter Card Details
                </h3>
                {stripePromise ? (
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: paymentData.client_secret,
                      appearance: {
                        theme: 'stripe',
                        variables: {
                          colorPrimary: '#10b981',
                          borderRadius: '8px'
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
                  <div className="ep-error-message">
                    <FiAlertCircle />
                    <p>Stripe is not configured. Please contact support.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column - Order Summary */}
          <div className="ep-summary-section">
            <div className="ep-summary-card">
              <h2 className="ep-summary-title">Order Summary</h2>
              
              <div className="ep-summary-items">
                <div className="ep-summary-row">
                  <span className="ep-summary-label">Subtotal</span>
                  <span className="ep-summary-value">
                    {formatCurrency(orderSummary.subtotal, selectedCurrency)}
                  </span>
                </div>

                <div className="ep-summary-row">
                  <span className="ep-summary-label">Tax (18%)</span>
                  <span className="ep-summary-value">
                    {formatCurrency(orderSummary.tax, selectedCurrency)}
                  </span>
                </div>

                <div className="ep-summary-row">
                  <span className="ep-summary-label">Shipping</span>
                  <span className="ep-summary-value">
                    {orderSummary.shipping === 0 ? (
                      <span className="ep-free-badge">FREE</span>
                    ) : (
                      formatCurrency(orderSummary.shipping, selectedCurrency)
                    )}
                  </span>
                </div>

                <div className="ep-summary-divider"></div>

                <div className="ep-summary-row ep-summary-total">
                  <span className="ep-summary-label">Total Amount</span>
                  <span className="ep-summary-value">
                    {formatCurrency(orderSummary.total, selectedCurrency)}
                  </span>
                </div>
              </div>

              {/* Security Badge */}
              <div className="ep-security-badge">
                <FiLock />
                <span>Secure Payment</span>
              </div>

              {/* Pay Button (for Paystack & Flutterwave) */}
              {selectedGateway !== "stripe" && (
                <button
                  className="ep-pay-btn"
                  onClick={handleInitializePayment}
                  disabled={loading || initLoading}
                >
                  {initLoading
                    ? "Initializing..."
                    : loading
                    ? "Verifying..."
                    : `Pay ${formatCurrency(orderSummary.total, selectedCurrency)}`}
                </button>
              )}

              {/* Payment Info */}
              <div className="ep-payment-info">
                <FiAlertCircle />
                <p>Your payment information is encrypted and secure</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default Payment;