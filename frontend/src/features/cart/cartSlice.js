import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

// ============================================
// ASYNC THUNKS - SERVER-SIDE CART OPERATIONS
// ============================================

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

export const addItemsToCart = createAsyncThunk(
  "cart/addItemsToCart",
  async ({ id, quantity }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/cart/add", {
        product: id,
        quantity
      });

      return {
        product:    id,
        serverData: data,
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to add to cart"
      );
    }
  }
);

export const updateCartItemQuantity = createAsyncThunk(
  "cart/updateCartItemQuantity",
  async ({ productId, quantity }, { rejectWithValue }) => {
    try {
      const { data } = await axios.put("/api/v1/cart/update", {
        product: productId,
        quantity
      });

      return {
        productId,
        quantity: data.item?.quantity ?? quantity,
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update cart"
      );
    }
  }
);

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

export const clearEntireCart = createAsyncThunk(
  "cart/clearEntireCart",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { cartItems } = getState().cart;

      await axios.delete("/api/v1/cart/clear", {
        data: { items: cartItems },
      });

      return {};
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to clear cart"
      );
    }
  }
);

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

export const removeDiscountCode = createAsyncThunk(
  "cart/removeDiscountCode",
  async () => ({ success: true })
);

// ============================================
// INITIAL STATE
// ============================================

const initialDiscount = {
  discountId:                null,
  code:                      null,
  type:                      null,
  value:                     null,
  description:               null,
  discountAmount:            0,
  eligibleSubtotal:          0,
  ineligibleSubtotal:        0,
  eligibleProductCategories: [],
  appliedPending:            false,
  applied:                   false,
  remainingBalance: null,       
  balanceAfterUse: null,        
  isPartialAllowed: true, 
};

const initialPricing = {
  itemPrice:     0,
  taxPrice:      0,
  shippingPrice: 0,
  totalPrice:    0,
  currency:      'USD',
};

