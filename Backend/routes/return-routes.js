import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';

import {
  getAllReturns,
  getSingleReturn,
  requestReturn,
  reviewReturnRequest,
  updateReturnStatus,
  addReturnMessage,
  addCustomerReturnMessage,
  getReturnMessages,
  getReturnTimeline,
  getReturnDocuments,
  getReturnStatus,
  uploadReturnFiles,
  uploadCustomerReturnFiles,
  getReturnsWithUnreadMessages,
  cancelReturnRequest,
} from '../controller/return-controller.js';

import {
  validateReturnRequest,
  validateReturnMessage,
  validateReturnReview,
  validateReturnStatusUpdate,
  sanitizeInput,
} from '../middleware/validation.js';

import {
  validateObjectId,           // FIX V-01 — new export
  checkReturnEligibility,
  canReviewReturn,
  canAddReturnMessage,
  canCancelReturn,
  validateReturnFileUpload,
} from '../middleware/return-policy.middleware.js';

import upload from '../middleware/multer.js';

// FIX S-02 — rate limiting on all customer write endpoints
import rateLimit from 'express-rate-limit';

const router = express.Router();

const adminAuth = [verifyUserAuth, roleBaseAccess('admin')];

// FIX BUG-16 — aligned with frontend MAX_FILES
const UPLOAD_LIMIT = 8;

// ============================================
// FIX V-01 — router.param applies validateObjectId to every :id param
// on this router automatically, covering all routes in one declaration.
// Previously only policy-middleware routes validated ObjectId format;
// routes like getSingleReturn, getReturnStatus, getReturnTimeline had no
// guard and responded with unhandled Mongoose CastErrors on bad IDs.
// ============================================
router.param('id', validateObjectId);

// ============================================
// FIX S-02 — per-user rate limiters
// Keyed on req.user._id (set by verifyUserAuth before these routes are hit)
// so limits apply per-user, not per-IP (which is easy to rotate).
// ============================================
const returnRequestLimiter = rateLimit({
  windowMs:    60 * 1000,
  max:         5,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message:     { success: false, message: 'Too many return requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const messageLimiter = rateLimit({
  windowMs:    60 * 1000,
  max:         30,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message:     { success: false, message: 'Too many messages. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const uploadLimiter = rateLimit({
  windowMs:    60 * 1000,
  max:         10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message:     { success: false, message: 'Too many upload requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

/* ======================================================
   CUSTOMER ROUTES
====================================================== */

router.post(
  '/orders/:id/return/request',
  verifyUserAuth,
  returnRequestLimiter,     // FIX S-02
  sanitizeInput,
  validateReturnRequest,    // FIX S-04 / V-02 / V-03 applied inside
  checkReturnEligibility,   // sets req.order
  requestReturn
);

router.post(
  '/orders/:id/return/messages',
  verifyUserAuth,
  messageLimiter,           // FIX S-02
  sanitizeInput,
  validateReturnMessage,
  canAddReturnMessage,      // FIX V-04 — now blocks rejected/cancelled; sets req.order
  addCustomerReturnMessage
);

router.get('/orders/:id/return/status',    verifyUserAuth, getReturnStatus);
router.get('/orders/:id/return/messages',  verifyUserAuth, getReturnMessages);
router.get('/orders/:id/return/timeline',  verifyUserAuth, getReturnTimeline);
router.get('/orders/:id/return/documents', verifyUserAuth, getReturnDocuments);

router.post(
  '/orders/:id/return/upload',
  verifyUserAuth,
  uploadLimiter,            // FIX S-02
  upload.array('attachments', UPLOAD_LIMIT),
  validateReturnFileUpload,
  uploadCustomerReturnFiles
);

router.put(
  '/orders/:id/return/cancel',
  verifyUserAuth,
  canCancelReturn,          // sets req.order
  cancelReturnRequest
);

/* ======================================================
   ADMIN ROUTES
   NOTE: /admin/returns/unread MUST remain BEFORE /admin/returns/:id
   so Express does not match "unread" as an :id param value.
====================================================== */

router.get('/admin/returns/unread',  ...adminAuth, getReturnsWithUnreadMessages);
router.get('/admin/returns',         ...adminAuth, getAllReturns);
router.get('/admin/returns/:id',     ...adminAuth, getSingleReturn);

router.put(
  '/admin/orders/:id/return/review',
  ...adminAuth,
  sanitizeInput,
  validateReturnReview,
  canReviewReturn,          // sets req.order
  reviewReturnRequest
);

router.put(
  '/admin/orders/:id/return/status',
  ...adminAuth,
  sanitizeInput,
  validateReturnStatusUpdate,
  updateReturnStatus
);

router.post(
  '/admin/returns/:id/messages',
  ...adminAuth,
  messageLimiter,           // FIX S-02
  sanitizeInput,
  validateReturnMessage,
  canAddReturnMessage,      // FIX V-04; sets req.order
  addReturnMessage
);

router.post(
  '/admin/returns/:id/upload',
  ...adminAuth,
  uploadLimiter,            // FIX S-02
  upload.array('attachments', UPLOAD_LIMIT),
  validateReturnFileUpload,
  uploadReturnFiles
);

export default router;