// Frontend/src/features/returns/adminReturnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * uploadFiles
 * Upload files to Cloudinary via the ADMIN backend route and return a
 * normalised array. Shared internally — not exported.
 *
 * WARNING: Scoped to the admin upload route (/api/v1/admin/returns/:id/upload).
 * Do NOT reuse for customer uploads — that route is /api/v1/orders/:id/return/upload
 * and is guarded by different middleware. Using the wrong route produces 403s.
 *
 * Do NOT set Content-Type manually on a FormData body. axios injects
 * "multipart/form-data; boundary=…" automatically; a manual header strips the
 * boundary and causes multer to reject the body.
 *
 * FIX XS-1 / AS-12 — uploadedAt is stamped HERE in the thunk (async context),
 * not inside the Immer reducer. Reducers must be pure and deterministic;
 * calling new Date() inside a reducer breaks Redux DevTools time-travel.
 *
 * @param {string} orderId
 * @param {File[]} files
 * @returns {Promise<Array<{ url, filename, fileType, fileSize, uploadedAt }>>}
 */
const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append("attachments", f));

  const { data } = await axios.post(
    `/api/v1/admin/returns/${orderId}/upload`,
    formData,
    { withCredentials: true }
  );

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
 * Ensures state.documents is uniformly shaped regardless of which code path
 * (getReturnDocuments vs uploadReturnFiles) populated it.
 *
 * Backend document shape (getReturnDocuments):
 *   { type, url, filename, description, uploadedBy, uploadedAt, fileSize, mimeType }
 * Upload response entry (from uploadFiles()):
 *   { url, filename, fileType, fileSize, uploadedAt }
 *
 * @param {object} f — raw file entry from uploadFiles()
 * @returns {object} — normalised to full document shape
 */
const normaliseDocument = (f) => ({
  url:         f.url,
  filename:    f.filename,
  fileType:    f.fileType,
  fileSize:    f.fileSize,
  type:        f.type        ?? "other",   // enum: photo|video|receipt|other
  description: f.description ?? "",
  uploadedBy:  f.uploadedBy  ?? null,
  uploadedAt:  f.uploadedAt  ?? null,      // set by uploadFiles() in thunk
  mimeType:    f.mimeType    ?? null,
});

/**
 * extractErrorMessage
 * Safely extracts a string message from any error payload shape.
 * Guards against the backend ever changing from a plain string to an object.
 *
 * FIX XS-4 — admin slice previously used raw `state.error = payload` for all
 * rejected cases. This is fragile if any thunk changes to reject with an object.
 * Ported from customer slice for consistent error handling across both slices.
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
 * sanitiseFilters
 * Strips undefined, null, and empty-string values from a filters object before
 * passing to URLSearchParams.
 *
 * FIX AS-2 — URLSearchParams({ status: undefined }) produces "status=undefined"
 * which reaches the backend as the literal string "undefined". buildMatchStage
 * then does { $in: ["undefined"] } → zero results returned silently.
 *
 * @param {object} filters
 * @returns {object} — filters with all falsy values removed
 */
const sanitiseFilters = (filters) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([, v]) => v !== undefined && v !== null && v !== ""
    )
  );

// ─────────────────────────────────────────────────────────────────────────────
// THUNKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all return requests with pagination and optional filters.
 *
 * Supported filter keys (all optional):
 *   page     {number}  — page number (default 1)
 *   limit    {number}  — results per page (default 20, max 100)
 *   status   {string}  — comma-separated statuses, e.g. "requested,approved"
 *   from     {string}  — ISO date string — filter requestedAt >= from
 *   to       {string}  — ISO date string — filter requestedAt <= to
 *   rma      {string}  — partial RMA number search (regex, case-insensitive)
 *   reason   {string}  — exact reason match
 *   sortBy   {string}  — "requestedAt" | "totalPrice" | "status"
 *   order    {string}  — "asc" | "desc"
 *
 * FIX AS-2 — sanitiseFilters() strips undefined/null/empty values before
 * URLSearchParams serialisation to prevent "key=undefined" query strings that
 * cause the backend to return zero results silently.
 *
 * FIX AS-14 — all supported filter params now documented above.
 */
