import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Get cart details with fresh product data
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
        error.response?.data || { message: "Failed to load cart" }
      );
    }
  }
);

/**
 * Add item to cart - just store ID and quantity
 */
export const addItemsToCart = createAsyncThunk(
  "cart/addItemsToCart",
  async ({ id, quantity }, { rejectWithValue }) => {
    try {
      return {
        product: id,
        quantity
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to add to cart" }
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
        error.response?.data || { message: "Invalid discount code" }
      );
    }
  }
);

// ============================================
// INITIAL STATE
// ============================================
const initialState = {
  // Minimal cart data: [{product: "id", quantity: 2}]
  cartItems: JSON.parse(localStorage.getItem("cartItems")) || [],
  
  // Full product details (fetched from server)
  cartDetails: [],
  
  // Pricing from server
  pricing: {
    itemPrice: 0,
    taxPrice: 0,
    shippingPrice: 0,
    totalPrice: 0
  },
  
  // Discount
  discount: {
    code: null,
    discountAmount: 0,
    type: null,
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

    removeItemFromCart: (state, action) => {
      const id = action.payload;
      state.cartItems = state.cartItems.filter((item) => item.product !== id);
      state.cartDetails = state.cartDetails.filter((item) => item.product !== id);
      
      localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
      
      state.message = "Item removed from cart";
      state.success = true;
    },

    updateItemQuantity: (state, action) => {
      const { productId, quantity } = action.payload;
      const item = state.cartItems.find((i) => i.product === productId);
      
      if (item) {
        item.quantity = quantity;
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        state.message = "Quantity updated";
        state.success = true;
      }
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
      sessionStorage.removeItem("orderItem");
    }
  },

  extraReducers: (builder) => {
    // GET CART DETAILS
    builder
      .addCase(getCartDetails.pending, (state) => {
        state.loading = true;
      })
      .addCase(getCartDetails.fulfilled, (state, action) => {
        state.cartDetails = action.payload.cartItems || [];
        state.loading = false;
      })
      .addCase(getCartDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Failed to load cart";
      });

    // ADD ITEM TO CART
    builder
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
        state.success = true;
      });

    // VALIDATE CHECKOUT
    builder
      .addCase(validateCheckout.pending, (state) => {
        state.loading = true;
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

    // APPLY DISCOUNT
    builder
      .addCase(applyDiscountCode.pending, (state) => {
        state.loading = true;
      })
      .addCase(applyDiscountCode.fulfilled, (state, action) => {
        state.discount = {
          code: action.payload.code,
          discountAmount: action.payload.discountAmount,
          type: action.payload.type,
          applied: true
        };
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
  }
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
  clearCart
} = cartSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectCartItems = (state) => state.cart.cartItems;
export const selectCartDetails = (state) => state.cart.cartDetails;
export const selectCartCount = (state) => state.cart.cartItems.length;
export const selectCartPricing = (state) => state.cart.pricing;
export const selectDiscount = (state) => state.cart.discount;

// ============================================
// EXPORT
// ============================================
export default cartSlice.reducer;