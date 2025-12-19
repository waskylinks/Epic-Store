import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import { toast } from "react-toastify";

/* --- Fetch a single receipt by reference --- */
export const fetchReceiptByReference = createAsyncThunk(
  "order/fetchReceiptByReference",
  async (reference, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/v1/receipts/${reference}`, {
        withCredentials: true,
      });

      return data.receipt; // <-- IMPORTANT
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch receipt."
      );
    }
  }
);

/* --- Download receipt PDF --- */
export const downloadReceiptPdf = createAsyncThunk(
  "order/downloadReceiptPdf",
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
        error.response?.data?.message ||
          "Receipt not found for this order"
      );
    }
  }
);

//get user orders 
export const getAllOrders = createAsyncThunk('orders/getAllOrders', async(_, {rejectWithValue}) => {
  try{
    const {data} = await axios.get('/api/v1/orders/user')
    return data;

  } catch (error) {
    return rejectWithValue(error.response?.data || 'Failed to fetch Orders')
  }
})


/* --- Slice --- */
const orderSlice = createSlice({
  name: "order",
  initialState: {
    selectedReceipt: null,   // single receipt object
    loading: false,          // for fetching receipt
    error: null,             // receipt fetch error
    downloadLoading: false,  // optional, for download spinner
  },
  reducers: {
    clearSelectedReceipt: (state) => {
      state.selectedReceipt = null;
      state.error = null;
    },
    removeErrors: (state) => {
            state.error = null;
        },
    removeMessage: (state) => {
        state.message = null;
    }
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
        toast.error(action.payload || "PDF download failed.", { position: "top-center" });
      });

      //get all orders
      builder
      .addCase(getAllOrders.pending, (state) => {
        state.loading = true;
        state.error = null;
        
      })
      .addCase(getAllOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.orders = action.payload.orders;
        state.success = action.payload.success;
      })
      .addCase(getAllOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to fetch Orders";
      })
  },
});

export const { clearSelectedReceipt } = orderSlice.actions;
export default orderSlice.reducer;
