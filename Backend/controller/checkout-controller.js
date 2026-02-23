import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout from "../models/checkout-model.js";
import Product from "../models/product-model.js";
import { deleteCachePattern } from '../utils/redis.js';
import { verifyRecoveryToken } from '../utils/recoveryToken.js';

// Helper function to invalidate checkout-related caches
const invalidateCheckoutCaches = async () => {
  try {
    await Promise.all([
      deleteCachePattern('checkout_*'),
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('analytics_*')
    ]);
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
};

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

  const { items, shippingInfo } = req.body;

  if (!items || items.length === 0) {
    return next(new HandleError("Cart is empty", 400));
  }

  // Validate shipping info structure if provided
  if (shippingInfo) {
    const requiredFields = ['address', 'city', 'state', 'country', 'phoneNo'];
    const missingFields = requiredFields.filter(field => !shippingInfo[field]);

    if (missingFields.length > 0) {
      return next(new HandleError(
        `Missing required shipping fields: ${missingFields.join(', ')}`,
        400
      ));
    }
  }

  // Calculate pricing
  let itemPrice = 0;
  const validItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product || product.status !== 'published') {
      continue;
    }

    const unitPrice = product.pricing?.sale || product.pricing?.regular || 0;
    const itemTotal = unitPrice * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product: product._id,
      name: product.name,
      price: unitPrice,
      quantity: item.quantity,
      image: product.images?.[0]?.url
    });
  }

  if (validItems.length === 0) {
    return next(new HandleError("No valid items in cart", 400));
  }

  const taxPrice      = Math.round(itemPrice * 0.18 * 100) / 100;
  const shippingPrice = itemPrice >= 500 ? 0 : 50;
  const totalPrice    = Math.round((itemPrice + taxPrice + shippingPrice) * 100) / 100;

  // Check if user has an active checkout
  let checkout = await Checkout.findOne({
    user: userId,
    status: 'pending'
  });

  const attributionData = req.attributionData || {};
  const deviceInfo      = req.deviceInfo      || {};

  if (checkout) {
    // Update existing checkout
    checkout.items = validItems;
    checkout.pricing = {
      itemPrice: Math.round(itemPrice * 100) / 100,
      taxPrice,
      shippingPrice,
      totalPrice,
      currency: 'USD'
    };

    if (shippingInfo) {
      checkout.shippingInfo = {
        firstName: shippingInfo.firstName,
        lastName:  shippingInfo.lastName,
        address:   shippingInfo.address,
        city:      shippingInfo.city,
        state:     shippingInfo.state,
        pinCode:   shippingInfo.pinCode || shippingInfo.zipCode,
        country:   shippingInfo.country,
        phoneNo:   shippingInfo.phoneNo
      };
    }

    checkout.lastActivityAt = new Date();
    checkout.updateStep('shipping_info');
  } else {
    // Create new checkout
    checkout = new Checkout({
      user:  userId,
      email: req.user.email,
      items: validItems,
      pricing: {
        itemPrice: Math.round(itemPrice * 100) / 100,
        taxPrice,
        shippingPrice,
        totalPrice,
        currency: 'USD'
      },
      shippingInfo: shippingInfo ? {
        firstName: shippingInfo.firstName,
        lastName:  shippingInfo.lastName,
        address:   shippingInfo.address,
        city:      shippingInfo.city,
        state:     shippingInfo.state,
        pinCode:   shippingInfo.pinCode || shippingInfo.zipCode,
        country:   shippingInfo.country,
        phoneNo:   shippingInfo.phoneNo
      } : undefined,
      currentStep: 'shipping_info',
      analytics: {
        source:      attributionData.source || 'email', // recovered carts come via email link
        medium:      attributionData.medium,
        campaign:    attributionData.campaign,
        referrer:    attributionData.referrer,
        landingPage: attributionData.landingPage,
        device:      deviceInfo.device  || 'desktop',
        browser:     deviceInfo.browser || 'unknown'
      }
    });
  }

  await checkout.save();

  invalidateCheckoutCaches().catch(err =>
    console.error('Failed to invalidate caches:', err)
  );

  res.status(200).json({
    success: true,
    message: "Checkout session created",
    checkout: {
      id:           checkout._id,
      items:        checkout.items,
      pricing:      checkout.pricing,
      shippingInfo: checkout.shippingInfo,
      currentStep:  checkout.currentStep
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
  const { id }              = req.params;
  const { step, gateway }   = req.body;

  const validSteps = ['shipping_info', 'payment_selection', 'payment_gateway', 'payment_failed'];

  if (!validSteps.includes(step)) {
    return next(new HandleError("Invalid checkout step", 400));
  }

  const checkout = await Checkout.findById(id);

  if (!checkout) {
    return next(new HandleError("Checkout not found", 404));
  }

  if (checkout.user.toString() !== req.user._id.toString()) {
    return next(new HandleError("Unauthorized", 403));
  }

  checkout.updateStep(step);

  if (step === 'payment_gateway' && gateway) {
    checkout.selectedGateway        = gateway;
    checkout.paymentInitialized     = true;
    checkout.paymentInitializedAt   = new Date();
  }

  await checkout.save();

  invalidateCheckoutCaches().catch(err =>
    console.error('Failed to invalidate caches:', err)
  );

  res.status(200).json({
    success:        true,
    message:        "Checkout step updated",
    currentStep:    checkout.currentStep,
    stepsCompleted: checkout.stepsCompleted
  });
});

// ============================================
// GET ACTIVE CHECKOUT
// ============================================

/**
 * Get user's active checkout session
 * @route GET /api/v1/checkout/active
 * @access Private
 */
export const getActiveCheckout = handleAsyncError(async (req, res, next) => {
  const userId = req.user._id;

  const checkout = await Checkout.findOne({
    user:   userId,
    status: 'pending'
  })
    .populate('items.product', 'name images pricing inventory')
    .sort({ lastActivityAt: -1 });

  if (!checkout) {
    return res.status(200).json({
      success:  true,
      checkout: null
    });
  }

  res.status(200).json({
    success:  true,
    checkout
  });
});

// ============================================
// ABANDON CHECKOUT (MANUAL)
// ============================================

/**
 * Manually mark checkout as abandoned
 * @route PUT /api/v1/checkout/:id/abandon
 * @access Private
 */
export const abandonCheckout = handleAsyncError(async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user._id;

  const checkout = await Checkout.findById(id);

  if (!checkout) {
    return next(new HandleError("Checkout not found", 404));
  }

  if (checkout.user.toString() !== userId.toString()) {
    return next(new HandleError("Unauthorized", 403));
  }

  if (checkout.status !== 'pending') {
    return next(new HandleError("Checkout is not pending", 400));
  }

  checkout.markAsAbandoned();
  await checkout.save();

  invalidateCheckoutCaches().catch(err =>
    console.error('Failed to invalidate caches:', err)
  );

  res.status(200).json({
    success: true,
    message: "Checkout marked as abandoned"
  });
});

