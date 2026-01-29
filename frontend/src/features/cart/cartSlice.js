import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// HELPER: Debounce utility for API calls
// ============================================
let debounceTimer = null;
const debounce = (func, delay) => {
  return (...args) => {
    clearTimeout(debounceTimer);
    return new Promise((resolve) => {
      debounceTimer = setTimeout(() => {
        resolve(func(...args));
      }, delay);
    });
  };
};

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Validate product availability before adding to cart
 * Prevents adding out-of-stock items
 */
export const validateProductAvailability = createAsyncThunk(
  "cart/validateProductAvailability",
  async ({ productId, quantity }, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(
        `/api/v1/products/${productId}/availability?quantity=${quantity}`
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Availability check failed" }
      );
    }
  }
);

/**
 * Add item to cart with stock validation
 * Uses server-side stock check before adding
 */
export const addItemsToCart = createAsyncThunk(
  "cart/addItemsToCart",
  async ({ id, quantity }, { rejectWithValue, dispatch }) => {
    try {
      // Step 1: Validate stock availability
      const availabilityResult = await dispatch(
        validateProductAvailability({ productId: id, quantity })
      ).unwrap();

      if (!availabilityResult.isAvailable) {
        throw new Error(
          `Only ${availabilityResult.maxAvailable} available for ${availabilityResult.name}`
        );
      }

      // Step 2: Get product details
      const { data } = await axios.get(`/api/v1/product/${id}`);

      // Step 3: Return cart item with database values
      return {
        product: data.product._id,
        name: data.product.name,
        price: data.product.pricing?.regular || data.product.price, // Use pricing structure
        image: data.product.images?.[0]?.url || data.product.image?.[0]?.url,
        stock: data.product.inventory?.stock || data.product.stock,
        quantity,
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: error.message || "Failed to add to cart" }
      );
    }
  }
);

/**
 * Calculate cart pricing from backend
 * CRITICAL: Never trust client-side calculations
 */
export const calculateCartPricing = createAsyncThunk(
  "cart/calculateCartPricing",
  async ({ cartItems, currency = "NGN" }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/calculate", {
        cartItems: cartItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
        })),
        currency,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Price calculation failed" }
      );
    }
  }
);

/**
 * Validate entire cart before checkout
 * Checks stock, pricing, and product availability
 */
export const validateCart = createAsyncThunk(
  "cart/validateCart",
  async ({ cartItems }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/validate", {
        cartItems: cartItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
        })),
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Cart validation failed" }
      );
    }
  }
);

/**
 * Batch validate cart items
 * Returns which items are valid/invalid
 */
export const batchValidateItems = createAsyncThunk(
  "cart/batchValidateItems",
  async ({ cartItems }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/validate-items", {
        items: cartItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
        })),
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Batch validation failed" }
      );
    }
  }
);

/**
 * Merge guest cart with user cart on login
 */
export const mergeGuestCart = createAsyncThunk(
  "cart/mergeGuestCart",
  async ({ guestCartItems }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/merge", {
        guestItems: guestCartItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
        })),
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Cart merge failed" }
      );
    }
  }
);

/**
 * Apply discount code to cart
 */
export const applyDiscountCode = createAsyncThunk(
  "cart/applyDiscountCode",
  async ({ code, cartItems }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/apply-discount", {
        code,
        cartItems: cartItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
        })),
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Invalid discount code" }
      );
    }
  }
);

/**
 * Save items for later
 */
export const saveForLater = createAsyncThunk(
  "cart/saveForLater",
  async ({ productId }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/save-for-later", {
        productId,
      });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to save for later" }
      );
    }
  }
);

// ============================================
// DEBOUNCED PRICING CALCULATOR
// ============================================
const debouncedCalculatePricing = debounce(
  (dispatch, cartItems, currency) => {
    return dispatch(calculateCartPricing({ cartItems, currency }));
  },
  500
);

