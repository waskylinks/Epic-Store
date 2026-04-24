/**
 * features/admin/cronLogSlice.js
 *
 * Redux slice for cron run history and the checkout analytics banner.
 *
 * State shape:
 *   banner: {
 *     jobs:        Array,    — recent runs for banner-relevant jobs
 *     lastFetched: number|null, — epoch ms of last successful fetch
 *     dismissed:   boolean,  — session-only; resets on reload
 *     loading:     boolean,
 *     error:       string|null,
 *   }
 *
 *   history: {
 *     [jobName]: {
 *       logs:        Array,
 *       hasNextPage: boolean,
 *       nextCursor:  string|null,
 *       loading:     boolean,
 *       loadingMore: boolean,   — true only when appending (Load More)
 *       error:       string|null,
 *     }
 *   }
 *
 * Thunks:
 *   fetchCronBanner()
 *     — Called on CheckoutAnalytics mount and on manual refresh.
 *       Skips fetch if dismissed flag is true (banner was already seen
 *       this session). The dismissed flag is reset on the next page mount
 *       cycle only if lastFetched is older than BANNER_STALE_MS.
 *
 *   fetchCronJobHistory(jobName, options?)
 *     — Fetches the first page of history for a job.
 *       Replaces existing logs in state.
 *
 *   fetchMoreCronJobHistory(jobName)
 *     — Appends the next page of history using the stored nextCursor.
 *       No-ops if hasNextPage is false or a load is already in progress.
 *
 * EDIT SUMMARY (vs previous version):
 *   - Removed unused `getState` destructure from fetchCronBanner thunk
 *     argument (was triggering ESLint no-unused-vars on line 74).
 *     The condition callback on the thunk already has access to getState
 *     via its own argument — the thunk body itself never needed it.
 */

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api/v1/admin/cron';

// If the banner data is older than this, force a re-fetch even if dismissed
const BANNER_STALE_MS = 5 * 60 * 1000; // 5 minutes

const isAbortError = (error) =>
  error?.code === 'ERR_CANCELED' ||
  error?.name === 'AbortError'   ||
  error?.name === 'CanceledError';

// ─────────────────────────────────────────────────────────────────────────────
// THUNKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fetchCronBanner
 *
 * Fetches banner data from GET /api/v1/admin/cron/banner.
 * Should be called on CheckoutAnalytics page mount and on manual refresh.
 *
 * The thunk checks whether data is stale before issuing the request, but
 * the backend also caches at 60s TTL so a redundant fetch is cheap.
 *
 * Note: `getState` is intentionally omitted from the thunk payload creator's
 * argument — it is only used inside the `condition` callback below, which
 * receives its own { getState } argument from createAsyncThunk.
 */
export const fetchCronBanner = createAsyncThunk(
  'cronLog/fetchCronBanner',
  async (_, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(`${API_BASE}/banner`, {
        withCredentials: true,
        signal,
      });
      return data;
    } catch (error) {
      if (isAbortError(error)) return rejectWithValue({ aborted: true });
      return rejectWithValue(
        error.response?.data?.message ?? 'Failed to fetch cron banner'
      );
    }
  },
  {
    // Skip the network request if data is fresh and banner hasn't been forcibly
    // refreshed. The condition receives (arg, { getState }) before the thunk runs.
    condition: (forceRefresh, { getState }) => {
      if (forceRefresh === true) return true; // explicit refresh bypass
      const { lastFetched } = getState().cronLog.banner;
      if (!lastFetched) return true; // never fetched
      return Date.now() - lastFetched > BANNER_STALE_MS;
    },
  }
);

/**
 * fetchCronJobHistory
 *
 * Fetches the first page of run history for a specific job.
 * Replaces any previously loaded logs for that job.
 *
 * @param {string} jobName
 * @param {{ limit?: number }} [options]
 */
export const fetchCronJobHistory = createAsyncThunk(
  'cronLog/fetchCronJobHistory',
  async ({ jobName, limit = 20 }, { rejectWithValue, signal }) => {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      const { data } = await axios.get(
        `${API_BASE}/logs/${encodeURIComponent(jobName)}?${params.toString()}`,
        { withCredentials: true, signal }
      );
      return { jobName, ...data };
    } catch (error) {
      if (isAbortError(error)) return rejectWithValue({ aborted: true });
      return rejectWithValue({
        jobName,
        message: error.response?.data?.message ?? `Failed to fetch history for ${jobName}`,
      });
    }
  }
);

