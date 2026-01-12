import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/userModel.js';

/**
 * Passport configuration for Google OAuth
 */

// Serialize user for session
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

/**
 * Google OAuth Strategy
 */
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
            scope: ['profile', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails[0].value;
                const googleId = profile.id;

                // Check if user exists with this Google ID
                let user = await User.findOne({ googleId });

                if (user) {
                    // User exists with Google ID - login
                    return done(null, user);
                }

                // Check if user exists with this email
                user = await User.findOne({ email: email.toLowerCase() });

                if (user) {
                    // User exists with email but not linked to Google
                    // Link Google account to existing user
                    user.googleId = googleId;
                    user.emailVerified = true; // Google emails are verified

                    // Update avatar if user doesn't have one or has default
                    if (!user.avatar.url || user.avatar.public_id === 'default_avatar') {
                        user.avatar = {
                            public_id: `google_${googleId}`,
                            url: profile.photos[0]?.value || user.avatar.url
                        };
                    }

                    await user.save();
                    return done(null, user);
                }

                // Create new user with Google account
                user = await User.create({
                    name: profile.displayName,
                    email: email.toLowerCase(),
                    googleId: googleId,
                    authProvider: 'google',
                    emailVerified: true, // Google emails are pre-verified
                    avatar: {
                        public_id: `google_${googleId}`,
                        url: profile.photos[0]?.value || 'https://res.cloudinary.com/demo/image/upload/v1234567890/default_avatar.png'
                    },
                    // No password needed for OAuth users
                });

                return done(null, user);

            } catch (error) {
                console.error('Google OAuth error:', error);
                return done(error, null);
            }
        }
    )
);

export default passport;