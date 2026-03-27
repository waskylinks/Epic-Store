import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ----------------------
// INITIALIZE PAYMENT THUNK
// ----------------------

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
          // FIX: send pre-computed totals so the backend never recalculates.
          cartPricing,
          // FIX: send full discount snapshot (omit key entirely when null so
          // the backend's discountSnapshot guard is not entered).
          ...(discountSnapshot && { discountSnapshot }),
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment initialization failed" }
      );
    }
  }
);

// ----------------------
// VERIFY PAYMENT THUNK
// ----------------------
export const verifyPayment = createAsyncThunk(
  "payment/verifyPayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway = "paystack", reference, transactionId } = payload;

      const { data } = await axios.post(
        "/api/v1/payment/verify",
        { gateway, reference, transactionId },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment verification failed" }
      );
    }
  }
);

// ----------------------
// PAYMENT SLICE
// ----------------------


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

const paymentSlice = createSlice({
  name: "payment",
  initialState,
  reducers: {
    removePaymentError: (state) => {
      state.error = null;
    },
    removePaymentMessage: (state) => {
      state.message = null;
    },
    resetPaymentState: () => initialState,
    clearPaymentData: (state) => {
      state.paymentData  = null;
      state.discountInfo = null;
    },
  },
  extraReducers: (builder) => {
    // ── Initialize payment ──────────────────────────────────────────
    builder
      .addCase(initializePayment.pending, (state) => {
        state.initLoading  = true;
        state.error        = null;
        state.paymentData  = null;
        state.discountInfo = null;
      })
      .addCase(initializePayment.fulfilled, (state, action) => {
        state.initLoading = false;
        state.paymentData = action.payload;
        state.discountInfo = action.payload?.breakdown?.discount ?? null;
      })
      .addCase(initializePayment.rejected, (state, action) => {
        state.initLoading  = false;
        state.error        = action.payload?.message || "Payment initialization failed";
        state.discountInfo = null;
      });

    // ── Verify payment ──────────────────────────────────────────────
    builder
      .addCase(verifyPayment.pending, (state) => {
        state.loading    = true;
        state.error      = null;
        state.message    = null;
        state.success    = false;
        state.idempotent = false;
      })
      .addCase(verifyPayment.fulfilled, (state, action) => {
        state.loading    = false;
        state.success    = true;
        state.order      = action.payload.order   ?? null;
        state.message    = action.payload.message ?? "Payment verified successfully";
        state.idempotent = action.payload.idempotent ?? false;
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