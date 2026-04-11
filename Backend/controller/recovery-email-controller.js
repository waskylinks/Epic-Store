import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import {
  getRecoveryEmailStatus,
  resolveRecoveryOutcome,
  getAbandonedCartsForSending,
} from '../Services/recoveryEmailService.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { getCache, setCache, deleteCachePattern } from '../utils/redis.js';
import { getDateRanges } from '../utils/dateRanges.js';
import { validateTimeframe } from '../utils/validateTimeframe.js';

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

  res.status(200).json({
    success: true,
    status: status || {
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

  const VALID_SORTS = ['priority', 'value', 'abandonedAt', 'lastSentAt'];
  if (!VALID_SORTS.includes(sortBy)) {
    return next(new HandleError(`Invalid sortBy. Must be one of: ${VALID_SORTS.join(', ')}`, 400));
  }

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

  await setCache(cacheKey, result, 120);

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
    start = new Date(startDate);
    end   = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new HandleError('Invalid startDate or endDate', 400));
    }
    if (start > end) {
      return next(new HandleError('startDate must be before endDate', 400));
    }
  } else {
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

  await setCache(cacheKey, analytics, 300);

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

  await Promise.all([
    deleteCachePattern('recovery_analytics_*'),
    deleteCachePattern('recovery_send_list_*'),
  ]).catch(() => {});

  res.status(200).json({
    success:    true,
    message:    `Recovery outcome set to '${outcome}'`,
    checkoutId,
    outcome,
    resolvedAt: new Date(),
  });
});