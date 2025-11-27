import React, { useEffect } from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css'
import Navbar from '../components/Navbar';
import ImageSlider from '../components/ImageSlider';
import Product from '../components/Product';
import PageTitle from '../components/PageTitle';
import {useDispatch, useSelector} from 'react-redux';
import { getProduct, removeErrors } from '../features/products/productSlice';
import Loader from '../components/Loader';
import { toast } from 'react-toastify';


function Home() {
    const {loading, error, products, productCount} =  useSelector((state) => state.product);
    const dispatch = useDispatch();
    useEffect(() => {
        dispatch(getProduct())
    }, [dispatch])

    useEffect(() => {
        if(error) {
            toast.error(error.message, {position: 'top-center', autoClose: 3000});
            dispatch(removeErrors())
        }
    }, [dispatch, error])

    return (
    <>
    { loading ? (<Loader/>) : (
        <>
        <PageTitle title='Home-Epic Store'/>
        <Navbar/>
        <ImageSlider/>
        <div className="home-container">
            <h2 className="home-heading">
                Trending Now
            </h2>
            <div className="home-product-container">
                { products.map((product, index) => (
                    <Product product={product} key={index}/>
                ))}
            </div>
            <Footer/>
        </div>
        </> 
    )}

    </>  
    )
}

export default Home;