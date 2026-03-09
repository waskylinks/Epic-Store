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
  // NEW
  submitPlea,
  resolveAfterPlea,
  generateDiscountCode,
  uploadPleaFiles,
} from '../controller/return-controller.js';

import {
  validateReturnRequest,
  validateReturnMessage,
  validateReturnReview,
  validateReturnStatusUpdate,
  sanitizeInput,
  // NEW
  validatePleaSubmission,
  validateGenerateDiscount,
} from '../middleware/validation.js';

import {
  validateObjectId,
  checkReturnEligibility,
  // FIX BUG-1 / BUG-3 — canReviewReturn split into two status-specific
  // guards so each route only accepts the status it should act on.
  // Importing the old canReviewReturn is intentionally removed.
  canReviewFirstRound,    // PUT /review       — requires status 'requested'
  canReviewPleaRound,     // PUT /plea-review  — requires status 'plea_submitted'
  canAddReturnMessage,
  canCancelReturn,
  validateReturnFileUpload,
  // NEW
  canSubmitPlea,
  canGenerateDiscount,
} from '../middleware/return-policy.middleware.js';

import upload from '../middleware/multer.js';

// FIX S-02 — rate limiting on all customer write endpoints
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

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
// FIX IPv6 — ipKeyGenerator wraps the IP fallback so IPv6 users cannot
// bypass limits via address expansion.
// ============================================
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

// NEW — tighter plea rate limiter (max 3/min per user)
// Plea submissions are a once-per-return action so there is no legitimate
// reason for bursts; this prevents accidental or malicious double-posts.
const pleaLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: 'Too many plea submissions. Please wait a moment.' },
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
  canAddReturnMessage,      // FIX V-04 — blocks completed/rejected/cancelled; sets req.order
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

// NEW — customer submits a plea after admin posts per-item decisions.
// canSubmitPlea enforces: status=items_reviewed, pleaAttempts<1,
// pleaDeadline not expired, and order ownership.
// NOTE: must come BEFORE /orders/:id/return/plea/upload so Express does
// not accidentally match the POST body route when :id === "upload"
// (router.param already guards :id as a valid ObjectId, so this is moot
// in practice, but ordering remains conventional).
router.post(
  '/orders/:id/return/plea',
  verifyUserAuth,
  pleaLimiter,
  sanitizeInput,
  validatePleaSubmission,
  canSubmitPlea,            // sets req.order; blocks if window expired or already used
  submitPlea
);

// NEW — customer uploads evidence files for a plea.
// Intentionally does NOT go through canSubmitPlea because uploads are
// valid both before (items_reviewed) and after (plea_submitted) the text
// submission. The controller enforces the status + deadline check directly.
// FIX BUG-15 — no canSubmitPlea here; controller handles status+deadline.
router.post(
  '/orders/:id/return/plea/upload',
  verifyUserAuth,
  uploadLimiter,
  upload.array('attachments', UPLOAD_LIMIT),
  validateReturnFileUpload,
  uploadPleaFiles
);

/* ======================================================
   ADMIN ROUTES
   NOTE: /admin/returns/unread MUST remain BEFORE /admin/returns/:id
   so Express does not match "unread" as an :id param value.
====================================================== */

router.get('/admin/returns/unread',  ...adminAuth, getReturnsWithUnreadMessages);
router.get('/admin/returns',         ...adminAuth, getAllReturns);
router.get('/admin/returns/:id',     ...adminAuth, getSingleReturn);

// FIX BUG-3 — first-round review uses canReviewFirstRound (status='requested' only)
router.put(
  '/admin/orders/:id/return/review',
  ...adminAuth,
  sanitizeInput,
  validateReturnReview,
  canReviewFirstRound,      // sets req.order; ONLY allows status='requested'
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

// FIX BUG-3 — second-round plea review uses canReviewPleaRound
// (status='plea_submitted' only). Previously shared canReviewReturn
// middleware with the first-round route, which would have allowed
// the admin to overwrite a plea_submitted return with a first-round
// review (destroying plea data) after the naive BUG-1 patch.
router.put(
  '/admin/orders/:id/return/plea-review',
  ...adminAuth,
  sanitizeInput,
  validateReturnReview,
  canReviewPleaRound,       // sets req.order; ONLY allows status='plea_submitted'
  resolveAfterPlea
);

// NEW — admin manually generates and sends a discount code once all item
// decisions are final and the return is in awaiting_discount status.
// canGenerateDiscount populates order.user and order.returnInfo.itemsToReturn.product
// so the controller can build the discount page payload without extra DB calls.
router.post(
  '/admin/orders/:id/return/generate-discount',
  ...adminAuth,
  validateGenerateDiscount,
  canGenerateDiscount,      // sets req.order (pre-populated); status guard
  generateDiscountCode
);

export default router;