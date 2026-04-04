import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import {
  sendRecoveryEmail,
  redeemToken,
  getRecoveryEmailStatus,
  resolveRecoveryOutcome,
  getAbandonedCartsForSending,
} from '../Services/recoveryEmailService.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { getCache, setCache, deleteCachePattern } from '../utils/redis.js';
import { getDateRanges } from '../utils/dateRanges.js';
import { validateTimeframe } from '../utils/validateTimeframe.js';

// ============================================
// SEND RECOVERY EMAIL
// @route  POST /api/v1/recovery/send
// @access Private — admin only
// ============================================

export const sendRecoveryEmailHandler = handleAsyncError(async (req, res, next) => {
  const { checkoutId } = req.body;

  if (!checkoutId) {
    return next(new HandleError('checkoutId is required', 400));
  }

  let result;
  try {
    result = await sendRecoveryEmail(checkoutId, req.user._id);
  } catch (err) {
    // CANNOT_SEND = business rule block (cooldown, max attempts, etc.)
    // Surface as 422 so the frontend can distinguish from a 500.
    if (err.code === 'CANNOT_SEND') {
      return res.status(422).json({
        success:         false,
        message:         err.message,
        nextAvailableAt: err.nextAvailableAt || null,
      });
    }
    return next(new HandleError(err.message, 500));
  }

  res.status(200).json({
    success:         true,
    message:         `Recovery email sent (attempt ${result.attemptNumber})`,
    attemptNumber:   result.attemptNumber,
    sentAt:          result.sentAt,
    nextAvailableAt: result.nextAvailableAt,
    cartSnapshot:    result.cartSnapshot,
  });
});

// ============================================
// REDEEM RECOVERY TOKEN
// @route  GET /api/v1/checkout/recover?token=
// @access Public — token is the credential
//
// NOTE: This handler is intentionally registered on the checkout router
// (/api/v1/checkout/recover) to preserve existing frontend links.
// The service does all the heavy lifting.
// ============================================

export const redeemRecoveryTokenHandler = handleAsyncError(async (req, res, next) => {
  const { token } = req.query;

  let result;
  try {
    result = await redeemToken(token);
  } catch (err) {
    return next(new HandleError(err.message, err.status || 400));
  }

  // Already converted — return 200 with a flag so the frontend
  // can redirect to the order confirmation page.
  if (result.alreadyConverted) {
    return res.status(200).json({
      success:          true,
      alreadyConverted: true,
      message:          result.message,
      orderId:          result.orderId,
    });
  }

  res.status(200).json({
    success:          true,
    alreadyConverted: false,
    message:          result.message,
    ...(result.discountWarning && { discountWarning: result.discountWarning }),
    checkout:         result.checkout,
  });
});

// ============================================
// GET RECOVERY EMAIL STATUS
// @route  GET /api/v1/recovery/status/:checkoutId
// @access Private — admin only
// ============================================

export const getRecoveryStatusHandler = handleAsyncError(async (req, res, next) => {
  const { checkoutId } = req.params;

  if (!checkoutId) {
    return next(new HandleError('checkoutId param is required', 400));
  }

  const status = await getRecoveryEmailStatus(checkoutId);

  // Return an empty scaffold when no email has been sent yet —
  // the frontend uses this to render the "Not contacted" state.
  res.status(200).json({
    success: true,
    status:  status || {
      outcome:           'none',
      confirmedAttempts: 0,
      lastSentAt:        null,
      nextAvailableAt:   null,
      everClicked:       false,
      totalLinkClicks:   0,
      attempts:          [],
    },
  });
});

// ============================================
// GET ABANDONED CARTS FOR SEND PAGE
// @route  GET /api/v1/recovery/send-list
// @access Private — admin only
// ============================================

