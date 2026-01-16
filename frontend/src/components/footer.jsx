import React from 'react';
import '../componentStyles/Footer.css';
import { Link } from 'react-router-dom';
import {
  Phone,
  Mail,
  WhatsApp,
  Facebook,
  Twitter,
  GitHub,
  LinkedIn,
  Instagram,
  YouTube,
  Storefront as StorefrontIcon,
  LocationOn,
  Schedule,
  CreditCard,
  LocalShipping,
  Security,
  ArrowForward
} from '@mui/icons-material';

function Footer() {
  const currentYear = new Date().getFullYear();

  const footerLinks = {
    shop: [
      { label: 'All Products', path: '/products' },
      { label: 'New Arrivals', path: '/new-arrivals' },
      { label: 'Categories', path: '/categories' },
      { label: 'Sale', path: '/sale' },
      { label: 'Best Sellers', path: '/best-sellers' }
    ],
    account: [
      { label: 'My Account', path: '/profile' },
      { label: 'Order History', path: '/orders/user' },
      { label: 'Wishlist', path: '/wishlist' },
      { label: 'Track Order', path: '/track-order' },
      { label: 'Shopping Cart', path: '/cart' }
    ],
    support: [
      { label: 'Help Center', path: '/help' },
      { label: 'Contact Us', path: '/contact-us' },
      { label: 'Shipping Info', path: '/shipping' },
      { label: 'Returns', path: '/returns' },
      { label: 'FAQ', path: '/faq' }
    ],
    company: [
      { label: 'About Us', path: '/about-us' },
      { label: 'Privacy Policy', path: '/privacy' },
      { label: 'Terms of Service', path: '/terms' },
      { label: 'Careers', path: '/careers' },
      { label: 'Blog', path: '/blog' }
    ]
  };

  const socialLinks = [
    { icon: <Facebook />, url: 'https://facebook.com', label: 'Facebook' },
    { icon: <Instagram />, url: 'https://instagram.com', label: 'Instagram' },
    { icon: <Twitter />, url: 'https://twitter.com', label: 'Twitter' },
    { icon: <LinkedIn />, url: 'https://linkedin.com', label: 'LinkedIn' },
    { icon: <YouTube />, url: 'https://youtube.com', label: 'YouTube' },
    { icon: <GitHub />, url: 'https://github.com', label: 'GitHub' }
  ];

  const trustFeatures = [
    { icon: <Security />, text: 'Secure Payment' },
    { icon: <LocalShipping />, text: 'Free Shipping' },
    { icon: <CreditCard />, text: 'Easy Returns' }
  ];

  return (
    <footer className="footer">
      {/* Trust Banner */}
      <div className="footer-trust-banner">
        <div className="footer-container">
          <div className="trust-features">
            {trustFeatures.map((feature, index) => (
              <div key={index} className="trust-feature">
                {feature.icon}
                <span>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="footer-main">
        <div className="footer-container">
          <div className="footer-grid">
            
            {/* Brand Section */}
            <div className="footer-section footer-brand">
              <div className="footer-logo">
                <StorefrontIcon className="footer-logo-icon" />
                <span className="footer-logo-text">
                  Epic <span className="footer-logo-accent">Store</span>
                </span>
              </div>
              <p className="footer-description">
                Your trusted destination for quality products. We deliver excellence with every purchase, ensuring a seamless shopping experience from start to finish.
              </p>
              
              {/* Contact Info */}
              <div className="footer-contact">
                <a href="tel:+2349061614369" className="footer-contact-item">
                  <Phone />
                  <span>+234 906 161 4369</span>
                </a>
                <a href="mailto:likitajoel@gmail.com" className="footer-contact-item">
                  <Mail />
                  <span>likitajoel@gmail.com</span>
                </a>
                <a href="https://wa.me/2348073374527" className="footer-contact-item" target="_blank" rel="noopener noreferrer">
                  <WhatsApp />
                  <span>+234 807 337 4527</span>
                </a>
              </div>

              {/* Social Links */}
              <div className="footer-social">
                <h4>Follow Us</h4>
                <div className="footer-social-links">
                  {socialLinks.map((social, index) => (
                    <a 
                      key={index}
                      href={social.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="footer-social-link"
                      aria-label={social.label}
                    >
                      {social.icon}
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* Shop Links */}
            <div className="footer-section footer-links">
              <h3>Shop</h3>
              <ul>
                {footerLinks.shop.map((link, index) => (
                  <li key={index}>
                    <Link to={link.path}>
                      <ArrowForward className="link-arrow" />
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Account Links */}
            <div className="footer-section footer-links">
              <h3>My Account</h3>
              <ul>
                {footerLinks.account.map((link, index) => (
                  <li key={index}>
                    <Link to={link.path}>
                      <ArrowForward className="link-arrow" />
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Support Links */}
            <div className="footer-section footer-links">
              <h3>Customer Support</h3>
              <ul>
                {footerLinks.support.map((link, index) => (
                  <li key={index}>
                    <Link to={link.path}>
                      <ArrowForward className="link-arrow" />
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company Links */}
            <div className="footer-section footer-links">
              <h3>Company</h3>
              <ul>
                {footerLinks.company.map((link, index) => (
                  <li key={index}>
                    <Link to={link.path}>
                      <ArrowForward className="link-arrow" />
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </div>

      {/* Footer Bottom */}
      <div className="footer-bottom">
        <div className="footer-container">
          <div className="footer-bottom-content">
            <p className="footer-copyright">
              &copy; {currentYear} <span className="footer-brand-name">Epic Store</span>. All rights reserved.
            </p>
            <div className="footer-payment-methods">
              <span>We Accept:</span>
              <div className="payment-icons">
                <CreditCard />
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;