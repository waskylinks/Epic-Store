// Frontend/src/features/discount/userDiscountSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE (cart flow)
// ============================================

/**
 * @route POST /api/v1/discounts/validate
 * @access Public (auth optional — logged-in users get per-user checks)
 *
 * Body: { code, cartTotal, items?, orderId? }
 * Returns: { success, valid, discount: { code, type, value, discountAmount, description } }
 */
export const validateDiscountCode = createAsyncThunk(
  "userDiscount/validateDiscountCode",
  async ({ code, cartTotal, items = [], orderId = null }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/discounts/validate",
        { code, cartTotal, items, orderId },
        { withCredentials: true }
      );
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
 * Returns audience:'all' active promo codes for the public promo
 * listing page / banner. Does not require authentication.
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
// USER: GET MY DISCOUNTS
//
// Returns combined set of:
//   1. audience:'all' active broadcast discounts (seasonal promos)
//   2. audience:'specific' discounts scoped to this user
//      (return compensation, refund, loyalty codes)
//
// Side effect on the server:
//   Stamps user.lastSeenDiscountsAt = now, which clears the
//   Navbar notification dot. The dot disappears the moment
//   this thunk fulfils — no extra dispatch needed.
// ============================================

/**
 * @route GET /api/v1/discounts/my-discounts
 * @access Private (authenticated user)
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
// USER: CHECK NEW DISCOUNTS (Navbar dot)
//
// Lightweight read-only check — no DB writes on the server.
// Called once on Navbar mount for authenticated users.
//
// Dot scope: audience:'all' broadcast discounts only.
// Personal compensation codes are transactional — the user
// already knows about them from the return/refund flow.
// A dot for those would be noise.
//
// Dot clears automatically when getMyDiscounts fulfils
// (user opened the discounts page). No separate clear action needed.
// ============================================

/**
 * @route GET /api/v1/discounts/has-new
 * @access Private (authenticated user)
 *
 * Returns: { hasNew: true | false }
 */
export const checkNewDiscounts = createAsyncThunk(
  "userDiscount/checkNewDiscounts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/has-new", {
        withCredentials: true,
      });
      return data; // { hasNew: boolean }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to check new discounts"
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
    // null until a code is validated; cleared on input clear or page unmount
    validatedDiscount: null, // { code, type, value, discountAmount, description }

    // Public promo banner / promo listing page
    activePromos: [],

    // Account → "My Discounts" page
    // Combined: broadcast (audience:'all') + personal (audience:'specific')
    myDiscounts: [],

    // ── Navbar notification dot ─────────────────────────────────────────
    // true  → show dot on Discounts nav link
    // false → no dot (user has seen all current broadcast discounts)
    //
    // Set to true by checkNewDiscounts.fulfilled when hasNew === true.
    // Set to false by getMyDiscounts.fulfilled (user opened the page).
    // Never set back to true until the next checkNewDiscounts call.
    hasNewDiscount: false,

    // ── Granular loading states ─────────────────────────────────────────
    validationLoading:    false,
    promosLoading:        false,
    myDiscountsLoading:   false,
    checkingNewDiscount:  false, // keeps Navbar render clean — no spinner needed

    // ── Feedback ────────────────────────────────────────────────────────
    error:           null,
    // Separate from error — cart UI shows this inline under the code input
    // without tripping other UI error handlers that watch the general error field
    validationError: null,
  },

  reducers: {
    // Clear validated discount + its error — called when user clears the
    // code input in the cart or the UserDiscounts checker widget
    clearValidatedDiscount: (state) => {
      state.validatedDiscount = null;
      state.validationError   = null;
    },

    // Clear general error — called on component unmount / retry
    clearUserDiscountError: (state) => {
      state.error           = null;
      state.validationError = null;
    },

    // Manually clear the dot — available if needed but normally the dot
    // clears automatically via getMyDiscounts.fulfilled
    clearNewDiscountDot: (state) => {
      state.hasNewDiscount = false;
    },
  },

  extraReducers: (builder) => {

    // ── VALIDATE DISCOUNT CODE ─────────────────────────────────────────
    builder
      .addCase(validateDiscountCode.pending, (state) => {
        state.validationLoading  = true;
        state.validationError    = null;
        // Clear previous result so UI doesn't flicker a stale discount
        state.validatedDiscount  = null;
      })
      .addCase(validateDiscountCode.fulfilled, (state, action) => {
        state.validationLoading  = false;
        state.validatedDiscount  = action.payload.discount;
      })
      .addCase(validateDiscountCode.rejected, (state, action) => {
        state.validationLoading  = false;
        state.validatedDiscount  = null;
        // Use dedicated validationError so the cart input can show it
        // inline without tripping other UI error handlers
        state.validationError    = action.payload;
      });

    // ── GET ACTIVE PROMOS ──────────────────────────────────────────────
    builder
      .addCase(getActivePromos.pending, (state) => {
        state.promosLoading = true;
        state.error         = null;
      })
      .addCase(getActivePromos.fulfilled, (state, action) => {
        state.promosLoading = false;
        state.activePromos  = action.payload.promos;
      })
      .addCase(getActivePromos.rejected, (state, action) => {
        state.promosLoading = false;
        state.error         = action.payload;
      });

    // ── GET MY DISCOUNTS ───────────────────────────────────────────────
    // fulfilled also clears the Navbar dot — the server has already
    // stamped lastSeenDiscountsAt so we mirror that in the client state
    builder
      .addCase(getMyDiscounts.pending, (state) => {
        state.myDiscountsLoading = true;
        state.error              = null;
      })
      .addCase(getMyDiscounts.fulfilled, (state, action) => {
        state.myDiscountsLoading = false;
        state.myDiscounts        = action.payload.discounts;
        // Mirror the server-side lastSeenDiscountsAt stamp —
        // dot disappears the moment the user opens the discounts page
        state.hasNewDiscount     = false;
      })
      .addCase(getMyDiscounts.rejected, (state, action) => {
        state.myDiscountsLoading = false;
        state.error              = action.payload;
      });

    // ── CHECK NEW DISCOUNTS (Navbar dot) ──────────────────────────────
    // Silent — no loading spinner in the Navbar, no error banner.
    // If the request fails (network error, 401) the dot simply stays
    // false — a failed check should never show a false-positive dot.
    builder
      .addCase(checkNewDiscounts.pending, (state) => {
        state.checkingNewDiscount = true;
      })
      .addCase(checkNewDiscounts.fulfilled, (state, action) => {
        state.checkingNewDiscount = false;
        state.hasNewDiscount      = action.payload.hasNew === true;
      })
      .addCase(checkNewDiscounts.rejected, (state) => {
        // Fail silently — dot stays false on error
        state.checkingNewDiscount = false;
        state.hasNewDiscount      = false;
      });
  },
});

export const {
  clearValidatedDiscount,
  clearUserDiscountError,
  clearNewDiscountDot,
} = userDiscountSlice.actions;

export default userDiscountSlice.reducer;