export const getSendListHandler = handleAsyncError(async (req, res, next) => {
  const {
    page     = 1,
    limit    = 20,
    outcome,
    sortBy   = 'priority',
    minValue = 0,
    search,
    hours    = 720,
  } = req.query;

  // Validate sortBy
  const VALID_SORTS = ['priority', 'value', 'abandonedAt', 'lastSentAt'];
  if (!VALID_SORTS.includes(sortBy)) {
    return next(new HandleError(`Invalid sortBy. Must be one of: ${VALID_SORTS.join(', ')}`, 400));
  }

  // Cache key encodes all filter params
  const cacheKey = `recovery_send_list_${page}_${limit}_${outcome || 'all'}_${sortBy}_${minValue}_${search || ''}_${hours}`;
  const cached   = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const result = await getAbandonedCartsForSending({
    page:     parseInt(page),
    limit:    parseInt(limit),
    outcome:  outcome || undefined,
    sortBy,
    minValue: parseFloat(minValue),
    search:   search?.trim() || undefined,
    hours:    parseInt(hours),
  });

  await setCache(cacheKey, result, 120); // 2 min TTL — send page needs fresh data

  res.status(200).json({ success: true, ...result });
});

// ============================================
// GET RECOVERY ANALYTICS
// @route  GET /api/v1/recovery/analytics
// @access Private — admin only
// ============================================

export const getRecoveryAnalyticsHandler = handleAsyncError(async (req, res, next) => {
  const { timeframe = 'month', startDate, endDate } = req.query;

  let start, end;

  if (startDate && endDate) {
    // Custom date range takes priority over timeframe
    start = new Date(startDate);
    end   = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new HandleError('Invalid startDate or endDate', 400));
    }
    if (start > end) {
      return next(new HandleError('startDate must be before endDate', 400));
    }
  } else {
    // Use validateTimeframe to surface a clean error for invalid values
    validateTimeframe(timeframe, next);

    const ranges = getDateRanges(timeframe);
    start = ranges.currentPeriodStart;
    end   = new Date();
  }

  const cacheKey = startDate && endDate
    ? `recovery_analytics_custom_${startDate}_${endDate}`
    : `recovery_analytics_${timeframe}`;

  const cached = await getCache(cacheKey);
  if (cached) return res.status(200).json({ success: true, ...cached });

  const analytics = await RecoveryEmail.getAnalytics(start, end);

  await setCache(cacheKey, analytics, 300); // 5 min TTL

  res.status(200).json({ success: true, ...analytics });
});

// ============================================
// RESOLVE RECOVERY OUTCOME (admin override)
// @route  POST /api/v1/recovery/resolve/:checkoutId
// @access Private — admin only
// ============================================

export const resolveOutcomeHandler = handleAsyncError(async (req, res, next) => {
  const { checkoutId } = req.params;
  const { outcome }    = req.body;

  const VALID_OUTCOMES = ['converted', 'organic', 're_abandoned', 'expired', 'exhausted', 'failed'];

  if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
    return next(
      new HandleError(`Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}`, 400)
    );
  }

  // Guard: do not allow overwriting terminal states via admin override.
  const record = await RecoveryEmail.findOne({ checkout: checkoutId });

  if (!record) {
    return next(new HandleError('No recovery email record found for this checkout', 404));
  }

  const TERMINAL = ['converted', 'organic', 'exhausted', 'expired', 'failed'];
  if (TERMINAL.includes(record.outcome)) {
    return res.status(422).json({
      success: false,
      message: `Cannot override a terminal outcome (current: ${record.outcome})`,
    });
  }

  await resolveRecoveryOutcome(checkoutId, outcome);

  // Bust analytics cache since outcome distribution changed.
  await Promise.all([
    deleteCachePattern('recovery_analytics_*'),
    deleteCachePattern('recovery_send_list_*'),
  ]).catch(() => {});

  res.status(200).json({
    success:     true,
    message:     `Recovery outcome set to '${outcome}'`,
    checkoutId,
    outcome,
    resolvedAt:  new Date(),
  });
});