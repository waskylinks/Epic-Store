import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loadUser } from '../features/products/userSlice';
import { toast } from 'react-toastify';
import '../UserStyles/OAuthButtons.css';

const ERROR_MESSAGES = {
    server_error:          'Server error occurred. Please try again later.',
    authentication_failed: 'Authentication failed. Please try again.',
    callback_error:        'Authentication callback error. Please try again.',
    email_required:        'Facebook login requires access to your email, first name, and last name. Please grant the necessary permissions and try again.',
    invalid_state:         'Security verification failed. Please try signing in again.',
};

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
                    toast.error(
                        ERROR_MESSAGES[error] ?? 'An error occurred during authentication.',
                        { position: 'top-center', autoClose: 3000 },
                    );
                    navigate('/login');
                    return;
                }

                if (success === 'true') {
                    const result = await dispatch(loadUser()).unwrap();
                    const user   = result?.user;

                    toast.success('Successfully signed in!', {
                        position: 'top-center',
                        autoClose: 2000,
                    });

                    setTimeout(() => {
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
                {/*
                 * FIX: role="status" + aria-live="polite" so screen readers
                 * announce the loading state as soon as the component mounts.
                 * Previously this was a purely visual spinner with no a11y hook.
                 */}
                <div
                    className="oauth-callback-spinner"
                    role="status"
                    aria-live="polite"
                    aria-label="Completing sign in, please wait"
                />

                {/*
                 * FIX: brand gap bumped to 5px (was 2px).
                 * The 800-weight "Epic" and 400-weight "Store" visually
                 * collide at 2px — the heavier glyph appears to touch the lighter one.
                 */}
                <div className="oauth-callback-brand" aria-label="Epic Store">
                    <span className="cb-e">Epic</span>
                    <span className="cb-s">Store</span>
                </div>

                <h2 className="oauth-callback-title">Completing Sign In…</h2>
                <p className="oauth-callback-text">
                    Please wait while we set up your account
                </p>
            </div>
        </div>
    );
}

export default OAuthCallback;