// ============================================
// REDEEM RECOVERY TOKEN  (PUBLIC)
// ============================================

/**
 * Validate a cart recovery JWT and return the restored cart data.
 * The frontend calls this when the customer clicks the email link,
 * then uses the returned checkout data to resume the session.
 *
 * @route  GET /api/v1/checkout/recover?token=<jwt>
 * @access Public — no authentication required
 */
export const redeemRecoveryToken = handleAsyncError(async (req, res, next) => {
  const { token } = req.query;

  if (!token) {
    return next(new HandleError("Recovery token is required", 400));
  }

  // ── 1. Verify the JWT ─────────────────────────────────────
  let decoded;
  try {
    decoded = verifyRecoveryToken(token);
  } catch (err) {
    // err.code is 'EXPIRED' or 'INVALID' — set by recoveryToken.js
    const statusCode = err.code === 'EXPIRED' ? 410 : 400;
    return next(new HandleError(err.message, statusCode));
  }

  // ── 2. Load the checkout ──────────────────────────────────
  const checkout = await Checkout.findById(decoded.checkoutId)
    .populate('user',          'firstName lastName email')
    .populate('items.product', 'name images pricing inventory status');

  if (!checkout) {
    return next(new HandleError("Cart not found. It may have expired.", 404));
  }

  // ── 3. Ownership check ────────────────────────────────────
  // Confirm the userId embedded in the token matches the checkout owner.
  // This prevents token reuse across accounts even if a JWT leaks.
  if (checkout.user._id.toString() !== decoded.userId) {
    return next(new HandleError("Invalid recovery link.", 403));
  }

  // ── 4. Guard: already converted ──────────────────────────
  if (checkout.conversion.isConverted) {
    return res.status(200).json({
      success:   true,
      alreadyConverted: true,
      message:   "This order has already been completed. Thank you!",
      orderId:   checkout.conversion.orderId
    });
  }

  // ── 5. Mark analytics source as email recovery ───────────
  // This is what eventually sets likelyFromEmail on conversion.
  if (!checkout.analytics) checkout.analytics = {};
  checkout.analytics.source = 'email';

  // Restore status to pending so the customer can complete it
  // Only do this if it was abandoned — don't touch completed/expired
  if (checkout.status === 'abandoned') {
    checkout.status         = 'pending';
    checkout.lastActivityAt = new Date();
  }

  await checkout.save();

  invalidateCheckoutCaches().catch(err =>
    console.error('Failed to invalidate caches after recovery:', err)
  );

  // ── 6. Return restored cart ───────────────────────────────
  // Filter out any products that are now unpublished or out of stock
  // so the frontend can warn the customer if items changed
  const availableItems = checkout.items.filter(
    item => item.product?.status === 'published'
  );

  const unavailableItems = checkout.items.filter(
    item => !item.product || item.product.status !== 'published'
  );

  res.status(200).json({
    success:          true,
    message:          "Cart restored successfully. Complete your purchase!",
    alreadyConverted: false,
    checkout: {
      id:             checkout._id,
      items:          availableItems,
      pricing:        checkout.pricing,
      shippingInfo:   checkout.shippingInfo,
      currentStep:    checkout.currentStep,
      unavailableItems: unavailableItems.length > 0
        ? unavailableItems.map(i => ({ name: i.name }))
        : []
    }
  });
});