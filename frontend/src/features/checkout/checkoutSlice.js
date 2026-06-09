import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { generateEventId, buildClientAnalyticsPayload, ANALYTICS_EVENTS } from '../../utils/analytics.js';
import {
  trackBeginCheckout,
  trackCheckoutStep,
} from '../../utils/eventBridge.js';

// ============================================
// THUNKS
// ============================================

/**
 * createCheckoutSession
 *
 * ANALYTICS CHANGES:
 *   - Generates a UUID eventId at session creation time
 *   - Builds full client analytics payload (UTMs, fbp, fbc, ga4ClientId)
 *   - Sends payload to server so backend has attribution context
 *   - Returns eventId alongside checkout for the fulfilled handler to use
 *
 * The fulfilled handler fires trackBeginCheckout() with the same eventId
 * so Meta can deduplicate the browser InitiateCheckout pixel against the
 * server-side CAPI event.
 */
export const createCheckoutSession = createAsyncThunk(
  "checkout/createSession",
  async ({ items, shippingInfo }, { getState, rejectWithValue }) => {
    try {
      const { discount } = getState().cart;
      const hasDiscount  = discount.applied && discount.code && discount.discountAmount > 0;

      const eventId          = generateEventId();
      const analyticsPayload = buildClientAnalyticsPayload({
        eventType:        ANALYTICS_EVENTS.CHECKOUT_STEP,
        analyticsEventId: eventId,
      });

      const { data } = await axios.post("/api/v1/checkout/create", {
        items,
        shippingInfo,
        ...(hasDiscount && { discountCode: discount.code }),
        ...analyticsPayload,
      }, { withCredentials: true });

      return { checkout: data.checkout, eventId, items, hasDiscount };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to create checkout session");
    }
  }
);


export const updateCheckoutStep = createAsyncThunk(
  "checkout/updateStep",
  async ({ checkoutId, step, gateway, cartContext = {} }, { getState, rejectWithValue }) => {
    try {
      const eventId          = generateEventId();
      const analyticsPayload = buildClientAnalyticsPayload({
        eventType:        ANALYTICS_EVENTS.CHECKOUT_STEP,
        analyticsEventId: eventId,
      });

      const { data } = await axios.put(
        `/api/v1/checkout/${checkoutId}/step`,
        {
          step,
          gateway,
          ...analyticsPayload,
        },
        { withCredentials: true }
      );

      // Capture confirmed pricing from Redux state at dispatch time so the
      // fulfilled handler has a stable server-authoritative totalPrice.
      const confirmedPricing = getState().checkout.pricing;

      return {
        currentStep:      data.currentStep,
        stepsCompleted:   data.stepsCompleted,
        gateway,
        step,
        cartContext,
        confirmedPricing,
        eventId,
      };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to update checkout step");
    }
  }
);

export const getActiveCheckout = createAsyncThunk(
  "checkout/getActive",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/checkout/active", { withCredentials: true });
      return data.checkout;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to load checkout session");
    }
  }
);

export const abandonCheckout = createAsyncThunk(
  "checkout/abandon",
  async (checkoutId, { rejectWithValue }) => {
    try {
      await axios.put(`/api/v1/checkout/${checkoutId}/abandon`, {}, { withCredentials: true });
      return { success: true };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to abandon checkout");
    }
  }
);

