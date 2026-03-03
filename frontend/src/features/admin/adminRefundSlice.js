// Frontend/src/features/admin/adminRefundSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append("attachments", f));

  const { data } = await axios.post(
    `/api/v1/admin/refunds/${orderId}/upload`,
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

export const getAllRefunds = createAsyncThunk(
  "adminRefund/getAllRefunds",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/admin/refunds${params ? `?${params}` : ""}`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refunds"
      );
    }
  }
);

export const getSingleRefund = createAsyncThunk(
  "adminRefund/getSingleRefund",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/refunds/${orderId}`, {
        withCredentials: true,
      });
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refund details"
      );
    }
  }
);

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
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to review refund"
      );
    }
  }
);

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
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to process refund"
      );
    }
  }
);

export const sendRefundMessage = createAsyncThunk(
  "adminRefund/sendRefundMessage",
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
        `/api/v1/admin/refunds/${orderId}/messages`,
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

export const getRefundMessages = createAsyncThunk(
  "adminRefund/getRefundMessages",
  async ({ orderId, page = 1, limit = 50 }, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/refund/messages?page=${page}&limit=${limit}`,
        { withCredentials: true }
      );
      return { ...data, page, limit };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch refund messages"
      );
    }
  }
);

export const getRefundTimeline = createAsyncThunk(
  "adminRefund/getRefundTimeline",
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
  "adminRefund/getRefundDocuments",
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
  "adminRefund/uploadRefundFiles",
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

export const getRefundsWithUnreadMessages = createAsyncThunk(
  "adminRefund/getRefundsWithUnreadMessages",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/refunds/unread`, {
        withCredentials: true,
      });
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch unread refunds"
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const adminRefundSlice = createSlice({
  name: "adminRefund",
  initialState: {
    refunds: [],
    unreadRefunds: [],
    stats: null,
    currentRefund: null,

    messages: [],
    messagesPage: 1,
    hasMoreMessages: false,
    pendingAttachments: [],

    timeline: [],
    documents: [],

    pagination: {
      totalRefunds: 0,
      currentPage: 1,
      totalPages: 1,
    },

    loading: false,
    refundsLoading: false,
    unreadLoading: false,
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
    clearAdminRefundState: (state) => {
      state.error = null;
      state.errorStage = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentRefund: (state) => {
      state.currentRefund = null;
      state.messages = [];
      state.messagesPage = 1;
      state.hasMoreMessages = false;
      state.pendingAttachments = [];
      state.timeline = [];
      state.documents = [];
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
    // ── getAllRefunds ─────────────────────────────────────────────────────────
    builder
      .addCase(getAllRefunds.pending, (state) => {
        state.refundsLoading = true;
        state.error = null;
      })
      .addCase(getAllRefunds.fulfilled, (state, { payload }) => {
        state.refundsLoading = false;
        state.refunds = payload.orders;
        state.stats = payload.stats;
        state.pagination = {
          totalRefunds: payload.totalRefunds,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages,
        };
      })
      .addCase(getAllRefunds.rejected, (state, { payload }) => {
        state.refundsLoading = false;
        state.error = payload;
      });

    // ── getSingleRefund ──────────────────────────────────────────────────────
    builder
      .addCase(getSingleRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleRefund.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.currentRefund = payload.order;
      })
      .addCase(getSingleRefund.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      });

    // ── reviewRefund ─────────────────────────────────────────────────────────
    builder
      .addCase(reviewRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reviewRefund.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // FIX 2: targeted merge — safeRefundResponse strips paymentInfo down to
        // {method, currency} and omits refundInfo.messages/documents/requestedBy.
        // A shallow spread ({ ...currentRefund, ...payload.order }) would
        // overwrite paymentInfo and refundInfo wholesale, destroying those fields.
        // Instead: preserve everything on currentRefund, update only orderStatus
        // and refundableAmount at the top level, and deep-merge refundInfo so
        // the new status/timestamps land without evicting messages or documents.
        if (payload.order) {
          state.currentRefund = {
            ...state.currentRefund,
            orderStatus: payload.order.orderStatus,
            refundableAmount: payload.order.refundableAmount,
            refundInfo: {
              ...state.currentRefund?.refundInfo,
              ...payload.order.refundInfo,
            },
          };
        }
      })
      .addCase(reviewRefund.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      });

    // ── processRefund ────────────────────────────────────────────────────────
    builder
      .addCase(processRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(processRefund.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // FIX 2: same targeted merge as reviewRefund — safeRefundResponse
        // paymentInfo is stripped, refundInfo.messages/documents are absent.
        // Shallow spread would silently destroy those fields on currentRefund.
        if (payload.order) {
          state.currentRefund = {
            ...state.currentRefund,
            orderStatus: payload.order.orderStatus,
            refundableAmount: payload.order.refundableAmount,
            refundInfo: {
              ...state.currentRefund?.refundInfo,
              ...payload.order.refundInfo,
            },
          };
        }
      })
      .addCase(processRefund.rejected, (state, { payload }) => {
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

    // ── getRefundsWithUnreadMessages ─────────────────────────────────────────
    builder
      .addCase(getRefundsWithUnreadMessages.pending, (state) => {
        state.unreadLoading = true;
        state.error = null;
      })
      .addCase(getRefundsWithUnreadMessages.fulfilled, (state, { payload }) => {
        state.unreadLoading = false;
        // FIX 5: guard against undefined if payload.orders is missing
        state.unreadRefunds = payload.orders ?? [];
      })
      .addCase(getRefundsWithUnreadMessages.rejected, (state, { payload }) => {
        state.unreadLoading = false;
        state.error = payload;
      });
  },
});

export const {
  clearAdminRefundState,
  clearCurrentRefund,
  clearRefundMessages,
  clearPendingAttachments,
} = adminRefundSlice.actions;

export default adminRefundSlice.reducer;