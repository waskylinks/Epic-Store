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

  // uploadedAt is stamped HERE in the thunk (async context), not inside the
  // Immer reducer. Reducers must be pure and deterministic; calling new Date()
  // inside a reducer breaks time-travel debugging.
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
 * submitPlea
 * Customer submits a plea for reconsideration after per-item admin decisions.
 *
 * Route:  POST /api/v1/orders/:id/return/plea
 * Guards: canSubmitPlea (status=items_reviewed, pleaAttempts<1, deadline not
 *         expired, order ownership), validatePleaSubmission, pleaLimiter
 *
 * Body:   { pleaDescription: string }
 *
 * File uploads for plea evidence are a SEPARATE call — use uploadPleaFiles
 * (POST /orders/:id/return/plea/upload) BEFORE or AFTER submitting the text.
 * The uploadPleaFiles route intentionally does NOT go through canSubmitPlea
 * so uploads are valid in both items_reviewed and plea_submitted states.
 *
 * Backend response:
 *   {
 *     success:    true,
 *     message:    'Plea submitted successfully...',
 *     returnInfo: { ...full returnInfo subdoc, status: 'plea_submitted',
 *                   pleaAttempts: 1, pleaDeadline: <admin 48h window>,
 *                   pleaInfo: { pleaDescription, pleaSubmittedAt, pleaDocuments } }
 *   }
 *
 * On fulfilled: returnStatus is replaced with the full fresh returnInfo
 * (same pattern as requestReturn). The backend always returns the full
 * subdoc so there is no risk of losing plea or item decision fields.
 *
 * NEW — required for the plea submission form in spec Section 9.
 */
