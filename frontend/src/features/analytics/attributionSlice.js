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
// FIX: All thunks now use a consistent { timeframe } destructured-object
// signature so callers always pass the same shape — e.g.
// dispatch(fetchCampaignPerformance({ timeframe: 'week' })) — regardless
// of which thunk is being invoked.
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
    // FIX: was `async (timeframe = "month", ...)` — bare string param.
    // Now uses the same destructured-object signature as all other thunks.
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
    // FIX: was bare string param — now object.
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
    // FIX: was bare string param — now object.
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
    // FIX: was bare string param — now object.
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
    // FIX: was bare string param — now object.
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

// ============================================
// HELPERS
// ============================================

// The seven metric keys that have their own loading / error / data fields.
const METRICS = [
    "channelPerformance",
    "campaignPerformance",
    "devicePerformance",
    "browserPerformance",
    "referrerPerformance",
    "landingPagePerformance",
    "attributionModels",
];

// Build the initial state shape for a single metric.
// FIX (loading + per-metric error): Each metric gets its own `loading` boolean
// and `error` string so components can render per-metric spinners / error
// messages independently, instead of sharing a single, easily-stale flag.
const metricInitialState = () => ({
    data:    null,
    loading: false,
    error:   null,
});

// ============================================
// SLICE
// ============================================

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
        // FIX: clearAttributionError now accepts an optional metric name.
        // If provided, only that metric's error is cleared; if omitted, all
        // metric errors are cleared. This replaces the old single-field clear.
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
        // Helper to wire up the three lifecycle cases for a given thunk and
        // its corresponding state key.
        //
        // pending  — mark loading, clear stale data & error for this metric.
        //            FIX (stale data): nulling data here ensures that if the
        //            user switches timeframe, the old timeframe's data is
        //            removed immediately rather than lingering until the new
        //            request resolves.
        //
        // fulfilled — guard against out-of-order responses, then store data.
        //
        // rejected  — clear loading; if not an abort, store per-metric error.
        //             FIX (shared error): error goes into metric.error, not a
        //             single top-level field that can be left stale when an
        //             unrelated metric later succeeds.
        const wire = (thunk, stateKey) => {
            builder
                .addCase(thunk.pending, (state) => {
                    state[stateKey].loading = true;
                    state[stateKey].data    = null;   // FIX: clear stale data immediately
                    state[stateKey].error   = null;
                })
                .addCase(thunk.fulfilled, (state, action) => {
                    state[stateKey].loading = false;
                    if (action.payload._timeframe === state.activeTimeframe) {
                        const { _timeframe, ...data } = action.payload;
                        state[stateKey].data = data;
                    }
                    // If the timeframe guard rejected the payload we leave
                    // data as null — the correct request (already in flight)
                    // will populate it shortly.
                })
                .addCase(thunk.rejected, (state, action) => {
                    state[stateKey].loading = false;
                    if (!action.payload?.aborted) {
                        state[stateKey].error = action.payload; // FIX: per-metric error
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