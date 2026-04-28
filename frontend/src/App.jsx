import React, { useEffect } from 'react';
import Home from './pages/Home';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProductDetails from './pages/ProductDetails';
import Products from './pages/Products';
import Register from './User/Register';
import Login from './User/Login';
import { useDispatch, useSelector } from 'react-redux';
import { loadUser } from './features/products/userSlice';
import { syncServerCart } from './features/cart/cartSlice';
import Profile from './User/Profile';
import VerifyEmail from './User/VerifyEmail';
import ProtectedRoute from './components/ProtectedRoute';
import UpdateProfile from './User/UpdateProfile';
import UpdatePassword from './User/UpdatePassword';
import ForgotPassword from './User/ForgotPassword';
import VerifyResetCode from './User/VerifyResetCode';
import ResetPassword from './User/ResetPassword';
import Cart from './Cart/Cart';
import Shipping from './Cart/Shipping';
import OrderConfirm from './Cart/OrderConfirm';
import Payment from './Cart/Payment';
import Loader from './components/Loader';
import OrderSuccess from './Cart/OrderSuccess';
import MyOrders from './Orders/MyOrders';
import OrderDetails from './Orders/OrderDetails';
import AdminDashboard from './Admin/AdminDashboard';
import ProductList from './Admin/ProductList';
import CreateProduct from './Admin/CreateProduct';
import UpdateProduct from './Admin/UpdateProduct';
import UserList from './Admin/UserList';
import AllOrders from './Admin/AllOrders';
import ReviewList from './Admin/ReviewList';
import OAuthCallback from './User/OauthCallback';
import RefundRequest from './Orders/RefundRequest';
import AdminRefunds from './Admin/AdminRefunds';
import AdminReturns from './Admin/AdminReturns';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import CategoriesPage from './pages/CategoriesPage';
import SalePage from './pages/SalePage';
import Wishlist from './pages/Wishlist';
import NewArrivals from './pages/NewArrivals';
import ReturnRequest from './Orders/ReturnRequest';
import ScrollToTop from './components/ScrollToTop';
import AnalyticsOverview from './Admin/AnalyticsOverview';
import Reports from './Admin/Reports';
import CustomerAnalytics from './Admin/CustomerAnalytics';
import AttributionAnalytics from './Admin/AttributionAnalytics';
import CheckoutAnalytics from './Admin/CheckoutAnalytics';
import RecoverCart from './Cart/RecoverCart';
import RecoveryEmailManager from './Admin/RecoveryEmailManager';
import MyRefundsReturns from './pages/MyRefundReturns';
import RefundAnalytics from './Admin/RefundAnalytics';
import AdminDiscounts from './Admin/AdminDiscounts';
import UserDiscounts from './pages/UserDiscounts';
import DiscountAnalytics from './Admin/DiscountAnalytics';
import ReturnAnalytics from './Admin/ReturnAnalytics';
import RecoveryEmailAnalytics from './Admin/RecoveryEmailAnalytics';
import CronHealth from './Admin/CronHealth';
// FIX #8: import captureUTMsOnLoad so landing-page UTMs are persisted to
// sessionStorage before the user navigates away from the entry URL.
import { captureUTMsOnLoad } from './features/order/orderSlice';



