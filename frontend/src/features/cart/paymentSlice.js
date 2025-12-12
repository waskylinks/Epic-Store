import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ----------------------
// VERIFY PAYMENT THUNK (frontend-triggered)
// ----------------------
export const verifyPayment = createAsyncThunk(
  "payment/verifyPayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway = "paystack", ...rest } = payload;

      const { data } = await axios.post(
        "/api/v1/payment/verify",
        { gateway, ...rest },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`
          }
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
// WEBHOOK THUNK (server-to-server)
// ----------------------
export const handleWebhook = createAsyncThunk(
  "payment/handleWebhook",
  async ({ provider, payload }, { rejectWithValue }) => {
    try {
      // Provider can be paystack, stripe, flutterwave, etc.
      const { data } = await axios.post(
        `/api/v1/payment/webhook?provider=${provider}`,
        payload
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Webhook handling failed" }
      );
    }
  }
);

// ----------------------
// PAYMENT SLICE
// ----------------------
const initialState = {
  loading: false,
  success: false,
  error: null,
  message: null,
  order: null
};

const paymentSlice = createSlice({
  name: "payment",
  initialState,
  reducers: {
    removePaymentError: (state) => { state.error = null; },
    removePaymentMessage: (state) => { state.message = null; },
    resetPaymentState: (state) => {
      state.loading = false;
      state.success = false;
      state.error = null;
      state.message = null;
      state.order = null;
    }
  },
  extraReducers: (builder) => {
    // Frontend verification
    builder
      .addCase(verifyPayment.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.message = null;
        state.success = false;
      })
      .addCase(verifyPayment.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.order = action.payload.order || null;
        state.message = action.payload.message || "Payment verified successfully";
      })
      .addCase(verifyPayment.rejected, (state, action) => {
        state.loading = false;
        state.success = false;
        state.error = action.payload?.message || "Payment verification failed";
      });

    // Webhook handling
    builder
      .addCase(handleWebhook.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.message = null;
      })
      .addCase(handleWebhook.fulfilled, (state, action) => {
        state.loading = false;
        state.message = action.payload.message || "Webhook processed successfully";
        state.order = action.payload.order || state.order;
      })
      .addCase(handleWebhook.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Webhook handling failed";
      });
  }
});

export const { removePaymentError, removePaymentMessage, resetPaymentState } =
  paymentSlice.actions;

export default paymentSlice.reducer;
