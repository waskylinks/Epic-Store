import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// PRODUCT MANAGEMENT
// ============================================

export const fetchAdminProducts = createAsyncThunk(
  'admin/fetchAdminProducts',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/products');
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Failed to Fetch Products');
    }
  }
);

export const createProduct = createAsyncThunk(
  'admin/createProduct',
  async (productData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post('/api/v1/admin/products/create', productData);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to Create Product' });
    }
  }
);

export const updateProduct = createAsyncThunk(
  'admin/updateProduct',
  async ({ id, productData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/admin/product/${id}`, productData);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to Update Product' });
    }
  }
);

export const deleteProduct = createAsyncThunk(
  'admin/deleteProduct',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/admin/product/${id}`);
      return { id, message: data.message };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to Delete Product');
    }
  }
);

export const deleteMultipleProducts = createAsyncThunk(
  'admin/deleteMultipleProducts',
  async (productIds, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete('/api/v1/admin/products/batch-delete', {
        data: { productIds },
      });
      return { productIds: data.results.successful.map(p => p.id), results: data.results };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete products');
    }
  }
);

export const getProductStructuredData = createAsyncThunk(
  'admin/getProductStructuredData',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/product/${id}/structured-data`);
      return data.structuredData;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch structured data');
    }
  }
);

// ============================================
// USER MANAGEMENT
// ============================================

export const fetchAllUsers = createAsyncThunk(
  'admin/fetchAllUsers',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/users');
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch users');
    }
  }
);

export const getSingleUser = createAsyncThunk(
  'admin/getSingleUser',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/user/${id}`);
      return data.user;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch user');
    }
  }
);

export const updateUserRole = createAsyncThunk(
  'admin/updateUserRole',
  async ({ id, role }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/admin/user/${id}`, { role });
      return data.user;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update user role');
    }
  }
);

export const deleteUser = createAsyncThunk(
  'admin/deleteUser',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/admin/user/${id}`);
      return { id, message: data.message };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete user');
    }
  }
);

// ============================================
// ORDER MANAGEMENT
// ============================================

export const fetchAllOrders = createAsyncThunk(
  'admin/fetchAllOrders',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/orders');
      return data.orders;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch orders');
    }
  }
);

export const getSingleOrder = createAsyncThunk(
  'admin/getSingleOrder',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/order/${id}`);
      return data.order;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch order');
    }
  }
);

export const updateOrder = createAsyncThunk(
  'admin/updateOrder',
  async ({ id, status }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/admin/order/${id}`, { status });
      return data.order;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update order');
    }
  }
);

export const deleteOrder = createAsyncThunk(
  'admin/deleteOrder',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/admin/order/${id}`);
      return { id, message: data.message };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete order');
    }
  }
);

export const cancelOrder = createAsyncThunk(
  'admin/cancelOrder',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/admin/order/${id}`, { status: 'Cancelled' });
      return data.order;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to cancel order');
    }
  }
);

export const cancelOrderWithRefund = createAsyncThunk(
  'admin/cancelOrderWithRefund',
  async ({ orderId, reason, skipRefund = false }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/cancel`,
        { reason, skipRefund }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to cancel order');
    }
  }
);

// ============================================
// ORDER MESSAGES
// ============================================

export const getOrdersWithUnreadMessages = createAsyncThunk(
  'admin/getOrdersWithUnreadMessages',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/orders/unread-messages');
      return data.orders;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch unread messages');
    }
  }
);

export const addOrderMessage = createAsyncThunk(
  'admin/addOrderMessage',
  async ({ orderId, content, attachments = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/orders/${orderId}/messages`,
        { content, attachments }
      );
      return { orderId, message: data.orderMessage };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to send message');
    }
  }
);

export const getOrderMessages = createAsyncThunk(
  'admin/getOrderMessages',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/orders/${orderId}/messages`);
      return { orderId, messages: data.messages };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch messages');
    }
  }
);

// ============================================
// TRACKING & SHIPMENT MANAGEMENT
// ============================================

export const addTrackingInfo = createAsyncThunk(
  'admin/addTrackingInfo',
  async ({ orderId, carrier, trackingNumber, estimatedDelivery }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/orders/${orderId}/tracking`,
        { carrier, trackingNumber, estimatedDelivery }
      );
      return { orderId, tracking: data.tracking };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to add tracking info');
    }
  }
);

