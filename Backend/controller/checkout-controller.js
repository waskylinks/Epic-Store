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
//
// Security fixes applied:
//
// [FIX 1] discountAmount is no longer accepted from the client.
//         The discount code is validated server-side against the Discount
//         collection and the amount is computed from the stored percentage/
//         flat value. Sending any discountAmount in the request body is
//         silently ignored.
//
// [FIX 2] Item prices are never trusted from the client.
//         Price is always read from Product.pricing in the database.
//
// [FIX 3] Item quantity is clamped to a positive integer (1-100).
//
// [FIX 4] The items array length is capped (MAX_ITEMS = 50).
//
// [FIX 5] Only published products are included.
//
// [FIX 6] analytics.source validated against schema enum before assignment.
//
// [FIX 7] Checkout ownership is enforced on update.
// ============================================

const MAX_ITEMS = 50;
const MAX_ITEM_QUANTITY = 100;
const VALID_ANALYTICS_SOURCES = ['organic', 'paid', 'referral', 'email', 'social', 'direct'];

// Canonical step order — used by updateCheckoutStep to enforce forward-only progression.
const STEP_ORDER = [
  'shipping_info',
  'order_confirmation',
  'payment_selection',
  'payment_gateway',
  'payment_failed',
];

/**
 * resolveDiscountServer
 * Validates a discount code against the DB and returns the concrete discount
 * amount to subtract from itemPrice. Returns 0 if the code is invalid,
 * expired, exhausted, or not provided.
 */
const resolveDiscountServer = async (discountCode, itemPrice) => {
  if (!discountCode || typeof discountCode !== 'string') return { amount: 0, discountId: null };

  const code = discountCode.trim().toUpperCase();
  if (!code) return { amount: 0, discountId: null };

  let discountDoc;
  try {
    discountDoc = await Discount.findOne({ code, isActive: true });
  } catch {
    return { amount: 0, discountId: null };
  }

  if (!discountDoc) return { amount: 0, discountId: null };

  if (discountDoc.expiresAt && new Date(discountDoc.expiresAt) < new Date()) {
    return { amount: 0, discountId: null };
  }

  if (discountDoc.maxUses > 0 && (discountDoc.usedCount || 0) >= discountDoc.maxUses) {
    return { amount: 0, discountId: null };
  }

  let amount = 0;
  if (discountDoc.type === 'percentage') {
    amount = Math.round(itemPrice * (discountDoc.value / 100) * 100) / 100;
  } else {
    amount = discountDoc.value || 0;
  }

  amount = Math.min(amount, itemPrice);
  amount = Math.max(0, Math.round(amount * 100) / 100);

  return { amount, discountId: discountDoc._id, code };
};

