import React, { useEffect } from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css';
import Navbar from '../components/Navbar';
import Product from '../components/Product';
import PageTitle from '../components/PageTitle';
import { useDispatch, useSelector } from 'react-redux';
import { 
    fetchTrendingProducts, 
    fetchNewArrivals,
    clearAllErrors 
} from '../features/publicProducts/publicProductsSlice';
import Loader from '../components/Loader';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
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
    const dispatch = useDispatch();
    
    // Get state from Redux
    const { 
        trendingProducts,
        trendingLoading,
        trendingError,
        newArrivals,
        newArrivalsLoading,
        newArrivalsError 
    } = useSelector((state) => state.publicProducts);

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

    // Fetch products on mount
    useEffect(() => {
        dispatch(fetchTrendingProducts({ limit: 8, timeframe: 'month' }));
        dispatch(fetchNewArrivals({ limit: 8, daysBack: 30 }));
        
        // Cleanup errors on unmount
        return () => {
            dispatch(clearAllErrors());
        };
    }, [dispatch]);

    // Handle errors
    useEffect(() => {
        if (trendingError) {
            toast.error(trendingError, { position: 'top-center', autoClose: 2000 });
        }
        if (newArrivalsError) {
            toast.error(newArrivalsError, { position: 'top-center', autoClose: 2000 });
        }
    }, [trendingError, newArrivalsError]);

    // Show loader while initial data is loading
    const isLoading = trendingLoading || newArrivalsLoading;

    return (
        <>
            {isLoading && trendingProducts.length === 0 && newArrivals.length === 0 ? (
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
                                        <Link to="/products/trending" className="section-link">
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
                                        <Link to="/products/new-arrivals" className="section-link">
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