// ============================================
// INITIAL STATE
// ============================================
const initialState = {
  // Cart items (product IDs + quantities only, NO PRICES)
  cartItems: JSON.parse(localStorage.getItem("cartItems")) || [],
  
  // Items saved for later
  savedForLater: JSON.parse(localStorage.getItem("savedForLater")) || [],
  
  // Server-calculated pricing (NEVER from client)
  pricing: {
    itemPrice: 0,
    taxPrice: 0,
    shippingPrice: 0,
    totalPrice: 0,
    currency: "NGN",
    breakdown: [],
    lastUpdated: null,
  },
  
  // Discount information
  discount: {
    code: null,
    amount: 0,
    type: null,
    applied: false,
  },
  
  // Validation state
  validation: {
    isValid: true,
    errors: [],
    invalidItems: [],
    lastChecked: null,
  },
  
  // UI state
  loading: false,
  pricingLoading: false,
  validationLoading: false,
  error: null,
  success: false,
  message: null,
  
  // Item being removed (for UI feedback)
  removingId: null,
  
  // Shipping information
  shippingInfo: JSON.parse(localStorage.getItem("shippingInfo")) || {},
  
  // Cart metadata
  cartExpiry: localStorage.getItem("cartExpiry") || null,
  lastSync: localStorage.getItem("lastSync") || null,
};

