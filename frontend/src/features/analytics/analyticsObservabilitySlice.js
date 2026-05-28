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

// ─── ABORT DETECTION ──────────────────────────────────────────────────────────
//
// FIX: Extended to cover all known axios cancellation shapes across versions:
//   - axios ≥ 0.22 / 1.x: ERR_CANCELED (signal abort) or CanceledError name
//   - axios < 0.22:        Cancel objects with `__CANCEL__ === true`
//   - Native fetch/browser: AbortError name
//
// Without the `__CANCEL__` check, older-axios abort errors were falling through
// as real errors and populating e.g. healthError with the cancellation message.
const isAbortError = (error) =>
  error?.code === 'ERR_CANCELED'  ||
  error?.name === 'AbortError'    ||
  error?.name === 'CanceledError' ||
  error?.__CANCEL__ === true;     // FIX: axios < 0.22 Cancel object

// ─── THUNKS ───────────────────────────────────────────────────────────────────

export const fetchAttributionHealth = createAsyncThunk(
  'analyticsObservability/fetchAttributionHealth',
  async (_, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/health`, {
        signal,
        withCredentials: true,
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
        withCredentials: true,
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
        withCredentials: true,
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

// FIX: fetchUserEventTrace now embeds a `_requestId` (the thunk's own
// requestId) in its return value. The pending case stores that same requestId
// in `state.tracePendingId`. The fulfilled case only commits the result when
// the payload's requestId still matches — so a clearTrace() call (which resets
// tracePendingId to null) causes any in-flight fetch that later resolves to be
// silently discarded instead of overwriting the cleared state.
export const fetchUserEventTrace = createAsyncThunk(
  'analyticsObservability/fetchUserEventTrace',
  async (userId, { rejectWithValue, signal, requestId }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/trace/${userId}`, {
        signal,
        withCredentials: true,
      });
      return { ...data, _requestId: requestId };
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
  trace:           null,
  traceLoading:    false,
  traceError:      null,
  // FIX: tracks the requestId of the currently-active trace fetch so that
  // clearTrace() can invalidate it without needing to cancel the network request.
  tracePendingId:  null,
};

const analyticsObservabilitySlice = createSlice({
  name: 'analyticsObservability',
  initialState,
  reducers: {
    // FIX: clearTrace now also nulls tracePendingId. Any in-flight
    // fetchUserEventTrace that later resolves will find its requestId no longer
    // matches and will skip the state update, so the cleared state is preserved.
    clearTrace(state) {
      state.trace         = null;
      state.traceError    = null;
      state.tracePendingId = null; // FIX: invalidates any in-flight fetch
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
      .addCase(fetchUserEventTrace.pending, (state, action) => {
        state.traceLoading   = true;
        state.traceError     = null;
        state.trace          = null;
        // FIX: record which request is now the "active" one
        state.tracePendingId = action.meta.requestId;
      })
      .addCase(fetchUserEventTrace.fulfilled, (state, action) => {
        state.traceLoading = false;
        // FIX: only commit if this response belongs to the still-active request.
        // If clearTrace() was called while the fetch was in flight,
        // tracePendingId will be null and the result is silently dropped.
        if (action.payload._requestId === state.tracePendingId) {
          const { _requestId, ...trace } = action.payload;
          state.trace         = trace;
          state.tracePendingId = null;
        }
      })
      .addCase(fetchUserEventTrace.rejected, (state, action) => {
        state.traceLoading = false;
        if (!action.payload?.aborted) {
          state.traceError = typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'Failed to fetch user event trace';
        }
        // Clear pendingId regardless so future fetches aren't blocked
        state.tracePendingId = null;
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