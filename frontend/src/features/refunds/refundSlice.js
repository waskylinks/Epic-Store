import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/**
 * User requests refund for their order
 */
export const requestRefund = createAsyncThunk(
  "refund/requestRefund",
  async ({ orderId, refundData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/refund/request`,
        refundData,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to request refund"
      );
    }
  }
);

/**
 * Get refund status for an order
 */
export const getRefundStatus = createAsyncThunk(
  "refund/getRefundStatus",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/status`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refund status"
      );
    }
  }
);

/**
 * Admin: Get all refund requests
 */
export const getAllRefunds = createAsyncThunk(
  "refund/getAllRefunds",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/admin/refunds${params ? `?${params}` : ''}`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refunds"
      );
    }
  }
);

/**
 * Admin: Review refund request (approve/reject)
 */
export const reviewRefund = createAsyncThunk(
  "refund/reviewRefund",
  async ({ orderId, action, adminNote }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/refund/review`,
        { action, adminNote },
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to review refund"
      );
    }
  }
);

/**
 * Admin: Process refund (call payment gateway)
 */
export const processRefund = createAsyncThunk(
  "refund/processRefund",
  async ({ orderId, refundAmount, merchantNote }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/orders/${orderId}/refund/process`,
        { refundAmount, merchantNote },
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to process refund"
      );
    }
  }
);

const refundSlice = createSlice({
  name: "refund",
  initialState: {
    refundStatus: null,
    refunds: [],
    stats: null,
    loading: false,
    error: null,
    success: false,
    message: null,
  },
  reducers: {
    clearRefundState: (state) => {
      state.error = null;
      state.success = false;
      state.message = null;
    },
    resetRefundStatus: (state) => {
      state.refundStatus = null;
    }
  },
  extraReducers: (builder) => {
    // Request Refund
    builder
      .addCase(requestRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(requestRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(requestRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.success = false;
      });

    // Get Refund Status
    builder
      .addCase(getRefundStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getRefundStatus.fulfilled, (state, action) => {
        state.loading = false;
        state.refundStatus = action.payload.refundInfo;
      })
      .addCase(getRefundStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Get All Refunds (Admin)
    builder
      .addCase(getAllRefunds.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getAllRefunds.fulfilled, (state, action) => {
        state.loading = false;
        state.refunds = action.payload.orders;
        state.stats = action.payload.stats;
      })
      .addCase(getAllRefunds.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Review Refund (Admin)
    builder
      .addCase(reviewRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reviewRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(reviewRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Process Refund (Admin)
    builder
      .addCase(processRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(processRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(processRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearRefundState, resetRefundStatus } = refundSlice.actions;
export default refundSlice.reducer;