// Frontend/src/features/returns/returnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/**
 * User requests return for their order.
 * Sends `items` — the canonical field name the backend schema and controller expect.
 */
export const requestReturn = createAsyncThunk(
  "return/requestReturn",
  async ({ orderId, returnData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/request`,
        returnData,          // { reason, items, attachments }
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to request return"
      );
    }
  }
);

/**
 * Get return status for an order.
 */
export const getReturnStatus = createAsyncThunk(
  "return/getReturnStatus",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/status`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch return status"
      );
    }
  }
);

/**
 * User cancels return request (before approval)
 */
export const cancelReturn = createAsyncThunk(
  "return/cancelReturn",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/orders/${orderId}/return/cancel`,
        {},
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to cancel return"
      );
    }
  }
);

/**
 * Get return messages
 */
export const getReturnMessages = createAsyncThunk(
  "return/getReturnMessages",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/messages`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch return messages"
      );
    }
  }
);

/**
 * Add return message (customer)
 */
export const addReturnMessage = createAsyncThunk(
  "return/addReturnMessage",
  async ({ orderId, content, attachments }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/messages`,
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
 * Get return timeline
 */
export const getReturnTimeline = createAsyncThunk(
  "return/getReturnTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/timeline`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch return timeline"
      );
    }
  }
);

/**
 * Get return documents
 */
export const getReturnDocuments = createAsyncThunk(
  "return/getReturnDocuments",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/documents`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch return documents"
      );
    }
  }
);

/**
 * Upload return files (customer).
 * Only called AFTER a return already exists (e.g. from the messages modal
 * or as a second step after requestReturn succeeds).
 */
export const uploadReturnFiles = createAsyncThunk(
  "return/uploadReturnFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('attachments', file));

      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/upload`,
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

const returnSlice = createSlice({
  name: "return",
  initialState: {
    returnStatus: { status: 'none', hasReturn: false },
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
    clearReturnState: (state) => {
      state.error = null;
      state.success = false;
      state.message = null;
    },
    resetReturnStatus: (state) => {
      state.returnStatus = { status: 'none', hasReturn: false };
    }
  },
  extraReducers: (builder) => {
    // ── Request Return ──────────────────────────────────────────────────────
    builder
      .addCase(requestReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(requestReturn.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        state.returnStatus = action.payload.returnInfo || { status: 'requested', hasReturn: true };
      })
      .addCase(requestReturn.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.success = false;
      });

    // ── Get Return Status ───────────────────────────────────────────────────
    builder
      .addCase(getReturnStatus.pending, (state) => {
        state.statusLoading = true;
        state.error = null;
      })
      .addCase(getReturnStatus.fulfilled, (state, action) => {
        state.statusLoading = false;
        state.returnStatus = action.payload.returnInfo || { status: 'none', hasReturn: false };
      })
      .addCase(getReturnStatus.rejected, (state, action) => {
        state.statusLoading = false;
        state.returnStatus = { status: 'none', hasReturn: false };
        // Suppress "not found" errors — they just mean no return exists yet
        if (!action.payload?.includes('not found')) {
          state.error = action.payload;
        }
      });

    // ── Cancel Return ───────────────────────────────────────────────────────
    builder
      .addCase(cancelReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(cancelReturn.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        state.returnStatus = { status: 'none', hasReturn: false };
      })
      .addCase(cancelReturn.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Get Return Messages ─────────────────────────────────────────────────
    builder
      .addCase(getReturnMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error = null;
      })
      .addCase(getReturnMessages.fulfilled, (state, action) => {
        state.messagesLoading = false;
        state.messages = action.payload.messages ?? [];
      })
      .addCase(getReturnMessages.rejected, (state, action) => {
        state.messagesLoading = false;
        // Don't surface a generic error when there are simply no messages yet
        if (!action.payload?.includes('not found')) {
          state.error = action.payload;
        }
      });

    // ── Add Return Message (Customer) ───────────────────────────────────────
    // success flag intentionally NOT set — the component shows its own toast
    // and re-fetches messages itself.
    builder
      .addCase(addReturnMessage.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addReturnMessage.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(addReturnMessage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Get Return Timeline ─────────────────────────────────────────────────
    builder
      .addCase(getReturnTimeline.pending, (state) => {
        state.timelineLoading = true;
        state.error = null;
      })
      .addCase(getReturnTimeline.fulfilled, (state, action) => {
        state.timelineLoading = false;
        state.timeline = action.payload.timeline ?? [];
      })
      .addCase(getReturnTimeline.rejected, (state, action) => {
        state.timelineLoading = false;
        state.error = action.payload;
      });

    // ── Get Return Documents ────────────────────────────────────────────────
    builder
      .addCase(getReturnDocuments.pending, (state) => {
        state.documentsLoading = true;
        state.error = null;
      })
      .addCase(getReturnDocuments.fulfilled, (state, action) => {
        state.documentsLoading = false;
        state.documents = action.payload.documents ?? [];
      })
      .addCase(getReturnDocuments.rejected, (state, action) => {
        state.documentsLoading = false;
        state.error = action.payload;
      });

    // ── Upload Return Files ─────────────────────────────────────────────────
    // success flag intentionally NOT set — callers handle their own feedback.
    builder
      .addCase(uploadReturnFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error = null;
      })
      .addCase(uploadReturnFiles.fulfilled, (state) => {
        state.uploadLoading = false;
      })
      .addCase(uploadReturnFiles.rejected, (state, action) => {
        state.uploadLoading = false;
        state.error = action.payload;
      });
  },
});

export const { clearReturnState, resetReturnStatus } = returnSlice.actions;
export default returnSlice.reducer;