// features/order/orderSlice.js - CUSTOMER with Analytics Integration
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

// ============================================
// ANALYTICS HELPERS
// ============================================

/**
 * Get UTM parameters from URL
 */
const getUTMParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_term: params.get('utm_term'),
    utm_content: params.get('utm_content')
  };
};

/**
 * Detect device and browser
 */
const getDeviceInfo = () => {
  const ua = navigator.userAgent;
  const isMobile = /mobile/i.test(ua);
  const isTablet = /tablet|ipad/i.test(ua);
  
  let browser = 'unknown';
  if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/edge/i.test(ua)) browser = 'Edge';
  
  return {
    device: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
    browser
  };
};

/**
 * Get analytics data for order
 */
const getAnalyticsData = () => {
  const utmParams = getUTMParams();
  const deviceInfo = getDeviceInfo();
  
  // Get stored session data if available
  const sessionId = sessionStorage.getItem('sessionId') || 
    `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const landingPage = sessionStorage.getItem('landingPage') || window.location.pathname;
  
  // Store session ID if new
  if (!sessionStorage.getItem('sessionId')) {
    sessionStorage.setItem('sessionId', sessionId);
    sessionStorage.setItem('landingPage', window.location.pathname);
  }
  
  return {
    source: utmParams.utm_source || 'direct',
    medium: utmParams.utm_medium,
    campaign: utmParams.utm_campaign,
    term: utmParams.utm_term,
    content: utmParams.utm_content,
    device: deviceInfo.device,
    browser: deviceInfo.browser,
    referrer: document.referrer || null,
    landingPage,
    sessionId
  };
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const createFormDataWithFiles = (data, files = []) => {
  const formData = new FormData();
  
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
  
  files.forEach((file) => {
    formData.append(`images`, file);
  });
  
  return formData;
};

// ============================================
// BASIC ORDER OPERATIONS
// ============================================

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
 * Create new order WITH ANALYTICS
 */
export const createOrder = createAsyncThunk(
  "order/createOrder",
  async (orderData, { rejectWithValue }) => {
    try {
      // Capture analytics data
      const analytics = getAnalyticsData();
      
      // Merge order data with analytics
      const orderWithAnalytics = {
        ...orderData,
        analytics
      };
      
      const { data } = await axios.post(
        `${API_BASE}/order/new`, 
        orderWithAnalytics, 
        { withCredentials: true }
      );
      
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

export const downloadInvoice = createAsyncThunk(
  "order/downloadInvoice",
  async (orderId, { rejectWithValue }) => {
    try {
      const response = await axios.get(
        `${API_BASE}/orders/${orderId}/invoice`,
        {
          withCredentials: true,
          responseType: 'blob',
        }
      );

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `Invoice-${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { 
        success: true, 
        message: 'Invoice downloaded successfully' 
      };
    } catch (error) {
      if (error.response?.data instanceof Blob) {
        const text = await error.response.data.text();
        try {
          const jsonError = JSON.parse(text);
          return rejectWithValue(jsonError.message || "Failed to download invoice");
        } catch {
          return rejectWithValue(text || "Failed to download invoice");
        }
      }
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

    builder
      .addCase(downloadInvoice.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(downloadInvoice.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.message = action.payload.message;
        state.success = true;
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