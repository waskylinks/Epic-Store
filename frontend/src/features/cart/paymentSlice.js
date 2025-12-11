import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// VERIFY PAYMENT
export const verifyPayment = createAsyncThunk(
    "payment/verifyPayment",
    async (payload, { rejectWithValue }) => {
        try {
            const { data } = await axios.post(
                "/api/v1/paystack/verify",
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
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

const paymentSlice = createSlice({
    name: "payment",
    initialState: {
        loading: false,
        success: false,
        error: null,
        message: null,
        order: null
    },

    reducers: {
        removePaymentError: (state) => {
            state.error = null;
        },
        removePaymentMessage: (state) => {
            state.message = null;
        }
    },

    extraReducers: (builder) => {
        builder.addCase(verifyPayment.pending, (state) => {
            state.loading = true;
            state.error = null;
            state.message = null;
        });

        builder.addCase(verifyPayment.fulfilled, (state, action) => {
            state.loading = false;
            state.success = true;
            state.order = action.payload.order || null;
            state.message = action.payload.message || "Payment verified successfully";
        });

        builder.addCase(verifyPayment.rejected, (state, action) => {
            state.loading = false;
            state.error =
            action.payload?.message || "Payment verification failed";
        });
    }
});

export const { removePaymentError, removePaymentMessage } = paymentSlice.actions;
export default paymentSlice.reducer;
