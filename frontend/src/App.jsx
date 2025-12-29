import React, { useEffect } from 'react';
import Home from './pages/Home';
import {BrowserRouter as Router, Routes, Route} from 'react-router-dom';
import ProductDetails from './pages/ProductDetails';
import Products from './pages/Products';
import Register from './User/Register';
import Login from './User/Login';
import { useDispatch, useSelector } from 'react-redux';
import { loadUser } from './features/products/userSlice';
import UserDashboard from './User/UserDashboard';
import Profile from './User/Profile';
import ProtectedRoute from './components/ProtectedRoute';
import UpdateProfile from './User/UpdateProfile';
import UpdatePassword from './User/UpdatePassword';
import ForgotPassword from './User/ForgotPassword';
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


function App() {
  const {isAuthenticated, user} = useSelector(state  => state.user);
  const dispatch = useDispatch()

  const { initializing } = useSelector(state => state.user);

   // Always load user on app start
  useEffect(() => {
    dispatch(loadUser());
  }, [dispatch]);

  // Prevent routes from rendering until loadUser() finishes
  if (initializing) {
    return <Loader />;
  }

  return (
     <Router>
      <Routes>

        <Route path='/' element={<Home/>}/>
        <Route path='/product/:id' element={<ProductDetails/>}/>
        <Route path='/products' element={<Products />}/>
        <Route path='/products/:keyword' element={<Products />}/>
        <Route path='/register' element={<Register />}/>
        <Route path='/login' element={<Login />}/>
        <Route path='/profile' element={<ProtectedRoute element={<Profile />} />} />
        <Route path='/profile/update' element={<ProtectedRoute element={<UpdateProfile />} />}/>
        <Route path='/password/update' element={<ProtectedRoute element={<UpdatePassword />} />}/>
        <Route path='/password/forgot' element={<ForgotPassword />}/>
        <Route path='/reset/:token' element={<ResetPassword />}/>
        <Route path='/cart' element={<Cart />}/>
        <Route path='/shipping' element={<ProtectedRoute element={<Shipping />} />}/>
        <Route path='/order/confirm' element={<ProtectedRoute element={<OrderConfirm />} />}/>
        <Route path='/process/payment' element={<ProtectedRoute element={<Payment />} />}/>
        <Route path='/order/success' element={<ProtectedRoute element={<OrderSuccess />} />}/>
        <Route path='/orders/user' element={<ProtectedRoute element={<MyOrders />} />}/>
        <Route path='/order/:id' element={<ProtectedRoute element={<OrderDetails />} />}/>

        {/*admin routes */}
        <Route path='/admin/dashboard' element={<ProtectedRoute element={<AdminDashboard/>} adminOnly={true}/>}/>
        <Route path='/admin/products' element={<ProtectedRoute element={<ProductList/>} adminOnly={true}/>}/>
        <Route path='/admin/products/create' element={<ProtectedRoute element={<CreateProduct/>} adminOnly={true}/>}/>
        <Route path='/admin/product/:id' element={<ProtectedRoute element={<UpdateProduct/>} adminOnly={true}/>}/>


      </Routes>
      {isAuthenticated && <UserDashboard user={user}/>}
     </Router>
     
  )
}

export default App
