import passport from 'passport';
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../utils/emailTemplates.js";
import { oauthLogger } from "../utils/logger.js";
import crypto from "crypto";
import { stitchIdentity, stitchIdentityFromRequest } from '../middleware/identityMiddleware.js'; // PHASE 2
import { syncCustomerAnalytics } from '../Services/customer-analytics-service.js'; // PHASE 2

// GOOGLE OAUTH CONTROLLERS

/**
 * @desc    Initiate Google OAuth login
 * @route   GET /api/v1/oauth/google
 * @access  Public
 */

export const googleAuth = (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthState = state;
    
    oauthLogger.info('Initiating Google OAuth flow', { state });
    
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        state: state
    })(req, res, next);
};

/**
 * @desc    Handle Google OAuth callback
 * @route   GET /api/v1/oauth/google/callback
 * @access  Public
 */

export const googleAuthCallback = (req, res, next) => {
    const returnedState = req.query.state;
    const storedState = req.session.oauthState;
    
    if (!returnedState || returnedState !== storedState) {
        oauthLogger.error('Google OAuth state mismatch', { 
            returnedState, 
            storedState,
            ip: req.ip 
        });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
    }
    
    delete req.session.oauthState;

    passport.authenticate('google', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err) {
                oauthLogger.error('Google OAuth authentication error', { 
                    error: err.message,
                    stack: err.stack
                });
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
            }

            if (!user) {
                oauthLogger.warn('Google OAuth authentication failed - no user', { info });
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=authentication_failed`);
            }

            const isNewUser = user.createdAt && (Date.now() - new Date(user.createdAt).getTime() < 5000);

            if (isNewUser) {
                oauthLogger.info('New user created via Google OAuth', {
                    userId: user._id,
                    email: user.email,
                    provider: 'google'
                });
            } else {
                oauthLogger.info('Existing user logged in via Google OAuth', {
                    userId: user._id,
                    email: user.email
                });
            }

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
                    oauthLogger.info('Welcome email sent', { userId: user._id });
                } catch (error) {
                    oauthLogger.error('Welcome email failed', { 
                        userId: user._id,
                        error: error.message 
                    });
                }
            }

            // Set token as httpOnly cookie
            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            // PHASE 2: Stitch anonymous ID to authenticated user (non-blocking)
            if (isNewUser) {
              // New OAuth user — sync first to create CustomerAnalytics document,
              // then stitch. Without this, stitchIdentity no-ops silently because
              // upsert:false finds no document to update.
              syncCustomerAnalytics(user._id)
                .then(() => stitchIdentity(user._id.toString(), req.anonymousId))
                .catch(err =>
                  oauthLogger.error('Google OAuth sync+stitch failed (non-fatal)', { error: err.message })
                );
            } else {
              // Existing user — CustomerAnalytics document already exists from prior
              // order history, stitch directly.
              stitchIdentity(user._id.toString(), req.anonymousId).catch(err =>
                oauthLogger.error('Google OAuth identity stitch failed (non-fatal)', { error: err.message })
              );
            }

            return res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?success=true`);

        } catch (error) {
            oauthLogger.error('Google OAuth callback error', { 
                error: error.message,
                stack: error.stack 
            });
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_error`);
        }
    })(req, res, next);
};

/**
 * @desc    Link Google account to existing logged-in user
 * @route   GET /api/v1/oauth/link/google
 * @access  Private (requires authentication)
 */

export const linkGoogleAccount = (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthLinkState = state;
    
    oauthLogger.info('Initiating Google account linking', { 
        userId: req.user?.id,
        state 
    });
    
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account',
        state: state
    })(req, res, next);
};

/**
 * @desc    Handle Google account linking callback
 * @route   GET /api/v1/oauth/link/google/callback
 * @access  Private
 */

export const linkGoogleAccountCallback = (req, res, next) => {
    const returnedState = req.query.state;
    const storedState = req.session.oauthLinkState;
    
    if (!returnedState || returnedState !== storedState) {
        oauthLogger.error('Google link state mismatch', { 
            returnedState, 
            storedState,
            ip: req.ip 
        });
        return res.redirect(`${process.env.FRONTEND_URL}/profile?error=invalid_state`);
    }
    
    delete req.session.oauthLinkState;
    
    passport.authenticate('google', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err || !user) {
                oauthLogger.error('Google account linking error', { 
                    error: err?.message,
                    info 
                });
                return res.redirect(`${process.env.FRONTEND_URL}/profile?error=linking_failed`);
            }

            oauthLogger.info('Google account linked successfully', {
                userId: user._id,
                email: user.email
            });

            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            // PHASE 2: Stitch anonymous ID on account linking (non-blocking)
            stitchIdentityFromRequest(req).catch(err =>
                oauthLogger.error('Google link identity stitch failed (non-fatal)', { error: err.message })
            );

            return res.redirect(`${process.env.FRONTEND_URL}/profile?success=google_linked`);

        } catch (error) {
            oauthLogger.error('Google link callback error', { 
                error: error.message,
                stack: error.stack 
            });
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

    if (user.authProvider === 'google' && !user.password) {
        oauthLogger.warn('Attempted to unlink Google without alternative auth', {
            userId: user._id
        });
        return next(new HandleError("Cannot unlink Google account. Please set a password first to maintain account access.", 400));
    }

    user.googleId = undefined;
    
    if (user.authProvider === 'google') {
        user.authProvider = 'local';
    }

    await user.save();

    oauthLogger.info('Google account unlinked', {
        userId: user._id,
        email: user.email
    });

    res.status(200).json({
        success: true,
        message: "Google account unlinked successfully"
    });
});


// FACEBOOK OAUTH CONTROLLERS

/**
 * @desc    Initiate Facebook OAuth login
 * @route   GET /api/v1/oauth/facebook
 * @access  Public
 */

export const facebookAuth = (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthState = state;
    
    oauthLogger.info('Initiating Facebook OAuth flow', { state });
    
    passport.authenticate('facebook', {
        scope: ['email', 'public_profile'],
        state: state
    })(req, res, next);
};

/**
 * @desc    Handle Facebook OAuth callback
 * @route   GET /api/v1/oauth/facebook/callback
 * @access  Public
 */

export const facebookAuthCallback = (req, res, next) => {
    const returnedState = req.query.state;
    const storedState = req.session.oauthState;
    
    if (!returnedState || returnedState !== storedState) {
        oauthLogger.error('Facebook OAuth state mismatch', { 
            returnedState, 
            storedState,
            ip: req.ip 
        });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
    }
    
    delete req.session.oauthState;
    
    passport.authenticate('facebook', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err) {
                oauthLogger.error('Facebook OAuth authentication error', { 
                    error: err.message,
                    stack: err.stack
                });
                
                if (err.message && err.message.includes('must provide email')) {
                    oauthLogger.warn('Facebook OAuth rejected - missing required data', {
                        error: err.message
                    });
                    return res.redirect(`${process.env.FRONTEND_URL}/login?error=email_required`);
                }
                
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
            }

            if (!user) {
                oauthLogger.warn('Facebook OAuth authentication failed - no user', { info });
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=authentication_failed`);
            }

            const isNewUser = user.createdAt && (Date.now() - new Date(user.createdAt).getTime() < 5000);

            if (isNewUser) {
                oauthLogger.info('New user created via Facebook OAuth', {
                    userId: user._id,
                    email: user.email,
                    provider: 'facebook'
                });
            } else {
                oauthLogger.info('Existing user logged in via Facebook OAuth', {
                    userId: user._id,
                    email: user.email
                });
            }

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
                    oauthLogger.info('Welcome email sent', { userId: user._id });
                } catch (error) {
                    oauthLogger.error('Welcome email failed', { 
                        userId: user._id,
                        error: error.message 
                    });
                }
            }

            // Set token as httpOnly cookie
            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            // PHASE 2: Stitch anonymous ID to authenticated user (non-blocking)
            if (isNewUser) {
              // New OAuth user — sync first to create CustomerAnalytics document,
              // then stitch. Without this, stitchIdentity no-ops silently because
              // upsert:false finds no document to update.
              syncCustomerAnalytics(user._id)
                .then(() => stitchIdentity(user._id.toString(), req.anonymousId))
                .catch(err =>
                  oauthLogger.error('Facebook OAuth sync+stitch failed (non-fatal)', { error: err.message })
                );
            } else {
              // Existing user — CustomerAnalytics document already exists from prior
              // order history, stitch directly.
              stitchIdentity(user._id.toString(), req.anonymousId).catch(err =>
                oauthLogger.error('Facebook OAuth identity stitch failed (non-fatal)', { error: err.message })
              );
            }

            return res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?success=true`);

        } catch (error) {
            oauthLogger.error('Facebook OAuth callback error', { 
                error: error.message,
                stack: error.stack 
            });
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_error`);
        }
    })(req, res, next);
};

