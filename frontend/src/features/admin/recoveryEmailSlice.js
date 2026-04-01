import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

const API_BASE = '/api/v1';

// ============================================
// THUNK
// ============================================

export const dispatchRecoveryEmail = createAsyncThunk(
  'recoveryEmail/dispatch',
  async (checkoutId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/analytics/checkout/${checkoutId}/send-recovery-email`,
        {}
      );

      return {
        sentAt:            data.sentAt            ? String(data.sentAt)         : null,
        attemptNumber:     Number(data.attemptNumber   ?? 0),
        recipient:         data.recipient          ? String(data.recipient)      : null,
        nextAvailableAt:   data.nextAvailableAt    ? String(data.nextAvailableAt): null,
        canSendAnother:    Boolean(data.canSendAnother  ?? false),
        attemptsRemaining: Number(data.attemptsRemaining ?? 0),
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to send recovery email'
      );
    }
  }
);

// ============================================
// SLICE
// ============================================

const recoveryEmailSlice = createSlice({
  name: 'recoveryEmail',
  initialState: {
    loading: {},   // { [checkoutId]: boolean }
    results: {},   // { [checkoutId]: { sentAt, attemptNumber, nextAvailableAt, canSendAnother, attemptsRemaining, recipient } }
    errors:  {},   // { [checkoutId]: string }
  },
  reducers: {
    clearEmailResult: (state, action) => {
      const id = String(action.payload);
      delete state.loading[id];
      delete state.results[id];
      delete state.errors[id];
    },

    clearAllEmailResults: (state) => {
      state.loading = {};
      state.results = {};
      state.errors  = {};
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(dispatchRecoveryEmail.pending, (state, action) => {
        const id = String(action.meta.arg);
        state.loading[id] = true;
        delete state.errors[id];
      })

      .addCase(dispatchRecoveryEmail.fulfilled, (state, action) => {
        // Always key by meta.arg — guaranteed to match what pending set.
        const id = String(action.meta.arg);

        state.loading[id] = false;
        delete state.errors[id];

        const {
          sentAt,
          attemptNumber,
          recipient,
          nextAvailableAt,
          canSendAnother,
          attemptsRemaining,
        } = action.payload;

        state.results[id] = {
          sentAt,
          attemptNumber,
          recipient,
          nextAvailableAt,
          canSendAnother,
          attemptsRemaining,
        };
      })

      .addCase(dispatchRecoveryEmail.rejected, (state, action) => {
        // meta.arg is always present regardless of how rejection happened.
        const id = String(action.meta.arg);

        state.loading[id] = false;
        state.errors[id]  =
          action.payload ??
          action.error?.message ??
          'Unknown error';
      });
  },
});

export const { clearEmailResult, clearAllEmailResults } = recoveryEmailSlice.actions;

export default recoveryEmailSlice.reducer;