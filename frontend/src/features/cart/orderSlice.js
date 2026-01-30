// features/order/orderSlice.js - CUSTOMER ONLY (Admin moved to adminSlice)
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// API BASE CONFIGURATION
// ============================================
const API_BASE = "/api/v1";

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create FormData for file uploads
 */
const createFormDataWithFiles = (data, files = []) => {
  const formData = new FormData();
  
  // Add regular fields
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      if (typeof data[key] === 'object' && !Array.isArray(data[key])) {
        formData.append(key, JSON.stringify(data[key]));
      } else if (Array.isArray(data[key])) {
        formData.append(key, JSON.stringify(data[key]));
      } else {
        formData.append(key, data[key]);
      }
    }
  });
  
  // Add files
  files.forEach((file) => {
    formData.append(`images`, file);
  });
  
  return formData;
};

// ============================================
// BASIC ORDER OPERATIONS
// ============================================

/**
 * Get all orders for logged-in user
 */
export const getAllMyOrders = createAsyncThunk(
  "order/getAllMyOrders",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/user`, {
        withCredentials: true,
      });
      return data.orders;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch orders"
      );
    }
  }
);

/**
 * Get single order details
 */
export const getOrderDetails = createAsyncThunk(
  "order/getOrderDetails",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/order/${id}`, {
        withCredentials: true,
      });
      return data.order;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch order details"
      );
    }
  }
);

/**
 * Get order by reference number
 */
export const getOrderByReference = createAsyncThunk(
  "order/getOrderByReference",
  async (reference, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/reference/${reference}`, {
        withCredentials: true,
      });
      return data.order;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch order"
      );
    }
  }
);

/**
 * Create new order
 */
export const createOrder = createAsyncThunk(
  "order/createOrder",
  async (orderData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${API_BASE}/order/new`, orderData, {
        withCredentials: true,
      });
      return data.order;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to create order"
      );
    }
  }
);

// ============================================
// STATUS HISTORY & TIMELINE
// ============================================

/**
 * Get order timeline/status history
 */
export const getOrderTimeline = createAsyncThunk(
  "order/getOrderTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/${orderId}/timeline`, {
        withCredentials: true,
      });
      return { orderId, timeline: data.timeline, currentStatus: data.currentStatus };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch order timeline"
      );
    }
  }
);

// ============================================
// NOTES & COMMUNICATION
// ============================================

/**
 * Add note to order (with optional attachments)
 */
export const addOrderNote = createAsyncThunk(
  "order/addOrderNote",
  async ({ orderId, content, type = "customer", attachments = [] }, { rejectWithValue }) => {
    try {
      const formData = createFormDataWithFiles(
        { content, type },
        attachments
      );

      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/notes`,
        formData,
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return { orderId, note: data.note };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to add note"
      );
    }
  }
);

/**
 * Get all notes for order
 */
export const getOrderNotes = createAsyncThunk(
  "order/getOrderNotes",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/${orderId}/notes`, {
        withCredentials: true,
      });
      return { orderId, notes: data.notes };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch notes"
      );
    }
  }
);

/**
 * Edit a note
 */
export const editOrderNote = createAsyncThunk(
  "order/editOrderNote",
  async ({ orderId, noteId, content }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_BASE}/orders/${orderId}/notes/${noteId}`,
        { content },
        { withCredentials: true }
      );
      return { orderId, noteId, note: data.note };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to edit note"
      );
    }
  }
);

// ============================================
// TRACKING INFORMATION
// ============================================

/**
 * Get tracking information for order
 */
export const getTrackingInfo = createAsyncThunk(
  "order/getTrackingInfo",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/${orderId}/tracking`, {
        withCredentials: true,
      });
      return { orderId, tracking: data.tracking };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch tracking info"
      );
    }
  }
);

// ============================================
// ORDER MESSAGES (Customer)
// ============================================

/**
 * Add message to order
 */
export const addOrderMessage = createAsyncThunk(
  "order/addOrderMessage",
  async ({ orderId, content, attachments = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/messages`,
        { content, attachments },
        { withCredentials: true }
      );
      return { orderId, message: data.orderMessage };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send message"
      );
    }
  }
);

/**
 * Get order messages
 */
export const getOrderMessages = createAsyncThunk(
  "order/getOrderMessages",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/messages`,
        { withCredentials: true }
      );
      return { orderId, messages: data.messages };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch messages"
      );
    }
  }
);

