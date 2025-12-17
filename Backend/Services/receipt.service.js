import Receipt from "../models/receipt-model.js";
import HandleError from "../utils/handleError.js";

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(amount);
};

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

  return Receipt.create({
    order: orderId,
    user: userId,
    reference,
    orderItems,
    totalPrice,
    shippingInfo,
    currency,
  });
};

export const getAllReceipts = async (req, res) => {
  const receipts = await Receipt.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json({ success: true, receipts });
};

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
