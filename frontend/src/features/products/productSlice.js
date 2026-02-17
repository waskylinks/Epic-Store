import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

export const getProduct = createAsyncThunk(
  'product/getProduct',
  async ({ keyword, page = 1, category }, { rejectWithValue }) => {
    try {
      let link = `/api/v1/products?page=${page}`;
      if (category) link += `&category=${encodeURIComponent(category)}`;
      if (keyword)  link += `&keyword=${encodeURIComponent(keyword)}`;
      const { data } = await axios.get(link);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'An error occurred');
    }
  }
);

export const getProductDetails = createAsyncThunk(
  'product/getProductDetails',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/product/${id}`);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'An error occurred');
    }
  }
);

export const getProductBySlug = createAsyncThunk(
  'product/getProductBySlug',
  async (slug, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/products/${slug}`, {
        maxRedirects: 0,
      });
      return data;
    } catch (error) {
      if (error.response?.status === 301) {
        return rejectWithValue({
          redirect: true,
          newSlug: error.response.data?.newSlug,
          newUrl:  error.response.data?.newUrl,
          message: error.response.data?.message,
        });
      }
      return rejectWithValue(error.response?.data || 'Product not found');
    }
  }
);

export const createReviews = createAsyncThunk(
  'product/createReviews',
  async ({ rating, comment, productID, reviewTitle, pros, cons }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        '/api/v1/review',
        { rating, comment, productID, reviewTitle, pros, cons },
        { headers: { 'Content-Type': 'application/json' } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Unable to create review. Please try again');
    }
  }
);

const productSlice = createSlice({
  name: 'product',
  initialState: {
    products: [],
    productCount: 0,
    loading: false,
    error: null,
    product: null,
    seo: null,
    resultsPerPage: 0,
    totalPages: 0,
    currentPage: 1,
    reviewSuccess: false,
    reviewLoading: false,
    redirectInfo: null,
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
      state.seo = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getProduct.fulfilled, (state, action) => {
        state.loading      = false;
        state.error        = null;
        state.products     = action.payload.products;
        state.productCount = action.payload.productsCount;
        state.resultsPerPage = action.payload.resultPerPage;
        state.totalPages   = action.payload.totalPages;
        state.currentPage  = action.payload.currentPage;
      })
      .addCase(getProduct.rejected, (state, action) => {
        state.loading  = false;
        state.error    = action.payload || 'Something went wrong';
        state.products = [];
      })

      .addCase(getProductDetails.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getProductDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.error   = null;
        state.product = action.payload.product;
      })
      .addCase(getProductDetails.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload || 'Something went wrong';
      })

      .addCase(getProductBySlug.pending, (state) => {
        state.loading      = true;
        state.error        = null;
        state.redirectInfo = null;
        state.seo          = null;
      })
      .addCase(getProductBySlug.fulfilled, (state, action) => {
        state.loading      = false;
        state.error        = null;
        state.product      = action.payload.product;
        state.seo          = action.payload.seo ?? null;
        state.redirectInfo = null;
      })
      .addCase(getProductBySlug.rejected, (state, action) => {
        state.loading = false;
        if (action.payload?.redirect) {
          state.redirectInfo = {
            newSlug: action.payload.newSlug,
            newUrl:  action.payload.newUrl,
            message: action.payload.message,
          };
          state.error = null;
        } else {
          state.error        = action.payload || 'Product not found';
          state.redirectInfo = null;
        }
      })

      .addCase(createReviews.pending, (state) => {
        state.reviewLoading = true;
        state.error         = null;
      })
      .addCase(createReviews.fulfilled, (state) => {
        state.reviewLoading = false;
        state.reviewSuccess = true;
      })
      .addCase(createReviews.rejected, (state, action) => {
        state.reviewLoading = false;
        state.error = action.payload || 'Unable to create review. Please try again';
      });
  },
});

export const {
  removeErrors,
  removeSuccess,
  clearRedirectInfo,
  clearProduct,
} = productSlice.actions;

export default productSlice.reducer;