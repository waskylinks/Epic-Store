import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';

import {
  getAllOrders,
  getSingleOrder,
  updateOrder,
  deleteOrder,
  cancelOrderWithRefund,
  addAdminOrderNote,
  getAdminOrderNotes,
  editAdminOrderNote,
  deleteAdminOrderNote,
  addTrackingInfo,
  createShipment,
  updateShipmentStatus,
  getOrdersWithUnreadMessages,
  getPendingFraudReviews,
  reviewFraudCheck,
  getAuditLog
} from '../controller/admin-order-controller.js';

import {
  validateOrderNote,
  validateTrackingInfo,
  validateFraudReview,
  sanitizeInput
} from '../middleware/validation.js';

import upload from '../middleware/multer.js';

const router = express.Router();

// Shorthand — every admin route requires these two middlewares
const adminAuth = [verifyUserAuth, roleBaseAccess('admin')];

/* ======================================================
   ORDER LISTING & DETAIL
====================================================== */

// NOTE: specific paths (/fraud-review, /unread-messages) must come BEFORE /:id
// to prevent Express matching the literal strings as a mongo :id

router.get('/admin/orders/fraud-review',     ...adminAuth, getPendingFraudReviews);
router.get('/admin/orders/unread-messages',  ...adminAuth, getOrdersWithUnreadMessages);
router.get('/admin/orders',                  ...adminAuth, getAllOrders);
router.get('/admin/order/:id',               ...adminAuth, getSingleOrder);

/* ======================================================
   ORDER STATUS, UPDATE, DELETE
====================================================== */

router.put('/admin/order/:id',               ...adminAuth, updateOrder);
router.delete('/admin/order/:id',            ...adminAuth, deleteOrder);
router.put('/admin/orders/:id/cancel',       ...adminAuth, cancelOrderWithRefund);
router.put('/admin/order/:id/cancel-simple', ...adminAuth, cancelOrderWithRefund);

/* ======================================================
   ADMIN NOTES
====================================================== */

router.post(
  '/admin/orders/:id/notes',
  ...adminAuth,
  upload.array('attachments', 5),
  validateOrderNote,
  addAdminOrderNote
);
router.get('/admin/orders/:id/notes',              ...adminAuth, getAdminOrderNotes);
router.put('/admin/orders/:id/notes/:noteId',      ...adminAuth, validateOrderNote, editAdminOrderNote);
router.delete('/admin/orders/:id/notes/:noteId',   ...adminAuth, deleteAdminOrderNote);

/* ======================================================
   TRACKING & SHIPMENTS
====================================================== */

router.post(
  '/admin/orders/:id/tracking',
  ...adminAuth,
  sanitizeInput,
  validateTrackingInfo,
  addTrackingInfo
);
router.post('/admin/orders/:id/shipments',                     ...adminAuth, createShipment);
router.put('/admin/orders/:id/shipments/:shipmentId',          ...adminAuth, updateShipmentStatus);

/* ======================================================
   FRAUD REVIEW
====================================================== */

router.put('/admin/orders/:id/fraud-review', ...adminAuth, validateFraudReview, reviewFraudCheck);

/* ======================================================
   AUDIT LOG
====================================================== */

router.get('/admin/orders/:id/audit',        ...adminAuth, getAuditLog);

export default router;