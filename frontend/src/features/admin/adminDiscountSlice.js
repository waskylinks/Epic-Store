import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// Builds a query string, dropping undefined/null/"" values
const toQueryString = (obj = {}) => {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== "") params.append(key, val);
  });
  const str = params.toString();
  return str ? `?${str}` : "";
};

// Fields stripped before PUT /api/v1/discounts/:id.
// Backend allowedUpdates: description, status, validFrom, validUntil, usageLimit, conditions, notes
const UPDATE_STRIP_KEYS = new Set([
  "code", "type", "value", "category", "audience",
  "createdBy", "usageHistory", "usageHistoryTotal", "usageHistoryCapped",
  "relatedOrder", "relatedReturn", "lockedAt", "deletionEligibleAt",
  "createdAt", "updatedAt", "_id", "__v",
  "id", "isValid", "isExpired", "remainingUses", "isProtected",
]);

// ─── THUNKS ──────────────────────────────────────────────────────────────────

export const getAllDiscounts = createAsyncThunk(
  "adminDiscount/getAllDiscounts",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts${toQueryString(filters)}`,
        { withCredentials: true }
      );
      return { ...data, _isCursorPage: !!filters?.cursor };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch discounts");
    }
  }
);

export const getSingleDiscount = createAsyncThunk(
  "adminDiscount/getSingleDiscount",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/discounts/${id}`, { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch discount details");
    }
  }
);

export const createDiscount = createAsyncThunk(
  "adminDiscount/createDiscount",
  async (discountData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/discounts", discountData, { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to create discount");
    }
  }
);

export const updateDiscount = createAsyncThunk(
  "adminDiscount/updateDiscount",
  async ({ id, discountData }, { rejectWithValue }) => {
    try {
      const mutableFields = Object.fromEntries(
        Object.entries(discountData).filter(([k]) => !UPDATE_STRIP_KEYS.has(k))
      );
      const { data } = await axios.put(`/api/v1/discounts/${id}`, mutableFields, { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to update discount");
    }
  }
);

// FIX: Backend sends 403 via HandleError which only includes `message`.
// `deletionEligibleAt` is NOT in the error body — removed false read.
// FIX: `alreadyInactive` flag now checked in reducer before mutating state.
export const deleteDiscount = createAsyncThunk(
  "adminDiscount/deleteDiscount",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/discounts/${id}`, { withCredentials: true });
      return {
        id,
        message:         data.message,
        alreadyInactive: data.message === "Discount was already inactive",
      };
    } catch (err) {
      // 403: fraud protection window — message only, no deletionEligibleAt in body
      return rejectWithValue({
        message: err.response?.data?.message ?? "Failed to deactivate discount",
        status:  err.response?.status,
      });
    }
  }
);

// FIX: Backend returns 409 as res.status(409).json(...) — NOT an axios error.
// Axios resolves 2xx/non-throw status. 409 is a non-2xx so axios DOES throw.
// But backend uses res.status(409).json() which axios treats as an error (>=400).
// rejectWithValue mapping is correct. No change needed in thunk.
// FIX: existingDiscountId field name confirmed matching backend response.
export const createCompensationDiscount = createAsyncThunk(
  "adminDiscount/createCompensationDiscount",
  async (compensationData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/discounts/create-compensation",
        compensationData,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue({
        message:            err.response?.data?.message ?? "Failed to create compensation discount",
        status:             err.response?.status,
        existingCode:       err.response?.data?.existingCode       ?? null,
        existingDiscountId: err.response?.data?.existingDiscountId ?? null,
      });
    }
  }
);

export const createDiscountForUsers = createAsyncThunk(
  "adminDiscount/createDiscountForUsers",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/discounts/create-for-user",
        payload,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to create VIP discount");
    }
  }
);

export const getDiscountStats = createAsyncThunk(
  "adminDiscount/getDiscountStats",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/stats", { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch stats");
    }
  }
);

// FIX: daysOld is a meaningful param — callers should pass { daysOld: N }.
// Forwarded as-is to backend. Default of 90 applied server-side if omitted.
export const triggerCleanup = createAsyncThunk(
  "adminDiscount/triggerCleanup",
  async (payload = {}, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/discounts/cleanup", payload, { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to run cleanup");
    }
  }
);

// FIX: cursor flag now carried inside return value, not read from meta.arg in reducer.
export const getAuditLog = createAsyncThunk(
  "adminDiscount/getAuditLog",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts/audit${toQueryString(filters)}`,
        { withCredentials: true }
      );
      return { ...data, _isCursorPage: !!filters?.cursor };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch audit log");
    }
  }
);

