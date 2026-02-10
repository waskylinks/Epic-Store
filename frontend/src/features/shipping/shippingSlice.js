import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ASYNC THUNKS - SHIPPING ADDRESS OPERATIONS
// ============================================

/**
 * Validate shipping address format
 * Public endpoint - no auth required
 */
export const validateShippingAddress = createAsyncThunk(
  "shipping/validateAddress",
  async (addressData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/shipping/validate-address", addressData);
      
      return data.normalizedAddress;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.errors || [error.response?.data?.message || "Validation failed"]
      );
    }
  }
);

/**
 * Get all saved addresses for logged-in user
 */
export const getSavedAddresses = createAsyncThunk(
  "shipping/getSavedAddresses",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/shipping/addresses", {
        withCredentials: true
      });
      
      return data.addresses;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to load addresses"
      );
    }
  }
);

/**
 * Get default address
 */
export const getDefaultAddress = createAsyncThunk(
  "shipping/getDefaultAddress",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/shipping/address/default", {
        withCredentials: true
      });
      
      return data.address;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to load default address"
      );
    }
  }
);

/**
 * Save new address
 */
export const saveAddress = createAsyncThunk(
  "shipping/saveAddress",
  async (addressData, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/shipping/address", addressData, {
        withCredentials: true
      });
      
      return data.address;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to save address"
      );
    }
  }
);

/**
 * Update existing address
 */
export const updateAddress = createAsyncThunk(
  "shipping/updateAddress",
  async ({ id, addressData }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/shipping/address/${id}`, addressData, {
        withCredentials: true
      });
      
      return data.address;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update address"
      );
    }
  }
);

/**
 * Delete address
 */
export const deleteAddress = createAsyncThunk(
  "shipping/deleteAddress",
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/api/v1/shipping/address/${id}`, {
        withCredentials: true
      });
      
      return id;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to delete address"
      );
    }
  }
);

/**
 * Set address as default
 */
export const setDefaultAddress = createAsyncThunk(
  "shipping/setDefaultAddress",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await axios.put(`/api/v1/shipping/address/${id}/default`, {}, {
        withCredentials: true
      });
      
      return data.address;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to set default address"
      );
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================
const initialState = {
  // All saved addresses
  addresses: [],
  
  // Currently selected/default address
  selectedAddress: null,
  
  // Validation state
  validationErrors: [],
  isValid: false,
  
  // UI state
  loading: false,
  actionLoading: false, // For individual operations (save, update, delete)
  error: null,
  success: false,
  message: null
};

