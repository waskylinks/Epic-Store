import React, { useState, useEffect } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../pageStyles/CategoriesPage.css';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { getProduct } from '../features/products/productSlice';
import { 
    FiMonitor, FiShoppingBag, FiHome, FiActivity,
    FiHeart, FiBook, FiCoffee, FiChevronRight,
    FiSearch, FiFilter, FiGrid, FiTrendingUp,
    FiBarChart2, FiPackage, FiLayers
} from 'react-icons/fi';

function CategoriesPage() {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const { products } = useSelector(state => state.product);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState('grid');
    const [sortBy, setSortBy] = useState('name');
    const [categoryStats, setCategoryStats] = useState({});

    const categories = [
        {
            id: 'electronics',
            name: 'Electronics',
            slug: 'Electronics',
            icon: <FiMonitor />,
            description: 'Latest technology, gadgets, and electronic devices',
            color: '#667eea',
            tags: ['Smartphones', 'Laptops', 'Tablets', 'Cameras', 'Audio', 'Wearables']
        },
        {
            id: 'clothing',
            name: 'Clothing & Apparel',
            slug: 'Clothing & Apparel',
            icon: <FiShoppingBag />,
            description: 'Fashion, accessories, and apparel for all ages',
            color: '#f093fb',
            tags: ['Men', 'Women', 'Kids', 'Shoes', 'Accessories', 'Sportswear']
        },
        {
            id: 'home',
            name: 'Home & Living',
            slug: 'Home & Living',
            icon: <FiHome />,
            description: 'Furniture, decor, and home essentials',
            color: '#4facfe',
            tags: ['Furniture', 'Decor', 'Kitchen', 'Bedding', 'Storage', 'Lighting']
        },
        {
            id: 'sports',
            name: 'Sports & Outdoors',
            slug: 'Sports & Outdoors',
            icon: <FiActivity />,
            description: 'Sports equipment, outdoor gear, and fitness products',
            color: '#43e97b',
            tags: ['Fitness', 'Camping', 'Sports', 'Activewear', 'Equipment']
        },
        {
            id: 'beauty',
            name: 'Beauty & Personal Care',
            slug: 'Beauty & Personal Care',
            icon: <FiHeart />,
            description: 'Skincare, cosmetics, and personal care products',
            color: '#fa709a',
            tags: ['Skincare', 'Makeup', 'Haircare', 'Fragrances', 'Tools', 'Bath']
        },
        {
            id: 'books',
            name: 'Books & Media',
            slug: 'Books & Media',
            icon: <FiBook />,
            description: 'Books, e-books, movies, music, and educational content',
            color: '#fbc2eb',
            tags: ['Books', 'E-Books', 'Audio', 'Movies', 'Music', 'Education']
        },
        {
            id: 'food',
            name: 'Food & Beverages',
            slug: 'Food & Beverages',
            icon: <FiCoffee />,
            description: 'Gourmet foods, beverages, and specialty ingredients',
            color: '#fddb92',
            tags: ['Snacks', 'Beverages', 'Organic', 'Specialty', 'Health Foods']
        }
    ];

    useEffect(() => {
        dispatch(getProduct({ keyword: '', page: 1, category: '' }));
    }, [dispatch]);

    useEffect(() => {
        if (products && products.length > 0) {
            const stats = {};
            categories.forEach(cat => {
                const categoryProducts = products.filter(p => p.category === cat.slug);
                const totalProducts = categoryProducts.length;
                const avgRating = totalProducts > 0 
                    ? (categoryProducts.reduce((sum, p) => sum + (p.ratings || 0), 0) / totalProducts).toFixed(1)
                    : 0;
                const onSale = categoryProducts.filter(p => p.pricing?.sale || p.isOnSale).length;
                
                stats[cat.slug] = {
                    total: totalProducts,
                    avgRating,
                    onSale,
                    newArrivals: categoryProducts.filter(p => p.isNewArrival).length
                };
            });
            setCategoryStats(stats);
        }
    }, [products]);

    const handleCategoryClick = (category) => {
        navigate(`/products?category=${encodeURIComponent(category.slug)}`);
    };

    const filteredCategories = categories.filter(cat =>
        cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cat.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cat.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const sortedCategories = [...filteredCategories].sort((a, b) => {
        const statsA = categoryStats[a.slug] || { total: 0 };
        const statsB = categoryStats[b.slug] || { total: 0 };
        
        switch (sortBy) {
            case 'name':
                return a.name.localeCompare(b.name);
            case 'products':
                return statsB.total - statsA.total;
            case 'rating':
                return statsB.avgRating - statsA.avgRating;
            default:
                return 0;
        }
    });

    const totalProducts = Object.values(categoryStats).reduce((sum, stat) => sum + stat.total, 0);
    const totalOnSale = Object.values(categoryStats).reduce((sum, stat) => sum + stat.onSale, 0);
    const avgRatingAll = Object.values(categoryStats).length > 0
        ? (Object.values(categoryStats).reduce((sum, stat) => sum + parseFloat(stat.avgRating || 0), 0) / Object.values(categoryStats).length).toFixed(1)
        : 0;

    return (
        <>
            <PageTitle title="Product Categories - Epic Store" />
            <Navbar />

            <div className="cat-page">
                {/* Breadcrumb & Header */}
                <div className="cat-breadcrumb">
                    <button onClick={() => navigate('/')}>Home</button>
                    <FiChevronRight />
                    <span>Categories</span>
                </div>

                <div className="cat-header-section">
                    <div className="cat-header-content">
                        <h1 className="cat-main-title">Product Categories</h1>
                        <p className="cat-main-subtitle">
                            Browse our complete catalog organized by category
                        </p>
                    </div>

                    {/* Quick Stats */}
                    <div className="cat-quick-stats">
                        <div className="cat-quick-stat">
                            <FiPackage className="cat-quick-icon" />
                            <div>
                                <h3>{totalProducts}</h3>
                                <p>Total Products</p>
                            </div>
                        </div>
                        <div className="cat-quick-stat">
                            <FiLayers className="cat-quick-icon" />
                            <div>
                                <h3>{categories.length}</h3>
                                <p>Categories</p>
                            </div>
                        </div>
                        <div className="cat-quick-stat">
                            <FiTrendingUp className="cat-quick-icon" />
                            <div>
                                <h3>{totalOnSale}</h3>
                                <p>On Sale</p>
                            </div>
                        </div>
                        <div className="cat-quick-stat">
                            <FiBarChart2 className="cat-quick-icon" />
                            <div>
                                <h3>{avgRatingAll}</h3>
                                <p>Avg Rating</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="cat-container">
                    {/* Toolbar */}
                    <div className="cat-toolbar">
                        <div className="cat-search-wrapper">
                            <FiSearch className="cat-toolbar-search-icon" />
                            <input
                                type="text"
                                className="cat-toolbar-search"
                                placeholder="Search categories, tags..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="cat-toolbar-right">
                            <select
                                className="cat-sort-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                            >
                                <option value="name">Sort by Name</option>
                                <option value="products">Sort by Products</option>
                                <option value="rating">Sort by Rating</option>
                            </select>

                            <div className="cat-view-toggle">
                                <button
                                    className={`cat-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                                    onClick={() => setViewMode('grid')}
                                >
                                    <FiGrid />
                                </button>
                                <button
                                    className={`cat-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                                    onClick={() => setViewMode('list')}
                                >
                                    <FiFilter />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Categories Display */}
                    <div className={`cat-display ${viewMode}`}>
                        {sortedCategories.map((category) => {
                            const stats = categoryStats[category.slug] || { total: 0, avgRating: 0, onSale: 0, newArrivals: 0 };
                            
                            return (
                                <div
                                    key={category.id}
                                    className="cat-item"
                                    onClick={() => handleCategoryClick(category)}
                                >
                                    <div className="cat-item-header">
                                        <div 
                                            className="cat-item-icon"
                                            style={{ backgroundColor: category.color }}
                                        >
                                            {category.icon}
                                        </div>
                                        <div className="cat-item-info">
                                            <h3 className="cat-item-name">{category.name}</h3>
                                            <p className="cat-item-desc">{category.description}</p>
                                        </div>
                                    </div>

                                    <div className="cat-item-tags">
                                        {category.tags.slice(0, 6).map((tag, idx) => (
                                            <span key={idx} className="cat-item-tag">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>

                                    <div className="cat-item-stats">
                                        <div className="cat-stat-item">
                                            <FiPackage />
                                            <span>{stats.total} Products</span>
                                        </div>
                                        {stats.avgRating > 0 && (
                                            <div className="cat-stat-item">
                                                <FiBarChart2 />
                                                <span>{stats.avgRating} Rating</span>
                                            </div>
                                        )}
                                        {stats.onSale > 0 && (
                                            <div className="cat-stat-item sale">
                                                <FiTrendingUp />
                                                <span>{stats.onSale} On Sale</span>
                                            </div>
                                        )}
                                        {stats.newArrivals > 0 && (
                                            <div className="cat-stat-item new">
                                                <FiPackage />
                                                <span>{stats.newArrivals} New</span>
                                            </div>
                                        )}
                                    </div>

                                    <button className="cat-item-btn">
                                        Browse Category <FiChevronRight />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* Empty State */}
                    {sortedCategories.length === 0 && (
                        <div className="cat-empty">
                            <FiSearch className="cat-empty-icon" />
                            <h3>No categories found</h3>
                            <p>Try adjusting your search term</p>
                            <button 
                                className="cat-empty-btn"
                                onClick={() => setSearchQuery('')}
                            >
                                Clear Search
                            </button>
                        </div>
                    )}

                    {/* Category Analytics */}
                    <div className="cat-analytics">
                        <h2 className="cat-analytics-title">Category Overview</h2>
                        <div className="cat-analytics-grid">
                            {sortedCategories.map((category) => {
                                const stats = categoryStats[category.slug] || { total: 0 };
                                const percentage = totalProducts > 0 
                                    ? ((stats.total / totalProducts) * 100).toFixed(1)
                                    : 0;

                                return (
                                    <div key={category.id} className="cat-analytics-item">
                                        <div className="cat-analytics-header">
                                            <div 
                                                className="cat-analytics-icon"
                                                style={{ backgroundColor: category.color }}
                                            >
                                                {category.icon}
                                            </div>
                                            <div>
                                                <h4>{category.name}</h4>
                                                <p>{stats.total} products</p>
                                            </div>
                                        </div>
                                        <div className="cat-analytics-bar">
                                            <div 
                                                className="cat-analytics-fill"
                                                style={{ 
                                                    width: `${percentage}%`,
                                                    backgroundColor: category.color
                                                }}
                                            />
                                        </div>
                                        <div className="cat-analytics-percentage">
                                            {percentage}% of catalog
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default CategoriesPage;