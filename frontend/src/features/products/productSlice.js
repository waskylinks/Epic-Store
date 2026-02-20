import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// ============================================
// THUNKS
// ============================================

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

// ── Reviews ──────────────────────────────────────────────────────────────────
// Matches PUT /api/v1/review → createProductReview controller.
// Backend returns { success, product } and infers create vs update
// via reviewExists check — we derive reviewAction from numOfReviews delta.

export const createReviews = createAsyncThunk(
  'product/createReviews',
  async ({ rating, comment, productID, reviewTitle, pros, cons }, { getState, rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        '/api/v1/review',
        { rating, comment, productID, reviewTitle, pros, cons },
        { headers: { 'Content-Type': 'application/json' } }
      );
      // Capture current numOfReviews before the update to determine create vs update
      const prevCount = getState().product.product?.numOfReviews ?? 0;
      return { ...data, prevCount };
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Unable to create review. Please try again');
    }
  }
);

// Matches GET /api/v1/reviews?id= → getProductReviews controller
export const getProductReviews = createAsyncThunk(
  'product/getProductReviews',
  async (productId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/reviews?id=${productId}`);
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Unable to fetch reviews');
    }
  }
);

// Matches DELETE /api/v1/reviews?id=&productID= → deleteReview controller
export const deleteProductReview = createAsyncThunk(
  'product/deleteProductReview',
  async ({ reviewId, productId }, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(
        `/api/v1/reviews?id=${reviewId}&productID=${productId}`
      );
      return data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Unable to delete review');
    }
  }
);

// ── Analytics ─────────────────────────────────────────────────────────────────
// Maps to incrementView instance method on the model.
// Fire-and-forget — failures are silently swallowed so they never
// block the product detail page from rendering.

export const trackProductView = createAsyncThunk(
  'product/trackView',
  async (id, { rejectWithValue }) => {
    try {
      await axios.post(`/api/v1/product/${id}/view`);
    } catch (error) {
      return rejectWithValue(error.response?.data);
    }
  }
);

// Maps to incrementWishlist instance method on the model.
// Called from wishlistSlice after add/remove so analytics stay in sync.
export const trackWishlistAnalytics = createAsyncThunk(
  'product/trackWishlist',
  async ({ id, increment }, { rejectWithValue }) => {
    try {
      await axios.post(`/api/v1/product/${id}/wishlist`, { increment });
    } catch (error) {
      return rejectWithValue(error.response?.data);
    }
  }
);

// ============================================
// SLICE
// ============================================

const productSlice = createSlice({
  name: 'product',
  initialState: {
    // Product list (getProduct)
    products: [],
    productCount: 0,
    loading: false,
    error: null,
    // resultPerPage matches the backend key name exactly (resultPerPage, not resultsPerPage)
    resultPerPage: 0,
    totalPages: 0,
    currentPage: 1,

    // Single product (getProductDetails / getProductBySlug)
    product: null,

    // SEO — split to match the three objects the backend returns:
    // { metaTags, structuredData, breadcrumbs }
    // Source: getProductBySlug controller → seoService
    seoMetaTags: null,
    structuredData: null,
    breadcrumbs: [],

    // Populated relationships — returned by withProductPopulate in getProductBySlug
    // populated with: name, pricing, images, slug, ratings (relatedProducts)
    // and: name, pricing, images, slug (crossSells / upsells)
    relatedProducts: [],
    crossSells: [],
    upsells: [],

    // 301 redirect info from slugHistory
    redirectInfo: null,

    // Reviews
    reviews: [],
    reviewsLoading: false,
    reviewSuccess: false,
    reviewLoading: false,
    // 'created' | 'updated' | null — derived from numOfReviews delta
    reviewAction: null,
  },

  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    removeSuccess: (state) => {
      state.reviewSuccess = false;
      state.reviewAction  = null;
    },
    clearRedirectInfo: (state) => {
      state.redirectInfo = null;
    },
    clearProduct: (state) => {
      state.product        = null;
      state.seoMetaTags    = null;
      state.structuredData = null;
      state.breadcrumbs    = [];
      state.relatedProducts = [];
      state.crossSells     = [];
      state.upsells        = [];
    },
    // Clears the product list between route/filter changes to prevent
    // stale data rendering before the next fetch resolves
    clearProducts: (state) => {
      state.products      = [];
      state.productCount  = 0;
      state.totalPages    = 0;
      state.currentPage   = 1;
    },
  },

  extraReducers: (builder) => {
    builder

      // ── getProduct ──────────────────────────────────────────────────────────
      .addCase(getProduct.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getProduct.fulfilled, (state, action) => {
        state.loading       = false;
        state.error         = null;
        state.products      = action.payload.products;
        state.productCount  = action.payload.productsCount;
        // Use resultPerPage to match the exact key the backend returns
        state.resultPerPage = action.payload.resultPerPage;
        state.totalPages    = action.payload.totalPages;
        state.currentPage   = action.payload.currentPage;
      })
      .addCase(getProduct.rejected, (state, action) => {
        state.loading   = false;
        state.error     = action.payload || 'Something went wrong';
        state.products  = [];
      })

      // ── getProductDetails ───────────────────────────────────────────────────
      // Admin-facing route — does not return SEO or populated relationships
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

      // ── getProductBySlug ────────────────────────────────────────────────────
      // Public SEO route — returns product + seo { metaTags, structuredData, breadcrumbs }
      // product is populated via withProductPopulate:
      //   relatedProducts → name, pricing, images, slug, ratings
      //   crossSells / upsells → name, pricing, images, slug
      .addCase(getProductBySlug.pending, (state) => {
        state.loading        = true;
        state.error          = null;
        state.redirectInfo   = null;
        state.seoMetaTags    = null;
        state.structuredData = null;
        state.breadcrumbs    = [];
      })
      .addCase(getProductBySlug.fulfilled, (state, action) => {
        const { product, seo } = action.payload;
        state.loading        = false;
        state.error          = null;
        state.product        = product ?? null;
        state.redirectInfo   = null;
        // Split the three SEO objects the backend constructs via seoService
        state.seoMetaTags    = seo?.metaTags    ?? null;
        state.structuredData = seo?.structuredData ?? null;
        state.breadcrumbs    = seo?.breadcrumbs  ?? [];
        // Populated relationships from withProductPopulate
        state.relatedProducts = product?.relatedProducts ?? [];
        state.crossSells      = product?.crossSells      ?? [];
        state.upsells         = product?.upsells         ?? [];
      })
      .addCase(getProductBySlug.rejected, (state, action) => {
        state.loading = false;
        if (action.payload?.redirect) {
          // Slug has changed — slugHistory entry exists on the product doc.
          // Store redirect info so the consuming component can navigate.
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

      // ── createReviews ───────────────────────────────────────────────────────
      // Backend createProductReview increments numOfReviews only for NEW reviews.
      // We compare against prevCount (captured in the thunk) to set reviewAction.
      .addCase(createReviews.pending, (state) => {
        state.reviewLoading = true;
        state.error         = null;
      })
      .addCase(createReviews.fulfilled, (state, action) => {
        const newCount    = action.payload.product?.numOfReviews ?? 0;
        const prevCount   = action.payload.prevCount ?? 0;
        state.reviewLoading = false;
        state.reviewSuccess = true;
        state.reviewAction  = newCount > prevCount ? 'created' : 'updated';
        // Keep product in sync so ratings/numOfReviews update immediately
        if (action.payload.product) {
          state.product = action.payload.product;
        }
      })
      .addCase(createReviews.rejected, (state, action) => {
        state.reviewLoading = false;
        state.error = action.payload || 'Unable to create review. Please try again';
      })

      // ── getProductReviews ───────────────────────────────────────────────────
      .addCase(getProductReviews.pending, (state) => {
        state.reviewsLoading = true;
        state.error          = null;
      })
      .addCase(getProductReviews.fulfilled, (state, action) => {
        state.reviewsLoading = false;
        state.reviews        = action.payload.reviews ?? [];
      })
      .addCase(getProductReviews.rejected, (state, action) => {
        state.reviewsLoading = false;
        state.error          = action.payload || 'Unable to fetch reviews';
      })

      // ── deleteProductReview ─────────────────────────────────────────────────
      .addCase(deleteProductReview.pending, (state) => {
        state.reviewsLoading = true;
        state.error          = null;
      })
      .addCase(deleteProductReview.fulfilled, (state) => {
        state.reviewsLoading = false;
      })
      .addCase(deleteProductReview.rejected, (state, action) => {
        state.reviewsLoading = false;
        state.error          = action.payload || 'Unable to delete review';
      })

      // ── Analytics — fire-and-forget ─────────────────────────────────────────
      // No loading state — failures must never surface to the user.
      // trackProductView → incrementView instance method
      // trackWishlistAnalytics → incrementWishlist instance method
      .addCase(trackProductView.rejected, () => {})
      .addCase(trackWishlistAnalytics.rejected, () => {});
  },
});

export const {
  removeErrors,
  removeSuccess,
  clearRedirectInfo,
  clearProduct,
  clearProducts,
} = productSlice.actions;

export default productSlice.reducer;