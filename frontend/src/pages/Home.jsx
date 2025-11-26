import React from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css'
import Navbar from '../components/Navbar';
import ImageSlider from '../components/ImageSlider';

function Home() {
    return (
        <>
        <Navbar/>
        <ImageSlider/>
        <div className="home-container">
            <h2 className="home-heading">
                Trending Now
            </h2>
            <Footer/>
        </div>
        </>
        
    )
}

export default Home;