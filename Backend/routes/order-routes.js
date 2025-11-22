import express from 'express';

import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { allMyOrders, createNewOrder, getAllOrders, getSingleOrder } from '../controller/order-controller.js';

const router = express.Router();

router.route('/new/order/').post(verifyUserAuth, createNewOrder);

router.route('/orders/user/').get(verifyUserAuth, allMyOrders);

router.route('/admin/order/:id').get(verifyUserAuth, roleBaseAccess('admin'), getSingleOrder);

router.route('/admin/orders/').get(verifyUserAuth, roleBaseAccess('admin'), getAllOrders);

export default router;
