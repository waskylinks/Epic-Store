// features/order/orderSlice.js
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
// TRACKING & SHIPMENT MANAGEMENT
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

/**
 * Add tracking information (Admin only)
 */
export const addTrackingInfo = createAsyncThunk(
  "order/addTrackingInfo",
  async ({ orderId, carrier, trackingNumber, estimatedDelivery }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/admin/orders/${orderId}/tracking`,
        { carrier, trackingNumber, estimatedDelivery },
        { withCredentials: true }
      );
      return { orderId, tracking: data.tracking };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to add tracking info"
      );
    }
  }
);

/**
 * Create shipment (Admin only)
 */
export const createShipment = createAsyncThunk(
  "order/createShipment",
  async ({ orderId, items, warehouse, carrier, weight, dimensions }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/admin/orders/${orderId}/shipments`,
        { items, warehouse, carrier, weight, dimensions },
        { withCredentials: true }
      );
      return { orderId, shipment: data.shipment };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to create shipment"
      );
    }
  }
);

/**
 * Update shipment status (Admin only)
 */
export const updateShipmentStatus = createAsyncThunk(
  "order/updateShipmentStatus",
  async ({ orderId, shipmentId, status, trackingNumber }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_BASE}/admin/orders/${orderId}/shipments/${shipmentId}`,
        { status, trackingNumber },
        { withCredentials: true }
      );
      return { orderId, shipmentId, shipment: data.shipment };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update shipment"
      );
    }
  }
);

// ============================================
// RETURN MANAGEMENT (RMA)
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
 * Review return request (Admin only)
 */
export const reviewReturnRequest = createAsyncThunk(
  "order/reviewReturnRequest",
  async ({ orderId, action, restockFee = 0, adminNote = '' }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_BASE}/admin/orders/${orderId}/return/review`,
        { action, restockFee, adminNote },
        { withCredentials: true }
      );
      return { orderId, returnInfo: data.returnInfo };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to review return request"
      );
    }
  }
);

/**
 * Update return status (Admin only)
 */
export const updateReturnStatus = createAsyncThunk(
  "order/updateReturnStatus",
  async ({ orderId, status, inspectionNotes }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_BASE}/admin/orders/${orderId}/return/status`,
        { status, inspectionNotes },
        { withCredentials: true }
      );
      return { orderId, returnInfo: data.returnInfo };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update return status"
      );
    }
  }
);

/**
 * Get all active returns (Admin only)
 */
export const getAllReturns = createAsyncThunk(
  "order/getAllReturns",
  async (status = '', { rejectWithValue }) => {
    try {
      const url = status 
        ? `${API_BASE}/admin/returns?status=${status}`
        : `${API_BASE}/admin/returns`;
      
      const { data } = await axios.get(url, {
        withCredentials: true,
      });
      return data.returns;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch returns"
      );
    }
  }
);

// ============================================
// REFUND MANAGEMENT
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
 * Review refund request (Admin only)
 */
export const reviewRefundRequest = createAsyncThunk(
  "order/reviewRefundRequest",
  async ({ orderId, action, adminNote = '' }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_BASE}/admin/orders/${orderId}/refund/review`,
        { action, adminNote },
        { withCredentials: true }
      );
      return { orderId, refundInfo: data.refundInfo };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to review refund request"
      );
    }
  }
);

/**
 * Process refund (Admin only)
 */
export const processRefund = createAsyncThunk(
  "order/processRefund",
  async ({ orderId, refundAmount, merchantNote = '' }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/admin/orders/${orderId}/refund/process`,
        { refundAmount, merchantNote },
        { withCredentials: true }
      );
      return { orderId, refundInfo: data.refundInfo };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to process refund"
      );
    }
  }
);

/**
 * Get all refunds (Admin only)
 */
export const getAllRefunds = createAsyncThunk(
  "order/getAllRefunds",
  async ({ status = '', from, to } = {}, { rejectWithValue }) => {
    try {
      let url = `${API_BASE}/admin/refunds`;
      const params = new URLSearchParams();
      
      if (status) params.append('status', status);
      if (from) params.append('from', from);
      if (to) params.append('to', to);
      
      const queryString = params.toString();
      if (queryString) url += `?${queryString}`;
      
      const { data } = await axios.get(url, {
        withCredentials: true,
      });
      return data.refunds;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch refunds"
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
// FRAUD PREVENTION & REVIEW
// ============================================

/**
 * Get orders pending fraud review (Admin only)
 */
export const getPendingFraudReviews = createAsyncThunk(
  "order/getPendingFraudReviews",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/admin/orders/fraud-review`, {
        withCredentials: true,
      });
      return data.orders;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch fraud reviews"
      );
    }
  }
);

/**
 * Review fraud-flagged order (Admin only)
 */
