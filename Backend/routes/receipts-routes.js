import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import { 
  getAllReceipts,
  getReceiptByReference,
  checkReceiptExists,
  emailReceipt
} from '../Services/receipt.service.js';
import { downloadReceiptPdf } from '../controller/receipt.controller.js';


const router = express.Router();

router.get('/', verifyUserAuth, getAllReceipts);

router.get('/:reference', verifyUserAuth, getReceiptByReference);

router.get('/:reference/exists', verifyUserAuth, checkReceiptExists);

// ✅ ADD THIS: PDF download route
router.get('/:reference/pdf', verifyUserAuth, downloadReceiptPdf);

router.post('/:reference/email', verifyUserAuth, emailReceipt);

export default router;