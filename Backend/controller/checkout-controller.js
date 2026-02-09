import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout from "../models/checkout-model.js";
import Product from "../models/product-model.js";

// ============================================
// CREATE/UPDATE CHECKOUT SESSION
// ============================================

/**
 * Create or update checkout session when user enters checkout
 * @route POST /api/v1/checkout/create
 * @access Private
 */
export const createCheckout = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) {
    return next(new HandleError("User not authenticated", 401));
  }

  const { items, shippingInfo, discountCode } = req.body;

  if (!items || items.length === 0) {
    return next(new HandleError("Cart is empty", 400));
  }

  // Calculate pricing
  let itemPrice = 0;
  const validItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);
    
    if (!product || product.status !== 'published') {
      continue;
    }

    const unitPrice = product.pricing?.sale || product.pricing?.regular || product.price || 0;
    const itemTotal = unitPrice * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product: product._id,
      name: product.name,
      price: unitPrice,
      quantity: item.quantity,
      image: product.images?.[0]?.url || product.image?.[0]?.url
    });
  }

  const taxPrice = Math.round(itemPrice * 0.18 * 100) / 100;
  const shippingPrice = itemPrice >= 500 ? 0 : 50;
  const totalPrice = Math.round((itemPrice + taxPrice + shippingPrice) * 100) / 100;

  // Check if user has an active checkout
  let checkout = await Checkout.findOne({
    user: userId,
    status: 'pending'
  });

  const attributionData = req.attributionData || {};
  const deviceInfo = req.deviceInfo || {};

  if (checkout) {
    // Update existing checkout
    checkout.items = validItems;
    checkout.pricing = {
      itemPrice: Math.round(itemPrice * 100) / 100,
      taxPrice,
      shippingPrice,
      totalPrice
    };
    checkout.shippingInfo = shippingInfo || checkout.shippingInfo;
    checkout.lastActivityAt = new Date();
    checkout.updateStep('shipping_info');
  } else {
    // Create new checkout
    checkout = new Checkout({
      user: userId,
      email: req.user.email,
      items: validItems,
      pricing: {
        itemPrice: Math.round(itemPrice * 100) / 100,
        taxPrice,
        shippingPrice,
        totalPrice
      },
      shippingInfo,
      currentStep: 'shipping_info',
      analytics: {
        source: attributionData.source || 'direct',
        medium: attributionData.medium,
        campaign: attributionData.campaign,
        referrer: attributionData.referrer,
        landingPage: attributionData.landingPage,
        device: deviceInfo.device || 'desktop',
        browser: deviceInfo.browser || 'unknown'
      }
    });
  }

  await checkout.save();

  res.status(200).json({
    success: true,
    message: "Checkout session created",
    checkout: {
      id: checkout._id,
      items: checkout.items,
      pricing: checkout.pricing,
      currentStep: checkout.currentStep
    }
  });
});

// ============================================
// UPDATE CHECKOUT STEP
// ============================================

/**
 * Track checkout step progression
 * @route PUT /api/v1/checkout/:id/step
 * @access Private
 */
export const updateCheckoutStep = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const { step, gateway } = req.body;

  const checkout = await Checkout.findById(id);

  if (!checkout) {
    return next(new HandleError("Checkout not found", 404));
  }

  if (checkout.user.toString() !== req.user._id.toString()) {
    return next(new HandleError("Unauthorized", 403));
  }

  checkout.updateStep(step);

  if (step === 'payment_gateway' && gateway) {
    checkout.selectedGateway = gateway;
    checkout.paymentInitialized = true;
    checkout.paymentInitializedAt = new Date();
  }

  await checkout.save();

  res.status(200).json({
    success: true,
    message: "Checkout step updated",
    currentStep: checkout.currentStep
  });
});