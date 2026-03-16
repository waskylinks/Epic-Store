// customerAnalyticsSlice.js
// Customer overview, RFM segments, CLV, churn risk, cohorts, purchase behaviour,
// acquisition sources. All data originates from the CustomerAnalytics collection.

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

const EMPTY_CUSTOMER_OVERVIEW = {
    totalCustomers:     0,
    newCustomers:       0,
    newCustomersGrowth: 0,
    activeCustomers:    0,
    avgOrderValue:      0,
    avgLifetimeValue:   0,
    totalRevenue:       0,
    avgOrders:          0,
    vipCount:           0,
    atRiskCount:        0,
    segments:           [],
    valueTiers:         [],
    churnRisk:          [],
};

// ============================================
// THUNKS
// ============================================

export const fetchCustomerOverview = createAsyncThunk(
    "customerAnalytics/fetchCustomerOverview",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/overview`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch customer overview"
            );
        }
    }
);

export const fetchSegmentDistribution = createAsyncThunk(
    "customerAnalytics/fetchSegmentDistribution",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/segments`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch segment distribution"
            );
        }
    }
);

export const fetchCustomersBySegment = createAsyncThunk(
    "customerAnalytics/fetchCustomersBySegment",
    async ({ segment, limit = 100, page = 1 }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/segments/${segment}?limit=${limit}&page=${page}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch customers by segment"
            );
        }
    }
);

export const fetchHighValueCustomers = createAsyncThunk(
    "customerAnalytics/fetchHighValueCustomers",
    async ({ minRevenue = 1000, limit = 50 }, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/high-value?minRevenue=${minRevenue}&limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch high-value customers"
            );
        }
    }
);

export const fetchAtRiskCustomers = createAsyncThunk(
    "customerAnalytics/fetchAtRiskCustomers",
    async ({ limit = 100, riskLevel }, { rejectWithValue, signal }) => {
        try {
            const params = new URLSearchParams({ limit: limit.toString() });
            if (riskLevel) params.append("riskLevel", riskLevel);
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/at-risk?${params.toString()}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch at-risk customers"
            );
        }
    }
);

export const fetchVIPCustomers = createAsyncThunk(
    "customerAnalytics/fetchVIPCustomers",
    async (limit = 50, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/vip?limit=${limit}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch VIP customers"
            );
        }
    }
);

export const fetchCLVDistribution = createAsyncThunk(
    "customerAnalytics/fetchCLVDistribution",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/clv-distribution`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch CLV distribution"
            );
        }
    }
);

export const fetchCustomersNeedingAttention = createAsyncThunk(
    "customerAnalytics/fetchCustomersNeedingAttention",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/needs-attention`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message ||
                    "Failed to fetch customers needing attention"
            );
        }
    }
);

export const fetchCustomerCohorts = createAsyncThunk(
    "customerAnalytics/fetchCustomerCohorts",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/cohorts?timeframe=${timeframe}`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch customer cohorts"
            );
        }
    }
);

export const fetchRepeatPurchaseAnalytics = createAsyncThunk(
    "customerAnalytics/fetchRepeatPurchaseAnalytics",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/repeat-purchase`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message ||
                    "Failed to fetch repeat purchase analytics"
            );
        }
    }
);

