import React from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../pageStyles/AboutPage.css';
import { 
    FiShoppingBag, FiTrendingUp, FiAward, FiUsers, 
    FiGlobe, FiShield, FiHeart, FiTarget, 
    FiStar, FiCheckCircle, FiPackage, FiTruck,
    FiCreditCard, FiHeadphones, FiClock, FiRefreshCw
} from 'react-icons/fi';

function AboutPage() {
    const stats = [
        { icon: <FiUsers />, value: '50K+', label: 'Happy Customers' },
        { icon: <FiPackage />, value: '100K+', label: 'Products Sold' },
        { icon: <FiGlobe />, value: '7', label: 'Categories' },
        { icon: <FiAward />, value: '4.8/5', label: 'Customer Rating' }
    ];

    const values = [
        {
            icon: <FiTarget />,
            title: 'Our Mission',
            description: 'To provide exceptional products and seamless shopping experiences that exceed customer expectations, making quality accessible to everyone.'
        },
        {
            icon: <FiHeart />,
            title: 'Customer First',
            description: 'Every decision we make is driven by our commitment to customer satisfaction. Your trust is our most valuable asset.'
        },
        {
            icon: <FiShield />,
            title: 'Quality Assured',
            description: 'We carefully curate every product, ensuring only the highest quality items reach our customers. Your satisfaction is guaranteed.'
        },
        {
            icon: <FiTrendingUp />,
            title: 'Innovation',
            description: 'Constantly evolving to bring you the latest trends and technologies, we stay ahead to serve you better.'
        }
    ];

    const features = [
        {
            icon: <FiPackage />,
            title: 'Wide Selection',
            description: 'From electronics to fashion, home essentials to sports gear - find everything you need in one place.'
        },
        {
            icon: <FiTruck />,
            title: 'Fast Delivery',
            description: 'Swift and reliable shipping to get your orders to you quickly and safely.'
        },
        {
            icon: <FiCreditCard />,
            title: 'Secure Payment',
            description: 'Multiple payment options with bank-level security to protect your transactions.'
        },
        {
            icon: <FiHeadphones />,
            title: '24/7 Support',
            description: 'Our dedicated support team is always ready to assist you with any queries.'
        },
        {
            icon: <FiRefreshCw />,
            title: 'Easy Returns',
            description: 'Hassle-free return policy because your satisfaction is our priority.'
        },
        {
            icon: <FiStar />,
            title: 'Best Prices',
            description: 'Competitive pricing with regular deals and discounts on your favorite products.'
        }
    ];

    const categories = [
        'Electronics',
        'Clothing & Apparel',
        'Home & Living',
        'Sports & Outdoors',
        'Beauty & Personal Care',
        'Books & Media',
        'Food & Beverages'
    ];

    const timeline = [
        {
            year: '2020',
            title: 'The Beginning',
            description: 'Epic Store was founded with a vision to revolutionize online shopping.'
        },
        {
            year: '2021',
            title: 'Rapid Growth',
            description: 'Expanded our product range to over 7 major categories serving thousands of customers.'
        },
        {
            year: '2022',
            title: 'Innovation',
            description: 'Launched advanced features including AI-powered recommendations and personalized shopping.'
        },
        {
            year: '2023',
            title: 'Global Reach',
            description: 'Extended our shipping network to serve customers across multiple regions.'
        },
        {
            year: '2024',
            title: 'Excellence',
            description: 'Achieved 4.8/5 customer rating and 50,000+ happy customers milestone.'
        }
    ];

    return (
        <>
            <PageTitle title="About Us - Epic Store" />
            <Navbar />

            <div className="about-page">
                {/* Hero Section */}
                <section className="about-hero">
                    <div className="about-hero-content">
                        <div className="about-hero-text">
                            <h1 className="about-hero-title">
                                Welcome to <span className="highlight">Epic Store</span>
                            </h1>
                            <p className="about-hero-subtitle">
                                Your trusted destination for quality products and exceptional service
                            </p>
                            <p className="about-hero-description">
                                Since our inception, we've been committed to bringing you the finest selection of products 
                                across multiple categories, backed by unparalleled customer service and a seamless shopping experience.
                            </p>
                        </div>
                        <div className="about-hero-image">
                            <div className="hero-image-placeholder">
                                <FiShoppingBag className="hero-icon" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Stats Section */}
                <section className="about-stats">
                    <div className="stats-grid">
                        {stats.map((stat, index) => (
                            <div key={index} className="stat-card">
                                <div className="stat-icon">{stat.icon}</div>
                                <h3 className="stat-value">{stat.value}</h3>
                                <p className="stat-label">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Values Section */}
                <section className="about-values">
                    <div className="section-header">
                        <h2 className="section-title">What Drives Us</h2>
                        <p className="section-subtitle">
                            Built on strong foundations of trust, quality, and customer satisfaction
                        </p>
                    </div>
                    <div className="values-grid">
                        {values.map((value, index) => (
                            <div key={index} className="value-card">
                                <div className="value-icon">{value.icon}</div>
                                <h3 className="value-title">{value.title}</h3>
                                <p className="value-description">{value.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Story Section */}
                <section className="about-story">
                    <div className="story-content">
                        <div className="story-text">
                            <h2 className="story-title">Our Story</h2>
                            <p className="story-paragraph">
                                Epic Store began with a simple idea: to create an online shopping destination where quality meets convenience. 
                                We understood that modern consumers deserve better - better products, better prices, and a better shopping experience.
                            </p>
                            <p className="story-paragraph">
                                What started as a small venture has grown into a thriving e-commerce platform serving thousands of customers 
                                daily. Our success is built on trust, transparency, and an unwavering commitment to customer satisfaction.
                            </p>
                            <p className="story-paragraph">
                                Today, we offer an extensive range of products across 7 major categories, from cutting-edge electronics to 
                                stylish apparel, home essentials to sports equipment. Every product is carefully selected to ensure it meets 
                                our high standards of quality and value.
                            </p>
                        </div>
                        <div className="story-image">
                            <div className="story-image-placeholder">
                                <FiTrendingUp className="story-icon" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Timeline Section */}
                <section className="about-timeline">
                    <div className="section-header">
                        <h2 className="section-title">Our Journey</h2>
                        <p className="section-subtitle">
                            Growing stronger, year after year
                        </p>
                    </div>
                    <div className="timeline">
                        {timeline.map((item, index) => (
                            <div key={index} className="timeline-item">
                                <div className="timeline-marker"></div>
                                <div className="timeline-content">
                                    <span className="timeline-year">{item.year}</span>
                                    <h3 className="timeline-title">{item.title}</h3>
                                    <p className="timeline-description">{item.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Features Section */}
                <section className="about-features">
                    <div className="section-header">
                        <h2 className="section-title">Why Choose Epic Store</h2>
                        <p className="section-subtitle">
                            Experience the difference with our exceptional service
                        </p>
                    </div>
                    <div className="features-grid">
                        {features.map((feature, index) => (
                            <div key={index} className="feature-card">
                                <div className="feature-icon">{feature.icon}</div>
                                <h3 className="feature-title">{feature.title}</h3>
                                <p className="feature-description">{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Categories Section */}
                <section className="about-categories">
                    <div className="section-header">
                        <h2 className="section-title">Shop Our Categories</h2>
                        <p className="section-subtitle">
                            Explore our diverse range of quality products
                        </p>
                    </div>
                    <div className="categories-grid">
                        {categories.map((category, index) => (
                            <div key={index} className="category-card">
                                <FiCheckCircle className="category-icon" />
                                <span className="category-name">{category}</span>
                            </div>
                        ))}
                    </div>
                </section>

                {/* CTA Section */}
                <section className="about-cta">
                    <div className="cta-content">
                        <h2 className="cta-title">Ready to Start Shopping?</h2>
                        <p className="cta-description">
                            Join thousands of satisfied customers and discover why Epic Store is the preferred choice for online shopping.
                        </p>
                        <div className="cta-buttons">
                            <a href="/products" className="cta-btn cta-btn-primary">
                                Browse Products
                            </a>
                            <a href="/contact" className="cta-btn cta-btn-secondary">
                                Contact Us
                            </a>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </>
    );
}

export default AboutPage;