export const submitPlea = createAsyncThunk(
  "return/submitPlea",
  async ({ orderId, pleaDescription }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/return/plea`,
        { pleaDescription },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to submit plea"
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
 * NOTE: field name is "content" (return schema) — refund messages use "message".
 *
 * Backend response: { success, message: 'Message sent successfully',
 *                     data: { orderId, message: newMessage } }
 * Thunk returns:    { ...backendData, attachmentUrls }
 * So payload.data.message === the new message document (correct).
 */
export const sendReturnMessage = createAsyncThunk(
  "return/sendReturnMessage",
  async (
    { orderId, content, files = [], pendingUrls = [] },
    { rejectWithValue }
  ) => {
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

/**
 * Fetch return messages (paginated).
 *   page 1  → replaces the array (fresh open / re-open)
 *   page 2+ → prepends older messages (load earlier / scroll-up)
 *
 * limit is bubbled back so the reducer can compute hasMoreMessages accurately
 * for any caller-supplied limit without hardcoding 50.
 *
 * Backend response: { success, count, totalCount, currentPage, totalPages, messages }
 *
 * NOTE on isRead: the backend aggregation fetches the message slice BEFORE
 * calling markReturnMessagesAsRead + save, so the HTTP response contains
 * stale isRead:false values even though the server already persisted the read
 * state. The reducer compensates by normalising admin messages to isRead:true
 * client-side (see getReturnMessages.fulfilled).
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
 * For files attached to a message use sendReturnMessage instead.
 * For plea evidence files use the plea/upload route directly from the component
 * (POST /orders/:id/return/plea/upload) — that route writes to
 * pleaInfo.pleaDocuments, not returnInfo.documents.
 *
 * Does NOT set state.success. Setting it here would re-trigger the global
 * success useEffect in ReturnRequest.jsx (which watches success for the
 * "Return request submitted" toast) after the component has already cleared it
 * from requestReturn.fulfilled — causing a spurious duplicate toast.
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

    // ── New-flow fields ───────────────────────────────────────────────────────
    // These are populated from returnStatus (which is the full returnInfo object
    // from the backend) but are also mirrored as top-level state fields so
    // components can select them without deep-diving into returnStatus.
    //
    // pleaDeadline — ISO string or null.
    //   During items_reviewed: the customer's 48-hour window to submit a plea.
    //   During plea_submitted: the admin's 48-hour window to respond.
    //   Set to null when the phase ends (resolveAfterPlea clears it).
    //   Source: returnInfo.pleaDeadline (present in both getReturnStatus and
    //   submitPlea responses).
    //
    // pleaAttempts — number, default 0.
    //   Incremented by the backend on submitPlea. Used to hide the plea form
    //   once the customer has used their one attempt.
    //   Source: returnInfo.pleaAttempts.
    //
    // discountValue — number or null.
    //   The calculated discount amount based on approved items.
    //   Set by reviewReturnRequest (first round) and resolveAfterPlea.
    //   Source: returnInfo.discountValue.
    //
    // acceptanceDeadline — ISO string or null.
    //   Schema field for a future "customer accept/decline discount" window.
    //   Currently unused by any controller but exists in the schema. Tracked
    //   here so components don't break if the backend starts populating it.
    //   Source: returnInfo.acceptanceDeadline.
    pleaDeadline:       null,
    pleaAttempts:       0,
    discountValue:      null,
    acceptanceDeadline: null,

    messages:        [],
    messagesPage:    1,
    // totalMessages stores backend totalCount so the UI can display
    // "Load N earlier messages" without an extra round-trip.
    totalMessages:   0,
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

    timeline:  [],
    documents: [],

    // ── Loading flags ────────────────────────────────────────────────────────
    loading:            false, // requestReturn, cancelReturn
    statusLoading:      false, // getReturnStatus
    pleaLoading:        false, // NEW — submitPlea
    messageSendLoading: false, // sendReturnMessage (upload + send combined)
    messagesLoading:    false, // getReturnMessages
    timelineLoading:    false,
    documentsLoading:   false,
    uploadLoading:      false, // standalone uploadReturnFiles

    // ── Error / result state ─────────────────────────────────────────────────
    error:      null,
    /**
     * 'upload' | 'send' | null
     * Lets the UI show the correct retry prompt without string-matching error.
     */
    errorStage: null,
    pleaError:  null, // NEW — isolated so plea errors don't clobber other UI
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
      state.returnStatus      = { status: "none", hasReturn: false };
      state.pleaDeadline      = null;
      state.pleaAttempts      = 0;
      state.discountValue     = null;
      state.acceptanceDeadline = null;
    },

    /**
     * Call on chat panel unmount / close to prevent stale messages on next open.
     *
     * Clears error, errorStage, and in-flight loading flags so a panel which
     * closed mid-error or mid-send does not re-open with stale banners or a
     * permanently-disabled send button.
     */
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

    /**
     * clearPleaError
     * Clears plea-specific error so the plea form can be re-attempted after
     * the user dismisses the error banner without clearing the whole return state.
     * Call from the plea form's error dismiss handler.
     *
     * NEW — isolated plea error state means a failed submitPlea does not
     * accidentally clear a concurrent requestReturn success banner.
     */
    clearPleaError: (state) => {
      state.pleaError  = null;
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
        // Backend returns raw Mongoose subdocument which never contains the
        // hasReturn virtual. Merge it explicitly so components gating on
        // returnStatus.hasReturn work immediately after submission without a
        // follow-up getReturnStatus call.
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
        const ri = payload.returnInfo ?? { status: "none", hasReturn: false };
        state.returnStatus = ri;
        // Mirror new-flow deadline / counter fields to top-level state so
        // components can select them without deep-diving returnStatus.
        // These are all present on the returnInfo object returned by
        // getReturnStatus (BUG-14 fix strips messages only, not these fields).
        state.pleaDeadline       = ri.pleaDeadline       ?? null;
        state.pleaAttempts       = ri.pleaAttempts       ?? 0;
        state.discountValue      = ri.discountValue      ?? null;
        state.acceptanceDeadline = ri.acceptanceDeadline ?? null;
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
        // Backend returns only { success, message } with no returnInfo.
        // Spread over existing shape to preserve reason, rmaNumber,
        // requestedAt etc. A wholesale replacement would blank components that
        // read those fields.
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

    // ── submitPlea ───────────────────────────────────────────────────────────
    // NEW — customer plea submission after per-item decisions (spec Section 9).
    //
    // Backend returns the full returnInfo subdoc on success, so we replace
    // returnStatus entirely and re-mirror the new-flow fields — exactly the
    // same pattern as requestReturn.fulfilled. This ensures the plea form
    // hides immediately (pleaAttempts becomes 1) and the countdown timer
    // switches to "admin response window" mode (pleaDeadline is updated).
    //
    // pleaError is used instead of the shared error field so a plea failure
    // does not accidentally clobber an unrelated error banner elsewhere on
    // the page (e.g. a failed document upload that is still showing).
    builder
      .addCase(submitPlea.pending, (state) => {
        state.pleaLoading = true;
        state.pleaError   = null;
      })
      .addCase(submitPlea.fulfilled, (state, { payload }) => {
        state.pleaLoading = false;
        state.success     = true;
        state.message     = payload.message;
        // Replace full returnStatus with fresh returnInfo from backend
        const ri = payload.returnInfo
          ? { ...payload.returnInfo, hasReturn: true }
          : state.returnStatus;
        state.returnStatus = ri;
        // Re-mirror new-flow fields
        state.pleaDeadline       = ri.pleaDeadline       ?? null;
        state.pleaAttempts       = ri.pleaAttempts       ?? 0;
        state.discountValue      = ri.discountValue      ?? null;
        state.acceptanceDeadline = ri.acceptanceDeadline ?? null;
      })
      .addCase(submitPlea.rejected, (state, { payload }) => {
        state.pleaLoading = false;
        // Isolated plea error — does not touch state.error so it cannot
        // accidentally clear or overwrite other UI banners.
        state.pleaError = extractErrorMessage(payload, "Failed to submit plea");
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
        // Clear errorStage explicitly — a prior stage:"send" failure left it
        // set; without this the retry prompt stays visible after a successful
        // retry.
        state.errorStage = null;
        // payload = { ...backendData, attachmentUrls }
        // backendData = { success, message, data: { orderId, message: newMsg } }
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
        const { messages = [], totalCount, page, limit } = payload;

        // FIX (isRead normalisation): The backend's getReturnMessages
        // aggregation runs BEFORE the markReturnMessagesAsRead + save, so the
        // HTTP response always carries stale isRead:false on admin messages
        // even though the server has already persisted them as read.
        const normalised = messages.map((m) =>
          m.senderType === "admin" ? { ...m, isRead: true } : m
        );

        if (page === 1) {
          state.messages = normalised;
        } else {
          state.messages = [...normalised, ...state.messages];
        }

        state.messagesPage  = page;
        state.totalMessages = totalCount ?? 0;

        // FIX (hasMoreMessages): count === limit was wrong — it evaluates true
        // when the last page fills exactly `limit` messages, causing an empty
        // "Load earlier" fetch. Use totalCount instead.
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
      .addCase(uploadReturnFiles.fulfilled, (state, { payload }) => {
        state.uploadLoading = false;
        // NOTE: success is intentionally NOT set here — see thunk JSDoc.
        state.documents = [
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
  clearPleaError,          
} = returnSlice.actions;

export default returnSlice.reducer;