import Receipt from "../models/receipt-model.js";
import HandleError from "../utils/handleError.js";
import PDFDocument from "pdfkit";

export const downloadReceiptPdf = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const receipt = await Receipt.findOne({
      reference,
      user: req.user._id,
    });

    if (!receipt) {
      return next(new HandleError("Receipt not found for this order", 404));
    }

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=receipt_${reference}.pdf`
    );

    doc.pipe(res);

    doc.fontSize(18).text("Payment Receipt", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Reference: ${receipt.reference}`);
    doc.text(`Total Paid: NGN ${receipt.totalPrice.toLocaleString()}`);
    doc.text(`Date: ${receipt.createdAt.toDateString()}`);

    doc.moveDown().text("Items:");

    receipt.orderItems.forEach((item, i) => {
      doc.text(`${i + 1}. ${item.name} x${item.quantity} - NGN ${item.price}`);
    });

    doc.end();
  } catch (error) {
    return next(new HandleError("Failed to generate receipt PDF", 500));
  }
};
