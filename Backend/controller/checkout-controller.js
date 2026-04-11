import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout from "../models/checkout-model.js";
import Product from "../models/product-model.js";
import Discount from "../models/discount-model.js";
import { deleteCachePattern } from '../utils/redis.js';
import { verifyRecoveryToken, decodeRecoveryToken } from '../utils/recoveryToken.js';

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
// @route POST /api/v1/checkout/create
// @access Private
// ============================================
export const createCheckout = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) {
    return next(new HandleError("User not authenticated", 401));
  }

  const { items, shippingInfo, discountCode, discountAmount } = req.body;

  if (!items || items.length === 0) {
    return next(new HandleError("Cart is empty", 400));
  }

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

  let itemPrice = 0;
  const validItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);
    if (!product || product.status !== 'published') continue;

    const unitPrice = product.pricing?.sale || product.pricing?.regular || 0;
    const itemTotal = unitPrice * item.quantity;
    itemPrice += itemTotal;

    validItems.push({
      product:  product._id,
      name:     product.name,
      price:    unitPrice,
      quantity: item.quantity,
      image:    product.images?.[0]?.url
    });
  }

  if (validItems.length === 0) {
    return next(new HandleError("No valid items in cart", 400));
  }

  const resolvedDiscount =
    discountCode &&
    typeof discountAmount === 'number' &&
    discountAmount > 0
      ? Math.min(discountAmount, itemPrice)
      : 0;

  const discountedItemPrice = Math.max(0, itemPrice - resolvedDiscount);
  const taxPrice            = Math.round(discountedItemPrice * 0.18 * 100) / 100;
  const shippingPrice       = discountedItemPrice >= 500 ? 0 : 50;
  const totalPrice          = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

  const pricingPayload = {
    itemPrice:      Math.round(discountedItemPrice * 100) / 100,
    taxPrice,
    shippingPrice,
    totalPrice,
    currency:       'USD',
    ...(resolvedDiscount > 0 && {
      discountCode,
      discountAmount:  Math.round(resolvedDiscount * 100) / 100,
      grossItemPrice:  Math.round(itemPrice * 100) / 100,
    }),
  };

  let checkout = await Checkout.findOne({ user: userId, status: 'pending' });

  const attributionData = req.attributionData || {};
  const deviceInfo      = req.deviceInfo      || {};

  if (checkout) {
    // ── BUG FIX: Record recovery interactions before overwriting items/pricing.
    // When recoverySessionActive is true the user is modifying their cart
    // during an active recovery session. We must diff the old vs new state
    // and append to recoveryInteractions so that analytics (cart diffs,
    // "with discount during recovery" count) are accurate.
    // Previously items and pricing were silently overwritten with no diff,
    // leaving recoveryInteractions empty and computeRecoveryCartDiff useless.
    if (checkout.abandonment?.recoverySessionActive) {
      const previousItems   = (checkout.items || []).map(i => ({
        product:  i.product?.toString?.() ?? i.product,
        name:     i.name,
        price:    i.price,
        quantity: i.quantity,
      }));
      const previousPricing = checkout.pricing?.toObject
        ? checkout.pricing.toObject()
        : { ...checkout.pricing };

      // Build new items in the same shape for the diff helper
      const newItemsForDiff = validItems.map(i => ({
        product:  i.product?.toString?.() ?? i.product,
        name:     i.name,
        price:    i.price,
        quantity: i.quantity,
      }));

      checkout.recordRecoveryInteraction(
        previousItems,
        newItemsForDiff,
        previousPricing,
        pricingPayload
      );
    }

    checkout.items   = validItems;
    checkout.pricing = pricingPayload;

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
    checkout = new Checkout({
      user:  userId,
      email: req.user.email,
      items: validItems,
      pricing: pricingPayload,
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
        source:      attributionData.source || 'email',
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
// @route PUT /api/v1/checkout/:id/step
// @access Private
// ============================================
export const updateCheckoutStep = handleAsyncError(async (req, res, next) => {
  const { id }            = req.params;
  const { step, gateway } = req.body;

  const validSteps = [
    'shipping_info',
    'order_confirmation',
    'payment_selection',
    'payment_gateway',
    'payment_failed'
  ];

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
    checkout.selectedGateway      = gateway;
    checkout.paymentInitialized   = true;
    checkout.paymentInitializedAt = new Date();
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
// @route GET /api/v1/checkout/active
// @access Private
// ============================================
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
// ABANDON CHECKOUT
// @route PUT /api/v1/checkout/:id/abandon
// @access Private
// ============================================
export const abandonCheckout = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const checkout = await Checkout.findById(id);

  if (!checkout) {
    return next(new HandleError("Checkout not found", 404));
  }

  if (checkout.user.toString() !== userId.toString()) {
    return next(new HandleError("Unauthorized", 403));
  }

  if (checkout.status === 'abandoned') {
    return res.status(200).json({
      success: true,
      message: "Checkout already abandoned"
    });
  }

  if (checkout.status !== 'pending') {
    return next(new HandleError(
      `Cannot abandon a checkout with status: ${checkout.status}`, 400
    ));
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
// REDEEM RECOVERY TOKEN
// @route GET /api/v1/checkout/recover?token=<jwt>
// @access Public
// ============================================
export const redeemRecoveryToken = handleAsyncError(async (req, res, next) => {
  const { token } = req.query;

  if (!token) {
    return next(new HandleError("Recovery token is required", 400));
  }

  // ── 1. Verify the JWT ─────────────────────────────────────────────────────
  let decoded;
  try {
    decoded = verifyRecoveryToken(token);
  } catch (err) {
    if (err.code === 'EXPIRED') {
      try {
        const bare = decodeRecoveryToken(token);
        if (bare?.checkoutId) {
          await Checkout.findByIdAndUpdate(bare.checkoutId, {
            $set: { 'abandonment.lastRecoveryTokenExpiredAt': new Date() }
          });
        }
      } catch {
        // Non-fatal
      }
      return next(new HandleError(err.message, 410));
    }
    return next(new HandleError(err.message, 400));
  }

  // ── 2. Load the checkout ──────────────────────────────────────────────────
  const checkout = await Checkout.findById(decoded.checkoutId)
    .populate('user',          'firstName lastName email')
    .populate('items.product', 'name images pricing inventory status');

  if (!checkout) {
    return next(new HandleError("Cart not found. It may have expired.", 404));
  }

  // ── 3. Guard: deleted user account ────────────────────────────────────────
  if (!checkout.user || typeof checkout.user !== 'object') {
    return next(new HandleError(
      "The account associated with this cart no longer exists.", 410
    ));
  }

  // ── 4. Ownership check ────────────────────────────────────────────────────
  if (checkout.user._id.toString() !== decoded.userId) {
    return next(new HandleError("Invalid recovery link.", 403));
  }

  // ── 5. Guard: already converted ───────────────────────────────────────────
  if (checkout.conversion.isConverted) {
    return res.status(200).json({
      success:          true,
      alreadyConverted: true,
      message:          "This order has already been completed. Thank you!",
      orderId:          checkout.conversion.orderId
    });
  }

  // ── 6. Record recovery link click on Checkout document ───────────────────
  checkout.recordRecoveryLinkClick();

  // ── 6b. Record click on RecoveryEmail document ────────────────────────────
  const RecoveryEmail = (await import('../models/recovery-email-model.js')).default;
  const recoveryEmailDoc = await RecoveryEmail.findOne({ checkout: checkout._id });
  if (recoveryEmailDoc) {
    const clickedAttempt = recoveryEmailDoc.recordLinkClick(
      decoded.jti,
      checkout.currentStep
    );
    if (!clickedAttempt) {
      console.warn(
        `[redeemRecoveryToken] jti ${decoded.jti} not found in RecoveryEmail attempts` +
        ` for checkout ${checkout._id}. Click recorded on Checkout doc only.`
      );
    }
    await recoveryEmailDoc.save();
  }

  // ── 7. Mark analytics source as email recovery ───────────────────────────
  if (!checkout.analytics) checkout.analytics = {};
  checkout.analytics.source = 'email';

  // ── 8. Restore status if abandoned ───────────────────────────────────────
  if (checkout.status === 'abandoned') {
    checkout.status         = 'pending';
    checkout.lastActivityAt = new Date();
  }

  // ── 9. Filter unavailable items ───────────────────────────────────────────
  const availableItems = checkout.items.filter(
    item => item.product?.status === 'published'
  );
  const unavailableItems = checkout.items.filter(
    item => !item.product || item.product.status !== 'published'
  );

  // ── 10. Recompute pricing if items were removed ───────────────────────────
  let resolvedPricing = checkout.pricing;

  if (unavailableItems.length > 0) {
    const freshItemPrice = availableItems.reduce(
      (sum, item) => sum + (item.price * item.quantity), 0
    );

    const originalGross    = checkout.pricing?.grossItemPrice || checkout.pricing?.itemPrice || 0;
    const originalDiscount = checkout.pricing?.discountAmount || 0;

    let freshDiscountAmount = 0;
    if (originalDiscount > 0 && originalGross > 0) {
      const discountRate  = originalDiscount / originalGross;
      freshDiscountAmount = Math.min(
        Math.round(freshItemPrice * discountRate * 100) / 100,
        freshItemPrice
      );
    }

    const freshDiscountedItemPrice = Math.max(0, freshItemPrice - freshDiscountAmount);
    const freshTax      = Math.round(freshDiscountedItemPrice * 0.18 * 100) / 100;
    const freshShipping = freshDiscountedItemPrice >= 500 ? 0 : 50;
    const freshTotal    = Math.round(
      (freshDiscountedItemPrice + freshTax + freshShipping) * 100
    ) / 100;

    resolvedPricing = {
      ...checkout.pricing.toObject ? checkout.pricing.toObject() : checkout.pricing,
      itemPrice:     Math.round(freshDiscountedItemPrice * 100) / 100,
      taxPrice:      freshTax,
      shippingPrice: freshShipping,
      totalPrice:    freshTotal,
      ...(freshDiscountAmount > 0 && {
        discountAmount: freshDiscountAmount,
        grossItemPrice: Math.round(freshItemPrice * 100) / 100,
      }),
      ...(freshDiscountAmount === 0 && {
        discountAmount: 0,
        discountCode:   undefined,
        grossItemPrice: undefined,
      }),
    };

    checkout.pricing = resolvedPricing;
  }

  // ── 11. Re-validate discount code ─────────────────────────────────────────
  let discountInvalidated = false;

  if (checkout.pricing?.discountCode || checkout.discount?.code) {
    const discountCode = checkout.pricing?.discountCode || checkout.discount?.code;
    try {
      const discountDoc = await Discount.findOne({
        code:     discountCode.toUpperCase(),
        isActive: true,
      });

      const isExpired   = discountDoc?.expiresAt && new Date(discountDoc.expiresAt) < new Date();
      const isInactive  = !discountDoc || discountDoc.isActive === false;
      const isExhausted = discountDoc?.maxUses > 0 &&
        (discountDoc?.usedCount || 0) >= discountDoc.maxUses;

      if (isExpired || isInactive || isExhausted) {
        discountInvalidated = true;

        const gross         = checkout.pricing?.grossItemPrice || resolvedPricing.itemPrice || 0;
        const freshTax      = Math.round(gross * 0.18 * 100) / 100;
        const freshShipping = gross >= 500 ? 0 : 50;
        const freshTotal    = Math.round((gross + freshTax + freshShipping) * 100) / 100;

        checkout.pricing = {
          ...resolvedPricing,
          itemPrice:      gross,
          taxPrice:       freshTax,
          shippingPrice:  freshShipping,
          totalPrice:     freshTotal,
          discountAmount: 0,
          discountCode:   undefined,
          grossItemPrice: undefined,
        };

        resolvedPricing = checkout.pricing;
      }
    } catch {
      // Non-fatal
    }
  }

  await checkout.save();

  invalidateCheckoutCaches().catch(err =>
    console.error('Failed to invalidate caches after recovery:', err)
  );

  // ── 12. Return restored cart ──────────────────────────────────────────────
  res.status(200).json({
    success:          true,
    message:          "Cart restored successfully. Complete your purchase!",
    alreadyConverted: false,
    ...(discountInvalidated && {
      discountWarning: "Your discount code is no longer valid and has been removed from your cart."
    }),
    checkout: {
      id:             checkout._id,
      items:          availableItems,
      pricing:        resolvedPricing,
      shippingInfo:   checkout.shippingInfo,
      currentStep:    checkout.currentStep,
      unavailableItems: unavailableItems.length > 0
        ? unavailableItems.map(i => ({ name: i.name }))
        : []
    }
  });
});