import Receipt from "../models/receipt-model.js";
import HandleError from "../utils/handleError.js";

/**
 * Utility function to format currency (NGN only)
 */
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(amount);
};

/**
 * Create a receipt if it doesn't already exist.
 * Hardcoded currency as NGN.
 */
export const createReceiptIfNotExists = async ({
  orderId,
  userId,
  reference,
  orderItems,
  totalPrice,
  shippingInfo,
  currency = "NGN",
}) => {
  // Check if receipt already exists (idempotency)
  let receipt = await Receipt.findOne({ reference });
  if (receipt) return receipt;

  // Create new receipt document in DB
  receipt = await Receipt.create({
    order: orderId,
    user: userId,
    reference,
    orderItems,
    totalPrice,
    shippingInfo,
    currency,
  });

  return receipt;
};

/**
 * Fetch all receipts for a user
 */
export const getAllReceipts = async (req, res) => {
  try {
    const receipts = await Receipt.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, receipts });
  } catch (error) {
    console.error("Error fetching receipts:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch receipts" });
  }
};

/**
 * Fetch a single receipt by reference
 */
export const getReceiptByReference = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const receipt = await Receipt.findOne({ reference, user: req.user._id });
    if (!receipt) return next(new HandleError("Receipt not found", 404));
    return res.status(200).json({ success: true, receipt });
  } catch (error) {
    console.error(`Error fetching receipt ${req.params.reference}:`, error);
    return next(new HandleError("Failed to fetch receipt", 500));
  }
};
