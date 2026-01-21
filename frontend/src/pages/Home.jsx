import React, { useEffect, useState } from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css';
import Navbar from '../components/Navbar';
import Product from '../components/Product';
import PageTitle from '../components/PageTitle';
import { useDispatch, useSelector } from 'react-redux';
import { removeErrors } from '../features/products/productSlice';
import Loader from '../components/Loader';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  TrendingUp,
  LocalShipping,
  Security,
  Verified,
  ArrowForward,
  NewReleases,
  CardGiftcard
} from '@mui/icons-material';

function Home() {
    const { error } = useSelector((state) => state.product);
    const dispatch = useDispatch();

    // State for different product sections
    const [loading, setLoading] = useState(true);
    const [trendingProducts, setTrendingProducts] = useState([]);
    const [newArrivals, setNewArrivals] = useState([]);
    const [categoryProducts, setCategoryProducts] = useState({});

    // Categories list
    const categories = [
        { name: 'Electronics', key: 'Electronics' },
        { name: 'Clothing & Apparel', key: 'Clothing & Apparel' },
        { name: 'Home & Living', key: 'Home & Living' },
        { name: 'Sports & Outdoors', key: 'Sports & Outdoors' },
        { name: 'Beauty & Personal Care', key: 'Beauty & Personal Care' },
        { name: 'Books & Media', key: 'Books & Media' },
        { name: 'Food & Beverages', key: 'Food & Beverages' }
    ];

    // Trust badges data
    const trustFeatures = [
        {
            icon: <LocalShipping />,
            title: 'Free Shipping',
            description: 'On orders over $50'
        },
        {
            icon: <Security />,
            title: 'Secure Payment',
            description: '100% protected'
        },
        {
            icon: <Verified />,
            title: 'Quality Guaranteed',
            description: 'Certified products'
        },
        {
            icon: <CardGiftcard />,
            title: 'Special Offers',
            description: 'Member discounts'
        }
    ];

    // Fetch all product sections
    useEffect(() => {
        const fetchAllProducts = async () => {
            try {
                setLoading(true);

                // Fetch trending and new arrivals
                const [trendingRes, newArrivalsRes] = await Promise.all([
                    axios.get('/api/v1/products/trending?limit=8'),
                    axios.get('/api/v1/products/new-arrivals?limit=8')
                ]);

                setTrendingProducts(trendingRes.data.products || []);
                setNewArrivals(newArrivalsRes.data.products || []);

                // Fetch products for each category
                const categoryData = {};
                const categoryPromises = categories.map(async (category) => {
                    try {
                        const categoryRes = await axios.get(
                            `/api/v1/products?category=${encodeURIComponent(category.key)}&page=1`
                        );
                        categoryData[category.key] = categoryRes.data.products || [];
                    } catch (err) {
                        console.warn(`Failed to fetch ${category.name}:`, err);
                        categoryData[category.key] = [];
                    }
                });

                await Promise.all(categoryPromises);
                setCategoryProducts(categoryData);

            } catch (err) {
                console.error('Error fetching products:', err);
                toast.error('Failed to load products', { position: 'top-center', autoClose: 2000 });
            } finally {
                setLoading(false);
            }
        };

        fetchAllProducts();
    }, []);

    useEffect(() => {
        if (error) {
            toast.error(error.message, { position: 'top-center', autoClose: 2000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    return (
        <>
            {loading ? (
                <Loader />
            ) : (
                <>
                    <PageTitle title='Epic Store' />
                    <Navbar />

                    <div className="home-page">
                        {/* Trending Products - TOP */}
                        {trendingProducts.length > 0 && (
                            <section className="trending-section">
                                <div className="container">
                                    <div className="section-header">
                                        <div className="section-header-left">
                                            <TrendingUp className="section-icon trending-icon" />
                                            <h2 className="section-title">Trending Now</h2>
                                        </div>
                                        <Link to="/products" className="section-link">
                                            View All <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="products-grid">
                                        {trendingProducts.map((product) => (
                                            <Product product={product} key={product._id} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* New Arrivals */}
                        {newArrivals.length > 0 && (
                            <section className="new-arrivals-section">
                                <div className="container">
                                    <div className="section-header">
                                        <div className="section-header-left">
                                            <NewReleases className="section-icon new-icon" />
                                            <h2 className="section-title">New Arrivals</h2>
                                        </div>
                                        <Link to="/products" className="section-link">
                                            View All <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="products-grid">
                                        {newArrivals.map((product) => (
                                            <Product product={product} key={product._id} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Category Sections */}
                        {categories.map((category) => {
                            const products = categoryProducts[category.key] || [];
                            if (products.length === 0) return null;

                            return (
                                <section key={category.key} className="category-section">
                                    <div className="container">
                                        <div className="section-header">
                                            <h2 className="section-title">{category.name}</h2>
                                            <Link 
                                                to={`/products?category=${encodeURIComponent(category.key)}`}
                                                className="section-link"
                                            >
                                                See More <ArrowForward />
                                            </Link>
                                        </div>
                                        <div className="products-grid">
                                            {products.map((product) => (
                                                <Product product={product} key={product._id} />
                                            ))}
                                        </div>
                                    </div>
                                </section>
                            );
                        })}

                        {/* Trust Features at Bottom */}
                        <section className="trust-features-section">
                            <div className="container">
                                <div className="trust-features-grid">
                                    {trustFeatures.map((feature, index) => (
                                        <div key={index} className="trust-feature-card">
                                            <div className="trust-icon">{feature.icon}</div>
                                            <div className="trust-content">
                                                <h3>{feature.title}</h3>
                                                <p>{feature.description}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* Footer */}
                        <Footer />
                    </div>
                </>
            )}
        </>
    );
}

export default Home;