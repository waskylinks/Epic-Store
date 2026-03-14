import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ----------------------
// INITIALIZE PAYMENT THUNK
// ----------------------

/**
 * FIX — Root cause change:
 *
 * Previously this thunk accepted `discountCode` (a string) and forwarded it
 * to the backend which would then re-run the entire pricing calculation
 * including discount application from scratch. This was the second pricing
 * path and the source of the bug: if discountCode was falsy at the moment
 * the button was clicked, the backend's `if (discountCode)` guard was never
 * entered and the gateway was charged the full undiscounted price.
 *
 * The fix:
 *  - Accept `cartPricing` (the full pricing object already computed by the
 *    cart controller and stored in Redux) and forward it to the backend.
 *  - Accept `discountSnapshot` (the full discount object from Redux state)
 *    and forward it so the backend can record it accurately without
 *    re-deriving anything.
 *  - The backend no longer calls validateAndCalculateOrder() for totals; it
 *    trusts cartPricing as the authoritative figure and only does a
 *    lightweight stock/existence check per product.
 *
 * The cart controller (applyDiscountCode) remains the single point of
 * calculation for all pricing including discounts.
 */
export const initializePayment = createAsyncThunk(
  "payment/initializePayment",
  async (payload, { rejectWithValue }) => {
    try {
      const {
        gateway,
        currency,
        shippingInfo,
        cartItems,
        // FIX: pre-computed pricing from the cart controller.
        // Shape: { itemPrice, taxPrice, shippingPrice, totalPrice, currency }
        cartPricing,
        // FIX: full discount snapshot from the cart Redux state.
        // Shape: { code, discountId, type, value, discountAmount,
        //          originalItemPrice, description }
        // null/undefined when no discount is active.
        discountSnapshot,
      } = payload;

      const { data } = await axios.post(
        "/api/v1/payment/initialize",
        {
          gateway,
          currency,
          shippingInfo,
          cartItems,
          // FIX: send pre-computed totals so the backend never recalculates.
          cartPricing,
          // FIX: send full discount snapshot (omit key entirely when null so
          // the backend's discountSnapshot guard is not entered).
          ...(discountSnapshot && { discountSnapshot }),
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment initialization failed" }
      );
    }
  }
);

// ----------------------
// VERIFY PAYMENT THUNK
// ----------------------
export const verifyPayment = createAsyncThunk(
  "payment/verifyPayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway = "paystack", reference, transactionId } = payload;

      const { data } = await axios.post(
        "/api/v1/payment/verify",
        { gateway, reference, transactionId },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Payment verification failed" }
      );
    }
  }
);

// ----------------------
// PAYMENT SLICE
// ----------------------

/**
 * discountInfo shape (set on initializePayment.fulfilled):
 *   {
 *     code:               string
 *     discountAmount:     number
 *     originalItemPrice:  number
 *   }
 * null when no discount was active during the last initialisation.
 *
 * idempotent:
 *   true  — order already existed; do NOT fire analytics / success toasts
 *   false — fresh verification; proceed normally
 */
const initialState = {
  loading:      false,
  initLoading:  false,
  success:      false,
  error:        null,
  message:      null,
  order:        null,
  paymentData:  null,
  discountInfo: null,
  idempotent:   false,
};

const paymentSlice = createSlice({
  name: "payment",
  initialState,
  reducers: {
    removePaymentError: (state) => {
      state.error = null;
    },
    removePaymentMessage: (state) => {
      state.message = null;
    },
    resetPaymentState: () => initialState,
    // FIX: clearPaymentData also clears discountInfo so stale discount data
    // from a previous session is never shown alongside fresh payment data.
    clearPaymentData: (state) => {
      state.paymentData  = null;
      state.discountInfo = null;
    },
  },
  extraReducers: (builder) => {
    // ── Initialize payment ──────────────────────────────────────────
    builder
      .addCase(initializePayment.pending, (state) => {
        state.initLoading  = true;
        state.error        = null;
        state.paymentData  = null;
        state.discountInfo = null;
      })
      .addCase(initializePayment.fulfilled, (state, action) => {
        state.initLoading = false;
        state.paymentData = action.payload;

        // Extract discount info from the server-confirmed breakdown.
        // The server echoes back what was stored in the session — this
        // is now sourced from discountSnapshot (which came from cart Redux),
        // so it is always accurate and consistent with the cart display.
        state.discountInfo = action.payload?.breakdown?.discount ?? null;
      })
      .addCase(initializePayment.rejected, (state, action) => {
        state.initLoading  = false;
        state.error        = action.payload?.message || "Payment initialization failed";
        state.discountInfo = null;
      });

    // ── Verify payment ──────────────────────────────────────────────
    builder
      .addCase(verifyPayment.pending, (state) => {
        state.loading    = true;
        state.error      = null;
        state.message    = null;
        state.success    = false;
        state.idempotent = false;
      })
      .addCase(verifyPayment.fulfilled, (state, action) => {
        state.loading    = false;
        state.success    = true;
        state.order      = action.payload.order   ?? null;
        state.message    = action.payload.message ?? "Payment verified successfully";
        state.idempotent = action.payload.idempotent ?? false;
      })
      .addCase(verifyPayment.rejected, (state, action) => {
        state.loading    = false;
        state.success    = false;
        state.idempotent = false;
        state.error      = action.payload?.message || "Payment verification failed";
      });
  },
});

export const {
  removePaymentError,
  removePaymentMessage,
  resetPaymentState,
  clearPaymentData,
} = paymentSlice.actions;

export default paymentSlice.reducer;