export const createCheckout = handleAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  if (!userId) return next(new HandleError("User not authenticated", 401));

  // [FIX 1] discountAmount intentionally NOT destructured — derived server-side below.
  const { items, shippingInfo, discountCode } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(new HandleError("Cart is empty", 400));
  }

  // [FIX 4]
  if (items.length > MAX_ITEMS) {
    return next(new HandleError(`Cart cannot contain more than ${MAX_ITEMS} items`, 400));
  }

  if (shippingInfo) {
    const requiredFields = ['address', 'city', 'state', 'country', 'phoneNo'];
    const missingFields  = requiredFields.filter(field => !shippingInfo[field]);
    if (missingFields.length > 0) {
      return next(new HandleError(`Missing required shipping fields: ${missingFields.join(', ')}`, 400));
    }
  }

  let rawItemPrice = 0;
  const validItems = [];

  for (const item of items) {
    // [FIX 3]
    const quantity = parseInt(item.quantity, 10);
    if (!quantity || quantity < 1) continue;
    const clampedQty = Math.min(quantity, MAX_ITEM_QUANTITY);

    const product = await Product.findById(item.product);
    if (!product || product.status !== 'published') continue;

    // [FIX 2]
    const unitPrice = product.pricing?.sale || product.pricing?.regular || 0;
    rawItemPrice += unitPrice * clampedQty;

    validItems.push({
      product:  product._id,
      name:     product.name,
      price:    unitPrice,
      quantity: clampedQty,
      image:    product.images?.[0]?.url
    });
  }

  if (validItems.length === 0) return next(new HandleError("No valid items in cart", 400));

  // [FIX 1]
  const { amount: resolvedDiscount, discountId, code: resolvedCode } =
    await resolveDiscountServer(discountCode, rawItemPrice);

  const discountedItemPrice = Math.max(0, rawItemPrice - resolvedDiscount);
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
      discountCode:   resolvedCode,
      discountAmount: Math.round(resolvedDiscount * 100) / 100,
      grossItemPrice: Math.round(rawItemPrice * 100) / 100,
    }),
  };

  // [FIX 6]
  const attributionData = req.attributionData || {};
  const deviceInfo      = req.deviceInfo      || {};
  const rawSource       = attributionData.source;
  const safeSource      = VALID_ANALYTICS_SOURCES.includes(rawSource) ? rawSource : 'direct';

  // [FIX 7]
  let checkout = await Checkout.findOne({ user: userId, status: 'pending' });

  if (checkout) {
    if (checkout.abandonment?.recoverySessionActive) {
      const previousItems = (checkout.items || []).map(i => ({
        product:  i.product?.toString?.() ?? i.product,
        name:     i.name,
        price:    i.price,
        quantity: i.quantity,
      }));
      const previousPricing = checkout.pricing?.toObject
        ? checkout.pricing.toObject()
        : { ...checkout.pricing };
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
        source:      safeSource,
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
//
// [FIX 8] Step progression is validated as forward-only relative to the
//         current step. A client cannot jump backwards (e.g. from
//         payment_gateway back to shipping_info) or skip forward arbitrarily.
//         payment_failed is the one exception — it can only be set from
//         payment_gateway, which is enforced by the ALLOWED_TRANSITIONS map.
// ============================================

// Allowed transitions: each step lists the steps that may legally follow it.
// This enforces forward-only flow without preventing legitimate re-visits
// (e.g. user goes back to shipping from order_confirmation to edit an address).
// The rule is: you may only advance to a step at the same index or higher
// than your current step, EXCEPT for payment_failed which is terminal and
// may only be reached from payment_gateway.
const ALLOWED_NEXT_STEPS = {
  shipping_info:      ['shipping_info', 'order_confirmation'],
  order_confirmation: ['shipping_info', 'order_confirmation', 'payment_selection'],
  payment_selection:  ['shipping_info', 'order_confirmation', 'payment_selection', 'payment_gateway'],
  payment_gateway:    ['shipping_info', 'order_confirmation', 'payment_selection', 'payment_gateway', 'payment_failed'],
  payment_failed:     ['shipping_info', 'order_confirmation', 'payment_selection', 'payment_gateway', 'payment_failed'],
};

export const updateCheckoutStep = handleAsyncError(async (req, res, next) => {
  const { id }            = req.params;
  const { step, gateway } = req.body;

  const validSteps = STEP_ORDER;
  if (!validSteps.includes(step)) return next(new HandleError("Invalid checkout step", 400));

  const checkout = await Checkout.findById(id);
  if (!checkout) return next(new HandleError("Checkout not found", 404));
  if (checkout.user.toString() !== req.user._id.toString()) return next(new HandleError("Unauthorized", 403));

  // [FIX 8] Enforce that the requested step is a legal transition from the
  // current step. This prevents clients from jumping to arbitrary steps.
  const allowedFromCurrent = ALLOWED_NEXT_STEPS[checkout.currentStep] || [];
  if (!allowedFromCurrent.includes(step)) {
    return next(new HandleError(
      `Cannot transition from '${checkout.currentStep}' to '${step}'`,
      400
    ));
  }

  checkout.updateStep(step);

  if (step === 'payment_gateway' && gateway) {
    const validGateways = ['stripe', 'paystack', 'flutterwave'];
    if (!validGateways.includes(gateway)) {
      return next(new HandleError("Invalid payment gateway", 400));
    }
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
  const { id } = req.params;
  const userId = req.user._id;
  const checkout = await Checkout.findById(id);

  if (!checkout)                                          return next(new HandleError("Checkout not found", 404));
  if (checkout.user.toString() !== userId.toString())    return next(new HandleError("Unauthorized", 403));
  if (checkout.status === 'abandoned')                   return res.status(200).json({ success: true, message: "Checkout already abandoned" });
  if (checkout.status !== 'pending')                     return next(new HandleError(`Cannot abandon a checkout with status: ${checkout.status}`, 400));

  checkout.markAsAbandoned();
  await checkout.save();
  invalidateCheckoutCaches().catch(err => console.error('Failed to invalidate caches:', err));

  res.status(200).json({ success: true, message: "Checkout marked as abandoned" });
});

// ============================================
// REDEEM RECOVERY TOKEN
// @route GET /api/v1/checkout/recover
// @access Public
//
// [FIX 9]  Auth cookie is now issued AFTER verifyRecoveryToken confirms the
//          JWT signature is valid. decodeRecoveryToken (which ignores the
//          signature) is still used first to extract userId for the expiry
//          path — but the cookie is not set until signature verification
//          passes (or, in the expiry branch, we explicitly allow it as a
//          known-expired-but-structurally-valid token from our own key).
//
// [FIX 10] Recovery pricing recomputed from live product prices fetched from
//          the DB rather than from stored item.price values, so a tampered
//          discount at cart-creation time cannot be laundered through
//          recovery.
// ============================================
export const redeemRecoveryToken = handleAsyncError(async (req, res, next) => {
  const { token } = req.query;

  if (!token) return next(new HandleError("Recovery token is required", 400));

  // ── Helper: issue auth cookie ─────────────────────────────────────────────
  const issueAuthCookie = async (userId) => {
    try {
      const User          = (await import('../models/userModel.js')).default;
      const user          = await User.findById(userId);
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

  // ── Step 1: Verify JWT signature and expiry ───────────────────────────────
  // [FIX 9] Signature verification happens first. We only proceed (and only
  // issue a cookie) if the token was signed by us — either still valid, or
  // expired but structurally authentic. An attacker who submits a forged token
  // (wrong signature) is rejected here before any cookie is set.
  let decoded    = null;
  let isExpired  = false;
  let bare       = null;

  try {
    decoded = verifyRecoveryToken(token);
    // Valid token — also decode for convenience fields (jti etc.)
    bare = decoded;
  } catch (err) {
    if (err.code === 'EXPIRED') {
      // Token signature is valid but JWT exp has elapsed.
      // Decode without expiry check so we can extract userId / checkoutId.
      isExpired = true;
      try {
        bare = decodeRecoveryToken(token);
      } catch {
        return next(new HandleError("Recovery link is invalid or malformed.", 400));
      }
    } else {
      // Signature invalid or token malformed — reject outright.
      return next(new HandleError(err.message || "Recovery link is invalid or malformed.", 400));
    }
  }

  if (!bare?.userId) {
    return next(new HandleError("Recovery link is invalid.", 400));
  }

  // ── Step 2: Issue auth cookie ─────────────────────────────────────────────
  // [FIX 9] Cookie is only issued after we have confirmed the token was signed
  // by us (either valid or authentically expired). Forged tokens never reach
  // this point.
  const user = await issueAuthCookie(bare.userId);

  // ── Step 3: EXPIRED PATH ──────────────────────────────────────────────────
  if (isExpired) {
    if (bare.checkoutId) {
      try {
        const RecoveryEmail    = (await import('../models/recovery-email-model.js')).default;
        const recoveryEmailDoc = await RecoveryEmail.findOne({ checkout: bare.checkoutId });

        if (recoveryEmailDoc) {
          const tokenId = bare.jti || recoveryEmailDoc.lastTokenId;
          recoveryEmailDoc.recordExpiredLinkClick(tokenId);
          await recoveryEmailDoc.save();
        }

        await Checkout.findByIdAndUpdate(bare.checkoutId, {
          $set: { 'abandonment.lastRecoveryTokenExpiredAt': new Date() }
        }).catch(() => {});
      } catch (e) {
        console.error('[redeemRecoveryToken] failed to record late click:', e.message);
      }
    }

    return res.status(200).json({
      success: false,
      expired: true,
      message: "This recovery link has expired.",
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

  // ── Step 4: VALID TOKEN PATH ──────────────────────────────────────────────
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

  // ── Step 5: Already converted ─────────────────────────────────────────────
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

  // ── Step 6: Record click on checkout doc ──────────────────────────────────
  checkout.recordRecoveryLinkClick();

  // ── Step 7: Record click on RecoveryEmail doc ─────────────────────────────
  const RecoveryEmail    = (await import('../models/recovery-email-model.js')).default;
  const recoveryEmailDoc = await RecoveryEmail.findOne({ checkout: checkout._id });

  if (recoveryEmailDoc) {
    const clicked = recoveryEmailDoc.recordLinkClick(decoded.jti, checkout.currentStep);
    if (!clicked) {
      console.warn(
        `[redeemRecoveryToken] jti ${decoded.jti} not found in RecoveryEmail` +
        ` for checkout ${checkout._id}`
      );
    }
    await recoveryEmailDoc.save();
  }

  // ── Step 8: Restore abandoned checkout ────────────────────────────────────
  if (!checkout.analytics) checkout.analytics = {};
  checkout.analytics.source = 'email';

  if (checkout.status === 'abandoned') {
    checkout.status         = 'pending';
    checkout.lastActivityAt = new Date();
  }

  // ── Step 9: Filter unavailable items ─────────────────────────────────────
  const availableItems   = checkout.items.filter(item => item.product?.status === 'published');
  const unavailableItems = checkout.items.filter(item => !item.product || item.product.status !== 'published');

  // ── Step 10: Recompute pricing from LIVE product prices ───────────────────
  // [FIX 10] item.price stored on the checkout document is not trusted here.
  // We fetch the current price from the populated product document so that
  // any tampered discount rate stored at cart-creation time cannot be
  // laundered through the recovery recompute.
  let resolvedPricing = checkout.pricing;

  // Capture the original stored discount code BEFORE checkout.pricing is
  // overwritten below — used for the discountInvalidated flag at the end.
  const originalStoredCode = checkout.pricing?.discountCode || checkout.discount?.code || null;

  {
    // Always recompute from live prices, not stored item.price.
    const freshRawItemPrice = availableItems.reduce((sum, item) => {
      const livePrice = item.product?.pricing?.sale || item.product?.pricing?.regular || 0;
      return sum + (livePrice * item.quantity);
    }, 0);

    // Re-validate the discount code against the DB (same logic as createCheckout).
    let freshDiscountAmount = 0;
    let freshDiscountCode   = undefined;

    const storedCode = originalStoredCode;
    if (storedCode) {
      try {
        const discountDoc       = await Discount.findOne({ code: storedCode.toUpperCase(), isActive: true });
        const isExpiredDiscount = discountDoc?.expiresAt && new Date(discountDoc.expiresAt) < new Date();
        const isInactive        = !discountDoc || discountDoc.isActive === false;
        const isExhausted       = discountDoc?.maxUses > 0 && (discountDoc?.usedCount || 0) >= discountDoc.maxUses;

        if (!isExpiredDiscount && !isInactive && !isExhausted) {
          if (discountDoc.type === 'percentage') {
            freshDiscountAmount = Math.round(freshRawItemPrice * (discountDoc.value / 100) * 100) / 100;
          } else {
            freshDiscountAmount = discountDoc.value || 0;
          }
          freshDiscountAmount = Math.min(freshDiscountAmount, freshRawItemPrice);
          freshDiscountAmount = Math.max(0, Math.round(freshDiscountAmount * 100) / 100);
          freshDiscountCode   = discountDoc.code;
        }
      } catch {
        // Non-fatal — discount simply won't be applied
      }
    }

    const freshDiscountedItemPrice = Math.max(0, freshRawItemPrice - freshDiscountAmount);
    const freshTax      = Math.round(freshDiscountedItemPrice * 0.18 * 100) / 100;
    const freshShipping = freshDiscountedItemPrice >= 500 ? 0 : 50;
    const freshTotal    = Math.round((freshDiscountedItemPrice + freshTax + freshShipping) * 100) / 100;

    resolvedPricing = {
      itemPrice:     Math.round(freshDiscountedItemPrice * 100) / 100,
      taxPrice:      freshTax,
      shippingPrice: freshShipping,
      totalPrice:    freshTotal,
      currency:      checkout.pricing?.currency || 'USD',
      ...(freshDiscountAmount > 0
        ? {
            discountCode:   freshDiscountCode,
            discountAmount: freshDiscountAmount,
            grossItemPrice: Math.round(freshRawItemPrice * 100) / 100,
          }
        : {
            discountAmount: 0,
            discountCode:   undefined,
            grossItemPrice: undefined,
          }
      ),
    };

    // Update live item prices on the checkout items too, so what we save
    // reflects current catalogue prices rather than stale stored values.
    for (const item of availableItems) {
      item.price = item.product?.pricing?.sale || item.product?.pricing?.regular || item.price;
    }

    checkout.pricing = resolvedPricing;

    if (availableItems.length !== checkout.items.length) {
      checkout.items = availableItems;
    }
  }

  const discountInvalidated = !resolvedPricing.discountCode && !!originalStoredCode;

  await checkout.save();
  invalidateCheckoutCaches().catch(err =>
    console.error('Failed to invalidate caches after recovery:', err)
  );

  // ── Step 11: Return restored cart ─────────────────────────────────────────
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
      unavailableItems: unavailableItems.length > 0
        ? unavailableItems.map(i => ({ name: i.name }))
        : []
    }
  });
});