export const getDiscountAuditLog = createAsyncThunk(
  "adminDiscount/getDiscountAuditLog",
  async (discountId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts/audit/${discountId}`,
        { withCredentials: true }
      );
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch discount audit trail");
    }
  }
);

export const getPurgeLog = createAsyncThunk(
  "adminDiscount/getPurgeLog",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/audit/purge-log", { withCredentials: true });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message ?? "Failed to fetch purge log");
    }
  }
);

// ─── INITIAL STATE ────────────────────────────────────────────────────────────

const initialState = {
  discounts:  [],
  pagination: null,

  currentDiscount: null,
  // FIX: store usageHistoryTotal and usageHistoryCapped from getDiscountById
  // so UI can show "displaying last 100 of N" when history is capped.
  usageHistoryTotal:  null,
  usageHistoryCapped: false,

  stats:          null,
  categoryStats:  [],
  statsFromCache: false,

  cleanupResult: null,

  auditLogs:       [],
  auditPagination: null,

  discountAuditLogs: [],

  purgeLog:    [],
  latestPurge: null,
  showBanner:  false,

  discountsLoading:     false,
  detailLoading:        false,
  statsLoading:         false,
  auditLoading:         false,
  discountAuditLoading: false,
  purgeLogLoading:      false,
  actionLoading:        false,

  vipLoading:             false,
  vipError:               null,
  vipSuccess:             false,
  lastCreatedVipDiscount: null,
  lastVipEligibleCount:   null,

  error:   null,
  success: false,
  message: null,

  // FIX: deletionEligibleAt removed — backend 403 does not send this field.
  // Only message is available from HandleError responses.
  deleteProtectionError: null,
  compensationConflict:  null,
};

// ─── SLICE ────────────────────────────────────────────────────────────────────

const adminDiscountSlice = createSlice({
  name: "adminDiscount",
  initialState,

  reducers: {
    clearAdminDiscountState: (state) => {
      state.error                 = null;
      state.success               = false;
      state.message               = null;
      state.deleteProtectionError = null;
      state.compensationConflict  = null;
    },

    clearCurrentDiscount: (state) => {
      state.currentDiscount      = null;
      state.usageHistoryTotal    = null;
      state.usageHistoryCapped   = false;
    },

    clearCleanupResult:         (state) => { state.cleanupResult        = null;  },
    clearDeleteProtectionError: (state) => { state.deleteProtectionError = null; },
    clearDiscountAuditLogs:     (state) => { state.discountAuditLogs    = [];    },
    dismissPurgeBanner:         (state) => { state.showBanner           = false; },
    clearCompensationConflict:  (state) => { state.compensationConflict = null;  },

    clearVipState: (state) => {
      state.vipLoading             = false;
      state.vipError               = null;
      state.vipSuccess             = false;
      state.lastCreatedVipDiscount = null;
      state.lastVipEligibleCount   = null;
    },

    // FIX: reset pagination when called with a non-cursor (fresh filter) fetch
    // to avoid stale nextCursor surviving into a new filter session.
    resetDiscountList: (state) => {
      state.discounts  = [];
      state.pagination = null;
    },

    // Sole writer for page 2+ discount list pages. Deduplicates by _id.
    appendDiscounts: (state, action) => {
      const existingIds = new Set(state.discounts.map((d) => d._id));
      const fresh       = (action.payload?.discounts ?? []).filter((d) => !existingIds.has(d._id));
      state.discounts   = [...state.discounts, ...fresh];
      state.pagination  = action.payload?.pagination ?? state.pagination;
    },

    // Sole writer for page 2+ audit log pages. Deduplicates by _id.
    appendAuditLogs: (state, action) => {
      const existingIds     = new Set(state.auditLogs.map((l) => l._id));
      const fresh           = (action.payload?.auditLogs ?? []).filter((l) => !existingIds.has(l._id));
      state.auditLogs       = [...state.auditLogs, ...fresh];
      state.auditPagination = action.payload?.pagination ?? state.auditPagination;
    },
  },

  extraReducers: (builder) => {

    // getAllDiscounts
    // FIX: cursor flag now read from payload._isCursorPage instead of meta.arg.cursor
    // FIX: auditPagination reset when fresh (non-cursor) fetch arrives — clears stale nextCursor
    builder
      .addCase(getAllDiscounts.pending, (state) => {
        state.discountsLoading = true;
        state.error            = null;
      })
      .addCase(getAllDiscounts.fulfilled, (state, action) => {
        state.discountsLoading = false;
        if (!action.payload._isCursorPage) {
          state.discounts  = action.payload.discounts  ?? [];
          state.pagination = action.payload.pagination ?? null;
        }
      })
      .addCase(getAllDiscounts.rejected, (state, action) => {
        state.discountsLoading = false;
        state.error            = action.payload;
      });

    builder
      .addCase(getSingleDiscount.pending, (state) => {
        state.detailLoading    = true;
        state.error            = null;
        state.usageHistoryTotal  = null;
        state.usageHistoryCapped = false;
      })
      .addCase(getSingleDiscount.fulfilled, (state, action) => {
        state.detailLoading      = false;
        state.currentDiscount    = action.payload.discount ?? null;
        // FIX: capture capped usage history metadata from backend
        state.usageHistoryTotal  = action.payload.discount?.usageHistoryTotal  ?? null;
        state.usageHistoryCapped = action.payload.discount?.usageHistoryCapped ?? false;
      })
      .addCase(getSingleDiscount.rejected, (state, action) => {
        state.detailLoading = false;
        state.error         = action.payload;
      });

    builder
      .addCase(createDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(createDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        if (action.payload.discount) state.discounts.unshift(action.payload.discount);
        // FIX: stats are now stale — null forces re-fetch on next stats mount
        state.stats         = null;
        state.categoryStats = [];
      })
      .addCase(createDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    builder
      .addCase(updateDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(updateDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        const updated = action.payload.discount;
        if (!updated) return;
        const idx = state.discounts.findIndex((d) => d._id === updated._id);
        if (idx !== -1) {
          // FIX: replace entirely rather than shallow-merge to preserve nested fields
          state.discounts[idx] = updated;
        }
        if (state.currentDiscount?._id === updated._id) {
          // FIX: replace entirely — shallow merge drops populated sub-documents
          state.currentDiscount = updated;
        }
      })
      .addCase(updateDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    builder
      .addCase(deleteDiscount.pending, (state) => {
        state.actionLoading        = true;
        state.error                = null;
        state.deleteProtectionError = null;
      })
      .addCase(deleteDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        // FIX: only mutate local status if something actually changed
        if (!action.payload.alreadyInactive) {
          const idx = state.discounts.findIndex((d) => d._id === action.payload.id);
          if (idx !== -1) state.discounts[idx] = { ...state.discounts[idx], status: "inactive" };
          if (state.currentDiscount?._id === action.payload.id) {
            state.currentDiscount = { ...state.currentDiscount, status: "inactive" };
          }
          // FIX: stats stale after real deactivation
          state.stats         = null;
          state.categoryStats = [];
        }
      })
      .addCase(deleteDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        if (action.payload?.status === 403) {
          // FIX: deletionEligibleAt removed — not present in backend 403 body
          state.deleteProtectionError = {
            message: action.payload.message,
          };
        } else {
          state.error = action.payload?.message ?? action.payload;
        }
      });

    builder
      .addCase(createCompensationDiscount.pending, (state) => {
        state.actionLoading        = true;
        state.error                = null;
        state.compensationConflict = null;
      })
      .addCase(createCompensationDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        if (action.payload.discount) state.discounts.unshift(action.payload.discount);
        // FIX: stats stale after new discount creation
        state.stats         = null;
        state.categoryStats = [];
      })
      .addCase(createCompensationDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        if (action.payload?.status === 409) {
          state.compensationConflict = {
            message:            action.payload.message,
            existingCode:       action.payload.existingCode,
            existingDiscountId: action.payload.existingDiscountId,
          };
        } else {
          state.error = action.payload?.message ?? action.payload;
        }
      });

    builder
      .addCase(createDiscountForUsers.pending, (state) => {
        state.vipLoading             = true;
        state.vipError               = null;
        state.vipSuccess             = false;
        state.lastCreatedVipDiscount = null;
        state.lastVipEligibleCount   = null;
      })
      .addCase(createDiscountForUsers.fulfilled, (state, action) => {
        state.vipLoading             = false;
        state.vipSuccess             = true;
        state.lastCreatedVipDiscount = action.payload.discount          ?? null;
        state.lastVipEligibleCount   = action.payload.eligibleUserCount ?? null;
        if (action.payload.discount) state.discounts.unshift(action.payload.discount);
        // FIX: stats stale after new VIP discount creation
        state.stats         = null;
        state.categoryStats = [];
      })
      .addCase(createDiscountForUsers.rejected, (state, action) => {
        state.vipLoading = false;
        state.vipError   = action.payload;
      });

    builder
      .addCase(getDiscountStats.pending, (state) => {
        state.statsLoading = true;
        state.error        = null;
      })
      .addCase(getDiscountStats.fulfilled, (state, action) => {
        state.statsLoading   = false;
        state.stats          = action.payload.overall   ?? null;
        state.categoryStats  = action.payload.stats     ?? [];
        state.statsFromCache = action.payload.fromCache === true;
      })
      .addCase(getDiscountStats.rejected, (state, action) => {
        state.statsLoading = false;
        state.error        = action.payload;
      });

    builder
      .addCase(triggerCleanup.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(triggerCleanup.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        state.cleanupResult = {
          expired: action.payload.expired ?? 0,
          deleted: action.payload.deleted ?? 0,
        };
        // FIX: cleanup hard-deletes expired discounts and bulk-expires actives —
        // both the discount list and stats are now stale
        state.discounts     = [];
        state.pagination    = null;
        state.stats         = null;
        state.categoryStats = [];
      })
      .addCase(triggerCleanup.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // getAuditLog
    // FIX: cursor flag read from payload._isCursorPage
    // FIX: auditPagination reset on fresh fetch to clear stale nextCursor
    builder
      .addCase(getAuditLog.pending, (state) => {
        state.auditLoading = true;
        state.error        = null;
      })
      .addCase(getAuditLog.fulfilled, (state, action) => {
        state.auditLoading = false;
        if (!action.payload._isCursorPage) {
          state.auditLogs       = action.payload.auditLogs  ?? [];
          state.auditPagination = action.payload.pagination ?? null;
        }
      })
      .addCase(getAuditLog.rejected, (state, action) => {
        state.auditLoading = false;
        state.error        = action.payload;
      });

    builder
      .addCase(getDiscountAuditLog.pending, (state) => {
        state.discountAuditLoading = true;
        state.error                = null;
      })
      .addCase(getDiscountAuditLog.fulfilled, (state, action) => {
        state.discountAuditLoading = false;
        state.discountAuditLogs    = action.payload.auditLogs ?? [];
      })
      .addCase(getDiscountAuditLog.rejected, (state, action) => {
        state.discountAuditLoading = false;
        state.error                = action.payload;
      });

    builder
      .addCase(getPurgeLog.pending, (state) => {
        state.purgeLogLoading = true;
        state.error           = null;
      })
      .addCase(getPurgeLog.fulfilled, (state, action) => {
        state.purgeLogLoading = false;
        state.purgeLog        = action.payload.purgeLog    ?? [];
        state.latestPurge     = action.payload.latestPurge ?? null;
        state.showBanner      = action.payload.showBanner  === true;
      })
      .addCase(getPurgeLog.rejected, (state, action) => {
        state.purgeLogLoading = false;
        state.error           = action.payload;
      });
  },
});

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

export const {
  clearAdminDiscountState,
  clearCurrentDiscount,
  clearCleanupResult,
  clearDeleteProtectionError,
  clearDiscountAuditLogs,
  dismissPurgeBanner,
  clearCompensationConflict,
  clearVipState,
  resetDiscountList,
  appendDiscounts,
  appendAuditLogs,
} = adminDiscountSlice.actions;

export default adminDiscountSlice.reducer;