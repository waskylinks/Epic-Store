import express from "express";
import { verifyUserAuth } from "../middleware/user-auth.js";
import {
  getAllReceipts,
  getReceiptByReference,
} from "../Services/receipt.service.js";
import { downloadReceiptPdf } from "../controller/receipt.controller.js";

const router = express.Router();

router.get("/user", verifyUserAuth, getAllReceipts);
router.get("/:reference", verifyUserAuth, getReceiptByReference);
router.get("/:reference/pdf", verifyUserAuth, downloadReceiptPdf);

export default router;
