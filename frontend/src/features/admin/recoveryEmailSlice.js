import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

const API = '/api/v1';

const isAbortError = (e) =>
  e?.code === 'ERR_CANCELED' || e?.name === 'AbortError' || e?.name === 'CanceledError';

// ============================================
// THUNKS
// ============================================

export const sendRecoveryEmail = createAsyncThunk(
  'recovery/sendEmail',
  async (checkoutId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${API}/recovery/send`, { checkoutId }, { withCredentials: true });
      return { checkoutId, ...data };
    } catch (err) {
      return rejectWithValue({
        checkoutId,
        message:         err.response?.data?.message || 'Failed to send recovery email',
        nextAvailableAt: err.response?.data?.nextAvailableAt || null,
        status:          err.response?.status || 500,
      });
    }
  }
);

export const fetchRecoveryStatus = createAsyncThunk(
  'recovery/fetchStatus',
  async (checkoutId, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API}/recovery/status/${checkoutId}`, { withCredentials: true, signal });
      return { checkoutId, status: data.status };
    } catch (err) {
      if (isAbortError(err)) return rejectWithValue({ aborted: true });
      return rejectWithValue({ checkoutId, message: err.response?.data?.message || 'Failed to fetch status' });
    }
  }
);

export const fetchSendList = createAsyncThunk(
  'recovery/fetchSendList',
  async (params = {}, { rejectWithValue, signal }) => {
    try {
      const query = new URLSearchParams({
        page:    params.page    || 1,
        limit:   params.limit   || 20,
        sortBy:  params.sortBy  || 'priority',
        minValue: params.minValue || 0,
        hours:   params.hours   || 720,
        ...(params.outcome && params.outcome !== 'all' && { outcome: params.outcome }),
        ...(params.search  && { search: params.search }),
      });
      const { data } = await axios.get(`${API}/recovery/send-list?${query}`, { withCredentials: true, signal });
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
      const { data } = await axios.get(`${API}/recovery/analytics?timeframe=${timeframe}`, { withCredentials: true, signal });
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
      const { data } = await axios.post(`${API}/recovery/resolve/${checkoutId}`, { outcome }, { withCredentials: true });
      return { checkoutId, outcome, ...data };
    } catch (err) {
      return rejectWithValue({ checkoutId, message: err.response?.data?.message || 'Failed to resolve outcome' });
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  // Send list (left panel)
  sendList:       [],
  pagination:     { currentPage: 1, totalPages: 1, total: 0, hasNextPage: false, hasPrevPage: false },
  sendListSummary: { totalMatchingCarts: 0, neverContacted: 0, awaitingResponse: 0, clickedNotConverted: 0, reAbandoned: 0 },
  sendListLoading: false,
  sendListError:   null,

  // Per-checkout email status (keyed by checkoutId)
  statusByCheckout: {},
  statusLoading:    {},

  // Send action (per-checkout loading/error/result)
  sendLoading: {},
  sendError:   {},
  sendResult:  {},

  // Analytics
  analytics:        null,
  analyticsLoading: false,
  analyticsError:   null,
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
    clearSendError: (state, action) => {
      const id = action.payload;
      if (id) delete state.sendError[id];
      else     state.sendError = {};
    },
    clearSuccess: (state) => {
      state.success = false;
      state.message = null;
    },
    setAnalyticsTimeframe: (state, action) => {
      state.analyticsTimeframe = action.payload;
    },
  },

  extraReducers: (builder) => {
    // ── Send list ─────────────────────────────────────────────
    builder
      .addCase(fetchSendList.pending, (state) => {
        state.sendListLoading = true;
        state.sendListError   = null;
      })
      .addCase(fetchSendList.fulfilled, (state, action) => {
        state.sendListLoading   = false;
        state.sendList          = action.payload.items || [];
        state.pagination        = action.payload.pagination || initialState.pagination;
        state.sendListSummary   = action.payload.summary    || initialState.sendListSummary;
      })
      .addCase(fetchSendList.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        state.sendListLoading = false;
        state.sendListError   = action.payload;
      });

    // ── Per-checkout status ───────────────────────────────────
    builder
      .addCase(fetchRecoveryStatus.pending, (state, action) => {
        const id = action.meta.arg;
        state.statusLoading[id] = true;
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

    // ── Send email ────────────────────────────────────────────
    builder
      .addCase(sendRecoveryEmail.pending, (state, action) => {
        const id = action.meta.arg;
        state.sendLoading[id] = true;
        state.sendError[id]   = null;
      })
      .addCase(sendRecoveryEmail.fulfilled, (state, action) => {
        const { checkoutId, attemptNumber, sentAt, nextAvailableAt, cartSnapshot } = action.payload;
        state.sendLoading[checkoutId] = false;
        state.sendResult[checkoutId]  = { attemptNumber, sentAt, nextAvailableAt, cartSnapshot };
        state.success = true;
        state.message = `Recovery email sent (attempt ${attemptNumber})`;

        // Optimistically update statusByCheckout
        if (state.statusByCheckout[checkoutId]) {
          state.statusByCheckout[checkoutId].confirmedAttempts = attemptNumber;
          state.statusByCheckout[checkoutId].lastSentAt        = sentAt;
          state.statusByCheckout[checkoutId].nextAvailableAt   = nextAvailableAt;
          state.statusByCheckout[checkoutId].outcome            = 'sent';
        }
      })
      .addCase(sendRecoveryEmail.rejected, (state, action) => {
        const { checkoutId, message, nextAvailableAt } = action.payload;
        state.sendLoading[checkoutId] = false;
        state.sendError[checkoutId]   = { message, nextAvailableAt };
      });

    // ── Analytics ─────────────────────────────────────────────
    builder
      .addCase(fetchRecoveryAnalytics.pending, (state) => {
        state.analyticsLoading = true;
        state.analyticsError   = null;
      })
      .addCase(fetchRecoveryAnalytics.fulfilled, (state, action) => {
        const { _timeframe, ...data } = action.payload;
        state.analyticsLoading  = false;
        state.analytics         = data;
        state.analyticsTimeframe = _timeframe;
      })
      .addCase(fetchRecoveryAnalytics.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        state.analyticsLoading = false;
        state.analyticsError   = action.payload;
      });

    // ── Resolve outcome ───────────────────────────────────────
    builder
      .addCase(resolveRecoveryOutcome.pending, (state, action) => {
        const { checkoutId } = action.meta.arg;
        state.resolveLoading[checkoutId] = true;
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
        if (!action.payload?.aborted) {
          const { checkoutId } = action.payload || {};
          if (checkoutId) state.resolveLoading[checkoutId] = false;
        }
      });
  },
});

