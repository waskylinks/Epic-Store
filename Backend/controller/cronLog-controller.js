/**
 * controllers/cronLogController.js
 *
 * Two read-only endpoints for cron run history and the checkout analytics banner.
 *
 * GET /api/v1/admin/cron/logs/:jobName
 *   Cursor-paginated run history for a specific job.
 *   Used by the AdminCronHealth page history section.
 *
 * GET /api/v1/admin/cron/banner
 *   Lightweight banner data for the checkout analytics page.
 *   Returns the most recent run of each banner-relevant job within the
 *   last BANNER_WINDOW_HOURS hours. Cached in Redis at 60s TTL.
 *
 * Security:
 *   - Both routes are mounted behind verifyUserAuth + roleBaseAccess('admin')
 *     in the router — no auth logic lives here.
 *   - jobName path parameter is validated against an allowlist before any DB
 *     query is issued, preventing injection via arbitrary collection queries.
 *   - cursor parameter is decoded inside CronJobLog.getRecentByJob() which
 *     validates structure before casting to ObjectId.
 *   - limit is capped server-side inside the model static regardless of what
 *     the client sends.
 *   - No user-supplied data is written to the database in either endpoint.
 *
 * EDIT SUMMARY (vs previous version):
 *   - Added 'RecoveryEmailRetention' to VALID_JOB_NAMES allowlist so the
 *     history endpoint accepts log requests for the new job without returning
 *     a 400. The AdminCronHealth RunHistoryPanel calls this endpoint when the
 *     history toggle is opened on the RecoveryEmailRetention detail card.
 *   - Added 'RecoveryEmailRetention' to BANNER_JOB_NAMES so the banner
 *     endpoint returns its most recent run alongside CheckoutRetention. This
 *     surfaces the job on the RecoveryEmailAnalyticsPage and
 *     RecoveryEmailMonitorPage banners, informing admins when the last
 *     snapshot prune or orphan resolution ran.
 */

import CronJobLog      from '../models/CronJobLog.js';
import { getCache, setCache, deleteCache } from '../utils/redis.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError      from '../utils/handleError.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Allowlist of valid jobName values for the history endpoint.
// Any request with a jobName not in this set is rejected with 400.
// Update this list when new jobs are added to cronRegistry.js.
const VALID_JOB_NAMES = new Set([
  'AbandonmentSweep',
  'DiscountCleanup',
  'AuditCleanup',
  'RecoveryEmailCron',
  'CheckoutRetention',
  'RecoveryEmailRetention',  // ADDED — two-pass recovery email lifecycle job
]);

// Jobs that contribute to the analytics banners.
// CheckoutRetention appears on the checkout analytics banner.
// RecoveryEmailRetention appears on both recovery email page banners.
// Both are included here so a single banner endpoint serves all consumers.
// The frontend selects the relevant entry by jobName using selectBannerJobByName.
const BANNER_JOB_NAMES = [
  'CheckoutRetention',
  'RecoveryEmailRetention',  // ADDED — surfaces on recovery email analytics pages
];

// How far back the banner looks for a recent run (72 hours)
const BANNER_WINDOW_HOURS = 72;
const BANNER_WINDOW_MS    = BANNER_WINDOW_HOURS * 60 * 60 * 1000;

// Redis cache keys
const BANNER_CACHE_KEY   = 'cron_banner';
const BANNER_CACHE_TTL   = 60; // seconds

// History cache: keyed per job + cursor + limit so pages are individually cached
const historyCacheKey = (jobName, limit, cursor) =>
  `cron_history:${jobName}:${limit}:${cursor ?? 'start'}`;
const HISTORY_CACHE_TTL = 30; // seconds — history is less hot than the banner

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/cron/logs/:jobName
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getCronJobHistory
 *
 * Returns paginated run history for a single job.
 *
 * Query params:
 *   limit  {number}  1–100, default 20
 *   cursor {string}  opaque base64 cursor from previous response
 *
 * Response:
 *   {
 *     success:     boolean,
 *     jobName:     string,
 *     logs:        CronJobLog[],
 *     hasNextPage: boolean,
 *     nextCursor:  string | null,
 *   }
 */
