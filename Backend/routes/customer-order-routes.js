import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';

import {
  getAllMyOrders,
  getOrderDetails,
  createOrder,
  getOrderTimeline,
  addOrderNote,
  getOrderNotes,
  editOrderNote,
  getTrackingInfo,
  addOrderMessage,
  getOrderMessages,
  markOrderMessagesRead,
  downloadInvoice,
  getOrderByReference,
  getCustomerOrderAnalytics
} from '../controller/customer-order-controller.js';

import {
  validateOrderNote,
  validateOrderMessage,
  sanitizeInput
} from '../middleware/validation.js';

const router = express.Router();

/* ======================================================
   BASIC ORDER ROUTES
====================================================== */

// NOTE: /orders/reference/:reference and /orders/user must come BEFORE /order/:id
// to prevent Express matching "reference" or "user" as a mongo :id

router.get('/orders/reference/:reference', verifyUserAuth, getOrderByReference);
router.get('/orders/user',                 verifyUserAuth, getAllMyOrders);
router.post('/order/new',                  verifyUserAuth, createOrder);
router.get('/order/:id',                   verifyUserAuth, getOrderDetails);

/* ======================================================
   TIMELINE
====================================================== */

router.get('/orders/:id/timeline', verifyUserAuth, getOrderTimeline);

/* ======================================================
   NOTES
====================================================== */

router.post('/orders/:id/notes',           verifyUserAuth, sanitizeInput, validateOrderNote, addOrderNote);
router.get('/orders/:id/notes',            verifyUserAuth, getOrderNotes);
router.put('/orders/:id/notes/:noteId',    verifyUserAuth, sanitizeInput, validateOrderNote, editOrderNote);

/* ======================================================
   MESSAGES
====================================================== */

router.post('/orders/:id/messages',        verifyUserAuth, sanitizeInput, validateOrderMessage, addOrderMessage);
router.get('/orders/:id/messages',         verifyUserAuth, getOrderMessages);
router.put('/orders/:id/messages/read',    verifyUserAuth, markOrderMessagesRead);

/* ======================================================
   TRACKING & INVOICE
====================================================== */

router.get('/orders/:id/tracking',         verifyUserAuth, getTrackingInfo);
router.get('/orders/:id/invoice',          verifyUserAuth, downloadInvoice);

/* ======================================================
   ANALYTICS
====================================================== */

router.get('/analytics/customer/:userId/orders', verifyUserAuth, getCustomerOrderAnalytics);

export default router;