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
 * Approve or reject a pending return request (first-round, status=requested).
 *
 * Body shape expected by the backend (validateReturnReview + canReviewFirstRound):
 *   { itemDecisions: [{ productId, decision, rejectionReason? }], adminNote? }
 *
 * The old { action, restockFee, adminNote } shape is gone — the restock fee
 * input was removed per spec Section 8, and the backend now expects per-item
 * decisions. Do NOT pass `action` or `restockFee` — they will be ignored by
 * the new controller and may confuse validation.
 *
 * Backend returns: { success, message, returnInfo }  ← no .order field.
 */
export const reviewReturn = createAsyncThunk(
  "adminReturn/reviewReturn",
  async ({ orderId, itemDecisions, adminNote = "" }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/review`,
        { itemDecisions, adminNote },
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
 * submitAdminPleaReview
 * Review a customer plea after the plea window (status=plea_submitted).
 * Calls PUT /api/v1/admin/orders/:id/return/plea-review via canReviewPleaRound.
 *
 * Body shape: { itemDecisions: [{ productId, decision, rejectionReason? }], adminNote? }
 * Same shape as reviewReturn — the controller (resolveAfterPlea) handles the
 * different status transition (plea_submitted → awaiting_discount).
 *
 * Backend returns: { success, message, returnInfo }
 *
 * NEW — required for the plea review tab added in spec Section 8.
 */
export const submitAdminPleaReview = createAsyncThunk(
  "adminReturn/submitAdminPleaReview",
  async ({ orderId, itemDecisions, adminNote = "" }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/plea-review`,
        { itemDecisions, adminNote },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to submit plea review"
      );
    }
  }
);

/**
 * generateDiscountCode
 * Triggers the backend to mark the return completed and build the
 * returnDataForDiscount payload. The admin is then navigated to the
 * discount creation page with this payload in location.state.
 *
 * Route: POST /api/v1/admin/orders/:id/return/generate-discount
 * Guard: canGenerateDiscount (status must be awaiting_discount)
 *
 * Backend response shape:
 *   {
 *     success: true,
 *     message: '...',
 *     redirectToDiscount: true,
 *     returnDataForDiscount: {
 *       orderId, orderNumber, orderReference, customerId,
 *       approvedItems: [{ productId, name, quantity, unitPrice }],
 *       totalApprovedValue, discountValue,
 *     },
 *     returnInfo: { ...updatedReturnInfo }
 *   }
 *
 * Navigation to /admin/discounts/new belongs in the COMPONENT, not here.
 * This thunk returns the full payload; the component reads payload.returnDataForDiscount.
 *
 * NEW — required for the "Generate Discount Code" button in spec Section 8.
 */
