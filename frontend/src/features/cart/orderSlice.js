import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

// PHASE 1: Import analytics SDK helpers
// generateEventId — creates the UUID that ties client and server events together
// buildClientAnalyticsPayload — builds the full attribution context object
import {
  generateEventId,
  buildClientAnalyticsPayload,
} from '../../utils/analytics.js';

// DEDUP: Import trackPurchase to fire the browser pixel with the same eventId
// that was sent to the server. Meta matches both and shows "Deduped".
import { trackPurchase } from '../../utils/eventBridge.js';

const API_BASE = '/api/v1';

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

const createFormDataWithFiles = (data, files = []) => {
  const formData = new FormData();

  Object.keys(data).forEach((key) => {
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
    formData.append('images', file);
  });

  return formData;
};

// ─── BASIC ORDER OPERATIONS ───────────────────────────────────────────────────

export const getAllMyOrders = createAsyncThunk(
  'order/getAllMyOrders',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/orders/user`, {
        withCredentials: true,
      });
      return data.orders;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch orders'
      );
    }
  }
);

export const getOrderDetails = createAsyncThunk(
  'order/getOrderDetails',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/order/${id}`, {
        withCredentials: true,
      });
      return data.order;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch order details'
      );
    }
  }
);

export const getOrderByReference = createAsyncThunk(
  'order/getOrderByReference',
  async (reference, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/reference/${reference}`,
        { withCredentials: true }
      );
      return data.order;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch order'
      );
    }
  }
);

/**
 * createOrder
 *
 * PHASE 1 CHANGES:
 *   - Generates a UUID event_id at the moment of order creation
 *   - Builds a full client analytics payload using the SDK
 *   - Attaches the payload to the request body so the backend can:
 *       a) Use the event_id for GA4 + Meta CAPI deduplication
 *       b) Use ga4ClientId to match the server-side event to the browser session
 *       c) Use fbp/fbc for Meta CAPI user matching
 *       d) Use clientAttribution as a redundant source alongside server cookies
 *
 * DEDUP CHANGE:
 *   - eventId is now returned alongside the order in the fulfilled payload
 *   - The fulfilled reducer fires trackPurchase() with that same eventId
 *   - Meta sees browser pixel + CAPI both carrying the same eventID and dedupes
 *
 * The backend verifyPaymentController.js reads:
 *   req.body.analyticsEventId  — the UUID
 *   req.body.clientTimestamp   — ISO string from browser
 *   req.body.ga4ClientId       — _ga cookie value
 *   req.body.fbp               — _fbp cookie value
 *   req.body.fbc               — _fbc or fbclid value
 *   req.body.clientAttribution — full attribution snapshot
 */
export const createOrder = createAsyncThunk(
  'order/createOrder',
  async (orderData, { rejectWithValue }) => {
    try {
      const eventId = generateEventId();
      const analyticsPayload = buildClientAnalyticsPayload(eventId);

      const { data } = await axios.post(
        `${API_BASE}/order/new`,
        {
          ...orderData,
          ...analyticsPayload,
        },
        { withCredentials: true }
      );

      // Return eventId alongside the order so the fulfilled handler can
      // fire the browser pixel with the matching UUID for Meta deduplication
      return { order: data.order, eventId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to create order'
      );
    }
  }
);

// ─── STATUS HISTORY & TIMELINE ────────────────────────────────────────────────

export const getOrderTimeline = createAsyncThunk(
  'order/getOrderTimeline',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/timeline`,
        { withCredentials: true }
      );
      return {
        orderId,
        timeline:      data.timeline,
        currentStatus: data.currentStatus,
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch order timeline'
      );
    }
  }
);

// ─── NOTES & COMMUNICATION ────────────────────────────────────────────────────

export const addOrderNote = createAsyncThunk(
  'order/addOrderNote',
  async ({ orderId, content, type = 'customer', attachments = [] }, { rejectWithValue }) => {
    try {
      const formData = createFormDataWithFiles({ content, type }, attachments);
      const { data } = await axios.post(
        `${API_BASE}/orders/${orderId}/notes`,
        formData,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      return { orderId, note: data.note };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to add note'
      );
    }
  }
);

export const getOrderNotes = createAsyncThunk(
  'order/getOrderNotes',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/notes`,
        { withCredentials: true }
      );
      return { orderId, notes: data.notes };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch notes'
      );
    }
  }
);

export const editOrderNote = createAsyncThunk(
  'order/editOrderNote',
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
        error.response?.data?.message || 'Failed to edit note'
      );
    }
  }
);

// ─── TRACKING INFORMATION ─────────────────────────────────────────────────────

export const getTrackingInfo = createAsyncThunk(
  'order/getTrackingInfo',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/tracking`,
        { withCredentials: true }
      );
      return { orderId, tracking: data.tracking };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch tracking info'
      );
    }
  }
);

// ─── ORDER MESSAGES ───────────────────────────────────────────────────────────

export const addOrderMessage = createAsyncThunk(
  'order/addOrderMessage',
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
        error.response?.data?.message || 'Failed to send message'
      );
    }
  }
);

export const getOrderMessages = createAsyncThunk(
  'order/getOrderMessages',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/${orderId}/messages`,
        { withCredentials: true }
      );
      return { orderId, messages: data.messages };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch messages'
      );
    }
  }
);

export const markOrderMessagesRead = createAsyncThunk(
  'order/markOrderMessagesRead',
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
        error.response?.data?.message || 'Failed to mark messages as read'
      );
    }
  }
);

// ─── INVOICE ──────────────────────────────────────────────────────────────────

export const downloadInvoice = createAsyncThunk(
  'order/downloadInvoice',
  async (orderId, { rejectWithValue }) => {
    try {
      const response = await axios.get(
        `${API_BASE}/orders/${orderId}/invoice`,
        { withCredentials: true, responseType: 'blob' }
      );

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url  = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = `Invoice-${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true, message: 'Invoice downloaded successfully' };
    } catch (error) {
      if (error.response?.data instanceof Blob) {
        const text = await error.response.data.text();
        try {
          const jsonError = JSON.parse(text);
          return rejectWithValue(jsonError.message || 'Failed to download invoice');
        } catch {
          return rejectWithValue(text || 'Failed to download invoice');
        }
      }
      return rejectWithValue(
        error.response?.data?.message || 'Failed to download invoice'
      );
    }
  }
);

