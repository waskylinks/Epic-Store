import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loadUser } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import '../UserStyles/OAuthButtons.css';

function OAuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate       = useNavigate();
    const dispatch       = useDispatch();

    useEffect(() => {
        const handleOAuthCallback = async () => {
            try {
                const success = searchParams.get('success');
                const error   = searchParams.get('error');

                if (error) {
                    const messages = {
                        server_error:          'Server error occurred. Please try again later.',
                        authentication_failed: 'Authentication failed. Please try again.',
                        callback_error:        'Authentication callback error. Please try again.',
                        email_required:        'Facebook login requires access to your email, first name, and last name. Please grant the necessary permissions and try again.',
                        invalid_state:         'Security verification failed. Please try signing in again.',
                    };
                    toast.error(messages[error] || 'An error occurred during authentication.', {
                        position: 'top-center',
                        autoClose: 3000,
                    });
                    navigate('/login');
                    return;
                }

                if (success === 'true') {
                    const result = await dispatch(loadUser()).unwrap();
                    const user   = result?.user;

                    toast.success('Successfully signed in!', { position: 'top-center', autoClose: 2000 });

                    setTimeout(() => {
                        // OAuth users with incomplete profiles go to onboarding first
                        if (user && !user.profileCompleted && user.authProvider !== 'local') {
                            navigate('/complete-profile');
                        } else {
                            navigate('/');
                        }
                    }, 500);
                } else {
                    toast.error('Authentication failed. Please try again.', {
                        position: 'top-center',
                        autoClose: 3000,
                    });
                    navigate('/login');
                }
            } catch {
                toast.error('Failed to complete authentication. Please try again.', {
                    position: 'top-center',
                    autoClose: 3000,
                });
                navigate('/login');
            }
        };

        handleOAuthCallback();
    }, [searchParams, dispatch, navigate]);

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