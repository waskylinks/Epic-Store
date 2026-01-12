import passport from 'passport';
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../utils/emailTemplates.js";

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
                    // ✅ Use firstName and lastName to construct full name
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

            // Generate token and redirect to frontend
            const token = user.getJWTToken();
            return res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?token=${token}`);

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

            // Generate updated token (user data changed after linking)
            const token = user.getJWTToken();
            return res.redirect(`${process.env.FRONTEND_URL}/profile?success=google_linked&token=${token}`);

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
            hasPassword: !!user.password
        }
    });
});