/**
 * Mark order messages as read
 */
export const markOrderMessagesRead = createAsyncThunk(
  "order/markOrderMessagesRead",
  async (orderId, { rejectWithValue }) => {
    try {
      await axios.put(
        `${API_BASE}/orders/${orderId}/messages/read`,
        {},
        { withCredentials: true }
      );
      return { orderId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to mark messages as read"
      );
    }
  }
);

// ============================================
// RETURN MANAGEMENT (Customer)
// ============================================

/**
 * Request return for order
 */
export const requestReturn = createAsyncThunk(
  "order/requestReturn",
  async ({ orderId, reason, itemsToReturn, images = [] }, { rejectWithValue }) => {
    try {
      const formData = createFormDataWithFiles(
        { reason, itemsToReturn: JSON.stringify(itemsToReturn) },
        images
      );

      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/return/request`,
        formData,
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return { orderId, returnInfo: data.returnInfo };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to request return"
      );
    }
  }
);

/**
 * Add message to return
 */
export const addReturnMessage = createAsyncThunk(
  "order/addReturnMessage",
  async ({ orderId, content, attachments = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/return/messages`,
        { content, attachments },
        { withCredentials: true }
      );
      return { orderId, message: data.data.message };
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
  "order/getReturnMessages",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/return/messages`,
        { withCredentials: true }
      );
      return { orderId, messages: data.messages };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch messages"
      );
    }
  }
);

/**
 * Get return timeline
 */
export const getReturnTimeline = createAsyncThunk(
  "order/getReturnTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/return/timeline`,
        { withCredentials: true }
      );
      return { orderId, timeline: data.timeline };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch timeline"
      );
    }
  }
);

/**
 * Get return documents
 */
export const getReturnDocuments = createAsyncThunk(
  "order/getReturnDocuments",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/return/documents`,
        { withCredentials: true }
      );
      return { orderId, documents: data.documents };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch documents"
      );
    }
  }
);

/**
 * Upload files for return
 */
export const uploadReturnFiles = createAsyncThunk(
  "order/uploadReturnFiles",
  async ({ orderId, files }, { rejectWithValue, dispatch }) => {
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('attachments', file);
      });

      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/return/upload`,
        formData,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            dispatch(setUploadProgress(percentCompleted));
          }
        }
      );
      
      dispatch(setUploadProgress(0));
      return { orderId, files: data.files };
    } catch (error) {
      dispatch(setUploadProgress(0));
      return rejectWithValue(
        error.response?.data?.message || "Failed to upload files"
      );
    }
  }
);

/**
 * Cancel return request
 */
export const cancelReturnRequest = createAsyncThunk(
  "order/cancelReturnRequest",
  async (orderId, { rejectWithValue }) => {
    try {
      await axios.put(
        `${API_BASE}/orders/${orderId}/return/cancel`,
        {},
        { withCredentials: true }
      );
      return { orderId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to cancel return"
      );
    }
  }
);

// ============================================
// REFUND MANAGEMENT (Customer)
// ============================================

/**
 * Request refund for order (with images)
 */
export const requestRefund = createAsyncThunk(
  "order/requestRefund",
  async ({ orderId, reason, description, refundType = 'full', requestedAmount, images = [] }, { rejectWithValue }) => {
    try {
      const formData = createFormDataWithFiles(
        { reason, description, refundType, requestedAmount },
        images
      );

      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/refund/request`,
        formData,
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return { orderId, refundInfo: data.refundInfo };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to request refund"
      );
    }
  }
);

/**
 * Get refund messages (lazy load)
 */
export const getRefundMessages = createAsyncThunk(
  "order/getRefundMessages",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/refund/messages`,
        { withCredentials: true }
      );
      return { orderId, messages: data.messages };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch messages"
      );
    }
  }
);

/**
 * Add refund message
 */
