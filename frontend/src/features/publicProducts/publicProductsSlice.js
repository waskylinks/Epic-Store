import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

/* ================= TRENDING PRODUCTS ================= */
export const fetchTrendingProducts = createAsyncThunk(
    'publicProducts/fetchTrending',
    async ({ limit = 12, page = 1, timeframe = 'month', category, inStockOnly = true } = {}, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({
                limit: limit.toString(),
                page: page.toString(),
                timeframe,
                inStockOnly: inStockOnly.toString()
            });
            
            if (category) params.append('category', category);
            
            const { data } = await axios.get(`/api/v1/products/trending?${params}`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch trending products');
        }
    }
);

/* ================= NEW ARRIVALS ================= */
export const fetchNewArrivals = createAsyncThunk(
    'publicProducts/fetchNewArrivals',
    async ({ limit = 12, page = 1, category, inStockOnly = true, daysBack = 30 } = {}, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({
                limit: limit.toString(),
                page: page.toString(),
                inStockOnly: inStockOnly.toString(),
                daysBack: daysBack.toString()
            });
            
            if (category) params.append('category', category);
            
            const { data } = await axios.get(`/api/v1/products/new-arrivals?${params}`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch new arrivals');
        }
    }
);

/* ================= FEATURED PRODUCTS ================= */
export const fetchFeaturedProducts = createAsyncThunk(
    'publicProducts/fetchFeatured',
    async ({ limit = 12, page = 1 } = {}, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({
                limit: limit.toString(),
                page: page.toString()
            });
            
            const { data } = await axios.get(`/api/v1/products/featured?${params}`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch featured products');
        }
    }
);

/* ================= BESTSELLERS ================= */
export const fetchBestsellers = createAsyncThunk(
    'publicProducts/fetchBestsellers',
    async ({ limit = 12, page = 1 } = {}, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams({
                limit: limit.toString(),
                page: page.toString()
            });
            
            const { data } = await axios.get(`/api/v1/products/bestsellers?${params}`);
            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || 'Failed to fetch bestsellers');
        }
    }
);

/* ================= SLICE ================= */
const publicProductsSlice = createSlice({
    name: 'publicProducts',
    initialState: {
        // Trending Products
        trendingProducts: [],
        trendingPagination: null,
        trendingLoading: false,
        trendingError: null,
        
        // New Arrivals
        newArrivals: [],
        newArrivalsPagination: null,
        newArrivalsLoading: false,
        newArrivalsError: null,
        
        // Featured Products
        featuredProducts: [],
        featuredPagination: null,
        featuredLoading: false,
        featuredError: null,
        
        // Bestsellers
        bestsellers: [],
        bestsellersPagination: null,
        bestsellersLoading: false,
        bestsellersError: null,
    },
    reducers: {
        clearTrendingError: (state) => {
            state.trendingError = null;
        },
        clearNewArrivalsError: (state) => {
            state.newArrivalsError = null;
        },
        clearFeaturedError: (state) => {
            state.featuredError = null;
        },
        clearBestsellersError: (state) => {
            state.bestsellersError = null;
        },
        clearAllErrors: (state) => {
            state.trendingError = null;
            state.newArrivalsError = null;
            state.featuredError = null;
            state.bestsellersError = null;
        }
    },
    extraReducers: (builder) => {
        builder
            // ================= TRENDING PRODUCTS =================
            .addCase(fetchTrendingProducts.pending, (state) => {
                state.trendingLoading = true;
                state.trendingError = null;
            })
            .addCase(fetchTrendingProducts.fulfilled, (state, action) => {
                state.trendingLoading = false;
                state.trendingProducts = action.payload.products || [];
                state.trendingPagination = action.payload.pagination || null;
            })
            .addCase(fetchTrendingProducts.rejected, (state, action) => {
                state.trendingLoading = false;
                state.trendingError = action.payload || 'Failed to fetch trending products';
                state.trendingProducts = [];
            })
            
            // ================= NEW ARRIVALS =================
            .addCase(fetchNewArrivals.pending, (state) => {
                state.newArrivalsLoading = true;
                state.newArrivalsError = null;
            })
            .addCase(fetchNewArrivals.fulfilled, (state, action) => {
                state.newArrivalsLoading = false;
                state.newArrivals = action.payload.products || [];
                state.newArrivalsPagination = action.payload.pagination || null;
            })
            .addCase(fetchNewArrivals.rejected, (state, action) => {
                state.newArrivalsLoading = false;
                state.newArrivalsError = action.payload || 'Failed to fetch new arrivals';
                state.newArrivals = [];
            })
            
            // ================= FEATURED PRODUCTS =================
            .addCase(fetchFeaturedProducts.pending, (state) => {
                state.featuredLoading = true;
                state.featuredError = null;
            })
            .addCase(fetchFeaturedProducts.fulfilled, (state, action) => {
                state.featuredLoading = false;
                state.featuredProducts = action.payload.products || [];
                state.featuredPagination = action.payload.pagination || null;
            })
            .addCase(fetchFeaturedProducts.rejected, (state, action) => {
                state.featuredLoading = false;
                state.featuredError = action.payload || 'Failed to fetch featured products';
                state.featuredProducts = [];
            })
            
            // ================= BESTSELLERS =================
            .addCase(fetchBestsellers.pending, (state) => {
                state.bestsellersLoading = true;
                state.bestsellersError = null;
            })
            .addCase(fetchBestsellers.fulfilled, (state, action) => {
                state.bestsellersLoading = false;
                state.bestsellers = action.payload.products || [];
                state.bestsellersPagination = action.payload.pagination || null;
            })
            .addCase(fetchBestsellers.rejected, (state, action) => {
                state.bestsellersLoading = false;
                state.bestsellersError = action.payload || 'Failed to fetch bestsellers';
                state.bestsellers = [];
            });
    }
});

export const { 
    clearTrendingError, 
    clearNewArrivalsError, 
    clearFeaturedError, 
    clearBestsellersError,
    clearAllErrors 
} = publicProductsSlice.actions;

export default publicProductsSlice.reducer;