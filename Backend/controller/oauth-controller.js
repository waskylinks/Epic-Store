import passport from 'passport';
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../utils/emailTemplates.js";

/* ========================================
   GOOGLE OAUTH CONTROLLERS
======================================== */

/**
 * @desc    Initiate Google OAuth login
 * @route   GET /api/v1/oauth/google
 * @access  Public
 */
export const googleAuth = passport.authenticate('google', {
    scope: ['profile', 'email']
});

/**
 * @desc    Handle Google OAuth callback
 * @route   GET /api/v1/oauth/google/callback
 * @access  Public
 */
export const googleAuthCallback = (req, res, next) => {
    passport.authenticate('google', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err) {
                console.error('OAuth authentication error:', err);
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
            }

            if (!user) {
                console.error('OAuth authentication failed:', info);
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=authentication_failed`);
            }

            // Check if newly created user
            const isNewUser = user.createdAt && (Date.now() - new Date(user.createdAt).getTime() < 5000);

            // Send welcome email for new users
            if (isNewUser) {
                try {
                    const fullName = `${user.firstName} ${user.lastName}`;
                    const welcomeTemplate = emailTemplates.welcomeEmail(fullName);
                    await sendEmail({
                        email: user.email,
                        subject: welcomeTemplate.subject,
                        message: welcomeTemplate.text,
                        html: welcomeTemplate.html
                    });
                } catch (error) {
                    console.error("Welcome email failed:", error);
                    // Don't block login if email fails
                }
            }

            // Set token as httpOnly cookie
            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            return res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?success=true`);

        } catch (error) {
            console.error('OAuth callback error:', error);
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_error`);
        }
    })(req, res, next);
};

/**
 * @desc    Link Google account to existing logged-in user
 * @route   GET /api/v1/oauth/link/google
 * @access  Private (requires authentication)
 */
export const linkGoogleAccount = passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
});

/**
 * @desc    Handle Google account linking callback
 * @route   GET /api/v1/oauth/link/google/callback
 * @access  Private
 */
export const linkGoogleAccountCallback = (req, res, next) => {
    passport.authenticate('google', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err || !user) {
                console.error('Account linking error:', err || info);
                return res.redirect(`${process.env.FRONTEND_URL}/profile?error=linking_failed`);
            }

            // Update token cookie with new user data
            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            return res.redirect(`${process.env.FRONTEND_URL}/profile?success=google_linked`);

        } catch (error) {
            console.error('Link callback error:', error);
            return res.redirect(`${process.env.FRONTEND_URL}/profile?error=linking_error`);
        }
    })(req, res, next);
};

/**
 * @desc    Unlink Google account from user profile
 * @route   POST /api/v1/oauth/unlink/google
 * @access  Private
 */
export const unlinkGoogleAccount = handleAsyncError(async (req, res, next) => {
    const user = await req.user;

    if (!user.googleId) {
        return next(new HandleError("Google account is not linked", 400));
    }

    // Prevent unlinking if it's the only auth method and user has no password
    if (user.authProvider === 'google' && !user.password) {
        return next(new HandleError("Cannot unlink Google account. Please set a password first to maintain account access.", 400));
    }

    // Unlink Google account
    user.googleId = undefined;
    
    // If primary auth was Google, switch to local
    if (user.authProvider === 'google') {
        user.authProvider = 'local';
    }

    await user.save();

    res.status(200).json({
        success: true,
        message: "Google account unlinked successfully"
    });
});

/* ========================================
   FACEBOOK OAUTH CONTROLLERS
======================================== */

/**
 * @desc    Initiate Facebook OAuth login
 * @route   GET /api/v1/oauth/facebook
 * @access  Public
 */
export const facebookAuth = passport.authenticate('facebook', {
    scope: ['email', 'public_profile']
});

/**
 * @desc    Handle Facebook OAuth callback
 * @route   GET /api/v1/oauth/facebook/callback
 * @access  Public
 */
export const facebookAuthCallback = (req, res, next) => {
    passport.authenticate('facebook', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err) {
                console.error('Facebook OAuth authentication error:', err);
                
                // Handle specific error for missing required data
                if (err.message && err.message.includes('must provide email')) {
                    return res.redirect(`${process.env.FRONTEND_URL}/login?error=email_required`);
                }
                
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
            }

            if (!user) {
                console.error('Facebook OAuth authentication failed:', info);
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=authentication_failed`);
            }

            // Check if newly created user
            const isNewUser = user.createdAt && (Date.now() - new Date(user.createdAt).getTime() < 5000);

            // Send welcome email for new users
            if (isNewUser) {
                try {
                    const fullName = `${user.firstName} ${user.lastName}`;
                    const welcomeTemplate = emailTemplates.welcomeEmail(fullName);
                    await sendEmail({
                        email: user.email,
                        subject: welcomeTemplate.subject,
                        message: welcomeTemplate.text,
                        html: welcomeTemplate.html
                    });
                } catch (error) {
                    console.error("Welcome email failed:", error);
                    // Don't block login if email fails
                }
            }

            // Set token as httpOnly cookie
            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            return res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?success=true`);

        } catch (error) {
            console.error('Facebook OAuth callback error:', error);
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_error`);
        }
    })(req, res, next);
};

