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
} from '@mui/icons-material';
import { useSelector, useDispatch } from 'react-redux';
import { logout, removeSuccess } from '../features/products/userSlice';
import { toast } from 'react-toastify';

/**
 * Get user display name - handles firstName/lastName structure
 */
const getUserDisplayName = (user) => {
  if (!user) return 'User';
  
  // Primary: firstName + lastName (your backend structure)
  const firstName = user.firstName?.trim() || '';
  const lastName = user.lastName?.trim() || '';
  
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  
  if (firstName) {
    return firstName;
  }
  
  // Fallback to fullName virtual if available
  if (user.fullName && user.fullName !== 'User') {
    return user.fullName;
  }
  
  // Last resort: extract from email
  if (user.email) {
    const emailUsername = user.email.split('@')[0];
    return emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1).replace(/[._-]/g, ' ');
  }
  
  return 'User';
};

/**
 * Get user avatar URL with fallback
 */
const getUserAvatar = (user) => {
  if (!user) return './images/profile.webp';
  
  // Handle nested avatar object (your backend structure)
  if (user.avatar && typeof user.avatar === 'object' && user.avatar.url) {
    return user.avatar.url;
  }
  
  // Handle direct avatar URL string
  if (user.avatar && typeof user.avatar === 'string') {
    return user.avatar;
  }
  
  return './images/profile.webp';
};

/**
 * Get user initials for display
 */
