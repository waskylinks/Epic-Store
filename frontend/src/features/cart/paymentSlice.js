import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ----------------------
// VERIFY PAYMENT THUNK
// ----------------------
export const verifyPayment = createAsyncThunk(
  "payment/verifyPayment",
  async (payload, { rejectWithValue }) => {
    try {
      // Extract gateway from payload (currently just paystack)
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
    removePaymentError: (state) => {
      state.error = null;
    },
    removePaymentMessage: (state) => {
      state.message = null;
    },
    resetPaymentState: (state) => {
      state.loading = false;
      state.success = false;
      state.error = null;
      state.message = null;
      state.order = null;
    }
  },
  extraReducers: (builder) => {
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

export const { removePaymentError, removePaymentMessage, resetPaymentState } =
  paymentSlice.actions;

export default paymentSlice.reducer;
