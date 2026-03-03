// Frontend/src/features/returns/returnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload files to Cloudinary via the backend and return a normalised URL array.
 * Shared internally by sendReturnMessage — not exported.
 *
 * Do NOT set Content-Type manually on a FormData body. axios injects
 * "multipart/form-data; boundary=…" automatically. A manual header strips the
 * boundary string, causing multer to reject the body on the server.
 *
 * @param {string} orderId
 * @param {File[]} files
 * @returns {Promise<Array<{ url, filename, fileType, fileSize }>>}
 */
const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append("attachments", f));

  const { data } = await axios.post(
    `/api/v1/orders/${orderId}/return/upload`,
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

/**
 * Request a return for a delivered order.
 * Sends `items` — the canonical field name the backend schema expects.
 */
export const requestReturn = createAsyncThunk(
  "return/requestReturn",
  async ({ orderId, returnData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/request`,
        returnData, // { reason, description, items, attachments }
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to request return"
      );
    }
  }
);

/** Fetch return status for a single order. */
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
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch return status"
      );
    }
  }
);

/** Cancel a pending return request (only possible before admin review). */
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
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to cancel return"
      );
    }
  }
);

/**
 * Send a return message, optionally with file attachments.
 *
 * ─── WHY ONE THUNK ───────────────────────────────────────────────────────────
 * The backend exposes two separate endpoints:
 *   POST /orders/:id/return/upload    — raw files → Cloudinary URLs
 *   POST /orders/:id/return/messages  — { content, attachments: URL[] }
 *
 * This thunk owns the full flow behind one flag (messageSendLoading):
 *
 *   Step 1 — upload (skipped when retrying with pendingUrls)
 *   Step 2 — send message with the collected URLs
 *
 * ─── PARTIAL FAILURE / RETRY ─────────────────────────────────────────────────
 * If step 1 fails  → rejectWithValue({ stage:'upload' })
 *   Files never reached Cloudinary — user re-selects and retries normally.
 *
 * If step 2 fails  → rejectWithValue({ stage:'send', pendingUrls:[…] })
 *   Files ARE on Cloudinary. URLs go into state.pendingAttachments.
 *   UI retries with { pendingUrls: state.pendingAttachments } — skips step 1.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *   // text only
 *   dispatch(sendReturnMessage({ orderId, content: 'Hello' }))
 *
 *   // with files
 *   dispatch(sendReturnMessage({ orderId, content: 'See attached', files }))
 *
 *   // retry after partial failure
 *   dispatch(sendReturnMessage({ orderId, content, pendingUrls: pendingAttachments }))
 *
 * NOTE: field name is "content" (return schema) — refund messages use "message".
 */
export const sendReturnMessage = createAsyncThunk(
  "return/sendReturnMessage",
  async (
    { orderId, content, files = [], pendingUrls = [] },
    { rejectWithValue }
  ) => {
    // ── Step 1: upload ───────────────────────────────────────────────────────
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

    // ── Step 2: send ─────────────────────────────────────────────────────────
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/messages`,
        { content, attachments: attachmentUrls },
        { withCredentials: true }
      );
      return { ...data, attachmentUrls };
    } catch (err) {
      return rejectWithValue({
        stage: "send",
        message: err.response?.data?.message ?? "Failed to send message",
        pendingUrls: attachmentUrls, // preserve for retry
      });
    }
  }
);

/**
 * Fetch return messages (paginated).
 *   page 1  → replaces the array (fresh open / re-open)
 *   page 2+ → prepends older messages (load earlier / scroll-up)
 */
