import Checkout from '../models/checkout-model.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { buildRecoveryEmailHtml } from './emailTemplates/recoveryEmail.js';
import { sendEmail } from '../utils/sendEmail.js';
import { verifyRecoveryToken, decodeRecoveryToken } from '../utils/recoveryToken.js';
import Discount from '../models/discount-model.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * normaliseItems
 * Filters and shapes checkout items for the email template.
 * Products that are no longer published are excluded silently —
 * we never show unavailable items in a recovery email.
 *
 * Accepts items that are either:
 *   a) Populated Mongoose subdocs (product is a full document object)
 *   b) Plain objects from cartSnapshot (product is an ObjectId)
 *
 * @param   {Array} items  checkout.items with product populated
 * @returns {Array} normalisedItems ready for buildRecoveryEmailHtml
 */
const normaliseItems = (items = []) =>
  items
    .filter(item => {
      if (item.product && typeof item.product === 'object' && item.product.status) {
        return item.product.status === 'published';
      }
      return true;
    })
    .map(item => ({
      name:     item.name     || item.product?.name     || 'Product',
      price:    item.price    || item.product?.pricing?.sale || item.product?.pricing?.regular || 0,
      quantity: item.quantity || 1,
      image:    item.image    || item.product?.images?.[0]?.url || null,
    }));

/**
 * invalidateRecoveryCaches
 * Bulk cache flush after any state-changing operation.
 * Exported so the cron can call it once after its loop rather than
 * relying solely on the per-send flush inside sendRecoveryEmail().
 */
export const invalidateRecoveryCaches = () =>
  Promise.all([
    deleteCachePattern('recovery_analytics_*'),
    deleteCachePattern('recovery_send_list_*'),
    deleteCachePattern('checkout_abandonment_*'),
    deleteCachePattern('abandoned_list:*'),
    deleteCachePattern('admin_stats*'),
  ]).catch(err =>
    console.error('[RecoveryEmailService] Cache flush failed:', err.message)
  );

/**
 * buildRecoveryUrl
 * Constructs the full recovery link that goes into the email.
 *
 * @param {string} token  Signed JWT from RecoveryEmail.initiateSend()
 * @returns {string}
 */
