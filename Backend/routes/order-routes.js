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
  requestRefund,
  reviewRefundRequest,
  processRefund,
  getRefundStatus,
  getAllRefundRequests
} from '../controller/order-controller.js';

const router = express.Router();

router.route('/new/order/').post(verifyUserAuth, createNewOrder);

router.route('/orders/user/').get(verifyUserAuth, allMyOrders);

// ✅ FIX: Add /orders/ prefix
router.get(
  '/orders/reference/:reference',  // Changed from /reference/:reference
  verifyUserAuth,
  getOrderByReference
);

router.route('/admin/orders/').get(verifyUserAuth, roleBaseAccess('admin'), getAllOrders);

router.route('/order/:id').get(verifyUserAuth, getSingleOrder);

router.route('/admin/order/:id')
  .put(verifyUserAuth, roleBaseAccess('admin'), updateOrderStatus)
  .delete(verifyUserAuth, roleBaseAccess('admin'), deleteOrder);

// User requests refund for their order
router.post(
  '/orders/:orderId/refund/request',
  verifyUserAuth,
  requestRefund
);

// User/Admin checks refund status
router.get(
  '/orders/:orderId/refund/status',
  verifyUserAuth,
  getRefundStatus
);

// Admin reviews refund request (approve/reject)
router.put(
  '/admin/orders/:orderId/refund/review',
  verifyUserAuth,
  roleBaseAccess('admin'),
  reviewRefundRequest
);

// Admin processes refund (calls payment gateway)
router.post(
  '/admin/orders/:orderId/refund/process',
  verifyUserAuth,
  roleBaseAccess('admin'),
  processRefund
);

// Admin gets all refund requests
router.get(
  '/admin/refunds',
  verifyUserAuth,
  roleBaseAccess('admin'),
  getAllRefundRequests
);

export default router;