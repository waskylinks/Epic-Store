import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import PageTitle from "../components/PageTitle";
import Footer from "../components/footer";
import CheckoutPath from "./CheckoutPath";

import { selectSelectedAddress } from "../features/shipping/shippingSlice";

import "../CartStyles/Payment.css";

import { toast } from "react-toastify";
import {
  initializePayment,
  verifyPayment,
  removePaymentError,
  removePaymentMessage,
  clearPaymentData
} from "../features/cart/paymentSlice";
import { clearEntireCart  } from "../features/cart/cartSlice";
import {
  clearCheckout,
  selectCheckoutSession,
  selectCheckoutPricing,
  selectCheckoutId,
  updateCheckoutStep
} from "../features/checkout/checkoutSlice";
import {
  selectCartPricing,
  selectDiscount,
} from "../features/cart/cartSlice";

import useCheckoutAbandonment from "../hooks/useCheckoutAbandonment";

import {
  FiCreditCard,
  FiLock,
  FiCheckCircle,
  FiAlertCircle,
  FiTag
} from "react-icons/fi";

import { useFlutterwave, closePaymentModal } from "flutterwave-react-v3";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null;

// Mirrors the server-side STEP_ORDER enum for client-side comparison.
// Used to determine whether a step update is needed on mount without
// making an extra network call.
const STEP_ORDER = [
  'shipping_info',
  'order_confirmation',
  'payment_selection',
  'payment_gateway',
  'payment_failed',
];

function StripeCheckout({ clientSecret, onSuccess }) {
  const stripe   = useStripe();
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
      } else if (paymentIntent?.status === "succeeded") {
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
      <button className="ep-pay-btn" disabled={!stripe || processing} type="submit">
        {processing ? "Processing..." : "Pay Now"}
      </button>
    </form>
  );
}

