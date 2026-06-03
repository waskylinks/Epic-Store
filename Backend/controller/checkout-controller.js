import handleAsyncError from "../middleware/handleAsyncError.js";
import HandleError from "../utils/handleError.js";
import Checkout from "../models/checkout-model.js";
import Product from "../models/product-model.js";
import Discount from "../models/discount-model.js";
import { deleteCachePattern } from '../utils/redis.js';
import { verifyRecoveryToken, decodeRecoveryToken } from '../utils/recoveryToken.js';
import { enqueueAnalyticsEvent } from '../jobs/analyticsQueue.js';
import { resolveFbc } from '../Services/analytics/metaCapiService.js';

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
// ============================================

const MAX_ITEMS = 50;
const MAX_ITEM_QUANTITY = 100;
const VALID_ANALYTICS_SOURCES = ['organic', 'paid', 'referral', 'email', 'social', 'direct'];

const STEP_ORDER = [
  'shipping_info',
  'order_confirmation',
  'payment_selection',
  'payment_gateway',
  'payment_failed',
];

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

  const { items, shippingInfo, discountCode, analyticsEventId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(new HandleError("Cart is empty", 400));
  }

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
    const quantity = parseInt(item.quantity, 10);
    if (!quantity || quantity < 1) continue;
    const clampedQty = Math.min(quantity, MAX_ITEM_QUANTITY);

    const product = await Product.findById(item.product);
    if (!product || product.status !== 'published') continue;

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

  const attributionData = req.attributionData || {};
  const deviceInfo      = req.deviceInfo      || {};
  const rawSource       = attributionData.source;
  const safeSource      = VALID_ANALYTICS_SOURCES.includes(rawSource) ? rawSource : 'direct';

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

  if (analyticsEventId) {
    const resolvedFbc = resolveFbc({
      fbc:         req.body.fbc,
      fbclid:      req.body.fbclid,
      attribution: attributionData,
    });

    enqueueAnalyticsEvent('begin_checkout', {
      event_id: analyticsEventId,

      checkout: {
        _id:     checkout._id,
        items:   checkout.items,
        pricing: checkout.pricing,
      },

      user: {
        _id:             req.user._id,
        email:           req.user.email,
        firstName:       req.user.firstName,
        lastName:        req.user.lastName,
        phone:           req.user.phone || req.user.phoneNo || null,
        dateOfBirth:     req.user.dateOfBirth     || null,
        facebookId:      req.user.facebookId      || null,
        shippingAddress: req.user.shippingAddress || null,
      },

      context: {
        eventId:        analyticsEventId,
        fbp:            req.body.fbp  || null,
        fbc:            resolvedFbc,
        clientIp:       req.ip,
        userAgent:      req.headers['user-agent'] || null,
        eventSourceUrl: req.body.eventSourceUrl   || process.env.FRONTEND_URL || null,
        attribution:    attributionData,
      },
    }).catch(err =>
      console.error('[createCheckout] Failed to enqueue begin_checkout event:', err.message)
    );
  } else {
    console.warn(
      '[createCheckout] analyticsEventId missing from request body — ' +
      'begin_checkout CAPI event skipped. Browser pixel will fire without server deduplication.'
    );
  }

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

const ALLOWED_NEXT_STEPS = {
  shipping_info: [
    'shipping_info',
    'order_confirmation',
    'payment_selection',
    'payment_gateway',
    'payment_failed',
  ],
  order_confirmation: [
    'shipping_info',
    'order_confirmation',
    'payment_selection',
    'payment_gateway',
    'payment_failed',
  ],
  payment_selection: [
    'shipping_info',
    'order_confirmation',
    'payment_selection',
    'payment_gateway',
    'payment_failed',
  ],
  payment_gateway: [
    'shipping_info',
    'order_confirmation',
    'payment_selection',
    'payment_gateway',
    'payment_failed',
  ],
  payment_failed: [
    'shipping_info',
    'order_confirmation',
    'payment_selection',
    'payment_gateway',
    'payment_failed',
  ],
};