// ============================================
// SLICE
// ============================================
const shippingSlice = createSlice({
  name: "shipping",
  initialState,
  reducers: {
    removeErrors: (state) => {
      state.error = null;
      state.validationErrors = [];
    },

    removeMessage: (state) => {
      state.message = null;
      state.success = false;
    },

    selectAddress: (state, action) => {
      state.selectedAddress = action.payload;
    },

    clearSelectedAddress: (state) => {
      state.selectedAddress = null;
    },

    resetValidation: (state) => {
      state.validationErrors = [];
      state.isValid = false;
    }
  },

  extraReducers: (builder) => {
    // ============================================
    // VALIDATE ADDRESS
    // ============================================
    builder
      .addCase(validateShippingAddress.pending, (state) => {
        state.actionLoading = true;
        state.validationErrors = [];
        state.isValid = false;
        state.error = null;
      })
      .addCase(validateShippingAddress.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.isValid = true;
        state.validationErrors = [];
        state.message = "Address is valid";
      })
      .addCase(validateShippingAddress.rejected, (state, action) => {
        state.actionLoading = false;
        state.isValid = false;
        state.validationErrors = Array.isArray(action.payload) 
          ? action.payload 
          : [action.payload];
      });

    // ============================================
    // GET SAVED ADDRESSES
    // ============================================
    builder
      .addCase(getSavedAddresses.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getSavedAddresses.fulfilled, (state, action) => {
        state.loading = false;
        state.addresses = action.payload;
        
        // Auto-select default address if none selected
        if (!state.selectedAddress) {
          const defaultAddr = action.payload.find(addr => addr.isDefault);
          if (defaultAddr) {
            state.selectedAddress = defaultAddr;
          }
        }
      })
      .addCase(getSavedAddresses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // ============================================
    // GET DEFAULT ADDRESS
    // ============================================
    builder
      .addCase(getDefaultAddress.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(getDefaultAddress.fulfilled, (state, action) => {
        state.actionLoading = false;
        if (action.payload) {
          state.selectedAddress = action.payload;
        }
      })
      .addCase(getDefaultAddress.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // SAVE ADDRESS
    // ============================================
    builder
      .addCase(saveAddress.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(saveAddress.fulfilled, (state, action) => {
        state.actionLoading = false;
        state.addresses.push(action.payload);
        
        // If this is default or first address, select it
        if (action.payload.isDefault || state.addresses.length === 1) {
          state.selectedAddress = action.payload;
        }
        
        state.message = "Address saved successfully";
        state.success = true;
      })
      .addCase(saveAddress.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // UPDATE ADDRESS
    // ============================================
    builder
      .addCase(updateAddress.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(updateAddress.fulfilled, (state, action) => {
        state.actionLoading = false;
        
        // Update in addresses array
        const index = state.addresses.findIndex(addr => addr._id === action.payload._id);
        if (index !== -1) {
          state.addresses[index] = action.payload;
        }
        
        // Update selected if this is the selected address
        if (state.selectedAddress?._id === action.payload._id) {
          state.selectedAddress = action.payload;
        }
        
        state.message = "Address updated successfully";
        state.success = true;
      })
      .addCase(updateAddress.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // DELETE ADDRESS
    // ============================================
    builder
      .addCase(deleteAddress.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(deleteAddress.fulfilled, (state, action) => {
        state.actionLoading = false;
        
        // Remove from addresses array
        state.addresses = state.addresses.filter(addr => addr._id !== action.payload);
        
        // Clear selected if this was the selected address
        if (state.selectedAddress?._id === action.payload) {
          // Auto-select default or first address
          const defaultAddr = state.addresses.find(addr => addr.isDefault);
          state.selectedAddress = defaultAddr || state.addresses[0] || null;
        }
        
        state.message = "Address deleted successfully";
        state.success = true;
      })
      .addCase(deleteAddress.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });

    // ============================================
    // SET DEFAULT ADDRESS
    // ============================================
    builder
      .addCase(setDefaultAddress.pending, (state) => {
        state.actionLoading = true;
        state.error = null;
      })
      .addCase(setDefaultAddress.fulfilled, (state, action) => {
        state.actionLoading = false;
        
        // Update all addresses - unset old default, set new default
        state.addresses = state.addresses.map(addr => ({
          ...addr,
          isDefault: addr._id === action.payload._id
        }));
        
        // Update selected address
        state.selectedAddress = action.payload;
        
        state.message = "Default address updated";
        state.success = true;
      })
      .addCase(setDefaultAddress.rejected, (state, action) => {
        state.actionLoading = false;
        state.error = action.payload;
      });
  }
});

// ============================================
// ACTIONS
// ============================================
export const {
  removeErrors,
  removeMessage,
  selectAddress,
  clearSelectedAddress,
  resetValidation
} = shippingSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectAddresses = (state) => state.shipping.addresses;
export const selectSelectedAddress = (state) => state.shipping.selectedAddress;
export const selectDefaultAddress = (state) => 
  state.shipping.addresses.find(addr => addr.isDefault) || null;
export const selectAddressById = (id) => (state) => 
  state.shipping.addresses.find(addr => addr._id === id) || null;
export const selectValidationErrors = (state) => state.shipping.validationErrors;
export const selectIsAddressValid = (state) => state.shipping.isValid;

// ============================================
// EXPORT
// ============================================
export default shippingSlice.reducer;