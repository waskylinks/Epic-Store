import express from 'express';

import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { allMyOrders, createNewOrder, deleteOrder, getAllOrders, getOrderByReference, getSingleOrder, updateOrderStatus } from '../controller/order-controller.js';

const router = express.Router();

router.route('/new/order/').post(verifyUserAuth, createNewOrder);

router.route('/orders/user/').get(verifyUserAuth, allMyOrders);

router.get(
  '/reference/:reference',
  verifyUserAuth,
  getOrderByReference
);

router.route('/admin/orders/').get(verifyUserAuth, roleBaseAccess('admin'), getAllOrders);

router.route('/order/:id').get(verifyUserAuth, getSingleOrder);

router.route('/admin/order/:id')
.put(verifyUserAuth, roleBaseAccess('admin'),updateOrderStatus)
.delete(verifyUserAuth, roleBaseAccess('admin'),deleteOrder);

export default router;
