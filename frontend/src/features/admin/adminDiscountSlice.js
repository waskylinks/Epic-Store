// Frontend/src/features/discounts/adminDiscountSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ADMIN: GET ALL DISCOUNTS (cursor-based pagination)
// ============================================

/**
 * @route GET /api/v1/discounts?status&category&type&search&limit&cursor
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
      return rejectWithValue(
        error.response?.data?.message || "Failed to delete discount"
      );
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
 * Body: { daysOld?: number }   default 90
 * Returns: { success, expired, deleted }
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
// SLICE
// ============================================

const adminDiscountSlice = createSlice({
  name: "adminDiscount",
  initialState: {
    // List view
    discounts: [],
    pagination: null, // { limit, hasNextPage, nextCursor }

    // Detail view
    currentDiscount: null,

    // Stats
    stats: null,       // overall totals
    categoryStats: [], // per-category breakdown

    // Cleanup
    cleanupResult: null, // { expired, deleted }

    // Loading states — granular so UI can show targeted spinners
    discountsLoading: false,
    detailLoading: false,
    actionLoading: false, // create / update / delete / compensation / cleanup
    statsLoading: false,

    // Feedback
    error: null,
    success: false,
    message: null,
  },

  reducers: {
    clearAdminDiscountState: (state) => {
      state.error = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentDiscount: (state) => {
      state.currentDiscount = null;
    },
    clearCleanupResult: (state) => {
      state.cleanupResult = null;
    },
    // Append next page of discounts (cursor pagination "load more")
    appendDiscounts: (state, action) => {
      state.discounts = [...state.discounts, ...action.payload.discounts];
      state.pagination = action.payload.pagination;
    },
  },

  extraReducers: (builder) => {
    // ── GET ALL DISCOUNTS ──────────────────────────────────────────────
    builder
      .addCase(getAllDiscounts.pending, (state) => {
        state.discountsLoading = true;
        state.error = null;
      })
      .addCase(getAllDiscounts.fulfilled, (state, action) => {
        state.discountsLoading = false;
        state.discounts = action.payload.discounts;
        state.pagination = action.payload.pagination;
      })
      .addCase(getAllDiscounts.rejected, (state, action) => {
        state.discountsLoading = false;
        state.error = action.payload;
      });

    // ── GET SINGLE DISCOUNT ────────────────────────────────────────────
    builder
      .addCase(getSingleDiscount.pending, (state) => {
        state.detailLoading = true;
        state.error = null;
      })
      .addCase(getSingleDiscount.fulfilled, (state, action) => {
        state.detailLoading = false;
        state.currentDiscount = action.payload.discount;
      })
      .addCase(getSingleDiscount.rejected, (state, action) => {
        state.detailLoading = false;
        state.error = action.payload;
      });

    // ── CREATE DISCOUNT ────────────────────────────────────────────────
    builder
      .addCase(createDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(createDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success = true;
        state.message = action.payload.message;
        // Prepend so the new code appears at the top of the admin list
        state.discounts.unshift(action.payload.discount);
      })
      .addCase(createDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ── UPDATE DISCOUNT ────────────────────────────────────────────────
    builder
      .addCase(updateDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(updateDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success = true;
        state.message = action.payload.message;

        const updated = action.payload.discount;

        // Sync list row in-place
        const idx = state.discounts.findIndex((d) => d._id === updated._id);
        if (idx !== -1) state.discounts[idx] = updated;

        // Sync detail view if open
        if (state.currentDiscount?._id === updated._id) {
          state.currentDiscount = updated;
        }
      })
      .addCase(updateDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ── DELETE DISCOUNT (soft) ─────────────────────────────────────────
    builder
      .addCase(deleteDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(deleteDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success = true;
        state.message = action.payload.message;

        // Reflect soft-delete — keep row visible but mark inactive
        const idx = state.discounts.findIndex((d) => d._id === action.payload.id);
        if (idx !== -1) state.discounts[idx].status = "inactive";
      })
      .addCase(deleteDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ── CREATE COMPENSATION DISCOUNT ───────────────────────────────────
    builder
      .addCase(createCompensationDiscount.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(createCompensationDiscount.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success = true;
        state.message = action.payload.message;
        state.discounts.unshift(action.payload.discount);
      })
      .addCase(createCompensationDiscount.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ── GET DISCOUNT STATS ─────────────────────────────────────────────
    builder
      .addCase(getDiscountStats.pending, (state) => {
        state.statsLoading = true;
        state.error = null;
      })
      .addCase(getDiscountStats.fulfilled, (state, action) => {
        state.statsLoading = false;
        state.categoryStats = action.payload.stats;
        state.stats = action.payload.overall;
      })
      .addCase(getDiscountStats.rejected, (state, action) => {
        state.statsLoading = false;
        state.error = action.payload;
      });

    // ── TRIGGER CLEANUP ────────────────────────────────────────────────
    builder
      .addCase(triggerCleanup.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(triggerCleanup.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.success = true;
        state.message = action.payload.message;
        state.cleanupResult = {
          expired: action.payload.expired,
          deleted: action.payload.deleted,
        };
      })
      .addCase(triggerCleanup.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });
  },
});

export const {
  clearAdminDiscountState,
  clearCurrentDiscount,
  clearCleanupResult,
  appendDiscounts,
} = adminDiscountSlice.actions;

export default adminDiscountSlice.reducer;