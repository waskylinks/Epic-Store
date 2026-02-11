// Frontend/src/features/discounts/adminDiscountSlice.js

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ADMIN: GET ALL DISCOUNTS
// ============================================

/**
 * Get all discounts with filters
 * @route GET /api/v1/discounts
 * @access Admin
 */
export const getAllDiscounts = createAsyncThunk(
  "adminDiscount/getAllDiscounts",
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await axios.get(
        `/api/v1/discounts${params ? `?${params}` : ''}`,
        { withCredentials: true }
      );
      return data;
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
 * Get discount details
 * @route GET /api/v1/discounts/:id
 * @access Admin
 */
export const getSingleDiscount = createAsyncThunk(
  "adminDiscount/getSingleDiscount",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts/${id}`,
        { withCredentials: true }
      );
      return data;
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
 * Create new discount code
 * @route POST /api/v1/discounts
 * @access Admin
 */
export const createDiscount = createAsyncThunk(
  "adminDiscount/createDiscount",
  async (discountData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/discounts`,
        discountData,
        { withCredentials: true }
      );
      return data;
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
 * Update discount
 * @route PUT /api/v1/discounts/:id
 * @access Admin
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
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update discount"
      );
    }
  }
);

// ============================================
// ADMIN: DELETE DISCOUNT
// ============================================

/**
 * Delete discount (soft delete)
 * @route DELETE /api/v1/discounts/:id
 * @access Admin
 */
export const deleteDiscount = createAsyncThunk(
  "adminDiscount/deleteDiscount",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.delete(
        `/api/v1/discounts/${id}`,
        { withCredentials: true }
      );
      return { id, message: data.message };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to delete discount"
      );
    }
  }
);

// ============================================
// ADMIN: CREATE COMPENSATION DISCOUNT
// ============================================

/**
 * Create personalized discount for refund/return
 * @route POST /api/v1/discounts/create-compensation
 * @access Admin
 */
export const createCompensationDiscount = createAsyncThunk(
  "adminDiscount/createCompensationDiscount",
  async (compensationData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/discounts/create-compensation`,
        compensationData,
        { withCredentials: true }
      );
      return data;
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
 * Get discount usage statistics
 * @route GET /api/v1/discounts/stats
 * @access Admin
 */
export const getDiscountStats = createAsyncThunk(
  "adminDiscount/getDiscountStats",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts/stats`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch discount stats"
      );
    }
  }
);

// ============================================
// PUBLIC: VALIDATE DISCOUNT CODE
// ============================================

/**
 * Validate discount code (used in cart)
 * @route POST /api/v1/discounts/validate
 * @access Public
 */
export const validateDiscountCode = createAsyncThunk(
  "adminDiscount/validateDiscountCode",
  async ({ code, cartTotal, items }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `/api/v1/discounts/validate`,
        { code, cartTotal, items }
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
 * Get all active public promo codes
 * @route GET /api/v1/discounts/promos
 * @access Public
 */
export const getActivePromos = createAsyncThunk(
  "adminDiscount/getActivePromos",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/discounts/promos`);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch active promos"
      );
    }
  }
);

// ============================================
// USER: GET MY DISCOUNTS
// ============================================

/**
 * Get user's personalized discounts
 * @route GET /api/v1/discounts/my-discounts
 * @access Private (User)
 */
export const getMyDiscounts = createAsyncThunk(
  "adminDiscount/getMyDiscounts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/discounts/my-discounts`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch my discounts"
      );
    }
  }
);

// ============================================
// SLICE DEFINITION
// ============================================

const adminDiscountSlice = createSlice({
  name: "adminDiscount",
  initialState: {
    discounts: [],
    currentDiscount: null,
    stats: null,
    categoryStats: [],
    activePromos: [],
    myDiscounts: [],
    validatedDiscount: null,
    pagination: null,
    
    loading: false,
    discountsLoading: false,
    statsLoading: false,
    validationLoading: false,
    
    error: null,
    success: false,
    message: null,
  },
  reducers: {
    clearDiscountState: (state) => {
      state.error = null;
      state.success = false;
      state.message = null;
    },
    clearCurrentDiscount: (state) => {
      state.currentDiscount = null;
    },
    clearValidatedDiscount: (state) => {
      state.validatedDiscount = null;
    }
  },
  extraReducers: (builder) => {
    // Get All Discounts
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

    // Get Single Discount
    builder
      .addCase(getSingleDiscount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSingleDiscount.fulfilled, (state, action) => {
        state.loading = false;
        state.currentDiscount = action.payload.discount;
      })
      .addCase(getSingleDiscount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Create Discount
    builder
      .addCase(createDiscount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createDiscount.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        state.discounts.unshift(action.payload.discount);
      })
      .addCase(createDiscount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Update Discount
    builder
      .addCase(updateDiscount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateDiscount.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        const index = state.discounts.findIndex(d => d._id === action.payload.discount._id);
        if (index !== -1) {
          state.discounts[index] = action.payload.discount;
        }
        if (state.currentDiscount?._id === action.payload.discount._id) {
          state.currentDiscount = action.payload.discount;
        }
      })
      .addCase(updateDiscount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Delete Discount
    builder
      .addCase(deleteDiscount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteDiscount.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        // Update status to inactive instead of removing
        const index = state.discounts.findIndex(d => d._id === action.payload.id);
        if (index !== -1) {
          state.discounts[index].status = 'inactive';
        }
      })
      .addCase(deleteDiscount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Create Compensation Discount
    builder
      .addCase(createCompensationDiscount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createCompensationDiscount.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        state.discounts.unshift(action.payload.discount);
      })
      .addCase(createCompensationDiscount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Get Discount Stats
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

    // Validate Discount Code
    builder
      .addCase(validateDiscountCode.pending, (state) => {
        state.validationLoading = true;
        state.error = null;
      })
      .addCase(validateDiscountCode.fulfilled, (state, action) => {
        state.validationLoading = false;
        state.validatedDiscount = action.payload.discount;
      })
      .addCase(validateDiscountCode.rejected, (state, action) => {
        state.validationLoading = false;
        state.error = action.payload;
        state.validatedDiscount = null;
      });

    // Get Active Promos
    builder
      .addCase(getActivePromos.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getActivePromos.fulfilled, (state, action) => {
        state.loading = false;
        state.activePromos = action.payload.promos;
      })
      .addCase(getActivePromos.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Get My Discounts
    builder
      .addCase(getMyDiscounts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getMyDiscounts.fulfilled, (state, action) => {
        state.loading = false;
        state.myDiscounts = action.payload.discounts;
      })
      .addCase(getMyDiscounts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { 
  clearDiscountState, 
  clearCurrentDiscount,
  clearValidatedDiscount 
} = adminDiscountSlice.actions;

export default adminDiscountSlice.reducer;