// ─── CUSTOMER ANALYTICS ───────────────────────────────────────────────────────

export const getCustomerOrderAnalytics = createAsyncThunk(
  'order/getCustomerOrderAnalytics',
  async (userId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/orders/customer/${userId}/analytics`,
        { withCredentials: true }
      );
      return data.analytics;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch customer analytics'
      );
    }
  }
);

// ─── SLICE ────────────────────────────────────────────────────────────────────

const orderSlice = createSlice({
  name: 'order',
  initialState: {
    orders:            [],
    order:             null,
    timeline:          [],
    notes:             [],
    tracking:          null,
    orderMessages:     [],
    customerAnalytics: null,

    loading:       false,
    actionLoading: false,
    error:         null,
    success:       false,
    message:       null,
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
      state.order    = null;
      state.timeline = [];
      state.notes    = [];
      state.tracking = null;
    },
    setActionLoading: (state, action) => {
      state.actionLoading = action.payload;
    },
  },
  extraReducers: (builder) => {

    // getAllMyOrders
    builder
      .addCase(getAllMyOrders.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getAllMyOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.orders  = action.payload;
      })
      .addCase(getAllMyOrders.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // getOrderDetails
    builder
      .addCase(getOrderDetails.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getOrderDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.order   = action.payload;
        state.success = true;
      })
      .addCase(getOrderDetails.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // getOrderByReference
    builder
      .addCase(getOrderByReference.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getOrderByReference.fulfilled, (state, action) => {
        state.loading = false;
        state.order   = action.payload;
        state.success = true;
      })
      .addCase(getOrderByReference.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // createOrder
    // DEDUP: fulfilled now receives { order, eventId } — fires browser pixel
    // with the matching UUID so Meta can deduplicate against the CAPI event
    // fired server-side in verifyPaymentController.js
    builder
      .addCase(createOrder.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(createOrder.fulfilled, (state, action) => {
        const { order, eventId } = action.payload;

        state.loading = false;
        state.order   = order;
        state.success = true;
        state.message = 'Order created successfully';

        // Fire browser pixel with the same eventId sent to the server.
        // trackPurchase is fire-and-forget — never throws, never blocks.
        trackPurchase(
          {
            orderId:  order?._id || order?.id,
            revenue:  order?.pricing?.totalPrice || order?.totalPrice || 0,
            currency: order?.pricing?.currency   || 'USD',
            items:    order?.items || [],
          },
          eventId
        );
      })
      .addCase(createOrder.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // getOrderTimeline
    builder
      .addCase(getOrderTimeline.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(getOrderTimeline.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.timeline      = action.payload.timeline;
        if (state.order) {
          state.order.orderStatus = action.payload.currentStatus;
        }
      })
      .addCase(getOrderTimeline.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // addOrderNote
    builder
      .addCase(addOrderNote.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(addOrderNote.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.notes.push(action.payload.note);
        if (state.order?.notes) {
          state.order.notes.push(action.payload.note);
        }
        state.message = 'Note added successfully';
      })
      .addCase(addOrderNote.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // getOrderNotes
    builder
      .addCase(getOrderNotes.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(getOrderNotes.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.notes         = action.payload.notes;
      })
      .addCase(getOrderNotes.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // editOrderNote
    builder
      .addCase(editOrderNote.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(editOrderNote.fulfilled, (state, action) => {
        state.actionLoading = false;
        const index = state.notes.findIndex(n => n._id === action.payload.noteId);
        if (index !== -1) state.notes[index] = action.payload.note;
        state.message = 'Note updated successfully';
      })
      .addCase(editOrderNote.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // getTrackingInfo
    builder
      .addCase(getTrackingInfo.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(getTrackingInfo.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.tracking      = action.payload.tracking;
        if (state.order) state.order.tracking = action.payload.tracking;
      })
      .addCase(getTrackingInfo.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // addOrderMessage
    builder
      .addCase(addOrderMessage.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(addOrderMessage.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.orderMessages.push(action.payload.message);
        state.message = 'Message sent successfully';
      })
      .addCase(addOrderMessage.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // getOrderMessages
    builder
      .addCase(getOrderMessages.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(getOrderMessages.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.orderMessages = action.payload.messages;
      })
      .addCase(getOrderMessages.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // markOrderMessagesRead
    builder.addCase(markOrderMessagesRead.fulfilled, (state) => {
      state.orderMessages = state.orderMessages.map(msg => ({
        ...msg,
        isRead: true,
      }));
    });

    // downloadInvoice
    builder
      .addCase(downloadInvoice.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(downloadInvoice.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.message       = action.payload.message;
        state.success       = true;
      })
      .addCase(downloadInvoice.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // getCustomerOrderAnalytics
    builder
      .addCase(getCustomerOrderAnalytics.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(getCustomerOrderAnalytics.fulfilled, (state, action) => {
        state.actionLoading    = false;
        state.customerAnalytics = action.payload;
      })
      .addCase(getCustomerOrderAnalytics.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });
  },
});

export const {
  removeErrors,
  clearMessage,
  clearOrder,
  setActionLoading,
} = orderSlice.actions;

export default orderSlice.reducer;