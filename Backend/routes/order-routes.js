// ============================================
// NEW ROUTES TO ADD TO YOUR order-routes.js
// ============================================

import express from 'express';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import {
  // ... your existing imports
  
  // NEW imports for enhanced features
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

const router = express.Router();

// ... your existing routes ...

// ============================================
// STATUS HISTORY & TIMELINE
// ============================================

/**
 * Get order timeline/status history
 * @route GET /api/v1/orders/:id/timeline
 * @access Private (User or Admin)
 */
router.get(
  '/orders/:id/timeline',
  verifyUserAuth,
  getOrderTimeline
);

// ============================================
// NOTES & COMMUNICATION
// ============================================

/**
 * Add note to order
 * @route POST /api/v1/orders/:id/notes
 * @access Private (User or Admin)
 * @body { content, type?, attachments? }
 */
router.post(
  '/orders/:id/notes',
  verifyUserAuth,
  addOrderNote
);

/**
 * Get all notes for an order
 * @route GET /api/v1/orders/:id/notes
 * @access Private (User sees customer notes, Admin sees all)
 */
router.get(
  '/orders/:id/notes',
  verifyUserAuth,
  getOrderNotes
);

/**
 * Edit a note
 * @route PUT /api/v1/orders/:id/notes/:noteId
 * @access Private (Author or Admin)
 * @body { content }
 */
router.put(
  '/orders/:id/notes/:noteId',
  verifyUserAuth,
  editOrderNote
);

// ============================================
// TRACKING & SHIPMENT
// ============================================

/**
 * Add tracking information (Admin)
 * @route POST /api/v1/admin/orders/:id/tracking
 * @access Private (Admin only)
 * @body { carrier, trackingNumber, estimatedDelivery? }
 */
router.post(
  '/admin/orders/:id/tracking',
  verifyUserAuth,
  roleBaseAccess('admin'),
  addTrackingInfo
);

/**
 * Get tracking information
 * @route GET /api/v1/orders/:id/tracking
 * @access Private (User or Admin)
 */
router.get(
  '/orders/:id/tracking',
  verifyUserAuth,
  getTrackingInfo
);

/**
 * Create shipment for order (split shipments)
 * @route POST /api/v1/admin/orders/:id/shipments
 * @access Private (Admin only)
 * @body { items, warehouse?, carrier?, weight?, dimensions? }
 */
router.post(
  '/admin/orders/:id/shipments',
  verifyUserAuth,
  roleBaseAccess('admin'),
  createShipment
);

/**
 * Update shipment status
 * @route PUT /api/v1/admin/orders/:id/shipments/:shipmentId
 * @access Private (Admin only)
 * @body { status, trackingNumber? }
 */
router.put(
  '/admin/orders/:id/shipments/:shipmentId',
  verifyUserAuth,
  roleBaseAccess('admin'),
  updateShipmentStatus
);

// ============================================
// RETURN MANAGEMENT (RMA)
// ============================================

/**
 * Request return for order
 * @route POST /api/v1/orders/:id/return/request
 * @access Private (User who owns order)
 * @body { reason, itemsToReturn: [{ product, quantity, condition, reason }] }
 */
router.post(
  '/orders/:id/return/request',
  verifyUserAuth,
  requestReturn
);

/**
 * Review return request (Admin)
 * @route PUT /api/v1/admin/orders/:id/return/review
 * @access Private (Admin only)
 * @body { action: 'approve' | 'reject', restockFee? }
 */
router.put(
  '/admin/orders/:id/return/review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  reviewReturnRequest
);

/**
 * Update return status (Admin)
 * @route PUT /api/v1/admin/orders/:id/return/status
 * @access Private (Admin only)
 * @body { status: 'in_transit' | 'received' | 'inspected' | 'completed', inspectionNotes? }
 */
router.put(
  '/admin/orders/:id/return/status',
  verifyUserAuth,
  roleBaseAccess('admin'),
  updateReturnStatus
);

/**
 * Get all active returns (Admin)
 * @route GET /api/v1/admin/returns?status=requested
 * @access Private (Admin only)
 */
router.get(
  '/admin/returns',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getAllReturns
);

// ============================================
// INVOICE
// ============================================

/**
 * Download invoice for order
 * @route GET /api/v1/orders/:id/invoice
 * @access Private (User or Admin)
 */
router.get(
  '/orders/:id/invoice',
  verifyUserAuth,
  downloadInvoice
);

// ============================================
// FRAUD PREVENTION
// ============================================

/**
 * Get orders pending fraud review (Admin)
 * @route GET /api/v1/admin/orders/fraud-review
 * @access Private (Admin only)
 */
router.get(
  '/admin/orders/fraud-review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getPendingFraudReviews
);

/**
 * Review fraud-flagged order (Admin)
 * @route PUT /api/v1/admin/orders/:id/fraud-review
 * @access Private (Admin only)
 * @body { decision: 'approved' | 'rejected' }
 */
router.put(
  '/admin/orders/:id/fraud-review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  reviewFraudCheck
);

// ============================================
// AUDIT LOG
// ============================================

/**
 * Get audit log for order (Admin)
 * @route GET /api/v1/admin/orders/:id/audit
 * @access Private (Admin only)
 */
router.get(
  '/admin/orders/:id/audit',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getAuditLog
);

// ============================================
// ANALYTICS
// ============================================

/**
 * Get customer order analytics (Admin)
 * @route GET /api/v1/analytics/customer/:userId/orders
 * @access Private (Admin only)
 */
router.get(
  '/analytics/customer/:userId/orders',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getCustomerOrderAnalytics
);

export default router;