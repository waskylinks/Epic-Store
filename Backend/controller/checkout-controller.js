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
  if (!userId) return next(new HandleError("User not authenticated", 401));

  const { items, shippingInfo, discountCode, discountAmount } = req.body;

  if (!items || items.length === 0) return next(new HandleError("Cart is empty", 400));

  if (shippingInfo) {
    const requiredFields = ['address', 'city', 'state', 'country', 'phoneNo'];
    const missingFields = requiredFields.filter(field => !shippingInfo[field]);
    if (missingFields.length > 0) {
      return next(new HandleError(`Missing required shipping fields: ${missingFields.join(', ')}`, 400));
    }
  }

  let itemPrice = 0;
  const validItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);
    if (!product || product.status !== 'published') continue;
    const unitPrice = product.pricing?.sale || product.pricing?.regular || 0;
    itemPrice += unitPrice * item.quantity;
    validItems.push({
      product:  product._id,
      name:     product.name,
      price:    unitPrice,
      quantity: item.quantity,
      image:    product.images?.[0]?.url
    });
  }

  if (validItems.length === 0) return next(new HandleError("No valid items in cart", 400));

  const resolvedDiscount =
    discountCode && typeof discountAmount === 'number' && discountAmount > 0
      ? Math.min(discountAmount, itemPrice)
      : 0;

  const discountedItemPrice = Math.max(0, itemPrice - resolvedDiscount);
  const taxPrice            = Math.round(discountedItemPrice * 0.18 * 100) / 100;
  const shippingPrice       = discountedItemPrice >= 500 ? 0 : 50;
  const totalPrice          = Math.round((discountedItemPrice + taxPrice + shippingPrice) * 100) / 100;

  const pricingPayload = {
    itemPrice:     Math.round(discountedItemPrice * 100) / 100,
    taxPrice,
    shippingPrice,
    totalPrice,
    currency:      'USD',
    ...(resolvedDiscount > 0 && {
      discountCode,
      discountAmount: Math.round(resolvedDiscount * 100) / 100,
      grossItemPrice: Math.round(itemPrice * 100) / 100,
    }),
  };

  let checkout = await Checkout.findOne({ user: userId, status: 'pending' });
  const attributionData = req.attributionData || {};
  const deviceInfo      = req.deviceInfo      || {};

  if (checkout) {
    if (checkout.abandonment?.recoverySessionActive) {
      const previousItems = (checkout.items || []).map(i => ({
        product:  i.product?.toString?.() ?? i.product,
        name:     i.name,
        price:    i.price,
        quantity: i.quantity,
      }));
      const previousPricing = checkout.pricing?.toObject ? checkout.pricing.toObject() : { ...checkout.pricing };
      const newItemsForDiff = validItems.map(i => ({
        product:  i.product?.toString?.() ?? i.product,
        name:     i.name,
        price:    i.price,
        quantity: i.quantity,
      }));
      checkout.recordRecoveryInteraction(previousItems, newItemsForDiff, previousPricing, pricingPayload);
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
  invalidateCheckoutCaches().catch(err => console.error('Failed to invalidate caches:', err));

  res.status(200).json({
    success:  true,
    message:  "Checkout session created",
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

  const validSteps = ['shipping_info', 'order_confirmation', 'payment_selection', 'payment_gateway', 'payment_failed'];

  if (!validSteps.includes(step)) return next(new HandleError("Invalid checkout step", 400));

  const checkout = await Checkout.findById(id);
  if (!checkout) return next(new HandleError("Checkout not found", 404));
  if (checkout.user.toString() !== req.user._id.toString()) return next(new HandleError("Unauthorized", 403));

  checkout.updateStep(step);

  if (step === 'payment_gateway' && gateway) {
    checkout.selectedGateway      = gateway;
    checkout.paymentInitialized   = true;
    checkout.paymentInitializedAt = new Date();
  }

  await checkout.save();
  invalidateCheckoutCaches().catch(err => console.error('Failed to invalidate caches:', err));

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
  const checkout = await Checkout.findOne({ user: req.user._id, status: 'pending' })
    .populate('items.product', 'name images pricing inventory')
    .sort({ lastActivityAt: -1 });

  res.status(200).json({ success: true, checkout: checkout || null });
});

// ============================================
// ABANDON CHECKOUT
// @route PUT /api/v1/checkout/:id/abandon
// @access Private
// ============================================
export const abandonCheckout = handleAsyncError(async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user._id;
  const checkout = await Checkout.findById(id);

  if (!checkout) return next(new HandleError("Checkout not found", 404));
  if (checkout.user.toString() !== userId.toString()) return next(new HandleError("Unauthorized", 403));
  if (checkout.status === 'abandoned') return res.status(200).json({ success: true, message: "Checkout already abandoned" });
  if (checkout.status !== 'pending') return next(new HandleError(`Cannot abandon a checkout with status: ${checkout.status}`, 400));

  checkout.markAsAbandoned();
  await checkout.save();
  invalidateCheckoutCaches().catch(err => console.error('Failed to invalidate caches:', err));

  res.status(200).json({ success: true, message: "Checkout marked as abandoned" });
});

// ============================================
// REDEEM RECOVERY TOKEN
// @route GET /api/v1/checkout/recover
// @access Public
// ============================================
export const redeemRecoveryToken = handleAsyncError(async (req, res, next) => {
  const { token } = req.query;

  if (!token) return next(new HandleError("Recovery token is required", 400));

  // ── Helper: issue auth cookie from a userId ───────────────────────────────
  const issueAuthCookie = async (userId) => {
    try {
      const User = (await import('../models/userModel.js')).default;
      const user = await User.findById(userId);
      if (!user) return null;

      const jwt           = (await import('jsonwebtoken')).default;
      const JWT_SECRET    = process.env.JWT_SECRET_KEY;
      const JWT_EXPIRE    = process.env.JWT_EXPIRE || '7d';
      const COOKIE_EXPIRE = parseInt(process.env.COOKIE_EXPIRES_TIME) || 7;

      const authToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

      res.cookie('token', authToken, {
        expires:  new Date(Date.now() + COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path:     '/',
      });

      return user;
    } catch (err) {
      console.error('[redeemRecoveryToken] issueAuthCookie failed:', err.message);
      return null;
    }
  };

  // ── Step 1: Always decode first (no expiry check) to get userId ───────────
  // The payload is intact even on expired tokens — expiry is just a claim.
  // This guarantees the user is always logged in as long as the token is
  // structurally valid.
  let bare;
  try {
    bare = decodeRecoveryToken(token);
  } catch (err) {
    return next(new HandleError("Recovery link is invalid or malformed.", 400));
  }

  if (!bare?.userId) {
    return next(new HandleError("Recovery link is invalid.", 400));
  }

  // ── Step 2: Issue the auth cookie immediately — before any branching ──────
  const user = await issueAuthCookie(bare.userId);

  // ── Step 3: Verify expiry ─────────────────────────────────────────────────
  let decoded;
  let isExpired      = false;
  let expiredMessage = null;

  try {
    decoded = verifyRecoveryToken(token);
  } catch (err) {
    if (err.code === 'EXPIRED') {
      isExpired      = true;
      expiredMessage = err.message;
    } else {
      return next(new HandleError(err.message, 400));
    }
  }

  // ── Step 4: Expired path ──────────────────────────────────────────────────
  // ONLY truly expired tokens (JWT exp claim elapsed) return here.
  // exhausted outcome does NOT gate this path — if the JWT is still valid,
  // the full recovery flow runs regardless of how many emails were sent.
  if (isExpired) {
    // Record the expired token click and update lastRecoveryTokenExpiredAt
    // on the checkout so the cron sweep has an accurate expiry timestamp.
    if (bare.checkoutId) {
      try {
        const RecoveryEmail = (await import('../models/recovery-email-model.js')).default;
        const recoveryEmailDoc = await RecoveryEmail.findOne({ checkout: bare.checkoutId });

        if (recoveryEmailDoc) {
          // bare.jti is the tokenId — fall back to lastTokenId if not present
          // (some older tokens may not have jti surfaced in the bare payload).
          const tokenId = bare.jti || recoveryEmailDoc.lastTokenId;
          recoveryEmailDoc.recordExpiredLinkClick(tokenId);
          await recoveryEmailDoc.save();
        }

        // Also stamp the checkout so the cron has a reliable expiry signal
        await Checkout.findByIdAndUpdate(bare.checkoutId, {
          $set: { 'abandonment.lastRecoveryTokenExpiredAt': new Date() }
        }).catch(() => {});
      } catch (e) {
        console.error('[redeemRecoveryToken] failed to record expired click:', e.message);
      }
    }

    return res.status(200).json({
      success: false,
      expired: true,
      message: expiredMessage,
      ...(user && {
        user: {
          _id:       user._id,
          firstName: user.firstName,
          lastName:  user.lastName,
          email:     user.email,
          role:      user.role,
          avatar:    user.avatar,
        }
      }),
    });
  }

  // ── Step 5: Load the checkout (valid token path) ──────────────────────────
  // At this point the JWT signature and expiry are both valid.
  // We proceed with full recovery regardless of the RecoveryEmail outcome
  // field — exhausted only means no more sends, not that the user cannot
  // recover their cart via a token that is still cryptographically valid.
  const checkout = await Checkout.findById(decoded.checkoutId)
    .populate('user',          'firstName lastName email role avatar')
    .populate('items.product', 'name images pricing inventory status');

  if (!checkout) return next(new HandleError("Cart not found. It may have expired.", 404));

  if (!checkout.user || typeof checkout.user !== 'object') {
    return res.status(200).json({
      success: false,
      expired: true,
      message: "The account associated with this cart no longer exists.",
    });
  }

  if (checkout.user._id.toString() !== decoded.userId) {
    return next(new HandleError("Invalid recovery link.", 403));
  }

  // ── Step 6: alreadyConverted ──────────────────────────────────────────────
  if (checkout.conversion.isConverted) {
    return res.status(200).json({
      success:          true,
      alreadyConverted: true,
      message:          "This order has already been completed. Thank you!",
      orderId:          checkout.conversion.orderId,
      user: {
        _id:       checkout.user._id,
        firstName: checkout.user.firstName,
        lastName:  checkout.user.lastName,
        email:     checkout.user.email,
        role:      checkout.user.role,
        avatar:    checkout.user.avatar,
      },
    });
  }

  // ── Step 7: Record recovery link click on the checkout doc ────────────────
  checkout.recordRecoveryLinkClick();

  // ── Step 8: Record click on the RecoveryEmail doc ─────────────────────────
  // This runs regardless of the current outcome value (including exhausted).
  // recordLinkClick handles outcome promotion internally — it will advance
  // exhausted → clicked because exhausted is no longer a hard terminal for
  // click tracking (see recovery-email-model.js fix).
  const RecoveryEmail = (await import('../models/recovery-email-model.js')).default;
  const recoveryEmailDoc = await RecoveryEmail.findOne({ checkout: checkout._id });

  if (recoveryEmailDoc) {
    const clicked = recoveryEmailDoc.recordLinkClick(decoded.jti, checkout.currentStep);
    if (!clicked) {
      console.warn(`[redeemRecoveryToken] jti ${decoded.jti} not found in RecoveryEmail for checkout ${checkout._id}`);
    }
    await recoveryEmailDoc.save();
  }

  // ── Step 9: Restore abandoned checkout ───────────────────────────────────
  if (!checkout.analytics) checkout.analytics = {};
  checkout.analytics.source = 'email';

  if (checkout.status === 'abandoned') {
    checkout.status         = 'pending';
    checkout.lastActivityAt = new Date();
  }

  // ── Step 10: Filter unavailable items ────────────────────────────────────
  const availableItems   = checkout.items.filter(item => item.product?.status === 'published');
  const unavailableItems = checkout.items.filter(item => !item.product || item.product.status !== 'published');

  // ── Step 11: Recompute pricing if items were removed ─────────────────────
  let resolvedPricing = checkout.pricing;

  if (unavailableItems.length > 0) {
    const freshItemPrice       = availableItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const originalGross        = checkout.pricing?.grossItemPrice || checkout.pricing?.itemPrice || 0;
    const originalDiscount     = checkout.pricing?.discountAmount || 0;
    let freshDiscountAmount    = 0;

    if (originalDiscount > 0 && originalGross > 0) {
      const discountRate  = originalDiscount / originalGross;
      freshDiscountAmount = Math.min(Math.round(freshItemPrice * discountRate * 100) / 100, freshItemPrice);
    }

    const freshDiscountedItemPrice = Math.max(0, freshItemPrice - freshDiscountAmount);
    const freshTax      = Math.round(freshDiscountedItemPrice * 0.18 * 100) / 100;
    const freshShipping = freshDiscountedItemPrice >= 500 ? 0 : 50;
    const freshTotal    = Math.round((freshDiscountedItemPrice + freshTax + freshShipping) * 100) / 100;

    resolvedPricing = {
      ...checkout.pricing.toObject ? checkout.pricing.toObject() : checkout.pricing,
      itemPrice:     Math.round(freshDiscountedItemPrice * 100) / 100,
      taxPrice:      freshTax,
      shippingPrice: freshShipping,
      totalPrice:    freshTotal,
      ...(freshDiscountAmount > 0
        ? { discountAmount: freshDiscountAmount, grossItemPrice: Math.round(freshItemPrice * 100) / 100 }
        : { discountAmount: 0, discountCode: undefined, grossItemPrice: undefined }
      ),
    };

    checkout.pricing = resolvedPricing;
  }

  // ── Step 12: Re-validate discount code ───────────────────────────────────
  let discountInvalidated = false;

  if (checkout.pricing?.discountCode || checkout.discount?.code) {
    const discountCode = checkout.pricing?.discountCode || checkout.discount?.code;
    try {
      const discountDoc        = await Discount.findOne({ code: discountCode.toUpperCase(), isActive: true });
      const isExpiredDiscount  = discountDoc?.expiresAt && new Date(discountDoc.expiresAt) < new Date();
      const isInactive         = !discountDoc || discountDoc.isActive === false;
      const isExhausted        = discountDoc?.maxUses > 0 && (discountDoc?.usedCount || 0) >= discountDoc.maxUses;

      if (isExpiredDiscount || isInactive || isExhausted) {
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
    } catch { /* non-fatal */ }
  }

  await checkout.save();
  invalidateCheckoutCaches().catch(err => console.error('Failed to invalidate caches after recovery:', err));

  // ── Step 13: Return restored cart ────────────────────────────────────────
  res.status(200).json({
    success:          true,
    message:          "Cart restored successfully. Complete your purchase!",
    alreadyConverted: false,
    user: {
      _id:       checkout.user._id,
      firstName: checkout.user.firstName,
      lastName:  checkout.user.lastName,
      email:     checkout.user.email,
      role:      checkout.user.role,
      avatar:    checkout.user.avatar,
    },
    ...(discountInvalidated && {
      discountWarning: "Your discount code is no longer valid and has been removed from your cart."
    }),
    checkout: {
      id:               checkout._id,
      items:            availableItems,
      pricing:          resolvedPricing,
      shippingInfo:     checkout.shippingInfo,
      currentStep:      checkout.currentStep,
      unavailableItems: unavailableItems.length > 0 ? unavailableItems.map(i => ({ name: i.name })) : []
    }
  });
});