import React, { useState } from 'react';
import '../componentStyles/Navbar.css';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search as SearchIcon,
  ShoppingCart as ShoppingCartIcon,
  PersonAdd as PersonAddIcon,
  Close as CloseIcon,
  Menu as MenuIcon
} from '@mui/icons-material';
import { useSelector } from 'react-redux';

function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { isAuthenticated } = useSelector((state) => state.user);
  const { cartItems } = useSelector((state) => state.cart);

  const navigate = useNavigate();

  const toggleSearch = () => setIsSearchOpen(!isSearchOpen);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    navigate(`/products?keyword=${encodeURIComponent(searchQuery.trim())}`);
    setSearchQuery('');
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-logo">
          <Link to="/" onClick={() => setIsMenuOpen(false)}>Epic Store</Link>
        </div>

        <div className={`navbar-links ${isMenuOpen ? 'active' : ''}`}>
          <ul>
            <li><Link to="/" onClick={() => setIsMenuOpen(false)}>Home</Link></li>
            <li><Link to="/products" onClick={() => setIsMenuOpen(false)}>Products</Link></li>
            <li><Link to="/about-us" onClick={() => setIsMenuOpen(false)}>About Us</Link></li>
            <li><Link to="/contact-us" onClick={() => setIsMenuOpen(false)}>Contact Us</Link></li>
          </ul>
        </div>

        <div className="navbar-icons">
          <div className={`search-container ${isSearchOpen ? 'active' : ''}`}>
            <form className='search-form' onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`search-input ${isSearchOpen ? 'active' : ''}`}
              />
              <button type="button" className="search-toggle" onClick={toggleSearch}>
                <SearchIcon fontSize='small' />
              </button>
            </form>
          </div>

          <div className="cart-container">
            <Link to='/cart'>
              <ShoppingCartIcon className='icon' />
              {cartItems.length > 0 && (
                <span className="cart-badge">{cartItems.length}</span>
              )}
            </Link>
          </div>

          {!isAuthenticated && (
            <Link to='/register' className='register-link'>
              <PersonAddIcon className='icon' />
            </Link>
          )}

          <div className="navbar-hamburger" onClick={toggleMenu}>
            {isMenuOpen ? <CloseIcon className='icon' /> : <MenuIcon className='icon' />}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
