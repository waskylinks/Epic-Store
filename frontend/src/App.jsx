import React from 'react';
import Home from './pages/Home';
import {BrowserRouter as Router, Routes, Route} from 'react-router-dom';
import ProductDetails from './pages/ProductDetails';
import Products from './pages/Products';
import Register from './User/Register';


function App() {
  return (
     <Router>
      <Routes>
        <Route path='/' element={<Home/>}/>
        <Route path='/product/:id' element={<ProductDetails/>}/>
        <Route path='/products' element={<Products />}/>
        <Route path='/products/:keyword' element={<Products />}/>
        <Route path='/register' element={<Register />}/>
      </Routes>
     </Router>
  )
}

export default App