export const { clearSendError, clearSuccess, setAnalyticsTimeframe } = recoverySlice.actions;

// ── Selectors ─────────────────────────────────────────────────
export const selectSendList          = (s) => s.recovery.sendList;
export const selectSendListLoading   = (s) => s.recovery.sendListLoading;
export const selectSendListError     = (s) => s.recovery.sendListError;
export const selectPagination        = (s) => s.recovery.pagination;
export const selectSendListSummary   = (s) => s.recovery.sendListSummary;

export const selectStatusFor         = (id) => (s) => s.recovery.statusByCheckout[id] || null;
export const selectSendLoadingFor    = (id) => (s) => s.recovery.sendLoading[id]       || false;
export const selectSendErrorFor      = (id) => (s) => s.recovery.sendError[id]         || null;
export const selectSendResultFor     = (id) => (s) => s.recovery.sendResult[id]        || null;
export const selectResolveLoadingFor = (id) => (s) => s.recovery.resolveLoading[id]    || false;

export const selectAnalytics         = (s) => s.recovery.analytics;
export const selectAnalyticsLoading  = (s) => s.recovery.analyticsLoading;
export const selectAnalyticsError    = (s) => s.recovery.analyticsError;
export const selectAnalyticsTimeframe = (s) => s.recovery.analyticsTimeframe;

export const selectSuccess           = (s) => s.recovery.success;
export const selectMessage           = (s) => s.recovery.message;

export default recoverySlice.reducer;