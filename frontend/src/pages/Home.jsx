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
    fetchFeaturedProducts,
    fetchBestsellers,
    clearAllErrors 
} from '../features/publicProducts/publicProductsSlice';
import Loader from '../components/Loader';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { addItemsToCart } from '../features/cart/cartSlice';
import {
  TrendingUp,
  LocalShipping,
  Security,
  Verified,
  ArrowForward,
  NewReleases,
  CardGiftcard,
  Star,
  Whatshot
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
        newArrivalsError,
        featuredProducts,
        featuredLoading,
        featuredError,
        bestsellers,
        bestsellersLoading,
        bestsellersError
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

    // Fetch all product sections on mount
    useEffect(() => {
        dispatch(fetchTrendingProducts({ limit: 8, timeframe: 'month' }));
        dispatch(fetchNewArrivals({ limit: 8, daysBack: 30 }));
        dispatch(fetchFeaturedProducts({ limit: 8 }));
        dispatch(fetchBestsellers({ limit: 8 }));
        
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
        if (featuredError) {
            toast.error(featuredError, { position: 'top-center', autoClose: 2000 });
        }
        if (bestsellersError) {
            toast.error(bestsellersError, { position: 'top-center', autoClose: 2000 });
        }
    }, [trendingError, newArrivalsError, featuredError, bestsellersError]);

    // Quick add to cart handler
    const handleQuickAdd = (productId) => {
        dispatch(addItemsToCart({ id: productId, quantity: 1 }));
    };

    // Show loader only on initial load
    const isInitialLoading = (
        (trendingLoading && trendingProducts.length === 0) &&
        (newArrivalsLoading && newArrivals.length === 0) &&
        (featuredLoading && featuredProducts.length === 0) &&
        (bestsellersLoading && bestsellers.length === 0)
    );

    return (
        <>
            {isInitialLoading ? (
                <Loader />
            ) : (
                <>
                    <PageTitle title='Epic Store' />
                    <Navbar />

                    <div className="home-page">
                        {/* Featured Products */}
                        {featuredProducts.length > 0 && (
                            <section className="featured-section">
                                <div className="container">
                                    <div className="section-header">
                                        <div className="section-header-left">
                                            <Star className="section-icon featured-icon" />
                                            <h2 className="section-title">Featured Products</h2>
                                        </div>
                                        <Link to="/products" className="section-link">
                                            View All <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="products-grid">
                                        {featuredProducts.map((product) => (
                                            <Product 
                                                key={product._id}
                                                product={product}
                                                hideNewBadge={true}
                                                onQuickAdd={handleQuickAdd}
                                                showQuickActions={true}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Trending Products */}
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
                                            <Product 
                                                key={product._id}
                                                product={product}
                                                hideNewBadge={true}
                                                onQuickAdd={handleQuickAdd}
                                                showQuickActions={true}
                                            />
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
                                        <Link to="/new-arrivals" className="section-link">
                                            View All <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="products-grid">
                                        {newArrivals.map((product) => (
                                            <Product 
                                                key={product._id}
                                                product={product}
                                                hideNewBadge={true}
                                                onQuickAdd={handleQuickAdd}
                                                showQuickActions={true}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Bestsellers */}
                        {bestsellers.length > 0 && (
                            <section className="bestsellers-section">
                                <div className="container">
                                    <div className="section-header">
                                        <div className="section-header-left">
                                            <Whatshot className="section-icon bestseller-icon" />
                                            <h2 className="section-title">Best Sellers</h2>
                                        </div>
                                        <Link to="/products" className="section-link">
                                            View All <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="products-grid">
                                        {bestsellers.map((product) => (
                                            <Product 
                                                key={product._id}
                                                product={product}
                                                hideNewBadge={true}
                                                onQuickAdd={handleQuickAdd}
                                                showQuickActions={true}
                                            />
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