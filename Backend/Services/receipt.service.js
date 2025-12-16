// Services/receipt.service.js
import Receipt from "../models/receipt-model.js";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";
import HandleError from "../utils/handleError.js";

/**
 * Utility function to format currency
 */
const formatCurrency = (amount, currencyCode = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount);
  } catch (e) {
    // Fallback if currency code is invalid
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
};


/**
 * Create a receipt if it doesn't already exist.
 * ... (function description remains the same)
 *
 * @param {Object} params
 * @param {string} params.orderId - Order ID
 * @param {string} params.userId - User ID
 * @param {string} params.reference - Unique payment reference
 * @param {Array} params.orderItems - Array of order items
 * @param {number} params.totalPrice - Total amount paid
 * @param {Object} params.shippingInfo - Shipping details
 * @param {string} params.currency - The currency code (e.g., 'NGN', 'USD') <--- New
 * @returns {Promise<Receipt>} - The created or existing receipt document
 */
export const createReceiptIfNotExists = async ({
  orderId,
  userId,
  reference,
  orderItems,
  totalPrice,
  shippingInfo,
  currency = 'USD' 
}) => {

  // 1️⃣ Check if receipt already exists (idempotency)
  let receipt = await Receipt.findOne({ reference });
  if (receipt) return receipt;

  // 2️⃣ Create new receipt document in DB first
  receipt = await Receipt.create({
    order: orderId,
    user: userId,
    reference,
    orderItems,
    totalPrice,
    shippingInfo
  });

  // --- BEGIN PDF GENERATION & STORAGE (Isolated Block) ---
  try {
    // 3️⃣ Initialize PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // 4️⃣ Add title
    doc.setFontSize(18);
    doc.setFont(undefined, "bold");
    doc.text("Receipt", pageWidth / 2, 20, { align: "center" });

    // 5️⃣ Add receipt info
    doc.setFontSize(12);
    doc.setFont(undefined, "normal");
    doc.text(`Reference: ${reference}`, 20, 35);
    // Use the timestamp from the newly created receipt document
    doc.text(`Date: ${receipt.createdAt.toLocaleDateString("en-NG")}`, 20, 45);

    // 6️⃣ Shipping info
    doc.setFont(undefined, "bold");
    doc.text("Shipping Info:", 20, 60);
    doc.setFont(undefined, "normal");
    let shippingY = 70;
    doc.text(`Address: ${shippingInfo.address}`, 25, shippingY);
    shippingY += 10;
    doc.text(`City: ${shippingInfo.city}`, 25, shippingY);
    shippingY += 10;
    doc.text(`State: ${shippingInfo.state}`, 25, shippingY);
    shippingY += 10;
    if (shippingInfo.postalCode) {
      doc.text(`Postal Code: ${shippingInfo.postalCode}`, 25, shippingY);
      shippingY += 10;
    }
    doc.text(`Phone: ${shippingInfo.phoneNo}`, 25, shippingY);

    // 7️⃣ Order items table
    const tableY = shippingY + 20;
    const tableData = orderItems.map((item, idx) => [
      idx + 1,
      item.name,
      item.quantity,
      formatCurrency(item.price, currency) // <--- Change: Dynamic Currency Format
    ]);

    autoTable(doc, {
      startY: tableY,
      head: [["#", "Item Name", "Quantity", "Price"]],
      body: tableData,
      headStyles: { fillColor: [41, 128, 185], textColor: 255, halign: "center" },
      bodyStyles: { halign: "center" },
      columnStyles: { 1: { halign: "left" } },
    });

    // 8️⃣ Total price
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFont(undefined, "bold");
    doc.text(`Total Price: ${formatCurrency(totalPrice, currency)}`, 20, finalY); // <--- Change: Dynamic Currency Format

    // 9️⃣ Save PDF
    // NOTE: Consider using an environment variable for the 'receipts' path.
    const receiptsDir = path.resolve("receipts"); 
    fs.mkdirSync(receiptsDir, { recursive: true });
    const pdfPath = path.join(receiptsDir, `receipt_${reference}.pdf`);
    fs.writeFileSync(pdfPath, Buffer.from(doc.output("arraybuffer")));

    // 🔟 Save PDF path to DB and persist
    receipt.pdfPath = pdfPath;
    await receipt.save();

  } catch (error) {
    // ⚠️ IMPORTANT: If PDF generation/storage fails, we log the error but still return 
    // the successfully created receipt document from step 2. 
    // The user will still have a record of the transaction.
    console.error(`Error generating or saving receipt PDF for reference ${reference}:`, error);
    // Optionally: If using a proper logger, use logger.error(...)
  }
  // --- END PDF GENERATION & STORAGE (Isolated Block) ---

  return receipt;
};

/**
 * Fetch all receipts for a user
 */
export const getAllReceipts = async (req, res) => {
  const receipts = await Receipt.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json({ success: true, receipts });
};

/**
 * Fetch a single receipt by reference
 */
export const getReceiptByReference = async (req, res, next) => {
  const { reference } = req.params;
  const receipt = await Receipt.findOne({ reference, user: req.user._id });
  if (!receipt) return next(new HandleError("Receipt not found", 404));
  return res.status(200).json({ success: true, receipt });
};