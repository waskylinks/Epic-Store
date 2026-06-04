import React, { useState } from 'react';
import '../UserStyles/OAuthButtons.css';

function FacebookSignInButton({ text = 'Continue with Facebook' }) {
    const [loading, setLoading] = useState(false);

    const handleFacebookSignIn = () => {
        setLoading(true);
        window.location.href = '/api/v1/oauth/facebook';
    };

    return (
        <button
            type="button"
            className={`oauth-button facebook-button${loading ? ' loading' : ''}`}
            onClick={handleFacebookSignIn}
            disabled={loading}
            aria-label="Continue with Facebook"
        >
            {/*
             * FIX: spinner lives inside .oauth-icon (left slot) so the
             * 3-column grid never reflows and the label stays truly centred.
             *
             * FIX: white f on solid #1877F2 circle per Meta brand guidelines.
             * Replaces the previous faint monochrome path floating on glass,
             * which lost definition at small sizes against the blue-tinted surface.
             */}
            <span className="oauth-icon" aria-hidden="true">
                {loading ? (
                    <span className="oauth-spinner" />
                ) : (
                    <span className="oauth-facebook-circle">
                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path
                                d="M13.397 20.997v-8.196h2.765l.411-3.209h-3.176V7.548c0-.926.258-1.56 1.587-1.56h1.684V3.127A22.336 22.336 0 0 0 14.201 3c-2.444 0-4.122 1.492-4.122 4.231v2.355H7.332v3.209h2.753v8.202h3.312z"
                                fill="#ffffff"
                            />
                        </svg>
                    </span>
                )}
            </span>

            <span className="oauth-label">
                {loading ? 'Redirecting…' : text}
            </span>

            {/* Right spacer mirrors left icon slot — keeps label optically centred */}
            <span className="oauth-spacer" aria-hidden="true" />
        </button>
    );
}

export default FacebookSignInButton;