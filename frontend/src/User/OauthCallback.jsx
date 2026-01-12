import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loadUser } from '../features/products/userSlice';
import { toast } from 'react-toastify';

function OAuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    useEffect(() => {
        const handleOAuthCallback = async () => {
            try {
                // Check if OAuth was successful
                const success = searchParams.get('success');
                const error = searchParams.get('error');

                if (error) {
                    // Handle OAuth errors
                    let errorMessage = 'Authentication failed. Please try again.';
                    
                    switch(error) {
                        case 'server_error':
                            errorMessage = 'Server error occurred. Please try again later.';
                            break;
                        case 'authentication_failed':
                            errorMessage = 'Google authentication failed. Please try again.';
                            break;
                        case 'callback_error':
                            errorMessage = 'Authentication callback error. Please try again.';
                            break;
                        default:
                            errorMessage = 'An error occurred during authentication.';
                    }

                    toast.error(errorMessage, { position: 'top-center', autoClose: 3000 });
                    navigate('/login');
                    return;
                }

                if (success === 'true') {
                    // OAuth successful - token is already set as httpOnly cookie by backend
                    // Now fetch user profile
                    await dispatch(loadUser()).unwrap();
                    
                    toast.success('Successfully signed in with Google!', { 
                        position: 'top-center', 
                        autoClose: 2000 
                    });
                    
                    // Redirect to home page after short delay
                    setTimeout(() => {
                        navigate('/');
                    }, 500);
                } else {
                    // No success or error parameter - something went wrong
                    toast.error('Authentication failed. Please try again.', { 
                        position: 'top-center', 
                        autoClose: 3000 
                    });
                    navigate('/login');
                }

            } catch (error) {
                console.error('OAuth callback error:', error);
                toast.error('Failed to complete authentication. Please try again.', { 
                    position: 'top-center', 
                    autoClose: 3000 
                });
                navigate('/login');
            }
        };

        handleOAuthCallback();
    }, [searchParams, dispatch, navigate]);

    // Show loading spinner while processing
    return (
        <div style={styles.container}>
            <div style={styles.content}>
                <div style={styles.spinner}></div>
                <h2 style={styles.title}>Completing Sign In...</h2>
                <p style={styles.text}>Please wait while we set up your account</p>
            </div>
        </div>
    );
}

// Inline styles for loading screen
const styles = {
    container: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
    },
    content: {
        textAlign: 'center',
        padding: '40px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        maxWidth: '400px',
    },
    spinner: {
        width: '50px',
        height: '50px',
        margin: '0 auto 20px',
        border: '4px solid #f3f3f3',
        borderTop: '4px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    title: {
        fontSize: '24px',
        fontWeight: '600',
        color: '#333',
        marginBottom: '10px',
    },
    text: {
        fontSize: '14px',
        color: '#666',
    }
};

// Add keyframe animation for spinner
const styleSheet = document.styleSheets[0];
const keyframes = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;

// Check if animation already exists
let animationExists = false;
for (let i = 0; i < styleSheet.cssRules.length; i++) {
    if (styleSheet.cssRules[i].name === 'spin') {
        animationExists = true;
        break;
    }
}

if (!animationExists) {
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
}

export default OAuthCallback;