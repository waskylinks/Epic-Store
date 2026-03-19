// features/admin/adminReturnSlice.js

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const uploadFiles = async (orderId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append('attachments', f));
  const { data } = await axios.post(
    `/api/v1/admin/returns/${orderId}/upload`,
    formData,
    { withCredentials: true }
  );
  const receivedAt = new Date().toISOString();
  return (data.files ?? []).map(({ url, filename, fileType, fileSize }) => ({
    url, filename, fileType, fileSize, uploadedAt: receivedAt,
  }));
};

const extractErrorMessage = (payload, fallback) => {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') return payload.message ?? fallback;
  return fallback;
};

// ─────────────────────────────────────────────────────────────────────────────
// THUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const getAllReturns = createAsyncThunk(
  'adminReturn/getAllReturns',
  async (params = {}, { rejectWithValue }) => {
    try {
      const query = new URLSearchParams();
      if (params.page)    query.set('page',    params.page);
      if (params.limit)   query.set('limit',   params.limit);
      if (params.status)  query.set('status',  params.status);
      if (params.from)    query.set('from',    params.from);
      if (params.to)      query.set('to',      params.to);
      if (params.rma)     query.set('rma',     params.rma);
      if (params.sortBy)  query.set('sortBy',  params.sortBy);
      if (params.order)   query.set('order',   params.order);
      const { data } = await axios.get(
        `/api/v1/admin/returns?${query.toString()}`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to fetch returns');
    }
  }
);

export const getReturnsWithUnreadMessages = createAsyncThunk(
  'adminReturn/getReturnsWithUnreadMessages',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/returns/unread', { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to fetch unread returns');
    }
  }
);

export const getSingleReturn = createAsyncThunk(
  'adminReturn/getSingleReturn',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/returns/${orderId}`, { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to fetch return');
    }
  }
);

export const reviewReturn = createAsyncThunk(
  'adminReturn/reviewReturn',
  async ({ orderId, itemDecisions, adminNote }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/review`,
        { itemDecisions, adminNote },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to review return');
    }
  }
);

export const submitAdminPleaReview = createAsyncThunk(
  'adminReturn/submitAdminPleaReview',
  async ({ orderId, itemDecisions, adminNote }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/plea-review`,
        { itemDecisions, adminNote },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to submit plea review');
    }
  }
);

// generateDiscountCode: transitions inspected → awaiting_discount.
// The discount creation page handles awaiting_discount → completed.
export const generateDiscountCode = createAsyncThunk(
  'adminReturn/generateDiscountCode',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/orders/${orderId}/return/generate-discount`,
        {},
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to generate discount code');
    }
  }
);

export const updateReturnStatus = createAsyncThunk(
  'adminReturn/updateReturnStatus',
  async ({ orderId, status, inspectionNotes }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/return/status`,
        { status, inspectionNotes },
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to update return status');
    }
  }
);

export const sendReturnMessage = createAsyncThunk(
  'adminReturn/sendReturnMessage',
  async ({ orderId, content, files = [], pendingUrls = [] }, { rejectWithValue }) => {
    let attachmentUrls = [...pendingUrls];

    if (files.length > 0 && pendingUrls.length === 0) {
      try {
        attachmentUrls = await uploadFiles(orderId, files);
      } catch (err) {
        return rejectWithValue({
          stage:       'upload',
          message:     err.response?.data?.message ?? 'Failed to upload files',
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
        stage:       'send',
        message:     err.response?.data?.message ?? 'Failed to send message',
        pendingUrls: attachmentUrls,
      });
    }
  }
);

export const getReturnMessages = createAsyncThunk(
  'adminReturn/getReturnMessages',
  async ({ orderId, page = 1, limit = 50 }, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/messages?page=${page}&limit=${limit}`,
        { withCredentials: true }
      );
      return { ...data, page, limit };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to fetch messages');
    }
  }
);