const buildRecoveryUrl = (token) => {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${base}/checkout/recover?token=${encodeURIComponent(token)}`;
};

// ============================================
// CORE SERVICE METHODS
// ============================================

/**
 * sendRecoveryEmail
 * Master orchestrator for a single recovery email send.
 *
 * Three-step call pattern:
 *   1. initiateSend  → opens attempt slot, generates token
 *   2. mailer.send   → hands off to SMTP
 *   3a. acknowledgeSent   → mailer succeeded
 *   3b. recordSendFailure → mailer failed, slot rolled back
 *
 * @param {string|ObjectId} checkoutId    The checkout to send for
 * @param {string}          triggeredBy   userId for admin sends, 'cron' for automated sends
 * @param {Object}          [options]
 * @param {'admin'|'cron'}  [options.sentBy='admin']  Attribution label stored on the attempt
 *
 * @returns {{
 *   success:         boolean,
 *   attemptNumber:   number,
 *   sentAt:          Date,
 *   nextAvailableAt: Date|null,
 *   cartSnapshot:    Object
 * }}
 */
export const sendRecoveryEmail = async (checkoutId, triggeredBy, options = {}) => {
  const sentBy = options.sentBy || 'admin';

  // ── 1. Load checkout with populated user and items ────────────────────────
  const checkout = await Checkout.findById(checkoutId)
    .populate('user',          'firstName lastName email')
    .populate('items.product', 'name images pricing status');

  if (!checkout) {
    throw new Error('Checkout not found');
  }

  if (!checkout.abandonment?.isAbandoned || checkout.status !== 'abandoned') {
    throw new Error('Checkout is not in an abandoned state');
  }

  if (!checkout.user || typeof checkout.user !== 'object') {
    throw new Error('User account no longer exists — cannot send recovery email');
  }

  // ── 2. Find or create the RecoveryEmail record (atomic upsert) ───────────
  const recoveryEmail = await RecoveryEmail.findOrCreateForCheckout(checkout);

  // ── 3. Gate check ─────────────────────────────────────────────────────────
  const canSendResult = recoveryEmail.canSend(checkout);
  if (!canSendResult.canSend) {
    const err = new Error(canSendResult.reason);
    err.nextAvailableAt = canSendResult.nextAvailableAt || null;
    err.code            = 'CANNOT_SEND';
    throw err;
  }

  // ── 4. Open attempt slot + generate token ─────────────────────────────────
  const token = recoveryEmail.initiateSend(checkout, sentBy);
  await recoveryEmail.save();

  // ── 5. Build email payload ────────────────────────────────────────────────
  const isFirstSend   = recoveryEmail.confirmedAttempts === 0;
  const itemsForEmail = isFirstSend
    ? normaliseItems(checkout.items)
    : normaliseItems(recoveryEmail.cartSnapshot?.items || checkout.items);

  if (itemsForEmail.length === 0) {
    recoveryEmail.recordSendFailure('All cart items are unavailable');
    await recoveryEmail.save();
    throw new Error('Cannot send recovery email: all cart items are currently unavailable');
  }

  const recoveryUrl   = buildRecoveryUrl(token);
  const attemptNumber = recoveryEmail.lastAttempt?.attemptNumber || 1;

  const { subject, html, text } = buildRecoveryEmailHtml(
    checkout,
    recoveryUrl,
    { normalisedItems: itemsForEmail, attemptNumber }
  );

  // ── 6. Send via mailer ────────────────────────────────────────────────────
  try {
    await sendEmail({
      email:   checkout.email,
      subject,
      html,
      text,
      replyTo: process.env.SUPPORT_EMAIL || process.env.SMTP_MAIL,
    });
  } catch (mailerErr) {
    recoveryEmail.recordSendFailure(mailerErr.message);
    await recoveryEmail.save();

    console.error(
      `[RecoveryEmailService] Mailer failed for checkout ${checkoutId}:`,
      mailerErr.message
    );

    throw new Error(`Email delivery failed: ${mailerErr.message}`);
  }

  // ── 7. Confirm success ────────────────────────────────────────────────────
  recoveryEmail.acknowledgeSent();
  await recoveryEmail.save();

  console.log(
    `[RecoveryEmailService] Attempt ${attemptNumber} sent` +
    ` | checkout=${checkoutId} | triggeredBy=${triggeredBy}` +
    ` | sentBy=${sentBy} | email=${checkout.email}`
  );

  // Per-send cache flush (correct for manual/admin sends).
  // The cron calls invalidateRecoveryCaches() once after its full loop
  // in addition to these per-send flushes — that's intentional and cheap.
  invalidateRecoveryCaches();

  return {
    success:         true,
    attemptNumber,
    sentAt:          recoveryEmail.lastSentAt,
    nextAvailableAt: recoveryEmail.nextAvailableAt,
    cartSnapshot:    recoveryEmail.cartSnapshot,
  };
};


/**
 * redeemToken
 * Handles the full recovery link redemption flow.
 *
 * @param {string} token  Raw JWT from ?token= query param
 */
export const redeemToken = async (token) => {
  if (!token) throw Object.assign(new Error('Recovery token is required'), { status: 400 });

  // ── 1. Verify JWT ─────────────────────────────────────────────────────────
  let decoded;
  try {
    decoded = verifyRecoveryToken(token);
  } catch (err) {
    if (err.code === 'EXPIRED') {
      try {
        const bare = decodeRecoveryToken(token);
        if (bare?.checkoutId && bare?.jti) {
          const re = await RecoveryEmail.findOne({ checkout: bare.checkoutId });
          if (re) {
            re.markTokenExpired(bare.jti);
            await re.save();
          }
        }
      } catch {
        // Non-fatal — audit write failed
      }
      throw Object.assign(new Error(err.message), { status: 410 });
    }
    throw Object.assign(new Error(err.message), { status: 400 });
  }

  // ── 2. Load checkout ──────────────────────────────────────────────────────
  const checkout = await Checkout.findById(decoded.checkoutId)
    .populate('user',          'firstName lastName email')
    .populate('items.product', 'name images pricing inventory status');

  if (!checkout) {
    throw Object.assign(
      new Error('Cart not found — it may have expired.'),
      { status: 404 }
    );
  }

  // ── 3. User still exists? ─────────────────────────────────────────────────
  if (!checkout.user || typeof checkout.user !== 'object') {
    throw Object.assign(
      new Error('The account associated with this cart no longer exists.'),
      { status: 410 }
    );
  }

  // ── 4. Ownership check ────────────────────────────────────────────────────
  if (checkout.user._id.toString() !== decoded.userId) {
    throw Object.assign(new Error('Invalid recovery link.'), { status: 403 });
  }

  // ── 5. Already converted? ─────────────────────────────────────────────────
  if (checkout.conversion?.isConverted) {
    return {
      alreadyConverted: true,
      orderId:          checkout.conversion.orderId,
      message:          'This order has already been completed. Thank you!',
    };
  }

  // ── 6. Load RecoveryEmail and record the click ────────────────────────────
  const recoveryEmail = await RecoveryEmail.findOne({ checkout: checkout._id });

  if (recoveryEmail) {
    const clickedAttempt = recoveryEmail.recordLinkClick(
      decoded.jti,
      checkout.currentStep
    );

    if (!clickedAttempt) {
      console.warn(
        `[RecoveryEmailService] tokenId ${decoded.jti} not found in RecoveryEmail ` +
        `attempts for checkout ${checkout._id}. Proceeding with redemption.`
      );
    }

    await recoveryEmail.save();
  }

  // ── 7. Restore checkout cart state ────────────────────────────────────────
  checkout.restoreFromRecovery();

  // ── 8. Filter unavailable items ───────────────────────────────────────────
  const availableItems   = checkout.items.filter(
    item => item.product?.status === 'published'
  );
  const unavailableItems = checkout.items.filter(
    item => !item.product || item.product.status !== 'published'
  );

  // ── 9. Recompute pricing if items were removed ────────────────────────────
  let resolvedPricing = checkout.pricing;

  if (unavailableItems.length > 0 && availableItems.length > 0) {
    const freshItemPrice = availableItems.reduce(
      (sum, item) => sum + item.price * item.quantity, 0
    );

    const originalGross    = checkout.pricing?.grossItemPrice || checkout.pricing?.itemPrice || 0;
    const originalDiscount = checkout.pricing?.discountAmount || 0;

    let freshDiscount = 0;
    if (originalDiscount > 0 && originalGross > 0) {
      const rate    = originalDiscount / originalGross;
      freshDiscount = Math.min(
        Math.round(freshItemPrice * rate * 100) / 100,
        freshItemPrice
      );
    }

    const freshDiscounted = Math.max(0, freshItemPrice - freshDiscount);
    const freshTax        = Math.round(freshDiscounted * 0.18 * 100) / 100;
    const freshShipping   = freshDiscounted >= 500 ? 0 : 50;
    const freshTotal      = Math.round((freshDiscounted + freshTax + freshShipping) * 100) / 100;

    resolvedPricing = {
      ...(checkout.pricing?.toObject ? checkout.pricing.toObject() : checkout.pricing),
      itemPrice:     Math.round(freshDiscounted * 100) / 100,
      taxPrice:      freshTax,
      shippingPrice: freshShipping,
      totalPrice:    freshTotal,
      ...(freshDiscount > 0
        ? { discountAmount: freshDiscount, grossItemPrice: Math.round(freshItemPrice * 100) / 100 }
        : { discountAmount: 0, discountCode: undefined, grossItemPrice: undefined }
      ),
    };

    checkout.pricing = resolvedPricing;
  }

  // ── 10. Re-validate discount code ─────────────────────────────────────────
  let discountWarning = null;

  const activeDiscountCode =
    checkout.pricing?.discountCode || checkout.discount?.code;

  if (activeDiscountCode) {
    try {
      const discountDoc = await Discount.findOne({
        code:     activeDiscountCode.toUpperCase(),
        isActive: true,
      });

      const isExpired   = discountDoc?.expiresAt && new Date(discountDoc.expiresAt) < new Date();
      const isInactive  = !discountDoc || !discountDoc.isActive;
      const isExhausted = discountDoc?.maxUses > 0 &&
        (discountDoc?.usedCount || 0) >= discountDoc.maxUses;

      if (isExpired || isInactive || isExhausted) {
        discountWarning = 'Your discount code is no longer valid and has been removed from your cart.';

        const gross         = resolvedPricing.grossItemPrice || resolvedPricing.itemPrice || 0;
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
      // Non-fatal — leave pricing as-is if discount lookup fails.
    }
  }

  // ── 11. Save and return ───────────────────────────────────────────────────
  await checkout.save();

  invalidateRecoveryCaches();

  return {
    alreadyConverted: false,
    message:          'Cart restored successfully. Complete your purchase!',
    discountWarning,
    checkout: {
      id:               checkout._id,
      items:            availableItems,
      pricing:          resolvedPricing,
      shippingInfo:     checkout.shippingInfo,
      currentStep:      checkout.currentStep,
      stepsCompleted:   checkout.stepsCompleted,
      unavailableItems: unavailableItems.map(i => ({ name: i.name })),
    },
  };
};


/**
 * getRecoveryEmailStatus
 * Returns the RecoveryEmail doc for a checkout, shaped for the frontend.
 *
 * @param   {string|ObjectId} checkoutId
 * @returns {Object|null}
 */
export const getRecoveryEmailStatus = async (checkoutId) => {
  const record = await RecoveryEmail.findOne({ checkout: checkoutId })
    .select('-attempts.token')
    .lean({ virtuals: true });

  if (!record) return null;

  return {
    outcome:                  record.outcome,
    confirmedAttempts:        record.confirmedAttempts,
    lastSentAt:               record.lastSentAt,
    nextAvailableAt:          record.nextAvailableAt,
    everClicked:              record.everClicked,
    totalLinkClicks:          record.totalLinkClicks,
    lastClickedAttemptNumber: record.lastClickedAttemptNumber,
    pendingAck:               record.pendingAck,
    cartSnapshot:             record.cartSnapshot,
    resolvedAt:               record.resolvedAt,
    attempts: (record.attempts || []).map(a => ({
      attemptNumber:         a.attemptNumber,
      status:                a.status,
      sentBy:                a.sentBy,
      initiatedAt:           a.initiatedAt,
      sentAt:                a.sentAt,
      failReason:            a.failReason,
      tokenId:               a.tokenId,
      tokenIssuedAt:         a.tokenIssuedAt,
      tokenExpiresAt:        a.tokenExpiresAt,
      tokenExpiredUnclicked: a.tokenExpiredUnclicked,
      linkClickedAt:         a.linkClickedAt,
      linkClickCount:        a.linkClickCount,
      checkoutStepAtClick:   a.checkoutStepAtClick,
    })),
  };
};


/**
 * resolveRecoveryOutcome
 * Called by verifyPaymentController and markStaleCheckouts.
 *
 * @param {string|ObjectId} checkoutId
 * @param {'converted'|'organic'|'re_abandoned'|'exhausted'|'expired'} outcome
 */
export const resolveRecoveryOutcome = async (checkoutId, outcome) => {
  const recoveryEmail = await RecoveryEmail.findOne({ checkout: checkoutId });
  if (!recoveryEmail) return;

  recoveryEmail.resolveOutcome(outcome);
  await recoveryEmail.save();

  invalidateRecoveryCaches();
};


/**
 * handleStaleAcks
 * Called by the abandonment sweep as a fourth pass.
 * Clears pendingAck records where the mailer crashed mid-send.
 *
 * @returns {{ cleared: number, errors: number }}
 */
export const handleStaleAcks = async () => {
  const stale   = await RecoveryEmail.getPendingStaleAcks();
  let cleared   = 0;
  let errors    = 0;

  for (const record of stale) {
    try {
      await RecoveryEmail.findByIdAndUpdate(record._id, {
        $set: { pendingAck: false },
      });

      console.warn(
        `[RecoveryEmailService] Cleared stale pendingAck` +
        ` | recoveryEmail=${record._id} | checkout=${record.checkout}` +
        ` | stale since=${record.updatedAt?.toISOString()}`
      );

      cleared++;
    } catch (err) {
      errors++;
      console.error(
        `[RecoveryEmailService] Failed to clear stale ack ${record._id}:`,
        err.message
      );
    }
  }

  return { cleared, errors };
};


/**
 * getAbandonedCartsForSending
 * Powers the send-page left panel — UI-facing query with full enrichment.
 * Not used by the cron (which uses its own lean query in recoveryEmailCron.js).
 *
 * @param {Object} opts
 */
export const getAbandonedCartsForSending = async ({
  page     = 1,
  limit    = 20,
  outcome,
  sortBy   = 'priority',
  minValue = 0,
  search,
  hours    = 720,
} = {}) => {
  const skip = (page - 1) * limit;

  const checkoutQuery = {
    'abandonment.isAbandoned': true,
    'conversion.isConverted':  false,
    status:                    'abandoned',
    'pricing.totalPrice':      { $gte: minValue },
    'abandonment.abandonedAt': {
      $gte: new Date(Date.now() - hours * 60 * 60 * 1000),
    },
  };

  if (search) {
    checkoutQuery.email = {
      $gte: search.toLowerCase(),
      $lt:  search.toLowerCase() + '\uffff',
    };
  }

  const SORT_MAP = {
    value:       { 'pricing.totalPrice':      -1 },
    abandonedAt: { 'abandonment.abandonedAt': -1 },
    lastSentAt:  { 'abandonment.abandonedAt': -1 },
  };

  const usesPrioritySort = sortBy === 'priority';
  const dbSort = usesPrioritySort
    ? { 'pricing.totalPrice': -1 }
    : (SORT_MAP[sortBy] || { 'abandonment.abandonedAt': -1 });

  if (outcome === 'none') {
    const existing    = await RecoveryEmail.find({}, { checkout: 1 }).lean();
    const existingIds = existing.map(r => r.checkout.toString());
    checkoutQuery._id = { $nin: existingIds };
  } else if (outcome && outcome !== 'all') {
    const matching       = await RecoveryEmail.find({ outcome }, { checkout: 1 }).lean();
    const checkoutIdFilter = matching.map(r => r.checkout);
    checkoutQuery._id    = { $in: checkoutIdFilter };
  }

  const PRIORITY_FETCH_CAP = 500;

  const [rawCheckouts, total] = await Promise.all([
    Checkout.find(checkoutQuery)
      .populate('user',          'firstName lastName email')
      .populate('items.product', 'name images pricing status')
      .sort(dbSort)
      .limit(usesPrioritySort ? PRIORITY_FETCH_CAP : limit)
      .skip(usesPrioritySort ? 0 : skip)
      .lean({ virtuals: false }),
    Checkout.countDocuments(checkoutQuery),
  ]);

  const checkoutIds     = rawCheckouts.map(c => c._id);
  const recoveryRecords = await RecoveryEmail.find(
    { checkout: { $in: checkoutIds } },
    {
      checkout:                 1,
      outcome:                  1,
      confirmedAttempts:        1,
      lastSentAt:               1,
      pendingAck:               1,
      totalLinkClicks:          1,
      lastClickedAttemptNumber: 1,
      resolvedAt:               1,
    }
  ).lean();

  const recoveryMap = new Map(
    recoveryRecords.map(r => [r.checkout.toString(), r])
  );

  const { calculatePriorityScore } = await import('../models/checkout-model.js');

  let enriched = rawCheckouts.map(checkout => {
    const recovery = recoveryMap.get(checkout._id.toString()) || null;

    const nextAvailableAt = recovery?.lastSentAt
      ? new Date(
          new Date(recovery.lastSentAt).getTime() +
          (parseInt(process.env.RECOVERY_COOLDOWN_HOURS) || 24) * 60 * 60 * 1000
        )
      : null;

    return {
      checkout: {
        _id:          checkout._id,
        email:        checkout.email,
        user:         checkout.user,
        items:        checkout.items,
        pricing:      checkout.pricing,
        shippingInfo: checkout.shippingInfo,
        abandonment:  {
          isAbandoned:          checkout.abandonment?.isAbandoned,
          abandonedAt:          checkout.abandonment?.abandonedAt,
          firstAbandonedAt:     checkout.abandonment?.firstAbandonedAt,
          firstAbandonedAtStep: checkout.abandonment?.firstAbandonedAtStep,
          abandonedAtStep:      checkout.abandonment?.abandonedAtStep,
          reAbandoned:          checkout.abandonment?.reAbandoned,
          failedRecoveries:     checkout.abandonment?.failedRecoveries,
        },
        currentStep:  checkout.currentStep,
        priority:     calculatePriorityScore(checkout),
        hoursSinceAbandoned: checkout.abandonment?.abandonedAt
          ? Math.floor(
              (Date.now() - new Date(checkout.abandonment.abandonedAt).getTime()) /
              (1000 * 60 * 60)
            )
          : 0,
      },
      recovery: recovery
        ? {
            outcome:                  recovery.outcome,
            confirmedAttempts:        recovery.confirmedAttempts,
            lastSentAt:               recovery.lastSentAt,
            nextAvailableAt,
            totalLinkClicks:          recovery.totalLinkClicks,
            lastClickedAttemptNumber: recovery.lastClickedAttemptNumber,
            pendingAck:               recovery.pendingAck,
          }
        : null,
    };
  });

  if (usesPrioritySort) {
    enriched.sort((a, b) => b.checkout.priority - a.checkout.priority);
    enriched = enriched.slice(skip, skip + limit);
  }

  if (sortBy === 'lastSentAt') {
    enriched.sort((a, b) => {
      const aTime = a.recovery?.lastSentAt ? new Date(a.recovery.lastSentAt).getTime() : 0;
      const bTime = b.recovery?.lastSentAt ? new Date(b.recovery.lastSentAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  const summary = {
    totalMatchingCarts:  total,
    neverContacted:      enriched.filter(e => !e.recovery).length,
    awaitingResponse:    enriched.filter(e => e.recovery?.outcome === 'sent').length,
    clickedNotConverted: enriched.filter(e => e.recovery?.outcome === 'clicked').length,
    reAbandoned:         enriched.filter(e => e.recovery?.outcome === 're_abandoned').length,
  };

  return {
    items: enriched,
    pagination: {
      currentPage: page,
      totalPages:  Math.ceil(total / limit),
      total,
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1,
    },
    summary,
  };
};