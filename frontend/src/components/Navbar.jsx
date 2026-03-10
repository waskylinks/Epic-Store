import React, { useState, useEffect, useRef } from 'react';
import '../componentStyles/Navbar.css';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Search as SearchIcon,
  ShoppingCart as ShoppingCartIcon,
  PersonAdd as PersonAddIcon,
  Close as CloseIcon,
  Menu as MenuIcon,
  FavoriteBorder as FavoriteIcon,
  LocalOffer as OfferIcon,
  Storefront as StorefrontIcon,
  Person as PersonIcon,
  ShoppingBag as OrdersIcon,
  Dashboard as DashboardIcon,
  Logout as LogoutIcon,
  KeyboardArrowDown as ArrowDownIcon,
  AssignmentReturn as ReturnsIcon,
} from '@mui/icons-material';
import { useSelector, useDispatch } from 'react-redux';
import { logout, removeSuccess } from '../features/products/userSlice';
import { toast } from 'react-toastify';

const getUserDisplayName = (user) => {
  if (!user) return 'User';
  const firstName = user.firstName?.trim() || '';
  const lastName = user.lastName?.trim() || '';
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (user.fullName && user.fullName !== 'User') return user.fullName;
  if (user.email) {
    const emailUsername = user.email.split('@')[0];
    return emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1).replace(/[._-]/g, ' ');
  }
  return 'User';
};

const getUserAvatar = (user) => {
  if (!user) return './images/profile.webp';
  if (user.avatar && typeof user.avatar === 'object' && user.avatar.url) return user.avatar.url;
  if (user.avatar && typeof user.avatar === 'string') return user.avatar;
  return './images/profile.webp';
};

const getUserInitials = (user) => {
  if (!user) return 'U';
  const firstName = user.firstName?.trim() || '';
  const lastName = user.lastName?.trim() || '';
  if (firstName && lastName) return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  if (firstName) return firstName.charAt(0).toUpperCase();
  if (user.initials) return user.initials;
  return 'U';
};

