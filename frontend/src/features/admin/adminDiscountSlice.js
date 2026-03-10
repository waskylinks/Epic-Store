// Frontend/src/features/admin/adminDiscountSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ADMIN: GET ALL DISCOUNTS (cursor-based pagination)
// ============================================

/**
 * @route GET /api/v1/discounts
 * @access Admin
 *
 * Pass filters + optional `cursor` from previous response to paginate.
 * On first load omit cursor. On "load more" pass pagination.nextCursor.
 */
export const getAllDiscounts = createAsyncThunk(
  "adminDiscount/getAllDiscounts",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/discounts${params ? `?${params}` : ""}`,
        { withCredentials: true }
      );
      return data; // { success, discounts, pagination: { limit, hasNextPage, nextCursor } }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch discounts"
      );
    }
  }
);

// ============================================
// ADMIN: GET SINGLE DISCOUNT
// ============================================

/**
 * @route GET /api/v1/discounts/:id
 * @access Admin
 */
export const getSingleDiscount = createAsyncThunk(
  "adminDiscount/getSingleDiscount",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/discounts/${id}`, {
        withCredentials: true,
      });
      return data; // { success, discount }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch discount details"
      );
    }
  }
);

// ============================================
// ADMIN: CREATE DISCOUNT
// ============================================

/**
 * @route POST /api/v1/discounts
 * @access Admin
 *
 * Body includes audience: 'all' | 'specific'
 * audience:'all'      — broadcast seasonal promo, no eligibleUsers required
 * audience:'specific' — personalised code, eligibleUsers enforced server-side
 */
export const createDiscount = createAsyncThunk(
  "adminDiscount/createDiscount",
  async (discountData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/discounts", discountData, {
        withCredentials: true,
      });
      return data; // { success, message, discount }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to create discount"
      );
    }
  }
);

// ============================================
// ADMIN: UPDATE DISCOUNT
// ============================================

/**
 * @route PUT /api/v1/discounts/:id
 * @access Admin
 *
 * Allowed fields: description, status, validFrom, validUntil,
 *                 usageLimit, conditions, notes
 * code, type, value, audience, category are immutable after creation.
 */
export const updateDiscount = createAsyncThunk(
  "adminDiscount/updateDiscount",
  async ({ id, discountData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(
        `/api/v1/discounts/${id}`,
        discountData,
        { withCredentials: true }
      );
      return data; // { success, message, discount }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update discount"
      );
    }
  }
);

// ============================================
// ADMIN: DELETE DISCOUNT (soft delete → status: inactive)
//
// Server returns 403 if the discount is within its 30-day
// fraud-protection window (currentUses >= 1 AND deletionEligibleAt > now).
// The 403 payload includes deletionEligibleAt so the UI can display
// exactly when the action will become available.
// Blocked attempts are still logged server-side to DiscountAuditLog.
// ============================================

/**
 * @route DELETE /api/v1/discounts/:id
 * @access Admin
 */
export const deleteDiscount = createAsyncThunk(
  "adminDiscount/deleteDiscount",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(`/api/v1/discounts/${id}`, {
        withCredentials: true,
      });
      return { id, message: data.message };
    } catch (error) {
      // Preserve full error response so the UI can extract
      // deletionEligibleAt from a 403 and show the unlock date.
      return rejectWithValue({
        message:            error.response?.data?.message || "Failed to deactivate discount",
        status:             error.response?.status,
        deletionEligibleAt: error.response?.data?.deletionEligibleAt ?? null,
      });
    }
  }
);

// ============================================
// ADMIN: CREATE COMPENSATION DISCOUNT (refund / return)
// ============================================

/**
 * @route POST /api/v1/discounts/create-compensation
 * @access Admin
 *
 * Body: { userId, amount, reason, category, validDays,
 *         relatedOrder?, relatedReturn? }
 * Always creates audience:'specific' discounts scoped to the customer.
 */
export const createCompensationDiscount = createAsyncThunk(
  "adminDiscount/createCompensationDiscount",
  async (compensationData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/discounts/create-compensation",
        compensationData,
        { withCredentials: true }
      );
      return data; // { success, message, discount }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to create compensation discount"
      );
    }
  }
);

