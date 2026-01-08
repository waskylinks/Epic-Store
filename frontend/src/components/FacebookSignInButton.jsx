import React, { useState } from 'react';
import '../UserStyles/OAuthButtons.css';

function FacebookSignInButton({ text = "Sign in with Facebook" }) {
    const [loading, setLoading] = useState(false);

    const handleFacebookSignIn = async () => {
        setLoading(true);
        
        try {
            // Replace with your actual Facebook OAuth endpoint
            // For example: window.location.href = 'http://your-backend.com/auth/facebook';
            
            // Placeholder - redirect to Facebook OAuth
            console.log('Initiating Facebook Sign In...');
            
            // Example implementation:
            // window.location.href = `${process.env.REACT_APP_API_URL}/auth/facebook`;
            
            // For demo purposes:
            setTimeout(() => {
                setLoading(false);
                alert('Facebook Sign In would redirect here. Configure your backend OAuth endpoint.');
            }, 1000);
            
        } catch (error) {
            console.error('Facebook Sign In Error:', error);
            setLoading(false);
        }
    };

    return (
        <button
            type="button"
            className={`oauth-button facebook-button ${loading ? 'loading' : ''}`}
            onClick={handleFacebookSignIn}
            disabled={loading}
        >
            {!loading && (
                <>
                    <svg 
                        className="oauth-icon" 
                        viewBox="0 0 24 24" 
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path 
                            d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" 
                            fill="#FFFFFF"
                        />
                    </svg>
                    <span className="oauth-text">{text}</span>
                </>
            )}
        </button>
    );
}

export default FacebookSignInButton;