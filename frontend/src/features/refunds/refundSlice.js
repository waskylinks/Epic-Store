// Frontend/src/features/refunds/refundSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append("attachments", f));

  const { data } = await axios.post(
    `/api/v1/orders/${orderId}/refund/upload`,
    formData,
    { withCredentials: true }
  );

  return (data.files ?? []).map(({ url, filename, fileType, fileSize }) => ({
    url,
    filename,
    fileType,
    fileSize,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// THUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const requestRefund = createAsyncThunk(
  "refund/requestRefund",
  async ({ orderId, refundData, files = [] }, { rejectWithValue }) => {
    try {
      let payload;

      if (files.length > 0) {
        const formData = new FormData();
        formData.append("reason", refundData.reason);
        formData.append("description", refundData.description);
        formData.append("refundType", refundData.refundType);
        if (refundData.requestedAmount !== undefined) {
          formData.append("requestedAmount", String(refundData.requestedAmount));
        }
        files.forEach((f) => formData.append("attachments", f));
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
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to request refund"
      );
    }
  }
);

export const getRefundStatus = createAsyncThunk(
  "refund/getRefundStatus",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/status`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refund status"
      );
    }
  }
);

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
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to cancel refund"
      );
    }
  }
);

export const sendRefundMessage = createAsyncThunk(
  "refund/sendRefundMessage",
  async (
    { orderId, message, files = [], pendingUrls = [] },
    { rejectWithValue }
  ) => {
    let attachmentUrls = [...pendingUrls];

    if (files.length > 0 && pendingUrls.length === 0) {
      try {
        attachmentUrls = await uploadFiles(orderId, files);
      } catch (err) {
        return rejectWithValue({
          stage: "upload",
          message: err.response?.data?.message ?? "Failed to upload files",
          pendingUrls: [],
        });
      }
    }

    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/refund/messages`,
        { message, attachments: attachmentUrls },
        { withCredentials: true }
      );
      return { ...data, attachmentUrls };
    } catch (err) {
      return rejectWithValue({
        stage: "send",
        message: err.response?.data?.message ?? "Failed to send message",
        pendingUrls: attachmentUrls,
      });
    }
  }
);

// FIX 1: forward `limit` in return value so hasMoreMessages comparison
// is not hardcoded against 50.
export const getRefundMessages = createAsyncThunk(
  "refund/getRefundMessages",
  async ({ orderId, page = 1, limit = 50 }, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/messages?page=${page}&limit=${limit}`,
        { withCredentials: true }
      );
      // FIX 1: include limit in return so fulfilled handler can compare against it
      return { ...data, page, limit };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refund messages"
      );
    }
  }
);

export const getRefundTimeline = createAsyncThunk(
  "refund/getRefundTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/timeline`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refund timeline"
      );
    }
  }
);

