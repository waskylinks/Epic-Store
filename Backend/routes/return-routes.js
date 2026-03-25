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
  submitPlea,
  resolveAfterPlea,
  generateDiscountCode,
  uploadPleaFiles,
  acceptDecisions,
  confirmShipped,
} from '../controller/return-controller.js';

import {
  validateReturnRequest,
  validateReturnMessage,
  validateReturnReview,
  validateReturnStatusUpdate,
  sanitizeInput,
  validatePleaSubmission,
  validateGenerateDiscount,
} from '../middleware/validation.js';

import {
  validateObjectId,
  checkReturnEligibility,
  canReviewFirstRound,
  canReviewPleaRound,
  canAddReturnMessage,
  canCancelReturn,
  validateReturnFileUpload,
  canSubmitPlea,
  canGenerateDiscount,
  canAcceptDecisions,
  canConfirmShipped,
} from '../middleware/return-policy.middleware.js';

// FIX: import safeReturnUploadArray instead of the default upload instance.
// The default upload only allows images (used for product uploads).
// safeReturnUploadArray uses a permissive filter that also allows
// videos (mp4, webm, quicktime) and PDFs for return/plea evidence.
import { safeReturnUploadArray } from '../middleware/multer.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const router = express.Router();

const adminAuth = [verifyUserAuth, roleBaseAccess('admin', "superAdmin")];

const UPLOAD_LIMIT = 8;

router.param('id', validateObjectId);

const returnRequestLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             5,
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: 'Too many return requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const messageLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: 'Too many messages. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const uploadLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: 'Too many upload requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const pleaLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: 'Too many plea submissions. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const shipLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             5,
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: 'Too many shipment confirmation attempts. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

/* ======================================================
   CUSTOMER ROUTES
====================================================== */

// Submit a new return request
router.post(
  '/orders/:id/return/request',
  verifyUserAuth,
  returnRequestLimiter,
  sanitizeInput,
  validateReturnRequest,
  checkReturnEligibility,
  requestReturn
);

// Customer accepts admin decisions without disputing → approved
router.post(
  '/orders/:id/return/accept-decisions',
  verifyUserAuth,
  pleaLimiter,
  canAcceptDecisions,
  acceptDecisions
);

// Customer submits a plea for rejected items → plea_submitted
router.post(
  '/orders/:id/return/plea',
  verifyUserAuth,
  pleaLimiter,
  sanitizeInput,
  validatePleaSubmission,
  canSubmitPlea,
  submitPlea
);

// Customer uploads plea evidence files
router.post(
  '/orders/:id/return/plea/upload',
  verifyUserAuth,
  uploadLimiter,
  safeReturnUploadArray('attachments', UPLOAD_LIMIT),
  validateReturnFileUpload,
  uploadPleaFiles
);

// Customer confirms they have shipped items back → in_transit
router.post(
  '/orders/:id/return/confirm-shipped',
  verifyUserAuth,
  shipLimiter,
  sanitizeInput,
  canConfirmShipped,
  confirmShipped
);

// Messaging
router.post(
  '/orders/:id/return/messages',
  verifyUserAuth,
  messageLimiter,
  sanitizeInput,
  validateReturnMessage,
  canAddReturnMessage,
  addCustomerReturnMessage
);

// Customer file uploads
router.post(
  '/orders/:id/return/upload',
  verifyUserAuth,
  uploadLimiter,
  safeReturnUploadArray('attachments', UPLOAD_LIMIT),
  validateReturnFileUpload,
  uploadCustomerReturnFiles
);

// Cancel return (only at 'requested' status)
router.put(
  '/orders/:id/return/cancel',
  verifyUserAuth,
  canCancelReturn,
  cancelReturnRequest
);

// Read-only customer routes
router.get('/orders/:id/return/status',    verifyUserAuth, getReturnStatus);
router.get('/orders/:id/return/messages',  verifyUserAuth, getReturnMessages);
router.get('/orders/:id/return/timeline',  verifyUserAuth, getReturnTimeline);
router.get('/orders/:id/return/documents', verifyUserAuth, getReturnDocuments);

/* ======================================================
   ADMIN ROUTES
   NOTE: /admin/returns/unread MUST remain BEFORE /admin/returns/:id
   to prevent Express matching 'unread' as an :id param.
====================================================== */

router.get('/admin/returns/unread', ...adminAuth, getReturnsWithUnreadMessages);
router.get('/admin/returns',        ...adminAuth, getAllReturns);
router.get('/admin/returns/:id',    ...adminAuth, getSingleReturn);

// First-round review: requested → items_reviewed
router.put(
  '/admin/orders/:id/return/review',
  ...adminAuth,
  sanitizeInput,
  validateReturnReview,
  canReviewFirstRound,
  reviewReturnRequest
);

// Second-round plea review: plea_submitted → approved
router.put(
  '/admin/orders/:id/return/plea-review',
  ...adminAuth,
  sanitizeInput,
  validateReturnReview,
  canReviewPleaRound,
  resolveAfterPlea
);

// Lifecycle status updates (admin-controlled stages only)
router.put(
  '/admin/orders/:id/return/status',
  ...adminAuth,
  sanitizeInput,
  validateReturnStatusUpdate,
  updateReturnStatus
);

// Generate discount code: inspected → awaiting_discount
router.post(
  '/admin/orders/:id/return/generate-discount',
  ...adminAuth,
  validateGenerateDiscount,
  canGenerateDiscount,
  generateDiscountCode
);

// Admin messaging
router.post(
  '/admin/returns/:id/messages',
  ...adminAuth,
  messageLimiter,
  sanitizeInput,
  validateReturnMessage,
  canAddReturnMessage,
  addReturnMessage
);

// Admin file uploads
router.post(
  '/admin/returns/:id/upload',
  ...adminAuth,
  uploadLimiter,
  safeReturnUploadArray('attachments', UPLOAD_LIMIT),
  validateReturnFileUpload,
  uploadReturnFiles
);

export default router;