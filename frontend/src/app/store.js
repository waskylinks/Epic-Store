import { configureStore } from "@reduxjs/toolkit";
import productReducer from '../features/products/productSlice';
import userReducer from '../features/products/userSlice';
import cartReducer from '../features/cart/cartSlice';
import paymentReducer from '../features/cart/paymentSlice'
import orderReducer from '../features/cart/orderSlice'
import receiptReducer from '../features/cart/receiptSlice'
import adminReducer from '../features/admin/adminSlice'
import refundReducer from '../features/refunds/refundSlice'
import publicProductsReducer from '../features/publicProducts/publicProductsSlice';


export const store = configureStore({
    reducer: {
        product: productReducer,
        user: userReducer,
        cart: cartReducer,
        payment: paymentReducer,
        receipt: receiptReducer,
        order: orderReducer,
        admin: adminReducer,
        refund: refundReducer,
        publicProducts: publicProductsReducer,

    }
});