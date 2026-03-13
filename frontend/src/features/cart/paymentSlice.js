import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ----------------------
// INITIALIZE PAYMENT THUNK
// ----------------------
export const initializePayment = createAsyncThunk(
  "payment/initializePayment",
  async (payload, { rejectWithValue }) => {
    try {
      const { gateway, currency, shippingInfo, cartItems, discountCode } = payload;

      // BUG-SL1 FIX: discountCode was destructured from payload but never
      // forwarded in the request body. The entire server-side discount
      // application path — canUserUse(), validateCart(),
      // calculateDiscount(), discountInfo in session — was therefore
      // completely unreachable from the frontend regardless of what the
      // user entered. discountCode is now included in the POST body so
      // the controller can apply it during payment initialisation.
      // It is intentionally omitted when undefined so the controller's
      // `if (discountCode)` branch is not entered for non-discount flows.
      const { data } = await axios.post(
        "/api/v1/payment/initialize",
        {
          gateway,
          currency,
          shippingInfo,
          cartItems,
          ...(discountCode && { discountCode }),
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

      // transactionId is passed for Flutterwave to bypass the unreliable
      // tx_ref search endpoint — backend will use it directly if present.
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
 * discountInfo shape (set on initializePayment.fulfilled when a discount
 * was applied by the server):
 *   {
 *     code:               string   — e.g. "SUMMER20"
 *     amount:             number   — amount deducted, e.g. 20.00
 *     originalItemPrice:  number   — pre-discount item subtotal
 *   }
 * null when no discount is active.
 *
 * idempotent (set on verifyPayment.fulfilled):
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
  // BUG-SL2 FIX: dedicated discount field so components can read applied
  // discount info without drilling into paymentData.breakdown.discount.
  discountInfo: null,
  // BUG-SL4 FIX: expose idempotent flag so components can suppress
  // duplicate "payment successful" toasts / analytics re-firing.
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
    // BUG-SL3 FIX: clearPaymentData now also clears discountInfo so a
    // stale discount from a previous session is not carried into the next
    // payment attempt when only the gateway data is cleared.
    clearPaymentData: (state) => {
      state.paymentData  = null;
      state.discountInfo = null;
    },
  },
  extraReducers: (builder) => {
    // ── Initialize payment ──────────────────────────────────────────
    builder
      .addCase(initializePayment.pending, (state) => {
        state.initLoading = true;
        state.error       = null;
        state.paymentData = null;
        // Clear any discount from a previous attempt so a stale code
        // is never displayed if the user changes their cart or code.
        state.discountInfo = null;
      })
      .addCase(initializePayment.fulfilled, (state, action) => {
        state.initLoading = false;
        state.paymentData = action.payload;

        // BUG-SL2 FIX: extract discount info returned by the server
        // (present only when the controller applied a valid discountCode)
        // and surface it as a dedicated state field.
        //
        // action.payload is data.data from the controller response:
        //   { reference, amount, currency, gateway, orderItems,
        //     breakdown: { ..., discount?: { code, amount, originalItemPrice } },
        //     authorization_url | payment_link | client_secret | ... }
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
        state.loading  = false;
        state.success  = true;
        state.order    = action.payload.order   ?? null;
        state.message  = action.payload.message ?? "Payment verified successfully";
        // BUG-SL4 FIX: store idempotent flag from controller response so
        // components can detect a repeat-verify and skip analytics /
        // success side-effects that must only fire once per purchase.
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