import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// ============================================
// CONSTANTS
// ============================================

const BASE = '/api/v1/checkout/recovery-email';
const LIST = '/api/v1/analytics/checkout/abandoned-list';

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Fetch the abandoned checkouts list for the recovery email page.
 * Named fetchRecoveryEmailList (not fetchAbandonedCheckouts) to avoid
 * conflict with the identically-named thunk in operationsSlice.js.
 */
export const fetchRecoveryEmailList = createAsyncThunk(
  'recoveryEmail/fetchRecoveryEmailList',
  async (params = {}, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.get(LIST, { params, signal });
      return data;
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return rejectWithValue({ aborted: true });
      }
      return rejectWithValue(
        err.response?.data?.message || err.message || 'Failed to fetch abandoned checkouts'
      );
    }
  }
);

// In recoveryEmailSlice.js

export const sendSingleEmail = createAsyncThunk(
  'recoveryEmail/sendSingleEmail',
  async (checkoutId, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/checkout/recovery-email/${checkoutId}/send`
      );
      return { checkoutId, ...data };
    } catch (err) {
      const responseData = err.response?.data;

      if (err.response?.status === 400 && responseData?.skipped) {
        return rejectWithValue({
          checkoutId,          // ← always include checkoutId
          skipped: true,
          reason: responseData.reason || 'Send not allowed at this time',
        });
      }

      // Always return checkoutId so the rejected reducer can find the row
      return rejectWithValue({
        checkoutId,            // ← always include checkoutId
        skipped: false,
        error:
          responseData?.error ||
          responseData?.message ||
          err.message ||
          'Failed to send recovery email',
      });
    }
  }
);

/**
 * Send bulk recovery emails.
 * Always resolves — the API returns 200 even with partial failures.
 */
export const sendBulkEmails = createAsyncThunk(
  'recoveryEmail/sendBulkEmails',
  async (checkoutIds, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${BASE}/bulk-send`, { checkoutIds });
      return { ...data, requestedIds: checkoutIds };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || err.message || 'Bulk send request failed'
      );
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
  // ── Abandoned checkouts list ───────────────────────────────────────────
  checkouts:  [],
  pagination: {
    currentPage:    1,
    totalPages:     1,
    totalCheckouts: 0,
    hasNextPage:    false,
    hasPrevPage:    false,
  },
  listSummary: {
    totalValue:            0,
    avgValue:              0,
    highPriorityCheckouts: 0,
    reAbandonedCount:      0,
  },

  listStatus: 'idle',   // 'idle' | 'loading' | 'succeeded' | 'failed'
  listError:  null,

  // ── Active filters / pagination params ────────────────────────────────
  filters: {
    hours:       720,        // 30 days default — wider net for email recovery
    minValue:    0,
    limit:       50,
    page:        1,
    sortBy:      'priority',
    emailSent:   undefined,  // undefined = all, 'true' = sent, 'false' = unsent
    recovered:   undefined,
    reAbandoned: undefined,
  },

  // ── Per-checkout send state ────────────────────────────────────────────
  // Keyed by checkoutId string.
  // { status: 'idle'|'sending'|'sent'|'skipped'|'failed',
  //   emailCount, sentAt, attempt, messageId, reason, error }
  sendStates: {},

  // ── Bulk send ─────────────────────────────────────────────────────────
  bulkStatus:  'idle',  // 'idle' | 'sending' | 'succeeded' | 'failed'
  bulkResults: null,    // { sent[], skipped[], failed[], summary }
  bulkError:   null,
  bulkMessage: null,

  // ── Row selection for bulk send ────────────────────────────────────────
  selectedIds: [],
};

// ============================================
// SLICE
// ============================================

