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
  let receipt = await Receipt.findOne({ reference });
  if (receipt) return receipt;

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
    console.log("Fetching all receipts for user:", req.user._id);
    const receipts = await Receipt.find({ user: req.user._id }).sort({ createdAt: -1 });
    console.log("Found receipts count:", receipts.length);
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
    console.log("Fetching receipt by reference:", reference, "for user:", req.user._id);

    const receipt = await Receipt.findOne({ reference, user: req.user._id });

    if (!receipt) {
      console.log("Receipt not found:", reference, "for user:", req.user._id);
      return next(new HandleError("Receipt not found", 404));
    }

    console.log("Receipt found:", receipt._id);
    return res.status(200).json({ success: true, receipt });
  } catch (error) {
    console.error(`Error fetching receipt ${req.params.reference}:`, error);
    return next(new HandleError("Failed to fetch receipt", 500));
  }
};
