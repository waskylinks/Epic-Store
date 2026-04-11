import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import {
  createCheckout,
  updateCheckoutStep,
  getActiveCheckout,
  abandonCheckout,
  redeemRecoveryToken,
} from '../controller/checkout-controller.js';

const router = express.Router();

// Public — must be before /:id to prevent Express matching 'recover' as a param
router.get('/recover', redeemRecoveryToken);

router.post('/create', verifyUserAuth, createCheckout);
router.put('/:id/step', verifyUserAuth, updateCheckoutStep);
router.get('/active', verifyUserAuth, getActiveCheckout);
router.put('/:id/abandon', verifyUserAuth, abandonCheckout);

export default router;