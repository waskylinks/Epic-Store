import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { generateEventId, buildClientAnalyticsPayload, ANALYTICS_EVENTS } from '../../utils/analytics.js';
import { trackPurchase } from '../../utils/eventBridge.js';

// ============================================
// THUNKS
// ============================================

export const initializePayment = createAsyncThunk(
  "payment/initializePayment",
  async (payload, { rejectWithValue }) => {
    try {
      const {
        gateway,
        currency,
        shippingInfo,
        cartItems,
        cartPricing,
        discountSnapshot,
      } = payload;

      const { data } = await axios.post(
        "/api/v1/payment/initialize",
        {
          gateway,
          currency,
          shippingInfo,
          cartItems,
          cartPricing,
          ...(discountSnapshot && { discountSnapshot }),
        },
        { withCredentials: true }
      );

      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment initialization failed" }
      );
    }
  }
);

export const verifyPayment = createAsyncThunk(
  "payment/verifyPayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway = "paystack", reference, transactionId } = payload;

      // Generate eventId and build analytics payload.
      // eventId is returned alongside the order so the fulfilled reducer
      // can fire the browser pixel with the matching UUID for Meta deduplication.
      const eventId = generateEventId();

      // FIX (missing eventType): buildClientAnalyticsPayload requires eventType
      // so that the payload is well-formed if it is ever routed to the analytics
      // ingestion endpoint. verifyPaymentController reads analyticsEventId directly
      // and ignores eventType, so this was silent — but a missing eventType would
      // produce a broken event record if the payload reached BigQuery.
      const analyticsPayload = buildClientAnalyticsPayload({
        eventType:        ANALYTICS_EVENTS.PURCHASE,
        analyticsEventId: eventId,
      });

      const { data } = await axios.post(
        "/api/v1/payment/verify",
        {
          gateway,
          reference,
          transactionId,
          ...analyticsPayload,
        },
        { withCredentials: true }
      );

      return { ...data, eventId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment verification failed" }
      );
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  loading:      false,
  initLoading:  false,
  success:      false,
  error:        null,
  message:      null,
  order:        null,
  paymentData:  null,
  discountInfo: null,
  idempotent:   false,
};

// ============================================
// SLICE
// ============================================

const paymentSlice = createSlice({
  name: "payment",
  initialState,
  reducers: {
    removePaymentError:   (state) => { state.error = null; },
    removePaymentMessage: (state) => { state.message = null; },
    resetPaymentState:    () => initialState,
    clearPaymentData:     (state) => { state.paymentData = null; state.discountInfo = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializePayment.pending, (state) => {
        state.initLoading  = true;
        state.error        = null;
        state.paymentData  = null;
        state.discountInfo = null;
      })
      .addCase(initializePayment.fulfilled, (state, action) => {
        state.initLoading  = false;
        state.paymentData  = action.payload;
        state.discountInfo = action.payload?.breakdown?.discount ?? null;
      })
      .addCase(initializePayment.rejected, (state, action) => {
        state.initLoading  = false;
        state.error        = action.payload?.message || "Payment initialization failed";
        state.discountInfo = null;
      });

    builder
      .addCase(verifyPayment.pending, (state) => {
        state.loading    = true;
        state.error      = null;
        state.message    = null;
        state.success    = false;
        state.idempotent = false;
      })
      .addCase(verifyPayment.fulfilled, (state, action) => {
        const { order, message, idempotent, eventId } = action.payload;

        state.loading    = false;
        state.success    = true;
        state.order      = order ?? null;
        state.message    = message ?? "Payment verified successfully";
        state.idempotent = idempotent ?? false;

        // FIX (orderId fallback to MongoDB _id): paymentInfo.reference must
        // always be present on a successfully verified order — verifyPaymentController
        // sets it before returning. The original fallback chain reached order._id
        // if paymentInfo was missing or undefined (e.g. a pre-populate response
        // shape), sending a MongoDB ObjectId as order_id to Meta's pixel.
        // Meta cannot reconcile an ObjectId against the ORD-xxx reference sent
        // by the server CAPI event — it replaces it with an internal EII1|...
        // identifier in Events Manager, breaking order-level deduplication.
        //
        // The fix: only call trackPurchase when paymentInfo.reference is
        // confirmed present. If it is absent, the order state is still set so
        // the UI can render a success screen, but the pixel is not fired with
        // a broken ID. The backend CAPI event (fired in verifyPaymentController)
        // will still record the conversion on the server side.
        //
        // FIX (double trackPurchase with orderSlice): trackPurchase is the
        // canonical purchase pixel for the payment gateway flow. orderSlice's
        // createOrder.fulfilled must NOT also call trackPurchase — only one
        // slice owns the purchase pixel per checkout path. If your codebase
        // dispatches createOrder then verifyPayment in sequence, ensure
        // orderSlice does not fire trackPurchase for gateway-verified orders
        // (guard on paymentInfo.status !== 'paid' or equivalent).
        if (order && eventId && order.paymentInfo?.reference) {
          trackPurchase(
            {
              orderId:  order.paymentInfo.reference,
              revenue:  order.totalPrice || 0,
              currency: order.paymentInfo?.currency || 'USD',
              items:    order.orderItems || [],
            },
            eventId
          );
        }
      })
      .addCase(verifyPayment.rejected, (state, action) => {
        state.loading    = false;
        state.success    = false;
        state.idempotent = false;
        state.error      = action.payload?.message || "Payment verification failed";
      });
  },
});

export const {
  removePaymentError,
  removePaymentMessage,
  resetPaymentState,
  clearPaymentData,
} = paymentSlice.actions;

export default paymentSlice.reducer;