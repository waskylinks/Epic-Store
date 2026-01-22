import React, { useState } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../pageStyles/CategoriesPage.css';
import { useNavigate } from 'react-router-dom';
import { 
    FiMonitor, FiShoppingBag, FiHome, FiActivity,
    FiHeart, FiBook, FiCoffee, FiChevronRight,
    FiSearch, FiTrendingUp, FiPackage, FiStar
} from 'react-icons/fi';

function CategoriesPage() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredCategory, setHoveredCategory] = useState(null);

    const categories = [
        {
            id: 'electronics',
            name: 'Electronics',
            slug: 'Electronics',
            icon: <FiMonitor />,
            description: 'Cutting-edge technology and gadgets for your digital lifestyle',
            productCount: '1,234',
            gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            subcategories: ['Smartphones', 'Laptops', 'Tablets', 'Cameras', 'Audio', 'Wearables'],
            featured: true
        },
        {
            id: 'clothing',
            name: 'Clothing & Apparel',
            slug: 'Clothing & Apparel',
            icon: <FiShoppingBag />,
            description: 'Fashion-forward clothing and accessories for every occasion',
            productCount: '2,567',
            gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            subcategories: ['Men\'s Wear', 'Women\'s Wear', 'Kids Fashion', 'Shoes', 'Accessories'],
            featured: true
        },
        {
            id: 'home',
            name: 'Home & Living',
            slug: 'Home & Living',
            icon: <FiHome />,
            description: 'Transform your space with our curated home essentials',
            productCount: '892',
            gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            subcategories: ['Furniture', 'Decor', 'Kitchen', 'Bedding', 'Storage'],
            featured: true
        },
        {
            id: 'sports',
            name: 'Sports & Outdoors',
            slug: 'Sports & Outdoors',
            icon: <FiActivity />,
            description: 'Gear up for adventure and stay active with premium equipment',
            productCount: '1,456',
            gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            subcategories: ['Fitness', 'Outdoor Gear', 'Sports Equipment', 'Activewear'],
            featured: false
        },
        {
            id: 'beauty',
            name: 'Beauty & Personal Care',
            slug: 'Beauty & Personal Care',
            icon: <FiHeart />,
            description: 'Premium beauty products and personal care essentials',
            productCount: '1,789',
            gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            subcategories: ['Skincare', 'Makeup', 'Haircare', 'Fragrances', 'Tools'],
            featured: false
        },
        {
            id: 'books',
            name: 'Books & Media',
            slug: 'Books & Media',
            icon: <FiBook />,
            description: 'Explore worlds of knowledge and entertainment',
            productCount: '3,421',
            gradient: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
            subcategories: ['Books', 'E-Books', 'Audio Books', 'Movies', 'Music'],
            featured: false
        },
        {
            id: 'food',
            name: 'Food & Beverages',
            slug: 'Food & Beverages',
            icon: <FiCoffee />,
            description: 'Quality ingredients and gourmet treats delivered fresh',
            productCount: '567',
            gradient: 'linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)',
            subcategories: ['Snacks', 'Beverages', 'Organic', 'Specialty Foods'],
            featured: false
        }
    ];

    const stats = [
        { icon: <FiPackage />, value: '10,000+', label: 'Products' },
        { icon: <FiTrendingUp />, value: '7', label: 'Categories' },
        { icon: <FiStar />, value: '4.8', label: 'Avg Rating' },
        { icon: <FiShoppingBag />, value: '50K+', label: 'Happy Customers' }
    ];

    const handleCategoryClick = (category) => {
        navigate(`/products?category=${encodeURIComponent(category.slug)}`);
    };

    const filteredCategories = categories.filter(cat =>
        cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cat.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const featuredCategories = filteredCategories.filter(cat => cat.featured);
    const regularCategories = filteredCategories.filter(cat => !cat.featured);

    return (
        <>
            <PageTitle title="Shop by Category - Epic Store" />
            <Navbar />

            <div className="cat-page">
                {/* Hero Section */}
                <section className="cat-hero">
                    <div className="cat-hero-content">
                        <h1 className="cat-hero-title">Explore Our Categories</h1>
                        <p className="cat-hero-subtitle">
                            Discover thousands of products across all your favorite categories
                        </p>
                        
                        {/* Search Bar */}
                        <div className="cat-search-bar">
                            <FiSearch className="cat-search-icon" />
                            <input
                                type="text"
                                className="cat-search-input"
                                placeholder="Search categories..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </section>

                {/* Stats Section */}
                <section className="cat-stats">
                    <div className="cat-stats-grid">
                        {stats.map((stat, index) => (
                            <div key={index} className="cat-stat-card">
                                <div className="cat-stat-icon">{stat.icon}</div>
                                <h3 className="cat-stat-value">{stat.value}</h3>
                                <p className="cat-stat-label">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <div className="cat-container">
                    {/* Featured Categories */}
                    {featuredCategories.length > 0 && (
                        <section className="cat-section">
                            <div className="cat-section-header">
                                <h2 className="cat-section-title">Featured Categories</h2>
                                <p className="cat-section-subtitle">Our most popular shopping destinations</p>
                            </div>

                            <div className="cat-featured-grid">
                                {featuredCategories.map((category) => (
                                    <div
                                        key={category.id}
                                        className="cat-featured-card"
                                        onMouseEnter={() => setHoveredCategory(category.id)}
                                        onMouseLeave={() => setHoveredCategory(null)}
                                        onClick={() => handleCategoryClick(category)}
                                    >
                                        <div 
                                            className="cat-featured-bg"
                                            style={{ background: category.gradient }}
                                        >
                                            <div className="cat-featured-icon">
                                                {category.icon}
                                            </div>
                                        </div>
                                        <div className="cat-featured-content">
                                            <h3 className="cat-featured-name">{category.name}</h3>
                                            <p className="cat-featured-desc">{category.description}</p>
                                            <div className="cat-featured-footer">
                                                <span className="cat-product-count">
                                                    {category.productCount} products
                                                </span>
                                                <button className="cat-explore-btn">
                                                    Explore <FiChevronRight />
                                                </button>
                                            </div>
                                        </div>
                                        
                                        {/* Subcategories Overlay */}
                                        <div className={`cat-subcategories ${hoveredCategory === category.id ? 'show' : ''}`}>
                                            <h4>Browse by:</h4>
                                            <ul>
                                                {category.subcategories.map((sub, idx) => (
                                                    <li key={idx}>
                                                        <FiChevronRight /> {sub}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* All Categories */}
                    {regularCategories.length > 0 && (
                        <section className="cat-section">
                            <div className="cat-section-header">
                                <h2 className="cat-section-title">All Categories</h2>
                                <p className="cat-section-subtitle">Explore our complete catalog</p>
                            </div>

                            <div className="cat-grid">
                                {regularCategories.map((category) => (
                                    <div
                                        key={category.id}
                                        className="cat-card"
                                        onClick={() => handleCategoryClick(category)}
                                    >
                                        <div 
                                            className="cat-card-icon"
                                            style={{ background: category.gradient }}
                                        >
                                            {category.icon}
                                        </div>
                                        <h3 className="cat-card-name">{category.name}</h3>
                                        <p className="cat-card-desc">{category.description}</p>
                                        <div className="cat-card-footer">
                                            <span className="cat-card-count">
                                                {category.productCount} items
                                            </span>
                                            <FiChevronRight className="cat-card-arrow" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Empty State */}
                    {filteredCategories.length === 0 && (
                        <div className="cat-empty">
                            <FiSearch className="cat-empty-icon" />
                            <h3>No categories found</h3>
                            <p>Try adjusting your search term</p>
                        </div>
                    )}
                </div>

                {/* CTA Section */}
                <section className="cat-cta">
                    <div className="cat-cta-content">
                        <h2 className="cat-cta-title">Can't Find What You're Looking For?</h2>
                        <p className="cat-cta-description">
                            Browse all products or use our search to find exactly what you need
                        </p>
                        <div className="cat-cta-buttons">
                            <button 
                                className="cat-cta-btn primary"
                                onClick={() => navigate('/products')}
                            >
                                Browse All Products
                            </button>
                            <button 
                                className="cat-cta-btn secondary"
                                onClick={() => navigate('/contact')}
                            >
                                Contact Us
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </>
    );
}

export default CategoriesPage;