export const getCronJobHistory = handleAsyncError(async (req, res, next) => {
  const { jobName } = req.params;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!VALID_JOB_NAMES.has(jobName)) {
    return next(new HandleError(
      `Invalid jobName. Must be one of: ${[...VALID_JOB_NAMES].join(', ')}`,
      400
    ));
  }

  // limit: parse and clamp — the model also caps at 100, but we validate
  // early to return a clean 400 rather than silently clamping.
  const rawLimit = parseInt(req.query.limit, 10);
  if (req.query.limit !== undefined && (isNaN(rawLimit) || rawLimit < 1 || rawLimit > 100)) {
    return next(new HandleError('limit must be an integer between 1 and 100', 400));
  }
  const limit = isNaN(rawLimit) ? 20 : rawLimit;

  // cursor: must be a non-empty string if provided
  const cursor = req.query.cursor
    ? String(req.query.cursor).trim() || null
    : null;

  // ── Cache check ───────────────────────────────────────────────────────────
  const cacheKey = historyCacheKey(jobName, limit, cursor);
  const cached   = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  // ── Query ─────────────────────────────────────────────────────────────────
  let result;
  try {
    result = await CronJobLog.getRecentByJob(jobName, limit, cursor);
  } catch (err) {
    // getRecentByJob throws descriptive errors for invalid cursor format
    if (err.message.startsWith('Invalid cursor')) {
      return next(new HandleError(err.message, 400));
    }
    return next(new HandleError('Failed to fetch cron job history', 500));
  }

  const payload = {
    jobName,
    logs:        result.logs,
    hasNextPage: result.hasNextPage,
    nextCursor:  result.nextCursor,
  };

  await setCache(cacheKey, payload, HISTORY_CACHE_TTL);

  res.status(200).json({ success: true, ...payload });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/cron/banner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getCronBanner
 *
 * Returns recent run data for banner-relevant jobs.
 * Called on every checkout analytics and recovery email page load — must be fast.
 *
 * Response:
 *   {
 *     success: boolean,
 *     jobs: [
 *       {
 *         jobName:     string,
 *         status:      'ok' | 'failed' | 'partial',
 *         startedAt:   Date,
 *         counts:      Object,
 *         error:       string | null,
 *         triggeredBy: 'cron' | 'manual',
 *       }
 *     ]
 *   }
 *
 * jobs is an empty array if none of the banner jobs have run recently.
 * The frontend selects the relevant job by name using selectBannerJobByName
 * and is responsible for deciding whether to show a banner based on presence
 * and status of the entry for its specific job.
 *
 * With RecoveryEmailRetention now in BANNER_JOB_NAMES, the jobs array can
 * contain up to two entries — one per banner-relevant job. The selectBannerJobByName
 * selector in cronLogSlice.js already handles arbitrary job names, so no
 * frontend slice changes are needed.
 */
export const getCronBanner = handleAsyncError(async (req, res, next) => {
  // ── Cache check ───────────────────────────────────────────────────────────
  const cached = await getCache(BANNER_CACHE_KEY);
  if (cached) {
    return res.status(200).json({ success: true, ...cached });
  }

  // ── Query ─────────────────────────────────────────────────────────────────
  const sinceMs = Date.now() - BANNER_WINDOW_MS;

  let jobs;
  try {
    jobs = await CronJobLog.getLastRunSince(BANNER_JOB_NAMES, sinceMs);
  } catch (err) {
    return next(new HandleError('Failed to fetch banner data', 500));
  }

  const payload = { jobs };

  await setCache(BANNER_CACHE_KEY, payload, BANNER_CACHE_TTL);

  res.status(200).json({ success: true, ...payload });
});

/**
 * invalidateBannerCache
 *
 * Exported for use by the CronJobLog model's post-save hook and the
 * retention jobs' cache flush. Ensures the banner reflects fresh data
 * immediately after a retention run completes.
 */
export async function invalidateBannerCache() {
  await deleteCache(BANNER_CACHE_KEY);
}