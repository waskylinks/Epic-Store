import express from "express";
import { 
  deleteUser, 
  getSingleUser, 
  getUserDetails, 
  getUsersList, 
  loginUser, 
  logout, 
  registerUser,
  verifyEmail,
  resendVerificationCode,
  requestPasswordReset,
  verifyResetCode,                
  resetPasswordWithCode,
  UpdatePassword, 
  updateProfile, 
  updateUserRole 
} from "../controller/user-controller.js";
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { 
  registrationLimiter, 
  authLimiter, 
  passwordResetLimiter,
  emailLimiter
} from '../middleware/rateLimiter.js';
import { 
  validateRegistration, 
  validateLogin, 
  validatePasswordUpdate, 
  validatePasswordReset,
  validateEmail,
  validateVerificationCode,
  sanitizeInput, 
  validateProfileUpdate
} from '../middleware/validation.js';

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeInput);

// ===== PUBLIC ROUTES (No Authentication) =====

// Registration with validation and rate limiting
router.route("/register")
  .post(registrationLimiter, validateRegistration, registerUser);

// Email verification with code
router.route("/verify-email")
  .post(emailLimiter, validateVerificationCode, verifyEmail);

// Resend verification code
router.route("/resend-verification")
  .post(emailLimiter, validateEmail, resendVerificationCode);

// Login with validation and rate limiting
router.route("/login")
  .post(authLimiter, validateLogin, loginUser);

// Logout
router.route("/logout")
  .post(logout);

// Password reset request with validation and rate limiting
router.route("/password/forgot")
  .post(passwordResetLimiter, validateEmail, requestPasswordReset);

// Verify reset code (Step 2 of password reset)
router.route("/password/verify-code")
  .post(passwordResetLimiter, validateEmail, validateVerificationCode, verifyResetCode);

// Password reset with CODE (Step 3 of password reset)
router.route("/password/reset")
  .post(passwordResetLimiter, validatePasswordReset, resetPasswordWithCode);

// ===== PROTECTED ROUTES (Require Authentication) =====

// User profile
router.route("/profile")
  .get(verifyUserAuth, getUserDetails);

// Update password
router.route("/password/update")
  .put(verifyUserAuth, validatePasswordUpdate, UpdatePassword);

// Update profile
router.route("/profile/update")
  .put(verifyUserAuth, validateProfileUpdate, updateProfile);

// ===== ADMIN ROUTES =====

// Get all users
router.route("/admin/users")
  .get(verifyUserAuth, roleBaseAccess('admin'), getUsersList);



// Manage specific user
router.route("/admin/user/:id")
  .get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser)
  .put(verifyUserAuth, roleBaseAccess('admin'), updateUserRole)
  .delete(verifyUserAuth, roleBaseAccess('admin'), deleteUser);

export default router;