export const generateDiscountCode = createAsyncThunk(
  "adminReturn/generateDiscountCode",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/orders/${orderId}/return/generate-discount`,
        {},
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message ?? "Failed to generate discount code"
      );
    }
  }
);

/**
 * Update return status through the post-approval lifecycle.
 *   status:          "in_transit" | "received" | "inspected" | "completed"
 *   inspectionNotes: string (inspected status only)
 *
 * NOTE: The new flow statuses (items_reviewed, plea_submitted, awaiting_discount)
 * are NOT valid values here — they are set by dedicated endpoints (reviewReturn,
 * submitAdminPleaReview, generateDiscountCode). Passing them here will be
 * rejected by the backend's validateReturnStatusUpdate validator (BUG-10 fix).
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
 * Step 2 fails → rejectWithValue({ stage:'send', pendingUrls:[…] })
 *
 * ─── BACKEND RESPONSE ────────────────────────────────────────────────────────
 * addReturnMessage controller returns:
 *   { success, message: 'Message sent successfully', data: { orderId, message: <msgObj> } }
 *
 * Thunk returns { ...data, attachmentUrls }, so payload shape is:
 *   payload.message       = 'Message sent successfully'  ← plain string
 *   payload.data.message  = <the actual message object>  ← correct path
 *   payload.attachmentUrls = []
 */
export const sendReturnMessage = createAsyncThunk(
  "adminReturn/sendReturnMessage",
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
          stage: "upload",
          message: err.response?.data?.message ?? "Failed to upload files",
          pendingUrls: [],
        });
      }
    }

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
 *   page 1  → replaces the array
 *   page 2+ → prepends older messages (load-earlier / scroll-up)
 *
 * Uses shared customer route GET /api/v1/orders/:id/return/messages.
 * Backend is role-aware: admin reads mark customer messages as read.
 *
 * FIX AS-1 — limit bubbled back so reducer compares count === limit
 * instead of hardcoded 50.
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
 * Backend response per entry:
 *   { _id, user, returnInfo: { status, rmaNumber, reason, unreadCount }, latestMessage }
 * Note: the unread count field is returnInfo.unreadCount (renamed from the
 * Mongoose virtual unreadReturnMessages by the controller's aggregation projection).
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
// STATUS CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STATUS_COLORS
 * Maps every possible returnInfo.status value to a Tailwind colour token.
 * Used by AdminReturns.jsx for badge colouring and STATUS_FILTERS.
 *
 * NEW — items_reviewed, plea_submitted, awaiting_discount added for new flow.
 * None of the three new statuses are terminal (they progress further).
 */
export const STATUS_COLORS = {
  requested:         "yellow",
  items_reviewed:    "blue",    // NEW — admin has posted per-item decisions
  plea_submitted:    "purple",  // NEW — customer has submitted a plea
  awaiting_discount: "orange",  // NEW — awaiting admin discount code generation
  in_transit:        "sky",
  received:          "indigo",
  inspected:         "teal",
  completed:         "green",
  cancelled:         "gray",
  rejected:          "red",
};

/**
 * STATUS_LABELS
 * Human-readable label for each status, used in filter dropdowns, badges,
 * and timeline dots.
 *
 * NEW — three new-flow statuses added.
 */
export const STATUS_LABELS = {
  requested:         "Requested",
  items_reviewed:    "Items Reviewed",    // NEW
  plea_submitted:    "Plea Submitted",    // NEW
  awaiting_discount: "Awaiting Discount", // NEW
  in_transit:        "In Transit",
  received:          "Received",
  inspected:         "Inspected",
  completed:         "Completed",
  cancelled:         "Cancelled",
  rejected:          "Rejected",
};

/**
 * STATUS_FILTERS
 * Ordered list of statuses available in the admin filter dropdown.
 * Preserves natural flow order so the dropdown reads top-to-bottom
 * as the return progresses through its lifecycle.
 *
 * NEW — items_reviewed, plea_submitted, awaiting_discount inserted
 * between requested and in_transit.
 */
export const STATUS_FILTERS = [
  "requested",
  "items_reviewed",    // NEW
  "plea_submitted",    // NEW
  "awaiting_discount", // NEW
  "in_transit",
  "received",
  "inspected",
  "completed",
  "cancelled",
  "rejected",
];

/**
 * TERMINAL_STATUSES
 * Returns in a terminal status cannot be acted on further.
 * Used to hide action buttons, disable review tabs, etc.
 *
 * IMPORTANT: items_reviewed, plea_submitted, and awaiting_discount are NOT
 * terminal — they are mid-flow states that expect further admin or customer
 * action. Only completed, cancelled, and rejected are true end-states.
 */
export const TERMINAL_STATUSES = ["completed", "cancelled", "rejected"];

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const adminReturnSlice = createSlice({
  name: "adminReturn",
  initialState: {
    returns: [],
    unreadReturns: [],
    stats: null,
    currentReturn: null,

    // NEW — total monetary exposure across all active returns.
    // Populated from getAllReturns.fulfilled via payload.stats.totalRequestedAmount.
    // Used by the KPI card in AdminReturns.jsx (spec Section 8, item 7).
    totalRequestedAmount: 0,

    messages: [],
    messagesPage: 1,
    totalMessages: 0,
    hasMoreMessages: false,

    pendingAttachments: [],

    timeline: [],
    documents: [],

    pagination: {
      totalReturns: 0,
      currentPage:  1,
      totalPages:   1,
    },

    // ── Loading flags ────────────────────────────────────────────────────────
    loading:              false, // getSingleReturn, reviewReturn, updateReturnStatus
    returnsLoading:       false, // getAllReturns
    unreadLoading:        false, // getReturnsWithUnreadMessages
    messageSendLoading:   false, // sendReturnMessage (upload + send combined)
    messagesLoading:      false, // getReturnMessages
    timelineLoading:      false,
    documentsLoading:     false,
    uploadLoading:        false, // standalone uploadReturnFiles
    pleaReviewLoading:    false, // NEW — submitAdminPleaReview
    discountCodeLoading:  false, // NEW — generateDiscountCode

    // ── Error / result state ─────────────────────────────────────────────────
    error:      null,
    errorStage: null, // 'upload' | 'send' | null
    success:    false,
    message:    null,
  },

  reducers: {
    clearAdminReturnState: (state) => {
      state.error      = null;
      state.errorStage = null;
      state.success    = false;
      state.message    = null;
    },

    /**
     * clearCurrentReturn
     * Call when navigating away from a return detail panel.
     *
     * FIX AS-6 — clears error, errorStage, success, message so the next panel
     * opens clean without stale banners from a previous return's failed send.
     *
     * FIX A3 — also resets all in-flight loading flags. If the admin navigates
     * away while a send/upload/fetch is in flight, those flags would otherwise
     * stay true indefinitely (the thunk's finally block fires but the component
     * is already gone and the next panel inherits the stuck flag).
     * Affected flags: messageSendLoading, uploadLoading, messagesLoading, loading.
     * returnsLoading is NOT reset here — getAllReturns is a list-view concern
     * and its flight is independent of any single return panel.
     *
     * NEW — also resets pleaReviewLoading and discountCodeLoading for the same
     * reason: if the admin navigates away mid-request these flags must clear.
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
      // FIX AS-6
      state.error      = null;
      state.errorStage = null;
      state.success    = false;
      state.message    = null;
      // FIX A3: reset in-flight flags so the next panel is never stuck loading
      state.messageSendLoading  = false;
      state.uploadLoading       = false;
      state.messagesLoading     = false;
      state.loading             = false;
      // NEW
      state.pleaReviewLoading   = false;
      state.discountCodeLoading = false;
    },

    /**
     * clearReturnMessages
     * Call on chat panel unmount to prevent stale messages on next open.
     *
     * FIX AS-6 (partial) — clears error/errorStage so stale error banners
     * do not appear on re-open before any action is taken.
     *
     * FIX A2 — also resets messageSendLoading, uploadLoading, messagesLoading.
     * Without this, closing the chat panel while a fetch or send is in flight
     * leaves those flags true. The next panel open inherits a stuck loading
     * spinner or a permanently disabled send button.
     */
    clearReturnMessages: (state) => {
      state.messages           = [];
      state.messagesPage       = 1;
      state.totalMessages      = 0;
      state.hasMoreMessages    = false;
      state.pendingAttachments = [];
      state.error              = null;
      state.errorStage         = null;
      // FIX A2: reset in-flight loading flags
      state.messageSendLoading = false;
      state.uploadLoading      = false;
      state.messagesLoading    = false;
    },

    /**
     * clearPendingAttachments
     * Call when the admin dismisses a partial-failure error without retrying,
     * or when files are removed mid-compose so stale Cloudinary URLs from a
     * prior failed send are not silently re-attached to the next message.
     */
    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage         = null;
      state.error              = null;
    },

    /**
     * markReturnRead
     * Optimistic local update — zeroes the unreadMessages counter on a
     * specific return in state.returns WITHOUT waiting for a list re-fetch.
     *
     * Call this immediately after getSingleReturn resolves inside both
     * handleViewReturn and handleOpenMessageModal in AdminReturns.jsx:
     *
     *   await dispatch(getSingleReturn(orderId)).unwrap();
     *   dispatch(markReturnRead(orderId));
     *
     * Why local instead of an API call:
     * The backend already sets unreadMessages=0 on the getSingleReturn response
     * (admin fetch marks messages read server-side). This reducer just syncs
     * the badge in the list view immediately, without waiting for the list
     * query to re-run (which might be debounced or on a timer).
     *
     * Affects both state.returns (paginated list) and state.unreadReturns
     * (badge poll list) so all badge sources are consistent.
     *
     * NEW — spec Section 8, item 4 / adminReturnSlice change 1.
     *
     * @param {string} action.payload — orderId
     */
    markReturnRead: (state, { payload: orderId }) => {
      const idStr = String(orderId);

      // Zero the badge in the main paginated list
      const inList = state.returns.find(
        (r) => String(r._id) === idStr || String(r.orderId) === idStr
      );
      if (inList) {
        inList.returnInfo = inList.returnInfo ?? {};
        inList.returnInfo.unreadMessages = 0;
      }

      // Also zero the badge in the unread poll list so the sidebar badge
      // clears immediately rather than waiting for the next poll interval.
      const inUnread = state.unreadReturns.find(
        (r) => String(r._id) === idStr || String(r.orderId) === idStr
      );
      if (inUnread) {
        inUnread.returnInfo = inUnread.returnInfo ?? {};
        inUnread.returnInfo.unreadMessages = 0;
        inUnread.returnInfo.unreadCount    = 0; // aggregation projection field
      }
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
        state.returns        = payload.returns ?? [];
        state.stats          = payload.stats   ?? null;
        state.pagination     = {
          totalReturns: payload.totalReturns ?? 0,
          currentPage:  payload.currentPage  ?? 1,
          totalPages:   payload.totalPages   ?? 1,
        };
        // NEW — totalRequestedAmount lives inside stats (computed by the
        // facet aggregation in getAllReturns controller). Safe fallback to 0
        // if the stats facet is absent (e.g. empty result set).
        state.totalRequestedAmount = payload.stats?.totalRequestedAmount ?? 0;
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
        // Backend: { success, order: { _id, user, orderItems, shippingInfo,
        //   returnInfo: { ...subdoc, messages: last-5-preview }, ... } }
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
        // FIX AS-5 — backend returns { success, message, returnInfo }, never
        // a full .order object. Patch only returnInfo to preserve the populated
        // orderItems, shippingInfo, user etc. already in currentReturn.
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

    // ── submitAdminPleaReview ─────────────────────────────────────────────────
    // NEW — handles the plea review tab submit (spec Section 8, item 3).
    // Calls resolveAfterPlea on the backend via canReviewPleaRound middleware.
    // Follows the same returnInfo-patch pattern as reviewReturn (FIX AS-5).
    builder
      .addCase(submitAdminPleaReview.pending, (state) => {
        state.pleaReviewLoading = true;
        state.error             = null;
      })
      .addCase(submitAdminPleaReview.fulfilled, (state, { payload }) => {
        state.pleaReviewLoading = false;
        state.success           = true;
        state.message           = payload.message;
        // Patch returnInfo only — preserve populated fields from getSingleReturn
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(submitAdminPleaReview.rejected, (state, { payload }) => {
        state.pleaReviewLoading = false;
        state.error = extractErrorMessage(payload, "Failed to submit plea review");
      });

    // ── generateDiscountCode ──────────────────────────────────────────────────
    // NEW — handles the "Generate Discount Code" button (spec Section 8, item 5/6).
    // On fulfilled the COMPONENT navigates to /admin/discounts/new with
    // payload.returnDataForDiscount in location.state. This reducer only
    // patches currentReturn.returnInfo (status now 'completed').
    builder
      .addCase(generateDiscountCode.pending, (state) => {
        state.discountCodeLoading = true;
        state.error               = null;
      })
      .addCase(generateDiscountCode.fulfilled, (state, { payload }) => {
        state.discountCodeLoading = false;
        state.success             = true;
        state.message             = payload.message;
        // Patch returnInfo — status is now 'completed' after this call.
        // returnDataForDiscount is NOT stored in Redux state — it is consumed
        // by the component immediately via action.payload and passed as
        // navigation state to the discount creation page.
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(generateDiscountCode.rejected, (state, { payload }) => {
        state.discountCodeLoading = false;
        state.error = extractErrorMessage(payload, "Failed to generate discount code");
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
        // FIX AS-5 — same as reviewReturn: patch returnInfo only.
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
        // FIX AS-4 — clear errorStage here too, not just in pending, so a
        // prior stage:"send" failure prompt disappears on successful retry.
        state.errorStage = null;

        // ── Append to full message thread ────────────────────────────────────
        // Backend addReturnMessage response shape:
        //   { success, message: 'Message sent successfully', data: { orderId, message: <msgObj> } }
        // Thunk returns { ...data, attachmentUrls }, so:
        //   payload.message      = 'Message sent successfully'  ← string
        //   payload.data.message = <the actual message object>  ← object
        //
        // typeof guard ensures we never push a plain string into the messages
        // array if the backend shape changes or a partial response is received.
        const newMsg = payload?.data?.message ?? null;
        if (newMsg && typeof newMsg === "object") {
          state.messages.push(newMsg);
        }

        // ── FIX A4 + A5: preview sync removed ───────────────────────────────
        // Do not push to currentReturn.returnInfo.messages (the 5-message
        // preview). Sender field is an ObjectId from sendReturnMessage but a
        // populated object from getSingleReturn — mixing shapes crashes
        // msg.sender.name references (A4). Preview also grows unboundedly (A5).
        // The full thread in state.messages is the source of truth for chat.
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
          state.messages = [...messages, ...state.messages];
        }

        state.messagesPage  = page;
        state.totalMessages = totalCount ?? 0;

        // FIX A1 [HIGH] — original: state.hasMoreMessages = count === (limit ?? 50)
        //
        // This produces a false-positive when the total number of messages is
        // exactly divisible by the page limit. Example: 50 messages total,
        // limit=50 — page 1 returns count=50, hasMoreMessages becomes true,
        // the "Load earlier" button appears, the admin clicks it, page 2
        // returns 0 messages — a wasted round-trip with an empty result and
        // a confusing UX flash.
        //
        // Fix: combine the full-page signal with the backend-provided totalCount.
        //   count === limit    →  a full page was returned (necessary condition)
        //   receivedSoFar < totalCount  →  server confirms more exist
        const receivedSoFar = page === 1
          ? messages.length
          : state.messages.length;

        state.hasMoreMessages =
          count === (limit ?? 50) &&
          (totalCount == null || receivedSoFar < totalCount);
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
  markReturnRead,           
} = adminReturnSlice.actions;

export default adminReturnSlice.reducer;