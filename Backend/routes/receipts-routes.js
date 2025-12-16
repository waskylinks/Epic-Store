import express from "express";
import { verifyUserAuth } from "../middleware/user-auth.js";
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import {
  getAllReceipts,
  getReceiptByReference
} from "../Services/receipt.service.js"; // must match folder 'Services'
import fs from "fs";
import path from "path";
import Receipt from "../models/receipt-model.js";

const router = express.Router();

// All routes require authentication
router.use(verifyUserAuth);

/**
 * GET /api/v1/receipts/user
 * Fetch all receipts for the authenticated user
 */
router.route("/user").get(handleAsyncError(getAllReceipts));

/**
 * GET /api/v1/receipts/:reference
 * Fetch a single receipt by reference
 */
router.route("/:reference").get(handleAsyncError(getReceiptByReference));

/**
 * GET /api/v1/receipts/:reference/pdf
 * Download pre-generated PDF for a receipt
 */
router.route("/:reference/pdf").get(
  handleAsyncError(async (req, res, next) => {
    const userId = req.user._id;
    const { reference } = req.params;

    const receipt = await Receipt.findOne({ reference, user: userId });
    if (!receipt) return next(new HandleError("Receipt not found", 404));

    const pdfPath = receipt.pdfPath;
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return next(new HandleError("Receipt PDF not available", 404));
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=receipt_${reference}.pdf`
    );
    fs.createReadStream(pdfPath).pipe(res);
  })
);

export default router;
