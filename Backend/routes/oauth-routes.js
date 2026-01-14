import express from "express";
import { 
  googleAuth,
  googleAuthCallback,
  linkGoogleAccount,
  linkGoogleAccountCallback,
  unlinkGoogleAccount,
  facebookAuth,
  facebookAuthCallback,
  linkFacebookAccount,
  linkFacebookAccountCallback,
  unlinkFacebookAccount,
  getOAuthStatus
} from "../controller/oauth-controller.js";
import { verifyUserAuth } from '../middleware/user-auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { sanitizeInput } from '../middleware/validation.js';

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeInput);

// ===== PUBLIC OAUTH ROUTES (No Authentication) =====

// Google OAuth
router.route("/google")
  .get(authLimiter, googleAuth);

router.route("/google/callback")
  .get(googleAuthCallback);

// Facebook OAuth
router.route("/facebook")
  .get(authLimiter, facebookAuth);

router.route("/facebook/callback")
  .get(facebookAuthCallback);

// ===== PROTECTED OAUTH ROUTES (Require Authentication) =====

// Get OAuth connection status
router.route("/status")
  .get(verifyUserAuth, getOAuthStatus);

// Link Google account
router.route("/link/google")
  .get(verifyUserAuth, linkGoogleAccount);

router.route("/link/google/callback")
  .get(verifyUserAuth, linkGoogleAccountCallback);

// Unlink Google account
router.route("/unlink/google")
  .post(verifyUserAuth, authLimiter, unlinkGoogleAccount);

// Link Facebook account
router.route("/link/facebook")
  .get(verifyUserAuth, linkFacebookAccount);

router.route("/link/facebook/callback")
  .get(verifyUserAuth, linkFacebookAccountCallback);

// Unlink Facebook account
router.route("/unlink/facebook")
  .post(verifyUserAuth, authLimiter, unlinkFacebookAccount);

export default router;