import { configureStore } from "@reduxjs/toolkit";
import productReducer from '../features/products/productSlice';
import userReducer from '../features/products/userSlice';

export const store = configureStore({
    reducer: {
        product: productReducer,
        user: userReducer,
    }
});