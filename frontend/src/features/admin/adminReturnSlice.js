// Frontend/src/features/returns/adminReturnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/**
 * Get all return requests (Admin)
 * Supports pagination + status filter via filters object:
 *   { page: 1, limit: 20, status: 'requested' }
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
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch returns"
      );
    }
  }
);

/**
 * Get single return details (Admin)
 */
export const getSingleReturn = createAsyncThunk(
  "adminReturn/getSingleReturn",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/returns/${orderId}`, {
        withCredentials: true,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch return details"
      );
    }
  }
);

/**
 * Review return request (approve/reject)
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
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to review return"
      );
    }
  }
);

/**
 * Update return status
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
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update return status"
      );
    }
  }
);

/**
 * Add return message (Admin)
 */
export const addReturnMessage = createAsyncThunk(
  "adminReturn/addReturnMessage",
  async ({ orderId, content, attachments = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/returns/${orderId}/messages`,
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
 * Get return messages
 * FIX: Now accepts { orderId, page, limit } so the UI can paginate the
 * message thread — backend supports $slice pagination since the perf update.
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
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch return messages"
      );
    }
  }
);

/**
 * Get return timeline
 */
export const getReturnTimeline = createAsyncThunk(
  "adminReturn/getReturnTimeline",
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
  "adminReturn/getReturnDocuments",
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
 * Upload return files (Admin)
 * Do NOT set Content-Type manually — axios sets multipart/form-data
 * with the correct boundary automatically when body is FormData.
 */
export const uploadReturnFiles = createAsyncThunk(
  "adminReturn/uploadReturnFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("attachments", file));

      const { data } = await axios.post(
        `/api/v1/admin/returns/${orderId}/upload`,
        formData,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to upload files"
      );
    }
  }
);

/**
 * Get returns with unread messages
 * FIX: Result is stored in state.unreadReturns (not state.returns) so a
 * background badge poll never overwrites the admin's paginated list view.
 */
