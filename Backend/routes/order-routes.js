import express from 'express';

import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { allMyOrders, createNewOrder, deleteOrder, getAllOrders, getSingleOrder, updateOrderStatus } from '../controller/order-controller.js';

const router = express.Router();

router.route('/new/order/').post(verifyUserAuth, createNewOrder);

router.route('/orders/user/').get(verifyUserAuth, allMyOrders);

router.route('/admin/order/:id')
.get(verifyUserAuth, roleBaseAccess('admin'), getSingleOrder)
.put(verifyUserAuth, roleBaseAccess('admin'),updateOrderStatus)
.delete(verifyUserAuth, roleBaseAccess('admin'),deleteOrder);

router.route('/admin/orders/').get(verifyUserAuth, roleBaseAccess('admin'), getAllOrders);

export default router;