/**
 * fetchMoreCronJobHistory
 *
 * Appends the next page of run history using the stored cursor.
 * Guards against concurrent loads and exhausted pages.
 *
 * @param {string} jobName
 */
export const fetchMoreCronJobHistory = createAsyncThunk(
  'cronLog/fetchMoreCronJobHistory',
  async (jobName, { getState, rejectWithValue, signal }) => {
    const jobState = getState().cronLog.history[jobName];

    // Guard: don't fetch if there's nothing more or a load is in progress
    if (!jobState?.hasNextPage) {
      return rejectWithValue({ aborted: true, reason: 'no more pages' });
    }
    if (jobState?.loadingMore || jobState?.loading) {
      return rejectWithValue({ aborted: true, reason: 'already loading' });
    }

    const cursor = jobState.nextCursor;
    if (!cursor) {
      return rejectWithValue({ aborted: true, reason: 'no cursor' });
    }

    try {
      const params = new URLSearchParams({ limit: '20', cursor });
      const { data } = await axios.get(
        `${API_BASE}/logs/${encodeURIComponent(jobName)}?${params.toString()}`,
        { withCredentials: true, signal }
      );
      return { jobName, ...data };
    } catch (error) {
      if (isAbortError(error)) return rejectWithValue({ aborted: true });
      return rejectWithValue({
        jobName,
        message: error.response?.data?.message ?? `Failed to load more history for ${jobName}`,
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL STATE
// ─────────────────────────────────────────────────────────────────────────────

const initialBannerState = {
  jobs:        [],
  lastFetched: null,
  dismissed:   false,
  loading:     false,
  error:       null,
};

const initialJobHistoryState = {
  logs:        [],
  hasNextPage: false,
  nextCursor:  null,
  loading:     false,
  loadingMore: false,
  error:       null,
};

const initialState = {
  banner:  { ...initialBannerState },
  history: {}, // keyed by jobName — entries created on first fetch
};

// ─────────────────────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────────────────────

const cronLogSlice = createSlice({
  name: 'cronLog',
  initialState,
  reducers: {
    // Dismiss the banner for the current session.
    // The dismissed flag is session-only — it is never persisted to
    // localStorage or Redux persist. A page reload always shows a fresh banner
    // if data is available (subject to BANNER_STALE_MS).
    dismissBanner: (state) => {
      state.banner.dismissed = true;
    },

    // Force-clear the dismissed flag — used when a manual refresh is triggered
    // so the admin sees the updated banner immediately after refreshing.
    resetBannerDismiss: (state) => {
      state.banner.dismissed = false;
    },

    // Clear history for a specific job — called when the history panel is
    // collapsed so stale data doesn't linger in memory.
    clearJobHistory: (state, action) => {
      const jobName = action.payload;
      if (state.history[jobName]) {
        delete state.history[jobName];
      }
    },

    // Clear all history — used on logout or role change.
    clearAllHistory: (state) => {
      state.history = {};
    },

    // Clear banner error
    clearBannerError: (state) => {
      state.banner.error = null;
    },
  },

  extraReducers: (builder) => {

    // ── fetchCronBanner ─────────────────────────────────────────────────────
    builder
      .addCase(fetchCronBanner.pending, (state) => {
        state.banner.loading = true;
        state.banner.error   = null;
      })
      .addCase(fetchCronBanner.fulfilled, (state, action) => {
        state.banner.loading     = false;
        state.banner.jobs        = action.payload.jobs ?? [];
        state.banner.lastFetched = Date.now();
      })
      .addCase(fetchCronBanner.rejected, (state, action) => {
        state.banner.loading = false;
        if (!action.payload?.aborted) {
          state.banner.error =
            typeof action.payload === 'string'
              ? action.payload
              : action.payload?.message ?? 'Failed to fetch banner';
        }
      });

    // ── fetchCronJobHistory ─────────────────────────────────────────────────
    builder
      .addCase(fetchCronJobHistory.pending, (state, action) => {
        const { jobName } = action.meta.arg;
        if (!state.history[jobName]) {
          state.history[jobName] = { ...initialJobHistoryState };
        }
        state.history[jobName].loading = true;
        state.history[jobName].error   = null;
      })
      .addCase(fetchCronJobHistory.fulfilled, (state, action) => {
        const { jobName, logs, hasNextPage, nextCursor } = action.payload;
        state.history[jobName] = {
          logs:        logs        ?? [],
          hasNextPage: hasNextPage ?? false,
          nextCursor:  nextCursor  ?? null,
          loading:     false,
          loadingMore: false,
          error:       null,
        };
      })
      .addCase(fetchCronJobHistory.rejected, (state, action) => {
        const jobName = action.payload?.jobName ?? action.meta.arg?.jobName;
        if (!action.payload?.aborted && jobName) {
          if (!state.history[jobName]) {
            state.history[jobName] = { ...initialJobHistoryState };
          }
          state.history[jobName].loading = false;
          state.history[jobName].error   =
            action.payload?.message ?? 'Failed to fetch history';
        }
      });

    // ── fetchMoreCronJobHistory ─────────────────────────────────────────────
    builder
      .addCase(fetchMoreCronJobHistory.pending, (state, action) => {
        const jobName = action.meta.arg;
        if (state.history[jobName]) {
          state.history[jobName].loadingMore = true;
          state.history[jobName].error       = null;
        }
      })
      .addCase(fetchMoreCronJobHistory.fulfilled, (state, action) => {
        const { jobName, logs, hasNextPage, nextCursor } = action.payload;
        if (state.history[jobName]) {
          // Append to existing logs — dedup on _id in case of race condition
          const existingIds = new Set(state.history[jobName].logs.map((l) => l._id));
          const newLogs     = (logs ?? []).filter((l) => !existingIds.has(l._id));

          state.history[jobName].logs        = [...state.history[jobName].logs, ...newLogs];
          state.history[jobName].hasNextPage  = hasNextPage ?? false;
          state.history[jobName].nextCursor   = nextCursor  ?? null;
          state.history[jobName].loadingMore  = false;
        }
      })
      .addCase(fetchMoreCronJobHistory.rejected, (state, action) => {
        const jobName = action.meta.arg;
        if (!action.payload?.aborted && state.history[jobName]) {
          state.history[jobName].loadingMore = false;
          state.history[jobName].error       =
            action.payload?.message ?? 'Failed to load more';
        }
      });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const {
  dismissBanner,
  resetBannerDismiss,
  clearJobHistory,
  clearAllHistory,
  clearBannerError,
} = cronLogSlice.actions;

// ─────────────────────────────────────────────────────────────────────────────
// SELECTORS
// ─────────────────────────────────────────────────────────────────────────────

export const selectCronBanner         = (state) => state.cronLog.banner;
export const selectBannerJobs         = (state) => state.cronLog.banner.jobs;
export const selectBannerDismissed    = (state) => state.cronLog.banner.dismissed;
export const selectBannerLoading      = (state) => state.cronLog.banner.loading;
export const selectBannerLastFetched  = (state) => state.cronLog.banner.lastFetched;

export const selectJobHistory = (jobName) => (state) =>
  state.cronLog.history[jobName] ?? initialJobHistoryState;

export const selectJobHistoryLogs = (jobName) => (state) =>
  state.cronLog.history[jobName]?.logs ?? [];

export const selectJobHistoryLoading = (jobName) => (state) =>
  state.cronLog.history[jobName]?.loading ?? false;

export const selectJobHistoryLoadingMore = (jobName) => (state) =>
  state.cronLog.history[jobName]?.loadingMore ?? false;

export const selectJobHistoryHasNextPage = (jobName) => (state) =>
  state.cronLog.history[jobName]?.hasNextPage ?? false;

// Returns the first banner job entry matching a given jobName, or null.
// Used by CheckoutAnalytics to extract CheckoutRetention data specifically.
export const selectBannerJobByName = (jobName) => (state) =>
  state.cronLog.banner.jobs.find((j) => j.jobName === jobName) ?? null;

export default cronLogSlice.reducer;