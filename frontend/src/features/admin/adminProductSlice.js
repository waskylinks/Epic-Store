import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// ============================================
// BASE URL
// ============================================
const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

// ============================================
// ASYNC THUNKS
// ============================================

// GET /admin/products
// Controller res: { success, products }
export const fetchAdminProducts = createAsyncThunk(
  'adminProducts/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/admin/products`, {
        withCredentials: true,
      });
      return data.products; // FIX: return only the array, not the whole envelope
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch products'
      );
    }
  }
);

// GET /product/:id
// Controller res: { success, product }
// Populates: relatedProducts, crossSells, upsells
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

// POST /admin/products/create
// Body: multipart/form-data (req.files + req.body JSON-stringified fields)
// Controller res: { success, product }
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

// PUT /admin/product/:id
// Body: multipart/form-data (same field rules as create)
// Controller res: { success, product }
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

// DELETE /admin/product/:id
// Controller res: { success, message, deletedProduct: { id, name, imagesDeleted } }
export const deleteProduct = createAsyncThunk(
  'adminProducts/delete',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`${API_URL}/admin/product/${id}`, {
        withCredentials: true,
      });
      // FIX: explicitly return the id we passed in (the _id string) alongside
      // the server's deletedProduct summary. data.deletedProduct.id is the
      // same value but we keep our own `id` for the state filter below.
      return {
        id,                          // the _id string we used in the URL
        message: data.message,
        deletedProduct: data.deletedProduct, // { id, name, imagesDeleted }
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to delete product'
      );
    }
  }
);

// DELETE /admin/products/batch-delete
// Body: { productIds: string[] }
// Controller res: { success, message, results: { successful: [{id, name}], failed: [{id, reason}] } }
export const deleteMultipleProducts = createAsyncThunk(
  'adminProducts/batchDelete',
  async (productIds, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(
        `${API_URL}/admin/products/batch-delete`,
        {
          data: { productIds },
          withCredentials: true,
        }
      );
      return {
        results: data.results, // { successful: [{id, name}], failed: [{id, reason}] }
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to batch-delete products'
      );
    }
  }
);

// GET /admin/product/:id/structured-data
// Controller res: { success, structuredData }
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

// ============================================
// REVIEW THUNKS
// ============================================

