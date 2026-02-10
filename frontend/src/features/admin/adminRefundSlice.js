// Frontend/src/features/refunds/adminRefundSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/**
 * Get all refund requests (Admin)
 */
export const getAllRefunds = createAsyncThunk(
  "adminRefund/getAllRefunds",
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
 * Get single refund details (Admin)
 */
export const getSingleRefund = createAsyncThunk(
  "adminRefund/getSingleRefund",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/admin/refunds/${orderId}`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refund details"
      );
    }
  }
);

/**
 * Review refund request (approve/reject)
 */
export const reviewRefund = createAsyncThunk(
  "adminRefund/reviewRefund",
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
 * Process refund payment
 */
export const processRefund = createAsyncThunk(
  "adminRefund/processRefund",
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

/**
 * Add refund message (Admin)
 */
export const addRefundMessage = createAsyncThunk(
  "adminRefund/addRefundMessage",
  async ({ orderId, content, attachments }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/refunds/${orderId}/messages`,
        { content, attachments },
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send message"
      );
    }
  }
);

/**
 * Get refund messages
 */
export const getRefundMessages = createAsyncThunk(
  "adminRefund/getRefundMessages",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/messages`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refund messages"
      );
    }
  }
);

/**
 * Get refund timeline
 */
export const getRefundTimeline = createAsyncThunk(
  "adminRefund/getRefundTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/timeline`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refund timeline"
      );
    }
  }
);

/**
 * Get refund documents
 */
export const getRefundDocuments = createAsyncThunk(
  "adminRefund/getRefundDocuments",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/documents`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refund documents"
      );
    }
  }
);

/**
 * Upload refund files (Admin)
 */
export const uploadRefundFiles = createAsyncThunk(
  "adminRefund/uploadRefundFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('attachments', file));
      
      const { data } = await axios.post(
        `/api/v1/admin/refunds/${orderId}/upload`,
        formData,
        { 
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' }
        }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to upload files"
      );
    }
  }
);

/**
 * Get refunds with unread messages
 */
export const getRefundsWithUnreadMessages = createAsyncThunk(
  "adminRefund/getRefundsWithUnreadMessages",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/admin/refunds/unread`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch unread refunds"
      );
    }
  }
);

const adminRefundSlice = createSlice({
  name: "adminRefund",
  initialState: {
    refunds: [],
    stats: null,
    currentRefund: null,
    messages: [],
    timeline: [],
    documents: [],
    
    loading: false,
    refundsLoading: false,
    messagesLoading: false,
    timelineLoading: false,
    documentsLoading: false,
    uploadLoading: false,
    
    error: null,
    success: false,
    message: null,
  },
  reducers: {
    clearAdminRefundState: (state) => {
      state.error = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentRefund: (state) => {
      state.currentRefund = null;
      state.messages = [];
      state.timeline = [];
      state.documents = [];
    }
  },
  extraReducers: (builder) => {
    // Get All Refunds
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

    // Get Single Refund
    builder
      .addCase(getSingleRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.currentRefund = action.payload.order;
      })
      .addCase(getSingleRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Review Refund
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

    // Process Refund
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

    // Add Refund Message
    builder
      .addCase(addRefundMessage.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addRefundMessage.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.messages.push(action.payload.data.message);
      })
      .addCase(addRefundMessage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Get Refund Messages
    builder
      .addCase(getRefundMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error = null;
      })
      .addCase(getRefundMessages.fulfilled, (state, action) => {
        state.messagesLoading = false;
        state.messages = action.payload.messages;
      })
      .addCase(getRefundMessages.rejected, (state, action) => {
        state.messagesLoading = false;
        state.error = action.payload;
      });

    // Get Refund Timeline
    builder
      .addCase(getRefundTimeline.pending, (state) => {
        state.timelineLoading = true;
        state.error = null;
      })
      .addCase(getRefundTimeline.fulfilled, (state, action) => {
        state.timelineLoading = false;
        state.timeline = action.payload.timeline;
      })
      .addCase(getRefundTimeline.rejected, (state, action) => {
        state.timelineLoading = false;
        state.error = action.payload;
      });

    // Get Refund Documents
    builder
      .addCase(getRefundDocuments.pending, (state) => {
        state.documentsLoading = true;
        state.error = null;
      })
      .addCase(getRefundDocuments.fulfilled, (state, action) => {
        state.documentsLoading = false;
        state.documents = action.payload.documents;
      })
      .addCase(getRefundDocuments.rejected, (state, action) => {
        state.documentsLoading = false;
        state.error = action.payload;
      });

    // Upload Refund Files
    builder
      .addCase(uploadRefundFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error = null;
      })
      .addCase(uploadRefundFiles.fulfilled, (state, action) => {
        state.uploadLoading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(uploadRefundFiles.rejected, (state, action) => {
        state.uploadLoading = false;
        state.error = action.payload;
      });

    // Get Refunds with Unread Messages
    builder
      .addCase(getRefundsWithUnreadMessages.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getRefundsWithUnreadMessages.fulfilled, (state, action) => {
        state.loading = false;
        state.refunds = action.payload.orders;
      })
      .addCase(getRefundsWithUnreadMessages.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearAdminRefundState, clearCurrentRefund } = adminRefundSlice.actions;
export default adminRefundSlice.reducer;