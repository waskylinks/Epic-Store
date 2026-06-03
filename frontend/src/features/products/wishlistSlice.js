import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// [FIX] Import analytics SDK so addToWishlist sends an eventId and full
// attribution context to the backend. The backend wishlistController uses
// these to fire Meta CAPI AddToWishlist + GA4 add_to_wishlist with maximum
// Event Match Quality — the same pattern used in cartSlice.addItemsToCart.
import {
  generateEventId,
  buildClientAnalyticsPayload,
  ANALYTICS_EVENTS,
} from '../../utils/analytics.js';

axios.defaults.withCredentials = true;

// ==================== ASYNC THUNKS ====================

// GET WISHLIST
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

// ADD TO WISHLIST
// [FIX] Generate eventId and build analytics payload so the backend can fire
// Meta CAPI AddToWishlist and GA4 add_to_wishlist with:
//   - analyticsEventId for deduplication against any browser pixel event
//   - fbp / fbc for Meta user matching
//   - ga4ClientId to tie the server event to the browser GA4 session
//   - clientAttribution for UTM / click ID signals
//
// The backend wishlistController reads req.body.analyticsEventId,
// req.body.fbp, req.body.fbc, req.body.ga4ClientId, and
// req.body.clientAttribution — the same fields as addItemsToCart.
export const addToWishlist = createAsyncThunk(
  'wishlist/addToWishlist',
  async (productId, { rejectWithValue }) => {
    try {
      const eventId = generateEventId();

      // buildClientAnalyticsPayload reads UTMs, click IDs, fbp, fbc, and
      // ga4ClientId from localStorage / cookies at call time and packages
      // them into a single flat object ready for the request body.
      // [FIX] Use ADD_TO_WISHLIST, not ADD_TO_CART.
      // ADD_TO_WISHLIST was missing from the frontend ANALYTICS_EVENTS constants
      // in analytics.js — it has been added there. Using ADD_TO_CART here was
      // semantically wrong: the backend ingestion endpoint logs eventType as-is
      // into BigQuery's events table, so a wishlist add would have appeared as
      // an add_to_cart event in all analytical queries.
      const analyticsPayload = buildClientAnalyticsPayload({
        eventType:        ANALYTICS_EVENTS.ADD_TO_WISHLIST,
        analyticsEventId: eventId,
      });

      const config = { headers: { 'Content-Type': 'application/json' } };
      const { data } = await axios.post(
        '/api/v1/wishlist/add',
        {
          productId,
          // [FIX] Spread analytics payload so backend receives all signals
          // needed by sendMetaAddToWishlist and sendGA4AddToWishlist.
          ...analyticsPayload,
        },
        config
      );
      return { ...data, productId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: 'Failed to add to wishlist' }
      );
    }
  }
);

// REMOVE FROM WISHLIST
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

// CLEAR WISHLIST
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

// CHECK WISHLIST STATUS
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

// MOVE TO CART
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
    loading: false,
    error: null,
    success: false,
    message: null,
    itemLoading: {}, // Track loading state per product ID
  },
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    removeMessage: (state) => {
      state.success = false;
      state.message = null;
    },
    // Optimistic local add (for instant UI feedback)
    optimisticAdd: (state, action) => {
      const product = action.payload;
      const exists = state.items.some(item => item.product._id === product._id);
      if (!exists) {
        state.items.push({ product, addedAt: new Date().toISOString() });
        state.count = state.items.length;
      }
    },
    // Optimistic local remove (for instant UI feedback)
    optimisticRemove: (state, action) => {
      const productId = action.payload;
      state.items = state.items.filter(item => item.product._id !== productId);
      state.count = state.items.length;
    },
  },
  extraReducers: (builder) => {
    // GET WISHLIST
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

    // ADD TO WISHLIST
    builder
      .addCase(addToWishlist.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(addToWishlist.fulfilled, (state, action) => {
        state.itemLoading[action.payload.productId] = false;
        state.success = true;
        state.message = action.payload.message || 'Added to wishlist';
        state.count = action.payload.wishlistCount || state.count;
        // Note: Refresh the full wishlist to get complete product data
      })
      .addCase(addToWishlist.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload?.message || 'Failed to add to wishlist';
      });

    // REMOVE FROM WISHLIST
    builder
      .addCase(removeFromWishlist.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(removeFromWishlist.fulfilled, (state, action) => {
        state.itemLoading[action.payload.productId] = false;
        state.success = true;
        state.message = action.payload.message || 'Removed from wishlist';
        state.items = state.items.filter(
          item => item.product._id !== action.payload.productId
        );
        state.count = action.payload.wishlistCount || state.items.length;
      })
      .addCase(removeFromWishlist.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload?.message || 'Failed to remove from wishlist';
      });

    // CLEAR WISHLIST
    builder
      .addCase(clearWishlist.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(clearWishlist.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message || 'Wishlist cleared';
        state.items = [];
        state.count = 0;
      })
      .addCase(clearWishlist.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to clear wishlist';
      });

    // MOVE TO CART
    builder
      .addCase(moveToCart.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(moveToCart.fulfilled, (state, action) => {
        state.itemLoading[action.payload.productId] = false;
        state.success = true;
        state.message = action.payload.message || 'Moved to cart';
        state.items = state.items.filter(
          item => item.product._id !== action.payload.productId
        );
        state.count = action.payload.wishlistCount || state.items.length;
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
  optimisticRemove
} = wishlistSlice.actions;

export default wishlistSlice.reducer;