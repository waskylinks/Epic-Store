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
const adminAuth = [verifyUserAuth, roleBaseAccess('admin', "superAdmin")];

// Specific paths BEFORE /:id wildcard
router.get('/admin/orders/fraud-review',     ...adminAuth, getPendingFraudReviews);
router.get('/admin/orders/unread-messages',  ...adminAuth, getOrdersWithUnreadMessages);

// Orders — all plural, consistent
router.get('/admin/orders',                  ...adminAuth, getAllOrders);
router.get('/admin/orders/:id',              ...adminAuth, getSingleOrder);
router.put('/admin/orders/:id',              ...adminAuth, updateOrder);
router.delete('/admin/orders/:id',           ...adminAuth, deleteOrder);
router.put('/admin/orders/:id/cancel',       ...adminAuth, cancelOrderWithRefund);

// Notes
router.post('/admin/orders/:id/notes',       ...adminAuth, upload.array('attachments', 5), validateOrderNote, addAdminOrderNote);
router.get('/admin/orders/:id/notes',        ...adminAuth, getAdminOrderNotes);
router.put('/admin/orders/:id/notes/:noteId',...adminAuth, validateOrderNote, editAdminOrderNote);
router.delete('/admin/orders/:id/notes/:noteId', ...adminAuth, deleteAdminOrderNote);

// Tracking & Shipments — PUT not POST
router.put('/admin/orders/:id/tracking',     ...adminAuth, sanitizeInput, validateTrackingInfo, addTrackingInfo);
router.post('/admin/orders/:id/shipments',   ...adminAuth, createShipment);
router.put('/admin/orders/:id/shipments/:shipmentId', ...adminAuth, updateShipmentStatus);

// Fraud & Audit
router.put('/admin/orders/:id/fraud-review', ...adminAuth, validateFraudReview, reviewFraudCheck);
router.get('/admin/orders/:id/audit',        ...adminAuth, getAuditLog);

export default router;