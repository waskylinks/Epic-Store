import Receipt from "../models/receipt-model.js";
import HandleError from "../utils/handleError.js";
import PDFDocument from "pdfkit";

// Helper: format numbers with ₦ and commas
const formatAmount = (amount) =>
  `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

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

    const doc = new PDFDocument({ margin: 40, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=EPIC_STORE_Receipt_${reference}.pdf`
    );

    doc.pipe(res);

    // ===== HEADER =====
    doc.fontSize(22).font("Helvetica-Bold").text("EPIC STORE", { align: "center" });
    doc.fontSize(12).font("Helvetica").text("Official Payment Receipt", { align: "center" });
    doc.moveDown(1);

    // ===== RECEIPT INFO =====
    doc.fontSize(10).font("Helvetica-Bold").text("Receipt Info");
    doc.font("Helvetica");
    doc.text(`Reference: ${receipt.reference}`);
    doc.text(`Created At: ${receipt.createdAt.toLocaleString("en-GB", { dateStyle: 'short', timeStyle: 'short' })}`);
    doc.moveDown(0.5);

    // ===== CUSTOMER INFO =====
    doc.font("Helvetica-Bold").text("Customer Info");
    doc.font("Helvetica");
    doc.text(`Name: ${receipt.customer?.name || "N/A"}`);
    doc.text(`Email: ${receipt.customer?.email || "N/A"}`);
    doc.text(`Phone: ${receipt.customer?.phoneNo || receipt.shippingInfo?.phoneNo || "N/A"}`);
    doc.moveDown(0.5);

    // ===== SHIPPING ADDRESS =====
    doc.font("Helvetica-Bold").text("Shipping Address");
    const ship = receipt.shippingInfo;
    doc.font("Helvetica");
    doc.text(`${ship.address}, ${ship.city}, ${ship.state}${ship.postalCode ? ", " + ship.postalCode : ""}${ship.country ? ", " + ship.country : ""}`);
    doc.moveDown(0.8);

    // ===== ORDER ITEMS =====
    doc.font("Helvetica-Bold").text("Order Items");
    doc.moveDown(0.3);

    // Table headers
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Item", 40, doc.y, { continued: true });
    doc.text("Qty", 250, doc.y, { continued: true });
    doc.text("Unit Price", 320, doc.y, { continued: true });
    doc.text("Total", 400, doc.y);
    doc.moveDown(0.3);

    doc.font("Helvetica").fontSize(10);
    receipt.orderItems.forEach((item) => {
      const total = item.price * item.quantity;
      doc.text(item.name, 40, doc.y, { continued: true });
      doc.text(item.quantity.toString(), 250, doc.y, { continued: true });
      doc.text(formatAmount(item.price), 320, doc.y, { continued: true });
      doc.text(formatAmount(total), 400, doc.y);
    });

    doc.moveDown(1);

    // ===== PAYMENT SUMMARY =====
    doc.font("Helvetica-Bold").text("Payment Summary", { underline: true });
    doc.moveDown(0.3);

    const valueX = 400; // right-aligned values
    const labelX = 40;  // left-aligned labels
    const gap = 15;

    const addLine = (label, amount, bold = false) => {
      if (bold) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");

      doc.text(label, labelX, doc.y, { continued: true });
      doc.text(formatAmount(amount), valueX, doc.y);
      doc.moveDown(0.5);
    };

    addLine("Subtotal:", receipt.itemPrice || receipt.totalPrice);
    addLine("Tax (18%):", receipt.taxPrice || 0);
    addLine("Shipping:", receipt.shippingPrice || 0);
    addLine("Grand Total:", receipt.totalPrice, true);
    doc.moveDown(1);

    // ===== FOOTER =====
    doc.fontSize(9).font("Helvetica").text(
      "Thank you for shopping with EPIC STORE. This receipt serves as official proof of payment.",
      { align: "center" }
    );

    doc.end();
  } catch (error) {
    return next(new HandleError("Failed to generate receipt PDF", 500));
  }
};