function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const { count: wishlistCount } = useSelector(state => state.wishlist);

  const { isAuthenticated, user, loading } = useSelector((state) => state.user);
  const { cartItems } = useSelector((state) => state.cart);
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (user) {
      console.log('👤 Navbar - User data received:', {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatar: user.avatar,
        displayName: getUserDisplayName(user),
        initials: getUserInitials(user)
      });
    }
  }, [user]);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
    setIsSearchOpen(false);
    setIsProfileMenuOpen(false);
  }, [location]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };
    if (isProfileMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isMenuOpen]);

  const toggleSearch = () => {
    setIsSearchOpen(!isSearchOpen);
    if (!isSearchOpen) {
      setTimeout(() => document.querySelector('.nb-search-input')?.focus(), 100);
    }
  };

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const toggleProfileMenu = () => setIsProfileMenuOpen(!isProfileMenuOpen);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?keyword=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setIsSearchOpen(false);
    }
  };

  const handleLogout = () => {
    dispatch(logout())
      .unwrap()
      .then(() => {
        toast.success('Logout Successfully', { position: 'top-center', autoClose: 2000 });
        dispatch(removeSuccess());
        setIsProfileMenuOpen(false);
        navigate('/login');
      })
      .catch((error) => {
        toast.error(error?.message || 'Logout Failed', { position: 'top-center', autoClose: 2000 });
      });
  };

  const navLinks = [
    { path: '/', label: 'Home' },
    { path: '/products', label: 'Shop' },
    { path: '/new-arrivals', label: 'New Arrivals' },
    { path: '/categories', label: 'Categories' },
    { path: '/sale', label: 'Sale', highlight: true },
    { path: '/about-us', label: 'About' },
    { path: '/contact-us', label: 'Contact' }
  ];

  const profileMenuOptions = [
    ...(user?.role === 'admin' || user?.role === 'superAdmin' ? [{
      name: 'Admin Dashboard',
      icon: <DashboardIcon />,
      action: () => navigate('/admin/dashboard')
    }] : []),
    { name: 'Account', icon: <PersonIcon />, action: () => navigate('/profile') },
    { name: `Cart (${cartItems.length})`, icon: <ShoppingCartIcon />, action: () => navigate('/cart'), badge: cartItems.length },
    { name: 'Orders', icon: <OrdersIcon />, action: () => navigate('/orders/user') },
    { name: 'Discounts',        icon: <OfferIcon />,       action: () => navigate('/my-discounts') },
    { name: 'Refunds & Returns',  icon: <ReturnsIcon />,    action: () => navigate('/my-refunds-returns') },
    { name: 'Logout', icon: <LogoutIcon />, action: handleLogout, isDanger: true }
  ];

  return (
    <nav className={`nb-navbar ${isScrolled ? 'nb-scrolled' : ''}`}>
      <div className="nb-navbar-container">

        {/* Logo */}
        <div className="nb-navbar-logo">
          <Link to="/" onClick={() => setIsMenuOpen(false)}>
            <StorefrontIcon className="nb-logo-icon" />
            <span className="nb-logo-text">
              Epic <span className="nb-logo-accent">Store</span>
            </span>
          </Link>
        </div>

        {/* Desktop Navigation Links */}
        <div className={`nb-navbar-links ${isMenuOpen ? 'nb-active' : ''}`}>
          <div className="nb-mobile-menu-header">
            <button className="nb-mobile-close" onClick={toggleMenu}>
              <CloseIcon />
            </button>
          </div>

          <ul>
            {navLinks.map((link) => (
              <li key={link.path}>
                <Link
                  to={link.path}
                  className={`nb-nav-link ${link.highlight ? 'nb-highlight' : ''} ${
                    location.pathname === link.path ? 'nb-active' : ''
                  }`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                  {link.highlight && <OfferIcon className="nb-sale-icon" />}
                </Link>
              </li>
            ))}
          </ul>

          {/* Mobile Menu Footer */}
          <div className="nb-mobile-menu-footer">
            {!isAuthenticated ? (
              <Link to="/register" className="nb-mobile-auth-btn" onClick={() => setIsMenuOpen(false)}>
                <PersonAddIcon /> Sign Up / Login
              </Link>
            ) : (
              <div className="nb-mobile-user-section">
                <div className="nb-mobile-user-header">
                  <div className="nb-mobile-user-info">
                    <div className="nb-mobile-profile-wrapper">
                      <img
                        src={getUserAvatar(user)}
                        alt={getUserDisplayName(user)}
                        className="nb-mobile-profile-img"
                        onError={(e) => { e.target.src = './images/profile.webp'; }}
                      />
                    </div>
                    <div className="nb-mobile-user-details">
                      <span className="nb-mobile-user-name">{getUserDisplayName(user)}</span>
                      <span className="nb-mobile-user-email">{user?.email}</span>
                    </div>
                  </div>
                </div>
                <div className="nb-mobile-menu-actions">
                  {profileMenuOptions.map((option, index) => (
                    <button
                      key={index}
                      className={`nb-mobile-menu-action ${option.isDanger ? 'nb-danger' : ''}`}
                      onClick={() => { option.action(); setIsMenuOpen(false); }}
                    >
                      {option.icon}
                      <span>{option.name}</span>
                      {option.badge > 0 && <span className="nb-mobile-action-badge">{option.badge}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side Icons */}
        <div className="nb-navbar-icons">

          {/* Search */}
          <div className={`nb-search-container ${isSearchOpen ? 'nb-active' : ''}`}>
            <div className="nb-search-form">
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearchSubmit(e)}
                className={`nb-search-input ${isSearchOpen ? 'nb-active' : ''}`}
              />
              <button type="button" className="nb-search-toggle" onClick={toggleSearch}>
                {isSearchOpen ? <CloseIcon fontSize="small" /> : <SearchIcon fontSize="small" />}
              </button>
            </div>
          </div>

          {/* Wishlist */}
          <Link to="/wishlist" className="nb-icon-link nb-wishlist-link">
            <div className="nb-cart-container">
              <FavoriteIcon className="nb-icon" />
              {wishlistCount > 0 && <span className="nb-cart-badge">{wishlistCount}</span>}
            </div>
            <span className="nb-icon-label">Wishlist</span>
          </Link>

          {/* Cart */}
          <Link to="/cart" className="nb-icon-link nb-cart-link">
            <div className="nb-cart-container">
              <ShoppingCartIcon className="nb-icon" />
              {cartItems.length > 0 && <span className="nb-cart-badge">{cartItems.length}</span>}
            </div>
            <span className="nb-icon-label">Cart</span>
          </Link>

          {/* User Profile or Register */}
          {!isAuthenticated ? (
            <Link to="/register" className="nb-icon-link nb-register-link">
              <PersonAddIcon className="nb-icon" />
              <span className="nb-icon-label">Sign In</span>
            </Link>
          ) : (
            <div className="nb-profile-dropdown" ref={profileMenuRef}>
              <button
                className={`nb-profile-trigger ${isProfileMenuOpen ? 'nb-active' : ''}`}
                onClick={toggleProfileMenu}
                disabled={loading}
              >
                <div className="nb-profile-img-wrapper">
                  <img
                    src={getUserAvatar(user)}
                    alt={getUserDisplayName(user)}
                    className="nb-profile-img"
                    onError={(e) => { e.target.src = './images/profile.webp'; }}
                  />
                </div>
                <ArrowDownIcon className={`nb-profile-arrow ${isProfileMenuOpen ? 'nb-open' : ''}`} />
              </button>

              {isProfileMenuOpen && !loading && (
                <div className="nb-profile-menu">
                  <div className="nb-profile-menu-header">
                    <div className="nb-profile-menu-avatar-wrapper">
                      <img
                        src={getUserAvatar(user)}
                        alt={getUserDisplayName(user)}
                        className="nb-profile-menu-avatar-img"
                        onError={(e) => { e.target.src = './images/profile.webp'; }}
                      />
                    </div>
                    <div className="nb-profile-menu-info">
                      <span className="nb-profile-menu-name">{getUserDisplayName(user)}</span>
                      <span className="nb-profile-menu-email">{user?.email}</span>
                    </div>
                  </div>
                  <div className="nb-profile-menu-divider"></div>
                  <div className="nb-profile-menu-options">
                    {profileMenuOptions.map((option, index) => (
                      <button
                        key={index}
                        className={`nb-profile-menu-option ${option.isDanger ? 'nb-danger' : ''}`}
                        onClick={option.action}
                      >
                        {option.icon}
                        <span>{option.name}</span>
                        {option.badge > 0 && <span className="nb-profile-option-badge">{option.badge}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hamburger Menu */}
          <button className="nb-hamburger" onClick={toggleMenu} aria-label="Toggle menu">
            {isMenuOpen ? <CloseIcon className="nb-icon" /> : <MenuIcon className="nb-icon" />}
          </button>
        </div>
      </div>

      {/* Overlay for mobile menu */}
      {isMenuOpen && <div className="nb-overlay" onClick={toggleMenu} />}
    </nav>
  );
}

export default Navbar;