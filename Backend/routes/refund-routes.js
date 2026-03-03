import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';

import {
  getAllRefunds,
  getSingleRefund,
  requestRefund,
  getRefundStatus,
  reviewRefundRequest,
  processRefundPayment,
  cancelRefundRequest,
  addRefundMessage,
  addCustomerRefundMessage,
  getRefundMessages,
  getRefundTimeline,
  getRefundDocuments,
  uploadRefundFiles,
  uploadCustomerRefundFiles,
  getRefundsWithUnreadMessages,
} from '../controller/refund-controller.js';

import {
  validateRefundRequest,
  validateRefundMessage,
  validateRefundReview,
  validateProcessRefund,
  sanitizeInput,
} from '../middleware/validation.js';

import {
  checkRefundEligibility,
  validateRefundAmount,
  canReviewRefund,
  canProcessRefund,
  canAddRefundMessage,
  canCancelRefund,
  validateRefundFileUpload,
} from '../middleware/refund-policy.middleware.js';

import upload from '../middleware/multer.js';

const router = express.Router();

const adminAuth = [verifyUserAuth, roleBaseAccess('admin')];

/* ======================================================
   CUSTOMER REFUND ROUTES
====================================================== */

/**
 * Submit a new refund request.
 *
 * Middleware chain:
 *   1. verifyUserAuth        — authenticate the user
 *   2. upload.array()        — parse multipart form-data (files + body fields)
 *   3. sanitizeInput         — trim all string body fields
 *   4. validateRefundRequest — validate body shape (reason, description, refundType, requestedAmount)
 *   5. checkRefundEligibility — fetch the order, validate ownership, payment status,
 *                               existing refund status, refund window, gateway support;
 *                               attaches req.order for the controller to reuse.
 *   6. validateRefundAmount  — validate partial refund amount bounds using req.order
 *   7. requestRefund         — uses req.order directly; no second DB fetch
 *
 * NOTE: upload runs before sanitizeInput and validation so that multer
 * populates req.body from multipart form-data before validators read it.
 * This also allows initial file uploads to be processed atomically with
 * the refund creation, avoiding the "No refund request found" 404 that
 * occurred when files were pre-uploaded via a separate call.
 */
router.post(
  '/orders/:id/refund/request',
  verifyUserAuth,
  upload.array('attachments', 5),
  sanitizeInput,
  validateRefundRequest,
  checkRefundEligibility,
  validateRefundAmount,
  requestRefund
);

/**
 * Customer sends a message on a refund thread.
 *
 * canAddRefundMessage fetches the order, checks ownership, confirms a
 * refund exists, and verifies the refund is not in a closed state.
 * It attaches req.order for the controller.
 */
router.post(
  '/orders/:id/refund/messages',
  verifyUserAuth,
  sanitizeInput,
  validateRefundMessage,
  canAddRefundMessage,
  addCustomerRefundMessage
);

// Read-only customer routes — no middleware attaches req.order; each
// controller performs its own minimal targeted fetch.
router.get('/orders/:id/refund/status',    verifyUserAuth, getRefundStatus);
router.get('/orders/:id/refund/messages',  verifyUserAuth, getRefundMessages);
router.get('/orders/:id/refund/timeline',  verifyUserAuth, getRefundTimeline);
router.get('/orders/:id/refund/documents', verifyUserAuth, getRefundDocuments);

/**
 * Customer uploads supporting files for an existing refund.
 *
 * validateRefundFileUpload is a pure body/file validator — it does not
 * fetch the order. The controller performs its own fetch (necessary since
 * no policy middleware attaches req.order on this route).
 */
router.post(
  '/orders/:id/refund/upload',
  verifyUserAuth,
  upload.array('attachments', 5),
  validateRefundFileUpload,
  uploadCustomerRefundFiles
);

/**
 * canCancelRefund fetches the order, checks ownership, confirms the
 * refund is in 'requested' status, and attaches req.order.
 */
router.put('/orders/:id/refund/cancel', verifyUserAuth, canCancelRefund, cancelRefundRequest);

/* ======================================================
   ADMIN REFUND ROUTES

   IMPORTANT — route ordering:
   /admin/refunds/unread MUST be declared before /admin/refunds/:id
   to prevent Express matching the literal string "unread" as a
   dynamic :id segment.
====================================================== */

router.get('/admin/refunds/unread', ...adminAuth, getRefundsWithUnreadMessages);
router.get('/admin/refunds',        ...adminAuth, getAllRefunds);
router.get('/admin/refunds/:id',    ...adminAuth, getSingleRefund);

/**
 * canReviewRefund fetches the order, confirms refundInfo.status === 'requested',
 * and attaches req.order. The controller uses req.order directly.
 */
router.put(
  '/admin/orders/:id/refund/review',
  ...adminAuth,
  sanitizeInput,
  validateRefundReview,
  canReviewRefund,
  reviewRefundRequest
);

/**
 * canProcessRefund fetches the order, confirms refundInfo.status === 'approved',
 * and attaches req.order. The controller still performs a findOneAndUpdate
 * CAS before calling the payment gateway to prevent duplicate charges from
 * concurrent requests.
 */
router.post(
  '/admin/orders/:id/refund/process',
  ...adminAuth,
  sanitizeInput,
  validateProcessRefund,
  canProcessRefund,
  processRefundPayment
);

/**
 * canAddRefundMessage fetches the order, confirms a refund exists and is
 * not in a closed state, checks admin role (role checked by adminAuth
 * already), and attaches req.order.
 */
router.post(
  '/admin/refunds/:id/messages',
  ...adminAuth,
  sanitizeInput,
  validateRefundMessage,
  canAddRefundMessage,
  addRefundMessage
);

/**
 * Admin file upload — validateRefundFileUpload is a pure validator.
 * No policy middleware attaches req.order; the controller fetches directly.
 */
router.post(
  '/admin/refunds/:id/upload',
  ...adminAuth,
  upload.array('attachments', 5),
  validateRefundFileUpload,
  uploadRefundFiles
);

export default router;