const getUserInitials = (user) => {
  if (!user) return 'U';
  
  const firstName = user.firstName?.trim() || '';
  const lastName = user.lastName?.trim() || '';
  
  if (firstName && lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }
  
  if (firstName) {
    return firstName.charAt(0).toUpperCase();
  }
  
  if (user.initials) {
    return user.initials;
  }
  
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

  // Debug user data
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

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setIsMenuOpen(false);
    setIsSearchOpen(false);
    setIsProfileMenuOpen(false);
  }, [location]);

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileMenuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMenuOpen]);

  const toggleSearch = () => {
    setIsSearchOpen(!isSearchOpen);
    if (!isSearchOpen) {
      setTimeout(() => {
        document.querySelector('.search-input')?.focus();
      }, 100);
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
    ...(user?.role === 'admin' ? [{
      name: 'Admin Dashboard',
      icon: <DashboardIcon />,
      action: () => navigate('/admin/dashboard')
    }] : []),
    {
      name: 'My Orders',
      icon: <OrdersIcon />,
      action: () => navigate('/orders/user')
    },
    {
      name: 'My Account',
      icon: <PersonIcon />,
      action: () => navigate('/profile')
    },
    {
      name: `Cart (${cartItems.length})`,
      icon: <ShoppingCartIcon />,
      action: () => navigate('/cart'),
      badge: cartItems.length
    },
    {
      name: 'Logout',
      icon: <LogoutIcon />,
      action: handleLogout,
      isDanger: true
    }
  ];

  return (
    <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
      <div className="navbar-container">
        {/* Logo */}
        <div className="navbar-logo">
          <Link to="/" onClick={() => setIsMenuOpen(false)}>
            <StorefrontIcon className="logo-icon" />
            <span className="logo-text">
              Epic <span className="logo-accent">Store</span>
            </span>
          </Link>
        </div>

        {/* Desktop Navigation Links */}
        <div className={`navbar-links ${isMenuOpen ? 'active' : ''}`}>
          <div className="mobile-menu-header">
            <div className="mobile-logo">
              <StorefrontIcon className="logo-icon" />
              <span className="logo-text">
                Epic <span className="logo-accent">Store</span>
              </span>
            </div>
            <button className="mobile-close" onClick={toggleMenu}>
              <CloseIcon />
            </button>
          </div>

          <ul>
            {navLinks.map((link) => (
              <li key={link.path}>
                <Link
                  to={link.path}
                  className={`nav-link ${link.highlight ? 'highlight' : ''} ${
                    location.pathname === link.path ? 'active' : ''
                  }`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                  {link.highlight && <OfferIcon className="sale-icon" />}
                </Link>
              </li>
            ))}
          </ul>

          {/* Mobile Menu Footer */}
          <div className="mobile-menu-footer">
            {!isAuthenticated ? (
              <Link to="/register" className="mobile-auth-btn" onClick={() => setIsMenuOpen(false)}>
                <PersonAddIcon /> Sign Up / Login
              </Link>
            ) : (
              <div className="mobile-user-section">
                <div className="navbar-mobile-user-header">
                  <div className="navbar-mobile-user-info">
                    <div className="navbar-mobile-profile-wrapper">
                      <img
                        src={getUserAvatar(user)}
                        alt={getUserDisplayName(user)}
                        className="navbar-mobile-profile-img"
                        onError={(e) => {
                          e.target.src = './images/profile.webp';
                        }}
                      />
                    </div>
                    <div className="mobile-user-details">
                      <span className="mobile-user-name">{getUserDisplayName(user)}</span>
                      <span className="mobile-user-email">{user?.email}</span>
                    </div>
                  </div>
                </div>
                <div className="mobile-menu-actions">
                  {profileMenuOptions.map((option, index) => (
                    <button
                      key={index}
                      className={`mobile-menu-action ${option.isDanger ? 'danger' : ''}`}
                      onClick={() => {
                        option.action();
                        setIsMenuOpen(false);
                      }}
                    >
                      {option.icon}
                      <span>{option.name}</span>
                      {option.badge > 0 && <span className="mobile-action-badge">{option.badge}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side Icons */}
        <div className="navbar-icons">
          {/* Search */}
          <div className={`search-container ${isSearchOpen ? 'active' : ''}`}>
            <div className="search-form">
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearchSubmit(e)}
                className={`search-input ${isSearchOpen ? 'active' : ''}`}
              />
              <button type="button" className="search-toggle" onClick={toggleSearch}>
                {isSearchOpen ? <CloseIcon fontSize="small" /> : <SearchIcon fontSize="small" />}
              </button>
            </div>
          </div>

          {/* Wishlist */}
          <Link to="/wishlist" className="icon-link wishlist-link">
            <div className="cart-container">
              <FavoriteIcon className="icon" />
              {wishlistCount > 0 && (
                <span className="cart-badge">{wishlistCount}</span>
              )}
            </div>
            <span className="icon-label">Wishlist</span>
          </Link>

          {/* Cart */}
          <Link to="/cart" className="icon-link cart-link">
            <div className="cart-container">
              <ShoppingCartIcon className="icon" />
              {cartItems.length > 0 && (
                <span className="cart-badge">{cartItems.length}</span>
              )}
            </div>
            <span className="icon-label">Cart</span>
          </Link>

          {/* User Profile or Register */}
          {!isAuthenticated ? (
            <Link to="/register" className="icon-link register-link">
              <PersonAddIcon className="icon" />
              <span className="icon-label">Sign In</span>
            </Link>
          ) : (
            <div className="profile-dropdown" ref={profileMenuRef}>
              <button 
                className={`navbar-profile-trigger ${isProfileMenuOpen ? 'active' : ''}`} 
                onClick={toggleProfileMenu}
                disabled={loading}
              >
                <div className="navbar-profile-img-wrapper">
                  <img
                    src={getUserAvatar(user)}
                    alt={getUserDisplayName(user)}
                    className="navbar-profile-img"
                    onError={(e) => {
                      e.target.src = './images/profile.webp';
                    }}
                  />
                </div>
                <ArrowDownIcon className={`profile-arrow ${isProfileMenuOpen ? 'open' : ''}`} />
              </button>

              {isProfileMenuOpen && !loading && (
                <div className="profile-menu">
                  <div className="navbar-profile-menu-header">
                    <div className="navbar-profile-menu-avatar-wrapper">
                      <img
                        src={getUserAvatar(user)}
                        alt={getUserDisplayName(user)}
                        className="navbar-profile-menu-avatar-img"
                        onError={(e) => {
                          e.target.src = './images/profile.webp';
                        }}
                      />
                    </div>
                    <div className="profile-menu-info">
                      <span className="profile-menu-name">{getUserDisplayName(user)}</span>
                      <span className="profile-menu-email">{user?.email}</span>
                    </div>
                  </div>
                  <div className="profile-menu-divider"></div>
                  <div className="profile-menu-options">
                    {profileMenuOptions.map((option, index) => (
                      <button
                        key={index}
                        className={`profile-menu-option ${option.isDanger ? 'danger' : ''}`}
                        onClick={option.action}
                      >
                        {option.icon}
                        <span>{option.name}</span>
                        {option.badge > 0 && (
                          <span className="profile-option-badge">{option.badge}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hamburger Menu */}
          <button className="navbar-hamburger" onClick={toggleMenu} aria-label="Toggle menu">
            {isMenuOpen ? <CloseIcon className="icon" /> : <MenuIcon className="icon" />}
          </button>
        </div>
      </div>

      {/* Overlay for mobile menu */}
      {isMenuOpen && <div className="navbar-overlay" onClick={toggleMenu} />}
    </nav>
  );
}

export default Navbar;