// ============================================
// ADMIN: GET DISCOUNT STATS
// ============================================

/**
 * @route GET /api/v1/discounts/stats
 * @access Admin
 */
export const getDiscountStats = createAsyncThunk(
  "adminDiscount/getDiscountStats",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/stats", {
        withCredentials: true,
      });
      return data; // { success, stats (by category), overall }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch discount stats"
      );
    }
  }
);

// ============================================
// ADMIN: TRIGGER CLEANUP (manual on-demand)
// ============================================

/**
 * @route POST /api/v1/discounts/cleanup
 * @access Admin
 *
 * Body: { daysOld?: number }  default 90
 * Returns: { success, expired, deleted }
 *
 * Note: deleteOldExpired() on the server automatically excludes
 * discounts within their fraud-protection window (deletionEligibleAt > now).
 */
export const triggerCleanup = createAsyncThunk(
  "adminDiscount/triggerCleanup",
  async (payload = {}, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/discounts/cleanup",
        payload,
        { withCredentials: true }
      );
      return data; // { success, message, expired, deleted }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to run cleanup"
      );
    }
  }
);

// ============================================
// ADMIN: GET FULL AUDIT LOG (paginated)
// ============================================

/**
 * @route GET /api/v1/discounts/audit
 * @access Admin
 *
 * Query params:
 *   action, discountCode, performedById — filters
 *   dateFrom, dateTo                    — date range
 *   limit                               — page size (default 20, max 100)
 *   cursor                              — pagination token from previous response
 *
 * All actions including CRON system entries are returned.
 * System entries have performedBy.system === true.
 *
 * First page: dispatch getAuditLog({ ...filters })
 * Next pages:  dispatch getAuditLog({ ...filters, cursor: nextCursor })
 *              then use appendAuditLogs reducer to merge into state.
 */
export const getAuditLog = createAsyncThunk(
  "adminDiscount/getAuditLog",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/discounts/audit${params ? `?${params}` : ""}`,
        { withCredentials: true }
      );
      return data; // { success, auditLogs, pagination: { limit, hasNextPage, nextCursor } }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch audit log"
      );
    }
  }
);

// ============================================
// ADMIN: GET AUDIT LOG FOR SINGLE DISCOUNT
// Used by the detail drawer — fixed limit 20, no pagination.
// ============================================

/**
 * @route GET /api/v1/discounts/audit/:discountId
 * @access Admin
 */
export const getDiscountAuditLog = createAsyncThunk(
  "adminDiscount/getDiscountAuditLog",
  async (discountId, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts/audit/${discountId}`,
        { withCredentials: true }
      );
      return data; // { success, auditLogs }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch discount audit log"
      );
    }
  }
);

// ============================================
// ADMIN: GET PURGE LOG
//
// Returns all AuditPurgeLog receipts (permanent, append-only).
// Also returns showBanner — true when the latest purge occurred
// within the last 7 days, used to drive the receipt banner in the UI.
//
// No delete route exists for AuditPurgeLog — ever.
// ============================================

/**
 * @route GET /api/v1/discounts/audit/purge-log
 * @access Admin
 */
export const getPurgeLog = createAsyncThunk(
  "adminDiscount/getPurgeLog",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        "/api/v1/discounts/audit/purge-log",
        { withCredentials: true }
      );
      return data; // { success, purgeLog, latestPurge, showBanner }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch purge log"
      );
    }
  }
);

// ============================================
// SLICE
// ============================================