/**
 * @desc    Link Facebook account to existing logged-in user
 * @route   GET /api/v1/oauth/link/facebook
 * @access  Private (requires authentication)
 */
export const linkFacebookAccount = passport.authenticate('facebook', {
    scope: ['email', 'public_profile'],
    prompt: 'select_account'
});

/**
 * @desc    Handle Facebook account linking callback
 * @route   GET /api/v1/oauth/link/facebook/callback
 * @access  Private
 */
export const linkFacebookAccountCallback = (req, res, next) => {
    passport.authenticate('facebook', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err || !user) {
                console.error('Facebook account linking error:', err || info);
                return res.redirect(`${process.env.FRONTEND_URL}/profile?error=linking_failed`);
            }

            // Update token cookie with new user data
            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            return res.redirect(`${process.env.FRONTEND_URL}/profile?success=facebook_linked`);

        } catch (error) {
            console.error('Facebook link callback error:', error);
            return res.redirect(`${process.env.FRONTEND_URL}/profile?error=linking_error`);
        }
    })(req, res, next);
};

/**
 * @desc    Unlink Facebook account from user profile
 * @route   POST /api/v1/oauth/unlink/facebook
 * @access  Private
 */
export const unlinkFacebookAccount = handleAsyncError(async (req, res, next) => {
    const user = await req.user;

    if (!user.facebookId) {
        return next(new HandleError("Facebook account is not linked", 400));
    }

    // Prevent unlinking if it's the only auth method and user has no password
    if (user.authProvider === 'facebook' && !user.password) {
        return next(new HandleError("Cannot unlink Facebook account. Please set a password first to maintain account access.", 400));
    }

    // Unlink Facebook account
    user.facebookId = undefined;
    
    // If primary auth was Facebook, switch to local
    if (user.authProvider === 'facebook') {
        user.authProvider = 'local';
    }

    await user.save();

    res.status(200).json({
        success: true,
        message: "Facebook account unlinked successfully"
    });
});

/* ========================================
   SHARED OAUTH CONTROLLERS
======================================== */

/**
 * @desc    Get OAuth connection status
 * @route   GET /api/v1/oauth/status
 * @access  Private
 */
export const getOAuthStatus = handleAsyncError(async (req, res, next) => {
    const user = await req.user;

    res.status(200).json({
        success: true,
        oauth: {
            google: {
                connected: !!user.googleId,
                isPrimary: user.authProvider === 'google'
            },
            facebook: {
                connected: !!user.facebookId,
                isPrimary: user.authProvider === 'facebook'
            },
            hasPassword: !!user.password
        }
    });
});