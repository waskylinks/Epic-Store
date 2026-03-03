// Frontend/src/features/returns/adminReturnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload files to Cloudinary via the admin backend endpoint and return a
 * normalised URL array. Shared internally by sendReturnMessage — not exported.
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
    `/api/v1/admin/returns/${orderId}/upload`,
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
 * Fetch all return requests with pagination and optional status filter.
 *   filters: { page, limit, status }
 */
export const getAllReturns = createAsyncThunk(
  "adminReturn/getAllReturns",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/admin/returns${params ? `?${params}` : ""}`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch returns"
      );
    }
  }
);

/** Fetch full details for a single return (populates messages, documents, timeline). */
export const getSingleReturn = createAsyncThunk(
  "adminReturn/getSingleReturn",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/returns/${orderId}`, {
        withCredentials: true,
      });
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch return details"
      );
    }
  }
);

/** Approve or reject a pending return request. */
export const reviewReturn = createAsyncThunk(
  "adminReturn/reviewReturn",
  async ({ orderId, action, restockFee, adminNote }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/review`,
        { action, restockFee, adminNote },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to review return"
      );
    }
  }
);

/** Update return status (in_transit → received → inspected → completed). */
export const updateReturnStatus = createAsyncThunk(
  "adminReturn/updateReturnStatus",
  async ({ orderId, status, inspectionNotes }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/status`,
        { status, inspectionNotes },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to update return status"
      );
    }
  }
);

/**
 * Send a return message (admin), optionally with file attachments.
 *
 * ─── WHY ONE THUNK ───────────────────────────────────────────────────────────
 * The backend exposes two separate endpoints:
 *   POST /admin/returns/:id/upload    — raw files → Cloudinary URLs
 *   POST /admin/returns/:id/messages  — { content, attachments: URL[] }
 *
 * This thunk owns the full flow behind one flag (messageSendLoading):
 *
 *   Step 1 — upload (skipped when retrying with pendingUrls)
 *   Step 2 — send message with the collected URLs
 *
 * ─── PARTIAL FAILURE / RETRY ─────────────────────────────────────────────────
 * If step 1 fails  → rejectWithValue({ stage:'upload' })
 *   Files never reached Cloudinary — admin re-selects and retries normally.
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
  "adminReturn/sendReturnMessage",
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
        `/api/v1/admin/returns/${orderId}/messages`,
        { content, attachments: attachmentUrls },
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

/**
 * Fetch return messages (paginated).
 *   page 1  → replaces the array (fresh open / re-open)
 *   page 2+ → prepends older messages (load earlier / scroll-up)
 */
