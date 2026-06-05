import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

import {
  generateEventId,
  buildClientAnalyticsPayload,
  ANALYTICS_EVENTS,
} from '../../utils/analytics.js';

axios.defaults.withCredentials = true;

// ==================== ASYNC THUNKS ====================

export const getWishlist = createAsyncThunk(
  'wishlist/getWishlist',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get('/api/v1/wishlist');
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to load wishlist' }
      );
    }
  }
);

export const addToWishlist = createAsyncThunk(
  'wishlist/addToWishlist',
  async (productId, { rejectWithValue }) => {
    try {
      const eventId = generateEventId();
      const analyticsPayload = buildClientAnalyticsPayload({
        eventType:        ANALYTICS_EVENTS.ADD_TO_WISHLIST,
        analyticsEventId: eventId,
      });

      const { data } = await axios.post(
        '/api/v1/wishlist/add',
        { productId, ...analyticsPayload },
        { headers: { 'Content-Type': 'application/json' } }
      );
      return { ...data, productId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to add to wishlist' }
      );
    }
  }
);

export const removeFromWishlist = createAsyncThunk(
  'wishlist/removeFromWishlist',
  async (productId, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/wishlist/remove/${productId}`);
      return { ...data, productId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to remove from wishlist' }
      );
    }
  }
);

export const clearWishlist = createAsyncThunk(
  'wishlist/clearWishlist',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete('/api/v1/wishlist/clear');
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to clear wishlist' }
      );
    }
  }
);

export const checkWishlistStatus = createAsyncThunk(
  'wishlist/checkStatus',
  async (productId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/wishlist/check/${productId}`);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to check wishlist status' }
      );
    }
  }
);

export const moveToCart = createAsyncThunk(
  'wishlist/moveToCart',
  async (productId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`/api/v1/wishlist/move-to-cart/${productId}`);
      return { ...data, productId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to move to cart' }
      );
    }
  }
);

// ==================== SLICE ====================

const wishlistSlice = createSlice({
  name: 'wishlist',
  initialState: {
    items: [],
    count: 0,
    // Separate loading flags:
    //   loading      → only true during getWishlist (full-list fetch)
    //   actionLoading → true during clearWishlist
    //   itemLoading  → per-product-id loading map for add/remove/move
    loading: false,
    actionLoading: false,
    error: null,
    success: false,
    message: null,
    itemLoading: {},
  },
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    removeMessage: (state) => {
      state.success = false;
      state.message = null;
    },
    // Optimistic local add — used by ProductDetails and CartItem
    optimisticAdd: (state, action) => {
      const product = action.payload;
      const exists = state.items.some(
        item => (item.product?._id || item.product) === product._id
      );
      if (!exists) {
        state.items.push({ product, addedAt: new Date().toISOString() });
        state.count = state.items.length;
      }
    },
    // Optimistic local remove
    optimisticRemove: (state, action) => {
      const productId = action.payload;
      state.items = state.items.filter(
        item => (item.product?._id || item.product) !== productId
      );
      state.count = state.items.length;
    },
  },
  extraReducers: (builder) => {

    // ── GET WISHLIST ──────────────────────────────────────────────────────────
    builder
      .addCase(getWishlist.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getWishlist.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.wishlist || [];
        state.count = action.payload.count || 0;
      })
      .addCase(getWishlist.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to load wishlist';
        state.items = [];
        state.count = 0;
      });

    // ── ADD TO WISHLIST ───────────────────────────────────────────────────────
    // On fulfilled: patch items immediately so any component reading
    // wishlistItems.some(...) sees the update without waiting for a refetch.
    // The item shape mirrors what the server returns on getWishlist so
    // isInWishlist checks work correctly everywhere.
    builder
      .addCase(addToWishlist.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(addToWishlist.fulfilled, (state, action) => {
        const { productId } = action.payload;
        state.itemLoading[productId] = false;
        state.success = true;
        state.message = action.payload.message || 'Added to wishlist';
        state.count = action.payload.wishlistCount ?? state.count;

        // Patch items so isInWishlist is true immediately.
        // A full getWishlist() will overwrite this with complete product data.
        const alreadyPresent = state.items.some(
          item => (item.product?._id || item.product) === productId
        );
        if (!alreadyPresent) {
          // Store minimal shape; components fall back to product._id check
          state.items.push({
            product: { _id: productId },
            addedAt: new Date().toISOString(),
          });
        }
      })
      .addCase(addToWishlist.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload?.message || 'Failed to add to wishlist';
      });

    // ── REMOVE FROM WISHLIST ──────────────────────────────────────────────────
    builder
      .addCase(removeFromWishlist.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(removeFromWishlist.fulfilled, (state, action) => {
        const { productId } = action.payload;
        state.itemLoading[productId] = false;
        state.success = true;
        state.message = action.payload.message || 'Removed from wishlist';
        state.items = state.items.filter(
          item => (item.product?._id || item.product) !== productId
        );
        state.count = action.payload.wishlistCount ?? state.items.length;
      })
      .addCase(removeFromWishlist.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload?.message || 'Failed to remove from wishlist';
      });

    // ── CLEAR WISHLIST ────────────────────────────────────────────────────────
    // Uses actionLoading so it doesn't trigger the full-page loader
    builder
      .addCase(clearWishlist.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(clearWishlist.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success = true;
        state.message = action.payload.message || 'Wishlist cleared';
        state.items = [];
        state.count = 0;
      })
      .addCase(clearWishlist.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload?.message || 'Failed to clear wishlist';
      });

    // ── MOVE TO CART ──────────────────────────────────────────────────────────
    builder
      .addCase(moveToCart.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(moveToCart.fulfilled, (state, action) => {
        const { productId } = action.payload;
        state.itemLoading[productId] = false;
        state.success = true;
        state.message = action.payload.message || 'Moved to cart';
        state.items = state.items.filter(
          item => (item.product?._id || item.product) !== productId
        );
        state.count = action.payload.wishlistCount ?? state.items.length;
      })
      .addCase(moveToCart.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload?.message || 'Failed to move to cart';
      });
  },
});

export const {
  removeErrors,
  removeMessage,
  optimisticAdd,
  optimisticRemove,
} = wishlistSlice.actions;

export default wishlistSlice.reducer;