export const addRefundMessage = createAsyncThunk(
  "order/addRefundMessage",
  async ({ orderId, message, attachments = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/refund/messages`,
        { message, attachments },
        { withCredentials: true }
      );
      return { orderId, message: data.data.message };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send message"
      );
    }
  }
);

/**
 * Upload refund files
 */
export const uploadRefundFiles = createAsyncThunk(
  "order/uploadRefundFiles",
  async ({ orderId, files }, { rejectWithValue, dispatch }) => {
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('attachments', file);
      });

      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/refund/upload`,
        formData,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            dispatch(setUploadProgress(percentCompleted));
          }
        }
      );
      
      dispatch(setUploadProgress(0));
      return { orderId, files: data.files };
    } catch (error) {
      dispatch(setUploadProgress(0));
      return rejectWithValue(
        error.response?.data?.message || "Failed to upload files"
      );
    }
  }
);

/**
 * Cancel refund request
 */
export const cancelRefundRequest = createAsyncThunk(
  "order/cancelRefundRequest",
  async (orderId, { rejectWithValue }) => {
    try {
      await axios.put(
        `${API_BASE}/orders/${orderId}/refund/cancel`,
        {},
        { withCredentials: true }
      );
      return { orderId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to cancel refund"
      );
    }
  }
);

/**
 * Get refund timeline
 */
export const getRefundTimeline = createAsyncThunk(
  "order/getRefundTimeline",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/refund/timeline`,
        { withCredentials: true }
      );
      return { orderId, timeline: data.timeline };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch timeline"
      );
    }
  }
);

/**
 * Get refund documents
 */
export const getRefundDocuments = createAsyncThunk(
  "order/getRefundDocuments",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/refund/documents`,
        { withCredentials: true }
      );
      return { orderId, documents: data.documents };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch documents"
      );
    }
  }
);

// ============================================
// INVOICE MANAGEMENT
// ============================================

/**
 * Download invoice for order
 */