const initialState = {
  cartItems:    JSON.parse(localStorage.getItem("cartItems")) || [],
  cartDetails:  [],
  pricing:      initialPricing,
  discount:     initialDiscount,
  loading:      false,
  error:        null,
  success:      false,
  message:      null,
  shippingInfo: JSON.parse(localStorage.getItem("shippingInfo")) || {},
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
      state.cartItems    = [];
      state.cartDetails  = [];
      state.shippingInfo = {};
      state.pricing      = initialPricing;
      state.discount     = initialDiscount;

      localStorage.removeItem("cartItems");
      localStorage.removeItem("shippingInfo");

      state.message = "Cart cleared";
      state.success = true;
    },

    clearDiscount: (state) => {
      state.discount = initialDiscount;
      state.pricing  = initialPricing;
      state.message  = "Discount removed";
      state.success  = true;
    },
  },

  extraReducers: (builder) => {
    // ──────────────────────────────────────────────
    // GET CART DETAILS
    // ──────────────────────────────────────────────
    builder
      .addCase(getCartDetails.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(getCartDetails.fulfilled, (state, action) => {
        state.cartDetails = action.payload.cartItems || [];
        state.loading     = false;
      })
      .addCase(getCartDetails.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload || "Failed to load cart";
      });

    // ──────────────────────────────────────────────
    // ADD ITEM TO CART
    // ──────────────────────────────────────────────
    builder
      .addCase(addItemsToCart.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(addItemsToCart.fulfilled, (state, action) => {
        const { product }    = action.payload;
        const serverQuantity = action.payload.serverData?.item?.quantity;

        if (serverQuantity === undefined) {
          state.loading = false;
          state.error   = "Unexpected server response — item quantity missing";
          return;
        }

        const existingItem = state.cartItems.find((i) => i.product === product);

        if (existingItem) {
          existingItem.quantity = serverQuantity;
          state.message = "Cart updated";
        } else {
          state.cartItems.push({ product, quantity: serverQuantity });
          state.message = "Added to cart";
        }

        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));

        state.loading = false;
        state.success = true;
      })
      .addCase(addItemsToCart.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload || "Failed to add to cart";
      });

    // ──────────────────────────────────────────────
    // UPDATE CART ITEM QUANTITY
    // ──────────────────────────────────────────────
    builder
      .addCase(updateCartItemQuantity.pending, (state) => {
        state.loading = true;
        state.error   = null;
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
        state.error   = action.payload || "Failed to update quantity";
      });

    // ──────────────────────────────────────────────
    // REMOVE CART ITEM
    // ──────────────────────────────────────────────
    builder
      .addCase(removeCartItem.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(removeCartItem.fulfilled, (state, action) => {
        const productId   = action.payload;
        state.cartItems   = state.cartItems.filter((item) => item.product !== productId);
        state.cartDetails = state.cartDetails.filter((item) =>
          String(item.product) !== String(productId)
        );

        localStorage.setItem("cartItems", JSON.stringify(state.cartItems));

        state.message = "Item removed from cart";
        state.success = true;
        state.loading = false;
      })
      .addCase(removeCartItem.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload || "Failed to remove item";
      });

    // ──────────────────────────────────────────────
    // CLEAR ENTIRE CART
    // ──────────────────────────────────────────────
    builder
      .addCase(clearEntireCart.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(clearEntireCart.fulfilled, (state) => {
        state.cartItems    = [];
        state.cartDetails  = [];
        state.shippingInfo = {};
        state.pricing      = initialPricing;
        state.discount     = initialDiscount;

        localStorage.removeItem("cartItems");
        localStorage.removeItem("shippingInfo");

        state.message = "Cart cleared successfully";
        state.success = true;
        state.loading = false;
      })
      .addCase(clearEntireCart.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload || "Failed to clear cart";
      });

    // ──────────────────────────────────────────────
    // VALIDATE CHECKOUT
    // ──────────────────────────────────────────────
    builder
      .addCase(validateCheckout.pending, (state) => {
        state.loading  = true;
        state.error    = null;
        state.success  = false;
        state.message  = null;
      })
      .addCase(validateCheckout.fulfilled, (state, action) => {
        if (!state.discount.applied) {
          state.pricing = action.payload.pricing;
        }
        state.loading  = false;
        state.success  = true;
        state.message  = "Cart validated — ready to checkout";
      })
      .addCase(validateCheckout.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message || "Validation failed";

        if (action.payload?.invalidItems) {
          const invalidIds = new Set(
            action.payload.invalidItems.map((item) => String(item.productId))
          );
          state.cartItems   = state.cartItems.filter(
            (item) => !invalidIds.has(String(item.product))
          );
          state.cartDetails = state.cartDetails.filter(
            (item) => !invalidIds.has(String(item.product))
          );
          localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        }
      });

    // ──────────────────────────────────────────────
    // APPLY DISCOUNT CODE
    // ──────────────────────────────────────────────
    builder
      .addCase(applyDiscountCode.pending, (state) => {
        state.loading = true;
        state.error   = null;
      })
      .addCase(applyDiscountCode.fulfilled, (state, action) => {
        const { discount, pricing, appliedPending } = action.payload;
        state.discount = {
          discountId:                discount.id   ?? null,
          code:                      discount.code,
          type:                      discount.type,
          value:                     discount.value,
          description:               discount.description,
          discountAmount:            discount.discountAmount,
          eligibleSubtotal:          discount.eligibleSubtotal   ?? 0,
          ineligibleSubtotal:        discount.ineligibleSubtotal ?? 0,
          eligibleProductCategories: discount.eligibleProductCategories ?? [],
          appliedPending:            appliedPending ?? true,
          applied:                   true,
          remainingBalance: discount.remainingBalance  ?? null,
          balanceAfterUse:  discount.balanceAfterUse   ?? null,
          isPartialAllowed: discount.isPartialAllowed  ?? true,
        };

        state.pricing = pricing;
        state.message = `Discount "${discount.code}" applied — ${
          discount.type === 'percentage'
            ? `${discount.value}% off`
            : `$${discount.discountAmount} off`
        }`;
        state.loading = false;
        state.success = true;
      })
      .addCase(applyDiscountCode.rejected, (state, action) => {
        state.loading                 = false;
        state.error                   = action.payload?.message || "Invalid discount code";
        state.discount.applied        = false;
        state.discount.appliedPending = false;

        if (action.payload?.invalidItems) {
          const invalidIds = new Set(
            action.payload.invalidItems.map((item) => String(item.productId))
          );
          state.cartItems   = state.cartItems.filter(
            (item) => !invalidIds.has(String(item.product))
          );
          state.cartDetails = state.cartDetails.filter(
            (item) => !invalidIds.has(String(item.product))
          );
          localStorage.setItem("cartItems", JSON.stringify(state.cartItems));
        }
      });

    // ──────────────────────────────────────────────
    // REMOVE DISCOUNT CODE
    // ──────────────────────────────────────────────
    builder
      .addCase(removeDiscountCode.fulfilled, (state) => {
        state.discount = initialDiscount;
        state.pricing  = initialPricing;
        state.message  = "Discount removed";
        state.success  = true;
      });
  },
});

// ============================================
// ACTIONS
// ============================================
export const {
  removeErrors,
  removeMessage,
  saveShippingInfo,
  clearCart,
  clearDiscount,
} = cartSlice.actions;

// ============================================
// SELECTORS
// ============================================
export const selectCartItems       = (state) => state.cart.cartItems;
export const selectCartDetails     = (state) => state.cart.cartDetails;
export const selectCartCount       = (state) =>
  state.cart.cartItems.reduce((sum, item) => sum + item.quantity, 0);
export const selectCartPricing     = (state) => state.cart.pricing;
export const selectDiscount        = (state) => state.cart.discount;
export const selectShippingInfo    = (state) => state.cart.shippingInfo;

export const selectHasDiscount     = (state) => state.cart.discount.applied;
export const selectDiscountPending = (state) => state.cart.discount.appliedPending;

export default cartSlice.reducer;