export const createShipment = createAsyncThunk(
  'admin/createShipment',
  async ({ orderId, items, warehouse, carrier, weight, dimensions }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/orders/${orderId}/shipments`,
        { items, warehouse, carrier, weight, dimensions }
      );
      return { orderId, shipment: data.shipment };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to create shipment');
    }
  }
);

export const updateShipmentStatus = createAsyncThunk(
  'admin/updateShipmentStatus',
  async ({ orderId, shipmentId, status, trackingNumber }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/shipments/${shipmentId}`,
        { status, trackingNumber }
      );
      return { orderId, shipmentId, shipment: data.shipment };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update shipment');
    }
  }
);

// ============================================
// REVIEW MANAGEMENT
// ============================================

export const fetchAllReviews = createAsyncThunk(
  'admin/fetchAllReviews',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/reviews');
      return data.reviews;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch reviews');
    }
  }
);

export const deleteReview = createAsyncThunk(
  'admin/deleteReview',
  async ({ reviewId, productId }, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/reviews?id=${reviewId}&productID=${productId}`);
      return { reviewId, productId, message: data.message };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete review');
    }
  }
);

// ============================================
// FRAUD MANAGEMENT
// ============================================

export const getPendingFraudReviews = createAsyncThunk(
  'admin/getPendingFraudReviews',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/orders/fraud-review');
      return data.orders;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch fraud reviews');
    }
  }
);

export const reviewFraudCheck = createAsyncThunk(
  'admin/reviewFraudCheck',
  async ({ orderId, decision }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/admin/orders/${orderId}/fraud-review`,
        { decision }
      );
      return { orderId, order: data.order };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to review fraud check');
    }
  }
);