function Payment() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { user }          = useSelector((state) => state.user);
  const { cartItems }     = useSelector((state) => state.cart);
  const checkoutSession   = useSelector(selectCheckoutSession);
  const checkoutPricing   = useSelector(selectCheckoutPricing);
  const checkoutId        = useSelector(selectCheckoutId);

  const cartPricing = useSelector(selectCartPricing);
  const discount    = useSelector(selectDiscount);

  const selectedShippingAddress = useSelector(selectSelectedAddress);

  const {
    loading,
    initLoading,
    error,
    message,
    paymentData,
    discountInfo
  } = useSelector((state) => state.payment);

  const [selectedGateway, setSelectedGateway]   = useState("paystack");
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [flutterwaveOpen, setFlutterwaveOpen]   = useState(false);

  const paystackTriggered    = useRef(false);
  const flutterwaveTriggered = useRef(false);
  const stripeFormRef        = useRef(null);

  const { setIntentionalProceed } = useCheckoutAbandonment(checkoutId, "payment_selection");

  // ── Record payment_selection on mount (with race condition guard) ─────────
  // Only fires the DB update if the session hasn't already reached
  // payment_selection. This prevents:
  //
  //   1. RACE CONDITION: OrderConfirm.jsx fires order_confirmation just before
  //      navigating here. Both requests hit the server within milliseconds.
  //      Without the guard, payment_selection would race against
  //      order_confirmation. With furthestStepReached as the validation basis
  //      on the server this is now safe — but skipping the update entirely
  //      when already past it is cleaner and eliminates unnecessary writes.
  //
  //   2. BACK-NAVIGATION DUPLICATES: User goes back to edit address then
  //      returns. stepsCompleted already has payment_selection — no need to
  //      push it again.
  //
  // Reads furthest step from Redux state (already fetched) — no extra
  // network call needed.
  useEffect(() => {
    if (!checkoutId) return;

    // Compute the furthest step the user has reached from Redux state.
    // stepsCompleted is an array of { step, completedAt } objects.
    const completedSteps = checkoutSession?.stepsCompleted?.map(s => s.step) || [];
    const furthest = completedSteps.reduce(
      (max, s) => STEP_ORDER.indexOf(s) > STEP_ORDER.indexOf(max) ? s : max,
      checkoutSession?.currentStep || 'shipping_info'
    );

    // Already at or past payment_selection — skip the update
    if (STEP_ORDER.indexOf(furthest) >= STEP_ORDER.indexOf('payment_selection')) {
      return;
    }

    (async () => {
      try {
        await dispatch(updateCheckoutStep({
          checkoutId,
          step: "payment_selection",
        })).unwrap();
      } catch (err) {
        console.warn("[Payment] Failed to record payment_selection step:", err);
      }
    })();
    // checkoutId and checkoutSession are stable for the lifetime of this page.
    // Including checkoutSession would cause re-runs after the step update
    // itself updates the session in Redux — use checkoutId only as the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutId]);

  // ── Mount-only guards ────────────────────────────────────────────────────
  useEffect(() => {
    if (!checkoutSession && !checkoutId) {
      toast.warning("Please complete checkout first", { position: "top-center" });
      navigate("/order/confirm");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cartItems.length === 0) {
      toast.warning("Your cart is empty", { position: "top-center" });
      navigate("/cart");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedGateway === "paystack" && !window.PaystackPop) {
      const script = document.createElement("script");
      script.src   = "https://js.paystack.co/v1/inline.js";
      script.async = true;
      script.onerror = () => toast.error("Failed to load Paystack");
      document.body.appendChild(script);
    }
  }, [selectedGateway]);

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

  useEffect(() => {
    if (selectedGateway === "stripe" && paymentData?.client_secret && stripeFormRef.current) {
      setTimeout(() => {
        stripeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        toast.info("Please fill in your card details below", {
          position: "top-center",
          autoClose: 3000
        });
      }, 500);
    }
  }, [selectedGateway, paymentData?.client_secret]);

  // ── Gateway callbacks ────────────────────────────────────────────────────

  const openPaystackPopup = useCallback(() => {
    if (!window.PaystackPop) { toast.error("Paystack SDK not loaded"); return; }
    const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if (!key)  { toast.error("Paystack public key missing"); return; }

    const handler = window.PaystackPop.setup({
      key,
      email:    user.email,
      amount:   paymentData.amount * 100,
      currency: paymentData.currency,
      ref:      paymentData.reference,
      callback: (response) => {
        const ref = response.reference;
        dispatch(verifyPayment({ gateway: "paystack", reference: ref }))
          .unwrap()
          .then(() => {
            setIntentionalProceed();
            dispatch(clearEntireCart());
            dispatch(clearPaymentData());
            dispatch(clearCheckout());
            navigate(`/order/success?reference=${ref}`);
          })
          .catch(() => {
            if (checkoutId) {
              dispatch(updateCheckoutStep({ checkoutId, step: "payment_failed" }))
                .catch((err) =>
                  console.warn("[Payment] Failed to record payment_failed step:", err)
                );
            }
            toast.error("Payment verification failed");
          });
      },
      onClose: () => {
        toast.info("Payment cancelled");
        dispatch(clearPaymentData());
        paystackTriggered.current = false;
      }
    });
    handler.openIframe();
  }, [user.email, paymentData, dispatch, navigate, checkoutId, setIntentionalProceed]);

  const flutterwaveConfig = React.useMemo(() => {
    if (!paymentData || selectedGateway !== "flutterwave") return null;
    return {
      public_key:      import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY || "",
      tx_ref:          paymentData.reference,
      amount:          paymentData.amount,
      currency:        paymentData.currency,
      payment_options: "card,banktransfer,ussd,mobilemoney",
      customer: {
        email:       user.email,
        name:        user.name || "Customer",
        phonenumber: checkoutSession?.shippingInfo?.phoneNo || ""
      },
      customizations: {
        title:       "EpicStore Payment",
        description: `Order ${paymentData.reference}`,
        logo:        `${window.location.origin}/logo.png`
      }
    };
  }, [paymentData, selectedGateway, user.email, user.name, checkoutSession]);

  const safeFlutterwaveConfig = flutterwaveConfig || {
    public_key: import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY || "",
    tx_ref:     "placeholder",
    amount:     0,
    currency:   "NGN",
    customer:   { email: user?.email || "", name: user?.name || "Customer" }
  };

  const handleFlutterwavePayment = useFlutterwave(safeFlutterwaveConfig);

  const triggerFlutterwavePayment = useCallback(() => {
    if (!flutterwaveConfig) { toast.error("Payment configuration not ready"); return; }
    setFlutterwaveOpen(true);
    handleFlutterwavePayment({
      callback: (response) => {
        closePaymentModal();
        setFlutterwaveOpen(false);
        if (response.status === "successful" || response.status === "completed") {
          const txRef         = response.tx_ref;
          const transactionId = String(response.transaction_id);
          dispatch(verifyPayment({ gateway: "flutterwave", reference: txRef, transactionId }))
            .unwrap()
            .then(() => {
              setIntentionalProceed();
              dispatch(clearEntireCart());
              dispatch(clearPaymentData());
              dispatch(clearCheckout());
              setTimeout(() => navigate(`/order/success?reference=${txRef}`), 500);
            })
            .catch((err) => {
              if (checkoutId) {
                dispatch(updateCheckoutStep({ checkoutId, step: "payment_failed" }))
                  .catch((stepErr) =>
                    console.warn("[Payment] Failed to record payment_failed step:", stepErr)
                  );
              }
              toast.error(err.message || "Payment verification failed");
            });
        } else {
          toast.error("Payment was not successful");
          dispatch(clearPaymentData());
        }
      },
      onClose: () => {
        toast.info("Payment cancelled");
        setFlutterwaveOpen(false);
        dispatch(clearPaymentData());
        flutterwaveTriggered.current = false;
      }
    });
  }, [flutterwaveConfig, handleFlutterwavePayment, dispatch, navigate, checkoutId, setIntentionalProceed]);

  useEffect(() => {
    if (!paymentData) {
      paystackTriggered.current    = false;
      flutterwaveTriggered.current = false;
      setFlutterwaveOpen(false);
      return;
    }
    if (selectedGateway === "paystack" && paymentData.authorization_url && !paystackTriggered.current) {
      paystackTriggered.current = true;
      openPaystackPopup();
    } else if (selectedGateway === "flutterwave" && flutterwaveConfig && !flutterwaveTriggered.current) {
      flutterwaveTriggered.current = true;
      setTimeout(() => triggerFlutterwavePayment(), 300);
    }
  }, [paymentData, selectedGateway, flutterwaveConfig, openPaystackPopup, triggerFlutterwavePayment]);

  // ── Initialize payment ───────────────────────────────────────────────────
  const handleInitializePayment = async () => {
    if (!checkoutSession && !checkoutId)                                                       { toast.error("No checkout session found"); return; }
    if (cartItems.length === 0)                                                                { toast.error("Cart is empty"); return; }
    if (selectedGateway === "stripe"      && !STRIPE_KEY)                                     { toast.error("Stripe is not configured"); return; }
    if (selectedGateway === "flutterwave" && !import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY)    { toast.error("Flutterwave is not configured"); return; }
    if (selectedGateway === "paystack"    && !import.meta.env.VITE_PAYSTACK_PUBLIC_KEY)       { toast.error("Paystack is not configured"); return; }

    // Advance to payment_gateway — user has actively committed to the gateway
    // flow by clicking Initialize. The DB is already at payment_selection
    // (set on mount). After this the abandonment step is payment_gateway.
    if (checkoutId) {
      try {
        await dispatch(updateCheckoutStep({
          checkoutId,
          step:    "payment_gateway",
          gateway: selectedGateway
        })).unwrap();
      } catch (err) {
        console.warn("[Payment] Failed to record payment_gateway step:", err);
      }
    }

    const pricingToSend = (cartPricing?.totalPrice > 0)
      ? cartPricing
      : checkoutPricing;

    if (!pricingToSend || !pricingToSend.totalPrice) {
      toast.error("Pricing information is missing. Please return to your cart.");
      return;
    }

    const shippingInfo = checkoutSession?.shippingInfo?.address
      ? checkoutSession.shippingInfo
      : selectedShippingAddress
        ? {
            address:  selectedShippingAddress.address,
            city:     selectedShippingAddress.city,
            state:    selectedShippingAddress.state,
            country:  selectedShippingAddress.country,
            pinCode:  selectedShippingAddress.pinCode,
            phoneNo:  selectedShippingAddress.phoneNo,
          }
        : null;

    if (!shippingInfo?.address) {
      toast.error("Shipping address is missing. Please go back and select an address.");
      return;
    }

    const discountSnapshot = (discount.applied && discount.code)
      ? {
          code:              discount.code,
          discountId:        discount.discountId  || null,
          type:              discount.type        || null,
          value:             discount.value       || null,
          discountAmount:    discount.discountAmount    || 0,
          originalItemPrice: pricingToSend.itemPrice,
          description:       discount.description || null,
          eligibleProductCategories: Array.isArray(discount.eligibleProductCategories)
            ? discount.eligibleProductCategories
            : [],
        }
      : null;

    paystackTriggered.current    = false;
    flutterwaveTriggered.current = false;
    setFlutterwaveOpen(false);

    dispatch(
      initializePayment({
        gateway:      selectedGateway,
        currency:     selectedCurrency,
        shippingInfo,
        cartItems:    cartItems.map((item) => ({
          product:  item.product,
          quantity: item.qty || item.quantity || 1
        })),
        cartPricing: pricingToSend,
        ...(discountSnapshot && { discountSnapshot }),
      })
    )
      .unwrap()
      .then((data) => {
        if (selectedGateway === "stripe" && !data.client_secret) {
          toast.error("Failed to initialize Stripe payment");
        }
      })
      .catch((err) => toast.error(err.message || "Failed to initialize payment"));
  };

  // ── Stripe success callback ──────────────────────────────────────────────
  const handleStripeSuccess = (paymentIntentId) => {
    const successReference = paymentData.reference;
    dispatch(verifyPayment({ gateway: "stripe", reference: paymentIntentId }))
      .unwrap()
      .then(() => {
        setIntentionalProceed();
        dispatch(clearEntireCart());
        dispatch(clearPaymentData());
        dispatch(clearCheckout());
        navigate(`/order/success?reference=${successReference}`);
      })
      .catch((err) => {
        if (checkoutId) {
          dispatch(updateCheckoutStep({ checkoutId, step: "payment_failed" }))
            .catch((stepErr) =>
              console.warn("[Payment] Failed to record payment_failed step:", stepErr)
            );
        }
        toast.error(err.message || "Payment verification failed");
      });
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const formatCurrency = (amount, currency = "USD") => {
    const localeMap = { NGN: "en-NG", USD: "en-US", GBP: "en-GB", EUR: "en-DE" };
    return new Intl.NumberFormat(localeMap[currency] || "en-US", {
      style: "currency", currency, minimumFractionDigits: 2
    }).format(amount);
  };

  const gateways = [
    {
      value:      "paystack",
      label:      "Paystack",
      currencies: ["NGN", "GHS", "ZAR", "USD"],
      logo:       "https://paystack.com/assets/developer/paystack-icon-blue.png"
    },
    {
      value:      "flutterwave",
      label:      "Flutterwave",
      currencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES"],
      logo:       "https://flutterwave.com/images/logo/full.svg"
    },
    {
      value:      "stripe",
      label:      "Stripe",
      currencies: ["USD", "EUR", "GBP"],
      logo:       "https://stripe.com/img/v3/home/social.png"
    }
  ];

  const selectedGatewayConfig = gateways.find((g) => g.value === selectedGateway);

  const orderSummary = paymentData?.breakdown
    ? {
        subtotal:       paymentData.breakdown.itemPrice     || 0,
        tax:            paymentData.breakdown.taxPrice      || 0,
        shipping:       paymentData.breakdown.shippingPrice || 0,
        total:          paymentData.breakdown.totalPrice    || 0,
        discountAmount: discountInfo?.discountAmount        || 0,
        discountCode:   discountInfo?.code                  || null,
      }
    : {
        subtotal:       cartPricing?.itemPrice     || checkoutPricing?.itemPrice     || 0,
        tax:            cartPricing?.taxPrice      || checkoutPricing?.taxPrice      || 0,
        shipping:       cartPricing?.shippingPrice || checkoutPricing?.shippingPrice || 0,
        total:          cartPricing?.totalPrice    || checkoutPricing?.totalPrice    || 0,
        discountAmount: discount.applied ? (discount.discountAmount || 0) : 0,
        discountCode:   discount.applied ? discount.code : null,
      };

  // ── Render ───────────────────────────────────────────────────────────────
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
                    className={`ep-gateway-card ${selectedGateway === gateway.value ? "ep-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="gateway"
                      value={gateway.value}
                      checked={selectedGateway === gateway.value}
                      onChange={(e) => {
                        setSelectedGateway(e.target.value);
                        setSelectedCurrency(gateway.currencies[0]);
                        dispatch(clearPaymentData());
                        paystackTriggered.current    = false;
                        flutterwaveTriggered.current = false;
                        setFlutterwaveOpen(false);
                      }}
                    />
                    <div className="ep-gateway-content">
                      <div className="ep-gateway-logo-wrapper">
                        <img
                          src={gateway.logo}
                          alt={gateway.label}
                          className="ep-gateway-logo-img"
                          onError={(e) => {
                            e.target.style.display = "none";
                            const fallback = e.target.parentNode.querySelector(".ep-gateway-logo-fallback");
                            if (fallback) fallback.style.display = "block";
                          }}
                        />
                        <span className="ep-gateway-logo-fallback" style={{ display: "none" }}>
                          {gateway.label}
                        </span>
                      </div>
                      <span className="ep-gateway-name">{gateway.label}</span>
                      {selectedGateway === gateway.value && (
                        <FiCheckCircle className="ep-check-icon" />
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="ep-section-card">
              <h3 className="ep-section-subtitle">Select Currency</h3>
              <div className="ep-currency-grid">
                {selectedGatewayConfig?.currencies.map((currency) => (
                  <label
                    key={currency}
                    className={`ep-currency-option ${selectedCurrency === currency ? "ep-selected" : ""}`}
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
                        theme: "stripe",
                        variables: { colorPrimary: "#10b981", borderRadius: "8px" }
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

          {/* ── Order Summary Sidebar ─────────────────────────────────── */}
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

                {orderSummary.discountAmount > 0 && (
                  <div className="ep-summary-row ep-summary-discount">
                    <span className="ep-summary-label">
                      <FiTag className="ep-tag-icon" />
                      {orderSummary.discountCode
                        ? `Discount (${orderSummary.discountCode})`
                        : "Discount"}
                    </span>
                    <span className="ep-summary-value ep-discount-value">
                      -{formatCurrency(orderSummary.discountAmount, selectedCurrency)}
                    </span>
                  </div>
                )}

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

              <div className="ep-security-badge">
                <FiLock />
                <span>Secure Payment</span>
              </div>

              {selectedGateway !== "stripe" && !flutterwaveOpen && (
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