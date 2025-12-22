import React from 'react';
import '../componentStyles/Footer.css';
import {
  Phone,
  Mail,
  Facebook,
  Twitter,
  GitHub,
  LinkedIn,
  Instagram,
  WhatsApp,
  YouTube
} from '@mui/icons-material';

function Footer() {
  return (
    <footer className='footer'>
      <div className="footer-container">

        {/* Contact Section */}
        <div className="footer-section contact">
          <h3>Contact Us</h3>
          <p><Phone fontSize='small' /> +2349061614369</p>
          <p><Mail fontSize='small' /> likitajoel@gmail.com</p>
          <p><WhatsApp fontSize='small' /> +2348073374527</p>
        </div>

        {/* Quick Links Section */}
        <div className="footer-section links">
          <h3>Quick Links</h3>
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/shop">Shop</a></li>
            <li><a href="/about">About</a></li>
            <li><a href="/contact">Contact</a></li>
            <li><a href="/faq">FAQ</a></li>
          </ul>
        </div>

        {/* Social Section */}
        <div className="footer-section social">
          <h3>Follow Us</h3>
          <div className="social-links">
            <a href='' target='_blank' rel="noopener noreferrer"><GitHub className='social-icon' /></a>
            <a href='' target='_blank' rel="noopener noreferrer"><Facebook className='social-icon' /></a>
            <a href='' target='_blank' rel="noopener noreferrer"><Twitter className='social-icon' /></a>
            <a href='' target='_blank' rel="noopener noreferrer"><LinkedIn className='social-icon' /></a>
            <a href='' target='_blank' rel="noopener noreferrer"><Instagram className='social-icon' /></a>
            <a href='' target='_blank' rel="noopener noreferrer"><YouTube className='social-icon' /></a>
          </div>
        </div>

        {/* About Section */}
        <div className="footer-section about">
          <h3>About Epic Store</h3>
          <p>
            Epic Store delivers quality products you can trust. Fast shipping, secure payments, and a seamless online shopping experience.
          </p>
        </div>

      </div>

      <div className="footer-bottom">
        <p>&copy; 2025 Epic Store. All rights reserved.</p>
      </div>
    </footer>
  );
}

export default Footer;
