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
import AttributionHealthPage from './Admin/AttributionHealthPage';
import AttributionDriftPage from './Admin/AttributionDriftPage';
import QueueHealthPage from './Admin/QueueHealthPage';
import UserEventTracePage from './Admin/UserEventTracePage';

import CompleteProfile from './User/CompleteProfile';

import { initAnalytics, debugAnalyticsState } from './utils/analytics.js';

// ─── META PIXEL ID ────────────────────────────────────────────────────────────
// Read from Vite env — add VITE_META_PIXEL_ID=your_pixel_id to your .env file.
// Must be VITE_ prefixed to be exposed to the browser bundle.
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID;

// ─── GA4 MEASUREMENT ID ───────────────────────────────────────────────────────
// Read from Vite env — add VITE_GA4_MEASUREMENT_ID=G-XXXXXXXXXX to your .env.
const GA4_MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID;

function App() {
  const { initializing, isAuthenticated } = useSelector(state => state.user);
  const dispatch = useDispatch();

  // ── PHASE 1: Analytics + Pixel initialisation ─────────────────────────────
  //
  // Runs ONCE on app mount before any routing occurs.
  //
  // Order matters:
  //   1. initAnalytics()  — captures click IDs, UTMs, creates session ID
  //   2. fbq('init', ...) — initialises Meta Pixel, sets _fbp cookie on domain
  //   3. fbq('track', 'PageView') — fires the initial page view to Meta
  //   4. gtag('config', ...) — initialises GA4, sets _ga cookie on domain
  //
  // Why fbq('init') must run here and not in index.html:
  //   The standard Meta Pixel base code goes in index.html, but that approach
  //   requires hardcoding the Pixel ID. By initialising here from VITE env vars,
  //   the Pixel ID stays out of source control and can differ between environments.
  //   The _fbp cookie is set by fbq('init') — without it every CAPI event has
  //   fbp: null, reducing Meta match rate and attribution accuracy.
  //
  // Why initAnalytics() runs before fbq('init'):
  //   captureClickIds() must capture fbclid from the URL before any redirects
  //   or navigation. fbq('init') itself does not capture fbclid from the URL
  //   into localStorage — that is handled by our SDK. The _fbc cookie is set
  //   by the Pixel when fbclid is present in the URL, which only works after
  //   fbq('init') runs. Both must run on the same tick for fbclid pages.
  useEffect(() => {
    // Step 1 — capture UTMs, click IDs, create session
    initAnalytics();

    // Step 2 — initialise Meta Pixel
    // fbq('init') sets the _fbp cookie which identifies this browser to Meta.
    // Every subsequent fbq('track') call requires init to have run first.
    // Without init, track calls are silently queued and never dispatched.
    if (META_PIXEL_ID && typeof window.fbq === 'function') {
      window.fbq('init', META_PIXEL_ID);
      window.fbq('track', 'PageView');
    } else if (META_PIXEL_ID) {
      // fbq not loaded yet — this means the Pixel base script in index.html
      // is missing. Add it (see comment below about index.html).
      console.warn('[Analytics] Meta Pixel not loaded — fbq is not defined. Check index.html.');
    }

    // Step 3 — initialise GA4 browser tracking
    // gtag('config') sets the _ga cookie and starts session tracking.
    // Without this, getGA4ClientId() in analytics.js returns null on every
    // event, causing server-side Measurement Protocol events to appear as
    // new users in GA4 reports instead of being stitched to the browser session.
    if (GA4_MEASUREMENT_ID && typeof window.gtag === 'function') {
      window.gtag('config', GA4_MEASUREMENT_ID);
    } else if (GA4_MEASUREMENT_ID) {
      console.warn('[Analytics] GA4 gtag not loaded — gtag is not defined. Check index.html.');
    }

    // Expose debug helper in development
    if (import.meta.env.DEV === true) {
      window.__epicAnalytics = { debug: debugAnalyticsState };
    }
  }, []); // Empty deps — run once on mount only

  // Always load user on app start
  useEffect(() => {
    dispatch(loadUser());
  }, [dispatch]);

  // Sync server cart after auth state is resolved
  useEffect(() => {
    if (!initializing && isAuthenticated) {
      dispatch(syncServerCart());
    }
  }, [initializing, isAuthenticated, dispatch]);

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

        <Route path='/complete-profile' element={<ProtectedRoute element={<CompleteProfile />} />} />

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
        <Route path='/admin/analytics/health' element={<ProtectedRoute element={<AttributionHealthPage />} adminOnly={true} />} />
        <Route path='/admin/analytics/drift' element={<ProtectedRoute element={<AttributionDriftPage />} adminOnly={true} />} />
        <Route path='/admin/analytics/queue' element={<ProtectedRoute element={<QueueHealthPage />} adminOnly={true} />} />
        <Route path='/admin/analytics/user-trace' element={<ProtectedRoute element={<UserEventTracePage />} adminOnly={true} />} />
      </Routes>
    </Router>
  );
}

export default App;