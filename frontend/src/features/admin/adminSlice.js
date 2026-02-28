import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const BASE = '/api/v1';

// ============================================
// ASYNC THUNKS — ORDERS (admin)
// ============================================

export const fetchAllOrders = createAsyncThunk(
  'admin/fetchAllOrders',
  async (params = {}, { rejectWithValue }) => {
    try {
      const query = new URLSearchParams(params).toString();
      const { data } = await axios.get(`${BASE}/admin/orders${query ? `?${query}` : ''}`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch orders');
    }
  }
);

export const getSingleOrder = createAsyncThunk(
  'admin/getSingleOrder',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/orders/${id}`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch order');
    }
  }
);

export const updateOrder = createAsyncThunk(
  'admin/updateOrder',
  async ({ id, status, note }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`${BASE}/admin/orders/${id}`, { status, note });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to update order');
    }
  }
);

export const deleteOrder = createAsyncThunk(
  'admin/deleteOrder',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`${BASE}/admin/orders/${id}`);
      return { ...data, id };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to delete order');
    }
  }
);

export const cancelOrderWithRefund = createAsyncThunk(
  'admin/cancelOrderWithRefund',
  async ({ orderId, reason, skipRefund = false }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`${BASE}/admin/orders/${orderId}/cancel`, {
        reason,
        skipRefund
      });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to cancel order');
    }
  }
);

export const addTrackingInfo = createAsyncThunk(
  'admin/addTrackingInfo',
  async ({ orderId, carrier, trackingNumber, estimatedDelivery }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`${BASE}/admin/orders/${orderId}/tracking`, {
        carrier,
        trackingNumber,
        estimatedDelivery
      });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to add tracking info');
    }
  }
);

export const getOrderAuditLog = createAsyncThunk(
  'admin/getOrderAuditLog',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/orders/${id}/audit`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch audit log');
    }
  }
);

// ============================================
// ASYNC THUNKS — MESSAGES
// ============================================

export const addOrderMessage = createAsyncThunk(
  'admin/addOrderMessage',
  async ({ orderId, content, attachments = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${BASE}/orders/${orderId}/messages`, {
        content,
        attachments
      });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to send message');
    }
  }
);

export const getOrderMessages = createAsyncThunk(
  'admin/getOrderMessages',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/orders/${orderId}/messages`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch messages');
    }
  }
);

export const getOrdersWithUnreadMessages = createAsyncThunk(
  'admin/getOrdersWithUnreadMessages',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/orders/unread-messages`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch orders with unread messages');
    }
  }
);

// ============================================
// ASYNC THUNKS — USERS (admin)
// ============================================

export const fetchAllUsers = createAsyncThunk(
  'admin/getAllUsers',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/users`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch users');
    }
  }
);

export const getSingleUser = createAsyncThunk(
  'admin/getSingleUser',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/users/${id}`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch user');
    }
  }
);

export const updateUserRole = createAsyncThunk(
  'admin/updateUserRole',
  async ({ id, role }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`${BASE}/admin/users/${id}`, { role });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to update user role');
    }
  }
);

export const deleteUser = createAsyncThunk(
  'admin/deleteUser',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`${BASE}/admin/users/${id}`);
      return { ...data, id };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to delete user');
    }
  }
);

// ============================================
// ASYNC THUNKS — REVIEWS (admin)
// ============================================

export const fetchAllReviews = createAsyncThunk(
  'admin/fetchAllReviews',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/reviews`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch reviews');
    }
  }
);

export const deleteReview = createAsyncThunk(
  'admin/deleteReview',
  async ({ reviewId, productId }, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`${BASE}/admin/reviews?reviewId=${reviewId}&productId=${productId}`);
      return { ...data, reviewId };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to delete review');
    }
  }
);

// ============================================
// ASYNC THUNKS — FRAUD (admin)
// ============================================

