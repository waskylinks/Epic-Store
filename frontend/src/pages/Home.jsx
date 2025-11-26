import React from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css'
import Navbar from '../components/Navbar';
import ImageSlider from '../components/ImageSlider';
import Product from '../components/Product';
import PageTitle from '../components/PageTitle';

const products = [
        {
            "_id": "69189630f8a419d4bf0dd35a",
            "name": "product1",
            "description": "product description",
            "price": 100,
            "ratings": 4.333333333333333,
            "image": [
                {
                    "public_id": "test id",
                    "url": "test url1",
                    "_id": "69189630f8a419d4bf0dd35b"
                }
            ],
            "category": "shirt",
            "stock": 1000,
            "numOfReviews": 3,
            "reviews": [
                {
                    "user": "691b7fb06b44a5a8e814e7d5",
                    "name": "sintex",
                    "rating": 5,
                    "comment": "very good product",
                    "_id": "691f110ee1727b4a458fc15a"
                },
                {
                    "user": "691c71054f5143dba3fda17c",
                    "name": "wasky",
                    "rating": 5,
                    "comment": "good product",
                    "_id": "691f2b1320f2742823fc5f81"
                },
                {
                    "user": "691de44c8bafb1a51bf69c73",
                    "name": "eunice",
                    "rating": 3,
                    "comment": "awesome product",
                    "_id": "691f2d259b4347dbbd2698cf"
                }
            ],
            "createdAt": "2025-11-15T15:03:12.279Z",
            "__v": 4
        },
        {
            "_id": "69189bc6af62b7844c941274",
            "name": "product2",
            "description": "product description2",
            "price": 200,
            "ratings": 0,
            "image": [
                {
                    "public_id": "test id2",
                    "url": "test url2",
                    "_id": "69189bc6af62b7844c941275"
                }
            ],
            "category": "phones",
            "stock": 196,
            "numOfReviews": 0,
            "reviews": [],
            "createdAt": "2025-11-15T15:27:02.776Z",
            "__v": 0
        },
        
        ]
            
    

function Home() {
    return (
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
        
    )
}

export default Home;