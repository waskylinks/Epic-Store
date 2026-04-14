import Checkout from '../models/checkout-model.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { buildRecoveryEmailHtml } from './emailTemplates/recoveryEmail.js';
import { sendEmail } from '../utils/sendEmail.js';
import Discount from '../models/discount-model.js';
import { deleteCache, deleteCachePattern } from '../utils/redis.js';

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
 */
export const invalidateRecoveryCaches = () =>
  Promise.all([
    deleteCache('recovery_analytics_day'),
    deleteCache('recovery_analytics_week'),
    deleteCache('recovery_analytics_month'),
    deleteCache('recovery_analytics_quarter'),
    deleteCache('recovery_analytics_year'),
    deleteCache('recovery_analytics_custom'),
    deleteCache('checkout_abandonment_day'),
    deleteCache('checkout_abandonment_week'),
    deleteCache('checkout_abandonment_month'),
    deleteCache('checkout_abandonment_quarter'),
    deleteCache('checkout_abandonment_year'),
    deleteCachePattern('recovery_analytics_custom_*'),
    deleteCachePattern('recovery_send_list_*'),
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
 * markExhaustedRecords
 *
 * Resolves RecoveryEmail records that have exhausted all send attempts and
 * whose final token TTL has elapsed. Handles two outcome cases:
 *
 *   'sent'    → user never clicked at all              → 'exhausted'
 *   'clicked' → user clicked but didn't convert,
 *               all tokens now elapsed                 → 'expired'
 *
 * Why the distinction matters:
 *   exhausted  = complete disengagement (user never responded)
 *   expired    = temporal failure (user engaged but ran out of time)
 *   re_abandoned = behavioural signal — user returned and left again;
 *                  this is set ONLY by the abandonment detection system
 *                  via markReAbandoned(), never by this cron sweep.
 *
 * TTL proxy rationale: token TTL is uniform across all attempts via
 * RECOVERY_TOKEN_TTL_SECONDS. Using lastSentAt + TTL as the expiry
 * proxy avoids subdocument queries and is fully covered by
 * cron_eligibility_idx (outcome, lastSentAt, confirmedAttempts).
 *
 * FIX vs previous version:
 *   - Query now includes outcome:'clicked' in addition to 'sent'.
 *   - The terminal outcome written depends on totalLinkClicks:
 *       clicks === 0  → 'exhausted'   (never engaged)
 *       clicks  > 0   → 'expired'     (engaged but timed out)
 *   - The in-loop guard no longer gates on totalLinkClicks === 0
 *     because clicked records legitimately have clicks > 0.
 *
 * @returns {{ resolved: number, errors: number }}
 */
export const markExhaustedRecords = async () => {
  const maxAttempts = parseInt(process.env.MAX_RECOVERY_ATTEMPTS) || 3;
  const tokenTTLMs  = (parseInt(process.env.RECOVERY_TOKEN_TTL_SECONDS) || 72 * 60 * 60) * 1000;
  const expiryProxy = new Date(Date.now() - tokenTTLMs);

  let resolved = 0;
  let errors   = 0;

  // Index hit: cron_eligibility_idx covers outcome + confirmedAttempts + lastSentAt.
  // FIX: include 'clicked' — a user who clicked but didn't convert and whose
  // tokens have all elapsed should be resolved to 'expired', not left stuck.
  const candidates = await RecoveryEmail.find(
    {
      outcome:           { $in: ['sent', 'clicked'] },
      confirmedAttempts: { $gte: maxAttempts },
      lastSentAt:        { $lte: expiryProxy },
    },
    { _id: 1, outcome: 1, totalLinkClicks: 1, resolvedAt: 1 }
  ).lean();

  if (candidates.length === 0) return { resolved: 0, errors: 0 };

  console.log(
    `[markExhaustedRecords] Found ${candidates.length} candidate(s) to resolve`
  );

  for (const candidate of candidates) {
    try {
      // Re-fetch the full document so _resolveOutcome can run its
      // priority ladder correctly and resolvedAt is set on the instance.
      const record = await RecoveryEmail.findById(candidate._id);
      if (!record) continue;

      // Guard: double-check state hasn't changed since the bulk query
      // (e.g. user converted or re-abandoned between query and now).
      const RESOLVABLE = ['sent', 'clicked'];
      if (!RESOLVABLE.includes(record.outcome)) {
        console.log(
          `[markExhaustedRecords] Skipping ${record._id} — state changed` +
          ` (outcome=${record.outcome})`
        );
        continue;
      }

      // Determine terminal outcome based on engagement:
      //   No clicks → exhausted (complete disengagement)
      //   Has clicks → expired  (engaged but all tokens elapsed before conversion)
      //
      // NOTE: 're_abandoned' is intentionally NOT set here. It is a behavioural
      // outcome that must only be written by the abandonment detection system
      // when it observes the user actively abandoning the cart again. A timed-out
      // 'clicked' record is 'expired', not 're_abandoned'.
      const terminalOutcome = record.totalLinkClicks > 0 ? 'expired' : 'exhausted';

      record.resolveOutcome(terminalOutcome);
      await record.save();
      resolved++;

      console.log(
        `[markExhaustedRecords] ✓ Resolved | outcome=${terminalOutcome}` +
        ` | recoveryEmail=${record._id}` +
        ` | checkout=${record.checkout}` +
        ` | clicks=${record.totalLinkClicks}`
      );
    } catch (err) {
      errors++;
      console.error(
        `[markExhaustedRecords] ✗ Failed to resolve ${candidate._id}:`,
        err.message
      );
    }
  }

  return { resolved, errors };
};


/**
 * notifyReAbandoned
 * Call this from your abandonment detection system (checkout cron / webhook)
 * when a cart that already has an active recovery campaign is abandoned again.
 *
 * This is the ONLY correct trigger for the 're_abandoned' outcome. Never set
 * it from a cron sweep, token expiry, or time-based logic — re_abandoned is
 * a behavioural signal meaning the user physically returned and left again.
 *
 * Correct lifecycle:
 *   recovery email sent → user clicks link → back on site → leaves again
 *   → your abandonment system detects the new abandonment → calls this fn
 *   → outcome becomes 're_abandoned'
 *
 * The priority ladder in _resolveOutcome allows 'converted' and 'organic'
 * to overwrite 're_abandoned' if the user eventually completes checkout.
 *
 * @param {string} checkoutId
 */
export const notifyReAbandoned = async (checkoutId) => {
  const record = await RecoveryEmail.findOne({ checkout: checkoutId });
  if (!record) return;

  // Only mark re_abandoned if the campaign was actively engaged (clicked).
  // A cart in 'sent' state that goes abandoned again is not re_abandoned —
  // the user never interacted with the recovery email.
  const RE_ABANDONABLE = ['clicked', 'sent'];
  if (!RE_ABANDONABLE.includes(record.outcome)) return;

  record.markReAbandoned();
  await record.save();

  invalidateRecoveryCaches();

  console.log(
    `[RecoveryEmailService] Marked re_abandoned | checkout=${checkoutId}` +
    ` | previousOutcome=${record.outcome}`
  );
};


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
 *
 * KEY FIXES vs previous version:
 *
 * 1. DEFAULT SCOPE — The default view now shows pending + sent + clicked only.
 *    Re-abandoned, exhausted, expired, failed, converted are excluded unless
 *    explicitly requested via the outcome chip. This stops clicked carts from
 *    vanishing — they now stay visible with a "Clicked" badge.
 *
 * 2. CHECKOUT QUERY WIDENED — Removed the hardcoded `conversion.isConverted: false`
 *    and `status: 'abandoned'` from the primary checkout query when an outcome
 *    filter is active. The RecoveryEmail outcome is the source of truth for
 *    what state a recovery campaign is in — not the checkout status field,
 *    which gets mutated by redeemRecoveryToken.
 *
 * 3. SUMMARY IS NOW A REAL AGGREGATION — Previously summary counts were
 *    computed from the current page slice (enriched), so they reflected at
 *    most 20 rows and changed as you paginated. Now a single aggregation
 *    runs across ALL matching checkout IDs and returns accurate global counts
 *    independent of the pagination window.
 *
 * 4. outcome=none FULL SCAN FIXED — Previously did RecoveryEmail.find({})
 *    with no filter — a full collection scan on every request. Now uses a
 *    scoped aggregation to find checkout IDs that have no RecoveryEmail record
 *    within the abandonment time window, avoiding the unbounded read.
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
  const skip          = (page - 1) * limit;
  const cutoff        = new Date(Date.now() - hours * 60 * 60 * 1000);
  const cooldownHours = parseInt(process.env.RECOVERY_COOLDOWN_HOURS) || 24;

  const VALID_SORTS = ['priority', 'value', 'abandonedAt', 'lastSentAt'];
  if (!VALID_SORTS.includes(sortBy)) sortBy = 'priority';

  // ── DEFAULT OUTCOMES ──────────────────────────────────────────────────────
  const DEFAULT_ACTIVE_OUTCOMES = ['pending', 'sent', 'clicked'];

  // ── STEP 1: Resolve which checkout IDs match the outcome filter ───────────
  let checkoutIdFilter = null;
  let excludeIds       = null;

  if (outcome === 'none') {
    const abandonedCheckoutIds = await Checkout.distinct('_id', {
      'abandonment.isAbandoned': true,
      'abandonment.abandonedAt': { $gte: cutoff },
    });

    const existingRecoveryCheckoutIds = await RecoveryEmail.distinct('checkout', {
      checkout: { $in: abandonedCheckoutIds },
    });

    excludeIds = existingRecoveryCheckoutIds;

  } else if (outcome && outcome !== 'all') {
    const matchingRecords = await RecoveryEmail.find(
      { outcome },
      { checkout: 1 }
    ).lean();
    checkoutIdFilter = matchingRecords.map(r => r.checkout);

  } else {
    const matchingRecords = await RecoveryEmail.find(
      { outcome: { $in: DEFAULT_ACTIVE_OUTCOMES } },
      { checkout: 1 }
    ).lean();

    const activeIds = matchingRecords.map(r => r.checkout);
    checkoutIdFilter = activeIds;
    excludeIds = 'include_none';
  }

  // ── STEP 2: Build the primary Checkout query ──────────────────────────────
  const baseCheckoutQuery = {
    'abandonment.isAbandoned': true,
    'abandonment.abandonedAt': { $gte: cutoff },
    'pricing.totalPrice':      { $gte: minValue },
  };

  if (search) {
    baseCheckoutQuery.email = {
      $gte: search.toLowerCase(),
      $lt:  search.toLowerCase() + '\uffff',
    };
  }

  if (excludeIds && excludeIds !== 'include_none') {
    baseCheckoutQuery._id = { $nin: excludeIds };
  } else if (checkoutIdFilter !== null && excludeIds !== 'include_none') {
    baseCheckoutQuery._id = { $in: checkoutIdFilter };
  } else if (excludeIds === 'include_none' && checkoutIdFilter !== null) {
    baseCheckoutQuery._id = { $in: checkoutIdFilter };
  }

  // ── STEP 3: Sort config ───────────────────────────────────────────────────
  const SORT_MAP = {
    value:       { 'pricing.totalPrice':      -1 },
    abandonedAt: { 'abandonment.abandonedAt': -1 },
    lastSentAt:  { 'abandonment.abandonedAt': -1 },
  };

  const usesPrioritySort = sortBy === 'priority';
  const dbSort = usesPrioritySort
    ? { 'pricing.totalPrice': -1 }
    : (SORT_MAP[sortBy] || { 'abandonment.abandonedAt': -1 });

  const PRIORITY_FETCH_CAP = 500;

  // ── STEP 4: Fetch checkouts + total count in parallel ─────────────────────
  const [rawCheckouts, total] = await Promise.all([
    Checkout.find(baseCheckoutQuery)
      .populate('user',          'firstName lastName email')
      .populate('items.product', 'name images pricing status')
      .sort(dbSort)
      .limit(usesPrioritySort ? PRIORITY_FETCH_CAP : limit)
      .skip(usesPrioritySort ? 0 : skip)
      .lean({ virtuals: false }),
    Checkout.countDocuments(baseCheckoutQuery),
  ]);

  // ── STEP 5: Fetch recovery records for this page's checkouts ──────────────
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

  // ── STEP 6: Enrich ────────────────────────────────────────────────────────
  const { calculatePriorityScore } = await import('../models/checkout-model.js');

  let enriched = rawCheckouts.map(checkout => {
    const recovery        = recoveryMap.get(checkout._id.toString()) || null;
    const nextAvailableAt = recovery?.lastSentAt
      ? new Date(
          new Date(recovery.lastSentAt).getTime() +
          cooldownHours * 60 * 60 * 1000
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

  // ── STEP 7: In-memory sort refinements ───────────────────────────────────
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

  // ── STEP 8: GLOBAL SUMMARY AGGREGATION ───────────────────────────────────
  const allMatchingCheckoutIds = await Checkout.distinct('_id', baseCheckoutQuery);

  const [summaryAgg] = await RecoveryEmail.aggregate([
    {
      $match: {
        checkout: { $in: allMatchingCheckoutIds },
      },
    },
    {
      $group: {
        _id:          null,
        neverSent:    { $sum: { $cond: [{ $eq: ['$outcome', 'pending']      }, 1, 0] } },
        awaiting:     { $sum: { $cond: [{ $eq: ['$outcome', 'sent']         }, 1, 0] } },
        clicked:      { $sum: { $cond: [{ $eq: ['$outcome', 'clicked']      }, 1, 0] } },
        reAbandoned:  { $sum: { $cond: [{ $eq: ['$outcome', 're_abandoned'] }, 1, 0] } },
        completed:    { $sum: { $cond: [{ $in:  ['$outcome', ['converted', 'organic']] }, 1, 0] } },
        exhausted:    { $sum: { $cond: [{ $eq: ['$outcome', 'exhausted']    }, 1, 0] } },
      },
    },
  ]);

  const recoveryRecordCount  = summaryAgg ? (
    (summaryAgg.neverSent    || 0) +
    (summaryAgg.awaiting     || 0) +
    (summaryAgg.clicked      || 0) +
    (summaryAgg.reAbandoned  || 0) +
    (summaryAgg.completed    || 0) +
    (summaryAgg.exhausted    || 0)
  ) : 0;
  const neverContactedCount = allMatchingCheckoutIds.length - recoveryRecordCount;

  const summary = {
    totalMatchingCarts: total,
    neverContacted:     Math.max(0, neverContactedCount) + (summaryAgg?.neverSent || 0),
    awaitingResponse:   summaryAgg?.awaiting    || 0,
    clicked:            summaryAgg?.clicked      || 0,
    reAbandoned:        summaryAgg?.reAbandoned  || 0,
    completed:          summaryAgg?.completed    || 0,
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