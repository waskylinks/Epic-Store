import React, { useState } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../pageStyles/ContactPage.css';
import { 
    FiMail, FiPhone, FiMapPin, FiClock, 
    FiSend, FiMessageSquare, FiHeadphones,
    FiFacebook, FiTwitter, FiInstagram, FiLinkedin,
    FiCheckCircle, FiAlertCircle
} from 'react-icons/fi';
import { toast } from 'react-toastify';

function ContactPage() {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        subject: '',
        message: ''
    });

    const [formStatus, setFormStatus] = useState({ type: '', message: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const contactInfo = [
        {
            icon: <FiMail />,
            title: 'Email Us',
            info: 'support@epicstore.com',
            subInfo: 'sales@epicstore.com',
            link: 'mailto:support@epicstore.com'
        },
        {
            icon: <FiPhone />,
            title: 'Call Us',
            info: '+234 800 123 4567',
            subInfo: '+234 900 987 6543',
            link: 'tel:+2348001234567'
        },
        {
            icon: <FiMapPin />,
            title: 'Visit Us',
            info: '123 Commerce Street',
            subInfo: 'Victoria Island, Lagos, Nigeria',
            link: '#'
        },
        {
            icon: <FiClock />,
            title: 'Working Hours',
            info: 'Mon - Fri: 8AM - 8PM',
            subInfo: 'Sat - Sun: 10AM - 6PM',
            link: '#'
        }
    ];

    const faqItems = [
        {
            question: 'What are your shipping options?',
            answer: 'We offer standard and express shipping. Standard delivery takes 3-5 business days, while express delivery takes 1-2 business days.'
        },
        {
            question: 'What is your return policy?',
            answer: 'We accept returns within 30 days of purchase. Items must be unused and in original packaging. Return shipping is free for defective items.'
        },
        {
            question: 'How can I track my order?',
            answer: 'Once your order ships, you\'ll receive a tracking number via email. You can also track orders from your account dashboard.'
        },
        {
            question: 'Do you offer international shipping?',
            answer: 'Currently, we ship within Nigeria. We\'re working on expanding our shipping coverage to other countries soon.'
        }
    ];

    const supportOptions = [
        {
            icon: <FiMessageSquare />,
            title: 'Live Chat',
            description: 'Chat with our support team in real-time',
            action: 'Start Chat',
            available: true
        },
        {
            icon: <FiHeadphones />,
            title: 'Phone Support',
            description: 'Speak directly with our customer service',
            action: 'Call Now',
            available: true
        },
        {
            icon: <FiMail />,
            title: 'Email Support',
            description: 'Send us an email and we\'ll respond within 24 hours',
            action: 'Send Email',
            available: true
        }
    ];

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormStatus({ type: '', message: '' });

        // Simulate API call
        setTimeout(() => {
            setFormStatus({
                type: 'success',
                message: 'Thank you for contacting us! We\'ll get back to you within 24 hours.'
            });
            toast.success('Message sent successfully!');
            setFormData({
                name: '',
                email: '',
                phone: '',
                subject: '',
                message: ''
            });
            setIsSubmitting(false);
        }, 1500);
    };

    return (
        <>
            <PageTitle title="Contact Us - Epic Store" />
            <Navbar />

            <div className="contact-page">
                {/* Hero Section */}
                <section className="contact-hero">
                    <div className="contact-hero-content">
                        <h1 className="contact-hero-title">Get in Touch</h1>
                        <p className="contact-hero-subtitle">
                            We're here to help! Reach out to us for any questions, concerns, or feedback.
                        </p>
                    </div>
                </section>

                {/* Contact Info Cards */}
                <section className="contact-info-section">
                    <div className="contact-info-grid">
                        {contactInfo.map((item, index) => (
                            <div key={index} className="contact-info-card">
                                <div className="contact-info-icon">{item.icon}</div>
                                <h3 className="contact-info-title">{item.title}</h3>
                                <p className="contact-info-text">{item.info}</p>
                                <p className="contact-info-subtext">{item.subInfo}</p>
                                {item.link !== '#' && (
                                    <a href={item.link} className="contact-info-link">
                                        {item.title === 'Email Us' ? 'Send Email' : 'Call Now'}
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                </section>

                {/* Main Contact Section */}
                <section className="contact-main">
                    <div className="contact-container">
                        {/* Contact Form */}
                        <div className="contact-form-wrapper">
                            <div className="contact-form-header">
                                <h2 className="contact-form-title">Send Us a Message</h2>
                                <p className="contact-form-subtitle">
                                    Fill out the form below and we'll get back to you as soon as possible.
                                </p>
                            </div>

                            <form className="contact-form" onSubmit={handleSubmit}>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Full Name *</label>
                                        <input
                                            type="text"
                                            name="name"
                                            className="form-input"
                                            placeholder="John Doe"
                                            value={formData.name}
                                            onChange={handleInputChange}
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Email Address *</label>
                                        <input
                                            type="email"
                                            name="email"
                                            className="form-input"
                                            placeholder="john@example.com"
                                            value={formData.email}
                                            onChange={handleInputChange}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Phone Number</label>
                                        <input
                                            type="tel"
                                            name="phone"
                                            className="form-input"
                                            placeholder="+234 800 000 0000"
                                            value={formData.phone}
                                            onChange={handleInputChange}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Subject *</label>
                                        <select
                                            name="subject"
                                            className="form-select"
                                            value={formData.subject}
                                            onChange={handleInputChange}
                                            required
                                        >
                                            <option value="">Select a subject</option>
                                            <option value="general">General Inquiry</option>
                                            <option value="order">Order Status</option>
                                            <option value="product">Product Question</option>
                                            <option value="return">Returns & Refunds</option>
                                            <option value="partnership">Partnership</option>
                                            <option value="feedback">Feedback</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Message *</label>
                                    <textarea
                                        name="message"
                                        className="form-textarea"
                                        placeholder="Tell us how we can help you..."
                                        rows="6"
                                        value={formData.message}
                                        onChange={handleInputChange}
                                        required
                                    ></textarea>
                                </div>

                                {formStatus.message && (
                                    <div className={`form-status ${formStatus.type}`}>
                                        {formStatus.type === 'success' ? (
                                            <FiCheckCircle className="status-icon" />
                                        ) : (
                                            <FiAlertCircle className="status-icon" />
                                        )}
                                        <span>{formStatus.message}</span>
                                    </div>
                                )}

                                <button 
                                    type="submit" 
                                    className="form-submit-btn"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        'Sending...'
                                    ) : (
                                        <>
                                            <FiSend /> Send Message
                                        </>
                                    )}
                                </button>
                            </form>
                        </div>

                        {/* Support Options */}
                        <div className="support-sidebar">
                            <div className="support-header">
                                <h3 className="support-title">Other Ways to Reach Us</h3>
                                <p className="support-subtitle">Choose the method that works best for you</p>
                            </div>

                            <div className="support-options">
                                {supportOptions.map((option, index) => (
                                    <div key={index} className="support-card">
                                        <div className="support-card-icon">{option.icon}</div>
                                        <div className="support-card-content">
                                            <h4 className="support-card-title">{option.title}</h4>
                                            <p className="support-card-description">{option.description}</p>
                                            <button className="support-card-btn">
                                                {option.action}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Social Media */}
                            <div className="social-section">
                                <h4 className="social-title">Follow Us</h4>
                                <div className="social-links">
                                    <a href="#" className="social-link" aria-label="Facebook">
                                        <FiFacebook />
                                    </a>
                                    <a href="#" className="social-link" aria-label="Twitter">
                                        <FiTwitter />
                                    </a>
                                    <a href="#" className="social-link" aria-label="Instagram">
                                        <FiInstagram />
                                    </a>
                                    <a href="#" className="social-link" aria-label="LinkedIn">
                                        <FiLinkedin />
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* FAQ Section */}
                <section className="contact-faq">
                    <div className="faq-header">
                        <h2 className="faq-title">Frequently Asked Questions</h2>
                        <p className="faq-subtitle">
                            Find quick answers to common questions
                        </p>
                    </div>

                    <div className="faq-grid">
                        {faqItems.map((item, index) => (
                            <div key={index} className="faq-item">
                                <h3 className="faq-question">{item.question}</h3>
                                <p className="faq-answer">{item.answer}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Map Section */}
                <section className="contact-map">
                    <div className="map-wrapper">
                        <div className="map-placeholder">
                            <FiMapPin className="map-icon" />
                            <p className="map-text">Map Location</p>
                            <p className="map-address">123 Commerce Street, Victoria Island, Lagos, Nigeria</p>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="contact-cta">
                    <div className="cta-content">
                        <h2 className="cta-title">Still Have Questions?</h2>
                        <p className="cta-description">
                            Our customer support team is available 24/7 to assist you with any concerns.
                        </p>
                        <a href="tel:+2348001234567" className="cta-btn">
                            <FiPhone /> Call Support Now
                        </a>
                    </div>
                </section>
            </div>

            <Footer />
        </>
    );
}

export default ContactPage;