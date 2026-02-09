import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ASYNC THUNKS - SERVER-SIDE CART OPERATIONS
// ============================================

/**
 * Get cart details with fresh product data from server
 */
export const getCartDetails = createAsyncThunk(
  "cart/getCartDetails",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { cartItems } = getState().cart;
      
      if (cartItems.length === 0) {
        return { cartItems: [] };
      }

      const { data } = await axios.post("/api/v1/cart/details", {
        items: cartItems
      });
      
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to load cart"
      );
    }
  }
);

/**
 * Add item to cart (server validates stock and price)
 */
export const addItemsToCart = createAsyncThunk(
  "cart/addItemsToCart",
  async ({ id, quantity }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/add", {
        product: id,
        quantity
      });
      
      return {
        product: id,
        quantity,
        serverData: data
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to add to cart"
      );
    }
  }
);

/**
 * Update cart item quantity (server validates)
 */
export const updateCartItemQuantity = createAsyncThunk(
  "cart/updateCartItemQuantity",
  async ({ productId, quantity }, { rejectWithValue }) => {
    try {
      await axios.put("/api/v1/cart/update", {
        product: productId,
        quantity
      });
      
      return { productId, quantity };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update cart"
      );
    }
  }
);

/**
 * Remove item from cart
 */
export const removeCartItem = createAsyncThunk(
  "cart/removeCartItem",
  async (productId, { rejectWithValue }) => {
    try {
      await axios.delete(`/api/v1/cart/remove/${productId}`);
      
      return productId;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to remove item"
      );
    }
  }
);

/**
 * Clear entire cart
 */
export const clearEntireCart = createAsyncThunk(
  "cart/clearEntireCart",
  async (_, { rejectWithValue }) => {
    try {
      await axios.delete("/api/v1/cart/clear");
      
      return {};
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to clear cart"
      );
    }
  }
);

/**
 * Validate cart before checkout
 */
export const validateCheckout = createAsyncThunk(
  "cart/validateCheckout",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { cartItems } = getState().cart;
      
      const { data } = await axios.post("/api/v1/cart/checkout/validate", {
        items: cartItems
      });
      
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Validation failed" }
      );
    }
  }
);

/**
 * Apply discount code
 */
export const applyDiscountCode = createAsyncThunk(
  "cart/applyDiscountCode",
  async ({ code }, { getState, rejectWithValue }) => {
    try {
      const { cartItems } = getState().cart;
      
      const { data } = await axios.post("/api/v1/cart/apply-discount", {
        code,
        items: cartItems
      });
      
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Invalid discount code"
      );
    }
  }
);

/**
 * Remove discount code
 */
export const removeDiscountCode = createAsyncThunk(
  "cart/removeDiscountCode",
  async () => {
    return { success: true };
  }
);

// ============================================
// INITIAL STATE
// ============================================
const initialState = {
  // Minimal cart data stored in localStorage: [{product: "id", quantity: 2}]
  cartItems: JSON.parse(localStorage.getItem("cartItems")) || [],
  
  // Full product details fetched from server
  cartDetails: [],
  
  // Pricing from server validation
  pricing: {
    itemPrice: 0,
    taxPrice: 0,
    shippingPrice: 0,
    totalPrice: 0,
    currency: 'USD'
  },
  
  // Discount info
  discount: {
    code: null,
    discountAmount: 0,
    type: null,
    description: null,
    applied: false
  },
  
  // UI state
  loading: false,
  error: null,
  success: false,
  message: null,
  
  // Shipping info
  shippingInfo: JSON.parse(localStorage.getItem("shippingInfo")) || {}
};

