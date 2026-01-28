import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';

/* =======================
   REFUND CONTROLLERS
======================= */
import {
  getAllRefunds,
  getSingleRefund,
  requestRefund,
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
  getRefundsWithUnreadMessages
} from '../controller/refund-controller.js';

/* =======================
   ORDER CONTROLLERS
======================= */
import {
  getAllMyOrders,
  getOrderDetails,
  createOrder,
  getOrderTimeline,
  addOrderNote,
  getOrderNotes,
  editOrderNote,
  addTrackingInfo,
  getTrackingInfo,
  createShipment,
  updateShipmentStatus,
  requestReturn,
  reviewReturnRequest,
  updateReturnStatus,
  getAllReturns,
  downloadInvoice,
  getPendingFraudReviews,
  reviewFraudCheck,
  getAuditLog,
  getCustomerOrderAnalytics
} from '../controller/order-controller.js';

/* =======================
   VALIDATION MIDDLEWARE
======================= */
import {
  validateRefundRequest,
  validateRefundMessage,
  validateRefundReview,
  validateProcessRefund,
  validateOrderNote,
  validateTrackingInfo,
  validateReturnRequest,
  validateFraudReview,
  sanitizeInput
} from '../middleware/validation.js';

/* =======================
   POLICY MIDDLEWARE
======================= */
import {
  checkRefundEligibility,
  validateRefundAmount,
  canReviewRefund,
  canProcessRefund,
  canAddRefundMessage,
  canCancelRefund,
  checkReturnEligibility,
  validateRefundFileUpload
} from '../middleware/refund-policy.middleware.js';

import upload from '../middleware/multer.js';

const router = express.Router();

/* ======================================================
   CUSTOMER REFUND ROUTES
====================================================== */

router.post(
  '/orders/:id/refund/request',
  verifyUserAuth,
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

router.get(
  '/orders/:id/refund/messages',
  verifyUserAuth,
  getRefundMessages
);

router.get(
  '/orders/:id/refund/timeline',
  verifyUserAuth,
  getRefundTimeline
);

router.get(
  '/orders/:id/refund/documents',
  verifyUserAuth,
  getRefundDocuments
);

router.post(
  '/orders/:id/refund/upload',
  verifyUserAuth,
  upload.array('attachments', 5),
  validateRefundFileUpload,
  uploadCustomerRefundFiles
);

router.put(
  '/orders/:id/refund/cancel',
  verifyUserAuth,
  canCancelRefund,
  cancelRefundRequest
);

/* ======================================================
   ADMIN REFUND ROUTES
====================================================== */

router.get(
  '/admin/refunds',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getAllRefunds
);

router.get(
  '/admin/refunds/unread',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getRefundsWithUnreadMessages
);

router.get(
  '/admin/refunds/:id',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getSingleRefund
);

router.put(
  '/admin/orders/:id/refund/review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  sanitizeInput,
  validateRefundReview,
  canReviewRefund,
  reviewRefundRequest
);

router.post(
  '/admin/orders/:id/refund/process',
  verifyUserAuth,
  roleBaseAccess('admin'),
  sanitizeInput,
  validateProcessRefund,
  canProcessRefund,
  processRefundPayment
);

router.post(
  '/admin/refunds/:id/messages',
  verifyUserAuth,
  roleBaseAccess('admin'),
  sanitizeInput,
  validateRefundMessage,
  canAddRefundMessage,
  addRefundMessage
);

router.post(
  '/admin/refunds/:id/upload',
  verifyUserAuth,
  roleBaseAccess('admin'),
  upload.array('attachments', 5),
  validateRefundFileUpload,
  uploadRefundFiles
);

/* ======================================================
   BASIC ORDER ROUTES (Customer)
====================================================== */

// Get all user's orders
router.get(
  '/orders/user',
  verifyUserAuth,
  getAllMyOrders
);

// Create new order
router.post(
  '/order/new',
  verifyUserAuth,
  createOrder
);

// Get single order details
router.get(
  '/order/:id',
  verifyUserAuth,
  getOrderDetails
);

/* ======================================================
   ORDER TIMELINE & NOTES
====================================================== */

router.get(
  '/orders/:id/timeline',
  verifyUserAuth,
  getOrderTimeline
);

router.post(
  '/orders/:id/notes',
  verifyUserAuth,
  sanitizeInput,
  validateOrderNote,
  addOrderNote
);

router.get(
  '/orders/:id/notes',
  verifyUserAuth,
  getOrderNotes
);

router.put(
  '/orders/:id/notes/:noteId',
  verifyUserAuth,
  sanitizeInput,
  validateOrderNote,
  editOrderNote
);

/* ======================================================
   ORDER TRACKING & INVOICE
====================================================== */

router.get(
  '/orders/:id/tracking',
  verifyUserAuth,
  getTrackingInfo
);

router.get(
  '/orders/:id/invoice',
  verifyUserAuth,
  downloadInvoice
);

/* ======================================================
   ADMIN ORDER MANAGEMENT
====================================================== */

router.post(
  '/admin/orders/:id/tracking',
  verifyUserAuth,
  roleBaseAccess('admin'),
  sanitizeInput,
  validateTrackingInfo,
  addTrackingInfo
);

router.post(
  '/admin/orders/:id/shipments',
  verifyUserAuth,
  roleBaseAccess('admin'),
  createShipment
);

router.put(
  '/admin/orders/:id/shipments/:shipmentId',
  verifyUserAuth,
  roleBaseAccess('admin'),
  updateShipmentStatus
);

router.get(
  '/admin/orders/:id/audit',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getAuditLog
);

/* ======================================================
   RETURNS (RMA)
====================================================== */

router.post(
  '/orders/:id/return/request',
  verifyUserAuth,
  sanitizeInput,
  validateReturnRequest,
  checkReturnEligibility,
  requestReturn
);

router.get(
  '/admin/returns',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getAllReturns
);

router.put(
  '/admin/orders/:id/return/review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  reviewReturnRequest
);

router.put(
  '/admin/orders/:id/return/status',
  verifyUserAuth,
  roleBaseAccess('admin'),
  updateReturnStatus
);

/* ======================================================
   FRAUD & ANALYTICS
====================================================== */

router.get(
  '/admin/orders/fraud-review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getPendingFraudReviews
);

router.put(
  '/admin/orders/:id/fraud-review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  validateFraudReview,
  reviewFraudCheck
);

router.get(
  '/analytics/customer/:userId/orders',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getCustomerOrderAnalytics
);

export default router;