// controllers/payment.controller.js
import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import { PaymentFactory } from "../Services/payment/paymentFactory.js"; // matches your folder
import { createReceiptIfNotExists } from "../Services/receipt.service.js"; // CAPITAL S


export const verifyPaymentController = handleAsyncError(async (req, res, next) => {
  // 1. Ensure user is authenticated
  const userId = req.user?._id;
  if (!userId) {
    return next(new HandleError("User not authenticated", 401));
  }

  // 2. Extract request body
  const {
    gateway,
    reference,
    currency,
    shippingInfo,
    orderItems,
    itemPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    amountPaid
  } = req.body;

  // 3. Dynamically select the appropriate payment service
  let paymentService;
  try {
    paymentService = PaymentFactory.getService(gateway);
  } catch (err) {
    return next(new HandleError(err.message, 400));
  }

  try {
    // 4. Verify payment & create order
    const result = await paymentService.verifyAndCreateOrder({
      reference,
      currency,
      shippingInfo,
      orderItems,
      itemPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      amountPaid,
      userId
    });

    // 5. Enterprise-level receipt creation
    // Generate a receipt after successful payment and order creation
    // This ensures the receipt is created only once (idempotent)
    if (result.created) {
      await createReceiptIfNotExists({
        orderId: result.order._id,
        userId,
        reference,
        orderItems,
        itemPrice,      // subtotal
        taxPrice,
        shippingPrice,
        totalPrice,
        shippingInfo,
        currency,
        paymentGateway: gateway
      });
    }

    // 6. Return consistent response
    return res.status(200).json({
      success: true,
      message: result.created
        ? "Order created successfully"
        : "Order already exists (idempotent)",
      order: result.order,
      idempotent: !result.created
    });

  } catch (err) {
    // 7. Proper error status
    const status =
      err.message?.toLowerCase().includes("currency") ||
      err.message?.toLowerCase().includes("amount") ||
      err.message?.toLowerCase().includes("reference")
        ? 400
        : 500;

    return next(new HandleError(err.message, status));
  }
});
