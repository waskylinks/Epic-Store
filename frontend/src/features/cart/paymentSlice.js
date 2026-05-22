import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { generateEventId, buildClientAnalyticsPayload } from '../../utils/analytics.js';
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

      // Generate eventId and build analytics payload with correct object signature.
      // eventId is returned alongside the order so the fulfilled reducer can fire
      // the browser pixel with the matching UUID for Meta deduplication.
      const eventId          = generateEventId();
      const analyticsPayload = buildClientAnalyticsPayload({
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

      // Return eventId so the fulfilled handler can fire trackPurchase()
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

        // Fire the browser pixel with the same eventId sent to the server.
        // Meta matches browser fbq() + CAPI server event via this UUID and
        // shows "Deduped" in Events Manager — preventing double-counting.
        // trackPurchase is fire-and-forget — never throws, never blocks.
        if (order && eventId) {
          trackPurchase(
            {
              orderId:  order._id || order.id,
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