export const getOrderAuditLog = createAsyncThunk(
  'admin/getOrderAuditLog',
  async (orderId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/admin/orders/${orderId}/audit`);
      return { orderId, auditLog: data.auditLog };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch audit log');
    }
  }
);

// ============================================
// SLICE DEFINITION
// ============================================

const adminSlice = createSlice({
  name: 'admin',
  initialState: {
    products: [],
    structuredData: null,
    users: [],
    currentUser: null,
    orders: [],
    currentOrder: null,
    orderMessages: [],
    unreadOrders: [],
    auditLog: [],
    reviews: [],
    fraudReviews: [],
    // FIX: replaced shared `success` with a dedicated `productCreated` flag.
    // The old `success: true` was set by 15+ different thunks. Any prior admin
    // action (deleteProduct, addOrderMessage, etc.) that left `success: true`
    // would cause CreateProduct's useEffect to fire on mount — showing the
    // toast and resetting the form before a product was ever submitted.
    productCreated: false,
    success: false,
    loading: false,
    error: null,
    messageLoading: false,
  },
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    removeSuccess: (state) => {
      state.success = false;
    },
    // FIX: dedicated reducer to clear the productCreated flag after
    // CreateProduct's useEffect has consumed it.
    removeProductCreated: (state) => {
      state.productCreated = false;
    },
    clearCurrentUser: (state) => {
      state.currentUser = null;
    },
    clearCurrentOrder: (state) => {
      state.currentOrder = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // ---- Products ----
      .addCase(fetchAdminProducts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdminProducts.fulfilled, (state, action) => {
        state.loading = false;
        state.products = action.payload.products;
      })
      .addCase(fetchAdminProducts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to Fetch Products';
      })

      .addCase(createProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createProduct.fulfilled, (state, action) => {
        state.loading = false;
        // FIX: set productCreated (not success) so only CreateProduct's
        // useEffect reacts. Other components watching `success` are unaffected.
        state.productCreated = true;
        state.products.push(action.payload.product);
      })
      .addCase(createProduct.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to Create Product';
      })

      .addCase(updateProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateProduct.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const index = state.products.findIndex(p => p._id === action.payload.product._id);
        if (index !== -1) state.products[index] = action.payload.product;
      })
      .addCase(updateProduct.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to Update Product';
      })

      .addCase(deleteProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteProduct.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.products = state.products.filter(p => p._id !== action.payload.id);
      })
      .addCase(deleteProduct.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to Delete Product';
      })

      .addCase(deleteMultipleProducts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteMultipleProducts.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const deletedIds = new Set(action.payload.productIds);
        state.products = state.products.filter(p => !deletedIds.has(p._id));
      })
      .addCase(deleteMultipleProducts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to delete products';
      })

      .addCase(getProductStructuredData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getProductStructuredData.fulfilled, (state, action) => {
        state.loading = false;
        state.structuredData = action.payload;
      })
      .addCase(getProductStructuredData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to fetch structured data';
      })

      // ---- Users ----
      .addCase(fetchAllUsers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllUsers.fulfilled, (state, action) => {
        state.loading = false;
        state.users = action.payload.users;
      })
      .addCase(fetchAllUsers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(getSingleUser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleUser.fulfilled, (state, action) => {
        state.loading = false;
        state.currentUser = action.payload;
      })
      .addCase(getSingleUser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(updateUserRole.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateUserRole.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const index = state.users.findIndex(u => u._id === action.payload._id);
        if (index !== -1) state.users[index] = action.payload;
        if (state.currentUser?._id === action.payload._id) {
          state.currentUser = action.payload;
        }
      })
      .addCase(updateUserRole.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(deleteUser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteUser.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.users = state.users.filter(u => u._id !== action.payload.id);
      })
      .addCase(deleteUser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ---- Orders ----
      .addCase(fetchAllOrders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.orders = action.payload;
      })
      .addCase(fetchAllOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(getSingleOrder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.currentOrder = action.payload;
      })
      .addCase(getSingleOrder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(updateOrder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const index = state.orders.findIndex(o => o._id === action.payload._id);
        if (index !== -1) state.orders[index] = action.payload;
        if (state.currentOrder?._id === action.payload._id) {
          state.currentOrder = action.payload;
        }
      })
      .addCase(updateOrder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(deleteOrder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.orders = state.orders.filter(o => o._id !== action.payload.id);
      })
      .addCase(deleteOrder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(cancelOrder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(cancelOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const index = state.orders.findIndex(o => o._id === action.payload._id);
        if (index !== -1) state.orders[index] = action.payload;
        if (state.currentOrder?._id === action.payload._id) {
          state.currentOrder = action.payload;
        }
      })
      .addCase(cancelOrder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(cancelOrderWithRefund.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(cancelOrderWithRefund.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const index = state.orders.findIndex(o => o._id === action.payload.order._id);
        if (index !== -1) state.orders[index] = action.payload.order;
        if (state.currentOrder?._id === action.payload.order._id) {
          state.currentOrder = action.payload.order;
        }
      })
      .addCase(cancelOrderWithRefund.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ---- Messages ----
      .addCase(getOrdersWithUnreadMessages.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getOrdersWithUnreadMessages.fulfilled, (state, action) => {
        state.loading = false;
        state.unreadOrders = action.payload;
      })
      .addCase(getOrdersWithUnreadMessages.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(addOrderMessage.pending, (state) => {
        state.messageLoading = true;
        state.error = null;
      })
      .addCase(addOrderMessage.fulfilled, (state, action) => {
        state.messageLoading = false;
        state.success = true;
        state.orderMessages.push(action.payload.message);
      })
      .addCase(addOrderMessage.rejected, (state, action) => {
        state.messageLoading = false;
        state.error = action.payload;
      })

      .addCase(getOrderMessages.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getOrderMessages.fulfilled, (state, action) => {
        state.loading = false;
        state.orderMessages = action.payload.messages;
      })
      .addCase(getOrderMessages.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ---- Tracking / Shipments ----
      .addCase(addTrackingInfo.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addTrackingInfo.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        if (state.currentOrder?._id === action.payload.orderId) {
          state.currentOrder.tracking = action.payload.tracking;
        }
      })
      .addCase(addTrackingInfo.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(createShipment.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createShipment.fulfilled, (state) => {
        state.loading = false;
        state.success = true;
      })
      .addCase(createShipment.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(updateShipmentStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateShipmentStatus.fulfilled, (state) => {
        state.loading = false;
        state.success = true;
      })
      .addCase(updateShipmentStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ---- Reviews ----
      .addCase(fetchAllReviews.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllReviews.fulfilled, (state, action) => {
        state.loading = false;
        state.reviews = action.payload;
      })
      .addCase(fetchAllReviews.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(deleteReview.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteReview.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.reviews = state.reviews.filter(
          r => r._id.toString() !== action.payload.reviewId.toString()
        );
      })
      .addCase(deleteReview.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ---- Fraud ----
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
      })

      .addCase(reviewFraudCheck.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reviewFraudCheck.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.fraudReviews = state.fraudReviews.filter(
          f => f._id.toString() !== action.payload.orderId.toString()
        );
      })
      .addCase(reviewFraudCheck.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ---- Audit Log ----
      .addCase(getOrderAuditLog.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getOrderAuditLog.fulfilled, (state, action) => {
        state.loading = false;
        state.auditLog = action.payload.auditLog;
      })
      .addCase(getOrderAuditLog.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const {
  removeErrors,
  removeSuccess,
  removeProductCreated, // FIX: export the new dedicated action
  clearCurrentUser,
  clearCurrentOrder,
} = adminSlice.actions;

export default adminSlice.reducer;