const adminDiscountSlice = createSlice({
  name: "adminDiscount",
  initialState: {
    // ── Discount list ────────────────────────────────────────────────────
    discounts:  [],
    pagination: null, // { limit, hasNextPage, nextCursor }

    // ── Detail view ──────────────────────────────────────────────────────
    currentDiscount: null,

    // ── Stats ────────────────────────────────────────────────────────────
    stats:         null, // overall { total, active, expired, totalUses }
    categoryStats: [],   // per-category array

    // ── Cleanup ──────────────────────────────────────────────────────────
    cleanupResult: null, // { expired, deleted }

    // ── Audit log — full paginated feed (Audit tab) ──────────────────────
    // First page load replaces this. "Load more" uses appendAuditLogs.
    auditLogs:       [],
    auditPagination: null, // { limit, hasNextPage, nextCursor }

    // ── Audit log — per-discount drawer (last 20, no pagination) ─────────
    // Loaded when detail drawer opens. Cleared when drawer closes.
    discountAuditLogs: [],

    // ── Purge log — permanent AuditPurgeLog receipts ─────────────────────
    purgeLog:       [],   // all receipts newest first
    latestPurge:    null, // most recent receipt
    showPurgeBanner: false, // true when latest purge was within last 7 days

    // ── Loading states ───────────────────────────────────────────────────
    discountsLoading:     false,
    detailLoading:        false,
    actionLoading:        false, // create / update / delete / compensation / cleanup
    statsLoading:         false,
    auditLoading:         false, // full audit tab
    discountAuditLoading: false, // per-discount drawer
    purgeLogLoading:      false,

    // ── Feedback ─────────────────────────────────────────────────────────
    error:   null,
    success: false,
    message: null,

    // ── Delete protection ─────────────────────────────────────────────────
    // Populated on 403 from deleteDiscount. Contains:
    //   { message: string, deletionEligibleAt: string | null }
    // Shown in the UI as the unlock date tooltip / modal, not the
    // general error banner. Cleared by clearDeleteProtectionError.
    deleteProtectionError: null,
  },

  reducers: {
    clearAdminDiscountState: (state) => {
      state.error   = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentDiscount: (state) => {
      state.currentDiscount = null;
    },
    clearCleanupResult: (state) => {
      state.cleanupResult = null;
    },
    // Clear the fraud-protection error after the UI has shown it
    clearDeleteProtectionError: (state) => {
      state.deleteProtectionError = null;
    },
    // Clear per-discount drawer audit entries when drawer closes
    clearDiscountAuditLogs: (state) => {
      state.discountAuditLogs = [];
    },
    // Dismiss the purge receipt banner — does not affect purgeLog data
    dismissPurgeBanner: (state) => {
      state.showPurgeBanner = false;
    },
    // Append next page of discounts (cursor pagination "load more")
    appendDiscounts: (state, action) => {
      state.discounts  = [...state.discounts, ...action.payload.discounts];
      state.pagination = action.payload.pagination;
    },
    // Append next page of audit logs (cursor pagination "load more")
    // Called from the component after a successful getAuditLog with cursor.
    appendAuditLogs: (state, action) => {
      state.auditLogs       = [...state.auditLogs, ...action.payload.auditLogs];
      state.auditPagination = action.payload.pagination;
    },
  },

  extraReducers: (builder) => {

    // ── GET ALL DISCOUNTS ────────────────────────────────────────────────
    builder
      .addCase(getAllDiscounts.pending, (state) => {
        state.discountsLoading = true;
        state.error            = null;
      })
      .addCase(getAllDiscounts.fulfilled, (state, action) => {
        state.discountsLoading = false;
        state.discounts        = action.payload.discounts;
        state.pagination       = action.payload.pagination;
      })
      .addCase(getAllDiscounts.rejected, (state, action) => {
        state.discountsLoading = false;
        state.error            = action.payload;
      });

    // ── GET SINGLE DISCOUNT ──────────────────────────────────────────────
    builder
      .addCase(getSingleDiscount.pending, (state) => {
        state.detailLoading  = true;
        state.error          = null;
      })
      .addCase(getSingleDiscount.fulfilled, (state, action) => {
        state.detailLoading   = false;
        state.currentDiscount = action.payload.discount;
      })
      .addCase(getSingleDiscount.rejected, (state, action) => {
        state.detailLoading = false;
        state.error         = action.payload;
      });

    // ── CREATE DISCOUNT ──────────────────────────────────────────────────
    builder
      .addCase(createDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(createDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        // Prepend so the new code appears at the top of the admin list
        state.discounts.unshift(action.payload.discount);
      })
      .addCase(createDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ── UPDATE DISCOUNT ──────────────────────────────────────────────────
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

        // Sync list row in-place — no refetch needed
        const idx = state.discounts.findIndex((d) => d._id === updated._id);
        if (idx !== -1) state.discounts[idx] = updated;

        // Sync detail view if the drawer is open for this discount
        if (state.currentDiscount?._id === updated._id) {
          state.currentDiscount = updated;
        }
      })
      .addCase(updateDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ── DELETE DISCOUNT (soft) ───────────────────────────────────────────
    builder
      .addCase(deleteDiscount.pending, (state) => {
        state.actionLoading         = true;
        state.error                 = null;
        state.deleteProtectionError = null;
      })
      .addCase(deleteDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;

        // Reflect soft-delete — keep the row but flip status to inactive
        const idx = state.discounts.findIndex(
          (d) => d._id === action.payload.id
        );
        if (idx !== -1) state.discounts[idx].status = "inactive";
      })
      .addCase(deleteDiscount.rejected, (state, action) => {
        state.actionLoading = false;

        if (action.payload?.status === 403) {
          // Fraud-protection window — surface unlock date, not a generic error
          state.deleteProtectionError = {
            message:            action.payload.message,
            deletionEligibleAt: action.payload.deletionEligibleAt,
          };
        } else {
          state.error = action.payload?.message || action.payload;
        }
      });

    // ── CREATE COMPENSATION DISCOUNT ─────────────────────────────────────
    builder
      .addCase(createCompensationDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(createCompensationDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success       = true;
        state.message       = action.payload.message;
        state.discounts.unshift(action.payload.discount);
      })
      .addCase(createCompensationDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ── GET DISCOUNT STATS ───────────────────────────────────────────────
    builder
      .addCase(getDiscountStats.pending, (state) => {
        state.statsLoading = true;
        state.error        = null;
      })
      .addCase(getDiscountStats.fulfilled, (state, action) => {
        state.statsLoading  = false;
        state.categoryStats = action.payload.stats;
        state.stats         = action.payload.overall;
      })
      .addCase(getDiscountStats.rejected, (state, action) => {
        state.statsLoading = false;
        state.error        = action.payload;
      });

    // ── TRIGGER CLEANUP ──────────────────────────────────────────────────
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
          expired: action.payload.expired,
          deleted: action.payload.deleted,
        };
      })
      .addCase(triggerCleanup.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ── GET FULL AUDIT LOG ───────────────────────────────────────────────
    // First page replaces auditLogs entirely.
    // Subsequent pages: component calls getAuditLog with cursor,
    // then dispatches appendAuditLogs with the result payload.
    builder
      .addCase(getAuditLog.pending, (state) => {
        state.auditLoading = true;
        state.error        = null;
      })
      .addCase(getAuditLog.fulfilled, (state, action) => {
        state.auditLoading    = false;
        state.auditLogs       = action.payload.auditLogs;
        state.auditPagination = action.payload.pagination;
      })
      .addCase(getAuditLog.rejected, (state, action) => {
        state.auditLoading = false;
        state.error        = action.payload;
      });

    // ── GET DISCOUNT AUDIT LOG (drawer) ──────────────────────────────────
    builder
      .addCase(getDiscountAuditLog.pending, (state) => {
        state.discountAuditLoading = true;
        state.error                = null;
      })
      .addCase(getDiscountAuditLog.fulfilled, (state, action) => {
        state.discountAuditLoading = false;
        state.discountAuditLogs    = action.payload.auditLogs;
      })
      .addCase(getDiscountAuditLog.rejected, (state, action) => {
        state.discountAuditLoading = false;
        state.error                = action.payload;
      });

    // ── GET PURGE LOG ────────────────────────────────────────────────────
    builder
      .addCase(getPurgeLog.pending, (state) => {
        state.purgeLogLoading = true;
        state.error           = null;
      })
      .addCase(getPurgeLog.fulfilled, (state, action) => {
        state.purgeLogLoading = false;
        state.purgeLog        = action.payload.purgeLog;
        state.latestPurge     = action.payload.latestPurge;
        state.showPurgeBanner = action.payload.showBanner;
      })
      .addCase(getPurgeLog.rejected, (state, action) => {
        state.purgeLogLoading = false;
        state.error           = action.payload;
      });
  },
});

export const {
  clearAdminDiscountState,
  clearCurrentDiscount,
  clearCleanupResult,
  clearDeleteProtectionError,
  clearDiscountAuditLogs,
  dismissPurgeBanner,
  appendDiscounts,
  appendAuditLogs,
} = adminDiscountSlice.actions;

export default adminDiscountSlice.reducer;