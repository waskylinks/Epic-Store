import React, { useEffect } from 'react';
import Footer from '../components/footer';
import '../pageStyles/Home.css';
import Navbar from '../components/Navbar';
import ImageSlider from '../components/ImageSlider';
import Product from '../components/Product';
import PageTitle from '../components/PageTitle';
import { useDispatch, useSelector } from 'react-redux';
import { getProduct, removeErrors } from '../features/products/productSlice';
import Loader from '../components/Loader';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  LocalShipping,
  Security,
  Verified,
  ArrowForward,
  Star,
  LocalOffer,
  NewReleases,
  CardGiftcard
} from '@mui/icons-material';

function Home() {
    const { loading, error, products, productCount } = useSelector((state) => state.product);
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(getProduct({ keyword: '' }));
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            toast.error(error.message, { position: 'top-center', autoClose: 2000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

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

    // Category showcase data (customize these to match your actual categories)
    const categories = [
        { name: 'Electronics', image: '/images/categories/electronics.jpg', link: '/products?category=electronics' },
        { name: 'Fashion', image: '/images/categories/fashion.jpg', link: '/products?category=fashion' },
        { name: 'Home & Living', image: '/images/categories/home.jpg', link: '/products?category=home' },
        { name: 'Sports', image: '/images/categories/sports.jpg', link: '/products?category=sports' }
    ];

    // Split products into sections
    const trendingProducts = products.slice(0, 8);
    const newArrivals = products.slice(8, 16);
    const featuredProducts = products.slice(0, 4);

    return (
        <>
            {loading ? (
                <Loader />
            ) : (
                <>
                    <PageTitle title='Epic Store' />
                    <Navbar />

                    <div className="home-page">
                        {/* Hero Section with Slider */}
                        <section className="hero-section">
                            <ImageSlider />
                            
                            {/* Hero CTA Overlay (Optional - remove if slider has its own CTAs) */}
                            <div className="hero-overlay">
                                <div className="hero-content">
                                    <h1 className="hero-title">
                                        Shop the Latest <span className="hero-accent">Trends</span>
                                    </h1>
                                    <p className="hero-subtitle">
                                        Discover amazing products at unbeatable prices
                                    </p>
                                    <div className="hero-cta-buttons">
                                        <Link to="/products" className="hero-btn primary">
                                            Shop Now
                                            <ArrowForward />
                                        </Link>
                                        <Link to="/sale" className="hero-btn secondary">
                                            View Deals
                                            <LocalOffer />
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Trust Features Bar */}
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

                        {/* Categories Section */}
                        <section className="categories-section">
                            <div className="container">
                                <div className="section-header">
                                    <h2 className="section-title">Shop by Category</h2>
                                    <Link to="/categories" className="section-link">
                                        View All <ArrowForward />
                                    </Link>
                                </div>
                                <div className="categories-grid">
                                    {categories.map((category, index) => (
                                        <Link 
                                            key={index} 
                                            to={category.link} 
                                            className="category-card"
                                        >
                                            <div className="category-image-wrapper">
                                                <img 
                                                    src={category.image} 
                                                    alt={category.name}
                                                    onError={(e) => {
                                                        e.target.src = '/images/placeholder-category.jpg';
                                                    }}
                                                />
                                                <div className="category-overlay">
                                                    <span className="category-name">{category.name}</span>
                                                    <ArrowForward className="category-arrow" />
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* Featured Products Section */}
                        {featuredProducts.length > 0 && (
                            <section className="featured-section">
                                <div className="container">
                                    <div className="section-header">
                                        <div className="section-header-left">
                                            <Star className="section-icon" />
                                            <h2 className="section-title">Featured Products</h2>
                                        </div>
                                        <Link to="/products" className="section-link">
                                            View All <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="products-grid featured-grid">
                                        {featuredProducts.map((product, index) => (
                                            <Product product={product} key={index} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Trending Now Section */}
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
                                        {trendingProducts.map((product, index) => (
                                            <Product product={product} key={index} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Promotional Banner (Optional - Add between sections) */}
                        <section className="promo-banner-section">
                            <div className="container">
                                <div className="promo-banner">
                                    <div className="promo-content">
                                        <div className="promo-badge">
                                            <LocalOffer /> Limited Time
                                        </div>
                                        <h2 className="promo-title">Summer Sale - Up to 50% Off</h2>
                                        <p className="promo-text">
                                            Don't miss out on amazing deals across all categories
                                        </p>
                                        <Link to="/sale" className="promo-btn">
                                            Shop Sale <ArrowForward />
                                        </Link>
                                    </div>
                                    <div className="promo-image">
                                        {/* Add promotional image here */}
                                        <img 
                                            src="/images/promo-banner.jpg" 
                                            alt="Summer Sale"
                                            onError={(e) => {
                                                e.target.style.display = 'none';
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* New Arrivals Section */}
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
                                        {newArrivals.map((product, index) => (
                                            <Product product={product} key={index} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Newsletter Section */}
                        <section className="newsletter-section">
                            <div className="container">
                                <div className="newsletter-content">
                                    <div className="newsletter-text">
                                        <h2 className="newsletter-title">
                                            Subscribe to Our Newsletter
                                        </h2>
                                        <p className="newsletter-subtitle">
                                            Get exclusive deals, new arrivals & insider-only discounts
                                        </p>
                                    </div>
                                    <form className="newsletter-form">
                                        <input 
                                            type="email" 
                                            placeholder="Enter your email address"
                                            className="newsletter-input"
                                            required
                                        />
                                        <button type="submit" className="newsletter-btn">
                                            Subscribe
                                        </button>
                                    </form>
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