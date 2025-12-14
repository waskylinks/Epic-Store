import { configureStore } from "@reduxjs/toolkit";
import productReducer from '../features/products/productSlice';
import userReducer from '../features/products/userSlice';
import cartReducer from '../features/cart/cartSlice';
import paymentReducer from '../features/cart/paymentSlice'
import orderReducer from '../features/cart/paymentSlice'

export const store = configureStore({
    reducer: {
        product: productReducer,
        user: userReducer,
        cart: cartReducer,
        payment: paymentReducer,
        order: orderReducer,
    }
});