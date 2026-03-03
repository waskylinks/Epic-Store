// Frontend/src/features/returns/returnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * uploadFiles
 * Upload files to Cloudinary via the CUSTOMER backend route and return a
 * normalised URL array. Shared internally by sendReturnMessage — not exported.
 *
 * WARNING: This helper is intentionally scoped to the customer upload route
 * (/api/v1/orders/:id/return/upload). Do NOT reuse it for admin uploads —
 * the admin route is /api/v1/admin/returns/:id/upload and is handled
 * separately in the admin slice. Mixing the two will produce 403 errors
 * because each route is guarded by role-specific middleware.
 *
 * Do NOT set Content-Type manually on a FormData body. axios injects
 * "multipart/form-data; boundary=…" automatically. A manual header strips the
 * boundary string, causing multer to reject the body on the server.
 *
 * @param {string} orderId
 * @param {File[]} files
 * @returns {Promise<Array<{ url, filename, fileType, fileSize, uploadedAt }>>}
 */
const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append("attachments", f));

  const { data } = await axios.post(
    `/api/v1/orders/${orderId}/return/upload`,
    formData,
    { withCredentials: true }
  );

  // FIX XS-1 / CS-7 — uploadedAt is stamped HERE in the thunk (async context),
  // not inside the Immer reducer. Reducers must be pure and deterministic;
  // calling new Date() inside a reducer breaks time-travel debugging.
  const receivedAt = new Date().toISOString();
  return (data.files ?? []).map(({ url, filename, fileType, fileSize }) => ({
    url,
    filename,
    fileType,
    fileSize,
    uploadedAt: receivedAt,
  }));
};

/**
 * normaliseDocument
 * Converts a raw upload-response file entry to the full document shape that
 * getReturnDocuments returns, filling in safe defaults for absent fields.
 * Centralised here so both thunks (uploadReturnFiles, sendReturnMessage)
 * produce a consistent shape in state.documents.
 *
 * Backend document shape (from getReturnDocuments):
 *   { type, url, filename, description, uploadedBy, uploadedAt, fileSize, mimeType }
 * Upload response shape:
 *   { url, filename, fileType, fileSize, uploadedAt }   ← uploadedAt added by uploadFiles()
 *
 * @param {object} f — raw file entry from uploadFiles()
 * @returns {object} — normalised document
 */
const normaliseDocument = (f) => ({
  url:         f.url,
  filename:    f.filename,
  fileType:    f.fileType,
  fileSize:    f.fileSize,
  // `type` maps to backend enum ['photo','video','receipt','other'] — default 'other'
  type:        f.type        ?? "other",
  description: f.description ?? "",
  uploadedBy:  f.uploadedBy  ?? null,
  // uploadedAt already stamped in thunk — no Date construction in reducer
  uploadedAt:  f.uploadedAt  ?? null,
  mimeType:    f.mimeType    ?? null,
});

/**
 * extractErrorMessage
 * Safely extracts a string message from any error payload shape.
 * Guards against the backend ever changing from a plain string to an object.
 *
 * FIX CS-6 (prev FIX #6) — replaces fragile payload?.includes?.() pattern.
 *
 * @param {unknown} payload
 * @param {string}  fallback
 * @returns {string}
 */
const extractErrorMessage = (payload, fallback) => {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") return payload.message ?? fallback;
  return fallback;
};

