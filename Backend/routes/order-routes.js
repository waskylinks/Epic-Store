import express from 'express';

import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { createNewOrder } from '../controller/order-controller.js';

const router = express.Router();

router.route('/new/order/').post(verifyUserAuth, createNewOrder);

export default router;