export const downloadInvoice = createAsyncThunk(
  "order/downloadInvoice",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/${orderId}/invoice`, {
        withCredentials: true,
      });
      return { orderId, invoice: data.invoice };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to download invoice"
      );
    }
  }
);

// ============================================
// SLICE DEFINITION
// ============================================

const orderSlice = createSlice({
  name: "order",
  initialState: {
    orders: [],
    order: null,
    timeline: [],
    notes: [],
    tracking: null,
    refundMessages: [],
    refundTimeline: [],
    refundDocuments: [],
    uploadProgress: 0,
    returnInfo: null,
    refundInfo: null,
    invoice: null,
    orderMessages: [],
    returnMessages: [],
    returnTimeline: [],
    returnDocuments: [],
    
    loading: false,
    actionLoading: false,
    error: null,
    success: false,
    message: null,
  },
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    clearMessage: (state) => {
      state.message = null;
      state.success = false;
    },
    clearOrder: (state) => {
      state.order = null;
      state.timeline = [];
      state.notes = [];
      state.tracking = null;
      state.invoice = null;
    },
    setActionLoading: (state, action) => {
      state.actionLoading = action.payload;
    },
    setUploadProgress: (state, action) => {
      state.uploadProgress = action.payload;
    },
  },
  extraReducers: (builder) => {
    // ============================================
    // GET ALL MY ORDERS
    // ============================================
    builder
      .addCase(getAllMyOrders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getAllMyOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.orders = action.payload;
      })
      .addCase(getAllMyOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ============================================
    // GET ORDER DETAILS
    // ============================================
    builder
      .addCase(getOrderDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getOrderDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.order = action.payload;
        state.success = true;
      })
      .addCase(getOrderDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ============================================
    // GET ORDER BY REFERENCE
    // ============================================
    builder
      .addCase(getOrderByReference.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getOrderByReference.fulfilled, (state, action) => {
        state.loading = false;
        state.order = action.payload;
        state.success = true;
      })
      .addCase(getOrderByReference.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ============================================
    // CREATE ORDER
    // ============================================
    builder
      .addCase(createOrder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.order = action.payload;
        state.success = true;
        state.message = "Order created successfully";
      })
      .addCase(createOrder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ============================================
    // GET ORDER TIMELINE
    // ============================================
    builder
      .addCase(getOrderTimeline.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getOrderTimeline.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.timeline = action.payload.timeline;
        if (state.order) {
          state.order.orderStatus = action.payload.currentStatus;
        }
      })
      .addCase(getOrderTimeline.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // NOTES MANAGEMENT
    // ============================================
    builder
      .addCase(addOrderNote.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(addOrderNote.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.notes.push(action.payload.note);
        if (state.order?.notes) {
          state.order.notes.push(action.payload.note);
        }
        state.message = "Note added successfully";
      })
      .addCase(addOrderNote.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getOrderNotes.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getOrderNotes.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.notes = action.payload.notes;
      })
      .addCase(getOrderNotes.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(editOrderNote.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(editOrderNote.fulfilled, (state, action) => {
        state.actionLoading = false;
        const index = state.notes.findIndex(note => note._id === action.payload.noteId);
        if (index !== -1) {
          state.notes[index] = action.payload.note;
        }
        state.message = "Note updated successfully";
      })
      .addCase(editOrderNote.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // TRACKING MANAGEMENT
    // ============================================
    builder
      .addCase(getTrackingInfo.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getTrackingInfo.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.tracking = action.payload.tracking;
        if (state.order) {
          state.order.tracking = action.payload.tracking;
        }
      })
      .addCase(getTrackingInfo.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // ORDER MESSAGES
    // ============================================
    builder
      .addCase(addOrderMessage.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(addOrderMessage.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.orderMessages.push(action.payload.message);
        state.message = "Message sent successfully";
      })
      .addCase(addOrderMessage.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getOrderMessages.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getOrderMessages.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.orderMessages = action.payload.messages;
      })
      .addCase(getOrderMessages.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(markOrderMessagesRead.fulfilled, (state) => {
        state.orderMessages = state.orderMessages.map(msg => ({
          ...msg,
          isRead: true
        }));
      });

    // ============================================
    // RETURN MANAGEMENT
    // ============================================
    builder
      .addCase(requestReturn.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(requestReturn.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.returnInfo = action.payload.returnInfo;
        if (state.order) {
          state.order.returnInfo = action.payload.returnInfo;
        }
        state.message = "Return request submitted successfully";
        state.success = true;
      })
      .addCase(requestReturn.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(addReturnMessage.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(addReturnMessage.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.returnMessages.push(action.payload.message);
        state.message = "Message sent successfully";
      })
      .addCase(addReturnMessage.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getReturnMessages.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getReturnMessages.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.returnMessages = action.payload.messages;
      })
      .addCase(getReturnMessages.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getReturnTimeline.fulfilled, (state, action) => {
        state.returnTimeline = action.payload.timeline;
      });

    builder
      .addCase(getReturnDocuments.fulfilled, (state, action) => {
        state.returnDocuments = action.payload.documents;
      });

    builder
      .addCase(uploadReturnFiles.fulfilled, (state, action) => {
        state.returnDocuments.push(...action.payload.files);
      });

    builder
      .addCase(cancelReturnRequest.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(cancelReturnRequest.fulfilled, (state) => {
        state.actionLoading = false;
        state.returnInfo = null;
        state.message = "Return request cancelled successfully";
      })
      .addCase(cancelReturnRequest.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // REFUND MANAGEMENT
    // ============================================
    builder
      .addCase(requestRefund.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(requestRefund.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.refundInfo = action.payload.refundInfo;
        if (state.order) {
          state.order.refundInfo = action.payload.refundInfo;
        }
        state.message = "Refund request submitted successfully";
        state.success = true;
      })
      .addCase(requestRefund.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getRefundMessages.fulfilled, (state, action) => {
        state.refundMessages = action.payload.messages;
      })
      .addCase(addRefundMessage.fulfilled, (state, action) => {
        state.refundMessages.push(action.payload.message);
      })
      .addCase(uploadRefundFiles.fulfilled, (state, action) => {
        state.refundDocuments.push(...action.payload.files);
      })
      .addCase(cancelRefundRequest.fulfilled, (state) => {
        state.refundInfo = null;
        state.message = "Refund request cancelled";
      })
      .addCase(getRefundTimeline.fulfilled, (state, action) => {
        state.refundTimeline = action.payload.timeline;
      })
      .addCase(getRefundDocuments.fulfilled, (state, action) => {
        state.refundDocuments = action.payload.documents;
      });

    // ============================================
    // INVOICE MANAGEMENT
    // ============================================
    builder
      .addCase(downloadInvoice.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(downloadInvoice.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.invoice = action.payload.invoice;
      })
      .addCase(downloadInvoice.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });
  },
});

export const { 
  removeErrors, 
  clearMessage, 
  clearOrder, 
  setActionLoading, 
  setUploadProgress 
} = orderSlice.actions;

export default orderSlice.reducer;