export const getRefundDocuments = createAsyncThunk(
  "refund/getRefundDocuments",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/documents`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refund documents"
      );
    }
  }
);

export const uploadRefundFiles = createAsyncThunk(
  "refund/uploadRefundFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const urls = await uploadFiles(orderId, files);
      return { files: urls };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to upload files"
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const refundSlice = createSlice({
  name: "refund",
  initialState: {
    refundStatus: { status: "none", hasRefund: false },

    messages: [],
    messagesPage: 1,
    hasMoreMessages: false,
    pendingAttachments: [],

    timeline: [],
    documents: [],

    loading: false,
    statusLoading: false,
    messageSendLoading: false,
    messagesLoading: false,
    timelineLoading: false,
    documentsLoading: false,
    uploadLoading: false,

    error: null,
    errorStage: null,

    success: false,
    message: null,
  },

  reducers: {
    clearRefundState: (state) => {
      state.error = null;
      state.errorStage = null;
      state.success = false;
      state.message = null;
    },
    resetRefundStatus: (state) => {
      state.refundStatus = { status: "none", hasRefund: false };
    },
    clearRefundMessages: (state) => {
      state.messages = [];
      state.messagesPage = 1;
      state.hasMoreMessages = false;
      state.pendingAttachments = [];
    },
    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage = null;
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    // ── requestRefund ────────────────────────────────────────────────────────
    builder
      .addCase(requestRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(requestRefund.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        state.refundStatus = payload.refundInfo ?? {
          status: "requested",
          hasRefund: true,
        };
      })
      .addCase(requestRefund.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
        state.success = false;
      });

    // ── getRefundStatus ──────────────────────────────────────────────────────
    builder
      .addCase(getRefundStatus.pending, (state) => {
        state.statusLoading = true;
        state.error = null;
      })
      .addCase(getRefundStatus.fulfilled, (state, { payload }) => {
        state.statusLoading = false;
        state.refundStatus = payload.refundInfo ?? {
          status: "none",
          hasRefund: false,
        };
      })
      .addCase(getRefundStatus.rejected, (state, { payload }) => {
        state.statusLoading = false;
        state.refundStatus = { status: "none", hasRefund: false };
        if (!payload?.includes?.("not found")) state.error = payload;
      });

    // ── cancelRefund ─────────────────────────────────────────────────────────
    builder
      .addCase(cancelRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(cancelRefund.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        state.refundStatus = { status: "cancelled", hasRefund: true };
      })
      .addCase(cancelRefund.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      });

    // ── sendRefundMessage ────────────────────────────────────────────────────
    builder
      .addCase(sendRefundMessage.pending, (state) => {
        state.messageSendLoading = true;
        state.error = null;
        state.errorStage = null;
      })
      .addCase(sendRefundMessage.fulfilled, (state, { payload }) => {
        state.messageSendLoading = false;
        state.pendingAttachments = [];
        const newMsg = payload?.data?.message;
        if (newMsg) state.messages.push(newMsg);
      })
      .addCase(sendRefundMessage.rejected, (state, { payload }) => {
        state.messageSendLoading = false;
        state.error = payload?.message ?? "Failed to send message";
        state.errorStage = payload?.stage ?? null;
        if (payload?.stage === "send" && payload.pendingUrls?.length) {
          state.pendingAttachments = payload.pendingUrls;
        }
      });

    // ── getRefundMessages ────────────────────────────────────────────────────
    builder
      .addCase(getRefundMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error = null;
      })
      .addCase(getRefundMessages.fulfilled, (state, { payload }) => {
        state.messagesLoading = false;
        // FIX 1: use limit from payload, not hardcoded 50
        const { messages = [], page, limit } = payload;
        if (page === 1) {
          state.messages = messages;
        } else {
          state.messages = [...messages, ...state.messages];
        }
        state.messagesPage = page;
        state.hasMoreMessages = messages.length === limit;
      })
      .addCase(getRefundMessages.rejected, (state, { payload }) => {
        state.messagesLoading = false;
        if (!payload?.includes?.("not found")) state.error = payload;
      });

    // ── getRefundTimeline ────────────────────────────────────────────────────
    builder
      .addCase(getRefundTimeline.pending, (state) => {
        state.timelineLoading = true;
        state.error = null;
      })
      .addCase(getRefundTimeline.fulfilled, (state, { payload }) => {
        state.timelineLoading = false;
        state.timeline = payload.timeline ?? [];
      })
      .addCase(getRefundTimeline.rejected, (state, { payload }) => {
        state.timelineLoading = false;
        state.error = payload;
      });

    // ── getRefundDocuments ───────────────────────────────────────────────────
    builder
      .addCase(getRefundDocuments.pending, (state) => {
        state.documentsLoading = true;
        state.error = null;
      })
      .addCase(getRefundDocuments.fulfilled, (state, { payload }) => {
        state.documentsLoading = false;
        state.documents = payload.documents ?? [];
      })
      .addCase(getRefundDocuments.rejected, (state, { payload }) => {
        state.documentsLoading = false;
        state.error = payload;
      });

    // ── uploadRefundFiles (standalone) ───────────────────────────────────────
    builder
      .addCase(uploadRefundFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error = null;
      })
      .addCase(uploadRefundFiles.fulfilled, (state) => {
        state.uploadLoading = false;
        state.success = true;
      })
      .addCase(uploadRefundFiles.rejected, (state, { payload }) => {
        state.uploadLoading = false;
        state.error = payload;
      });
  },
});

export const {
  clearRefundState,
  resetRefundStatus,
  clearRefundMessages,
  clearPendingAttachments,
} = refundSlice.actions;

export default refundSlice.reducer;