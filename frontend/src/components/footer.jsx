import React from 'react';
import '../componentStyles/Footer.css'
import {Phone, Mail, Facebook,Twitter, GitHub, LinkedIn, YouTube, Instagram, WhatsApp} from '@mui/icons-material'

function Footer() {
    return (
        <footer className='footer'>
            <div className="footer-container">

                {/* section 1 */}
                <div className="footer-section contact">

                    <h3>Contact Us</h3>
                    <p><Phone fontSize='small'/> +2349061614369</p>
                    <p><Mail fontSize='small'/> likitajoel@gmail.com</p>
                    <p><WhatsApp fontSize='small'/> +2348073374527</p>

                </div>

                {/* section 2 */}
                <div className="footer-section social"></div>
                <h3>Follow Me</h3>
                <div className="social-links">
                    <a href='' target='_blank'>
                        <GitHub className='social-icon'/>
                    </a>
                    <a href='' target='_blank'>
                        <Facebook className='social-icon'/>
                    </a>
                    <a href='' target='_blank'>
                        <Twitter className='social-icon'/>
                    </a>
                    <a href='' target='_blank'>
                        <Instagram className='social-icon'/>
                    </a>
                </div>

                {/* section 3 */}
                <div className="footer-section about">
                    <h3>About</h3>
                    <p>
                      Epic stores is your trusted online shop for quality products at great prices. We offer secure payment fast delivery and a smooth shopping experience.
                    </p>
                </div>
            </div>

            <div className="footer-bottom">
                <p>&copy; 2025 Epic Store. All rights reserved.</p>
            </div>
        </footer>
    )
}

export default Footer;