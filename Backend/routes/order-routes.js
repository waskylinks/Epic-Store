import express from 'express';

import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { createNewOrder, getSingleOrder } from '../controller/order-controller.js';

const router = express.Router();

router.route('/new/order/').post(verifyUserAuth, createNewOrder);

router.route('/admin/order/:id').get(verifyUserAuth, roleBaseAccess('admin'), getSingleOrder);

export default router;
