import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import { getAllReceipts, getReceiptByReference } from '../Services/receipt.service.js';
import HandleError from '../utils/handleError.js';
import Receipt from '../models/receipt-model.js';

const router = express.Router();

// -------------------- USER ROUTES -------------------- //

// Fetch all receipts for the authenticated user
router.route('/user/').get(verifyUserAuth, getAllReceipts);

// Fetch a single receipt by reference (user can access only their own)
router.route('/:reference').get(verifyUserAuth, getReceiptByReference);

// -------------------- ADMIN ROUTES -------------------- //

// Admin: fetch all receipts for all users
router.route('/admin/all').get(
  verifyUserAuth,
  roleBaseAccess('admin'),
  async (req, res, next) => {
    try {
      const receipts = await Receipt.find().sort({ createdAt: -1 });
      return res.status(200).json({ success: true, receipts });
    } catch (err) {
      return next(new HandleError("Failed to fetch all receipts", 500));
    }
  }
);

// Admin: fetch any receipt by reference
router.route('/admin/:reference').get(
  verifyUserAuth,
  roleBaseAccess('admin'),
  async (req, res, next) => {
    try {
      const { reference } = req.params;
      const receipt = await Receipt.findOne({ reference });
      if (!receipt) return next(new HandleError("Receipt not found", 404));
      return res.status(200).json({ success: true, receipt });
    } catch (err) {
      return next(new HandleError("Failed to fetch receipt", 500));
    }
  }
);

export default router;