export const getPendingFraudReviews = createAsyncThunk(
  'admin/getPendingFraudReviews',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${BASE}/admin/orders/fraud-reviews`);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch fraud reviews');
    }
  }
);

export const reviewFraudCheck = createAsyncThunk(
  'admin/reviewFraudCheck',
  async ({ id, decision, note }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`${BASE}/admin/orders/${id}/fraud-review`, { decision, note });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Failed to review fraud check');
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  // Orders
  orders:        [],
  currentOrder:  null,
  totalOrders:   0,
  stats:         null,

  // Messages
  orderMessages:  [],
  unreadOrders:   [],

  // Users
  users:          [],
  currentUser:    null,

  // Reviews
  reviews:        [],

  // Fraud
  fraudOrders:    [],

  // Audit
  auditLog:       [],

  // Loading states — separate per concern so they don't conflict
  loading:        false,
  messageLoading: false,
  userLoading:    false,

  // Flags
  success:        false,
  error:          null
};

// ============================================
// HELPER — safely update a single order in the orders array
// ============================================
const upsertOrder = (orders, updatedOrder) => {
  if (!updatedOrder?._id) return orders;
  const index = orders.findIndex(o => o._id === updatedOrder._id);
  if (index === -1) return orders;
  // FIX: Merge rather than replace — preserve user/orderItems/totalPrice if not returned
  const merged = { ...orders[index], ...updatedOrder };
  return [
    ...orders.slice(0, index),
    merged,
    ...orders.slice(index + 1)
  ];
};

// ============================================
// SLICE
// ============================================

const adminSlice = createSlice({
  name: 'admin',
  initialState,
  reducers: {
    removeErrors(state) {
      state.error = null;
    },
    removeSuccess(state) {
      state.success = false;
    },
    clearCurrentOrder(state) {
      state.currentOrder = null;
    },
    clearCurrentUser(state) {
      state.currentUser = null;
    }
  },
  extraReducers: (builder) => {

    // ─────────────────────────────────────────────────────────────
    // fetchAllOrders
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(fetchAllOrders.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(fetchAllOrders.fulfilled, (state, action) => {
        state.loading     = false;
        // FIX #1: Controller returns { success, orders, totalOrders, stats, ... }
        state.orders      = action.payload.orders      ?? [];
        state.totalOrders = action.payload.totalOrders ?? 0;
        state.stats       = action.payload.stats       ?? null;
      })
      .addCase(fetchAllOrders.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getSingleOrder
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(getSingleOrder.pending, (state) => {
        state.loading      = true;
        state.error        = null;
        state.currentOrder = null;
      })
      .addCase(getSingleOrder.fulfilled, (state, action) => {
        state.loading      = false;
        // FIX #2: Controller returns { success, order }
        state.currentOrder = action.payload.order ?? null;
      })
      .addCase(getSingleOrder.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // updateOrder
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(updateOrder.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(updateOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        // FIX #3: Controller returns { success, message, order } — not order at top level
        const updated = action.payload.order;
        if (updated?._id) {
          state.orders      = upsertOrder(state.orders, updated);
          state.currentOrder = updated;
        }
      })
      .addCase(updateOrder.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // deleteOrder
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(deleteOrder.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(deleteOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.orders  = state.orders.filter(o => o._id !== action.payload.id);
      })
      .addCase(deleteOrder.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // cancelOrderWithRefund
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(cancelOrderWithRefund.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(cancelOrderWithRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        // FIX #4: Controller returns { success, message, order } — use same fix as updateOrder
        // FIX for logic gap: merge with existing order rather than replace — preserves user/orderItems
        const updated = action.payload.order;
        if (updated?._id) {
          state.orders      = upsertOrder(state.orders, updated);
          state.currentOrder = updated;
        }
      })
      .addCase(cancelOrderWithRefund.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // addTrackingInfo
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(addTrackingInfo.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(addTrackingInfo.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        // FIX logic gap #12: Controller returns { success, tracking, order }
        // Must update both state.orders[] and state.currentOrder
        // The controller also auto-sets status to 'Shipped' when tracking is added
        const updated = action.payload.order;
        if (updated?._id) {
          state.orders       = upsertOrder(state.orders, updated);
          state.currentOrder = updated;
        }
      })
      .addCase(addTrackingInfo.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getOrderAuditLog
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(getOrderAuditLog.pending, (state) => {
        state.error    = null;
        state.auditLog = [];
      })
      .addCase(getOrderAuditLog.fulfilled, (state, action) => {
        state.auditLog = action.payload.auditLog ?? [];
      })
      .addCase(getOrderAuditLog.rejected, (state, action) => {
        state.error    = action.payload;
        state.auditLog = [];
      });

    // ─────────────────────────────────────────────────────────────
    // addOrderMessage
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(addOrderMessage.pending, (state) => {
        // FIX #10: Use messageLoading — not the main loading flag
        state.messageLoading = true;
        state.error          = null;
      })
      .addCase(addOrderMessage.fulfilled, (state, action) => {
        // FIX #10: NEVER set state.success = true here — that closes the modal
        state.messageLoading = false;
        // Append the new message to local state if returned
        const msg = action.payload.orderMessage;
        if (msg) {
          state.orderMessages = [...(state.orderMessages || []), msg];
        }
      })
      .addCase(addOrderMessage.rejected, (state, action) => {
        state.messageLoading = false;
        state.error          = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getOrderMessages
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(getOrderMessages.pending, (state) => {
        // FIX #11: Use messageLoading — not state.loading (which triggers full-page loader)
        state.messageLoading = true;
        state.error          = null;
      })
      .addCase(getOrderMessages.fulfilled, (state, action) => {
        state.messageLoading = false;
        state.orderMessages  = action.payload.messages ?? [];
      })
      .addCase(getOrderMessages.rejected, (state, action) => {
        state.messageLoading = false;
        state.error          = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getOrdersWithUnreadMessages
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(getOrdersWithUnreadMessages.pending, (state) => {
        state.error = null;
      })
      .addCase(getOrdersWithUnreadMessages.fulfilled, (state, action) => {
        // FIX #5: Controller returns { success, count, orders }
        state.unreadOrders = action.payload.orders ?? [];
      })
      .addCase(getOrdersWithUnreadMessages.rejected, (state, action) => {
        state.error = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getAllUsers
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(fetchAllUsers.pending, (state) => {
        state.userLoading = true;
        state.error       = null;
      })
      .addCase(fetchAllUsers.fulfilled, (state, action) => {
        state.userLoading = false;
        state.users       = action.payload.users ?? [];
      })
      .addCase(fetchAllUsers.rejected, (state, action) => {
        state.userLoading = false;
        state.error       = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getSingleUser
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(getSingleUser.pending, (state) => {
        state.userLoading  = true;
        state.error        = null;
        state.currentUser  = null;
      })
      .addCase(getSingleUser.fulfilled, (state, action) => {
        state.userLoading = false;
        // FIX #6: Controller returns { success, user }
        state.currentUser = action.payload.user ?? null;
      })
      .addCase(getSingleUser.rejected, (state, action) => {
        state.userLoading = false;
        state.error       = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // updateUserRole
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(updateUserRole.pending, (state) => {
        state.userLoading = true;
        state.error       = null;
      })
      .addCase(updateUserRole.fulfilled, (state, action) => {
        state.userLoading = false;
        state.success     = true;
        // FIX #7: Controller returns { success, user } — not user at top level
        const updated = action.payload.user;
        if (updated?._id) {
          const index = state.users.findIndex(u => u._id === updated._id);
          if (index !== -1) {
            state.users = [
              ...state.users.slice(0, index),
              { ...state.users[index], ...updated },
              ...state.users.slice(index + 1)
            ];
          }
          state.currentUser = updated;
        }
      })
      .addCase(updateUserRole.rejected, (state, action) => {
        state.userLoading = false;
        state.error       = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // deleteUser
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(deleteUser.pending, (state) => {
        state.userLoading = true;
        state.error       = null;
      })
      .addCase(deleteUser.fulfilled, (state, action) => {
        state.userLoading = false;
        state.success     = true;
        state.users       = state.users.filter(u => u._id !== action.payload.id);
      })
      .addCase(deleteUser.rejected, (state, action) => {
        state.userLoading = false;
        state.error       = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // fetchAllReviews
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(fetchAllReviews.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(fetchAllReviews.fulfilled, (state, action) => {
        state.loading = false;
        // FIX #8: Controller returns { success, reviews }
        state.reviews = action.payload.reviews ?? [];
      })
      .addCase(fetchAllReviews.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // deleteReview
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(deleteReview.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(deleteReview.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.reviews = state.reviews.filter(r => r._id !== action.payload.reviewId);
      })
      .addCase(deleteReview.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // getPendingFraudReviews
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(getPendingFraudReviews.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getPendingFraudReviews.fulfilled, (state, action) => {
        state.loading      = false;
        // FIX #9: Controller returns { success, count, orders }
        state.fraudOrders  = action.payload.orders ?? [];
      })
      .addCase(getPendingFraudReviews.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ─────────────────────────────────────────────────────────────
    // reviewFraudCheck
    // ─────────────────────────────────────────────────────────────
    builder
      .addCase(reviewFraudCheck.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(reviewFraudCheck.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const updated = action.payload.order;
        if (updated?._id) {
          // Remove from fraud queue
          state.fraudOrders = state.fraudOrders.filter(o => o._id !== updated._id);
          // Update in main orders list if present
          state.orders      = upsertOrder(state.orders, updated);
        }
      })
      .addCase(reviewFraudCheck.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });
  }
});

export const { removeErrors, removeSuccess, clearCurrentOrder, clearCurrentUser } = adminSlice.actions;

export default adminSlice.reducer;