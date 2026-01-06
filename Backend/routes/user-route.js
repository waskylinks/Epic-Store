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
  requestPasswordReset, 
  resetPassword, 
  UpdatePassword, 
  updateProfile, 
  updateUserRole 
} from "../controller/user-controller.js";
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { 
  registrationLimiter, 
  authLimiter, 
  passwordResetLimiter 
} from '../middleware/rateLimiter.js';
import { 
  validateRegistration, 
  validateLogin, 
  validatePasswordUpdate, 
  validatePasswordReset,
  validateEmail,
  sanitizeInput 
} from '../middleware/validation.js';

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeInput);

// Registration with validation and rate limiting
router.route("/register")
  .post(registrationLimiter, validateRegistration, registerUser);

// Login with validation and rate limiting
router.route("/login")
  .post(authLimiter, validateLogin, loginUser);

// Logout
router.route("/logout").post(logout);

// Password reset request with validation and rate limiting
router.route("/password/forgot")
  .post(passwordResetLimiter, validateEmail, requestPasswordReset);

// Password reset with validation
router.route("/reset/:token")
  .post(validatePasswordReset, resetPassword);

// Protected routes
router.route("/profile")
  .get(verifyUserAuth, getUserDetails);

router.route("/password/update")
  .put(verifyUserAuth, validatePasswordUpdate, UpdatePassword);

router.route("/profile/update")
  .put(verifyUserAuth, updateProfile);

// Admin routes
router.route("/admin/users")
  .get(verifyUserAuth, roleBaseAccess('admin'), getUsersList);

router.route("/admin/stats")
  .get(verifyUserAuth, roleBaseAccess('admin'), getAdminStats);

router.route("/admin/user/:id")
  .get(verifyUserAuth, roleBaseAccess('admin'), getSingleUser)
  .put(verifyUserAuth, roleBaseAccess('admin'), updateUserRole)
  .delete(verifyUserAuth, roleBaseAccess('admin'), deleteUser);

export default router;