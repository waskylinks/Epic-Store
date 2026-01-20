import express from 'express';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { 
  allMyOrders, 
  createNewOrder, 
  deleteOrder, 
  getAllOrders, 
  getOrderByReference, 
  getSingleOrder, 
  updateOrderStatus,
  // Refund controllers
  requestRefund,
  reviewRefundRequest,
  processRefund,
  getRefundStatus,
  getAllRefundRequests
} from '../controller/order-controller.js';

// Import validation schemas
import { 
  requestRefundSchema, 
  reviewRefundSchema, 
  processRefundSchema,
  refundStatusQuerySchema 
} from '../Validation/refund.validation.js';

// Import validation middleware
import { validateBody, validateRequest } from '../middleware/validateBody.js';

// Import refund policy middleware
import { 
  checkRefundEligibility, 
  validateRefundAmount, 
  canProcessRefund 
} from '../middleware/refund-policy.middleware.js';

const router = express.Router();

// ============================================
// EXISTING ORDER ROUTES
// ============================================

/**
 * Create new order
 * @route POST /api/v1/new/order
 * @access Private
 */
router.route('/new/order/')
  .post(verifyUserAuth, createNewOrder);

/**
 * Get all orders for logged-in user
 * @route GET /api/v1/orders/user
 * @access Private
 */
router.route('/orders/user/')
  .get(verifyUserAuth, allMyOrders);

/**
 * Get order by payment reference
 * @route GET /api/v1/orders/reference/:reference
 * @access Private
 */
router.get(
  '/orders/reference/:reference',
  verifyUserAuth,
  getOrderByReference
);

/**
 * Get all orders (Admin)
 * @route GET /api/v1/admin/orders
 * @access Private (Admin)
 */
router.route('/admin/orders/')
  .get(verifyUserAuth, roleBaseAccess('admin'), getAllOrders);

/**
 * Get single order details
 * @route GET /api/v1/order/:id
 * @access Private
 */
router.route('/order/:id')
  .get(verifyUserAuth, getSingleOrder);

/**
 * Update order status (Admin)
 * @route PUT /api/v1/admin/order/:id
 * @access Private (Admin)
 * 
 * Delete order (Admin)
 * @route DELETE /api/v1/admin/order/:id
 * @access Private (Admin)
 */
router.route('/admin/order/:id')
  .put(verifyUserAuth, roleBaseAccess('admin'), updateOrderStatus)
  .delete(verifyUserAuth, roleBaseAccess('admin'), deleteOrder);

// ============================================
// ✅ REFUND ROUTES
// ============================================

/**
 * User requests refund for their order
 * @route POST /api/v1/orders/:orderId/refund/request
 * @access Private (User who owns the order)
 * @body { reason, description, refundType, requestedAmount? }
 */
router.post(
  '/orders/:orderId/refund/request',
  verifyUserAuth,
  validateBody(requestRefundSchema), // Validate refund request data
  checkRefundEligibility, // Check if order is eligible for refund
  requestRefund
);

/**
 * Get refund status for an order
 * @route GET /api/v1/orders/:orderId/refund/status
 * @access Private (User or Admin)
 */
router.get(
  '/orders/:orderId/refund/status',
  verifyUserAuth,
  getRefundStatus
);

/**
 * Admin reviews refund request (approve/reject)
 * @route PUT /api/v1/admin/orders/:orderId/refund/review
 * @access Private (Admin only)
 * @body { action: "approve" | "reject", adminNote? }
 */
router.put(
  '/admin/orders/:orderId/refund/review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  validateBody(reviewRefundSchema), // Validate review action
  reviewRefundRequest
);

/**
 * Admin processes refund (calls payment gateway)
 * @route POST /api/v1/admin/orders/:orderId/refund/process
 * @access Private (Admin only)
 * @body { refundAmount?, merchantNote? }
 */
router.post(
  '/admin/orders/:orderId/refund/process',
  verifyUserAuth,
  roleBaseAccess('admin'),
  validateBody(processRefundSchema), // Validate refund amount
  canProcessRefund, // Check if refund can be processed
  validateRefundAmount, // Validate partial refund amount
  processRefund
);

/**
 * Admin gets all refund requests with optional filters
 * @route GET /api/v1/admin/refunds?status=requested&from=2024-01-01&to=2024-12-31
 * @access Private (Admin only)
 * @query { status?, from?, to? }
 */
router.get(
  '/admin/refunds',
  verifyUserAuth,
  roleBaseAccess('admin'),
  validateRequest(refundStatusQuerySchema, 'query'), // Validate query params
  getAllRefundRequests
);

export default router;