// Steps that fire server-side CAPI events in updateCheckoutStep.
// shipping_info is excluded — begin_checkout covers it.
// payment_failed is excluded — no standard GA4/Meta event for failed payments.
const CAPI_TRACKED_STEPS = new Set([
  'order_confirmation',
  'payment_selection',
  'payment_gateway',
]);

export const updateCheckoutStep = handleAsyncError(async (req, res, next) => {
  const { id }            = req.params;
  const { step, gateway } = req.body;

  const validSteps = STEP_ORDER;
  if (!validSteps.includes(step)) return next(new HandleError("Invalid checkout step", 400));

  const checkout = await Checkout.findById(id);
  if (!checkout) return next(new HandleError("Checkout not found", 404));
  if (checkout.user.toString() !== req.user._id.toString()) return next(new HandleError("Unauthorized", 403));

  const validationBasis = checkout.furthestStepReached || checkout.currentStep || 'shipping_info';
  const allowedFromCurrent = ALLOWED_NEXT_STEPS[validationBasis] || [];
  if (!allowedFromCurrent.includes(step)) {
    return next(new HandleError(
      `Cannot transition from '${validationBasis}' to '${step}'`,
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

  
  if (CAPI_TRACKED_STEPS.has(step)) {
    const analyticsEventId = req.body?.analyticsEventId || null;

    if (analyticsEventId) {
      (async () => {
        try {
          const { fireCheckoutStepEvent } = await import('../Services/analytics/analyticsOrchestrator.js');

          // Pass the populated checkout document and the authenticated user.
          // req.user is the full Mongoose document set by isAuthenticatedUser
          // middleware (loaded from DB, not a lean JWT payload), so all user
          // fields including dateOfBirth, facebookId, and shippingAddress are
          // available to sendMetaAddPaymentInfo without an extra query.
          await fireCheckoutStepEvent(step, checkout, req.user, req);
        } catch (err) {
          console.error(
            `[updateCheckoutStep] fireCheckoutStepEvent failed for step "${step}" (non-fatal):`,
            err.message
          );
        }
      })();
    } else {
      console.warn(
        `[updateCheckoutStep] analyticsEventId missing for step "${step}" — ` +
        'CAPI event skipped. Browser pixel fires without server deduplication.'
      );
    }
  }

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

  if (!checkout)                                       return next(new HandleError("Checkout not found", 404));
  if (checkout.user.toString() !== userId.toString())  return next(new HandleError("Unauthorized", 403));
  if (checkout.status === 'abandoned')                 return res.status(200).json({ success: true, message: "Checkout already abandoned" });
  if (checkout.status !== 'pending')                   return next(new HandleError(`Cannot abandon a checkout with status: ${checkout.status}`, 400));

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

  let decoded   = null;
  let isExpired = false;
  let bare      = null;

  try {
    decoded = verifyRecoveryToken(token);
    bare    = decoded;
  } catch (err) {
    if (err.code === 'EXPIRED') {
      isExpired = true;
      try {
        bare = decodeRecoveryToken(token);
      } catch {
        return next(new HandleError("Recovery link is invalid or malformed.", 400));
      }
    } else {
      return next(new HandleError(err.message || "Recovery link is invalid or malformed.", 400));
    }
  }

  if (!bare?.userId) {
    return next(new HandleError("Recovery link is invalid.", 400));
  }

  const user = await issueAuthCookie(bare.userId);

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

  checkout.recordRecoveryLinkClick();

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

  if (!checkout.analytics) checkout.analytics = {};
  checkout.analytics.source = 'email';

  if (checkout.status === 'abandoned') {
    checkout.status         = 'pending';
    checkout.lastActivityAt = new Date();
  }

  const availableItems   = checkout.items.filter(item => item.product?.status === 'published');
  const unavailableItems = checkout.items.filter(item => !item.product || item.product.status !== 'published');

  let resolvedPricing = checkout.pricing;

  const originalStoredCode = checkout.pricing?.discountCode || checkout.discount?.code || null;

  {
    const freshRawItemPrice = availableItems.reduce((sum, item) => {
      const livePrice = item.product?.pricing?.sale || item.product?.pricing?.regular || 0;
      return sum + (livePrice * item.quantity);
    }, 0);

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