export const getReturnTimeline = createAsyncThunk(
  'adminReturn/getReturnTimeline',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/timeline`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to fetch timeline');
    }
  }
);

export const getReturnDocuments = createAsyncThunk(
  'adminReturn/getReturnDocuments',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/documents`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to fetch documents');
    }
  }
);

export const uploadReturnFiles = createAsyncThunk(
  'adminReturn/uploadReturnFiles',
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const uploadedFiles = await uploadFiles(orderId, files);
      return { files: uploadedFiles };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? 'Failed to upload files');
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL STATE
// ─────────────────────────────────────────────────────────────────────────────

const initialState = {
  // List
  returns:       [],
  unreadReturns: [],

  // Stats
  stats: null,
  // FIX: totalRequestedAmount stored as top-level field for KPI card.
  // Backend puts it inside stats.totalRequestedAmount — we extract it here.
  totalRequestedAmount: 0,

  // Pagination
  pagination: {
    currentPage:  1,
    totalPages:   1,
    totalReturns: 0,
  },

  // Detail
  currentReturn: null,

  // Messages
  messages:        [],
  messagesPage:    1,
  totalMessages:   0,
  hasMoreMessages: false,
  pendingAttachments: [],
  errorStage:      null,

  // Timeline / Documents
  timeline:  [],
  documents: [],

  // Loading flags
  loading:             false,
  returnsLoading:      false,
  unreadLoading:       false,
  messageSendLoading:  false,
  messagesLoading:     false,
  timelineLoading:     false,
  documentsLoading:    false,
  uploadLoading:       false,
  pleaReviewLoading:   false,
  discountCodeLoading: false,

  // Feedback
  error:   null,
  success: false,
  message: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const adminReturnSlice = createSlice({
  name: 'adminReturn',
  initialState,

  reducers: {
    clearAdminReturnState: (state) => {
      state.error   = null;
      state.success = false;
      state.message = null;
    },

    clearCurrentReturn: (state) => {
      state.currentReturn = null;
    },

    clearReturnMessages: (state) => {
      state.messages           = [];
      state.messagesPage       = 1;
      state.totalMessages      = 0;
      state.hasMoreMessages    = false;
      state.pendingAttachments = [];
      state.errorStage         = null;
      state.messageSendLoading = false;
    },

    clearPendingAttachments: (state) => {
      state.pendingAttachments = [];
      state.errorStage         = null;
    },
  },

  extraReducers: (builder) => {

    // ── getAllReturns ────────────────────────────────────────────────────────
    builder
      .addCase(getAllReturns.pending, (state) => {
        state.returnsLoading = true;
        state.error          = null;
      })
      .addCase(getAllReturns.fulfilled, (state, { payload }) => {
        state.returnsLoading = false;
        state.returns        = payload.returns ?? [];
        state.pagination     = {
          currentPage:  payload.currentPage  ?? 1,
          totalPages:   payload.totalPages   ?? 1,
          totalReturns: payload.totalReturns ?? 0,
        };
        if (payload.stats) {
          state.stats = payload.stats;
          // FIX: extract totalRequestedAmount from stats into its own top-level field
          // so AdminReturns.jsx can destructure it directly from state.adminReturn
          state.totalRequestedAmount = payload.stats.totalRequestedAmount ?? 0;
        }
      })
      .addCase(getAllReturns.rejected, (state, { payload }) => {
        state.returnsLoading = false;
        state.error          = extractErrorMessage(payload, 'Failed to fetch returns');
      });

    // ── getReturnsWithUnreadMessages ─────────────────────────────────────────
    builder
      .addCase(getReturnsWithUnreadMessages.pending, (state) => {
        state.unreadLoading = true;
        state.error         = null;
      })
      .addCase(getReturnsWithUnreadMessages.fulfilled, (state, { payload }) => {
        state.unreadLoading = false;
        state.unreadReturns = payload.returns ?? [];
      })
      .addCase(getReturnsWithUnreadMessages.rejected, (state, { payload }) => {
        state.unreadLoading = false;
        state.error         = extractErrorMessage(payload, 'Failed to fetch unread returns');
      });

    // ── getSingleReturn ──────────────────────────────────────────────────────
    builder
      .addCase(getSingleReturn.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getSingleReturn.fulfilled, (state, { payload }) => {
        state.loading        = false;
        state.currentReturn  = payload.order ?? null;
      })
      .addCase(getSingleReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, 'Failed to fetch return');
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
        state.message = payload.message ?? 'Items reviewed successfully';
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(reviewReturn.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, 'Failed to review return');
      });

    // ── submitAdminPleaReview ────────────────────────────────────────────────
    builder
      .addCase(submitAdminPleaReview.pending, (state) => {
        state.pleaReviewLoading = true;
        state.error             = null;
      })
      .addCase(submitAdminPleaReview.fulfilled, (state, { payload }) => {
        state.pleaReviewLoading = false;
        state.success           = true;
        state.message           = payload.message ?? 'Plea resolved successfully';
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(submitAdminPleaReview.rejected, (state, { payload }) => {
        state.pleaReviewLoading = false;
        state.error             = extractErrorMessage(payload, 'Failed to resolve plea');
      });

    // ── generateDiscountCode ─────────────────────────────────────────────────
    // FIX: now transitions to 'awaiting_discount' (not 'completed').
    // Patch currentReturn.returnInfo.status accordingly.
    builder
      .addCase(generateDiscountCode.pending, (state) => {
        state.discountCodeLoading = true;
        state.error               = null;
      })
      .addCase(generateDiscountCode.fulfilled, (state, { payload }) => {
        state.discountCodeLoading = false;
        state.success             = true;
        state.message             = payload.message ?? 'Discount code generation initiated';
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(generateDiscountCode.rejected, (state, { payload }) => {
        state.discountCodeLoading = false;
        state.error               = extractErrorMessage(payload, 'Failed to generate discount code');
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
        state.message = payload.message ?? 'Status updated';
        if (state.currentReturn && payload.returnInfo) {
          state.currentReturn = {
            ...state.currentReturn,
            returnInfo: payload.returnInfo,
          };
        }
      })
      .addCase(updateReturnStatus.rejected, (state, { payload }) => {
        state.loading = false;
        state.error   = extractErrorMessage(payload, 'Failed to update status');
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
        if (newMsg && typeof newMsg === 'object') state.messages.push(newMsg);
      })
      .addCase(sendReturnMessage.rejected, (state, { payload }) => {
        state.messageSendLoading = false;
        state.error              = extractErrorMessage(payload, 'Failed to send message');
        state.errorStage         = payload?.stage ?? null;
        if (payload?.stage === 'send' && payload.pendingUrls?.length) {
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

        if (page === 1) {
          state.messages = messages;
        } else {
          state.messages = [...messages, ...state.messages];
        }

        state.messagesPage    = page;
        state.totalMessages   = totalCount ?? 0;
        state.hasMoreMessages = (page * limit) < (totalCount ?? 0);
      })
      .addCase(getReturnMessages.rejected, (state, { payload }) => {
        state.messagesLoading = false;
        state.error           = extractErrorMessage(payload, 'Failed to fetch messages');
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
        state.error           = extractErrorMessage(payload, 'Failed to fetch timeline');
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
        state.error            = extractErrorMessage(payload, 'Failed to fetch documents');
      });

    // ── uploadReturnFiles ────────────────────────────────────────────────────
    builder
      .addCase(uploadReturnFiles.pending,   (state) => { state.uploadLoading = true;  state.error = null; })
      .addCase(uploadReturnFiles.fulfilled, (state, { payload }) => {
        state.uploadLoading = false;
        state.documents     = [...state.documents, ...(payload.files ?? [])];
      })
      .addCase(uploadReturnFiles.rejected,  (state, { payload }) => {
        state.uploadLoading = false;
        state.error         = extractErrorMessage(payload, 'Failed to upload files');
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