/**
 * frontend/src/features/analytics/analyticsObservabilitySlice.js
 *
 * Redux slice for Phase 8 observability endpoints.
 * Feeds four admin pages:
 *   - AttributionHealthPage   → /api/v1/admin/analytics/health
 *   - AttributionDriftPage    → /api/v1/admin/analytics/drift
 *   - QueueHealthPage         → /api/v1/admin/analytics/queue-health
 *   - UserEventTracePage      → /api/v1/admin/analytics/trace/:userId
 */

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

const API_BASE = '/api/v1/admin/analytics';

// Helper to check for abort/cancellation errors
const isAbortError = (error) =>
  error?.code === 'ERR_CANCELED' ||
  error?.name === 'AbortError' ||
  error?.name === 'CanceledError';

// ─── THUNKS ───────────────────────────────────────────────────────────────────

export const fetchAttributionHealth = createAsyncThunk(
  'analyticsObservability/fetchAttributionHealth',
  async (_, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/health`, { 
        signal,
        withCredentials: true 
      });
      return data;
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue(
        err.response?.data?.message || 'Failed to fetch attribution health'
      );
    }
  }
);

export const fetchAttributionDrift = createAsyncThunk(
  'analyticsObservability/fetchAttributionDrift',
  async (_, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/drift`, { 
        signal,
        withCredentials: true 
      });
      return data;
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue(
        err.response?.data?.message || 'Failed to fetch attribution drift'
      );
    }
  }
);

export const fetchQueueHealth = createAsyncThunk(
  'analyticsObservability/fetchQueueHealth',
  async (_, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/queue-health`, { 
        signal,
        withCredentials: true 
      });
      return data;
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue(
        err.response?.data?.message || 'Failed to fetch queue health'
      );
    }
  }
);

export const fetchUserEventTrace = createAsyncThunk(
  'analyticsObservability/fetchUserEventTrace',
  async (userId, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/trace/${userId}`, { 
        signal,
        withCredentials: true 
      });
      return data;
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue(
        err.response?.data?.message || 'Failed to fetch user event trace'
      );
    }
  }
);

// ─── SLICE ────────────────────────────────────────────────────────────────────

const initialState = {
  // Attribution health
  health:        null,
  healthLoading: false,
  healthError:   null,

  // Attribution drift
  drift:        null,
  driftLoading: false,
  driftError:   null,

  // Queue health
  queue:        null,
  queueLoading: false,
  queueError:   null,

  // User event trace
  trace:        null,
  traceLoading: false,
  traceError:   null,
};

const analyticsObservabilitySlice = createSlice({
  name: 'analyticsObservability',
  initialState,
  reducers: {
    clearTrace(state) {
      state.trace      = null;
      state.traceError = null;
    },
    clearErrors(state) {
      state.healthError = null;
      state.driftError  = null;
      state.queueError  = null;
      state.traceError  = null;
    },
  },
  extraReducers: (builder) => {
    // ── Attribution health ─────────────────────────────────────────────────
    builder
      .addCase(fetchAttributionHealth.pending, (state) => {
        state.healthLoading = true;
        state.healthError   = null;
      })
      .addCase(fetchAttributionHealth.fulfilled, (state, action) => {
        state.healthLoading = false;
        state.health        = action.payload;
      })
      .addCase(fetchAttributionHealth.rejected, (state, action) => {
        state.healthLoading = false;
        if (!action.payload?.aborted) {
          state.healthError = typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'Failed to fetch attribution health';
        }
      });

    // ── Attribution drift ──────────────────────────────────────────────────
    builder
      .addCase(fetchAttributionDrift.pending, (state) => {
        state.driftLoading = true;
        state.driftError   = null;
      })
      .addCase(fetchAttributionDrift.fulfilled, (state, action) => {
        state.driftLoading = false;
        state.drift        = action.payload;
      })
      .addCase(fetchAttributionDrift.rejected, (state, action) => {
        state.driftLoading = false;
        if (!action.payload?.aborted) {
          state.driftError = typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'Failed to fetch attribution drift';
        }
      });

    // ── Queue health ───────────────────────────────────────────────────────
    builder
      .addCase(fetchQueueHealth.pending, (state) => {
        state.queueLoading = true;
        state.queueError   = null;
      })
      .addCase(fetchQueueHealth.fulfilled, (state, action) => {
        state.queueLoading = false;
        state.queue        = action.payload;
      })
      .addCase(fetchQueueHealth.rejected, (state, action) => {
        state.queueLoading = false;
        if (!action.payload?.aborted) {
          state.queueError = typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'Failed to fetch queue health';
        }
      });

    // ── User event trace ───────────────────────────────────────────────────
    builder
      .addCase(fetchUserEventTrace.pending, (state) => {
        state.traceLoading = true;
        state.traceError   = null;
        state.trace        = null; // Clear previous trace data
      })
      .addCase(fetchUserEventTrace.fulfilled, (state, action) => {
        state.traceLoading = false;
        state.trace        = action.payload;
      })
      .addCase(fetchUserEventTrace.rejected, (state, action) => {
        state.traceLoading = false;
        if (!action.payload?.aborted) {
          state.traceError = typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'Failed to fetch user event trace';
        }
      });
  },
});

export const { clearTrace, clearErrors } = analyticsObservabilitySlice.actions;
export default analyticsObservabilitySlice.reducer;

// ─── SELECTORS ────────────────────────────────────────────────────────────────

export const selectAttributionHealth = (s) => s.analyticsObservability.health;
export const selectHealthLoading     = (s) => s.analyticsObservability.healthLoading;
export const selectHealthError       = (s) => s.analyticsObservability.healthError;

export const selectAttributionDrift  = (s) => s.analyticsObservability.drift;
export const selectDriftLoading      = (s) => s.analyticsObservability.driftLoading;
export const selectDriftError        = (s) => s.analyticsObservability.driftError;

export const selectQueueHealth       = (s) => s.analyticsObservability.queue;
export const selectQueueLoading      = (s) => s.analyticsObservability.queueLoading;
export const selectQueueError        = (s) => s.analyticsObservability.queueError;

export const selectUserTrace         = (s) => s.analyticsObservability.trace;
export const selectTraceLoading      = (s) => s.analyticsObservability.traceLoading;
export const selectTraceError        = (s) => s.analyticsObservability.traceError;