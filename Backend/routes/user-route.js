import express from "express";
import { 
  deleteUser, 
  getAdminStats, 
  getSingleUser, 
  getUserDetails, 
  getUsersList, 
  loginUser, 
  logout, 
  registerUser,
  verifyEmail,                    // ✅ ADD THIS
  resendVerificationCode,         // ✅ ADD THIS
  requestPasswordReset, 
  resetPasswordWithCode,          // ✅ RENAMED (was resetPassword)
  UpdatePassword, 
  updateProfile, 
  updateUserRole 
} from "../controller/user-controller.js";
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { 
  registrationLimiter, 
  authLimiter, 
  passwordResetLimiter,
  emailLimiter                    // ✅ ADD THIS
} from '../middleware/rateLimiter.js';
import { 
  validateRegistration, 
  validateLogin, 
  validatePasswordUpdate, 
  validatePasswordReset,
  validateEmail,
  validateVerificationCode,       // ✅ ADD THIS
  sanitizeInput 
} from '../middleware/validation.js';

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeInput);

// ===== PUBLIC ROUTES (No Authentication) =====

// Registration with validation and rate limiting
router.route("/register")
  .post(registrationLimiter, validateRegistration, registerUser);

// ✅ NEW: Email verification with code
router.route("/verify-email")
  .post(authLimiter, validateVerificationCode, verifyEmail);

// ✅ NEW: Resend verification code
router.route("/resend-verification")
  .post(emailLimiter, validateEmail, resendVerificationCode);

// Login with validation and rate limiting
router.route("/login")
  .post(authLimiter, validateLogin, loginUser);

// Logout (can be public or protected - your choice)
router.route("/logout")
  .post(logout);

// Password reset request with validation and rate limiting
router.route("/password/forgot")
  .post(passwordResetLimiter, validateEmail, requestPasswordReset);

// ✅ UPDATED: Password reset with CODE (not token)
router.route("/password/reset")
  .post(authLimiter, validatePasswordReset, resetPasswordWithCode);

// ===== PROTECTED ROUTES (Require Authentication) =====

// User profile
router.route("/profile")
  .get(verifyUserAuth, getUserDetails);

// Update password
router.route("/password/update")
  .put(verifyUserAuth, validatePasswordUpdate, UpdatePassword);

// Update profile
router.route("/profile/update")
  .put(verifyUserAuth, updateProfile);

// ===== ADMIN ROUTES =====

// Get all users
router.route("/admin/users")
  .get(verifyUserAuth, roleBaseAccess('admin'), getUsersList);

// Get dashboard stats
router.route("/admin/stats")
  .get(verifyUserAuth, roleBaseAccess('admin'), getAdminStats);

// Manage specific user
router.route("/admin/user/:id")
  .get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser)
  .put(verifyUserAuth, roleBaseAccess('admin'), updateUserRole)
  .delete(verifyUserAuth, roleBaseAccess('admin'), deleteUser);

export default router;