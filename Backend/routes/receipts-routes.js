import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import { 
  getAllReceipts,
  getReceiptByReference,
  checkReceiptExists,
  emailReceipt
} from '../Services/receipt.service.js';

const router = express.Router();

/**
 * @route GET /api/v1/receipts
 * @desc Get all receipts for logged-in user
 * @access Private
 */
router.get(
  '/',
  verifyUserAuth,
  getAllReceipts
);

/**
 * @route GET /api/v1/receipts/:reference
 * @desc Get specific receipt by reference
 * @access Private
 */
router.get(
  '/:reference',
  verifyUserAuth,
  getReceiptByReference
);

/**
 * @route GET /api/v1/receipts/:reference/exists
 * @desc Check if receipt exists for a reference (for polling)
 * @access Private
 */
router.get(
  '/:reference/exists',
  verifyUserAuth,
  checkReceiptExists
);

/**
 * @route POST /api/v1/receipts/:reference/email
 * @desc Email receipt to user
 * @access Private
 */
router.post(
  '/:reference/email',
  verifyUserAuth,
  emailReceipt
);

export default router;