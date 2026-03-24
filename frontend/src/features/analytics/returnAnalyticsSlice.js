// returnAnalyticsSlice.js
// Covers: return overview, returns by product, returns by category,
// plea analytics, credit analytics, lifecycle timing,
// and refund overview / by-payment-method / timeline.
//
// Refund state was previously managed inside operationsSlice.js and has
// been migrated here so all return-and-refund concerns live in one file.
//
// Patterns mirror operationsSlice exactly:
//   • timeframe guard  (_timeframe === activeTimeframe before writing state)
//   • abort handling   (isAbortError → rejectWithValue({ aborted: true }))
//   • _raw passthrough (full server payload preserved for flexible UI access)

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

// ============================================
// THUNKS — RETURNS
// ============================================

export const fetchReturnOverview = createAsyncThunk(
    "returnAnalytics/fetchReturnOverview",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch return overview"
            );
        }
    }
);

export const fetchReturnsByProduct = createAsyncThunk(
    "returnAnalytics/fetchReturnsByProduct",
    async ({ limit = 20, sortBy = "returnRate" } = {}, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/by-product?limit=${limit}&sortBy=${sortBy}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch returns by product"
            );
        }
    }
);

export const fetchReturnsByCategory = createAsyncThunk(
    "returnAnalytics/fetchReturnsByCategory",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/by-category`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch returns by category"
            );
        }
    }
);

export const fetchReturnPleaAnalytics = createAsyncThunk(
    "returnAnalytics/fetchReturnPleaAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/plea?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch plea analytics"
            );
        }
    }
);

export const fetchReturnCreditAnalytics = createAsyncThunk(
    "returnAnalytics/fetchReturnCreditAnalytics",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/credit?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch credit analytics"
            );
        }
    }
);

export const fetchReturnLifecycleTiming = createAsyncThunk(
    "returnAnalytics/fetchReturnLifecycleTiming",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/returns/lifecycle?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch lifecycle timing"
            );
        }
    }
);

// ============================================
// THUNKS — REFUNDS
// (migrated from operationsSlice)
// ============================================

export const fetchRefundOverview = createAsyncThunk(
    "returnAnalytics/fetchRefundOverview",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/overview?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch refund overview"
            );
        }
    }
);

export const fetchRefundsByPaymentMethod = createAsyncThunk(
    "returnAnalytics/fetchRefundsByPaymentMethod",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/by-payment-method?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message ||
                    "Failed to fetch refunds by payment method"
            );
        }
    }
);

export const fetchRefundTimeline = createAsyncThunk(
    "returnAnalytics/fetchRefundTimeline",
    async ({ timeframe = "month", groupBy = "day" } = {}, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/refunds/timeline?timeframe=${timeframe}&groupBy=${groupBy}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch refund timeline"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const returnAnalyticsSlice = createSlice({
    name: "returnAnalytics",
    initialState: {
        activeTimeframe: "month",

        // Returns
        returnOverview:        null,
        returnsByProduct:      null,
        returnsByCategory:     null,
        returnPleaAnalytics:   null,
        returnCreditAnalytics: null,
        returnLifecycleTiming: null,

        // Refunds
        refundOverview:         null,
        refundsByPaymentMethod: null,
        refundTimeline:         null,

        // Shared UI
        success: false,
        message: null,
        error:   null,
    },
    reducers: {
        setReturnAnalyticsTimeframe: (state, action) => {
            state.activeTimeframe = action.payload;
        },
        clearReturnAnalyticsError: (state) => {
            state.error = null;
        },
        removeReturnAnalyticsSuccess: (state) => {
            state.success = false;
            state.message = null;
        },
    },
    extraReducers: (builder) => {

        // ── RETURNS ───────────────────────────────────────────────────────────

        builder
            // fetchReturnOverview — timeframe-guarded; normalise key fields for
            // dashboard consumption, preserve full payload on _raw.
            .addCase(fetchReturnOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                const cp = data.currentPeriod ?? {};
                state.returnOverview = {
                    totalReturns:      cp.totalReturns      ?? 0,
                    returnRate:        cp.returnRate        ?? 0,
                    approvalRate:      cp.approvalRate      ?? 0,
                    pleaRate:          cp.pleaRate          ?? 0,
                    avgProcessingDays: cp.avgProcessingDays ?? 0,
                    avgReviewDays:     cp.avgReviewDays     ?? 0,
                    byStatus:          cp.byStatus          ?? {},
                    creditMetrics:     cp.creditMetrics     ?? {},
                    pleaMetrics:       cp.pleaMetrics       ?? {},
                    previousPeriod:    data.previousPeriod  ?? {},
                    trend:             data.trend           ?? null,
                    byReason:          data.byReason        ?? [],
                    _raw:              data,
                };
            })
            .addCase(fetchReturnOverview.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            // fetchReturnsByProduct — no timeframe (category-level endpoint);
            // pass through directly.
            .addCase(fetchReturnsByProduct.fulfilled, (state, action) => {
                state.returnsByProduct = action.payload;
            })
            .addCase(fetchReturnsByProduct.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            // fetchReturnsByCategory — no timeframe; pass through directly.
            .addCase(fetchReturnsByCategory.fulfilled, (state, action) => {
                state.returnsByCategory = action.payload;
            })
            .addCase(fetchReturnsByCategory.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            // fetchReturnPleaAnalytics — timeframe-guarded; flatten top-level
            // sections for convenient selector access, keep _raw for deep dives.
            .addCase(fetchReturnPleaAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                state.returnPleaAnalytics = {
                    returnLevel:   data.returnLevel   ?? {},
                    unitLevel:     data.unitLevel     ?? {},
                    creditMetrics: data.creditMetrics ?? {},
                    trends:        data.trends        ?? {},
                    _raw:          data,
                };
            })
            .addCase(fetchReturnPleaAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            // fetchReturnCreditAnalytics — timeframe-guarded.
            .addCase(fetchReturnCreditAnalytics.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                state.returnCreditAnalytics = {
                    creditIssued:   data.creditIssued   ?? {},
                    creditRedeemed: data.creditRedeemed ?? {},
                    roiMetrics:     data.roiMetrics     ?? {},
                    trends:         data.trends         ?? {},
                    _raw:           data,
                };
            })
            .addCase(fetchReturnCreditAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            // fetchReturnLifecycleTiming — timeframe-guarded.
            .addCase(fetchReturnLifecycleTiming.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                state.returnLifecycleTiming = {
                    stageTiming:        data.stageTiming        ?? {},
                    pleaImpactOnTiming: data.pleaImpactOnTiming ?? {},
                    _raw:               data,
                };
            })
            .addCase(fetchReturnLifecycleTiming.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });

        // ── REFUNDS ───────────────────────────────────────────────────────────

        builder
            // fetchRefundOverview — timeframe-guarded; mirrors the field shape
            // from operationsSlice so existing selectors keep working.
            .addCase(fetchRefundOverview.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                const { trends } = data;
                state.refundOverview = {
                    totalRefunds:      data.totalRefunds      ?? 0,
                    refundRate:        data.refundRate        ?? 0,
                    pending:           data.pending           ?? 0,
                    totalAmount:       data.totalAmount       ?? 0,
                    avgAmount:         data.avgAmount         ?? 0,
                    avgProcessingTime: data.avgProcessingTime ?? 0,
                    trends,
                    statusBreakdown:   data.statusBreakdown   ?? [],
                    _raw:              data,
                };
            })
            .addCase(fetchRefundOverview.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchRefundsByPaymentMethod.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                state.refundsByPaymentMethod = data;
            })
            .addCase(fetchRefundsByPaymentMethod.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchRefundTimeline.fulfilled, (state, action) => {
                if (action.payload._timeframe !== state.activeTimeframe) return;
                const { _timeframe, ...data } = action.payload;
                state.refundTimeline = data;
            })
            .addCase(fetchRefundTimeline.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });
    },
});

export const {
    setReturnAnalyticsTimeframe,
    clearReturnAnalyticsError,
    removeReturnAnalyticsSuccess,
} = returnAnalyticsSlice.actions;

export default returnAnalyticsSlice.reducer;