/**
 * @desc    Link Facebook account to existing logged-in user
 * @route   GET /api/v1/oauth/link/facebook
 * @access  Private (requires authentication)
 */

export const linkFacebookAccount = (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthLinkState = state;
    
    oauthLogger.info('Initiating Facebook account linking', { 
        userId: req.user?.id,
        state 
    });
    
    passport.authenticate('facebook', {
        scope: ['email', 'public_profile'],
        prompt: 'select_account',
        state: state
    })(req, res, next);
};

/**
 * @desc    Handle Facebook account linking callback
 * @route   GET /api/v1/oauth/link/facebook/callback
 * @access  Private
 */

export const linkFacebookAccountCallback = (req, res, next) => {
    const returnedState = req.query.state;
    const storedState = req.session.oauthLinkState;
    
    if (!returnedState || returnedState !== storedState) {
        oauthLogger.error('Facebook link state mismatch', { 
            returnedState, 
            storedState,
            ip: req.ip 
        });
        return res.redirect(`${process.env.FRONTEND_URL}/profile?error=invalid_state`);
    }
    
    delete req.session.oauthLinkState;
    
    passport.authenticate('facebook', {
        session: false
    }, async (err, user, info) => {
        try {
            if (err || !user) {
                oauthLogger.error('Facebook account linking error', { 
                    error: err?.message,
                    info 
                });
                return res.redirect(`${process.env.FRONTEND_URL}/profile?error=linking_failed`);
            }

            oauthLogger.info('Facebook account linked successfully', {
                userId: user._id,
                email: user.email
            });

            const token = user.getJWTToken();
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            // PHASE 2: Stitch anonymous ID on account linking (non-blocking)
            stitchIdentityFromRequest(req).catch(err =>
                oauthLogger.error('Facebook link identity stitch failed (non-fatal)', { error: err.message })
            );

            return res.redirect(`${process.env.FRONTEND_URL}/profile?success=facebook_linked`);

        } catch (error) {
            oauthLogger.error('Facebook link callback error', { 
                error: error.message,
                stack: error.stack 
            });
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

    if (user.authProvider === 'facebook' && !user.password) {
        oauthLogger.warn('Attempted to unlink Facebook without alternative auth', {
            userId: user._id
        });
        return next(new HandleError("Cannot unlink Facebook account. Please set a password first to maintain account access.", 400));
    }

    user.facebookId = undefined;
    
    if (user.authProvider === 'facebook') {
        user.authProvider = 'local';
    }

    await user.save();

    oauthLogger.info('Facebook account unlinked', {
        userId: user._id,
        email: user.email
    });

    res.status(200).json({
        success: true,
        message: "Facebook account unlinked successfully"
    });
});


// SHARED OAUTH CONTROLLERS

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