const recoveryEmailSlice = createSlice({
  name: 'recoveryEmail',
  initialState,

  reducers: {
    // ── Filters ──────────────────────────────────────────────────────────

    setFilters(state, action) {
      const incoming   = action.payload;
      const pageOnly   = Object.keys(incoming).length === 1 && 'page' in incoming;
      state.filters    = {
        ...state.filters,
        ...incoming,
        page: pageOnly ? incoming.page : 1,
      };
    },

    resetFilters(state) {
      state.filters     = initialState.filters;
      state.selectedIds = [];
    },

    // ── Row selection ─────────────────────────────────────────────────────

    toggleSelectId(state, action) {
      const id  = action.payload;
      const idx = state.selectedIds.indexOf(id);
      if (idx === -1) {
        state.selectedIds.push(id);
      } else {
        state.selectedIds.splice(idx, 1);
      }
    },

    selectAllIds(state) {
      state.selectedIds = state.checkouts
        .filter(c => !c.conversion?.isConverted && !c.abandonment?.recovered)
        .map(c => c._id);
    },

    clearSelection(state) {
      state.selectedIds = [];
    },

    // ── Bulk send UI ──────────────────────────────────────────────────────

    resetBulkState(state) {
      state.bulkStatus  = 'idle';
      state.bulkResults = null;
      state.bulkError   = null;
      state.bulkMessage = null;
    },

    // ── Per-row retry support ─────────────────────────────────────────────

    resetSendState(state, action) {
      const id = action.payload;
      if (state.sendStates[id]) {
        state.sendStates[id] = { status: 'idle' };
      }
    },

    clearAllSendStates(state) {
      state.sendStates = {};
    },
  },

  extraReducers: (builder) => {

    // ── fetchRecoveryEmailList ────────────────────────────────────────────

    builder
      .addCase(fetchRecoveryEmailList.pending, (state) => {
        state.listStatus = 'loading';
        state.listError  = null;
      })
      .addCase(fetchRecoveryEmailList.fulfilled, (state, action) => {
        state.listStatus  = 'succeeded';
        state.checkouts   = action.payload.abandonedCheckouts || [];
        state.pagination  = action.payload.pagination         || initialState.pagination;
        state.listSummary = action.payload.summary            || initialState.listSummary;
      })
      .addCase(fetchRecoveryEmailList.rejected, (state, action) => {
        if (action.payload?.aborted) return;
        state.listStatus = 'failed';
        state.listError  = action.payload || 'Unknown error';
      });

    // ── sendSingleEmail ───────────────────────────────────────────────────

    builder
      .addCase(sendSingleEmail.pending, (state, action) => {
        const id = action.meta.arg;
        state.sendStates[id] = { status: 'sending' };
      })
      .addCase(sendSingleEmail.fulfilled, (state, action) => {
        const { checkoutId, emailCount, sentAt, attempt, messageId } = action.payload;

        state.sendStates[checkoutId] = {
          status: 'sent',
          emailCount,
          sentAt,
          attempt,
          messageId,
        };

        // Patch the list item so the row is immediately accurate — no refetch needed
        const checkout = state.checkouts.find(c => c._id === checkoutId);
        if (checkout) {
          if (!checkout.abandonment) checkout.abandonment = {};
          checkout.abandonment.recoveryEmailSent   = true;
          checkout.abandonment.recoveryEmailCount  = emailCount;
          checkout.abandonment.recoveryEmailSentAt = sentAt;
        }
      })
      .addCase(sendSingleEmail.rejected, (state, action) => {
        const checkoutId = action.payload?.checkoutId ?? action.meta.arg;

        if (!checkoutId) return;

        const payload = action.payload;

        if (!payload) {
          state.sendStates[checkoutId] = {
            status: 'failed',
            error: action.error?.message || 'Request failed',
          };
          return;
        }

        state.sendStates[checkoutId] = payload.skipped
          ? { status: 'skipped', reason: payload.reason }
          : { status: 'failed', error: payload.error || 'Unknown error' };
      });

    // ── sendBulkEmails ────────────────────────────────────────────────────

    builder
      .addCase(sendBulkEmails.pending, (state) => {
        state.bulkStatus  = 'sending';
        state.bulkError   = null;
        state.bulkResults = null;
        state.bulkMessage = null;

        for (const id of state.selectedIds) {
          state.sendStates[id] = { status: 'sending' };
        }
      })
      .addCase(sendBulkEmails.fulfilled, (state, action) => {
        const { results, summary, message, requestedIds } = action.payload;

        state.bulkStatus  = 'succeeded';
        state.bulkResults = { ...results, summary };
        state.bulkMessage = message;
        state.selectedIds = [];

        for (const item of (results?.sent || [])) {
          state.sendStates[item.id] = {
            status:     'sent',
            emailCount: item.emailCount,
            sentAt:     item.sentAt,
            attempt:    item.attempt,
            messageId:  item.messageId,
          };
          const checkout = state.checkouts.find(c => c._id === item.id);
          if (checkout) {
            if (!checkout.abandonment) checkout.abandonment = {};
            checkout.abandonment.recoveryEmailSent   = true;
            checkout.abandonment.recoveryEmailCount  = item.emailCount;
            checkout.abandonment.recoveryEmailSentAt = item.sentAt;
          }
        }

        for (const item of (results?.skipped || [])) {
          state.sendStates[item.id] = { status: 'skipped', reason: item.reason };
        }

        for (const item of (results?.failed || [])) {
          state.sendStates[item.id] = { status: 'failed', error: item.error };
        }

        // Guard: any requested ID missing from all result buckets
        const accounted = new Set([
          ...(results?.sent    || []).map(i => i.id),
          ...(results?.skipped || []).map(i => i.id),
          ...(results?.failed  || []).map(i => i.id),
        ]);
        for (const id of (requestedIds || [])) {
          if (!accounted.has(id)) {
            state.sendStates[id] = { status: 'failed', error: 'No result returned from server' };
          }
        }
      })
      .addCase(sendBulkEmails.rejected, (state, action) => {
        state.bulkStatus = 'failed';
        state.bulkError  = action.payload || 'Bulk send request failed';

        // Clear stuck 'sending' rows back to idle so admin can retry
        for (const id of state.selectedIds) {
          if (state.sendStates[id]?.status === 'sending') {
            state.sendStates[id] = { status: 'idle' };
          }
        }
      });
  },
});