export const getReturnMessages = createAsyncThunk(
  "return/getReturnMessages",
  async ({ orderId, page = 1, limit = 50 }, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/messages?page=${page}&limit=${limit}`,
        { withCredentials: true }
      );
      return { ...data, page };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch return messages"
      );
    }
  }
);

/** Fetch the full return activity timeline. */
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
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch return timeline"
      );
    }
  }
);

/** Fetch all documents attached to a return. */
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
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch return documents"
      );
    }
  }
);

/**
 * Standalone document upload — for adding evidence outside the message thread
 * (e.g. an "Add documents" panel on the return detail page).
 * For files inside a message use sendReturnMessage instead.
 */
export const uploadReturnFiles = createAsyncThunk(
  "return/uploadReturnFiles",
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

const returnSlice = createSlice({
  name: "return",
  initialState: {
    returnStatus: { status: "none", hasReturn: false },

    messages: [],
    messagesPage: 1,
    hasMoreMessages: false,
    /**
     * Cloudinary URLs saved when upload succeeded but the message send failed.
     * Pass as `pendingUrls` to sendReturnMessage to retry only the send step
     * without re-uploading.
     */
    pendingAttachments: [],

    timeline: [],
    documents: [],

    // ── Loading flags ────────────────────────────────────────────────────────
    loading: false,            // requestReturn, cancelReturn
    statusLoading: false,      // getReturnStatus
    messageSendLoading: false, // sendReturnMessage (upload + send combined)
    messagesLoading: false,    // getReturnMessages
    timelineLoading: false,
    documentsLoading: false,
    uploadLoading: false,      // standalone uploadReturnFiles

    // ── Error state ──────────────────────────────────────────────────────────
    error: null,
    /**
     * 'upload' | 'send' | null
     * Lets the UI show the right retry prompt without string-matching error.message.
     */
    errorStage: null,

    success: false,
    message: null,
  },

  reducers: {
    clearReturnState: (state) => {
      state.error = null;
      state.errorStage = null;
      state.success = false;
      state.message = null;
    },
    resetReturnStatus: (state) => {
      state.returnStatus = { status: "none", hasReturn: false };
    },
    /** Call on chat panel unmount to prevent stale messages on next open. */
    clearReturnMessages: (state) => {
      state.messages = [];
      state.messagesPage = 1;
      state.hasMoreMessages = false;
      state.pendingAttachments = [];
    },
    /**
     * Call when the user dismisses a partial-failure error without retrying,
     * so the saved URLs are not silently attached to the next message.
     */
    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage = null;
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    // ── requestReturn ────────────────────────────────────────────────────────
    builder
      .addCase(requestReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(requestReturn.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        state.returnStatus = payload.returnInfo ?? {
          status: "requested",
          hasReturn: true,
        };
      })
      .addCase(requestReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
        state.success = false;
      });

    // ── getReturnStatus ──────────────────────────────────────────────────────
    builder
      .addCase(getReturnStatus.pending, (state) => {
        state.statusLoading = true;
        state.error = null;
      })
      .addCase(getReturnStatus.fulfilled, (state, { payload }) => {
        state.statusLoading = false;
        state.returnStatus = payload.returnInfo ?? {
          status: "none",
          hasReturn: false,
        };
      })
      .addCase(getReturnStatus.rejected, (state, { payload }) => {
        state.statusLoading = false;
        state.returnStatus = { status: "none", hasReturn: false };
        if (!payload?.includes?.("not found")) state.error = payload;
      });

    // ── cancelReturn ─────────────────────────────────────────────────────────
    builder
      .addCase(cancelReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(cancelReturn.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // Backend sets status → 'cancelled' (not 'none') so the record stays
        // visible in admin history. hasReturn: true keeps the thread accessible.
        state.returnStatus = { status: "cancelled", hasReturn: true };
      })
      .addCase(cancelReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      });

    // ── sendReturnMessage ────────────────────────────────────────────────────
    builder
      .addCase(sendReturnMessage.pending, (state) => {
        state.messageSendLoading = true;
        state.error = null;
        state.errorStage = null;
      })
      .addCase(sendReturnMessage.fulfilled, (state, { payload }) => {
        state.messageSendLoading = false;
        state.pendingAttachments = []; // both steps done — nothing to retry
        const newMsg = payload?.data?.message;
        if (newMsg) state.messages.push(newMsg);
      })
      .addCase(sendReturnMessage.rejected, (state, { payload }) => {
        state.messageSendLoading = false;
        state.error = payload?.message ?? "Failed to send message";
        state.errorStage = payload?.stage ?? null;
        if (payload?.stage === "send" && payload.pendingUrls?.length) {
          state.pendingAttachments = payload.pendingUrls;
        }
      });

    // ── getReturnMessages ────────────────────────────────────────────────────
    builder
      .addCase(getReturnMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error = null;
      })
      .addCase(getReturnMessages.fulfilled, (state, { payload }) => {
        state.messagesLoading = false;
        const { messages = [], count, page } = payload;
        if (page === 1) {
          state.messages = messages;
        } else {
          state.messages = [...messages, ...state.messages];
        }
        state.messagesPage = page;
        state.hasMoreMessages = count === 50;
      })
      .addCase(getReturnMessages.rejected, (state, { payload }) => {
        state.messagesLoading = false;
        if (!payload?.includes?.("not found")) state.error = payload;
      });

    // ── getReturnTimeline ────────────────────────────────────────────────────
    builder
      .addCase(getReturnTimeline.pending, (state) => {
        state.timelineLoading = true;
        state.error = null;
      })
      .addCase(getReturnTimeline.fulfilled, (state, { payload }) => {
        state.timelineLoading = false;
        state.timeline = payload.timeline ?? [];
      })
      .addCase(getReturnTimeline.rejected, (state, { payload }) => {
        state.timelineLoading = false;
        state.error = payload;
      });

    // ── getReturnDocuments ───────────────────────────────────────────────────
    builder
      .addCase(getReturnDocuments.pending, (state) => {
        state.documentsLoading = true;
        state.error = null;
      })
      .addCase(getReturnDocuments.fulfilled, (state, { payload }) => {
        state.documentsLoading = false;
        state.documents = payload.documents ?? [];
      })
      .addCase(getReturnDocuments.rejected, (state, { payload }) => {
        state.documentsLoading = false;
        state.error = payload;
      });

    // ── uploadReturnFiles (standalone) ───────────────────────────────────────
    builder
      .addCase(uploadReturnFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error = null;
      })
      .addCase(uploadReturnFiles.fulfilled, (state) => {
        state.uploadLoading = false;
        state.success = true;
      })
      .addCase(uploadReturnFiles.rejected, (state, { payload }) => {
        state.uploadLoading = false;
        state.error = payload;
      });
  },
});

export const {
  clearReturnState,
  resetReturnStatus,
  clearReturnMessages,
  clearPendingAttachments,
} = returnSlice.actions;

export default returnSlice.reducer;