import { configureStore } from "@reduxjs/toolkit";
import productReducer from '../features/products/productSlice';
import userReducer from '../features/products/userSlice';
import cartReducer from '../features/cart/cartSlice';
import paymentReducer from '../features/cart/paymentSlice';
import orderReducer from '../features/cart/orderSlice';
import receiptReducer from '../features/cart/receiptSlice';
import adminReducer from '../features/admin/adminSlice';
import refundReducer from '../features/refunds/refundSlice';
import publicProductsReducer from '../features/publicProducts/publicProductsSlice';
import wishlistReducer from '../features/products/wishlistSlice';
import shippingReducer from '../features/shipping/shippingSlice';
import checkoutReducer from '../features/checkout/checkoutSlice';
import adminRefundReducer from '../features/admin/adminRefundSlice';
import adminReturnReducer from '../features/admin/adminReturnSlice';
import returnReducer from '../features/returns/returnSlice';
import adminProductReducer from '../features/admin/adminProductSlice';
import adminDiscountReducer from '../features/admin/adminDiscountSlice';
import userDiscountReducer from '../features/discount/discountSlice';
import discountAnalyticsReducer from '../features/analytics/discountAnalyticsSlice';
import coreAnalyticsReducer from '../features/analytics/coreAnalyticsSlice';
import dashboardReducer from '../features/analytics/dashboardSlice';
import reportsReducer from '../features/analytics/reportsSlice';
import customerAnalyticsReducer from '../features/analytics/customerAnalyticsSlice';
import attributionReducer from '../features/analytics/attributionSlice';
import operationsReducer from '../features/analytics/operationsSlice';
import returnAnalyticsReducer from '../features/analytics/returnAnalyticsSlice';
import analyticsObservabilityReducer from '../features/analytics/analyticsObservabilitySlice'; // Added
import recoveryReducer from '../features/admin/recoveryEmailSlice';
import cronHealthReducer from '../features/admin/cronHealthSlice';
import cronLogReducer from '../features/admin/cronLogSlice';    

export const store = configureStore({
    reducer: {
        product:               productReducer,
        user:                  userReducer,
        cart:                  cartReducer,
        payment:               paymentReducer,
        receipt:               receiptReducer,
        order:                 orderReducer,
        admin:                 adminReducer,
        publicProducts:        publicProductsReducer,
        wishlist:              wishlistReducer,
        shipping:              shippingReducer,
        checkout:              checkoutReducer,
        adminRefund:           adminRefundReducer,
        adminReturn:           adminReturnReducer,
        adminProducts:         adminProductReducer,
        refund:                refundReducer,
        return:                returnReducer,
        adminDiscount:         adminDiscountReducer,
        userDiscount:          userDiscountReducer,
        discountAnalytics:     discountAnalyticsReducer,
        coreAnalytics:         coreAnalyticsReducer,
        dashboard:             dashboardReducer,
        reports:               reportsReducer,
        customerAnalytics:     customerAnalyticsReducer,
        attribution:           attributionReducer,
        operations:            operationsReducer,
        returnAnalytics:       returnAnalyticsReducer,
        analyticsObservability: analyticsObservabilityReducer, // Added
        recovery:              recoveryReducer,
        cronHealth:            cronHealthReducer,
        cronLog:               cronLogReducer,
    },

    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            immutableCheck:    { warnAfter: 128 },
            serializableCheck: { warnAfter: 128 },
        }),
});