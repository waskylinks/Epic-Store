import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import { toast } from "react-toastify";

/* --- Fetch a single receipt by reference --- */
export const fetchReceiptByReference = createAsyncThunk(
  "receipt/fetchReceiptByReference", // FIX #6: was "order/..." — corrected namespace
  async (reference, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/receipts/${reference}`, {
        withCredentials: true,
      });

      return data.receipt;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch receipt."
      );
    }
  }
);

/* --- Download receipt PDF --- */
export const downloadReceiptPdf = createAsyncThunk(
  "receipt/downloadReceiptPdf", // FIX #6: was "order/..." — corrected namespace
  async ({ reference }, { rejectWithValue }) => {
    if (!reference) {
      return rejectWithValue("Receipt not found for this order");
    }

    try {
      const response = await axios.get(
        `/api/v1/receipts/${reference}/pdf`,
        {
          responseType: "blob",
          withCredentials: true,
        }
      );

      const blob = new Blob([response.data], {
        type: "application/pdf",
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `receipt_${reference}.pdf`;
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return true;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Receipt not found for this order"
      );
    }
  }
);

/**
 * FIX #6: Slice renamed from "order" to "receipt".
 *
 * The previous slice used `name: "order"` with its own initialState that
 * conflicted with the real orderSlice (also named "order") registered under
 * a different store key. This caused:
 *   - Redux DevTools showing two "order" slices
 *   - Potential state key collisions depending on combineReducers order
 *   - Confusing action type prefixes (order/ vs receipt/)
 *
 * Register this reducer in the store under the "receipt" key:
 *   receipt: receiptReducer
 * and update any selectors to read from state.receipt.*
 */
const receiptSlice = createSlice({
  name: "receipt", // FIX #6: was "order"
  initialState: {
    receipts: [],
    selectedReceipt: null,
    loading: false,
    downloadLoading: false,
    error: null,
  },
  reducers: {
    clearSelectedReceipt: (state) => {
      state.selectedReceipt = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch receipt
      .addCase(fetchReceiptByReference.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.selectedReceipt = null;
      })
      .addCase(fetchReceiptByReference.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedReceipt = action.payload;
      })
      .addCase(fetchReceiptByReference.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Receipt not found.";
      })

      // Download PDF
      .addCase(downloadReceiptPdf.pending, (state) => {
        state.downloadLoading = true;
      })
      .addCase(downloadReceiptPdf.fulfilled, (state) => {
        state.downloadLoading = false;
      })
      .addCase(downloadReceiptPdf.rejected, (state, action) => {
        state.downloadLoading = false;
        toast.error(action.payload || "PDF download failed.", {
          position: "top-center",
        });
      });
  },
});

export const { clearSelectedReceipt } = receiptSlice.actions;
export default receiptSlice.reducer;