// attributionSlice.js
// Marketing attribution analytics: channel performance, campaigns, devices,
// browsers, referrers, landing pages, and attribution model comparisons.
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

// ============================================
// THUNKS
// ============================================

export const fetchChannelPerformance = createAsyncThunk(
    "attribution/fetchChannelPerformance",
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/channels?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch channel performance"
            );
        }
    }
);

export const fetchCampaignPerformance = createAsyncThunk(
    "attribution/fetchCampaignPerformance",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/campaigns?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch campaign performance"
            );
        }
    }
);

export const fetchDevicePerformance = createAsyncThunk(
    "attribution/fetchDevicePerformance",
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/devices?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch device performance"
            );
        }
    }
);

export const fetchBrowserPerformance = createAsyncThunk(
    "attribution/fetchBrowserPerformance",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/browsers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch browser performance"
            );
        }
    }
);

export const fetchReferrerPerformance = createAsyncThunk(
    "attribution/fetchReferrerPerformance",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/referrers?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch referrer performance"
            );
        }
    }
);

export const fetchLandingPagePerformance = createAsyncThunk(
    "attribution/fetchLandingPagePerformance",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/landing-pages?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message ||
                    "Failed to fetch landing page performance"
            );
        }
    }
);

export const fetchAttributionModels = createAsyncThunk(
    "attribution/fetchAttributionModels",
    async (timeframe = "month", { rejectWithValue, signal }) => {
        try {
            const { data } = await axios.get(
                `${API_BASE}/analytics/attribution/models?timeframe=${timeframe}`,
                { signal }
            );
            return { ...data, _timeframe: timeframe };
        } catch (error) {
            if (isAbortError(error)) return rejectWithValue({ aborted: true });
            return rejectWithValue(
                error.response?.data?.message || "Failed to fetch attribution models"
            );
        }
    }
);

// ============================================
// SLICE
// ============================================

const attributionSlice = createSlice({
    name: "attribution",
    initialState: {
        activeTimeframe:        "month",
        channelPerformance:     null,
        campaignPerformance:    null,
        devicePerformance:      null,
        browserPerformance:     null,
        referrerPerformance:    null,
        landingPagePerformance: null,
        attributionModels:      null,
        error:                  null,
    },
    reducers: {
        setAttributionTimeframe: (state, action) => {
            state.activeTimeframe = action.payload;
        },
        clearAttributionError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchChannelPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.channelPerformance = data;
                }
            })
            .addCase(fetchChannelPerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchCampaignPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.campaignPerformance = data;
                }
            })
            .addCase(fetchCampaignPerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchDevicePerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.devicePerformance = data;
                }
            })
            .addCase(fetchDevicePerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchBrowserPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.browserPerformance = data;
                }
            })
            .addCase(fetchBrowserPerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchReferrerPerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.referrerPerformance = data;
                }
            })
            .addCase(fetchReferrerPerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchLandingPagePerformance.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.landingPagePerformance = data;
                }
            })
            .addCase(fetchLandingPagePerformance.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            })

            .addCase(fetchAttributionModels.fulfilled, (state, action) => {
                if (action.payload._timeframe === state.activeTimeframe) {
                    const { _timeframe, ...data } = action.payload;
                    state.attributionModels = data;
                }
            })
            .addCase(fetchAttributionModels.rejected, (state, action) => {
                if (!action.payload?.aborted) state.error = action.payload;
            });
    },
});

export const {
    setAttributionTimeframe,
    clearAttributionError,
} = attributionSlice.actions;

export default attributionSlice.reducer;