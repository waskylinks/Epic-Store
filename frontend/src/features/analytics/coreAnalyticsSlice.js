// coreAnalyticsSlice.js
// Basic admin stats, order status breakdown, inventory breakdown, basic analytics.
// These are the lightweight counts shown on the top-level admin dashboard cards.

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

// ============================================
// THUNKS
// ============================================

export const fetchAdminStats = createAsyncThunk(
    "coreAnalytics/fetchAdminStats",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/admin/stats`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch dashboard stats"
            );
        }
    }
);

export const fetchOrderStatusBreakdown = createAsyncThunk(
    "coreAnalytics/fetchOrderStatusBreakdown",
    async (arg, { rejectWithValue, signal }) => {
        try {
            const timeframe = arg?.timeframe ?? arg ?? null;
            const url = timeframe
                ? `${API_BASE}/admin/order-status-breakdown?timeframe=${timeframe}`
                : `${API_BASE}/admin/order-status-breakdown`;
            const { data } = await axios.get(url, { signal });
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch order status breakdown"
            );
        }
    }
);

export const fetchInventoryBreakdown = createAsyncThunk(
    "coreAnalytics/fetchInventoryBreakdown",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/admin/inventory-breakdown`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch inventory breakdown"
            );
        }
    }
);

export const fetchBasicAnalytics = createAsyncThunk(
    "coreAnalytics/fetchBasicAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/admin/analytics?timeframe=${timeframe}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch analytics"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const coreAnalyticsSlice = createSlice({
    name: "coreAnalytics",
    initialState: {
        basicStats: {
            products:   0,
            orders:     0,
            revenue:    0,
            users:      0,
            adminCount: 0,
        },
        basicStatsFetched: false,

        // ordersByStatus always holds the flat { processing, shipped, delivered, cancelled }
        // shape so existing dashboard render code needs no changes.
        ordersByStatus: null,

        // Extra fields populated only when a timeframe was requested.
        // null when the all-time endpoint was used.
        ordersByStatusPreviousPeriod: null,  // { ordersByStatus, total }
        ordersByStatusTrends:         null,  // { processing, shipped, delivered, cancelled }
        ordersByStatusShare:          null,  // { processing, shipped, delivered, cancelled }
        ordersByStatusCurrentTotal:   null,

        // Tracks which timeframe the current breakdown data belongs to so
        // stale out-of-order responses from rapid timeframe switches are rejected.
        activeOrderStatusTimeframe: null,

        inventoryStatus:   null,
        basicAnalytics: {
            trends:               { revenue: 0, orders: 0, users: 0, products: 0 },
            orderStatusBreakdown: {},
            topProducts:          [],
            recentOrders:         [],
            currentPeriod:        {},
            previousPeriod:       {},
        },
        loading: false,
        error:   null,
    },
    reducers: {
        clearCoreAnalyticsError: (state) => {
            state.error = null;
        },
        // Call this before dispatching fetchOrderStatusBreakdown(timeframe) so
        // the fulfilled case can reject stale responses from previous timeframes.
        setActiveOrderStatusTimeframe: (state, action) => {
            state.activeOrderStatusTimeframe = action.payload;
        },
    },
    extraReducers: (builder) => {
        // ── fetchAdminStats ──────────────────────────────────────────────────
        builder
            .addCase(fetchAdminStats.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchAdminStats.fulfilled, (state, action) => {
                state.loading = false;
                const { products, orders, revenue, users, adminCount } = action.payload;
                state.basicStats = {
                    products:   products   || 0,
                    orders:     orders     || 0,
                    revenue:    revenue    || 0,
                    users:      users      || 0,
                    adminCount: adminCount || 0,
                };
                state.basicStatsFetched = true;
            })
            .addCase(fetchAdminStats.rejected, (state, action) => {
                state.loading = false;
                if (!action.payload?.aborted) {
                    state.error =
                        typeof action.payload === "string"
                            ? action.payload
                            : action.payload?.message || "Failed to fetch stats";
                }
            });

        // ── fetchBasicAnalytics ──────────────────────────────────────────────
        builder
            .addCase(fetchBasicAnalytics.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchBasicAnalytics.fulfilled, (state, action) => {
                state.loading        = false;
                state.basicAnalytics = action.payload;
            })
            .addCase(fetchBasicAnalytics.rejected, (state, action) => {
                state.loading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        builder
            .addCase(fetchOrderStatusBreakdown.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            
            .addCase(fetchOrderStatusBreakdown.fulfilled, (state, action) => {
            if (action.payload?.ordersByStatus) {
                state.ordersByStatus = action.payload.ordersByStatus;
            }
            if (action.payload?.trends) {
                state.ordersByStatusTrends = action.payload.trends;
            }
            })

            .addCase(fetchOrderStatusBreakdown.rejected, (state, action) => {
                state.loading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── fetchInventoryBreakdown ──────────────────────────────────────────
        builder
            .addCase(fetchInventoryBreakdown.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchInventoryBreakdown.fulfilled, (state, action) => {
                state.loading         = false;
                state.inventoryStatus = action.payload.inventory || {
                    inStock:      0,
                    lowStock:     0,
                    outOfStock:   0,
                    discontinued: 0,
                    total:        0,
                };
            })
            .addCase(fetchInventoryBreakdown.rejected, (state, action) => {
                state.loading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });
    },
});

export const {
    clearCoreAnalyticsError,
    setActiveOrderStatusTimeframe,
} = coreAnalyticsSlice.actions;

export default coreAnalyticsSlice.reducer;