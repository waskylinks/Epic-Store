import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ----------------------
// INITIALIZE PAYMENT THUNK (NEW - SECURE FLOW)
// ----------------------
export const initializePayment = createAsyncThunk(
  "payment/initializePayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway, currency, shippingInfo, cartItems } = payload;

      const { data } = await axios.post(
        "/api/v1/payment/initialize",
        {
          gateway,
          currency,
          shippingInfo,
          cartItems // Only send product IDs and quantities
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`
          }
        }
      );

      return data.data; // Contains: reference, orderId, amount, authorization_url, etc.
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment initialization failed" }
      );
    }
  }
);

// ----------------------
// VERIFY PAYMENT THUNK (UPDATED - SIMPLIFIED)
// ----------------------
export const verifyPayment = createAsyncThunk(
  "payment/verifyPayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway = "paystack", reference } = payload;

      // Only send gateway and reference - backend has all other data
      const { data } = await axios.post(
        "/api/v1/payment/verify",
        { gateway, reference },
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
// PAYMENT SLICE
// ----------------------
const initialState = {
  loading: false,
  initLoading: false, // Separate loading for initialization
  success: false,
  error: null,
  message: null,
  order: null,
  paymentData: null // Store initialization data (reference, authorization_url, etc.)
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
    resetPaymentState: (state) => {
      state.loading = false;
      state.initLoading = false;
      state.success = false;
      state.error = null;
      state.message = null;
      state.order = null;
      state.paymentData = null;
    },
    clearPaymentData: (state) => {
      state.paymentData = null;
    }
  },
  extraReducers: (builder) => {
    // Initialize payment
    builder
      .addCase(initializePayment.pending, (state) => {
        state.initLoading = true;
        state.error = null;
        state.paymentData = null;
      })
      .addCase(initializePayment.fulfilled, (state, action) => {
        state.initLoading = false;
        state.paymentData = action.payload; // Store reference, authorization_url, etc.
      })
      .addCase(initializePayment.rejected, (state, action) => {
        state.initLoading = false;
        state.error = action.payload?.message || "Payment initialization failed";
      });

    // Verify payment
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
  }
});

export const { 
  removePaymentError, 
  removePaymentMessage, 
  resetPaymentState,
  clearPaymentData 
} = paymentSlice.actions;

export default paymentSlice.reducer;