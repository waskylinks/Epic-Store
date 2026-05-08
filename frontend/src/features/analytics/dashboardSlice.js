// dashboardSlice.js
// Main admin dashboard: KPI cards, overview, revenue trends, top performers, alerts.
// All timeframe-dependent thunks embed _timeframe in their payload and the
// fulfilled cases check it against state.activeTimeframe to discard stale
// out-of-order responses from previous timeframe switches.

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

// Validates that a KPI payload has the expected shape before writing to state.
// Prevents setting kpis to undefined/error objects when API shape varies.
const isValidKpiPayload = (kpis) =>
    kpis !== null &&
    kpis !== undefined &&
    typeof kpis === "object" &&
    !Array.isArray(kpis) &&
    ("revenue" in kpis || "orders" in kpis || "customers" in kpis);

// ============================================
// THUNKS
// ============================================

export const fetchDashboardOverview = createAsyncThunk(
    "dashboard/fetchDashboardOverview",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch dashboard overview"
            );
        }
    }
);

export const fetchDashboardKPIs = createAsyncThunk(
    "dashboard/fetchDashboardKPIs",
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/kpis?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch KPIs"
            );
        }
    }
);

export const fetchRevenueTrends = createAsyncThunk(
    "dashboard/fetchRevenueTrends",
    async ({ timeframe = "month", groupBy = "day" }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/revenue-trends?timeframe=${timeframe}&groupBy=${groupBy}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch revenue trends"
            );
        }
    }
);

export const fetchTopPerformers = createAsyncThunk(
    "dashboard/fetchTopPerformers",
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/top-performers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch top performers"
            );
        }
    }
);

export const fetchDashboardAlerts = createAsyncThunk(
    "dashboard/fetchDashboardAlerts",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/dashboard/alerts`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch alerts"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const dashboardSlice = createSlice({
    name: "dashboard",
    initialState: {
        // activeTimeframe tracks the currently selected timeframe so fulfilled
        // cases can reject stale out-of-order responses
        activeTimeframe:   "month",
        dashboardOverview: null,
        kpis:              null,
        kpisLoading:       false, // dedicated flag — never clears kpis to null
        revenueTrends:     null,
        topPerformers:     null,
        alerts:            [],
        dashboardLoading:  false,
        error:             null,
    },
    reducers: {
        // Call before dispatching timeframe thunks so fulfilled cases
        // can compare against the correct active timeframe
        setActiveTimeframe: (state, action) => {
            state.activeTimeframe = action.payload;
        },
        setDashboardLoading: (state, action) => {
            state.dashboardLoading = action.payload;
        },
        clearDashboardError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        // ── fetchDashboardOverview ───────────────────────────────────────────
        builder
            .addCase(fetchDashboardOverview.pending, (state) => {
                state.dashboardLoading = true;
                state.error            = null;
            })
            .addCase(fetchDashboardOverview.fulfilled, (state, action) => {
                state.dashboardLoading = false;
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.dashboardOverview = data;
                }
            })
            .addCase(fetchDashboardOverview.rejected, (state, action) => {
                state.dashboardLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── fetchDashboardKPIs ───────────────────────────────────────────────
        // pending → kpisLoading: true (never nulls out kpis — preserves existing data
        // so the UI shows stale-but-valid data while refreshing)
        // fulfilled → validates payload shape before writing, checks activeTimeframe
        // rejected → kpisLoading: false, no error banner for aborts
        builder
            .addCase(fetchDashboardKPIs.pending, (state) => {
                state.kpisLoading = true;
            })
            .addCase(fetchDashboardKPIs.fulfilled, (state, action) => {
                state.kpisLoading = false;
                if (action.payload._timeframe !== state.activeTimeframe) return;
                // Support both { kpis: {...} } and flat { revenue: {...}, ... } API shapes
                const kpisData = action.payload.kpis ?? action.payload;
                // eslint-disable-next-line no-unused-vars
                const { _timeframe, success, ...rest } = kpisData;
                if (isValidKpiPayload(rest)) {
                    state.kpis = rest;
                }
            })
            .addCase(fetchDashboardKPIs.rejected, (state, action) => {
                state.kpisLoading = false;
                // No error banner for aborts — these are intentional from timeframe switches
                if (!action.payload?.aborted) {
                    state.error =
                        typeof action.payload === "string"
                            ? action.payload
                            : action.payload?.message || "Failed to fetch KPIs";
                }
            });

        // ── fetchRevenueTrends ───────────────────────────────────────────────
        builder
            .addCase(fetchRevenueTrends.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.revenueTrends = data;
                }
            })
            .addCase(fetchRevenueTrends.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── fetchTopPerformers ───────────────────────────────────────────────
        builder
            .addCase(fetchTopPerformers.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.topPerformers = data;
                }
            })
            .addCase(fetchTopPerformers.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── fetchDashboardAlerts ─────────────────────────────────────────────
        builder
            .addCase(fetchDashboardAlerts.fulfilled, (state, action) => {
                state.alerts = action.payload.alerts || [];
            })
            .addCase(fetchDashboardAlerts.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });
    },
});

export const {
    setActiveTimeframe,
    setDashboardLoading,
    clearDashboardError,
} = dashboardSlice.actions;

export default dashboardSlice.reducer;