// GET /reviews?id=:productId
// Controller res: { success, reviews }
export const fetchProductReviews = createAsyncThunk(
  'adminProducts/fetchReviews',
  async (productId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`${API_URL}/reviews`, {
        params: { id: productId }, // req.query.id in controller
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

// DELETE /reviews?productID=:productId&id=:reviewId
// Controller uses req.query.productID and req.query.id
// Controller res: { success, message }
// After deletion the controller recalculates ratings and numOfReviews —
// we pass productId + reviewId back so the reducer can sync local state.
export const deleteProductReview = createAsyncThunk(
  'adminProducts/deleteReview',
  async ({ productId, reviewId }, { rejectWithValue }) => {
    try {
      await axios.delete(`${API_URL}/reviews`, {
        params: {
          productID: productId, // matches req.query.productID
          id: reviewId,         // matches req.query.id
        },
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
  // Full product list — all statuses (admin view)
  products: [],
  productsLoading: false,
  productsError: null,

  // Single product with populated relatedProducts / crossSells / upsells
  selectedProduct: null,
  selectedProductLoading: false,
  selectedProductError: null,

  // JSON-LD structured data for the selected product
  structuredData: null,
  structuredDataLoading: false,
  structuredDataError: null,

  // Reviews for the currently viewed product
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

  // Batch delete — results shape: { successful: [{id, name}], failed: [{id, reason}] }
  batchDeleteLoading: false,
  batchDeleteError: null,
  batchDeleteResults: null, // null until a batch completes

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
    // Call this when navigating away from a product detail page
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
    },
  },

  extraReducers: (builder) => {

    // ── GET /admin/products ───────────────────────────────────────────────
    builder
      .addCase(fetchAdminProducts.pending, (state) => {
        state.productsLoading = true;
        state.productsError   = null;
      })
      .addCase(fetchAdminProducts.fulfilled, (state, { payload }) => {
        state.productsLoading = false;
        state.products        = payload; // already the array after FIX #1
      })
      .addCase(fetchAdminProducts.rejected, (state, { payload }) => {
        state.productsLoading = false;
        state.productsError   = payload;
      });

    // ── GET /product/:id ──────────────────────────────────────────────────
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

    // ── POST /admin/products/create ───────────────────────────────────────
    builder
      .addCase(createProduct.pending, (state) => {
        state.createLoading = true;
        state.createError   = null;
        state.createSuccess = false;
      })
      .addCase(createProduct.fulfilled, (state, { payload }) => {
        state.createLoading = false;
        state.createSuccess = true;
        state.products.unshift(payload); // newest first to match admin table expectation
      })
      .addCase(createProduct.rejected, (state, { payload }) => {
        state.createLoading = false;
        state.createError   = payload;
      });

    // ── PUT /admin/product/:id ────────────────────────────────────────────
    builder
      .addCase(updateProduct.pending, (state) => {
        state.updateLoading = true;
        state.updateError   = null;
        state.updateSuccess = false;
      })
      .addCase(updateProduct.fulfilled, (state, { payload }) => {
        state.updateLoading = false;
        state.updateSuccess = true;
        // Keep product list in sync without a re-fetch
        const idx = state.products.findIndex((p) => p._id === payload._id);
        if (idx !== -1) state.products[idx] = payload;
        // Keep detail view in sync if this product is open
        if (state.selectedProduct?._id === payload._id) {
          state.selectedProduct = payload;
          // FIX: structuredData is generated server-side from the product instance
          // via getStructuredData(). It uses virtuals (finalPrice, url) and live
          // inventory/pricing fields. After an update those values change, so the
          // cached JSON-LD is stale. Clear it so the UI re-fetches if needed.
          state.structuredData = null;
        }
      })
      .addCase(updateProduct.rejected, (state, { payload }) => {
        state.updateLoading = false;
        state.updateError   = payload;
      });

    // ── DELETE /admin/product/:id ─────────────────────────────────────────
    builder
      .addCase(deleteProduct.pending, (state) => {
        state.deleteLoading = true;
        state.deleteError   = null;
        state.deleteSuccess = false;
      })
      .addCase(deleteProduct.fulfilled, (state, { payload }) => {
        state.deleteLoading = false;
        state.deleteSuccess = true;
        // payload.id is the _id string we dispatched with
        state.products = state.products.filter((p) => p._id !== payload.id);
        if (state.selectedProduct?._id === payload.id) {
          state.selectedProduct = null;
        }
      })
      .addCase(deleteProduct.rejected, (state, { payload }) => {
        state.deleteLoading = false;
        state.deleteError   = payload;
      });

    // ── DELETE /admin/products/batch-delete ───────────────────────────────
    // results.successful items have shape { id, name } (from controller)
    builder
      .addCase(deleteMultipleProducts.pending, (state) => {
        state.batchDeleteLoading = true;
        state.batchDeleteError   = null;
        state.batchDeleteResults = null;
      })
      .addCase(deleteMultipleProducts.fulfilled, (state, { payload }) => {
        state.batchDeleteLoading = false;
        state.batchDeleteResults = payload.results;
        // Build a Set of successfully deleted _id strings
        const deletedIds = new Set(
          payload.results.successful.map((r) => r.id)
        );
        state.products = state.products.filter((p) => !deletedIds.has(p._id));
        if (state.selectedProduct && deletedIds.has(state.selectedProduct._id)) {
          state.selectedProduct = null;
        }
      })
      .addCase(deleteMultipleProducts.rejected, (state, { payload }) => {
        state.batchDeleteLoading = false;
        state.batchDeleteError   = payload;
      });

    // ── GET /admin/product/:id/structured-data ────────────────────────────
    builder
      .addCase(fetchProductStructuredData.pending, (state) => {
        state.structuredDataLoading = true;
        state.structuredDataError   = null;
      })
      .addCase(fetchProductStructuredData.fulfilled, (state, { payload }) => {
        state.structuredDataLoading = false;
        state.structuredData        = payload; // already the structuredData object
      })
      .addCase(fetchProductStructuredData.rejected, (state, { payload }) => {
        state.structuredDataLoading = false;
        state.structuredDataError   = payload;
      });

    // ── GET /reviews?id=:productId ────────────────────────────────────────
    builder
      .addCase(fetchProductReviews.pending, (state) => {
        state.reviewsLoading = true;
        state.reviewsError   = null;
      })
      .addCase(fetchProductReviews.fulfilled, (state, { payload }) => {
        state.reviewsLoading = false;
        state.reviews        = payload; // already the reviews array
      })
      .addCase(fetchProductReviews.rejected, (state, { payload }) => {
        state.reviewsLoading = false;
        state.reviewsError   = payload;
      });

    // ── DELETE /reviews?productID=&id= ────────────────────────────────────
    // FIX: after deletion the controller recalculates ratings via calcRating().
    // We can't know the new rating without a re-fetch, so we null it out to
    // signal staleness rather than leaving a wrong value.
    builder
      .addCase(deleteProductReview.pending, (state) => {
        state.deleteReviewLoading = true;
        state.deleteReviewError   = null;
        state.deleteReviewSuccess = false;
      })
      .addCase(deleteProductReview.fulfilled, (state, { payload }) => {
        state.deleteReviewLoading = false;
        state.deleteReviewSuccess = true;

        // FIX: use String() comparison — _id from JSON is already a string
        // but being explicit is safer than assuming
        state.reviews = state.reviews.filter(
          (r) => String(r._id) !== String(payload.reviewId)
        );

        // Sync selectedProduct if it's the product whose review was deleted
        if (
          state.selectedProduct &&
          String(state.selectedProduct._id) === String(payload.productId)
        ) {
          state.selectedProduct.numOfReviews = Math.max(
            0,
            (state.selectedProduct.numOfReviews || 1) - 1
          );
          // FIX: mark rating as stale — controller recalculates with calcRating()
          // which we can't replicate here without the full reviews array.
          // Caller should re-fetch the product or reviews after delete to get
          // the accurate rating.
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
} = adminProductSlice.actions;

// ============================================
// SELECTORS
// ============================================

// Product list
export const selectAdminProducts        = (state) => state.adminProducts.products;
export const selectAdminProductsLoading = (state) => state.adminProducts.productsLoading;
export const selectAdminProductsError   = (state) => state.adminProducts.productsError;

// Selected product (fully populated)
export const selectSelectedProduct        = (state) => state.adminProducts.selectedProduct;
export const selectSelectedProductLoading = (state) => state.adminProducts.selectedProductLoading;
export const selectSelectedProductError   = (state) => state.adminProducts.selectedProductError;

// Structured data (JSON-LD)
export const selectStructuredData        = (state) => state.adminProducts.structuredData;
export const selectStructuredDataLoading = (state) => state.adminProducts.structuredDataLoading;
export const selectStructuredDataError   = (state) => state.adminProducts.structuredDataError;

// Reviews
export const selectReviews        = (state) => state.adminProducts.reviews;
export const selectReviewsLoading = (state) => state.adminProducts.reviewsLoading;
export const selectReviewsError   = (state) => state.adminProducts.reviewsError;

// CRUD status bundles (loading + error + success)
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
  // results: { successful: [{id, name}], failed: [{id, reason}] }
  results: state.adminProducts.batchDeleteResults,
});

export const selectDeleteReviewStatus = (state) => ({
  loading: state.adminProducts.deleteReviewLoading,
  error:   state.adminProducts.deleteReviewError,
  success: state.adminProducts.deleteReviewSuccess,
});

// ── Derived selectors (no re-computation cost for simple filters) ──────────

// Find a product by its _id string directly from the list
export const selectProductById = (id) => (state) =>
  state.adminProducts.products.find((p) => p._id === id) ?? null;

// Status-based filters — matches model enum: 'draft' | 'published' | 'archived'
export const selectPublishedProducts = (state) =>
  state.adminProducts.products.filter((p) => p.status === 'published');

export const selectDraftProducts = (state) =>
  state.adminProducts.products.filter((p) => p.status === 'draft');

export const selectArchivedProducts = (state) =>
  state.adminProducts.products.filter((p) => p.status === 'archived');

// Inventory-based filters — matches model enum: 'InStock' | 'LowStock' | 'OutOfStock' | 'Discontinued'
export const selectLowStockProducts = (state) =>
  state.adminProducts.products.filter(
    (p) => p.inventory?.status === 'LowStock'
  );

export const selectOutOfStockProducts = (state) =>
  state.adminProducts.products.filter(
    (p) => p.inventory?.status === 'OutOfStock'
  );

export const selectDiscontinuedProducts = (state) =>
  state.adminProducts.products.filter(
    (p) => p.inventory?.status === 'Discontinued'
  );

// Flag-based filters — matches model booleans
export const selectFeaturedProducts  = (state) =>
  state.adminProducts.products.filter((p) => p.isFeatured);

export const selectBestsellerProducts = (state) =>
  state.adminProducts.products.filter((p) => p.isBestseller);

export const selectNewArrivalProducts = (state) =>
  state.adminProducts.products.filter((p) => p.isNewArrival);

export const selectOnSaleProducts = (state) =>
  state.adminProducts.products.filter((p) => p.isOnSale);

// Count
export const selectProductsCount = (state) => state.adminProducts.products.length;

// ============================================
// REDUCER
// ============================================
export default adminProductSlice.reducer;