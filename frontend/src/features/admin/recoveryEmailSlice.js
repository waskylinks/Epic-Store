import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

const API = '/api/v1';

const isAbortError = (e) =>
  e?.code === 'ERR_CANCELED' || e?.name === 'AbortError' || e?.name === 'CanceledError';

// ============================================
// THUNKS
// ============================================

// sendRecoveryEmail removed — POST /api/v1/recovery/send was deleted when
// admin sends were removed. Cron is the only sender now.

export const fetchRecoveryStatus = createAsyncThunk(
  'recovery/fetchStatus',
  async (checkoutId, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(
        `${API}/recovery/status/${checkoutId}`,
        { withCredentials: true, signal }
      );
      return { checkoutId, status: data.status };
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue({
        checkoutId,
        message: err.response?.data?.message || 'Failed to fetch status',
      });
    }
  }
);

export const fetchSendList = createAsyncThunk(
  'recovery/fetchSendList',
  async (params = {}, { rejectWithValue, signal }) => {
    try {
      const query = new URLSearchParams({
        page:     params.page     || 1,
        limit:    params.limit    || 20,
        sortBy:   params.sortBy   || 'priority',
        minValue: params.minValue || 0,
        hours:    params.hours    || 720,
        ...(params.outcome && params.outcome !== 'all' && { outcome: params.outcome }),
        ...(params.search  && { search: params.search }),
      });
      const { data } = await axios.get(
        `${API}/recovery/send-list?${query}`,
        { withCredentials: true, signal }
      );
      return data;
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch abandoned carts');
    }
  }
);

export const fetchRecoveryAnalytics = createAsyncThunk(
  'recovery/fetchAnalytics',
  async (timeframe = 'month', { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(
        `${API}/recovery/analytics?timeframe=${timeframe}`,
        { withCredentials: true, signal }
      );
      return { ...data, _timeframe: timeframe };
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue(err.response?.data?.message || 'Failed to fetch analytics');
    }
  }
);

export const resolveRecoveryOutcome = createAsyncThunk(
  'recovery/resolveOutcome',
  async ({ checkoutId, outcome }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API}/recovery/resolve/${checkoutId}`,
        { outcome },
        { withCredentials: true }
      );
      return { checkoutId, outcome, ...data };
    } catch (err) {
      return rejectWithValue({
        checkoutId,
        message: err.response?.data?.message || 'Failed to resolve outcome',
      });
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  // Send list (left panel — read-only, cron sends only)
  sendList:        [],
  pagination:      { currentPage: 1, totalPages: 1, total: 0, hasNextPage: false, hasPrevPage: false },
  sendListSummary: { totalMatchingCarts: 0, neverContacted: 0, awaitingResponse: 0, clickedNotConverted: 0, reAbandoned: 0 },
  sendListLoading: false,
  sendListError:   null,

  // Per-checkout status (keyed by checkoutId)
  statusByCheckout: {},
  statusLoading:    {},

  // Analytics
  analytics:          null,
  analyticsLoading:   false,
  analyticsError:     null,
  analyticsTimeframe: 'month',

  // Resolve outcome (per-checkout)
  resolveLoading: {},

  // Global
  error:   null,
  success: false,
  message: null,
};

// ============================================
// SLICE
// ============================================

const recoverySlice = createSlice({
  name: 'recovery',
  initialState,
  reducers: {
    clearSuccess: (state) => {
      state.success = false;
      state.message = null;
    },
    setAnalyticsTimeframe: (state, action) => {
      state.analyticsTimeframe = action.payload;
    },
  },

  extraReducers: (builder) => {
    // SEND LIST
    builder
      .addCase(fetchSendList.pending, (state) => {
        state.sendListLoading = true;
        state.sendListError   = null;
      })
      .addCase(fetchSendList.fulfilled, (state, action) => {
        state.sendListLoading = false;
        state.sendList        = action.payload.items      || [];
        state.pagination      = action.payload.pagination || initialState.pagination;
        state.sendListSummary = action.payload.summary    || initialState.sendListSummary;
      })
      .addCase(fetchSendList.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        state.sendListLoading = false;
        state.sendListError   = action.payload;
      });

    // PER-CHECKOUT STATUS
    builder
      .addCase(fetchRecoveryStatus.pending, (state, action) => {
        state.statusLoading[action.meta.arg] = true;
      })
      .addCase(fetchRecoveryStatus.fulfilled, (state, action) => {
        const { checkoutId, status } = action.payload;
        state.statusLoading[checkoutId]    = false;
        state.statusByCheckout[checkoutId] = status;
      })
      .addCase(fetchRecoveryStatus.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        const id = action.payload?.checkoutId || action.meta.arg;
        state.statusLoading[id] = false;
      });

    // ANALYTICS
    builder
      .addCase(fetchRecoveryAnalytics.pending, (state) => {
        state.analyticsLoading = true;
        state.analyticsError   = null;
      })
      .addCase(fetchRecoveryAnalytics.fulfilled, (state, action) => {
        const { _timeframe, ...data } = action.payload;
        state.analyticsLoading   = false;
        state.analytics          = data;
        state.analyticsTimeframe = _timeframe;
      })
      .addCase(fetchRecoveryAnalytics.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        state.analyticsLoading = false;
        state.analyticsError   = action.payload;
      });

    // RESOLVE OUTCOME
    builder
      .addCase(resolveRecoveryOutcome.pending, (state, action) => {
        state.resolveLoading[action.meta.arg.checkoutId] = true;
      })
      .addCase(resolveRecoveryOutcome.fulfilled, (state, action) => {
        const { checkoutId, outcome } = action.payload;
        state.resolveLoading[checkoutId] = false;
        if (state.statusByCheckout[checkoutId]) {
          state.statusByCheckout[checkoutId].outcome = outcome;
        }
        state.success = true;
        state.message = `Outcome set to '${outcome}'`;
      })
      .addCase(resolveRecoveryOutcome.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        // FIX: action.payload may be undefined if Axios throws before a
        // response arrives. Previously this crashed with cannot read
        // checkoutId of undefined and left resolveLoading stuck on true.
        const checkoutId = action.payload?.checkoutId ?? action.meta.arg?.checkoutId;
        if (checkoutId) state.resolveLoading[checkoutId] = false;
      });
  },
});

export const { clearSuccess, setAnalyticsTimeframe } = recoverySlice.actions;

// SELECTORS
export const selectSendList          = (s) => s.recovery.sendList;
export const selectSendListLoading   = (s) => s.recovery.sendListLoading;
export const selectSendListError     = (s) => s.recovery.sendListError;
export const selectPagination        = (s) => s.recovery.pagination;
export const selectSendListSummary   = (s) => s.recovery.sendListSummary;

export const selectStatusFor         = (id) => (s) => s.recovery.statusByCheckout[id] || null;
export const selectResolveLoadingFor = (id) => (s) => s.recovery.resolveLoading[id]    || false;

export const selectAnalytics          = (s) => s.recovery.analytics;
export const selectAnalyticsLoading   = (s) => s.recovery.analyticsLoading;
export const selectAnalyticsError     = (s) => s.recovery.analyticsError;
export const selectAnalyticsTimeframe = (s) => s.recovery.analyticsTimeframe;

export const selectSuccess = (s) => s.recovery.success;
export const selectMessage = (s) => s.recovery.message;

export default recoverySlice.reducer;