import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get or create session ID for cart tracking
 */
const getSessionId = () => {
  let sessionId = sessionStorage.getItem('cartSessionId');
  if (!sessionId) {
    sessionId = `cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('cartSessionId', sessionId);
  }
  return sessionId;
};

/**
 * Get device type
 */
const getDeviceType = () => {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
};

/**
 * Get browser info
 */
const getBrowserInfo = () => {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  return 'Other';
};

// ============================================
// ASYNC THUNKS
// ============================================

/**
 * Get cart details with fresh product data
 * Tracks cart view analytics
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
        items: cartItems,
        sessionId: getSessionId(),
        analytics: {
          device: getDeviceType(),
          browser: getBrowserInfo()
        }
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
 * Add item to cart with analytics tracking
 */
export const addItemsToCart = createAsyncThunk(
  "cart/addItemsToCart",
  async ({ id, quantity }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/add", {
        product: id,
        quantity,
        sessionId: getSessionId(),
        analytics: {
          device: getDeviceType(),
          browser: getBrowserInfo(),
          source: sessionStorage.getItem('trafficSource') || 'direct',
          referrer: document.referrer
        }
      });
      
      return {
        product: id,
        quantity,
        serverData: data
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to add to cart" }
      );
    }
  }
);

/**
 * Update cart item quantity with analytics
 */
export const updateCartItemQuantity = createAsyncThunk(
  "cart/updateCartItemQuantity",
  async ({ productId, quantity }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put("/api/v1/cart/update", {
        product: productId,
        quantity,
        sessionId: getSessionId()
      });
      
      return { productId, quantity };
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to update cart" }
      );
    }
  }
);

/**
 * Remove item from cart with analytics
 */
export const removeCartItem = createAsyncThunk(
  "cart/removeCartItem",
  async (productId, { rejectWithValue }) => {
    try {
      await axios.delete(`/api/v1/cart/remove/${productId}`, {
        data: { sessionId: getSessionId() }
      });
      
      return productId;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to remove item" }
      );
    }
  }
);

/**
 * Validate cart before checkout with funnel tracking
 */
export const validateCheckout = createAsyncThunk(
  "cart/validateCheckout",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { cartItems } = getState().cart;
      
      const { data } = await axios.post("/api/v1/cart/checkout/validate", {
        items: cartItems,
        sessionId: getSessionId()
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
        items: cartItems,
        sessionId: getSessionId()
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
 * Remove discount code
 */
export const removeDiscountCode = createAsyncThunk(
  "cart/removeDiscountCode",
  async (_, { rejectWithValue }) => {
    try {
      // Just recalculate without discount
      return { success: true };
    } catch (error) {
      return rejectWithValue({ message: "Failed to remove discount" });
    }
  }
);

/**
 * Track funnel step (shipping, payment, review)
 */
export const trackFunnelStep = createAsyncThunk(
  "cart/trackFunnelStep",
  async ({ step, metadata = {} }, { rejectWithValue }) => {
    try {
      const endpoint = `/api/v1/cart/${step}`;
      await axios.post(endpoint, {
        sessionId: getSessionId(),
        metadata
      });
      
      return { step, timestamp: new Date().toISOString() };
    } catch (error) {
      // Don't fail the user flow if tracking fails
      console.error('Failed to track funnel step:', error);
      return rejectWithValue(error.response?.data || { message: "Tracking failed" });
    }
  }
);

/**
 * Mark order as complete (final funnel step)
 */
export const trackOrderComplete = createAsyncThunk(
  "cart/trackOrderComplete",
  async ({ orderId }, { rejectWithValue }) => {
    try {
      await axios.post("/api/v1/cart/order-complete", {
        sessionId: getSessionId(),
        orderId
      });
      
      return { orderId };
    } catch (error) {
      console.error('Failed to track order completion:', error);
      return rejectWithValue(error.response?.data || { message: "Tracking failed" });
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
  
  // Funnel tracking
  funnelSteps: [],
  currentStep: null,
  
  // Session tracking
  sessionId: getSessionId(),
  
  // UI state
  loading: false,
  error: null,
  success: false,
  message: null,
  
  // Shipping info
  shippingInfo: JSON.parse(localStorage.getItem("shippingInfo")) || {},
  
  // Tracking flags
  isTrackingEnabled: true,
  lastActivityAt: new Date().toISOString()
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
      state.lastActivityAt = new Date().toISOString();
    },

    updateItemQuantity: (state, action) => {
      const { productId, quantity } = action.payload;
      const item = state.cartItems.find((i) => i.product === productId);
      
      if (item) {
        item.quantity = quantity;
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        state.message = "Quantity updated";
        state.success = true;
        state.lastActivityAt = new Date().toISOString();
      }
    },

    saveShippingInfo: (state, action) => {
      state.shippingInfo = action.payload;
      localStorage.setItem("shippingInfo", JSON.stringify(state.shippingInfo));
      state.lastActivityAt = new Date().toISOString();
    },

    clearCart: (state) => {
      state.cartItems = [];
      state.cartDetails = [];
      state.shippingInfo = {};
      state.pricing = initialState.pricing;
      state.discount = initialState.discount;
      state.funnelSteps = [];
      state.currentStep = null;
      
      localStorage.removeItem("cartItems");
      localStorage.removeItem("shippingInfo");
      sessionStorage.removeItem("orderItem");
      sessionStorage.removeItem("cartSessionId");
      
      state.message = "Cart cleared";
      state.success = true;
    },

    clearDiscount: (state) => {
      state.discount = initialState.discount;
      state.message = "Discount removed";
      state.success = true;
    },

    updateLastActivity: (state) => {
      state.lastActivityAt = new Date().toISOString();
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
        state.lastActivityAt = new Date().toISOString();
      })
      .addCase(getCartDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Failed to load cart";
      });

    // ADD ITEM TO CART
    builder
      .addCase(addItemsToCart.pending, (state) => {
        state.loading = true;
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
        state.success = true;
        state.loading = false;
        state.lastActivityAt = new Date().toISOString();
      })
      .addCase(addItemsToCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Failed to add to cart";
      });

    // UPDATE CART ITEM QUANTITY
    builder
      .addCase(updateCartItemQuantity.pending, (state) => {
        state.loading = true;
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
        state.lastActivityAt = new Date().toISOString();
      })
      .addCase(updateCartItemQuantity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Failed to update quantity";
      });

    // REMOVE CART ITEM
    builder
      .addCase(removeCartItem.fulfilled, (state, action) => {
        const productId = action.payload;
        state.cartItems = state.cartItems.filter((item) => item.product !== productId);
        state.cartDetails = state.cartDetails.filter((item) => item.product !== productId);
        
        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        
        state.message = "Item removed from cart";
        state.success = true;
        state.lastActivityAt = new Date().toISOString();
      })
      .addCase(removeCartItem.rejected, (state, action) => {
        state.error = action.payload?.message || "Failed to remove item";
      });

    // VALIDATE CHECKOUT
    builder
      .addCase(validateCheckout.pending, (state) => {
        state.loading = true;
      })
      .addCase(validateCheckout.fulfilled, (state, action) => {
        state.pricing = action.payload.pricing;
        state.loading = false;
        state.currentStep = 'checkout_start';
        state.lastActivityAt = new Date().toISOString();
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
        state.lastActivityAt = new Date().toISOString();
      })
      .addCase(applyDiscountCode.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || "Invalid discount code";
        state.discount.applied = false;
      });

    // REMOVE DISCOUNT
    builder
      .addCase(removeDiscountCode.fulfilled, (state) => {
        state.discount = initialState.discount;
        state.message = "Discount removed";
        state.success = true;
        state.lastActivityAt = new Date().toISOString();
      });

    // TRACK FUNNEL STEP
    builder
      .addCase(trackFunnelStep.fulfilled, (state, action) => {
        state.funnelSteps.push(action.payload);
        state.currentStep = action.payload.step;
        state.lastActivityAt = new Date().toISOString();
      });

    // TRACK ORDER COMPLETE
    builder
      .addCase(trackOrderComplete.fulfilled, (state, action) => {
        state.currentStep = 'order_complete';
        state.lastActivityAt = new Date().toISOString();
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
  clearCart,
  clearDiscount,
  updateLastActivity
} = cartSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectCartItems = (state) => state.cart.cartItems;
export const selectCartDetails = (state) => state.cart.cartDetails;
export const selectCartCount = (state) => state.cart.cartItems.reduce((sum, item) => sum + item.quantity, 0);
export const selectCartPricing = (state) => state.cart.pricing;
export const selectDiscount = (state) => state.cart.discount;
export const selectCurrentFunnelStep = (state) => state.cart.currentStep;
export const selectSessionId = (state) => state.cart.sessionId;
export const selectShippingInfo = (state) => state.cart.shippingInfo;

// ============================================
// EXPORT
// ============================================
export default cartSlice.reducer;