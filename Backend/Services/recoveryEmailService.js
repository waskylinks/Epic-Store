import Checkout from '../models/checkout-model.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { buildRecoveryEmailHtml } from './emailTemplates/recoveryEmail.js';
import { sendEmail } from '../utils/sendEmail.js';
import Discount from '../models/discount-model.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * normaliseItems
 * Filters and shapes checkout items for the email template.
 * Products that are no longer published are excluded silently.
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
 * Only called by the cron — admin sends have been removed.
 *
 * Three-step call pattern:
 *   1. initiateSend  → opens attempt slot, generates token
 *   2. mailer.send   → hands off to SMTP
 *   3a. acknowledgeSent   → mailer succeeded
 *   3b. recordSendFailure → mailer failed, slot rolled back
 *
 * After a confirmed send the Checkout abandonment fields
 * (recoveryEmailSent, recoveryEmailSentAt, recoveryEmailCount) are synced
 * so that checkout-doc-level analytics and canSendRecoveryEmail() remain
 * accurate even though the RecoveryEmail document is now the source of truth.
 *
 * @param {string|ObjectId} checkoutId
 * @param {string}          triggeredBy   'cron' (only caller now)
 * @param {Object}          [options]
 * @param {'cron'}          [options.sentBy='cron']
 */
export const sendRecoveryEmail = async (checkoutId, triggeredBy, options = {}) => {
  const sentBy = options.sentBy || 'cron';

  // ── 1. Load checkout ──────────────────────────────────────────────────────
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

  // ── 2. Find or create RecoveryEmail record ────────────────────────────────
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

  // ── 7. Confirm success on RecoveryEmail doc ───────────────────────────────
  recoveryEmail.acknowledgeSent();
  await recoveryEmail.save();

  // ── 8. Sync Checkout abandonment fields ───────────────────────────────────
  // The RecoveryEmail document is the source of truth, but the Checkout doc
  // also tracks recoveryEmailSent/SentAt/Count for:
  //   - canSendRecoveryEmail() guard (still used by markRecoveryEmailSent)
  //   - Abandonment analytics aggregations that read the checkout doc directly
  //   - The recovery_email_idx compound index
  // Without this sync those fields stay at their initial values when cron is
  // the only sender, silently breaking both analytics and the sweep guard.
  try {
    await Checkout.findByIdAndUpdate(checkoutId, {
      $set: {
        'abandonment.recoveryEmailSent':   true,
        'abandonment.recoveryEmailSentAt': recoveryEmail.lastSentAt,
        'abandonment.pendingEmailAck':     false,
      },
      $inc: {
        'abandonment.recoveryEmailCount': 1,
      },
    });
  } catch (syncErr) {
    // Non-fatal — the RecoveryEmail doc is already confirmed. Log and continue.
    console.error(
      `[RecoveryEmailService] Checkout sync failed for ${checkoutId}:`,
      syncErr.message
    );
  }

  console.log(
    `[RecoveryEmailService] Attempt ${attemptNumber} sent` +
    ` | checkout=${checkoutId} | triggeredBy=${triggeredBy}` +
    ` | sentBy=${sentBy} | email=${checkout.email}`
  );

  // Per-send cache flush
  invalidateRecoveryCaches();

  return {
    success:         true,
    attemptNumber,
    sentAt:          recoveryEmail.lastSentAt,
    nextAvailableAt: recoveryEmail.nextAvailableAt,
    cartSnapshot:    recoveryEmail.cartSnapshot,
  };
};

// NOTE: redeemToken has been intentionally removed from this service.
// The single redemption path is checkoutController.redeemRecoveryToken
// (GET /api/v1/checkout/recover?token=) which correctly updates both the
// Checkout document and the RecoveryEmail document on link click.


/**
 * getRecoveryEmailStatus
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
 * Called by verifyPaymentController after order creation, and by
 * markStaleCheckouts for re-abandonment marking.
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
 * Powers the admin send-page left panel — read-only view, no send logic.
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
    const matching         = await RecoveryEmail.find({ outcome }, { checkout: 1 }).lean();
    const checkoutIdFilter = matching.map(r => r.checkout);
    checkoutQuery._id      = { $in: checkoutIdFilter };
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
        abandonment: {
          isAbandoned:          checkout.abandonment?.isAbandoned,
          abandonedAt:          checkout.abandonment?.abandonedAt,
          firstAbandonedAt:     checkout.abandonment?.firstAbandonedAt,
          firstAbandonedAtStep: checkout.abandonment?.firstAbandonedAtStep,
          abandonedAtStep:      checkout.abandonment?.abandonedAtStep,
          reAbandoned:          checkout.abandonment?.reAbandoned,
          failedRecoveries:     checkout.abandonment?.failedRecoveries,
        },
        currentStep: checkout.currentStep,
        priority:    calculatePriorityScore(checkout),
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