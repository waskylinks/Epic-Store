// Frontend/src/features/returns/adminReturnSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/**
 * Get all return requests (Admin)
 */
export const getAllReturns = createAsyncThunk(
  "adminReturn/getAllReturns",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/admin/returns${params ? `?${params}` : ''}`,
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
      const { data } = await axios.get(
        `/api/v1/admin/returns/${orderId}`,
        { withCredentials: true }
      );
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
  async ({ orderId, content, attachments }, { rejectWithValue }) => {
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
 */
export const getReturnMessages = createAsyncThunk(
  "adminReturn/getReturnMessages",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/orders/${orderId}/return/messages`,
        { withCredentials: true }
      );
      return data;
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
 */
export const uploadReturnFiles = createAsyncThunk(
  "adminReturn/uploadReturnFiles",
  async ({ orderId, files }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('attachments', file));
      
      const { data } = await axios.post(
        `/api/v1/admin/returns/${orderId}/upload`,
        formData,
        { 
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' }
        }
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
 */
export const getReturnsWithUnreadMessages = createAsyncThunk(
  "adminReturn/getReturnsWithUnreadMessages",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/admin/returns/unread`,
        { withCredentials: true }
      );
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
    stats: null,
    currentReturn: null,
    messages: [],
    timeline: [],
    documents: [],
    
    loading: false,
    returnsLoading: false,
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
      state.timeline = [];
      state.documents = [];
    }
  },
  extraReducers: (builder) => {
    // Get All Returns
    builder
      .addCase(getAllReturns.pending, (state) => {
        state.returnsLoading = true;
        state.error = null;
      })
      .addCase(getAllReturns.fulfilled, (state, action) => {
        state.returnsLoading = false;
        state.returns = action.payload.returns;
        state.stats = action.payload.stats;
      })
      .addCase(getAllReturns.rejected, (state, action) => {
        state.returnsLoading = false;
        state.error = action.payload;
      });

    // Get Single Return
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

    // Review Return
    builder
      .addCase(reviewReturn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reviewReturn.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(reviewReturn.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Update Return Status
    builder
      .addCase(updateReturnStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateReturnStatus.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(updateReturnStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Add Return Message
    builder
      .addCase(addReturnMessage.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addReturnMessage.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.messages.push(action.payload.data.message);
      })
      .addCase(addReturnMessage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Get Return Messages
    builder
      .addCase(getReturnMessages.pending, (state) => {
        state.messagesLoading = true;
        state.error = null;
      })
      .addCase(getReturnMessages.fulfilled, (state, action) => {
        state.messagesLoading = false;
        state.messages = action.payload.messages;
      })
      .addCase(getReturnMessages.rejected, (state, action) => {
        state.messagesLoading = false;
        state.error = action.payload;
      });

    // Get Return Timeline
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

    // Get Return Documents
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

    // Upload Return Files
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

    // Get Returns with Unread Messages
    builder
      .addCase(getReturnsWithUnreadMessages.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getReturnsWithUnreadMessages.fulfilled, (state, action) => {
        state.loading = false;
        state.returns = action.payload.returns;
      })
      .addCase(getReturnsWithUnreadMessages.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearAdminReturnState, clearCurrentReturn } = adminReturnSlice.actions;
export default adminReturnSlice.reducer;