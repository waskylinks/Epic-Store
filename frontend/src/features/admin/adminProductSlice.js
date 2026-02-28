import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

// ============================================
// ASYNC THUNKS
// ============================================

export const fetchAdminProducts = createAsyncThunk(
  'adminProducts/fetchAll',
  async (params = {}, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/admin/products`, {
        params,
        withCredentials: true,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch products'
      );
    }
  }
);

// NEW: Fetch accurate aggregate counts for stat cards
// GET /admin/products/stats
export const fetchAdminProductStats = createAsyncThunk(
  'adminProducts/fetchStats',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/admin/products/stats`, {
        withCredentials: true,
      });
      return data.stats;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch product stats'
      );
    }
  }
);

export const fetchAdminProductDetails = createAsyncThunk(
  'adminProducts/fetchDetails',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/product/${id}`, {
        withCredentials: true,
      });
      return data.product;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch product details'
      );
    }
  }
);

export const createProduct = createAsyncThunk(
  'adminProducts/create',
  async (formData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_URL}/admin/products/create`,
        formData,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      return data.product;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to create product'
      );
    }
  }
);

export const updateProduct = createAsyncThunk(
  'adminProducts/update',
  async ({ id, formData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `${API_URL}/admin/product/${id}`,
        formData,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      return data.product;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to update product'
      );
    }
  }
);

export const deleteProduct = createAsyncThunk(
  'adminProducts/delete',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`${API_URL}/admin/product/${id}`, {
        withCredentials: true,
      });
      return { id, message: data.message, deletedProduct: data.deletedProduct };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to delete product'
      );
    }
  }
);

export const deleteMultipleProducts = createAsyncThunk(
  'adminProducts/batchDelete',
  async (productIds, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(
        `${API_URL}/admin/products/batch-delete`,
        { data: { productIds }, withCredentials: true }
      );
      return { results: data.results };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to batch-delete products'
      );
    }
  }
);

export const fetchProductStructuredData = createAsyncThunk(
  'adminProducts/fetchStructuredData',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `${API_URL}/admin/product/${id}/structured-data`,
        { withCredentials: true }
      );
      return data.structuredData;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch structured data'
      );
    }
  }
);