export const getReturnsWithUnreadMessages = createAsyncThunk(
  "adminReturn/getReturnsWithUnreadMessages",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/returns/unread`, {
        withCredentials: true,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch unread returns"
      );
    }
  }
);

const adminReturnSlice = createSlice({
  name: "adminReturn",
  initialState: {
    returns: [],
    // FIX: Unread results live here — isolated from the paginated list so a
    // background poll never silently replaces what the admin is looking at.
    unreadReturns: [],
    stats: null,
    currentReturn: null,
    messages: [],
    // FIX: Track which message page is currently loaded so the UI can
    // implement "load more" without re-fetching from page 1 every time.
    messagesPage: 1,
    hasMoreMessages: false,
    timeline: [],
    documents: [],

    // Pagination — populated by getAllReturns, untouched by unread fetch
    pagination: {
      totalReturns: 0,
      currentPage: 1,
      totalPages: 1,
    },

    loading: false,
    returnsLoading: false,
    // FIX: dedicated flag so the unread badge fetch does not trigger the
    // detail panel spinner that reads state.loading.
    unreadLoading: false,
    // FIX: dedicated flag for message send — was incorrectly sharing
    // state.loading with reviewReturn and updateReturnStatus, causing the wrong
    // UI element to show a spinner when a message was being sent.
    messageSendLoading: false,
    messagesLoading: false,
    timelineLoading: false,
    documentsLoading: false,
    uploadLoading: false,

    error: null,
    success: false,
    message: null,
  },
  reducers: {
    clearAdminReturnState: (state) => {
      state.error = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentReturn: (state) => {
      state.currentReturn = null;
      state.messages = [];
      state.messagesPage = 1;
      state.hasMoreMessages = false;
      state.timeline = [];
      state.documents = [];
    },
  },
  extraReducers: (builder) => {
    // ── Get All Returns ─────────────────────────────────────────────────────
    builder
      .addCase(getAllReturns.pending, (state) => {
        state.returnsLoading = true;
        state.error = null;
      })
      .addCase(getAllReturns.fulfilled, (state, action) => {
        state.returnsLoading = false;
        state.returns = action.payload.returns;
        state.stats = action.payload.stats;
        state.pagination = {
          totalReturns: action.payload.totalReturns,
          currentPage: action.payload.currentPage,
          totalPages: action.payload.totalPages,
        };
      })
      .addCase(getAllReturns.rejected, (state, action) => {
        state.returnsLoading = false;
        state.error = action.payload;
      });

    // ── Get Single Return ───────────────────────────────────────────────────
    builder
      .addCase(getSingleReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleReturn.fulfilled, (state, action) => {
        state.loading = false;
        state.currentReturn = action.payload.order;
      })
      .addCase(getSingleReturn.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Review Return ───────────────────────────────────────────────────────
    builder
      .addCase(reviewReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reviewReturn.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        // FIX: Defensive dual-shape patch — handles both the current backend
        // response shape (returnInfo) and a hypothetical future full-order
        // response (order), so this won't silently break if the backend changes.
        if (state.currentReturn) {
          if (action.payload.order) {
            state.currentReturn = action.payload.order;
          } else if (action.payload.returnInfo) {
            state.currentReturn = {
              ...state.currentReturn,
              returnInfo: action.payload.returnInfo,
            };
          }
        }
      })
      .addCase(reviewReturn.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Update Return Status ────────────────────────────────────────────────
    builder
      .addCase(updateReturnStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateReturnStatus.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        // FIX: Same dual-shape defensive patch as reviewReturn.
        if (state.currentReturn) {
          if (action.payload.order) {
            state.currentReturn = action.payload.order;
          } else if (action.payload.returnInfo) {
            state.currentReturn = {
              ...state.currentReturn,
              returnInfo: action.payload.returnInfo,
            };
          }
        }
      })
      .addCase(updateReturnStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ── Add Return Message ──────────────────────────────────────────────────
    // FIX: Uses messageSendLoading instead of loading so sending a message
    // doesn't accidentally trigger the review/status-update action spinner.
    builder
      .addCase(addReturnMessage.pending, (state) => {
        state.messageSendLoading = true;
        state.error = null;
      })
      .addCase(addReturnMessage.fulfilled, (state, action) => {
        state.messageSendLoading = false;
        state.success = true;
        const newMsg = action.payload?.data?.message;
        if (newMsg) {
          state.messages.push(newMsg);
        }
      })
      .addCase(addReturnMessage.rejected, (state, action) => {
        state.messageSendLoading = false;
        state.error = action.payload;
      });

    // ── Get Return Messages ─────────────────────────────────────────────────
    // FIX: Page 1 replaces messages (fresh load); subsequent pages prepend
    // older messages so newest stays at the bottom (load more / scroll up).
    // hasMoreMessages signals whether another page exists.
    builder
      .addCase(getReturnMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error = null;
      })
      .addCase(getReturnMessages.fulfilled, (state, action) => {
        state.messagesLoading = false;
        const { messages, count, page } = action.payload;
        const PAGE_LIMIT = 50;
        if (page === 1) {
          state.messages = messages;
        } else {
          // Prepend older messages so newest stays at the bottom
          state.messages = [...messages, ...state.messages];
        }
        state.messagesPage = page;
        state.hasMoreMessages = count === PAGE_LIMIT;
      })
      .addCase(getReturnMessages.rejected, (state, action) => {
        state.messagesLoading = false;
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
        state.timeline = action.payload.timeline;
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
        state.documents = action.payload.documents;
      })
      .addCase(getReturnDocuments.rejected, (state, action) => {
        state.documentsLoading = false;
        state.error = action.payload;
      });

    // ── Upload Return Files ─────────────────────────────────────────────────
    builder
      .addCase(uploadReturnFiles.pending, (state) => {
        state.uploadLoading = true;
        state.error = null;
      })
      .addCase(uploadReturnFiles.fulfilled, (state, action) => {
        state.uploadLoading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(uploadReturnFiles.rejected, (state, action) => {
        state.uploadLoading = false;
        state.error = action.payload;
      });

    // ── Get Returns With Unread Messages ────────────────────────────────────
    // FIX: Writes to state.unreadReturns — not state.returns — so a
    // background badge poll never replaces the admin's paginated list.
    builder
      .addCase(getReturnsWithUnreadMessages.pending, (state) => {
        state.unreadLoading = true;
        state.error = null;
      })
      .addCase(getReturnsWithUnreadMessages.fulfilled, (state, action) => {
        state.unreadLoading = false;
        state.unreadReturns = action.payload.returns;
      })
      .addCase(getReturnsWithUnreadMessages.rejected, (state, action) => {
        state.unreadLoading = false;
        state.error = action.payload;
      });
  },
});

export const { clearAdminReturnState, clearCurrentReturn } =
  adminReturnSlice.actions;
export default adminReturnSlice.reducer;