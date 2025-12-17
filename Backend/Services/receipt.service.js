import Receipt from "../models/receipt-model.js";
import User from "../models/userModel.js"; // for snapshotting customer info
import HandleError from "../utils/handleError.js";

/**
 * Format NGN currency
 */
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(amount);
};

/**
 * Create receipt if it does not exist (idempotent)
 */
export const createReceiptIfNotExists = async ({
  orderId,
  userId,
  reference,
  orderItems,
  itemPrice,
  taxPrice,
  shippingPrice,
  totalPrice,
  shippingInfo,
  currency = "NGN",
  paymentGateway = "paystack",
}) => {
  // Return existing receipt if already created
  let receipt = await Receipt.findOne({ reference });
  if (receipt) return receipt;

  // Snapshot customer info
  const user = await User.findById(userId).select("name email");
  if (!user) throw new HandleError("User not found for receipt", 404);

  return Receipt.create({
    order: orderId,
    user: userId,
    reference,
    customer: {
      name: user.name,
      email: user.email,
      phoneNo: shippingInfo.phoneNo,
    },
    orderItems,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    currency,
    shippingInfo,
    paymentStatus: "paid",
    paymentGateway,
    paidAt: new Date(),
  });
};

/**
 * Get all receipts for a user
 */
export const getAllReceipts = async (req, res) => {
  const receipts = await Receipt.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json({ success: true, receipts });
};

/**
 * Get receipt by reference
 */
export const getReceiptByReference = async (req, res, next) => {
  const receipt = await Receipt.findOne({
    reference: req.params.reference,
    user: req.user._id,
  });

  if (!receipt) {
    return next(new HandleError("Receipt not found", 404));
  }

  return res.status(200).json({ success: true, receipt });
};
