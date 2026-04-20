import Checkout     from '../models/checkout-model.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { buildRecoveryEmailHtml } from './emailTemplates/recoveryEmail.js';
import { sendEmail }  from '../utils/sendEmail.js';
import Discount       from '../models/discount-model.js';
import { deleteCache, deleteCachePattern } from '../utils/redis.js';

// ============================================
// INTERNAL HELPERS
// ============================================

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
 * Only called by the cron.
 *
 * After acknowledgeSent(), the model writes 'exhausted' immediately
 * when confirmedAttempts reaches maxAttempts. This is the send-side
 * terminal — it says nothing about token expiry.
 */
export const sendRecoveryEmail = async (checkoutId, triggeredBy, options = {}) => {
  const sentBy = options.sentBy || 'cron';

  // ── 1. Load checkout ──────────────────────────────────────────────────────
  const checkout = await Checkout.findById(checkoutId)
    .populate('user',          'firstName lastName email')
    .populate('items.product', 'name images pricing status');

  if (!checkout) throw new Error('Checkout not found');

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

  // ── 7. Confirm success ────────────────────────────────────────────────────
  // acknowledgeSent() increments confirmedAttempts and writes 'exhausted'
  // if the send cap is now reached. exhausted is purely "all emails sent."
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
      $inc: { 'abandonment.recoveryEmailCount': 1 },
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
    ` | sentBy=${sentBy} | email=${checkout.email}` +
    ` | outcome=${recoveryEmail.outcome}`
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
 * markExpiredRecords
 *
 * Writes 'expired' outcome for records where ALL of the following are true:
 *   1. outcome is 'exhausted' (all emails sent)
 *   2. The final token TTL has elapsed (all tokens are now dead)
 *   3. The user never clicked any link (totalLinkClicks === 0)
 *
 * This is the TRUE terminal state — "we sent everything, all tokens died,
 * and the user never responded at all."
 *
 * IMPORTANT DISTINCTION from old markExhaustedRecords:
 *   - exhausted is written by acknowledgeSent() immediately when sends complete
 *   - expired is written here AFTER all tokens have elapsed AND no clicks
 *   - If user clicked (even after exhausted), outcome is 'clicked' not 'exhausted',
 *     so they won't appear in this query
 *
 * @returns {{ resolved: number, errors: number }}
 */
export const markExpiredRecords = async () => {
  const maxAttempts = parseInt(process.env.MAX_RECOVERY_ATTEMPTS) || 3;
  const tokenTTLMs  = (parseInt(process.env.RECOVERY_TOKEN_TTL_SECONDS) || 72 * 60 * 60) * 1000;
  const expiryProxy = new Date(Date.now() - tokenTTLMs);

  let resolved = 0;
  let errors   = 0;

  // Only look at 'exhausted' records where:
  //   - all emails sent (confirmedAttempts >= maxAttempts) ← already implied by exhausted
  //   - last send was more than one tokenTTL ago (all tokens dead)
  //   - user never clicked (totalLinkClicks === 0)
  //
  // If totalLinkClicks > 0 the user engaged — outcome should be 'clicked',
  // not 'exhausted', so they won't appear here anyway.
  const candidates = await RecoveryEmail.find(
    {
      outcome:           'exhausted',
      confirmedAttempts: { $gte: maxAttempts },
      lastSentAt:        { $lte: expiryProxy },
      totalLinkClicks:   0,
    },
    { _id: 1, outcome: 1, totalLinkClicks: 1 }
  ).lean();

  if (candidates.length === 0) return { resolved: 0, errors: 0 };

  console.log(
    `[markExpiredRecords] Found ${candidates.length} exhausted record(s) with all tokens dead and no clicks — marking expired`
  );

  for (const candidate of candidates) {
    try {
      const record = await RecoveryEmail.findById(candidate._id);
      if (!record) continue;

      // Double-check state hasn't changed (e.g. user converted between query and now)
      if (record.outcome !== 'exhausted' || record.totalLinkClicks > 0) {
        console.log(
          `[markExpiredRecords] Skipping ${record._id} — state changed` +
          ` (outcome=${record.outcome}, clicks=${record.totalLinkClicks})`
        );
        continue;
      }

      record.resolveOutcome('expired');
      await record.save();
      resolved++;

      console.log(
        `[markExpiredRecords] ✓ exhausted → expired` +
        ` | recoveryEmail=${record._id} | checkout=${record.checkout}`
      );
    } catch (err) {
      errors++;
      console.error(
        `[markExpiredRecords] ✗ Failed to resolve ${candidate._id}:`,
        err.message
      );
    }
  }

  return { resolved, errors };
};

/**
 * notifyReAbandoned
 * Called from the abandonment detection system when a cart in an active
 * recovery campaign is abandoned again. ONLY correct trigger for re_abandoned.
 */
export const notifyReAbandoned = async (checkoutId) => {
  const record = await RecoveryEmail.findOne({ checkout: checkoutId });
  if (!record) return;

  // Only mark re_abandoned if the campaign was engaged (clicked or sent).
  // A cart in 'sent' state that goes abandoned again is still re_abandoned —
  // the cron sent emails, the user may not have clicked but they did return.
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
      clickedAfterExpiry:    a.clickedAfterExpiry,
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
 * Powers the admin send-page. Read-only view.
 */
export const getAbandonedCartsForSending = async ({
  page     = 1,
  limit    = 20,
  outcome,
  sortBy   = 'priority',
  minValue = 0,
  search,
  hours    = 8760,
} = {}) => {
  const skip          = (page - 1) * limit;
  const cutoff        = new Date(Date.now() - hours * 60 * 60 * 1000);
  const cooldownHours = parseInt(process.env.RECOVERY_COOLDOWN_HOURS) || 24;

  const VALID_SORTS = ['priority', 'value', 'abandonedAt', 'lastSentAt'];
  if (!VALID_SORTS.includes(sortBy)) sortBy = 'priority';

  // Active outcomes shown under "All active" tab
  const DEFAULT_ACTIVE_OUTCOMES = ['pending', 'sent', 'clicked', 'exhausted', 're_abandoned'];

  let checkoutIdFilter = null;
  let excludeIds       = null;

  if (outcome === 'none') {
    // "Not contacted" = carts with NO recovery record at all.
    // outcome: 'pending' records are already-created records that haven't
    // been sent yet — include them too since they haven't been contacted.
    const abandonedCheckoutIds = await Checkout.distinct('_id', {
      'abandonment.isAbandoned': true,
      'abandonment.abandonedAt': { $gte: cutoff },
    });

    // Records that exist AND have been sent at least once (confirmedAttempts > 0)
    // OR have a non-pending outcome — these are "contacted"
    const contactedIds = await RecoveryEmail.distinct('checkout', {
      checkout:          { $in: abandonedCheckoutIds },
      confirmedAttempts: { $gt: 0 },
    });

    excludeIds = contactedIds;

  } else if (outcome === 'converted') {
    // Include both email-attributed and organic recoveries
    const matchingRecords = await RecoveryEmail.find(
      { outcome: { $in: ['converted', 'organic'] } },
      { checkout: 1 }
    ).lean();
    checkoutIdFilter = matchingRecords.map(r => r.checkout);

  } else if (outcome && outcome !== 'all') {
    // Direct outcome match — sent, clicked, re_abandoned, exhausted, expired
    const matchingRecords = await RecoveryEmail.find(
      { outcome },
      { checkout: 1 }
    ).lean();
    checkoutIdFilter = matchingRecords.map(r => r.checkout);

  } else {
    // 'all' — show all active outcomes including none-yet-contacted
    const matchingRecords = await RecoveryEmail.find(
      { outcome: { $in: DEFAULT_ACTIVE_OUTCOMES } },
      { checkout: 1 }
    ).lean();
    checkoutIdFilter = matchingRecords.map(r => r.checkout);
    // Don't exclude anything — include carts with no record too
    excludeIds = 'include_none';
  }

  // ── Build checkout query ──────────────────────────────────────────────────
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
    // 'none' tab — exclude contacted carts
    baseCheckoutQuery._id = { $nin: excludeIds };
  } else if (checkoutIdFilter !== null && excludeIds !== 'include_none') {
    // specific outcome tab — only matching checkout IDs
    baseCheckoutQuery._id = { $in: checkoutIdFilter };
  } else if (excludeIds === 'include_none' && checkoutIdFilter !== null) {
    // 'all' tab — recovery records that are active
    baseCheckoutQuery._id = { $in: checkoutIdFilter };
  }
  // if checkoutIdFilter is null and excludeIds is null → no _id filter (show all)

  const SORT_MAP = {
    value:       { 'pricing.totalPrice':      -1 },
    abandonedAt: { 'abandonment.abandonedAt': -1 },
    lastSentAt:  { 'abandonment.abandonedAt': -1 },
  };

  const usesPrioritySort   = sortBy === 'priority';
  const dbSort             = usesPrioritySort
    ? { 'pricing.totalPrice': -1 }
    : (SORT_MAP[sortBy] || { 'abandonment.abandonedAt': -1 });
  const PRIORITY_FETCH_CAP = 500;

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
    const recovery        = recoveryMap.get(checkout._id.toString()) || null;
    const nextAvailableAt = recovery?.lastSentAt
      ? new Date(
          new Date(recovery.lastSentAt).getTime() + cooldownHours * 60 * 60 * 1000
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

  // ── Summary aggregation — always global, not page-scoped ─────────────────
  const allMatchingCheckoutIds = await Checkout.distinct('_id', {
    'abandonment.isAbandoned': true,
    'abandonment.abandonedAt': { $gte: cutoff },
    'pricing.totalPrice':      { $gte: minValue },
    ...(search && {
      email: { $gte: search.toLowerCase(), $lt: search.toLowerCase() + '\uffff' },
    }),
  });

  const [summaryAgg] = await RecoveryEmail.aggregate([
    { $match: { checkout: { $in: allMatchingCheckoutIds } } },
    {
      $group: {
        _id:         null,
        neverSent:   { $sum: { $cond: [{ $eq: ['$outcome', 'pending']      }, 1, 0] } },
        awaiting:    { $sum: { $cond: [{ $eq: ['$outcome', 'sent']         }, 1, 0] } },
        clicked:     { $sum: { $cond: [{ $eq: ['$outcome', 'clicked']      }, 1, 0] } },
        reAbandoned: { $sum: { $cond: [{ $eq: ['$outcome', 're_abandoned'] }, 1, 0] } },
        completed:   { $sum: { $cond: [{ $in:  ['$outcome', ['converted', 'organic']] }, 1, 0] } },
        exhausted:   { $sum: { $cond: [{ $eq: ['$outcome', 'exhausted']   }, 1, 0] } },
        expired:     { $sum: { $cond: [{ $eq: ['$outcome', 'expired']     }, 1, 0] } },
        contacted:   { $sum: { $cond: [{ $gt:  ['$confirmedAttempts', 0]  }, 1, 0] } },
      },
    },
  ]);

  const totalWithRecords    = summaryAgg?.contacted || 0;
  const neverContactedCount = Math.max(0, allMatchingCheckoutIds.length - totalWithRecords);

  const summary = {
    totalMatchingCarts: total,
    neverContacted:     neverContactedCount + (summaryAgg?.neverSent || 0),
    awaitingResponse:   summaryAgg?.awaiting     || 0,
    clicked:            summaryAgg?.clicked      || 0,
    reAbandoned:        summaryAgg?.reAbandoned  || 0,
    completed:          summaryAgg?.completed    || 0,
    exhausted:          summaryAgg?.exhausted    || 0,
    expired:            summaryAgg?.expired      || 0,
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