export const fetchPurchaseFrequencyAnalytics = createAsyncThunk(
    "customerAnalytics/fetchPurchaseFrequencyAnalytics",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/purchase-frequency`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch purchase frequency"
            );
        }
    }
);

export const fetchAcquisitionSourceAnalytics = createAsyncThunk(
    "customerAnalytics/fetchAcquisitionSourceAnalytics",
    async (_, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/customers/acquisition-sources`,
                { signal }
            );
            return data;
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch acquisition sources"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const customerAnalyticsSlice = createSlice({
    name: "customerAnalytics",
    initialState: {
        customerOverview:           { ...EMPTY_CUSTOMER_OVERVIEW },
        segmentDistribution:        null,
        customersBySegment:         [],
        highValueCustomers:         [],
        atRiskCustomers:            [],
        vipCustomers:               [],
        clvDistribution:            null,
        customersNeedingAttention:  null,
        customerCohorts:            null,
        repeatPurchaseAnalytics:    null,
        purchaseFrequencyAnalytics: null,
        acquisitionSources:         null,
        loading:                    false,
        error:                      null,
    },
    reducers: {
        clearCustomerAnalyticsError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        // ── fetchCustomerOverview ────────────────────────────────────────────
        builder
            .addCase(fetchCustomerOverview.pending, (state) => {
                state.loading = true;
                state.error   = null;
            })
            .addCase(fetchCustomerOverview.fulfilled, (state, action) => {
                state.loading = false;
                // Destructure only what we need — success is intentionally discarded
                const {
                    // eslint-disable-next-line no-unused-vars
                    success,
                    totalCustomers,
                    newCustomers,
                    newCustomersGrowth,
                    activeCustomers,
                    avgOrderValue,
                    avgLifetimeValue,
                    totalRevenue,
                    avgOrders,
                    vipCount,
                    atRiskCount,
                    segments,
                    valueTiers,
                    churnRisk,
                } = action.payload;

                state.customerOverview = {
                    totalCustomers:     totalCustomers     || 0,
                    newCustomers:       newCustomers       || 0,
                    newCustomersGrowth: newCustomersGrowth || 0,
                    activeCustomers:    activeCustomers    || 0,
                    avgOrderValue:      avgOrderValue      || 0,
                    avgLifetimeValue:   avgLifetimeValue   || 0,
                    totalRevenue:       totalRevenue       || 0,
                    avgOrders:          avgOrders          || 0,
                    vipCount:           vipCount           || 0,
                    atRiskCount:        atRiskCount        || 0,
                    segments:           segments           || [],
                    valueTiers:         valueTiers         || [],
                    churnRisk:          churnRisk          || [],
                };
            })
            .addCase(fetchCustomerOverview.rejected, (state, action) => {
                state.loading          = false;
                state.customerOverview = { ...EMPTY_CUSTOMER_OVERVIEW };
                if (!action.payload?.aborted) {
                    state.error =
                        typeof action.payload === "string"
                            ? action.payload
                            : action.payload?.message ||
                              "Failed to fetch customer overview";
                }
            });

        // ── Simple fulfilled-only cases ──────────────────────────────────────
        builder
            .addCase(fetchSegmentDistribution.fulfilled, (state, action) => {
                state.segmentDistribution = action.payload;
            })
            .addCase(fetchSegmentDistribution.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCustomersBySegment.fulfilled, (state, action) => {
                state.customersBySegment = action.payload;
            })
            .addCase(fetchCustomersBySegment.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchHighValueCustomers.fulfilled, (state, action) => {
                state.highValueCustomers = action.payload;
            })
            .addCase(fetchHighValueCustomers.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchAtRiskCustomers.fulfilled, (state, action) => {
                state.atRiskCustomers = action.payload;
            })
            .addCase(fetchAtRiskCustomers.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchVIPCustomers.fulfilled, (state, action) => {
                state.vipCustomers = action.payload;
            })
            .addCase(fetchVIPCustomers.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCLVDistribution.fulfilled, (state, action) => {
                state.clvDistribution = action.payload;
            })
            .addCase(fetchCLVDistribution.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCustomersNeedingAttention.fulfilled, (state, action) => {
                state.customersNeedingAttention = action.payload;
            })
            .addCase(fetchCustomersNeedingAttention.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCustomerCohorts.fulfilled, (state, action) => {
                state.customerCohorts = action.payload;
            })
            .addCase(fetchCustomerCohorts.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchRepeatPurchaseAnalytics.fulfilled, (state, action) => {
                state.repeatPurchaseAnalytics = action.payload;
            })
            .addCase(fetchRepeatPurchaseAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchPurchaseFrequencyAnalytics.fulfilled, (state, action) => {
                state.purchaseFrequencyAnalytics = action.payload;
            })
            .addCase(fetchPurchaseFrequencyAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchAcquisitionSourceAnalytics.fulfilled, (state, action) => {
                state.acquisitionSources = action.payload;
            })
            .addCase(fetchAcquisitionSourceAnalytics.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });
    },
});

export const { clearCustomerAnalyticsError } = customerAnalyticsSlice.actions;
export default customerAnalyticsSlice.reducer;