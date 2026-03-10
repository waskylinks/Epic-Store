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
import wishlistReducer from '../features/products/wishlistSlice';
import shippingReducer from '../features/shipping/shippingSlice';
import checkoutReducer from '../features/checkout/checkoutSlice';
import adminRefundReducer from '../features/admin/adminRefundSlice';
import adminReturnReducer from '../features/admin/adminReturnSlice';
import returnReducer from '../features/returns/returnSlice';
import analyticsReducer from '../features/analytics/analyticsSlice';
import adminProductReducer from '../features/admin/adminProductSlice';
import adminDiscountReducer from '../features/admin/adminDiscountSlice';
import discountReducer from '../features/discount/discountSlice';



export const store = configureStore({
    reducer: {
        product: productReducer,
        user: userReducer,
        cart: cartReducer,
        payment: paymentReducer,
        receipt: receiptReducer,
        order: orderReducer,
        admin: adminReducer,
        publicProducts: publicProductsReducer,
        wishlist: wishlistReducer,
        shipping: shippingReducer,
        checkout: checkoutReducer,
        adminRefund: adminRefundReducer,
        adminReturn: adminReturnReducer,
        adminProducts: adminProductReducer,
        refund: refundReducer,
        return: returnReducer,
        analytics: analyticsReducer,
        adminDiscount: adminDiscountReducer,
        discount: discountReducer,

    }
});