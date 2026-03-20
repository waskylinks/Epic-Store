// features/returns/returnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append("attachments", f));
  const { data } = await axios.post(
    `/api/v1/orders/${orderId}/return/upload`,
    formData,
    { withCredentials: true }
  );
  const receivedAt = new Date().toISOString();
  return (data.files ?? []).map(({ url, filename, fileType, fileSize }) => ({
    url, filename, fileType, fileSize, uploadedAt: receivedAt,
  }));
};

const normaliseDocument = (f) => ({
  url:         f.url,
  filename:    f.filename,
  fileType:    f.fileType,
  fileSize:    f.fileSize,
  type:        f.type        ?? "other",
  description: f.description ?? "",
  uploadedBy:  f.uploadedBy  ?? null,
  uploadedAt:  f.uploadedAt  ?? null,
  mimeType:    f.mimeType    ?? null,
});

const extractErrorMessage = (payload, fallback) => {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") return payload.message ?? fallback;
  return fallback;
};

const isNotFoundError = (payload) =>
  extractErrorMessage(payload, "").toLowerCase().includes("not found");

// ─────────────────────────────────────────────────────────────────────────────
// THUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const requestReturn = createAsyncThunk(
  "return/requestReturn",
  async ({ orderId, returnData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/request`,
        returnData,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to request return");
    }
  }
);

export const getReturnStatus = createAsyncThunk(
  "return/getReturnStatus",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/status`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch return status");
    }
  }
);

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
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to cancel return");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// acceptDecisions
// Customer accepts admin item decisions without dispute.
// Calls POST /orders/:id/return/accept-decisions → status becomes 'approved'.
// Does NOT set success=true — component fires toast.success directly.
// ─────────────────────────────────────────────────────────────────────────────
export const acceptDecisions = createAsyncThunk(
  "return/acceptDecisions",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/accept-decisions`,
        {},
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to accept decisions");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// submitPlea
// Does NOT set success=true on fulfilled — prevents double toast.
// Component fires toast.success directly after unwrap().
// File upload is handled separately (fire-and-forget from component).
// ─────────────────────────────────────────────────────────────────────────────
export const submitPlea = createAsyncThunk(
  "return/submitPlea",
  async ({ orderId, pleaDescription, pleaItems = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/plea`,
        { pleaDescription, pleaItems },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to submit plea");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// confirmShipped
// Customer confirms they have physically shipped items back.
// Calls POST /orders/:id/return/confirm-shipped → status becomes 'in_transit'.
// Sends optional courierName and trackingNumber.
// Does NOT set success=true — component fires toast.success directly.
// ─────────────────────────────────────────────────────────────────────────────
export const confirmShipped = createAsyncThunk(
  "return/confirmShipped",
  async ({ orderId, courierName, trackingNumber }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/confirm-shipped`,
        {
          courierName:    courierName    || undefined,
          trackingNumber: trackingNumber || undefined,
        },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to confirm shipment");
    }
  }
);

export const sendReturnMessage = createAsyncThunk(
  "return/sendReturnMessage",
  async ({ orderId, content, files = [], pendingUrls = [] }, { rejectWithValue }) => {
    let attachmentUrls = [...pendingUrls];

    if (files.length > 0 && pendingUrls.length === 0) {
      try {
        attachmentUrls = await uploadFiles(orderId, files);
      } catch (err) {
        return rejectWithValue({
          stage:       "upload",
          message:     err.response?.data?.message ?? "Failed to upload files",
          pendingUrls: [],
        });
      }
    }

    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/messages`,
        { content, attachments: attachmentUrls },
        { withCredentials: true }
      );
      return { ...data, attachmentUrls };
    } catch (err) {
      return rejectWithValue({
        stage:       "send",
        message:     err.response?.data?.message ?? "Failed to send message",
        pendingUrls: attachmentUrls,
      });
    }
  }
);

