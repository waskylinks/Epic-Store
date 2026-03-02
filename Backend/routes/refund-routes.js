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
 * Accepts multipart/form-data (when files are attached) OR application/json.
 * multer is applied here so the controller can process initial file uploads
 * atomically — files arrive AFTER order.refundInfo is set, bypassing the
 * "No refund request found" guard that previously caused a 404 when files
 * were pre-uploaded via a separate call.
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

router.post(
  '/orders/:id/refund/messages',
  verifyUserAuth,
  sanitizeInput,
  validateRefundMessage,
  canAddRefundMessage,
  addCustomerRefundMessage
);

// Fix: added missing /status route that the refundSlice getRefundStatus thunk calls
router.get('/orders/:id/refund/status',    verifyUserAuth, getRefundStatus);
router.get('/orders/:id/refund/messages',  verifyUserAuth, getRefundMessages);
router.get('/orders/:id/refund/timeline',  verifyUserAuth, getRefundTimeline);
router.get('/orders/:id/refund/documents', verifyUserAuth, getRefundDocuments);

router.post(
  '/orders/:id/refund/upload',
  verifyUserAuth,
  upload.array('attachments', 5),
  validateRefundFileUpload,
  uploadCustomerRefundFiles
);

router.put('/orders/:id/refund/cancel', verifyUserAuth, canCancelRefund, cancelRefundRequest);

/* ======================================================
   ADMIN REFUND ROUTES
====================================================== */

// NOTE: /admin/refunds/unread must come BEFORE /admin/refunds/:id
// to prevent Express matching "unread" as a dynamic :id segment.
router.get('/admin/refunds/unread',        ...adminAuth, getRefundsWithUnreadMessages);
router.get('/admin/refunds',               ...adminAuth, getAllRefunds);
router.get('/admin/refunds/:id',           ...adminAuth, getSingleRefund);

router.put(
  '/admin/orders/:id/refund/review',
  ...adminAuth,
  sanitizeInput,
  validateRefundReview,
  canReviewRefund,
  reviewRefundRequest
);

router.post(
  '/admin/orders/:id/refund/process',
  ...adminAuth,
  sanitizeInput,
  validateProcessRefund,
  canProcessRefund,
  processRefundPayment
);

router.post(
  '/admin/refunds/:id/messages',
  ...adminAuth,
  sanitizeInput,
  validateRefundMessage,
  canAddRefundMessage,
  addRefundMessage
);

router.post(
  '/admin/refunds/:id/upload',
  ...adminAuth,
  upload.array('attachments', 5),
  validateRefundFileUpload,
  uploadRefundFiles
);

export default router;