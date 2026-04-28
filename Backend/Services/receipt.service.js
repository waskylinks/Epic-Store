import Receipt from "../models/receipt-model.js";
import User from "../models/userModel.js";
import HandleError from "../utils/handleError.js";
import handleAsyncError from "../middleware/handleAsyncError.js";

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
    ZAR: "en-ZA",
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
    // Check if receipt already exists
    let receipt = await Receipt.findOne({ reference });
    if (receipt) {
      console.log(`ℹ️ Receipt already exists for reference: ${reference}`);
      return receipt;
    }

    // FIX #4: User model uses firstName / lastName, not a single `name` field.
    // Selecting both fields and composing the display name here so receipts
    // always have a non-undefined customer name.
    const user = await User.findById(userId).select("firstName lastName email");
    if (!user) throw new HandleError("User not found for receipt", 404);

    const customerName =
      user.fullName ||
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
      user.email; // final fallback so the field is never blank

    try {
      receipt = await Receipt.create({
        order: orderId,
        user: userId,
        reference,
        customer: {
          // FIX #4: was `user.name` (undefined). Now uses composed name.
          name: customerName,
          email: user.email,
          phoneNo: shippingInfo.phoneNo,
        },
        shippingInfo: {
          address: shippingInfo.address,
          city: shippingInfo.city,
          state: shippingInfo.state,
          country: shippingInfo.country,
          pinCode: shippingInfo.pinCode,
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

      console.log(`✅ New receipt created for reference: ${reference}`);
      return receipt;
    } catch (createError) {
      // Race condition: another process already created the receipt
      if (createError.code === 11000) {
        console.log(
          `ℹ️ Receipt created by another process, fetching existing one`
        );
        receipt = await Receipt.findOne({ reference });
        if (receipt) return receipt;
      }

      throw createError;
    }
  } catch (error) {
    console.error("Receipt creation error:", error);
    throw error;
  }
};

/**
 * Get all receipts for a user
 */
export const getAllReceipts = async (req, res) => {
  const receipts = await Receipt.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

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

/**
 * Check if receipt exists for a reference
 * @route GET /api/v1/receipts/:reference/exists
 * @access Private
 */
export const checkReceiptExists = handleAsyncError(async (req, res, next) => {
  const { reference } = req.params;
  const userId = req.user._id;

  const receipt = await Receipt.findOne({
    reference,
    user: userId,
  });

  return res.status(200).json({
    success: true,
    exists: !!receipt,
    receipt: receipt || null,
  });
});

/**
 * Email receipt to user
 * @route POST /api/v1/receipts/:reference/email
 * @access Private
 */
export const emailReceipt = handleAsyncError(async (req, res, next) => {
  const { reference } = req.params;
  const userId = req.user._id;

  const receipt = await Receipt.findOne({
    reference,
    user: userId,
  });

  if (!receipt) {
    return next(new HandleError("Receipt not found", 404));
  }

  // FIX #4 (same fix applied here): select firstName + lastName, not name
  const user = await User.findById(userId).select("email firstName lastName");

  const displayName =
    user.fullName ||
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
    user.email;

  // TODO: Implement email sending logic
  // Example implementation:
  /*
  import { sendReceiptEmail } from './email.service.js';

  try {
    await sendReceiptEmail({
      to: user.email,
      name: displayName,
      receipt: receipt,
      reference: reference
    });
  } catch (emailError) {
    console.error('Email sending failed:', emailError);
    return next(new HandleError("Failed to send receipt email", 500));
  }
  */

  console.log(`📧 Would email receipt ${reference} to ${user.email}`);
  console.log(`Receipt details:`, {
    reference: receipt.reference,
    total: receipt.totalPrice,
    currency: receipt.currency,
    items: receipt.orderItems.length,
  });

  return res.status(200).json({
    success: true,
    message: `Receipt will be sent to ${user.email}`,
  });
});