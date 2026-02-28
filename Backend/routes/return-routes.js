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
  uploadReturnFiles,
  uploadCustomerReturnFiles,
  getReturnsWithUnreadMessages,
  cancelReturnRequest
} from '../controller/return-controller.js';

import {
  validateReturnRequest,
  validateReturnMessage,
  validateReturnReview,
  validateReturnStatusUpdate,
  sanitizeInput
} from '../middleware/validation.js';

import {
  checkReturnEligibility,
  canReviewReturn,
  canAddReturnMessage,
  canCancelReturn,
  validateReturnFileUpload
} from '../middleware/return-policy.middleware.js';

import upload from '../middleware/multer.js';

const router = express.Router();

const adminAuth = [verifyUserAuth, roleBaseAccess('admin')];

/* ======================================================
   CUSTOMER RETURN ROUTES
====================================================== */

router.post(
  '/orders/:id/return/request',
  verifyUserAuth,
  sanitizeInput,
  validateReturnRequest,
  checkReturnEligibility,
  requestReturn
);

router.post(
  '/orders/:id/return/messages',
  verifyUserAuth,
  sanitizeInput,
  validateReturnMessage,
  canAddReturnMessage,
  addCustomerReturnMessage
);

router.get('/orders/:id/return/messages',  verifyUserAuth, getReturnMessages);
router.get('/orders/:id/return/timeline',  verifyUserAuth, getReturnTimeline);
router.get('/orders/:id/return/documents', verifyUserAuth, getReturnDocuments);

router.post(
  '/orders/:id/return/upload',
  verifyUserAuth,
  upload.array('attachments', 5),
  validateReturnFileUpload,
  uploadCustomerReturnFiles
);

router.put('/orders/:id/return/cancel',    verifyUserAuth, canCancelReturn, cancelReturnRequest);

/* ======================================================
   ADMIN RETURN ROUTES
====================================================== */

// NOTE: /admin/returns/unread must come BEFORE /admin/returns/:id
router.get('/admin/returns/unread',        ...adminAuth, getReturnsWithUnreadMessages);
router.get('/admin/returns',               ...adminAuth, getAllReturns);
router.get('/admin/returns/:id',           ...adminAuth, getSingleReturn);

router.put(
  '/admin/orders/:id/return/review',
  ...adminAuth,
  sanitizeInput,
  validateReturnReview,
  canReviewReturn,
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
  sanitizeInput,
  validateReturnMessage,
  canAddReturnMessage,
  addReturnMessage
);

router.post(
  '/admin/returns/:id/upload',
  ...adminAuth,
  upload.array('attachments', 5),
  validateReturnFileUpload,
  uploadReturnFiles
);

export default router;