/**
 * isNotFoundError
 * Returns true when the error payload indicates a 404-style "not found"
 * condition that should be swallowed rather than surfaced to the user.
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
const isNotFoundError = (payload) =>
  extractErrorMessage(payload, "").toLowerCase().includes("not found");

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
 *   Step 1 — upload (skipped when retrying with pendingUrls)
 *   Step 2 — send message with the collected URLs
 *
 * ─── PARTIAL FAILURE / RETRY ─────────────────────────────────────────────────
 * Step 1 fails → rejectWithValue({ stage:'upload' })
 *   Files never reached Cloudinary — user re-selects and retries normally.
 *
 * Step 2 fails → rejectWithValue({ stage:'send', pendingUrls:[…] })
 *   Files ARE on Cloudinary. URLs go into state.pendingAttachments.
 *   UI retries with { pendingUrls: state.pendingAttachments } — skips step 1.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *   dispatch(sendReturnMessage({ orderId, content: 'Hello' }))
 *   dispatch(sendReturnMessage({ orderId, content: 'See pic', files }))
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
    // Skip when caller passes pendingUrls (retry path after step-2 failure).
    // The UI MUST call clearPendingAttachments() if the user clears their file
    // selection mid-compose — otherwise stale URLs will silently attach.
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
        pendingUrls: attachmentUrls,
      });
    }
  }
);

/**
 * Fetch return messages (paginated).
 *   page 1  → replaces the array (fresh open / re-open)
 *   page 2+ → prepends older messages (load earlier / scroll-up)
 *
 * FIX CS-1 — limit is bubbled back so the reducer compares count === limit
 * instead of the hardcoded 50, making hasMoreMessages correct for any limit.
 */
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
 * Standalone document upload — for adding evidence outside the message thread.
 * For files inside a message use sendReturnMessage instead.
 *
 * FIX CS-7 (prev #7) — uploadedAt timestamp computed in uploadFiles() (thunk),
 * not in the reducer, keeping the reducer pure and deterministic.
 * FIX CS-8 (prev #7b) — normaliseDocument() ensures consistent shape in
 * state.documents regardless of which code path populated the entry.
 */
export const uploadReturnFiles = createAsyncThunk(
  "return/uploadReturnFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const uploadedFiles = await uploadFiles(orderId, files);
      return { files: uploadedFiles };
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
    // FIX CS-8 (prev #8) — totalMessages stores backend totalCount so the UI
    // can display "Load N earlier messages" without an extra round-trip.
    totalMessages: 0,
    hasMoreMessages: false,

    /**
     * Cloudinary URLs saved when upload succeeded but the message send failed.
     * Pass as `pendingUrls` to sendReturnMessage to retry only the send step.
     *
     * IMPORTANT: The UI must call clearPendingAttachments() if the user removes
     * their selected files before composing a new message — otherwise stale
     * Cloudinary URLs will silently attach to the next send.
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

    // ── Error / result state ─────────────────────────────────────────────────
    error: null,
    /**
     * 'upload' | 'send' | null
     * Lets the UI show the correct retry prompt without string-matching error.
     */
    errorStage: null,
    success: false,
    message: null,
  },

  reducers: {
    clearReturnState: (state) => {
      state.error      = null;
      state.errorStage = null;
      state.success    = false;
      state.message    = null;
    },

    resetReturnStatus: (state) => {
      state.returnStatus = { status: "none", hasReturn: false };
    },

    /**
     * Call on chat panel unmount to prevent stale messages on next open.
     *
     * FIX CS-4 — also clears error and errorStage so that a panel which
     * closed mid-error does not re-open showing a stale error state.
     */
    clearReturnMessages: (state) => {
      state.messages          = [];
      state.messagesPage      = 1;
      state.totalMessages     = 0;
      state.hasMoreMessages   = false;
      state.pendingAttachments = [];
      // FIX CS-4: error/errorStage were NOT cleared previously, causing stale
      // error banners to appear on re-open before any action was taken.
      state.error      = null;
      state.errorStage = null;
    },

    /**
     * Call when the user dismisses a partial-failure error without retrying,
     * or when the user clears their file selection mid-compose so stale
     * Cloudinary URLs from a prior failed send are not silently re-attached.
     */
    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage         = null;
      state.error              = null;
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
        // FIX CS-3 (prev #3) — backend returns raw Mongoose subdocument which
        // never contains the hasReturn virtual. Merge it explicitly so components
        // gating on returnStatus.hasReturn work immediately after submission
        // without a follow-up getReturnStatus call.
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
        state.statusLoading = false;
        // Backend getReturnStatus controller injects hasReturn directly into
        // the returnInfo object before sending — safe to assign directly.
        state.returnStatus = payload.returnInfo ?? { status: "none", hasReturn: false };
      })
      .addCase(getReturnStatus.rejected, (state, { payload }) => {
        state.statusLoading = false;
        state.returnStatus  = { status: "none", hasReturn: false };
        // Swallow "not found" — means no return exists for this order, which is
        // a valid normal state (not an error worth surfacing to the user).
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
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // FIX CS-4 (prev #4) — backend returns only { success, message } with
        // no returnInfo. Spread over existing shape to preserve reason,
        // rmaNumber, requestedAt etc. A wholesale replacement would blank any
        // component that reads those fields.
        state.returnStatus = {
          ...state.returnStatus,
          status:    "cancelled",
          hasReturn: true,
        };
      })
      .addCase(cancelReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, "Failed to cancel return");
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
        // FIX CS-5 (prev #5) — errorStage was only cleared in pending. A prior
        // stage:"send" failure left errorStage="send" visible after a successful
        // retry. Clear explicitly here so the retry prompt disappears on success.
        state.errorStage = null;
        const newMsg = payload?.data?.message;
        if (newMsg) state.messages.push(newMsg);
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
        const { messages = [], count, totalCount, page, limit } = payload;
        if (page === 1) {
          state.messages = messages;
        } else {
          // Prepend older pages — load-earlier / scroll-up pattern.
          state.messages = [...messages, ...state.messages];
        }
        state.messagesPage  = page;
        // FIX CS-8 (prev #8) — store backend totalCount for "N messages remaining" UI.
        state.totalMessages = totalCount ?? 0;
        // FIX CS-1 (prev #1) — compare against the actual limit used, not
        // hardcoded 50. Any caller-supplied limit now works correctly.
        state.hasMoreMessages = count === (limit ?? 50);
      })
      .addCase(getReturnMessages.rejected, (state, { payload }) => {
        state.messagesLoading = false;
        if (!isNotFoundError(payload)) {
          state.error = extractErrorMessage(payload, "Failed to fetch return messages");
        }
      });

    // ── getReturnTimeline ────────────────────────────────────────────────────
    builder
      .addCase(getReturnTimeline.pending, (state) => {
        state.timelineLoading = true;
        state.error           = null;
      })
      .addCase(getReturnTimeline.fulfilled, (state, { payload }) => {
        state.timelineLoading = false;
        state.timeline        = payload.timeline ?? [];
      })
      .addCase(getReturnTimeline.rejected, (state, { payload }) => {
        state.timelineLoading = false;
        state.error           = extractErrorMessage(payload, "Failed to fetch return timeline");
      });

    // ── getReturnDocuments ───────────────────────────────────────────────────
    builder
      .addCase(getReturnDocuments.pending, (state) => {
        state.documentsLoading = true;
        state.error            = null;
      })
      .addCase(getReturnDocuments.fulfilled, (state, { payload }) => {
        state.documentsLoading = false;
        state.documents        = payload.documents ?? [];
      })
      .addCase(getReturnDocuments.rejected, (state, { payload }) => {
        state.documentsLoading = false;
        state.error            = extractErrorMessage(payload, "Failed to fetch return documents");
      });

    // ── uploadReturnFiles (standalone) ───────────────────────────────────────
    builder
      .addCase(uploadReturnFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error         = null;
      })
      // FIX CS-7/XS-1 — uploadedAt is stamped in the thunk (via uploadFiles()),
      // NOT here in the reducer. Reducers must be pure/deterministic for
      // Redux DevTools time-travel to work correctly.
      // FIX CS-8 — normaliseDocument() pads upload-response entries to the
      // full getReturnDocuments shape so state.documents is always uniform.
      .addCase(uploadReturnFiles.fulfilled, (state, { payload }) => {
        state.uploadLoading = false;
        state.success       = true;
        state.documents     = [
          ...state.documents,
          ...(payload.files ?? []).map(normaliseDocument),
        ];
      })
      .addCase(uploadReturnFiles.rejected, (state, { payload }) => {
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
} = returnSlice.actions;

export default returnSlice.reducer;