export const fetchProductReviews = createAsyncThunk(
  'adminProducts/fetchReviews',
  async (productId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/reviews`, {
        params: { id: productId },
        withCredentials: true,
      });
      return data.reviews;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch reviews'
      );
    }
  }
);

export const deleteProductReview = createAsyncThunk(
  'adminProducts/deleteReview',
  async ({ productId, reviewId }, { rejectWithValue }) => {
    try {
      await axios.delete(`${API_URL}/reviews`, {
        params: { productID: productId, id: reviewId },
        withCredentials: true,
      });
      return { productId, reviewId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to delete review'
      );
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  // Product list
  products: [],
  productsLoading: false,
  productsError: null,

  // Pagination meta
  total: 0,
  totalPages: 0,
  currentPage: 1,
  resultPerPage: 20,

  // Accurate aggregate stats (from /admin/products/stats endpoint)
  // Shape: { total, published, draft, archived, inStock, lowStock,
  //          outOfStock, discontinued, featured, onSale, bestseller, newArrival }
  stats: null,
  statsLoading: false,
  statsError: null,

  // Single product
  selectedProduct: null,
  selectedProductLoading: false,
  selectedProductError: null,

  // Structured data
  structuredData: null,
  structuredDataLoading: false,
  structuredDataError: null,

  // Reviews
  reviews: [],
  reviewsLoading: false,
  reviewsError: null,

  // Create
  createLoading: false,
  createError: null,
  createSuccess: false,

  // Update
  updateLoading: false,
  updateError: null,
  updateSuccess: false,

  // Single delete
  deleteLoading: false,
  deleteError: null,
  deleteSuccess: false,

  // Batch delete
  batchDeleteLoading: false,
  batchDeleteError: null,
  batchDeleteResults: null,

  // Delete review
  deleteReviewLoading: false,
  deleteReviewError: null,
  deleteReviewSuccess: false,
};

// ============================================
// SLICE
// ============================================

const adminProductSlice = createSlice({
  name: 'adminProducts',
  initialState,

  reducers: {
    clearCreateStatus(state) {
      state.createLoading = false;
      state.createError   = null;
      state.createSuccess = false;
    },
    clearUpdateStatus(state) {
      state.updateLoading = false;
      state.updateError   = null;
      state.updateSuccess = false;
    },
    clearDeleteStatus(state) {
      state.deleteLoading = false;
      state.deleteError   = null;
      state.deleteSuccess = false;
    },
    clearBatchDeleteStatus(state) {
      state.batchDeleteLoading = false;
      state.batchDeleteError   = null;
      state.batchDeleteResults = null;
    },
    clearDeleteReviewStatus(state) {
      state.deleteReviewLoading = false;
      state.deleteReviewError   = null;
      state.deleteReviewSuccess = false;
    },
    clearSelectedProduct(state) {
      state.selectedProduct      = null;
      state.selectedProductError = null;
      state.structuredData       = null;
      state.reviews              = [];
    },
    clearAllErrors(state) {
      state.productsError        = null;
      state.selectedProductError = null;
      state.structuredDataError  = null;
      state.reviewsError         = null;
      state.createError          = null;
      state.updateError          = null;
      state.deleteError          = null;
      state.batchDeleteError     = null;
      state.deleteReviewError    = null;
      state.statsError           = null;
    },
    // Optimistically bump stats after a create/delete (optional, avoids a re-fetch)
    adjustStats(state, { payload }) {
      if (!state.stats) return;
      // payload: { delta: 1 | -1, status, inventoryStatus, isFeatured, isOnSale, ... }
      const { delta, status, inventoryStatus, isFeatured, isOnSale, isBestseller, isNewArrival } = payload;
      state.stats.total        += delta;
      if (status === 'published')  state.stats.published  += delta;
      if (status === 'draft')      state.stats.draft      += delta;
      if (status === 'archived')   state.stats.archived   += delta;
      if (inventoryStatus === 'InStock')      state.stats.inStock      += delta;
      if (inventoryStatus === 'LowStock')     state.stats.lowStock     += delta;
      if (inventoryStatus === 'OutOfStock')   state.stats.outOfStock   += delta;
      if (inventoryStatus === 'Discontinued') state.stats.discontinued += delta;
      if (isFeatured)   state.stats.featured   += delta;
      if (isOnSale)     state.stats.onSale     += delta;
      if (isBestseller) state.stats.bestseller += delta;
      if (isNewArrival) state.stats.newArrival += delta;
    },
  },

  extraReducers: (builder) => {

    // ── fetchAdminProducts ────────────────────────────────────────────────
    builder
      .addCase(fetchAdminProducts.pending, (state) => {
        state.productsLoading = true;
        state.productsError   = null;
      })
      .addCase(fetchAdminProducts.fulfilled, (state, { payload }) => {
        state.productsLoading = false;
        state.products        = payload.products;
        state.total           = payload.total;
        state.totalPages      = payload.totalPages;
        state.currentPage     = payload.currentPage;
        state.resultPerPage   = payload.resultPerPage;
      })
      .addCase(fetchAdminProducts.rejected, (state, { payload }) => {
        state.productsLoading = false;
        state.productsError   = payload;
      });

    // ── fetchAdminProductStats (NEW) ──────────────────────────────────────
    builder
      .addCase(fetchAdminProductStats.pending, (state) => {
        state.statsLoading = true;
        state.statsError   = null;
      })
      .addCase(fetchAdminProductStats.fulfilled, (state, { payload }) => {
        state.statsLoading = false;
        state.stats        = payload;
      })
      .addCase(fetchAdminProductStats.rejected, (state, { payload }) => {
        state.statsLoading = false;
        state.statsError   = payload;
      });

    // ── fetchAdminProductDetails ──────────────────────────────────────────
    builder
      .addCase(fetchAdminProductDetails.pending, (state) => {
        state.selectedProductLoading = true;
        state.selectedProductError   = null;
        state.selectedProduct        = null;
      })
      .addCase(fetchAdminProductDetails.fulfilled, (state, { payload }) => {
        state.selectedProductLoading = false;
        state.selectedProduct        = payload;
      })
      .addCase(fetchAdminProductDetails.rejected, (state, { payload }) => {
        state.selectedProductLoading = false;
        state.selectedProductError   = payload;
      });

    // ── createProduct ─────────────────────────────────────────────────────
    builder
      .addCase(createProduct.pending, (state) => {
        state.createLoading = true;
        state.createError   = null;
        state.createSuccess = false;
      })
      .addCase(createProduct.fulfilled, (state, { payload }) => {
        state.createLoading = false;
        state.createSuccess = true;
        state.products.unshift(payload);
        state.total += 1;
        // Invalidate stats so next visit re-fetches accurate counts
        state.stats = null;
      })
      .addCase(createProduct.rejected, (state, { payload }) => {
        state.createLoading = false;
        state.createError   = payload;
      });

    // ── updateProduct ─────────────────────────────────────────────────────
    builder
      .addCase(updateProduct.pending, (state) => {
        state.updateLoading = true;
        state.updateError   = null;
        state.updateSuccess = false;
      })
      .addCase(updateProduct.fulfilled, (state, { payload }) => {
        state.updateLoading = false;
        state.updateSuccess = true;
        const idx = state.products.findIndex((p) => p._id === payload._id);
        if (idx !== -1) state.products[idx] = payload;
        if (state.selectedProduct?._id === payload._id) {
          state.selectedProduct = payload;
          state.structuredData  = null;
        }
        // Status/flags may have changed — invalidate stats
        state.stats = null;
      })
      .addCase(updateProduct.rejected, (state, { payload }) => {
        state.updateLoading = false;
        state.updateError   = payload;
      });

    // ── deleteProduct ─────────────────────────────────────────────────────
    builder
      .addCase(deleteProduct.pending, (state) => {
        state.deleteLoading = true;
        state.deleteError   = null;
        state.deleteSuccess = false;
      })
      .addCase(deleteProduct.fulfilled, (state, { payload }) => {
        state.deleteLoading = false;
        state.deleteSuccess = true;
        state.products      = state.products.filter((p) => p._id !== payload.id);
        state.total         = Math.max(0, state.total - 1);
        if (state.selectedProduct?._id === payload.id) {
          state.selectedProduct = null;
        }
        state.stats = null;
      })
      .addCase(deleteProduct.rejected, (state, { payload }) => {
        state.deleteLoading = false;
        state.deleteError   = payload;
      });

    // ── deleteMultipleProducts ────────────────────────────────────────────
    builder
      .addCase(deleteMultipleProducts.pending, (state) => {
        state.batchDeleteLoading = true;
        state.batchDeleteError   = null;
        state.batchDeleteResults = null;
      })
      .addCase(deleteMultipleProducts.fulfilled, (state, { payload }) => {
        state.batchDeleteLoading = false;
        state.batchDeleteResults = payload.results;
        const deletedIds = new Set(payload.results.successful.map((r) => r.id));
        state.products   = state.products.filter((p) => !deletedIds.has(p._id));
        state.total      = Math.max(0, state.total - deletedIds.size);
        if (state.selectedProduct && deletedIds.has(state.selectedProduct._id)) {
          state.selectedProduct = null;
        }
        state.stats = null;
      })
      .addCase(deleteMultipleProducts.rejected, (state, { payload }) => {
        state.batchDeleteLoading = false;
        state.batchDeleteError   = payload;
      });

    // ── fetchProductStructuredData ────────────────────────────────────────
    builder
      .addCase(fetchProductStructuredData.pending, (state) => {
        state.structuredDataLoading = true;
        state.structuredDataError   = null;
      })
      .addCase(fetchProductStructuredData.fulfilled, (state, { payload }) => {
        state.structuredDataLoading = false;
        state.structuredData        = payload;
      })
      .addCase(fetchProductStructuredData.rejected, (state, { payload }) => {
        state.structuredDataLoading = false;
        state.structuredDataError   = payload;
      });

    // ── fetchProductReviews ───────────────────────────────────────────────
    builder
      .addCase(fetchProductReviews.pending, (state) => {
        state.reviewsLoading = true;
        state.reviewsError   = null;
      })
      .addCase(fetchProductReviews.fulfilled, (state, { payload }) => {
        state.reviewsLoading = false;
        state.reviews        = payload;
      })
      .addCase(fetchProductReviews.rejected, (state, { payload }) => {
        state.reviewsLoading = false;
        state.reviewsError   = payload;
      });

    // ── deleteProductReview ───────────────────────────────────────────────
    builder
      .addCase(deleteProductReview.pending, (state) => {
        state.deleteReviewLoading = true;
        state.deleteReviewError   = null;
        state.deleteReviewSuccess = false;
      })
      .addCase(deleteProductReview.fulfilled, (state, { payload }) => {
        state.deleteReviewLoading = false;
        state.deleteReviewSuccess = true;
        state.reviews = state.reviews.filter(
          (r) => String(r._id) !== String(payload.reviewId)
        );
        if (
          state.selectedProduct &&
          String(state.selectedProduct._id) === String(payload.productId)
        ) {
          state.selectedProduct.numOfReviews = Math.max(
            0,
            (state.selectedProduct.numOfReviews || 1) - 1
          );
          state.selectedProduct.ratings = null;
        }
      })
      .addCase(deleteProductReview.rejected, (state, { payload }) => {
        state.deleteReviewLoading = false;
        state.deleteReviewError   = payload;
      });
  },
});

// ============================================
// ACTIONS
// ============================================
export const {
  clearCreateStatus,
  clearUpdateStatus,
  clearDeleteStatus,
  clearBatchDeleteStatus,
  clearDeleteReviewStatus,
  clearSelectedProduct,
  clearAllErrors,
  adjustStats,
} = adminProductSlice.actions;

// ============================================
// SELECTORS
// ============================================

export const selectAdminProducts        = (state) => state.adminProducts.products;
export const selectAdminProductsLoading = (state) => state.adminProducts.productsLoading;
export const selectAdminProductsError   = (state) => state.adminProducts.productsError;

export const selectPaginationMeta = (state) => ({
  total:         state.adminProducts.total,
  totalPages:    state.adminProducts.totalPages,
  currentPage:   state.adminProducts.currentPage,
  resultPerPage: state.adminProducts.resultPerPage,
});

// Accurate aggregate stats from the /stats endpoint
export const selectAdminProductStats        = (state) => state.adminProducts.stats;
export const selectAdminProductStatsLoading = (state) => state.adminProducts.statsLoading;
export const selectAdminProductStatsError   = (state) => state.adminProducts.statsError;

export const selectSelectedProduct        = (state) => state.adminProducts.selectedProduct;
export const selectSelectedProductLoading = (state) => state.adminProducts.selectedProductLoading;
export const selectSelectedProductError   = (state) => state.adminProducts.selectedProductError;

export const selectStructuredData        = (state) => state.adminProducts.structuredData;
export const selectStructuredDataLoading = (state) => state.adminProducts.structuredDataLoading;
export const selectStructuredDataError   = (state) => state.adminProducts.structuredDataError;

export const selectReviews        = (state) => state.adminProducts.reviews;
export const selectReviewsLoading = (state) => state.adminProducts.reviewsLoading;
export const selectReviewsError   = (state) => state.adminProducts.reviewsError;

export const selectCreateStatus = (state) => ({
  loading: state.adminProducts.createLoading,
  error:   state.adminProducts.createError,
  success: state.adminProducts.createSuccess,
});
export const selectUpdateStatus = (state) => ({
  loading: state.adminProducts.updateLoading,
  error:   state.adminProducts.updateError,
  success: state.adminProducts.updateSuccess,
});
export const selectDeleteStatus = (state) => ({
  loading: state.adminProducts.deleteLoading,
  error:   state.adminProducts.deleteError,
  success: state.adminProducts.deleteSuccess,
});
export const selectBatchDeleteStatus = (state) => ({
  loading: state.adminProducts.batchDeleteLoading,
  error:   state.adminProducts.batchDeleteError,
  results: state.adminProducts.batchDeleteResults,
});
export const selectDeleteReviewStatus = (state) => ({
  loading: state.adminProducts.deleteReviewLoading,
  error:   state.adminProducts.deleteReviewError,
  success: state.adminProducts.deleteReviewSuccess,
});

// Derived selectors — these still work on the current page slice for
// things like highlighting rows, but stat cards should use selectAdminProductStats.
export const selectProductById = (id) => (state) =>
  state.adminProducts.products.find((p) => p._id === id) ?? null;

// DEPRECATED for stat cards — kept for backwards compat / row-level use
export const selectPublishedProducts  = (state) => state.adminProducts.products.filter((p) => p.status === 'published');
export const selectDraftProducts      = (state) => state.adminProducts.products.filter((p) => p.status === 'draft');
export const selectArchivedProducts   = (state) => state.adminProducts.products.filter((p) => p.status === 'archived');
export const selectLowStockProducts   = (state) => state.adminProducts.products.filter((p) => p.inventory?.status === 'LowStock');
export const selectOutOfStockProducts = (state) => state.adminProducts.products.filter((p) => p.inventory?.status === 'OutOfStock');
export const selectFeaturedProducts   = (state) => state.adminProducts.products.filter((p) => p.isFeatured);
export const selectOnSaleProducts     = (state) => state.adminProducts.products.filter((p) => p.isOnSale);
export const selectBestsellerProducts = (state) => state.adminProducts.products.filter((p) => p.isBestseller);
export const selectNewArrivalProducts = (state) => state.adminProducts.products.filter((p) => p.isNewArrival);
export const selectProductsCount      = (state) => state.adminProducts.total;

export default adminProductSlice.reducer;