export const getReturnMessages = createAsyncThunk(
  "adminReturn/getReturnMessages",
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
  "adminReturn/getReturnTimeline",
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
  "adminReturn/getReturnDocuments",
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
 * Standalone document upload — for the "Upload documents" panel separate from
 * the message thread. For files inside a message use sendReturnMessage instead.
 */
export const uploadReturnFiles = createAsyncThunk(
  "adminReturn/uploadReturnFiles",
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

/**
 * Fetch returns that have unread customer messages.
 * Result is stored in state.unreadReturns — never overwrites state.returns —
 * so a background badge poll cannot silently replace the admin's paginated list.
 */
export const getReturnsWithUnreadMessages = createAsyncThunk(
  "adminReturn/getReturnsWithUnreadMessages",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/returns/unread`, {
        withCredentials: true,
      });
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to fetch unread returns"
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const adminReturnSlice = createSlice({
  name: "adminReturn",
  initialState: {
    returns: [],
    // Unread results are isolated here — a background poll never touches returns
    unreadReturns: [],
    stats: null,
    currentReturn: null,

    messages: [],
    messagesPage: 1,
    hasMoreMessages: false,
    /**
     * Cloudinary URLs saved when upload succeeded but the message send failed.
     * Pass as `pendingUrls` to sendReturnMessage to retry only the send step.
     */
    pendingAttachments: [],

    timeline: [],
    documents: [],

    pagination: {
      totalReturns: 0,
      currentPage: 1,
      totalPages: 1,
    },

    // ── Loading flags ────────────────────────────────────────────────────────
    loading: false,            // getSingleReturn, reviewReturn, updateReturnStatus
    returnsLoading: false,     // getAllReturns
    unreadLoading: false,      // getReturnsWithUnreadMessages
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
    clearAdminReturnState: (state) => {
      state.error = null;
      state.errorStage = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentReturn: (state) => {
      state.currentReturn = null;
      state.messages = [];
      state.messagesPage = 1;
      state.hasMoreMessages = false;
      state.pendingAttachments = [];
      state.timeline = [];
      state.documents = [];
    },
    /** Call on chat panel unmount to prevent stale messages on next open. */
    clearReturnMessages: (state) => {
      state.messages = [];
      state.messagesPage = 1;
      state.hasMoreMessages = false;
      state.pendingAttachments = [];
    },
    /**
     * Call when the admin dismisses a partial-failure error without retrying,
     * so the saved URLs are not silently attached to the next message.
     */
    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage = null;
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    // ── getAllReturns ─────────────────────────────────────────────────────────
    builder
      .addCase(getAllReturns.pending, (state) => {
        state.returnsLoading = true;
        state.error = null;
      })
      .addCase(getAllReturns.fulfilled, (state, { payload }) => {
        state.returnsLoading = false;
        state.returns = payload.returns;
        state.stats = payload.stats;
        state.pagination = {
          totalReturns: payload.totalReturns,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages,
        };
      })
      .addCase(getAllReturns.rejected, (state, { payload }) => {
        state.returnsLoading = false;
        state.error = payload;
      });

    // ── getSingleReturn ──────────────────────────────────────────────────────
    builder
      .addCase(getSingleReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleReturn.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.currentReturn = payload.order;
      })
      .addCase(getSingleReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      });

    // ── reviewReturn ─────────────────────────────────────────────────────────
    builder
      .addCase(reviewReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reviewReturn.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // Dual-shape patch: handles both full order response and returnInfo-only
        // response so this won't silently break if the backend shape changes.
        if (state.currentReturn) {
          if (payload.order) {
            state.currentReturn = payload.order;
          } else if (payload.returnInfo) {
            state.currentReturn = {
              ...state.currentReturn,
              returnInfo: payload.returnInfo,
            };
          }
        }
      })
      .addCase(reviewReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      });

    // ── updateReturnStatus ───────────────────────────────────────────────────
    builder
      .addCase(updateReturnStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateReturnStatus.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        if (state.currentReturn) {
          if (payload.order) {
            state.currentReturn = payload.order;
          } else if (payload.returnInfo) {
            state.currentReturn = {
              ...state.currentReturn,
              returnInfo: payload.returnInfo,
            };
          }
        }
      })
      .addCase(updateReturnStatus.rejected, (state, { payload }) => {
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
        state.pendingAttachments = [];
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
        state.error = payload;
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

    // ── getReturnsWithUnreadMessages ─────────────────────────────────────────
    builder
      .addCase(getReturnsWithUnreadMessages.pending, (state) => {
        state.unreadLoading = true;
        state.error = null;
      })
      .addCase(getReturnsWithUnreadMessages.fulfilled, (state, { payload }) => {
        state.unreadLoading = false;
        // Isolated from state.returns — background poll never corrupts list view
        state.unreadReturns = payload.returns;
      })
      .addCase(getReturnsWithUnreadMessages.rejected, (state, { payload }) => {
        state.unreadLoading = false;
        state.error = payload;
      });
  },
});

export const {
  clearAdminReturnState,
  clearCurrentReturn,
  clearReturnMessages,
  clearPendingAttachments,
} = adminReturnSlice.actions;

export default adminReturnSlice.reducer;