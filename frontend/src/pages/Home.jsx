import React from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css'
import Navbar from '../components/Navbar';

function Home() {
    return (
        <>
        <Navbar/>
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