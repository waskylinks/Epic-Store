// Frontend/src/features/discounts/userDiscountSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE (cart flow)
// ============================================

/**
 * @route POST /api/v1/discounts/validate
 * @access Public (auth optional — logged-in users get per-user checks)
 *
 * Body: { code, cartTotal, items? }
 * Returns: { success, valid, discount: { code, type, value, discountAmount, description } }
 */
export const validateDiscountCode = createAsyncThunk(
  "userDiscount/validateDiscountCode",
  async ({ code, cartTotal, items = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/discounts/validate", {
        code,
        cartTotal,
        items,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to validate discount code"
      );
    }
  }
);

// ============================================
// PUBLIC: GET ACTIVE PROMOS
// ============================================

/**
 * @route GET /api/v1/discounts/promos
 * @access Public
 *
 * Returns publicly visible, non-user-restricted active promo codes.
 */
export const getActivePromos = createAsyncThunk(
  "userDiscount/getActivePromos",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/promos");
      return data; // { success, promos }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch active promos"
      );
    }
  }
);

// ============================================
// USER: GET MY DISCOUNTS (personalised / compensation codes)
// ============================================

/**
 * @route GET /api/v1/discounts/my-discounts
 * @access Private (authenticated user)
 *
 * Returns active discounts where conditions.eligibleUsers includes
 * the currently logged-in user (e.g. refund / return compensation codes).
 */
export const getMyDiscounts = createAsyncThunk(
  "userDiscount/getMyDiscounts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/my-discounts", {
        withCredentials: true,
      });
      return data; // { success, discounts }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch my discounts"
      );
    }
  }
);

// ============================================
// SLICE
// ============================================

const userDiscountSlice = createSlice({
  name: "userDiscount",
  initialState: {
    // Cart validation
    validatedDiscount: null, // { code, type, value, discountAmount, description }

    // Public promo banner / promo listing page
    activePromos: [],

    // Account → "My Discounts" page
    myDiscounts: [],

    // Granular loading states
    validationLoading: false,
    promosLoading: false,
    myDiscountsLoading: false,

    // Feedback
    error: null,
    validationError: null, // separate so cart UI can show inline error
  },

  reducers: {
    clearValidatedDiscount: (state) => {
      state.validatedDiscount = null;
      state.validationError = null;
    },
    clearUserDiscountError: (state) => {
      state.error = null;
      state.validationError = null;
    },
  },

  extraReducers: (builder) => {
    // ── VALIDATE DISCOUNT CODE ─────────────────────────────────────────
    builder
      .addCase(validateDiscountCode.pending, (state) => {
        state.validationLoading = true;
        state.validationError = null;
        // Clear previous result so UI doesn't flicker a stale discount
        state.validatedDiscount = null;
      })
      .addCase(validateDiscountCode.fulfilled, (state, action) => {
        state.validationLoading = false;
        state.validatedDiscount = action.payload.discount;
      })
      .addCase(validateDiscountCode.rejected, (state, action) => {
        state.validationLoading = false;
        state.validatedDiscount = null;
        // Use dedicated validationError so the cart input can show it
        // inline without tripping other UI error handlers.
        state.validationError = action.payload;
      });

    // ── GET ACTIVE PROMOS ──────────────────────────────────────────────
    builder
      .addCase(getActivePromos.pending, (state) => {
        state.promosLoading = true;
        state.error = null;
      })
      .addCase(getActivePromos.fulfilled, (state, action) => {
        state.promosLoading = false;
        state.activePromos = action.payload.promos;
      })
      .addCase(getActivePromos.rejected, (state, action) => {
        state.promosLoading = false;
        state.error = action.payload;
      });

    // ── GET MY DISCOUNTS ───────────────────────────────────────────────
    builder
      .addCase(getMyDiscounts.pending, (state) => {
        state.myDiscountsLoading = true;
        state.error = null;
      })
      .addCase(getMyDiscounts.fulfilled, (state, action) => {
        state.myDiscountsLoading = false;
        state.myDiscounts = action.payload.discounts;
      })
      .addCase(getMyDiscounts.rejected, (state, action) => {
        state.myDiscountsLoading = false;
        state.error = action.payload;
      });
  },
});

export const { clearValidatedDiscount, clearUserDiscountError } =
  userDiscountSlice.actions;

export default userDiscountSlice.reducer;