// ============================================
// ACTIONS
// ============================================

export const {
  setFilters,
  resetFilters,
  toggleSelectId,
  selectAllIds,
  clearSelection,
  resetBulkState,
  resetSendState,
  clearAllSendStates,
} = recoveryEmailSlice.actions;

// ============================================
// SELECTORS
// ============================================

export const selectRecoveryCheckouts   = (state) => state.recoveryEmail.checkouts;
export const selectRecoveryListStatus  = (state) => state.recoveryEmail.listStatus;
export const selectRecoveryListError   = (state) => state.recoveryEmail.listError;
export const selectRecoveryPagination  = (state) => state.recoveryEmail.pagination;
export const selectRecoveryListSummary = (state) => state.recoveryEmail.listSummary;
export const selectRecoveryFilters     = (state) => state.recoveryEmail.filters;
export const selectSelectedIds         = (state) => state.recoveryEmail.selectedIds;
export const selectBulkStatus          = (state) => state.recoveryEmail.bulkStatus;
export const selectBulkResults         = (state) => state.recoveryEmail.bulkResults;
export const selectBulkError           = (state) => state.recoveryEmail.bulkError;
export const selectBulkMessage         = (state) => state.recoveryEmail.bulkMessage;

export const selectSendState = (checkoutId) => (state) =>
  state.recoveryEmail.sendStates[checkoutId] || { status: 'idle' };

export const selectAnySending = (state) => {
  const singleSending = Object.values(state.recoveryEmail.sendStates)
    .some(s => s.status === 'sending');
  return singleSending || state.recoveryEmail.bulkStatus === 'sending';
};

export const selectEligibleSelectedCount = (state) => {
  const { selectedIds, sendStates, checkouts } = state.recoveryEmail;
  return selectedIds.filter(id => {
    if (sendStates[id]?.status === 'sending') return false;
    const checkout = checkouts.find(c => c._id === id);
    if (!checkout) return false;
    if (checkout.conversion?.isConverted)   return false;
    if (checkout.abandonment?.recovered)    return false;
    return true;
  }).length;
};

export default recoveryEmailSlice.reducer;