function App() {
  const { initializing, isAuthenticated } = useSelector(state => state.user);
  const dispatch = useDispatch();

  // Initialize session tracking for analytics
  useEffect(() => {
    // FIX #8: Capture UTM parameters from the landing-page URL into
    // sessionStorage immediately on app mount, before any navigation occurs.
    // getAnalyticsData() in orderSlice reads from sessionStorage, so values
    // are available at order-creation time even though the user will be on
    // /process/payment (no UTMs in URL) by then.
    captureUTMsOnLoad();

    // Session ID — generated once per browser tab and reused for the
    // lifetime of the session so all events can be correlated.
    if (!sessionStorage.getItem('sessionId')) {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('sessionId', sessionId);
      sessionStorage.setItem('landingPage', window.location.pathname);
      sessionStorage.setItem('sessionStartTime', new Date().toISOString());
    }
  }, []);

  // Always load user on app start
  useEffect(() => {
    dispatch(loadUser());
  }, [dispatch]);

  useEffect(() => {
    if (!initializing && isAuthenticated) {
      dispatch(syncServerCart());
    }
  }, [initializing, isAuthenticated, dispatch]);

  // Prevent routes from rendering until loadUser() finishes
  if (initializing) {
    return <Loader />;
  }

  return (
    <Router>
      <ScrollToTop />
      <Routes>
        {/* Public Routes */}
        <Route path='/' element={<Home />} />
        <Route path='/product/:id' element={<ProductDetails />} />
        <Route path='/products' element={<Products />} />
        <Route path='/products/search/:keyword' element={<Products />} />
        <Route path='/products/:slug' element={<ProductDetails />} />
        <Route path='/register' element={<Register />} />
        <Route path='/login' element={<Login />} />
        <Route path='/verify-email' element={<VerifyEmail />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/about-us" element={<AboutPage />} />
        <Route path="/contact-us" element={<ContactPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/sale" element={<SalePage />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/new-arrivals" element={<NewArrivals />} />
        <Route path="/checkout/recover" element={<RecoverCart />} />

        {/* Password Reset Routes */}
        <Route path='/password/forgot' element={<ForgotPassword />} />
        <Route path='/password/verify-code' element={<VerifyResetCode />} />
        <Route path='/password/new' element={<ResetPassword />} />

        {/* Cart Route */}
        <Route path='/cart' element={<Cart />} />

        {/* Protected User Routes */}
        <Route path='/profile' element={<ProtectedRoute element={<Profile />} />} />
        <Route path='/profile/update' element={<ProtectedRoute element={<UpdateProfile />} />} />
        <Route path='/password/update' element={<ProtectedRoute element={<UpdatePassword />} />} />
        <Route path='/shipping' element={<ProtectedRoute element={<Shipping />} />} />
        <Route path='/order/confirm' element={<ProtectedRoute element={<OrderConfirm />} />} />
        <Route path='/process/payment' element={<ProtectedRoute element={<Payment />} />} />
        <Route path='/order/success' element={<ProtectedRoute element={<OrderSuccess />} />} />
        <Route path='/orders/user' element={<ProtectedRoute element={<MyOrders />} />} />
        <Route path='/order/:id' element={<ProtectedRoute element={<OrderDetails />} />} />
        <Route path="/order/:id/refund" element={<ProtectedRoute element={<RefundRequest />} />} />
        <Route path="/order/:id/return" element={<ProtectedRoute element={<ReturnRequest />} />} />
        <Route path='/my-refunds-returns' element={<ProtectedRoute element={<MyRefundsReturns />} />} />
        <Route path="/my-discounts" element={<ProtectedRoute element={<UserDiscounts />} />} />

        {/* Admin Routes */}
        <Route path='/admin/dashboard' element={<ProtectedRoute element={<AdminDashboard />} adminOnly={true} />} />
        <Route path='/admin/products' element={<ProtectedRoute element={<ProductList />} adminOnly={true} />} />
        <Route path='/admin/products/create' element={<ProtectedRoute element={<CreateProduct />} adminOnly={true} />} />
        <Route path='/admin/product/:id' element={<ProtectedRoute element={<UpdateProduct />} adminOnly={true} />} />
        <Route path='/admin/users' element={<ProtectedRoute element={<UserList />} adminOnly={true} />} />
        <Route path='/admin/orders' element={<ProtectedRoute element={<AllOrders />} adminOnly={true} />} />
        <Route path='/admin/reviews' element={<ProtectedRoute element={<ReviewList />} adminOnly={true} />} />
        <Route path='/admin/refunds' element={<ProtectedRoute element={<AdminRefunds />} adminOnly={true} />} />
        <Route path='/admin/returns' element={<ProtectedRoute element={<AdminReturns />} adminOnly={true} />} />
        <Route path='/admin/analytics' element={<ProtectedRoute element={<AnalyticsOverview />} adminOnly={true} />} />
        <Route path='/admin/reports' element={<ProtectedRoute element={<Reports />} adminOnly={true} />} />
        <Route path='/admin/customers' element={<ProtectedRoute element={<CustomerAnalytics />} adminOnly={true} />} />
        <Route path='/admin/attribution' element={<ProtectedRoute element={<AttributionAnalytics />} adminOnly={true} />} />
        <Route path='/admin/checkout' element={<ProtectedRoute element={<CheckoutAnalytics />} adminOnly={true} />} />
        <Route path='/admin/recovery-emails' element={<ProtectedRoute element={<RecoveryEmailManager />} adminOnly={true} />} />
        <Route path='/admin/refund-analytics' element={<ProtectedRoute element={<RefundAnalytics />} adminOnly={true} />} />
        <Route path='/admin/return-analytics' element={<ProtectedRoute element={<ReturnAnalytics />} adminOnly={true} />} />
        <Route path='/admin/discounts' element={<ProtectedRoute element={<AdminDiscounts />} adminOnly={true} />} />
        <Route path='/admin/discounts/new' element={<ProtectedRoute element={<AdminDiscounts />} adminOnly={true} />} />
        <Route path='/admin/discount-analytics' element={<ProtectedRoute element={<DiscountAnalytics />} adminOnly={true} />} />
        <Route path='/admin/recovery-email-analytics' element={<ProtectedRoute element={<RecoveryEmailAnalytics />} adminOnly={true} />} />
        <Route path='/admin/cron-health' element={<ProtectedRoute element={<CronHealth />} adminOnly={true} />} />
      </Routes>
    </Router>
  );
}

export default App;