// attributionSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const API_BASE = "/api/v1";

const isAbortError = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError";

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
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
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
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
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
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
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
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
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
    async ({ timeframe = "month" } = {}, { rejectWithValue, signal }) => {
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

const METRICS = [
    "channelPerformance",
    "campaignPerformance",
    "devicePerformance",
    "browserPerformance",
    "referrerPerformance",
    "landingPagePerformance",
    "attributionModels",
];

const metricInitialState = () => ({
    data:    null,
    loading: false,
    error:   null,
});

const attributionSlice = createSlice({
    name: "attribution",
    initialState: {
        activeTimeframe:        "month",
        channelPerformance:     metricInitialState(),
        campaignPerformance:    metricInitialState(),
        devicePerformance:      metricInitialState(),
        browserPerformance:     metricInitialState(),
        referrerPerformance:    metricInitialState(),
        landingPagePerformance: metricInitialState(),
        attributionModels:      metricInitialState(),
    },
    reducers: {
        setAttributionTimeframe: (state, action) => {
            state.activeTimeframe = action.payload;
        },
        clearAttributionError: (state, action) => {
            const metric = action.payload;
            if (metric && state[metric]) {
                state[metric].error = null;
            } else {
                METRICS.forEach((key) => {
                    state[key].error = null;
                });
            }
        },
    },
    extraReducers: (builder) => {
        const wire = (thunk, stateKey) => {
            builder
                .addCase(thunk.pending, (state) => {
                    state[stateKey].loading = true;
                    state[stateKey].data    = null;
                    state[stateKey].error   = null;
                })
                .addCase(thunk.fulfilled, (state, action) => {
                    state[stateKey].loading = false;
                    if (action.payload._timeframe === state.activeTimeframe) {
                        const { _timeframe, ...data } = action.payload;
                        state[stateKey].data = data;
                    }
                })
                .addCase(thunk.rejected, (state, action) => {
                    state[stateKey].loading = false;
                    if (!action.payload?.aborted) {
                        state[stateKey].error = action.payload;
                    }
                });
        };

        wire(fetchChannelPerformance,     "channelPerformance");
        wire(fetchCampaignPerformance,    "campaignPerformance");
        wire(fetchDevicePerformance,      "devicePerformance");
        wire(fetchBrowserPerformance,     "browserPerformance");
        wire(fetchReferrerPerformance,    "referrerPerformance");
        wire(fetchLandingPagePerformance, "landingPagePerformance");
        wire(fetchAttributionModels,      "attributionModels");
    },
});

export const {
    setAttributionTimeframe,
    clearAttributionError,
} = attributionSlice.actions;

export default attributionSlice.reducer;