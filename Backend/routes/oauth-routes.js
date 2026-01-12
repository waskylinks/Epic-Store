import express from "express";
import { 
  googleAuth,
  googleAuthCallback,
  linkGoogleAccount,
  linkGoogleAccountCallback,
  unlinkGoogleAccount,
  getOAuthStatus
} from "../controller/oauth-controller.js";
import { verifyUserAuth } from '../middleware/user-auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { sanitizeInput } from '../middleware/validation.js';

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeInput);

// ===== PUBLIC OAUTH ROUTES (No Authentication) =====

// Initiate Google OAuth login
router.route("/google")
  .get(authLimiter, googleAuth);

// Google OAuth callback
router.route("/google/callback")
  .get(googleAuthCallback);

// ===== PROTECTED OAUTH ROUTES (Require Authentication) =====

// Get OAuth connection status
router.route("/status")
  .get(verifyUserAuth, getOAuthStatus);

// Link Google account to existing user
router.route("/link/google")
  .get(verifyUserAuth, linkGoogleAccount);

// Google account linking callback
router.route("/link/google/callback")
  .get(verifyUserAuth, linkGoogleAccountCallback);

// Unlink Google account
router.route("/unlink/google")
  .post(verifyUserAuth, authLimiter, unlinkGoogleAccount);

export default router;