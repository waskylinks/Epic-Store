import express from 'express';
import { verifyPayment } from '../controller/paystack-controller.js';
import { verifyUserAuth } from '../middleware/user-auth.js';

const router = express.Router();

router.post('/paystack/verify', verifyUserAuth, verifyPayment);

export default router;
