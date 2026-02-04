import Receipt from "../models/receipt-model.js";
import HandleError from "../utils/handleError.js";
import handleAsyncError from "../middleware/handleAsyncError.js";
import generateReceiptPDF from "../utils/generateReceiptPDF.js";

/**
 * Download receipt as PDF
 * @route GET /api/v1/receipt/:reference/download
 * @access Private (User who owns the receipt)
 */
export const downloadReceiptPdf = handleAsyncError(async (req, res, next) => {
  const { reference } = req.params;

  const receipt = await Receipt.findOne({
    reference,
    user: req.user._id,
  });

  if (!receipt) {
    return next(new HandleError("Receipt not found for this order", 404));
  }

  try {
    // Generate PDF buffer
    const pdfBuffer = await generateReceiptPDF(receipt);

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=EPIC_STORE_Receipt_${reference}.pdf`
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    // Send PDF
    return res.send(pdfBuffer);

  } catch (error) {
    console.error('Receipt PDF generation error:', error);
    return next(new HandleError('Failed to generate receipt PDF', 500));
  }
});