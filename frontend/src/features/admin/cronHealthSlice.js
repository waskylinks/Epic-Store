import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

const isAbortError = (error) =>
  error?.code === 'ERR_CANCELED' ||
  error?.name === 'AbortError' ||
  error?.name === 'CanceledError';

// ─── THUNKS ──────────────────────────────────────────────────────────────────

export const fetchCronHealth = createAsyncThunk(
  'cronHealth/fetchCronHealth',
  async (_, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get('/api/v1/admin/cron/health', {
        withCredentials: true,
        signal,
      });
      return data;
    } catch (error) {
      if (isAbortError(error)) return rejectWithValue({ aborted: true });
      return rejectWithValue(
        error.response?.data?.message ?? 'Failed to fetch cron health'
      );
    }
  }
);

export const triggerCronJob = createAsyncThunk(
  'cronHealth/triggerCronJob',
  async (jobName, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/admin/cron/trigger/${jobName}`,
        {},
        { withCredentials: true }
      );
      return { jobName, result: data.result };
    } catch (error) {
      return rejectWithValue({
        jobName,
        message: error.response?.data?.message ?? `Failed to trigger ${jobName}`,
      });
    }
  }
);

// ─── INITIAL STATE ────────────────────────────────────────────────────────────

const initialState = {
  jobs:           [],
  jobsLoading:    false,
  triggerLoading: {},
  triggerResult:  {},
  triggerError:   {},
  error:          null,
  lastFetchTime:  null,
};

// ─── SLICE ────────────────────────────────────────────────────────────────────

const cronHealthSlice = createSlice({
  name: 'cronHealth',
  initialState,
  reducers: {
    clearCronError: (state) => {
      state.error = null;
    },
    clearTriggerResult: (state, action) => {
      const jobName = action.payload;
      delete state.triggerResult[jobName];
      delete state.triggerError[jobName];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCronHealth.pending, (state) => {
        state.jobsLoading = true;
        state.error       = null;
      })
      .addCase(fetchCronHealth.fulfilled, (state, action) => {
        state.jobsLoading   = false;
        state.jobs          = action.payload.jobs ?? [];
        state.lastFetchTime = Date.now();
      })
      .addCase(fetchCronHealth.rejected, (state, action) => {
        state.jobsLoading = false;
        if (!action.payload?.aborted) {
          state.error =
            typeof action.payload === 'string'
              ? action.payload
              : action.payload?.message ?? 'Failed to fetch cron health';
        }
      });

    builder
      .addCase(triggerCronJob.pending, (state, action) => {
        const jobName = action.meta.arg;
        state.triggerLoading[jobName] = true;
        delete state.triggerResult[jobName];
        delete state.triggerError[jobName];
      })
      .addCase(triggerCronJob.fulfilled, (state, action) => {
        const { jobName, result } = action.payload;
        state.triggerLoading[jobName] = false;
        state.triggerResult[jobName]  = result;
      })
      .addCase(triggerCronJob.rejected, (state, action) => {
        const jobName = action.payload?.jobName ?? action.meta.arg;
        state.triggerLoading[jobName] = false;
        state.triggerError[jobName]   =
          action.payload?.message ?? 'Trigger failed';
      });
  },
});

export const { clearCronError, clearTriggerResult } = cronHealthSlice.actions;
export default cronHealthSlice.reducer;