export const redeemRecoveryToken = createAsyncThunk(
  'checkout/redeemRecoveryToken',
  async (token, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/checkout/recover?token=${token}`,
        { withCredentials: true }
      );
      return data;
    } catch (error) {
      return rejectWithValue({
        message: error.response?.data?.message || 'Recovery link is invalid',
        status:  error.response?.status        || 400,
      });
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================

const initialRecoveryState = {
  loading:             false,
  error:               null,
  errorStatus:         null,
  isExpired:           false,
  alreadyConverted:    false,
  orderId:             null,
  restoredCheckout:    null,
  unavailableItems:    [],
  hasUnavailableItems: false,
  discountWarning:     null,
  message:             null,
  userHint:            null,
};

const initialState = {
  session:          null,
  currentStep:      'shipping_info',
  stepsCompleted:   [],
  selectedGateway:  null,
  checkoutId:       null,
  pricing: {
    itemPrice:     0,
    taxPrice:      0,
    shippingPrice: 0,
    totalPrice:    0,
    currency:      'USD',
  },
  loading:           false,
  actionLoading:     false,
  error:             null,
  success:           false,
  message:           null,
  hasActiveCheckout: false,
  recovery:          initialRecoveryState,
};

// ============================================
// SLICE
// ============================================

const checkoutSlice = createSlice({
  name: "checkout",
  initialState,
  reducers: {
    removeErrors:       (state) => { state.error = null; },
    removeMessage:      (state) => { state.message = null; state.success = false; },
    setSelectedGateway: (state, action) => { state.selectedGateway = action.payload; },
    setCurrentStep:     (state, action) => { state.currentStep = action.payload; },

    clearCheckout: (state) => {
      state.session           = null;
      state.currentStep       = 'shipping_info';
      state.stepsCompleted    = [];
      state.selectedGateway   = null;
      state.checkoutId        = null;
      state.pricing           = initialState.pricing;
      state.hasActiveCheckout = false;
      state.message           = "Checkout cleared";
      state.recovery          = initialRecoveryState;
    },

    resetCheckout: () => ({ ...initialState, recovery: { ...initialRecoveryState } }),
  },

  extraReducers: (builder) => {
    // ── CREATE SESSION ──────────────────────────────────────────────────────
    builder
      .addCase(createCheckoutSession.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(createCheckoutSession.fulfilled, (state, action) => {
        const { checkout, eventId, items, hasDiscount } = action.payload;

        state.loading           = false;
        state.session           = checkout;
        state.checkoutId        = checkout.id;
        state.currentStep       = checkout.currentStep    || 'shipping_info';
        state.stepsCompleted    = checkout.stepsCompleted || [];
        state.pricing           = checkout.pricing        || initialState.pricing;
        state.hasActiveCheckout = true;
        state.success           = true;
        state.message           = "Checkout session created";

        // Fire browser pixel — fire-and-forget, never throws
        trackBeginCheckout(
          {
            cartValue:   checkout.pricing?.totalPrice || 0,
            itemCount:   (items || []).length,
            hasDiscount: hasDiscount || false,
            items:       items || [],
          },
          eventId
        );
      })
      .addCase(createCheckoutSession.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload;
      });

    // ── UPDATE STEP ─────────────────────────────────────────────────────────

    builder
      .addCase(updateCheckoutStep.pending, (state) => {
        state.actionLoading = true;
        state.error         = null;
      })
      .addCase(updateCheckoutStep.fulfilled, (state, action) => {
        const {
          currentStep,
          stepsCompleted,
          gateway,
          step,
          cartContext,
          confirmedPricing,
          eventId,
        } = action.payload;

        state.actionLoading  = false;
        state.currentStep    = currentStep;
        state.stepsCompleted = stepsCompleted;
        if (gateway) state.selectedGateway = gateway;
        state.success = true;
        state.message = "Step updated";

        // Fire browser pixel for payment-related steps — fire-and-forget.
        if (step === 'payment_selection' || step === 'payment_gateway') {
          trackCheckoutStep(
            step,
            {
              cartValue:   confirmedPricing?.totalPrice ?? state.pricing?.totalPrice ?? 0,
              itemCount:   cartContext?.itemCount   || 0,
              hasDiscount: cartContext?.hasDiscount ?? false,
            },
            eventId
          );
        }
      })
      .addCase(updateCheckoutStep.rejected, (state, action) => {
        state.actionLoading = false;
        state.error         = action.payload;
      });

    // ── GET ACTIVE ──────────────────────────────────────────────────────────
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
          state.currentStep       = action.payload.currentStep     || 'shipping_info';
          state.stepsCompleted    = action.payload.stepsCompleted  || [];
          state.selectedGateway   = action.payload.selectedGateway || null;
          state.pricing           = action.payload.pricing         || initialState.pricing;
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

    // ── ABANDON ─────────────────────────────────────────────────────────────
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

    // ── REDEEM RECOVERY TOKEN ───────────────────────────────────────────────
    builder
      .addCase(redeemRecoveryToken.pending, (state) => {
        state.recovery = { ...initialRecoveryState, loading: true };
      })
      .addCase(redeemRecoveryToken.fulfilled, (state, action) => {
        const payload = action.payload;
        state.recovery.loading = false;
        state.recovery.message = payload.message;

        if (payload.expired) {
          state.recovery.isExpired = true;
          state.recovery.userHint  = payload.user || null;
          return;
        }

        if (payload.alreadyConverted) {
          state.recovery.alreadyConverted = true;
          state.recovery.orderId          = payload.orderId || null;
          return;
        }

        const c = payload.checkout;
        state.recovery.restoredCheckout    = c;
        state.recovery.userHint            = payload.user || null;
        state.recovery.unavailableItems    = c.unavailableItems    || [];
        state.recovery.hasUnavailableItems = (c.unavailableItems?.length || 0) > 0;
        state.recovery.discountWarning     = payload.discountWarning || null;

        state.session           = c;
        state.checkoutId        = c.id;
        state.currentStep       = c.currentStep   || 'shipping_info';
        state.pricing           = c.pricing        || initialState.pricing;
        state.hasActiveCheckout = true;
        state.stepsCompleted    = c.stepsCompleted || [];
      })
      .addCase(redeemRecoveryToken.rejected, (state, action) => {
        state.recovery.loading     = false;
        state.recovery.error       = action.payload?.message || 'Recovery link is invalid';
        state.recovery.errorStatus = action.payload?.status  || 400;
      });
  },
});

export const {
  removeErrors,
  removeMessage,
  setSelectedGateway,
  setCurrentStep,
  clearCheckout,
  resetCheckout,
} = checkoutSlice.actions;

// ── SELECTORS ────────────────────────────────────────────────────────────────
export const selectCheckoutSession     = (state) => state.checkout.session;
export const selectCheckoutId          = (state) => state.checkout.checkoutId;
export const selectCurrentStep         = (state) => state.checkout.currentStep;
export const selectStepsCompleted      = (state) => state.checkout.stepsCompleted;
export const selectSelectedGateway     = (state) => state.checkout.selectedGateway;
export const selectCheckoutPricing     = (state) => state.checkout.pricing;
export const selectHasActiveCheckout   = (state) => state.checkout.hasActiveCheckout;
export const selectRecovery            = (state) => state.checkout.recovery;
export const selectHasUnavailableItems = (state) => state.checkout.recovery.hasUnavailableItems;
export const selectDiscountWarning     = (state) => state.checkout.recovery.discountWarning;
export const selectRecoveryUserHint    = (state) => state.checkout.recovery.userHint;
export const selectRecoveryIsExpired   = (state) => state.checkout.recovery.isExpired;
export const selectAuthenticatedUser   = selectRecoveryUserHint; // DEPRECATED

export const selectIsStepCompleted = (step) => (state) =>
  state.checkout.stepsCompleted.some(s => s.step === step);

export const selectCanProceedToPayment = (state) =>
  state.checkout.stepsCompleted.map(s => s.step).includes('shipping_info');

export default checkoutSlice.reducer;