// ============================================
// SLICE
// ============================================
const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    // Remove errors
    removeErrors: (state) => {
      state.error = null;
      state.validation.errors = [];
    },

    // Remove success message
    removeMessage: (state) => {
      state.message = null;
      state.success = false;
    },

    // Remove item from cart (local only)
    removeItemFromCart: (state, action) => {
      const id = action.payload;
      state.removingId = id;
      state.cartItems = state.cartItems.filter((item) => item.product !== id);
      
      // Update localStorage
      localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
      
      // Mark for re-calculation
      state.pricing.lastUpdated = null;
      
      state.removingId = null;
      state.message = "Item removed from cart";
      state.success = true;
    },

    // Update item quantity (local only, triggers re-calculation)
    updateItemQuantity: (state, action) => {
      const { productId, quantity } = action.payload;
      const item = state.cartItems.find((i) => i.product === productId);
      
      if (item) {
        if (quantity > item.stock) {
          state.error = `Only ${item.stock} available`;
          return;
        }
        
        item.quantity = quantity;
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        
        // Mark for re-calculation
        state.pricing.lastUpdated = null;
        state.message = "Quantity updated";
      }
    },

    // Save shipping info
    saveShippingInfo: (state, action) => {
      state.shippingInfo = action.payload;
      localStorage.setItem("shippingInfo", JSON.stringify(state.shippingInfo));
    },

    // Clear cart (after successful order)
    clearCart: (state) => {
      state.cartItems = [];
      state.savedForLater = [];
      state.shippingInfo = {};
      state.pricing = initialState.pricing;
      state.discount = initialState.discount;
      state.validation = initialState.validation;
      state.success = false;
      state.message = null;
      state.error = null;
      
      // Clear localStorage
      localStorage.removeItem("cartItems");
      localStorage.removeItem("savedForLater");
      localStorage.removeItem("shippingInfo");
      localStorage.removeItem("cartExpiry");
      sessionStorage.removeItem("orderItem");
    },

    // Move item to saved for later
    moveToSavedForLater: (state, action) => {
      const productId = action.payload;
      const item = state.cartItems.find((i) => i.product === productId);
      
      if (item) {
        state.savedForLater.push(item);
        state.cartItems = state.cartItems.filter((i) => i.product !== productId);
        
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        localStorage.setItem("savedForLater", JSON.stringify(state.savedForLater));
        
        state.message = "Moved to saved for later";
        state.success = true;
      }
    },

    // Move item from saved to cart
    moveToCartFromSaved: (state, action) => {
      const productId = action.payload;
      const item = state.savedForLater.find((i) => i.product === productId);
      
      if (item) {
        state.cartItems.push(item);
        state.savedForLater = state.savedForLater.filter((i) => i.product !== productId);
        
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        localStorage.setItem("savedForLater", JSON.stringify(state.savedForLater));
        
        state.message = "Moved to cart";
        state.success = true;
      }
    },

    // Remove from saved for later
    removeFromSavedForLater: (state, action) => {
      const productId = action.payload;
      state.savedForLater = state.savedForLater.filter((i) => i.product !== productId);
      localStorage.setItem("savedForLater", JSON.stringify(state.savedForLater));
      state.message = "Removed from saved items";
    },

    // Set cart expiry (7 days)
    setCartExpiry: (state) => {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      state.cartExpiry = expiry.toISOString();
      localStorage.setItem("cartExpiry", state.cartExpiry);
    },

    // Check and clear expired cart
    checkCartExpiry: (state) => {
      if (state.cartExpiry && new Date(state.cartExpiry) < new Date()) {
        state.cartItems = [];
        state.savedForLater = [];
        localStorage.removeItem("cartItems");
        localStorage.removeItem("savedForLater");
        localStorage.removeItem("cartExpiry");
        state.message = "Cart expired and cleared";
      }
    },

    // Update last sync timestamp
    updateLastSync: (state) => {
      state.lastSync = new Date().toISOString();
      localStorage.setItem("lastSync", state.lastSync);
    },

    // Mark invalid items
    markInvalidItems: (state, action) => {
      state.validation.invalidItems = action.payload;
      state.validation.isValid = action.payload.length === 0;
    },

    // Remove invalid items from cart
    removeInvalidItems: (state) => {
      const invalidIds = state.validation.invalidItems.map((item) => item.productId);
      state.cartItems = state.cartItems.filter(
        (item) => !invalidIds.includes(item.product)
      );
      localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
      state.validation.invalidItems = [];
      state.validation.isValid = true;
      state.message = `Removed ${invalidIds.length} invalid items`;
    },
  },

  extraReducers: (builder) => {
    // ============================================
    // ADD ITEM TO CART
    // ============================================
    builder
      .addCase(addItemsToCart.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(addItemsToCart.fulfilled, (state, action) => {
        const item = action.payload;
        const existingItem = state.cartItems.find((i) => i.product === item.product);

        if (existingItem) {
          // Update existing item
          existingItem.quantity = item.quantity;
          existingItem.price = item.price; // Update with latest DB price
          existingItem.stock = item.stock; // Update stock
          state.message = `Updated ${item.name} quantity`;
        } else {
          // Add new item
          state.cartItems.push(item);
          state.message = `${item.name} added to cart`;
        }

        state.loading = false;
        state.success = true;
        
        // Save to localStorage (IDs + quantities only)
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        
        // Mark pricing as stale (needs recalculation)
        state.pricing.lastUpdated = null;
      })
      .addCase(addItemsToCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Failed to add to cart";
        state.success = false;
      });

    // ============================================
    // CALCULATE CART PRICING
    // ============================================
    builder
      .addCase(calculateCartPricing.pending, (state) => {
        state.pricingLoading = true;
      })
      .addCase(calculateCartPricing.fulfilled, (state, action) => {
        state.pricing = {
          ...action.payload,
          lastUpdated: new Date().toISOString(),
        };
        state.pricingLoading = false;
      })
      .addCase(calculateCartPricing.rejected, (state, action) => {
        state.pricingLoading = false;
        state.error = action.payload?.message || "Price calculation failed";
      });

    // ============================================
    // VALIDATE CART
    // ============================================
    builder
      .addCase(validateCart.pending, (state) => {
        state.validationLoading = true;
      })
      .addCase(validateCart.fulfilled, (state, action) => {
        state.validation = {
          isValid: action.payload.isValid,
          errors: action.payload.errors || [],
          invalidItems: action.payload.invalidItems || [],
          lastChecked: new Date().toISOString(),
        };
        state.validationLoading = false;
      })
      .addCase(validateCart.rejected, (state, action) => {
        state.validationLoading = false;
        state.validation.isValid = false;
        state.validation.errors = [action.payload?.message || "Validation failed"];
      });

    // ============================================
    // BATCH VALIDATE ITEMS
    // ============================================
    builder
      .addCase(batchValidateItems.pending, (state) => {
        state.validationLoading = true;
      })
      .addCase(batchValidateItems.fulfilled, (state, action) => {
        const { validItems, invalidItems } = action.payload;
        
        // Auto-remove invalid items
        if (invalidItems && invalidItems.length > 0) {
          const invalidIds = invalidItems.map((item) => item.productId);
          state.cartItems = state.cartItems.filter(
            (item) => !invalidIds.includes(item.product)
          );
          localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
          state.message = `Removed ${invalidItems.length} out-of-stock items`;
        }
        
        state.validation.invalidItems = invalidItems || [];
        state.validation.isValid = !invalidItems || invalidItems.length === 0;
        state.validationLoading = false;
      })
      .addCase(batchValidateItems.rejected, (state, action) => {
        state.validationLoading = false;
        state.error = action.payload?.message || "Batch validation failed";
      });

    // ============================================
    // MERGE GUEST CART
    // ============================================
    builder
      .addCase(mergeGuestCart.pending, (state) => {
        state.loading = true;
      })
      .addCase(mergeGuestCart.fulfilled, (state, action) => {
        state.cartItems = action.payload.cartItems || [];
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        state.message = "Cart merged successfully";
        state.loading = false;
        state.success = true;
      })
      .addCase(mergeGuestCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Cart merge failed";
      });

    // ============================================
    // APPLY DISCOUNT CODE
    // ============================================
    builder
      .addCase(applyDiscountCode.pending, (state) => {
        state.loading = true;
      })
      .addCase(applyDiscountCode.fulfilled, (state, action) => {
        state.discount = {
          code: action.payload.code,
          amount: action.payload.amount,
          type: action.payload.type,
          applied: true,
        };
        
        // Update pricing with discount
        state.pricing = action.payload.pricing;
        
        state.message = `Discount "${action.payload.code}" applied`;
        state.loading = false;
        state.success = true;
      })
      .addCase(applyDiscountCode.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Invalid discount code";
        state.discount.applied = false;
      });

    // ============================================
    // SAVE FOR LATER
    // ============================================
    builder
      .addCase(saveForLater.fulfilled, (state, action) => {
        const productId = action.meta.arg.productId;
        const item = state.cartItems.find((i) => i.product === productId);
        
        if (item) {
          state.savedForLater.push(item);
          state.cartItems = state.cartItems.filter((i) => i.product !== productId);
          
          localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
          localStorage.setItem("savedForLater", JSON.stringify(state.savedForLater));
          
          state.message = "Saved for later";
          state.success = true;
        }
      })
      .addCase(saveForLater.rejected, (state, action) => {
        state.error = action.payload?.message || "Failed to save for later";
      });
  },
});

// ============================================
// ACTIONS
// ============================================
export const {
  removeErrors,
  removeMessage,
  removeItemFromCart,
  updateItemQuantity,
  saveShippingInfo,
  clearCart,
  moveToSavedForLater,
  moveToCartFromSaved,
  removeFromSavedForLater,
  setCartExpiry,
  checkCartExpiry,
  updateLastSync,
  markInvalidItems,
  removeInvalidItems,
} = cartSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectCartItems = (state) => state.cart.cartItems;
export const selectCartCount = (state) => state.cart.cartItems.length;
export const selectCartPricing = (state) => state.cart.pricing;
export const selectCartValidation = (state) => state.cart.validation;
export const selectSavedForLater = (state) => state.cart.savedForLater;
export const selectDiscount = (state) => state.cart.discount;

// ============================================
// EXPORT
// ============================================
export default cartSlice.reducer;