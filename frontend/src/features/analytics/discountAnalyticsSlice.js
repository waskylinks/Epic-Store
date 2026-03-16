// discountAnalyticsSlice.js
// Standalone slice for all discount analytics state.
// Keeps analyticsSlice.js from growing further — discount analytics
// is a self-contained domain with its own endpoints, loading states,
// and pagination cursors.

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1/discount-analytics";

// ============================================
// ABORT HELPER
// Mirrors the pattern in analyticsSlice.js
// ============================================
const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

// ============================================
// THUNKS
// ============================================

// Store-wide KPI panel — overall totals, by category, by type,
// top performers, underperforming codes
export const fetchDiscountAnalyticsOverview = createAsyncThunk(
    "discountAnalytics/fetchOverview",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/overview`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch discount analytics overview"
            );
        }
    }
);

// ROI aggregated per discount category (promo / return / loyalty / etc.)
export const fetchDiscountROIByCategory = createAsyncThunk(
    "discountAnalytics/fetchROIByCategory",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/roi-by-category`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch ROI by category"
            );
        }
    }
);

// ROI aggregated per discount type (percentage vs fixed)
export const fetchDiscountROIByType = createAsyncThunk(
    "discountAnalytics/fetchROIByType",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/roi-by-type`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch ROI by type"
            );
        }
    }
);

// Top-performing codes leaderboard
// params: { limit, category, sortBy: "roi" | "revenue" | "redemptions" }
export const fetchDiscountTopPerformers = createAsyncThunk(
    "discountAnalytics/fetchTopPerformers",
    async ({ limit = 10, category, sortBy = "roi" } = {}, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams({ limit: limit.toString(), sortBy });
            if (category) params.append("category", category);
            const { data } = await axios.get(
                `${API_BASE}/top-performers?${params.toString()}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch top performers"
            );
        }
    }
);

// Store-wide daily redemption trend chart
// params: { timeframe, category, type }
export const fetchDiscountRedemptionTrends = createAsyncThunk(
    "discountAnalytics/fetchRedemptionTrends",
    async ({ timeframe = "month", category, type } = {}, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams({ timeframe });
            if (category) params.append("category", category);
            if (type)     params.append("type", type);
            const { data } = await axios.get(
                `${API_BASE}/trends?${params.toString()}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch redemption trends"
            );
        }
    }
);

// Paginated list of all DiscountAnalytics documents
// params: { limit, cursor, category, type, audience, sortBy, minRedemptions }
export const fetchAllDiscountAnalytics = createAsyncThunk(
    "discountAnalytics/fetchAll",
    async (
        { limit = 20, cursor, category, type, audience, sortBy = "revenue", minRedemptions } = {},
        { rejectWithValue, signal }
    ) => {
        try {
            const params = new URLSearchParams({ limit: limit.toString(), sortBy });
            if (cursor)        params.append("cursor", cursor);
            if (category)      params.append("category", category);
            if (type)          params.append("type", type);
            if (audience)      params.append("audience", audience);
            if (minRedemptions !== undefined)
                params.append("minRedemptions", minRedemptions.toString());
            const { data } = await axios.get(`${API_BASE}?${params.toString()}`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch discount analytics list"
            );
        }
    }
);

// Full analytics detail for one discount code (detail drawer)
export const fetchDiscountAnalyticsDetail = createAsyncThunk(
    "discountAnalytics/fetchDetail",
    async (discountId, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(`${API_BASE}/${discountId}`, { signal });
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch discount analytics detail"
            );
        }
    }
);

// RFM segment + value tier breakdown for one code
export const fetchDiscountSegmentBreakdown = createAsyncThunk(
    "discountAnalytics/fetchSegmentBreakdown",
    async (discountId, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/${discountId}/segments`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch segment breakdown"
            );
        }
    }
);

// Per-code daily redemption trend
// params: { discountId, timeframe }
export const fetchDiscountCodeTrend = createAsyncThunk(
    "discountAnalytics/fetchCodeTrend",
    async ({ discountId, timeframe = "month" }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/${discountId}/trend?timeframe=${timeframe}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch code trend"
            );
        }
    }
);

// Stale sync report — list of docs needing re-sync
export const fetchStaleSyncReport = createAsyncThunk(
    "discountAnalytics/fetchStaleReport",
    async (thresholdHours = 24, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/stale?thresholdHours=${thresholdHours}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch stale sync report"
            );
        }
    }
);

// Manual re-sync for one discount code
export const syncSingleDiscountAnalytics = createAsyncThunk(
    "discountAnalytics/syncSingle",
    async (discountId, { rejectWithValue }) => {
        try {
            const { data } = await axios.post(
                `${API_BASE}/${discountId}/sync`,
                {},
                { withCredentials: true }
            );
            return { discountId, ...data };
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || "Failed to sync discount analytics"
            );
        }
    }
);

