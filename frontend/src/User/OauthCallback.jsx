import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loadUser } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import '../UserStyles/OAuthButtons.css';

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
                            errorMessage = 'Authentication failed. Please try again.';
                            break;
                        case 'callback_error':
                            errorMessage = 'Authentication callback error. Please try again.';
                            break;
                        case 'email_required':
                            errorMessage = 'Facebook login requires access to your email, first name, and last name. Please grant the necessary permissions and try again.';
                            break;
                        case 'invalid_state':
                            errorMessage = 'Security verification failed. Please try signing in again.';
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
                    
                    toast.success('Successfully signed in!', { 
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
        <div className="oauth-callback-container">
            <div className="oauth-callback-content">
                <div className="oauth-callback-spinner"></div>
                <h2 className="oauth-callback-title">Completing Sign In...</h2>
                <p className="oauth-callback-text">Please wait while we set up your account</p>
            </div>
        </div>
    );
}

export default OAuthCallback;