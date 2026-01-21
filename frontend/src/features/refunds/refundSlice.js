// Frontend/src/features/refunds/refundSlice.js

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
    // ✅ FIX: Default to object with status 'none' instead of null
    refundStatus: { status: 'none', hasRefund: false },
    refunds: [],
    stats: null,
    
    // ✅ FIX: Separate loading states
    loading: false,           // For request/review/process
    statusLoading: false,     // For getRefundStatus
    refundsLoading: false,    // For getAllRefunds (admin)
    
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
      // ✅ FIX: Reset to object, not null
      state.refundStatus = { status: 'none', hasRefund: false };
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

    // Get Refund Status - ✅ FIX: Use separate loading state
    builder
      .addCase(getRefundStatus.pending, (state) => {
        state.statusLoading = true;
        state.error = null;
      })
      .addCase(getRefundStatus.fulfilled, (state, action) => {
        state.statusLoading = false;
        // ✅ FIX: Always set to object with hasRefund flag
        state.refundStatus = action.payload.refundInfo || { status: 'none', hasRefund: false };
      })
      .addCase(getRefundStatus.rejected, (state, action) => {
        state.statusLoading = false;
        // ✅ FIX: On error, reset to 'none' instead of keeping null
        state.refundStatus = { status: 'none', hasRefund: false };
        // Don't show error toast for 404s (order has no refund)
        if (!action.payload?.includes('not found')) {
          state.error = action.payload;
        }
      });

    // Get All Refunds (Admin) - ✅ FIX: Use separate loading state
    builder
      .addCase(getAllRefunds.pending, (state) => {
        state.refundsLoading = true;
        state.error = null;
      })
      .addCase(getAllRefunds.fulfilled, (state, action) => {
        state.refundsLoading = false;
        state.refunds = action.payload.orders;
        state.stats = action.payload.stats;
      })
      .addCase(getAllRefunds.rejected, (state, action) => {
        state.refundsLoading = false;
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