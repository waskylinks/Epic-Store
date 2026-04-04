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

  // ── Idempotency guard ─────────────────────────────────────────────────────
  // If already abandoned (e.g. duplicate request, double-click, page unload
  // firing twice), return success silently — abandonment is a one-way
  // operation and calling it again should be a no-op, not an error.
  if (checkout.status === 'abandoned') {
    return res.status(200).json({
      success: true,
      message: "Checkout already abandoned"
    });
  }

  // Only pending checkouts can be abandoned. Completed or other terminal
  // states should surface a clear error rather than a silent swallow.
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
    // On expiry, attempt to write lastRecoveryTokenExpiredAt to the document
    // so the analytics layer knows the token expired unused rather than never
    // having been clicked at all. This is a best-effort audit write — failure
    // must never change the 410 response the user receives.
    if (err.code === 'EXPIRED') {
      try {
        const bare = decodeRecoveryToken(token);
        if (bare?.checkoutId) {
          await Checkout.findByIdAndUpdate(bare.checkoutId, {
            $set: { 'abandonment.lastRecoveryTokenExpiredAt': new Date() }
          });
        }
      } catch {
        // Non-fatal — audit write failed, still return 410 below
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
  // populate() returns null for user if the account was deleted after
  // the checkout was created. The cart cannot be safely restored without
  // a valid user to own the session.
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

  // ── 6. Record recovery link click ─────────────────────────────────────────
  checkout.recordRecoveryLinkClick();

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
  // The stored pricing reflects the original cart including now-unavailable
  // items. If any items were filtered out, recompute from available items only
  // so the user sees an accurate total and doesn't proceed with inflated pricing.
  let resolvedPricing = checkout.pricing;

  if (unavailableItems.length > 0) {
    const freshItemPrice = availableItems.reduce(
      (sum, item) => sum + (item.price * item.quantity), 0
    );

    // Reapply discount proportionally if one was present.
    // If the original gross price is available, compute the discount rate and
    // apply it to the new item price. If not, drop the discount entirely since
    // we cannot safely know what portion still applies.
    const originalGross  = checkout.pricing?.grossItemPrice || checkout.pricing?.itemPrice || 0;
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

    // Persist the updated pricing so subsequent requests and the payment
    // controller see the corrected values, not the stale original.
    checkout.pricing = resolvedPricing;
  }

  // ── 11. Re-validate discount code ─────────────────────────────────────────
  // The discount applied at checkout time may have since expired. Check the
  // DB for the current state of the code. If it is no longer valid, strip it
  // from pricing and flag the response so the frontend can inform the user.
  let discountInvalidated = false;

  if (checkout.pricing?.discountCode || checkout.discount?.code) {
    const discountCode = checkout.pricing?.discountCode || checkout.discount?.code;
    try {
      const discountDoc = await Discount.findOne({
        code:     discountCode.toUpperCase(),
        isActive: true,
      });

      const isExpired  = discountDoc?.expiresAt && new Date(discountDoc.expiresAt) < new Date();
      const isInactive = !discountDoc || discountDoc.isActive === false;
      const isExhausted = discountDoc?.maxUses > 0 &&
        (discountDoc?.usedCount || 0) >= discountDoc.maxUses;

      if (isExpired || isInactive || isExhausted) {
        discountInvalidated = true;

        // Strip the discount from pricing — recompute from the gross item price.
        const gross    = checkout.pricing?.grossItemPrice || resolvedPricing.itemPrice || 0;
        const freshTax = Math.round(gross * 0.18 * 100) / 100;
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
      // Non-fatal — if the discount lookup fails, leave pricing as-is.
      // Better to let the payment layer re-validate than to silently
      // strip a discount the user legitimately earned.
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