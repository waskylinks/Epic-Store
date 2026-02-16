import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// ============================================
// GET ALL PRODUCTS
// ============================================
export const getProduct = createAsyncThunk(
  'product/getProduct',
  async ({ keyword, page = 1, category }, { rejectWithValue }) => {
    try {
      let link = '/api/v1/products?page=' + page;
      if (category) {
        link += `&category=${category}`;
      }
      if (keyword) {
        link += `&keyword=${keyword}`;
      }

      const { data } = await axios.get(link);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'An error occurred');
    }
  }
);

// ============================================
// GET PRODUCT DETAILS BY ID
// ============================================
export const getProductDetails = createAsyncThunk(
  'product/getProductDetails',
  async (id, { rejectWithValue }) => {
    try {
      const link = `/api/v1/product/${id}`;
      const { data } = await axios.get(link);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'An error occurred');
    }
  }
);

// ============================================
// GET PRODUCT BY SLUG (SEO-FRIENDLY)
// ============================================
export const getProductBySlug = createAsyncThunk(
  'product/getProductBySlug',
  async (slug, { rejectWithValue }) => {
    try {
      const link = `/api/v1/products/${slug}`;
      const { data } = await axios.get(link);

      // Handle 301 redirect for old slugs
      if (data.redirect) {
        return rejectWithValue({
          redirect: true,
          newSlug: data.newSlug,
          newUrl: data.newUrl,
          message: data.message
        });
      }

      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Product not found');
    }
  }
);

// ============================================
// SUBMIT REVIEW
// ============================================
export const createReviews = createAsyncThunk(
  'product/createReviews',
  async ({ rating, comment, productID, reviewTitle, pros, cons }, { rejectWithValue }) => {
    try {
      const config = {
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const link = `/api/v1/review`;
      const { data } = await axios.put(
        link,
        { rating, comment, productID, reviewTitle, pros, cons },
        config
      );
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Unable to create review. Please try again');
    }
  }
);

// ============================================
// SLICE DEFINITION
// ============================================
const productSlice = createSlice({
  name: 'product',
  initialState: {
    products: [],
    productCount: 0,
    loading: false,
    error: null,
    product: null,
    resultsPerPage: 0,
    totalPages: 0,
    reviewSuccess: false,
    reviewLoading: false,
    // SEO-related states
    redirectInfo: null, // For handling 301 redirects
  },
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    removeSuccess: (state) => {
      state.reviewSuccess = false;
    },
    clearRedirectInfo: (state) => {
      state.redirectInfo = null;
    },
    clearProduct: (state) => {
      state.product = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // ---- Get All Products ----
      .addCase(getProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getProduct.fulfilled, (state, action) => {
        state.loading = false;
        state.error = null;
        state.products = action.payload.products;
        state.productCount = action.payload.productsCount;
        state.resultsPerPage = action.payload.resultPerPage;
        state.totalPages = action.payload.totalPages;
      })
      .addCase(getProduct.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Something went wrong';
        state.products = [];
      })

      // ---- Get Product Details by ID ----
      .addCase(getProductDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getProductDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.error = null;
        state.product = action.payload.product;
      })
      .addCase(getProductDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Something went wrong';
      })

      // ---- Get Product by Slug (SEO) ----
      .addCase(getProductBySlug.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.redirectInfo = null;
      })
      .addCase(getProductBySlug.fulfilled, (state, action) => {
        state.loading = false;
        state.error = null;
        state.product = action.payload.product;
        state.redirectInfo = null;
      })
      .addCase(getProductBySlug.rejected, (state, action) => {
        state.loading = false;
        
        // Handle 301 redirect
        if (action.payload?.redirect) {
          state.redirectInfo = {
            newSlug: action.payload.newSlug,
            newUrl: action.payload.newUrl,
            message: action.payload.message
          };
          state.error = null; // Don't treat redirect as error
        } else {
          state.error = action.payload || 'Product not found';
          state.redirectInfo = null;
        }
      })

      // ---- Create Review ----
      .addCase(createReviews.pending, (state) => {
        state.reviewLoading = true;
        state.error = null;
      })
      .addCase(createReviews.fulfilled, (state) => {
        state.reviewLoading = false;
        state.reviewSuccess = true;
      })
      .addCase(createReviews.rejected, (state, action) => {
        state.reviewLoading = false;
        state.error = action.payload || 'Unable to create review. Please try again';
      });
  }
});

export const { removeErrors, removeSuccess, clearRedirectInfo, clearProduct } = productSlice.actions;
export default productSlice.reducer;