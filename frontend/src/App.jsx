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


function App() {
  const {isAuthenticated, user} = useSelector(state  => state.user);
  const dispatch = useDispatch()

   // Always load user on app start
  useEffect(() => {
    dispatch(loadUser());
  }, [dispatch]);

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

      </Routes>
      {isAuthenticated && <UserDashboard user={user}/>}
     </Router>
     
  )
}

export default App
