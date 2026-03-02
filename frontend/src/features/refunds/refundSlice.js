// Frontend/src/features/refunds/refundSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/**
 * User requests refund for their order
 * Files are now sent as multipart/form-data together with refund data
 * to avoid the upload-before-refund-exists race condition.
 */
export const requestRefund = createAsyncThunk(
  "refund/requestRefund",
  async ({ orderId, refundData, files = [] }, { rejectWithValue }) => {
    try {
      let payload;

      if (files.length > 0) {
        // Send as multipart so backend can persist files atomically with the refund.
        // IMPORTANT: do NOT manually set Content-Type here. When the body is a
        // FormData instance, axios sets Content-Type: multipart/form-data AND
        // appends the correct boundary automatically. Setting it manually strips
        // the boundary, causing the server's multer parser to reject the body and
        // the request to never resolve — which permanently locks loading=true.
        const formData = new FormData();
        formData.append("reason", refundData.reason);
        formData.append("description", refundData.description);
        formData.append("refundType", refundData.refundType);
        if (refundData.requestedAmount !== undefined) {
          formData.append("requestedAmount", String(refundData.requestedAmount));
        }
        files.forEach((file) => formData.append("attachments", file));
        payload = formData;
      } else {
        payload = refundData;
      }

      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/refund/request`,
        payload,
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
 * Cancel refund request (before approval)
 */
export const cancelRefund = createAsyncThunk(
  "refund/cancelRefund",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/orders/${orderId}/refund/cancel`,
        {},
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to cancel refund"
      );
    }
  }
);

/**
 * Add refund message (customer)
 * Field name corrected: backend expects "message", not "content"
 */
export const addRefundMessage = createAsyncThunk(
  "refund/addRefundMessage",
  async ({ orderId, message, attachments }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/refund/messages`,
        { message, attachments },
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
  "refund/getRefundMessages",
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
  "refund/getRefundTimeline",
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
  "refund/getRefundDocuments",
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
 * Upload refund files (customer) — kept for post-submission follow-up uploads
 * (e.g. attaching more evidence after the refund is already created).
 * Do NOT call this before requestRefund.
 */
export const uploadRefundFiles = createAsyncThunk(
  "refund/uploadRefundFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("attachments", file));

      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/refund/upload`,
        formData,
        {
          withCredentials: true,
          // Do NOT set Content-Type manually — axios sets multipart/form-data
          // with the correct boundary automatically when body is FormData.
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

const refundSlice = createSlice({
  name: "refund",
  initialState: {
    refundStatus: { status: "none", hasRefund: false },
    messages: [],
    timeline: [],
    documents: [],

    loading: false,
    statusLoading: false,
    messagesLoading: false,
    timelineLoading: false,
    documentsLoading: false,
    uploadLoading: false,

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
      state.refundStatus = { status: "none", hasRefund: false };
    },
  },
  extraReducers: (builder) => {
    // ── Request Refund ──────────────────────────────────────────────────────
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
        state.refundStatus = action.payload.refundInfo || {
          status: "requested",
          hasRefund: true,
        };
      })
      .addCase(requestRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.success = false;
      });

    // ── Get Refund Status ───────────────────────────────────────────────────
    builder
      .addCase(getRefundStatus.pending, (state) => {
        state.statusLoading = true;
        state.error = null;
      })
      .addCase(getRefundStatus.fulfilled, (state, action) => {
        state.statusLoading = false;
        state.refundStatus = action.payload.refundInfo || {
          status: "none",
          hasRefund: false,
        };
      })
      .addCase(getRefundStatus.rejected, (state, action) => {
        state.statusLoading = false;
        state.refundStatus = { status: "none", hasRefund: false };
        if (!action.payload?.includes("not found")) {
          state.error = action.payload;
        }
      });

    // ── Cancel Refund ───────────────────────────────────────────────────────
    builder
      .addCase(cancelRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(cancelRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        state.refundStatus = { status: "cancelled", hasRefund: false };
      })
      .addCase(cancelRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Add Refund Message ──────────────────────────────────────────────────
    builder
      .addCase(addRefundMessage.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addRefundMessage.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        // Fix: payload structure is { data: { message: {...} } }
        const newMsg = action.payload?.data?.message;
        if (newMsg) {
          state.messages.push(newMsg);
        }
      })
      .addCase(addRefundMessage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Get Refund Messages ─────────────────────────────────────────────────
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

    // ── Get Refund Timeline ─────────────────────────────────────────────────
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

    // ── Get Refund Documents ────────────────────────────────────────────────
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

    // ── Upload Refund Files ─────────────────────────────────────────────────
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
  },
});

export const { clearRefundState, resetRefundStatus } = refundSlice.actions;
export default refundSlice.reducer;