export const getReturnMessages = createAsyncThunk(
  "return/getReturnMessages",
  async ({ orderId, page = 1, limit = 50 }, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/messages?page=${page}&limit=${limit}`,
        { withCredentials: true }
      );
      return { ...data, page, limit };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch return messages");
    }
  }
);

export const getReturnTimeline = createAsyncThunk(
  "return/getReturnTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/timeline`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch return timeline");
    }
  }
);

export const getReturnDocuments = createAsyncThunk(
  "return/getReturnDocuments",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/documents`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch return documents");
    }
  }
);

export const uploadReturnFiles = createAsyncThunk(
  "return/uploadReturnFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const uploadedFiles = await uploadFiles(orderId, files);
      return { files: uploadedFiles };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to upload files");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const returnSlice = createSlice({
  name: "return",
  initialState: {
    returnStatus: { status: "none", hasReturn: false },

    pleaDeadline:       null,
    pleaAttempts:       0,
    discountValue:      null,
    acceptanceDeadline: null,

    // Courier and tracking stored locally after confirmShipped so the
    // in_transit panel can display them without a re-fetch
    courierName:    null,
    trackingNumber: null,

    messages:        [],
    messagesPage:    1,
    totalMessages:   0,
    hasMoreMessages: false,

    pendingAttachments: [],

    timeline:  [],
    documents: [],

    loading:                false,
    statusLoading:          false,
    pleaLoading:            false,
    acceptLoading:          false,
    confirmShippedLoading:  false,
    messageSendLoading:     false,
    messagesLoading:        false,
    timelineLoading:        false,
    documentsLoading:       false,
    uploadLoading:          false,

    error:      null,
    errorStage: null,
    pleaError:  null,
    success:    false,
    message:    null,
  },

  reducers: {
    clearReturnState: (state) => {
      state.error      = null;
      state.errorStage = null;
      state.pleaError  = null;
      state.success    = false;
      state.message    = null;
    },

    resetReturnStatus: (state) => {
      state.returnStatus       = { status: "none", hasReturn: false };
      state.pleaDeadline       = null;
      state.pleaAttempts       = 0;
      state.discountValue      = null;
      state.acceptanceDeadline = null;
      state.courierName        = null;
      state.trackingNumber     = null;
    },

    clearReturnMessages: (state) => {
      state.messages           = [];
      state.messagesPage       = 1;
      state.totalMessages      = 0;
      state.hasMoreMessages    = false;
      state.pendingAttachments = [];
      state.error              = null;
      state.errorStage         = null;
      state.messageSendLoading = false;
      state.uploadLoading      = false;
    },

    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage         = null;
      state.error              = null;
    },

    clearPleaError: (state) => {
      state.pleaError   = null;
      state.pleaLoading = false;
    },
  },

  extraReducers: (builder) => {

    // ── requestReturn ────────────────────────────────────────────────────────
    builder
      .addCase(requestReturn.pending, (state) => {
        state.loading = true;
        state.error   = null;
        state.success = false;
      })
      .addCase(requestReturn.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        state.returnStatus = payload.returnInfo
          ? { ...payload.returnInfo, hasReturn: true }
          : { status: "requested", hasReturn: true };
      })
      .addCase(requestReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, "Failed to request return");
        state.success = false;
      });

    // ── getReturnStatus ──────────────────────────────────────────────────────
    builder
      .addCase(getReturnStatus.pending, (state) => {
        state.statusLoading = true;
        state.error         = null;
      })
      .addCase(getReturnStatus.fulfilled, (state, { payload }) => {
        state.statusLoading      = false;
        const ri                 = payload.returnInfo ?? { status: "none", hasReturn: false };
        state.returnStatus       = ri;
        state.pleaDeadline       = ri.pleaDeadline       ?? null;
        state.pleaAttempts       = ri.pleaAttempts       ?? 0;
        state.discountValue      = ri.discountValue      ?? null;
        state.acceptanceDeadline = ri.acceptanceDeadline ?? null;
        // Restore courier/tracking from server if present
        state.courierName        = ri.courierName        ?? state.courierName  ?? null;
        state.trackingNumber     = ri.trackingNumber     ?? state.trackingNumber ?? null;
      })
      .addCase(getReturnStatus.rejected, (state, { payload }) => {
        state.statusLoading = false;
        state.returnStatus  = { status: "none", hasReturn: false };
        if (!isNotFoundError(payload)) {
          state.error = extractErrorMessage(payload, "Failed to fetch return status");
        }
      });

    // ── cancelReturn ─────────────────────────────────────────────────────────
    builder
      .addCase(cancelReturn.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(cancelReturn.fulfilled, (state, { payload }) => {
        state.loading      = false;
        state.success      = true;
        state.message      = payload.message;
        state.returnStatus = { ...state.returnStatus, status: "cancelled", hasReturn: true };
      })
      .addCase(cancelReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, "Failed to cancel return");
      });

    // ── acceptDecisions ───────────────────────────────────────────────────────
    // Does NOT set success=true — component fires toast.success directly.
    builder
      .addCase(acceptDecisions.pending, (state) => {
        state.acceptLoading = true;
        state.error         = null;
      })
      .addCase(acceptDecisions.fulfilled, (state, { payload }) => {
        state.acceptLoading = false;
        const ri = payload.returnInfo
          ? { ...payload.returnInfo, hasReturn: true }
          : { ...state.returnStatus, status: "approved", hasReturn: true };
        state.returnStatus       = ri;
        state.pleaDeadline       = ri.pleaDeadline       ?? null;
        state.pleaAttempts       = ri.pleaAttempts       ?? 0;
        state.discountValue      = ri.discountValue      ?? null;
        state.acceptanceDeadline = ri.acceptanceDeadline ?? null;
      })
      .addCase(acceptDecisions.rejected, (state, { payload }) => {
        state.acceptLoading = false;
        state.error = extractErrorMessage(payload, "Failed to accept decisions");
      });

    // ── submitPlea ───────────────────────────────────────────────────────────
    // Does NOT set success=true — prevents double toast.
    builder
      .addCase(submitPlea.pending, (state) => {
        state.pleaLoading = true;
        state.pleaError   = null;
      })
      .addCase(submitPlea.fulfilled, (state, { payload }) => {
        state.pleaLoading = false;
        const ri = payload.returnInfo
          ? { ...payload.returnInfo, hasReturn: true }
          : state.returnStatus;
        state.returnStatus       = ri;
        state.pleaDeadline       = ri.pleaDeadline       ?? null;
        state.pleaAttempts       = ri.pleaAttempts       ?? 0;
        state.discountValue      = ri.discountValue      ?? null;
        state.acceptanceDeadline = ri.acceptanceDeadline ?? null;
      })
      .addCase(submitPlea.rejected, (state, { payload }) => {
        state.pleaLoading = false;
        state.pleaError   = extractErrorMessage(payload, "Failed to submit plea");
      });

    // ── confirmShipped ────────────────────────────────────────────────────────
    // Customer confirms shipment → status becomes in_transit.
    // Does NOT set success=true — component fires toast.success directly.
    // Stores courierName and trackingNumber locally so the in_transit
    // panel can display them immediately without waiting for a re-fetch.
    builder
      .addCase(confirmShipped.pending, (state) => {
        state.confirmShippedLoading = true;
        state.error                 = null;
      })
      .addCase(confirmShipped.fulfilled, (state, { payload }) => {
        state.confirmShippedLoading = false;
        const ri = payload.returnInfo
          ? { ...payload.returnInfo, hasReturn: true }
          : { ...state.returnStatus, status: "in_transit", hasReturn: true };
        state.returnStatus   = ri;
        // Persist courier and tracking so UI can display them right away
        state.courierName    = ri.courierName    ?? state.courierName    ?? null;
        state.trackingNumber = ri.trackingNumber ?? state.trackingNumber ?? null;
      })
      .addCase(confirmShipped.rejected, (state, { payload }) => {
        state.confirmShippedLoading = false;
        state.error = extractErrorMessage(payload, "Failed to confirm shipment");
      });

    // ── sendReturnMessage ────────────────────────────────────────────────────
    builder
      .addCase(sendReturnMessage.pending, (state) => {
        state.messageSendLoading = true;
        state.error              = null;
        state.errorStage         = null;
      })
      .addCase(sendReturnMessage.fulfilled, (state, { payload }) => {
        state.messageSendLoading = false;
        state.pendingAttachments = [];
        state.errorStage         = null;
        const newMsg = payload?.data?.message ?? null;
        if (newMsg && typeof newMsg === "object") state.messages.push(newMsg);
      })
      .addCase(sendReturnMessage.rejected, (state, { payload }) => {
        state.messageSendLoading = false;
        state.error              = extractErrorMessage(payload, "Failed to send message");
        state.errorStage         = payload?.stage ?? null;
        if (payload?.stage === "send" && payload.pendingUrls?.length) {
          state.pendingAttachments = payload.pendingUrls;
        }
      });

    // ── getReturnMessages ────────────────────────────────────────────────────
    builder
      .addCase(getReturnMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error           = null;
      })
      .addCase(getReturnMessages.fulfilled, (state, { payload }) => {
        state.messagesLoading = false;
        const { messages = [], totalCount, page, limit } = payload;

        const normalised = messages.map((m) =>
          m.senderType === "admin" ? { ...m, isRead: true } : m
        );

        if (page === 1) {
          state.messages = normalised;
        } else {
          state.messages = [...normalised, ...state.messages];
        }

        state.messagesPage    = page;
        state.totalMessages   = totalCount ?? 0;
        state.hasMoreMessages = (page * limit) < (totalCount ?? 0);
      })
      .addCase(getReturnMessages.rejected, (state, { payload }) => {
        state.messagesLoading = false;
        if (!isNotFoundError(payload)) {
          state.error = extractErrorMessage(payload, "Failed to fetch return messages");
        }
      });

    // ── getReturnTimeline ────────────────────────────────────────────────────
    builder
      .addCase(getReturnTimeline.pending,   (state) => { state.timelineLoading = true;  state.error = null; })
      .addCase(getReturnTimeline.fulfilled, (state, { payload }) => {
        state.timelineLoading = false;
        state.timeline        = payload.timeline ?? [];
      })
      .addCase(getReturnTimeline.rejected,  (state, { payload }) => {
        state.timelineLoading = false;
        state.error           = extractErrorMessage(payload, "Failed to fetch return timeline");
      });

    // ── getReturnDocuments ───────────────────────────────────────────────────
    builder
      .addCase(getReturnDocuments.pending,   (state) => { state.documentsLoading = true;  state.error = null; })
      .addCase(getReturnDocuments.fulfilled, (state, { payload }) => {
        state.documentsLoading = false;
        state.documents        = payload.documents ?? [];
      })
      .addCase(getReturnDocuments.rejected,  (state, { payload }) => {
        state.documentsLoading = false;
        state.error            = extractErrorMessage(payload, "Failed to fetch return documents");
      });

    // ── uploadReturnFiles ────────────────────────────────────────────────────
    builder
      .addCase(uploadReturnFiles.pending,   (state) => { state.uploadLoading = true;  state.error = null; })
      .addCase(uploadReturnFiles.fulfilled, (state, { payload }) => {
        state.uploadLoading = false;
        state.documents     = [
          ...state.documents,
          ...(payload.files ?? []).map(normaliseDocument),
        ];
      })
      .addCase(uploadReturnFiles.rejected,  (state, { payload }) => {
        state.uploadLoading = false;
        state.error         = extractErrorMessage(payload, "Failed to upload files");
      });
  },
});

export const {
  clearReturnState,
  resetReturnStatus,
  clearReturnMessages,
  clearPendingAttachments,
  clearPleaError,
} = returnSlice.actions;

export default returnSlice.reducer;