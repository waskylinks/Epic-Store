import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ASYNC THUNKS - CHECKOUT SESSION OPERATIONS
// ============================================

/**
 * Create or update checkout session
 * Combines cart items with shipping info to create checkout
 */
export const createCheckoutSession = createAsyncThunk(
  "checkout/createSession",
  async ({ items, shippingInfo }, { getState, rejectWithValue }) => {
    try {
      const { discount } = getState().cart;
      const hasDiscount =
        discount.applied &&
        discount.code &&
        discount.discountAmount > 0;

      const { data } = await axios.post("/api/v1/checkout/create", {
        items,
        shippingInfo,
        ...(hasDiscount && {
          discountCode:   discount.code,
          discountAmount: discount.discountAmount,
        }),
      }, {
        withCredentials: true
      });

      return data.checkout;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to create checkout session"
      );
    }
  }
);

/**
 * Update checkout step (tracks user progress through checkout flow)
 */
export const updateCheckoutStep = createAsyncThunk(
  "checkout/updateStep",
  async ({ checkoutId, step, gateway }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/checkout/${checkoutId}/step`, {
        step,
        gateway
      }, {
        withCredentials: true
      });
      
      return {
        currentStep:    data.currentStep,
        stepsCompleted: data.stepsCompleted,
        gateway
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update checkout step"
      );
    }
  }
);

/**
 * Get active checkout session (resume abandoned checkout)
 */
export const getActiveCheckout = createAsyncThunk(
  "checkout/getActive",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/checkout/active", {
        withCredentials: true
      });
      
      return data.checkout;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to load checkout session"
      );
    }
  }
);

/**
 * Manually abandon checkout
 */
export const abandonCheckout = createAsyncThunk(
  "checkout/abandon",
  async (checkoutId, { rejectWithValue }) => {
    try {
      await axios.put(`/api/v1/checkout/${checkoutId}/abandon`, {}, {
        withCredentials: true
      });
      
      return { success: true };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to abandon checkout"
      );
    }
  }
);

export const redeemRecoveryToken = createAsyncThunk(
  'checkout/redeemRecoveryToken',
  async (token, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/checkout/recover?token=${token}`
      );
      return data;
    } catch (error) {
      return rejectWithValue({
        message: error.response?.data?.message || 'Recovery link is invalid',
        status:  error.response?.status        || 400
      });
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialRecoveryState = {
  loading:          false,
  error:            null,
  errorStatus:      null,   // 410 = expired, 400/403 = invalid, 404 = not found
  alreadyConverted: false,
  orderId:          null,   // populated when alreadyConverted: true
  restoredCheckout: null,   // the checkout object to hydrate into session
  unavailableItems: [],     // items removed because product is unpublished
  hasUnavailableItems: false,
  discountWarning:  null,   // set when a discount was stripped during recovery
  message:          null,
};

const initialState = {
  session: null,
  currentStep:    'shipping_info',
  stepsCompleted: [],
  selectedGateway: null,
  checkoutId: null,
  pricing: {
    itemPrice:     0,
    taxPrice:      0,
    shippingPrice: 0,
    totalPrice:    0,
    currency:      'USD'
  },
  loading:       false,
  actionLoading: false,
  error:         null,
  success:       false,
  message:       null,
  hasActiveCheckout: false,
  recovery: initialRecoveryState,
};

// ============================================
// SLICE
// ============================================
const checkoutSlice = createSlice({
  name: "checkout",
  initialState,
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },

    removeMessage: (state) => {
      state.message = null;
      state.success = false;
    },
    setSelectedGateway: (state, action) => {
      state.selectedGateway = action.payload;
    },
    setCurrentStep: (state, action) => {
      state.currentStep = action.payload;
    },

    clearCheckout: (state) => {
      state.session            = null;
      state.currentStep        = 'shipping_info';
      state.stepsCompleted     = [];
      state.selectedGateway    = null;
      state.checkoutId         = null;
      state.pricing            = initialState.pricing;
      state.hasActiveCheckout  = false;
      state.message            = "Checkout cleared";
      state.recovery           = initialRecoveryState;
    },

    resetCheckout: () => ({ ...initialState, recovery: { ...initialRecoveryState } }),
  },

  extraReducers: (builder) => {
    // ============================================
    // CREATE CHECKOUT SESSION
    // ============================================
    builder
      .addCase(createCheckoutSession.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(createCheckoutSession.fulfilled, (state, action) => {
        state.loading         = false;
        state.session         = action.payload;
        state.checkoutId      = action.payload.id;
        state.currentStep     = action.payload.currentStep     || 'shipping_info';
        state.stepsCompleted  = action.payload.stepsCompleted  || [];
        state.pricing         = action.payload.pricing         || initialState.pricing;
        state.hasActiveCheckout = true;
        state.success         = true;
        state.message         = "Checkout session created";
      })
      .addCase(createCheckoutSession.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ============================================
    // UPDATE CHECKOUT STEP
    // ============================================
    builder
      .addCase(updateCheckoutStep.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(updateCheckoutStep.fulfilled, (state, action) => {
        state.actionLoading  = false;
        state.currentStep    = action.payload.currentStep;
        state.stepsCompleted = action.payload.stepsCompleted;

        if (action.payload.gateway) {
          state.selectedGateway = action.payload.gateway;
        }

        state.success = true;
        state.message = "Step updated";
      })
      .addCase(updateCheckoutStep.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ============================================
    // GET ACTIVE CHECKOUT
    // ============================================
    builder
      .addCase(getActiveCheckout.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getActiveCheckout.fulfilled, (state, action) => {
        state.loading = false;

        if (action.payload) {
          state.session           = action.payload;
          state.checkoutId        = action.payload._id;
          state.currentStep       = action.payload.currentStep    || 'shipping_info';
          state.stepsCompleted    = action.payload.stepsCompleted || [];
          state.selectedGateway   = action.payload.selectedGateway || null;
          state.pricing           = action.payload.pricing        || initialState.pricing;
          state.hasActiveCheckout = true;
          state.message           = "Active checkout loaded";
        } else {
          state.hasActiveCheckout = false;
          state.message           = "No active checkout found";
        }
      })
      .addCase(getActiveCheckout.rejected, (state, action) => {
        state.loading           = false;
        state.error             = action.payload;
        state.hasActiveCheckout = false;
      });

    // ============================================
    // ABANDON CHECKOUT
    // ============================================
    builder
      .addCase(abandonCheckout.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(abandonCheckout.fulfilled, (state) => {
        state.actionLoading     = false;
        state.session           = null;
        state.currentStep       = 'shipping_info';
        state.stepsCompleted    = [];
        state.selectedGateway   = null;
        state.checkoutId        = null;
        state.pricing           = initialState.pricing;
        state.hasActiveCheckout = false;
        state.message           = "Checkout abandoned";
        state.success           = true;
      })
      .addCase(abandonCheckout.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ============================================
    // REDEEM RECOVERY TOKEN
    // ============================================
    builder
      .addCase(redeemRecoveryToken.pending, (state) => {
        state.recovery.loading          = true;
        state.recovery.error            = null;
        state.recovery.errorStatus      = null;
        state.recovery.alreadyConverted = false;
        state.recovery.restoredCheckout = null;
        state.recovery.unavailableItems = [];
        state.recovery.hasUnavailableItems = false;
        state.recovery.discountWarning  = null;
      })
      .addCase(redeemRecoveryToken.fulfilled, (state, action) => {
        state.recovery.loading  = false;
        state.recovery.message  = action.payload.message;

        if (action.payload.alreadyConverted) {
          state.recovery.alreadyConverted = true;
          state.recovery.orderId          = action.payload.orderId || null;
          return;
        }

        const c = action.payload.checkout;

        state.recovery.restoredCheckout = c;
        state.recovery.unavailableItems    = c.unavailableItems || [];
        state.recovery.hasUnavailableItems = (c.unavailableItems?.length || 0) > 0;
        state.recovery.discountWarning = action.payload.discountWarning || null;
        state.session           = c;
        state.checkoutId        = c.id;
        state.currentStep       = c.currentStep  || 'shipping_info';
        state.pricing           = c.pricing       || initialState.pricing;
        state.hasActiveCheckout = true;
        state.stepsCompleted = c.stepsCompleted || [];
      })
      .addCase(redeemRecoveryToken.rejected, (state, action) => {
        state.recovery.loading      = false;
        state.recovery.error        = action.payload.message;
        state.recovery.errorStatus  = action.payload.status;
      });
  }
});

// ============================================
// ACTIONS
// ============================================
export const {
  removeErrors,
  removeMessage,
  setSelectedGateway,
  setCurrentStep,
  clearCheckout,
  resetCheckout
} = checkoutSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectCheckoutSession      = (state) => state.checkout.session;
export const selectCheckoutId           = (state) => state.checkout.checkoutId;
export const selectCurrentStep          = (state) => state.checkout.currentStep;
export const selectStepsCompleted       = (state) => state.checkout.stepsCompleted;
export const selectSelectedGateway      = (state) => state.checkout.selectedGateway;
export const selectCheckoutPricing      = (state) => state.checkout.pricing;
export const selectHasActiveCheckout    = (state) => state.checkout.hasActiveCheckout;
export const selectRecovery             = (state) => state.checkout.recovery;
export const selectHasUnavailableItems  = (state) => state.checkout.recovery.hasUnavailableItems;
export const selectDiscountWarning      = (state) => state.checkout.recovery.discountWarning;

// Helper selector: Check if a step is completed
export const selectIsStepCompleted = (step) => (state) =>
  state.checkout.stepsCompleted.some(s => s.step === step);

// Helper selector: Check if can proceed to payment
export const selectCanProceedToPayment = (state) => {
  const completedSteps = state.checkout.stepsCompleted.map(s => s.step);
  return completedSteps.includes('shipping_info');
};

// ============================================
// EXPORT
// ============================================
export default checkoutSlice.reducer;