export const getAllReturns = createAsyncThunk(
  "adminReturn/getAllReturns",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(sanitiseFilters(filters)).toString();
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

/** Fetch full details for a single return (populates documents, timeline; last-5 message preview). */
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

/**
 * Approve or reject a pending return request.
 *   action:      "approve" | "reject"
 *   restockFee:  number (optional, approve only)
 *   adminNote:   string (optional)
 *
 * Backend returns: { success, message, returnInfo }  ← no .order field.
 */
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

/**
 * Update return status through the post-approval lifecycle.
 *   status:          "in_transit" | "received" | "inspected" | "completed"
 *   inspectionNotes: string (inspected status only)
 *
 * Backend returns: { success, message, returnInfo }  ← no .order field.
 */
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
 * Send a return message (admin side), optionally with file attachments.
 *
 * ─── WHY ONE THUNK ───────────────────────────────────────────────────────────
 * The backend exposes two separate endpoints:
 *   POST /admin/returns/:id/upload    — raw files → Cloudinary URLs
 *   POST /admin/returns/:id/messages  — { content, attachments: URL[] }
 *
 * This thunk owns the full flow behind one flag (messageSendLoading):
 *   Step 1 — upload (skipped when retrying with pendingUrls)
 *   Step 2 — send message with the collected URLs
 *
 * ─── PARTIAL FAILURE / RETRY ─────────────────────────────────────────────────
 * Step 1 fails → rejectWithValue({ stage:'upload' })
 *   Files never reached Cloudinary — admin re-selects and retries normally.
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
 *
 * NOTE: This uses the shared customer route GET /api/v1/orders/:id/return/messages,
 * not an /admin/... route. This is intentional — the backend controller is
 * role-aware via req.user.role: admin reads trigger marking customer messages
 * as read, customer reads trigger marking admin messages as read. The shared
 * route handles both sides correctly.
 *
 * FIX AS-1 — limit is now bubbled back in the return value so the reducer can
 * compare count === limit instead of the hardcoded 50.
 */
export const getReturnMessages = createAsyncThunk(
  "adminReturn/getReturnMessages",
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
 *
 * FIX AS-7 — fulfilled reducer now merges normalised file metadata into
 * state.documents so the documents panel updates without a round-trip refetch.
 * FIX AS-12 / XS-1 — uploadedAt stamped in uploadFiles() thunk, not in reducer.
 */
export const uploadReturnFiles = createAsyncThunk(
  "adminReturn/uploadReturnFiles",
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

/**
 * Fetch returns that have unread customer messages.
 * Stored in state.unreadReturns — never overwrites state.returns —
 * so a background badge poll never silently replaces the admin's paginated list.
 *
 * NOTE AS-15 — backend response shape for each entry:
 *   { _id, user, returnInfo: { status, rmaNumber, reason, unreadCount }, latestMessage }
 * The unread count field is returnInfo.unreadCount (NOT .unreadMessages).
 * This differs from the Mongoose virtual name (unreadReturnMessages) because
 * the backend controller renames it in the aggregation projection.
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
    // Unread results isolated here — a background poll never corrupts list view.
    unreadReturns: [],
    stats: null,
    currentReturn: null,

    messages: [],
    messagesPage: 1,
    // FIX AS-9 — totalMessages stores backend totalCount so the UI can display
    // "Load N earlier messages" without an extra round-trip.
    totalMessages: 0,
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
      currentPage:  1,
      totalPages:   1,
    },

    // ── Loading flags ────────────────────────────────────────────────────────
    loading:           false, // getSingleReturn, reviewReturn, updateReturnStatus
    returnsLoading:    false, // getAllReturns
    unreadLoading:     false, // getReturnsWithUnreadMessages
    messageSendLoading: false, // sendReturnMessage (upload + send combined)
    messagesLoading:   false, // getReturnMessages
    timelineLoading:   false,
    documentsLoading:  false,
    uploadLoading:     false, // standalone uploadReturnFiles

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
    clearAdminReturnState: (state) => {
      state.error      = null;
      state.errorStage = null;
      state.success    = false;
      state.message    = null;
    },

    /**
     * Call when navigating away from a return detail panel.
     *
     * FIX AS-6 — also clears error, errorStage, success, and message.
     * Previously, an error from return A (e.g. failed send) would persist
     * in state when the admin opened return B, showing a stale error banner
     * before any action was taken in the new panel.
     */
    clearCurrentReturn: (state) => {
      state.currentReturn      = null;
      state.messages           = [];
      state.messagesPage       = 1;
      state.totalMessages      = 0;
      state.hasMoreMessages    = false;
      state.pendingAttachments = [];
      state.timeline           = [];
      state.documents          = [];
      // FIX AS-6: clear error state so next panel opens clean.
      state.error      = null;
      state.errorStage = null;
      state.success    = false;
      state.message    = null;
    },

    /**
     * Call on chat panel unmount to prevent stale messages on next open.
     * FIX AS-6 (partial) — also clears error/errorStage for the same reason
     * as clearCurrentReturn: a panel that closed mid-error must not re-open
     * showing the stale error before any action is taken.
     */
    clearReturnMessages: (state) => {
      state.messages           = [];
      state.messagesPage       = 1;
      state.totalMessages      = 0;
      state.hasMoreMessages    = false;
      state.pendingAttachments = [];
      state.error              = null;
      state.errorStage         = null;
    },

    /**
     * Call when the admin dismisses a partial-failure error without retrying,
     * or when files are removed mid-compose so stale Cloudinary URLs from a
     * prior failed send are not silently re-attached to the next message.
     */
    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage         = null;
      state.error              = null;
    },
  },

  extraReducers: (builder) => {
    // ── getAllReturns ─────────────────────────────────────────────────────────
    builder
      .addCase(getAllReturns.pending, (state) => {
        state.returnsLoading = true;
        state.error          = null;
        // FIX AS-10 — reset pagination on new fetch so components don't briefly
        // show "Page 3 of 1" when the admin changes filters mid-browse.
        state.pagination = { totalReturns: 0, currentPage: 1, totalPages: 1 };
        // FIX AS-11 — reset stats so the stat bar doesn't show stale counts
        // from the previous filter while the new request is in flight.
        state.stats = null;
      })
      .addCase(getAllReturns.fulfilled, (state, { payload }) => {
        state.returnsLoading = false;
        // FIX AS-3 — ?? [] fallback prevents state.returns becoming undefined
        // if payload.returns is absent, which would crash any .map() call.
        state.returns = payload.returns ?? [];
        state.stats   = payload.stats   ?? null;
        state.pagination = {
          totalReturns: payload.totalReturns ?? 0,
          currentPage:  payload.currentPage  ?? 1,
          totalPages:   payload.totalPages   ?? 1,
        };
      })
      .addCase(getAllReturns.rejected, (state, { payload }) => {
        state.returnsLoading = false;
        state.error = extractErrorMessage(payload, "Failed to fetch returns");
      });

    // ── getSingleReturn ──────────────────────────────────────────────────────
    builder
      .addCase(getSingleReturn.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getSingleReturn.fulfilled, (state, { payload }) => {
        state.loading       = false;
        // Backend: { success, order: { ..., returnInfo: { ...subdoc, messages: last-5-preview } } }
        state.currentReturn = payload.order ?? null;
      })
      .addCase(getSingleReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, "Failed to fetch return details");
      });

    // ── reviewReturn ─────────────────────────────────────────────────────────
    builder
      .addCase(reviewReturn.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(reviewReturn.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // FIX AS-5 — payload.order branch removed. Backend returns only
        // { success, message, returnInfo } — never a full .order object.
        // The dead payload.order branch would have fully replaced currentReturn,
        // wiping populated orderItems, shippingInfo, user etc if the backend
        // ever added .order to the response. Patch returnInfo only.
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(reviewReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, "Failed to review return");
      });

    // ── updateReturnStatus ───────────────────────────────────────────────────
    builder
      .addCase(updateReturnStatus.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(updateReturnStatus.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.success = true;
        state.message = payload.message;
        // FIX AS-5 — same as reviewReturn: patch returnInfo only; no .order branch.
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(updateReturnStatus.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, "Failed to update return status");
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
        // FIX AS-4 — errorStage was only cleared in pending. A prior stage:"send"
        // failure left errorStage="send" visible after a successful retry.
        state.errorStage = null;
        const newMsg = payload?.data?.message;
        if (newMsg) {
          state.messages.push(newMsg);
          // FIX AS-8 — also append to the 5-message preview in currentReturn so
          // components reading currentReturn.returnInfo.messages (e.g. a preview
          // strip on the detail card) reflect the new message without a refetch.
          if (state.currentReturn?.returnInfo?.messages) {
            state.currentReturn.returnInfo.messages.push(newMsg);
          }
        }
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
      // FIX AS-1 — hasMoreMessages now compares count against the actual limit
      // returned from the thunk. Previously hardcoded to 50 which broke
      // pagination for any caller supplying a different limit.
      // FIX AS-9 — totalMessages now stored from backend's totalCount field.
      .addCase(getReturnMessages.fulfilled, (state, { payload }) => {
        state.messagesLoading = false;
        const { messages = [], count, totalCount, page, limit } = payload;
        if (page === 1) {
          state.messages = messages;
        } else {
          // Prepend older pages — load-earlier / scroll-up pattern.
          state.messages = [...messages, ...state.messages];
        }
        state.messagesPage    = page;
        state.totalMessages   = totalCount ?? 0;
        state.hasMoreMessages = count === (limit ?? 50);
      })
      .addCase(getReturnMessages.rejected, (state, { payload }) => {
        state.messagesLoading = false;
        state.error = extractErrorMessage(payload, "Failed to fetch return messages");
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
        state.error = extractErrorMessage(payload, "Failed to fetch return timeline");
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
        state.error = extractErrorMessage(payload, "Failed to fetch return documents");
      });

    // ── uploadReturnFiles (standalone) ───────────────────────────────────────
    builder
      .addCase(uploadReturnFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error         = null;
      })
      // FIX AS-7 — payload.files was previously discarded entirely, forcing
      // the admin to manually refetch getReturnDocuments to see new uploads.
      // We now merge normalised entries into state.documents immediately.
      // FIX AS-12/XS-1 — uploadedAt is set in the thunk (via uploadFiles()),
      // not here. No Date construction in reducers.
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
        state.error = extractErrorMessage(payload, "Failed to upload files");
      });

    // ── getReturnsWithUnreadMessages ─────────────────────────────────────────
    builder
      .addCase(getReturnsWithUnreadMessages.pending, (state) => {
        state.unreadLoading = true;
        state.error         = null;
      })
      // FIX AS-3 — ?? [] fallback prevents state.unreadReturns becoming
      // undefined if payload.returns is absent.
      .addCase(getReturnsWithUnreadMessages.fulfilled, (state, { payload }) => {
        state.unreadLoading = false;
        // Isolated from state.returns — background badge poll never corrupts
        // the admin's paginated list view.
        state.unreadReturns = payload.returns ?? [];
      })
      .addCase(getReturnsWithUnreadMessages.rejected, (state, { payload }) => {
        state.unreadLoading = false;
        state.error = extractErrorMessage(payload, "Failed to fetch unread returns");
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