// ============================================
// SLICE
// ============================================
const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },

    removeMessage: (state) => {
      state.message = null;
      state.success = false;
    },

    saveShippingInfo: (state, action) => {
      state.shippingInfo = action.payload;
      localStorage.setItem("shippingInfo", JSON.stringify(state.shippingInfo));
    },

    clearCart: (state) => {
      state.cartItems = [];
      state.cartDetails = [];
      state.shippingInfo = {};
      state.pricing = initialState.pricing;
      state.discount = initialState.discount;
      
      localStorage.removeItem("cartItems");
      localStorage.removeItem("shippingInfo");
      
      state.message = "Cart cleared";
      state.success = true;
    },

    clearDiscount: (state) => {
      state.discount = initialState.discount;
      state.message = "Discount removed";
      state.success = true;
    }
  },

  extraReducers: (builder) => {
    // ============================================
    // GET CART DETAILS
    // ============================================
    builder
      .addCase(getCartDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getCartDetails.fulfilled, (state, action) => {
        state.cartDetails = action.payload.cartItems || [];
        state.loading = false;
      })
      .addCase(getCartDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to load cart";
      });

    // ============================================
    // ADD ITEM TO CART
    // ============================================
    builder
      .addCase(addItemsToCart.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addItemsToCart.fulfilled, (state, action) => {
        const { product, quantity } = action.payload;
        const existingItem = state.cartItems.find((i) => i.product === product);

        if (existingItem) {
          existingItem.quantity = quantity;
          state.message = "Cart updated";
        } else {
          state.cartItems.push({ product, quantity });
          state.message = "Added to cart";
        }

        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        
      })
      .addCase(addItemsToCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to add to cart";
      });

    // ============================================
    // UPDATE CART ITEM QUANTITY
    // ============================================
    builder
      .addCase(updateCartItemQuantity.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateCartItemQuantity.fulfilled, (state, action) => {
        const { productId, quantity } = action.payload;
        const item = state.cartItems.find((i) => i.product === productId);
        
        if (item) {
          item.quantity = quantity;
          localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        }
        
        state.message = "Quantity updated";
        state.success = true;
        state.loading = false;
      })
      .addCase(updateCartItemQuantity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to update quantity";
      });

    // ============================================
    // REMOVE CART ITEM
    // ============================================
    builder
      .addCase(removeCartItem.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(removeCartItem.fulfilled, (state, action) => {
        const productId = action.payload;
        state.cartItems = state.cartItems.filter((item) => item.product !== productId);
        state.cartDetails = state.cartDetails.filter((item) => item.product !== productId);
        
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        
        state.message = "Item removed from cart";
        state.success = true;
        state.loading = false;
      })
      .addCase(removeCartItem.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to remove item";
      });

    // ============================================
    // CLEAR ENTIRE CART
    // ============================================
    builder
      .addCase(clearEntireCart.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(clearEntireCart.fulfilled, (state) => {
        state.cartItems = [];
        state.cartDetails = [];
        state.shippingInfo = {};
        state.pricing = initialState.pricing;
        state.discount = initialState.discount;
        
        localStorage.removeItem("cartItems");
        localStorage.removeItem("shippingInfo");
        
        state.message = "Cart cleared successfully";
        state.success = true;
        state.loading = false;
      })
      .addCase(clearEntireCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to clear cart";
      });

    // ============================================
    // VALIDATE CHECKOUT
    // ============================================
    builder
      .addCase(validateCheckout.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(validateCheckout.fulfilled, (state, action) => {
        state.pricing = action.payload.pricing;
        state.loading = false;
      })
      .addCase(validateCheckout.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Validation failed";
        
        // Remove invalid items if present
        if (action.payload?.invalidItems) {
          const invalidIds = action.payload.invalidItems.map(item => item.productId);
          state.cartItems = state.cartItems.filter(
            item => !invalidIds.includes(item.product)
          );
          localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        }
      });

    // ============================================
    // APPLY DISCOUNT
    // ============================================
    builder
      .addCase(applyDiscountCode.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(applyDiscountCode.fulfilled, (state, action) => {
        state.discount = {
          code: action.payload.discount.code,
          discountAmount: action.payload.discount.discountAmount,
          type: action.payload.discount.type,
          description: action.payload.discount.description,
          applied: true
        };
        state.pricing = action.payload.pricing;
        state.message = `Discount "${action.payload.discount.code}" applied`;
        state.loading = false;
        state.success = true;
      })
      .addCase(applyDiscountCode.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Invalid discount code";
        state.discount.applied = false;
      });

    // ============================================
    // REMOVE DISCOUNT
    // ============================================
    builder
      .addCase(removeDiscountCode.fulfilled, (state) => {
        state.discount = initialState.discount;
        state.message = "Discount removed";
        state.success = true;
      });
  }
});

// ============================================
// ACTIONS
// ============================================
export const {
  removeErrors,
  removeMessage,
  saveShippingInfo,
  clearCart,
  clearDiscount
} = cartSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectCartItems = (state) => state.cart.cartItems;
export const selectCartDetails = (state) => state.cart.cartDetails;
export const selectCartCount = (state) => 
  state.cart.cartItems.reduce((sum, item) => sum + item.quantity, 0);
export const selectCartPricing = (state) => state.cart.pricing;
export const selectDiscount = (state) => state.cart.discount;
export const selectShippingInfo = (state) => state.cart.shippingInfo;

// ============================================
// EXPORT
// ============================================
export default cartSlice.reducer;