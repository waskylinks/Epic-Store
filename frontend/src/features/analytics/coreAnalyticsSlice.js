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

// Now accepts an optional timeframe string.
// - No argument (or undefined): hits the endpoint with no query param →
//   all-time counts, same shape as before { ordersByStatus: {...} }
// - With timeframe ("day" | "week" | "month" | "year"): appends
//   ?timeframe=<value> → richer response with trends, share, previousPeriod.
// The _timeframe key is embedded in the payload so the fulfilled case can
// reject stale out-of-order responses when the user switches timeframes.
export const fetchOrderStatusBreakdown = createAsyncThunk(
    "coreAnalytics/fetchOrderStatusBreakdown",
    async (timeframe, { rejectWithValue, signal }) => {
        try {
            const url = timeframe
                ? `${API_BASE}/admin/order-status-breakdown?timeframe=${timeframe}`
                : `${API_BASE}/admin/order-status-breakdown`;
            const { data } = await axios.get(url, { signal });
            // Embed the requested timeframe (may be undefined for all-time calls)
            return { ...data, _timeframe: timeframe ?? null };
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

        // ── fetchOrderStatusBreakdown ────────────────────────────────────────
        // Handles both the all-time (no timeframe) and timeframe-scoped shapes.
        // ordersByStatus is always written so existing UI code is unaffected.
        // The richer fields (trends, share, previousPeriod) are only written
        // when the response carries a matching _timeframe value.
        builder
            .addCase(fetchOrderStatusBreakdown.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchOrderStatusBreakdown.fulfilled, (state, action) => {
                state.loading = false;

                const {
                    _timeframe,
                    ordersByStatus,
                    previousPeriod,
                    currentTotal,
                    trends,
                    share,
                } = action.payload;

                // ── Stale-response guard ─────────────────────────────────────
                // Only apply the guard when a timeframe was requested. All-time
                // calls (_timeframe === null) are always accepted.
                if (
                    _timeframe !== null &&
                    _timeframe !== undefined &&
                    _timeframe !== state.activeOrderStatusTimeframe
                ) {
                    return;
                }

                // ── Core counts — always present ─────────────────────────────
                state.ordersByStatus = ordersByStatus || {
                    processing: 0,
                    shipped:    0,
                    delivered:  0,
                    cancelled:  0,
                };

                // ── Timeframe-specific extras ────────────────────────────────
                if (_timeframe) {
                    state.ordersByStatusPreviousPeriod  = previousPeriod  ?? null;
                    state.ordersByStatusTrends          = trends          ?? null;
                    state.ordersByStatusShare           = share           ?? null;
                    state.ordersByStatusCurrentTotal    = currentTotal    ?? null;
                } else {
                    // All-time fetch — clear out any stale timeframe data so the
                    // UI doesn't accidentally render trends from a previous call.
                    state.ordersByStatusPreviousPeriod  = null;
                    state.ordersByStatusTrends          = null;
                    state.ordersByStatusShare           = null;
                    state.ordersByStatusCurrentTotal    = null;
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