import React from 'react';
import '../componentStyles/Navbar.css';
import { Link } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';



function Navbar() {
    return (
        <nav className="navbar">
            <div className="navbar-container">
                <div className="navbar-logo">
                    <Link to='/'>Epic Store</Link>
                </div>

                <div className="navbar-links">
                    <ul>
                        <li>
                            <Link to='/'>Home</Link>
                        </li>
                        <li>
                            <Link to='/products'>Products</Link>
                        </li>
                        <li>
                            <Link to='/about-us'>About Us</Link>
                        </li>
                        <li>
                            <Link to='/contact-us'>Contact Us</Link>
                        </li>
                    </ul>
                </div>

                <div className="navbar-icons">
                    <div className="search-container">
                        <form className='search-form'>
                            <input type="text" 
                            className='search-input'
                            placeholder='Search products'
                            />
                            <button className="search-icon">
                                <SearchIcon/>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </nav>
    )
}

export default Navbar;