// Bulk sync — fire-and-forget, server returns 202 immediately
export const syncAllDiscountAnalytics = createAsyncThunk(
    "discountAnalytics/syncAll",
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axios.post(
                `${API_BASE}/sync-all`,
                {},
                { withCredentials: true }
            );
            return data;
        } catch (error) {
            return rejectWithValue(
                error.response?.data?.message || "Failed to initiate bulk sync"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

// Strips the `success` boolean that every API response includes so it
// doesn't pollute state. Accepts optional extra keys to strip (e.g. "_timeframe").
const stripSuccess = (payload, ...extraKeys) => {
    // eslint-disable-next-line no-unused-vars
    const { success, ...rest } = payload;
    extraKeys.forEach((k) => delete rest[k]);
    return rest;
};

const discountAnalyticsSlice = createSlice({
    name: "discountAnalytics",
    initialState: {
        // Overview KPI panel
        overview:        null,
        overviewLoading: false,

        // ROI breakdowns
        roiByCategory: null,
        roiByType:     null,

        // Top performers leaderboard
        topPerformers:        null,
        topPerformersLoading: false,

        // Store-wide trend chart
        redemptionTrends:        null,
        redemptionTrendsLoading: false,
        // Tracks which timeframe the current trends data belongs to
        // so stale out-of-order responses can be rejected
        activeTrendsTimeframe: "month",

        // Paginated list
        allAnalytics: [],
        listPagination: {
            hasNextPage: false,
            nextCursor:  null,
            limit:       20,
        },
        listLoading: false,

        // Single code detail (detail drawer)
        selectedDetail:          null,
        selectedSegmentBreakdown: null,
        selectedCodeTrend:        null,
        detailLoading:            false,

        // Stale sync report
        staleSyncReport: null,

        // Sync states — keyed by discountId for per-row loading indicators
        syncLoading: {},   // { [discountId]: true/false }
        syncError:   {},   // { [discountId]: message }
        bulkSyncLoading: false,
        bulkSyncMessage: null,

        // Shared UI state
        loading: false,
        error:   null,
        success: false,
        message: null,
    },
    reducers: {
        clearDiscountAnalyticsError: (state) => {
            state.error = null;
        },
        clearDiscountAnalyticsSuccess: (state) => {
            state.success = false;
            state.message = null;
        },
        clearSelectedDetail: (state) => {
            state.selectedDetail           = null;
            state.selectedSegmentBreakdown = null;
            state.selectedCodeTrend        = null;
        },
        // Call before dispatching fetchDiscountRedemptionTrends
        // so the fulfilled case can reject stale timeframe responses
        setActiveTrendsTimeframe: (state, action) => {
            state.activeTrendsTimeframe = action.payload;
        },
    },
    extraReducers: (builder) => {

        // ── Overview ────────────────────────────────────────────────────────
        builder
            .addCase(fetchDiscountAnalyticsOverview.pending, (state) => {
                state.overviewLoading = true;
                state.error           = null;
            })
            .addCase(fetchDiscountAnalyticsOverview.fulfilled, (state, action) => {
                state.overviewLoading = false;
                state.overview = stripSuccess(action.payload);
            })
            .addCase(fetchDiscountAnalyticsOverview.rejected, (state, action) => {
                state.overviewLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── ROI by category ─────────────────────────────────────────────────
        builder
            .addCase(fetchDiscountROIByCategory.fulfilled, (state, action) => {
                state.roiByCategory = stripSuccess(action.payload);
            })
            .addCase(fetchDiscountROIByCategory.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── ROI by type ──────────────────────────────────────────────────────
        builder
            .addCase(fetchDiscountROIByType.fulfilled, (state, action) => {
                state.roiByType = stripSuccess(action.payload);
            })
            .addCase(fetchDiscountROIByType.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── Top performers ───────────────────────────────────────────────────
        builder
            .addCase(fetchDiscountTopPerformers.pending, (state) => {
                state.topPerformersLoading = true;
            })
            .addCase(fetchDiscountTopPerformers.fulfilled, (state, action) => {
                state.topPerformersLoading = false;
                state.topPerformers = stripSuccess(action.payload);
            })
            .addCase(fetchDiscountTopPerformers.rejected, (state, action) => {
                state.topPerformersLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── Redemption trends ────────────────────────────────────────────────
        builder
            .addCase(fetchDiscountRedemptionTrends.pending, (state) => {
                state.redemptionTrendsLoading = true;
            })
            .addCase(fetchDiscountRedemptionTrends.fulfilled, (state, action) => {
                state.redemptionTrendsLoading = false;
                // Reject stale responses from previous timeframe switches —
                // same pattern as analyticsSlice.js dashboard thunks
                if (action.payload._timeframe !== state.activeTrendsTimeframe) return;
                state.redemptionTrends = stripSuccess(action.payload, "_timeframe");
            })
            .addCase(fetchDiscountRedemptionTrends.rejected, (state, action) => {
                state.redemptionTrendsLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── Paginated list ───────────────────────────────────────────────────
        builder
            .addCase(fetchAllDiscountAnalytics.pending, (state) => {
                state.listLoading = true;
                state.error       = null;
            })
            .addCase(fetchAllDiscountAnalytics.fulfilled, (state, action) => {
                state.listLoading = false;
                const { analytics = [], pagination } = action.payload;

                const isCursorPage = Boolean(action.meta.arg?.cursor);
                state.allAnalytics = isCursorPage
                ? [...state.allAnalytics, ...analytics]
                : analytics;

                state.listPagination = {
                hasNextPage: pagination?.hasNextPage ?? false,
                nextCursor:  pagination?.nextCursor  ?? null,
                limit:       pagination?.limit       ?? 20,
                };
            })
            .addCase(fetchAllDiscountAnalytics.rejected, (state, action) => {
                state.listLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── Single code detail ───────────────────────────────────────────────
        builder
            .addCase(fetchDiscountAnalyticsDetail.pending, (state) => {
                state.detailLoading = true;
                state.error         = null;
            })
            .addCase(fetchDiscountAnalyticsDetail.fulfilled, (state, action) => {
                state.detailLoading = false;
                state.selectedDetail = action.payload.analytics ?? action.payload;
            })
            .addCase(fetchDiscountAnalyticsDetail.rejected, (state, action) => {
                state.detailLoading = false;
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchDiscountSegmentBreakdown.fulfilled, (state, action) => {
                state.selectedSegmentBreakdown = stripSuccess(action.payload);
            })
            .addCase(fetchDiscountSegmentBreakdown.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchDiscountCodeTrend.fulfilled, (state, action) => {
                state.selectedCodeTrend = stripSuccess(action.payload);
            })
            .addCase(fetchDiscountCodeTrend.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── Stale sync report ────────────────────────────────────────────────
        builder
            .addCase(fetchStaleSyncReport.fulfilled, (state, action) => {
                state.staleSyncReport = stripSuccess(action.payload);
            })
            .addCase(fetchStaleSyncReport.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── Single sync ──────────────────────────────────────────────────────
        builder
            .addCase(syncSingleDiscountAnalytics.pending, (state, action) => {
                const id = action.meta.arg;
                state.syncLoading = { ...state.syncLoading, [id]: true };
                const { [id]: _removed, ...rest } = state.syncError;
                state.syncError = rest;
            })
            .addCase(syncSingleDiscountAnalytics.fulfilled, (state, action) => {
                const id = action.meta.arg;
                const { [id]: _removed, ...restLoading } = state.syncLoading;
                state.syncLoading = restLoading;
                state.success = true;
                state.message = "Discount analytics synced successfully";

                if (action.payload.analytics) {
                const updated = action.payload.analytics;
                const idx = state.allAnalytics.findIndex(
                    (a) =>
                    a._id === updated._id ||
                    a._id === id ||
                    a.discountId === id
                );
                if (idx !== -1) state.allAnalytics[idx] = updated;
                }
            })
            .addCase(syncSingleDiscountAnalytics.rejected, (state, action) => {
                const id = action.meta.arg;
                const { [id]: _removed, ...restLoading } = state.syncLoading;
                state.syncLoading = restLoading;
                state.syncError   = { ...state.syncError, [id]: action.payload };
                state.error       = action.payload;
            });

        // ── Bulk sync ────────────────────────────────────────────────────────
        builder
            .addCase(syncAllDiscountAnalytics.pending, (state) => {
                state.bulkSyncLoading = true;
                state.bulkSyncMessage = null;
                state.error           = null;
            })
            .addCase(syncAllDiscountAnalytics.fulfilled, (state, action) => {
                state.bulkSyncLoading = false;
                state.bulkSyncMessage = action.payload?.message ?? "Bulk sync initiated";
                state.success         = true;
                state.message         = state.bulkSyncMessage;
            })
            .addCase(syncAllDiscountAnalytics.rejected, (state, action) => {
                state.bulkSyncLoading = false;
                state.error           = action.payload;
            });
    },
});

export const {
    clearDiscountAnalyticsError,
    clearDiscountAnalyticsSuccess,
    clearSelectedDetail,
    setActiveTrendsTimeframe,
} = discountAnalyticsSlice.actions;

export default discountAnalyticsSlice.reducer;