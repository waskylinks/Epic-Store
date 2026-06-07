import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// ── Thunks ────────────────────────────────────────────────────────────────────

export const getWishlist = createAsyncThunk('wishlist/getWishlist', async (_, { rejectWithValue }) => {
  try {
    const { data } = await axios.get('/api/v1/wishlist');
    return data; // { wishlist, count }
  } catch (err) {
    return rejectWithValue(err.response?.data?.message || 'Failed to fetch wishlist');
  }
});

export const addToWishlist = createAsyncThunk('wishlist/addToWishlist', async (productId, { rejectWithValue }) => {
  try {
    const { data } = await axios.post('/api/v1/wishlist/add', { productId });
    return data; // { wishlistItem, wishlistCount }
  } catch (err) {
    return rejectWithValue(err.response?.data?.message || 'Failed to add to wishlist');
  }
});

export const removeFromWishlist = createAsyncThunk('wishlist/removeFromWishlist', async (productId, { rejectWithValue }) => {
  try {
    const { data } = await axios.delete(`/api/v1/wishlist/remove/${productId}`);
    return data; // { removedProductId, wishlistCount }
  } catch (err) {
    return rejectWithValue(err.response?.data?.message || 'Failed to remove from wishlist');
  }
});

export const clearWishlist = createAsyncThunk('wishlist/clearWishlist', async (_, { rejectWithValue }) => {
  try {
    const { data } = await axios.delete('/api/v1/wishlist/clear');
    return data;
  } catch (err) {
    return rejectWithValue(err.response?.data?.message || 'Failed to clear wishlist');
  }
});

// ── Slice ─────────────────────────────────────────────────────────────────────

const wishlistSlice = createSlice({
  name: 'wishlist',
  initialState: {
    items:       [],   // always the source of truth — derive count from items.length
    loading:     false,
    error:       null,
    success:     false,
    message:     null,
    itemLoading: {},   // { [productId]: boolean } — per-item busy state
  },

  reducers: {
    removeErrors:  (state) => { state.error   = null; },
    removeMessage: (state) => { state.message = null; state.success = false; },
  },

  extraReducers: (builder) => {

    // ── getWishlist ──────────────────────────────────────────────────────────
    builder
      .addCase(getWishlist.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getWishlist.fulfilled, (state, action) => {
        state.loading = false;
        // Backend sends `wishlist` array; normalise field name → items
        state.items   = action.payload.wishlist ?? action.payload.items ?? [];
      })
      .addCase(getWishlist.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ── addToWishlist ────────────────────────────────────────────────────────
    builder
      .addCase(addToWishlist.pending, (state, action) => {
        // action.meta.arg is the productId passed to the thunk
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(addToWishlist.fulfilled, (state, action) => {
        const productId = action.meta.arg;
        state.itemLoading[productId] = false;
        state.success = true;
        state.message = action.payload.message;

        // [FIX] Push the populated wishlistItem returned by the backend
        // directly into state.items. No getWishlist() round-trip needed.
        const newItem = action.payload.wishlistItem;
        if (newItem) {
          // Avoid duplicates (defensive)
          const alreadyIn = state.items.some(i => {
            const id = i.product?._id || i.product;
            return id === (newItem.product?._id || newItem.product);
          });
          if (!alreadyIn) state.items.push(newItem);
        }
      })
      .addCase(addToWishlist.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload;
      });

    // ── removeFromWishlist ───────────────────────────────────────────────────
    builder
      .addCase(removeFromWishlist.pending, (state, action) => {
        state.itemLoading[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(removeFromWishlist.fulfilled, (state, action) => {
        const productId = action.meta.arg;
        state.itemLoading[productId] = false;
        state.success = true;
        state.message = action.payload.message;

        // [FIX] Filter out by the removedProductId returned from the backend,
        // handling both populated ({ product: { _id } }) and raw-id shapes.
        const removed = action.payload.removedProductId || productId;
        state.items = state.items.filter(i => {
          const id = i.product?._id || i.product;
          return id !== removed;
        });
      })
      .addCase(removeFromWishlist.rejected, (state, action) => {
        state.itemLoading[action.meta.arg] = false;
        state.error = action.payload;
      });

    // ── clearWishlist ────────────────────────────────────────────────────────
    builder
      .addCase(clearWishlist.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(clearWishlist.fulfilled, (state, action) => {
        state.loading = false;
        state.items   = [];
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(clearWishlist.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });
  },
});

export const { removeErrors, removeMessage } = wishlistSlice.actions;
export default wishlistSlice.reducer;