export const reviewFraudCheck = createAsyncThunk(
  "order/reviewFraudCheck",
  async ({ orderId, decision }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_BASE}/admin/orders/${orderId}/fraud-review`,
        { decision },
        { withCredentials: true }
      );
      return { orderId, order: data.order };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to review fraud check"
      );
    }
  }
);

// ============================================
// AUDIT LOG
// ============================================

/**
 * Get audit log for order (Admin only)
 */
export const getAuditLog = createAsyncThunk(
  "order/getAuditLog",
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/admin/orders/${orderId}/audit`, {
        withCredentials: true,
      });
      return { orderId, auditLog: data.auditLog };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch audit log"
      );
    }
  }
);

// ============================================
// ANALYTICS
// ============================================

/**
 * Get customer order analytics (Admin only)
 */
export const getCustomerOrderAnalytics = createAsyncThunk(
  "order/getCustomerOrderAnalytics",
  async (userId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/analytics/customer/${userId}/orders`,
        { withCredentials: true }
      );
      return data.analytics;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch analytics"
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
// RETURN MESSAGES (Customer)
// ============================================

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
    shipments: [],
    returns: [],
    refunds: [],
    returnInfo: null,
    refundInfo: null,
    invoice: null,
    fraudReviews: [],
    auditLog: [],
    analytics: null,
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
      state.auditLog = [];
    },
    setActionLoading: (state, action) => {
      state.actionLoading = action.payload;
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

    builder
      .addCase(addTrackingInfo.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(addTrackingInfo.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.tracking = action.payload.tracking;
        if (state.order) {
          state.order.tracking = action.payload.tracking;
        }
        state.message = "Tracking information added successfully";
      })
      .addCase(addTrackingInfo.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // SHIPMENT MANAGEMENT
    // ============================================
    builder
      .addCase(createShipment.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(createShipment.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.shipments.push(action.payload.shipment);
        if (state.order?.shipments) {
          state.order.shipments.push(action.payload.shipment);
        }
        state.message = "Shipment created successfully";
      })
      .addCase(createShipment.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(updateShipmentStatus.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(updateShipmentStatus.fulfilled, (state, action) => {
        state.actionLoading = false;
        const index = state.shipments.findIndex(
          s => s.shipmentId === action.payload.shipmentId
        );
        if (index !== -1) {
          state.shipments[index] = action.payload.shipment;
        }
        state.message = "Shipment updated successfully";
      })
      .addCase(updateShipmentStatus.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
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
      .addCase(reviewReturnRequest.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(reviewReturnRequest.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.returnInfo = action.payload.returnInfo;
        if (state.order) {
          state.order.returnInfo = action.payload.returnInfo;
        }
        state.message = "Return request reviewed successfully";
      })
      .addCase(reviewReturnRequest.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(updateReturnStatus.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(updateReturnStatus.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.returnInfo = action.payload.returnInfo;
        if (state.order) {
          state.order.returnInfo = action.payload.returnInfo;
        }
        state.message = "Return status updated successfully";
      })
      .addCase(updateReturnStatus.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getAllReturns.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getAllReturns.fulfilled, (state, action) => {
        state.loading = false;
        state.returns = action.payload;
      })
      .addCase(getAllReturns.rejected, (state, action) => {
        state.loading = false;
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
      .addCase(reviewRefundRequest.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(reviewRefundRequest.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.refundInfo = action.payload.refundInfo;
        if (state.order) {
          state.order.refundInfo = action.payload.refundInfo;
        }
        state.message = "Refund request reviewed successfully";
      })
      .addCase(reviewRefundRequest.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(processRefund.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(processRefund.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.refundInfo = action.payload.refundInfo;
        if (state.order) {
          state.order.refundInfo = action.payload.refundInfo;
        }
        state.message = "Refund processed successfully";
      })
      .addCase(processRefund.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getAllRefunds.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getAllRefunds.fulfilled, (state, action) => {
        state.loading = false;
        state.refunds = action.payload;
      })
      .addCase(getAllRefunds.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
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

    // ============================================
    // FRAUD PREVENTION
    // ============================================
    builder
      .addCase(getPendingFraudReviews.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getPendingFraudReviews.fulfilled, (state, action) => {
        state.loading = false;
        state.fraudReviews = action.payload;
      })
      .addCase(getPendingFraudReviews.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    builder
      .addCase(reviewFraudCheck.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(reviewFraudCheck.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.message = "Fraud review completed successfully";
      })
      .addCase(reviewFraudCheck.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // AUDIT LOG
    // ============================================
    builder
      .addCase(getAuditLog.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getAuditLog.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.auditLog = action.payload.auditLog;
      })
      .addCase(getAuditLog.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // ANALYTICS
    // ============================================
    builder
      .addCase(getCustomerOrderAnalytics.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getCustomerOrderAnalytics.fulfilled, (state, action) => {
        state.loading = false;
        state.analytics = action.payload;
      })
      .addCase(getCustomerOrderAnalytics.rejected, (state, action) => {
        state.loading = false;
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
    // RETURN MESSAGES
    // ============================================
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
  },
});

export const { removeErrors, clearMessage, clearOrder, setActionLoading } = orderSlice.actions;
export default orderSlice.reducer;