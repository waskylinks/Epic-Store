import Receipt from "../models/receipt-model.js";
import User from "../models/userModel.js";
import HandleError from "../utils/handleError.js";

/**
 * Format currency based on currency code
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (NGN, USD, GBP, EUR, etc.)
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currency = "NGN") => {
  const localeMap = {
    NGN: "en-NG",
    USD: "en-US",
    GBP: "en-GB",
    EUR: "en-DE",
    GHS: "en-GH",
    KES: "en-KE",
    ZAR: "en-ZA"
  };

  const locale = localeMap[currency] || "en-US";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency,
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
  try {
    // Return existing receipt if already created
    let receipt = await Receipt.findOne({ reference });
    if (receipt) return receipt;

    // Snapshot customer info
    const user = await User.findById(userId).select("name email");
    if (!user) throw new HandleError("User not found for receipt", 404);

    // Create receipt
    receipt = await Receipt.create({
      order: orderId,
      user: userId,
      reference,
      customer: {
        name: user.name,
        email: user.email,
        phoneNo: shippingInfo.phoneNo,
      },
      shippingInfo: {
        address: shippingInfo.address,
        city: shippingInfo.city,
        state: shippingInfo.state,
        country: shippingInfo.country,
        pinCode: shippingInfo.pinCode
      },
      orderItems,
      itemPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: currency.toUpperCase(),
      paymentStatus: "paid",
      paymentGateway,
      paidAt: new Date(),
    });

    return receipt;
  } catch (error) {
    // Log error but don't fail the entire payment process
    console.error("Receipt creation error:", error);
    throw error;
  }
};

/**
 * Get all receipts for a user
 */
export const getAllReceipts = async (req, res) => {
  const receipts = await Receipt.find({ user: req.user._id })
    .sort({ createdAt: -1 });
  
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