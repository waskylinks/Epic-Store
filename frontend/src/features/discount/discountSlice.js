import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

export const validateDiscountCode = createAsyncThunk(
  "userDiscount/validateDiscountCode",
  async ({ code, cartTotal, items = [] }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/discounts/validate",
        { code, cartTotal, items },
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ?? "Failed to validate discount code"
      );
    }
  }
);

export const getActivePromos = createAsyncThunk(
  "userDiscount/getActivePromos",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/promos", {
        withCredentials: true,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ?? "Failed to fetch active promos"
      );
    }
  }
);

export const getMyDiscounts = createAsyncThunk(
  "userDiscount/getMyDiscounts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/my-discounts", {
        withCredentials: true,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ?? "Failed to fetch my discounts"
      );
    }
  }
);

export const checkNewDiscounts = createAsyncThunk(
  "userDiscount/checkNewDiscounts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/discounts/has-new", {
        withCredentials: true,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ?? "Failed to check new discounts"
      );
    }
  }
);

const initialState = {
  // Shape: { code, type, value, discountAmount, description }
  validatedDiscount: null,

  activePromos:       [],
  broadcastDiscounts: [],
  personalDiscounts:  [],

  // Set by checkNewDiscounts; cleared when user opens the discounts page (getMyDiscounts).
  // Preserved on network failure so a transient error never hides a real notification.
  hasNewDiscount: false,

  validationLoading:   false,
  promosLoading:       false,
  myDiscountsLoading:  false,
  checkingNewDiscount: false,

  error:           null,
  validationError: null,
};

const userDiscountSlice = createSlice({
  name: "userDiscount",
  initialState,

  reducers: {
    clearValidatedDiscount: (state) => {
      state.validatedDiscount = null;
      state.validationError   = null;
    },

    clearUserDiscountError: (state) => {
      state.error           = null;
      state.validationError = null;
    },

    clearNewDiscountDot: (state) => {
      state.hasNewDiscount = false;
    },

    // Call on logout to prevent stale personal codes leaking into the next session.
    clearMyDiscounts: (state) => {
      state.broadcastDiscounts = [];
      state.personalDiscounts  = [];
      state.hasNewDiscount     = false;
    },

    clearActivePromos: (state) => {
      state.activePromos = [];
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(validateDiscountCode.pending, (state) => {
        state.validationLoading = true;
        state.validationError   = null;
        state.validatedDiscount = null;
      })
      .addCase(validateDiscountCode.fulfilled, (state, action) => {
        state.validationLoading = false;
        state.validatedDiscount = action.payload.discount ?? null;
        state.validationError   = null;
      })
      .addCase(validateDiscountCode.rejected, (state, action) => {
        state.validationLoading = false;
        state.validatedDiscount = null;
        state.validationError   = action.payload ?? "Invalid discount code";
      });

    builder
      .addCase(getActivePromos.pending, (state) => {
        state.promosLoading = true;
        state.error         = null;
      })
      .addCase(getActivePromos.fulfilled, (state, action) => {
        state.promosLoading = false;
        state.activePromos  = action.payload.promos ?? [];
      })
      .addCase(getActivePromos.rejected, (state, action) => {
        state.promosLoading = false;
        state.error         = action.payload;
      });

    builder
      .addCase(getMyDiscounts.pending, (state) => {
        state.myDiscountsLoading = true;
        state.error              = null;
      })
      .addCase(getMyDiscounts.fulfilled, (state, action) => {
        state.myDiscountsLoading = false;
        const all = action.payload.discounts ?? [];
        // FIX: split into broadcast (audience:'all') and personal (audience:'specific')
        // Both are fetched by getMyDiscounts and must be stored separately so the
        // UI can merge them into the "My Discounts" tab correctly.
        state.broadcastDiscounts = all.filter((d) => d.audience === "all");
        state.personalDiscounts  = all.filter((d) => d.audience === "specific");
        state.hasNewDiscount     = false;
      })
      .addCase(getMyDiscounts.rejected, (state, action) => {
        state.myDiscountsLoading = false;
        state.error              = action.payload;
      });

    builder
      .addCase(checkNewDiscounts.pending, (state) => {
        state.checkingNewDiscount = true;
      })
      .addCase(checkNewDiscounts.fulfilled, (state, action) => {
        state.checkingNewDiscount = false;
        state.hasNewDiscount      = action.payload.hasNew === true;
      })
      .addCase(checkNewDiscounts.rejected, (state) => {
        state.checkingNewDiscount = false;
        // Preserve previous hasNewDiscount — a network blip must not clear a real dot.
      });
  },
});

export const {
  clearValidatedDiscount,
  clearUserDiscountError,
  clearNewDiscountDot,
  clearMyDiscounts,
  clearActivePromos,
} = userDiscountSlice.actions;

export default userDiscountSlice.reducer;