/**
 * backend/controllers/analyticsObservabilityController.js
 *
 * Phase 8 — Observability & Attribution Drift Detection
 *
 * Exposes four admin endpoints that make the analytics system's health
 * visible and debuggable. This is what separates a professional analytics
 * implementation from one that silently produces wrong data for months.
 *
 * Endpoints:
 *   GET /api/v1/admin/analytics/health       — attribution health metrics
 *   GET /api/v1/admin/analytics/drift        — attribution drift report
 *   GET /api/v1/admin/analytics/queue-health — event queue status
 *   GET /api/v1/admin/analytics/trace/:userId — full event trace for a user
 *
 * Attribution Health Metrics (health endpoint):
 *   utm_capture_rate        — % of orders where UTMs were present
 *   click_id_capture_rate   — % of orders with at least one click ID
 *   confidence_distribution — breakdown of HIGH/MEDIUM/LOW across orders
 *   reconstruction_rate     — % of orders where referrer reconstruction fired
 *   identity_match_rate     — % of orders with both userId and anonymousId
 *   unattributed_rate       — % of orders with source "direct" and no click IDs
 *
 * Attribution Drift Detection:
 *   Compares source distribution of last 7 days vs last 30 days.
 *   A shift > DRIFT_THRESHOLD (20pp) on any source triggers an alert flag.
 *   This catches tracking bugs before they corrupt weeks of data.
 *
 *   Example: Facebook drops from 35% → 10% overnight.
 *   That is a tracking bug (pixel blocked, CAPI misconfigured, fbclid stripped),
 *   not a real change in user behavior. Drift detection catches it in hours.
 */

import Order           from '../models/order-model.js';
import AnalyticsEvent  from '../models/AnalyticsEvent.js';
import HandleError     from '../utils/handleError.js';
import catchAsyncErrors from '../middleware/catchAsyncErrors.js';
import { getReconstructionRules } from '../utils/referrerReconstruction.js';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

// A shift greater than this percentage points on any single source
// triggers a drift alert. Set lower for more sensitive detection.
const DRIFT_THRESHOLD = 0.20; // 20 percentage points

// How many days to look back for the health metrics baseline
const HEALTH_WINDOW_DAYS = 30;

// ─── HEALTH METRICS ───────────────────────────────────────────────────────────

/**
 * getAttributionHealth
 *
 * GET /api/v1/admin/analytics/health
 *
 * Returns six attribution health metrics computed from the last 30 days
 * of orders. All rates are expressed as percentages (0-100).
 *
 * Low values indicate tracking gaps:
 *   utm_capture_rate < 40%      → UTM params being stripped before landing
 *   click_id_capture_rate < 20% → Ad clicks not reaching server with click IDs
 *   confidence HIGH < 30%       → Most attribution is uncertain
 *   reconstruction_rate > 30%   → Too many orders relying on inference
 *   identity_match_rate < 70%   → Anonymous ID stitching not working
 *   unattributed_rate > 50%     → Over half of orders appear as "direct"
 */
export const getAttributionHealth = catchAsyncErrors(async (req, res) => {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - HEALTH_WINDOW_DAYS);

  // Fetch orders from the last 30 days with analytics fields
  const orders = await Order.find(
    { createdAt: { $gte: windowStart } },
    {
      'analytics.source':          1,
      'analytics.gclid':           1,
      'analytics.fbclid':          1,
      'analytics.ttclid':          1,
      'analytics.msclkid':         1,
      'analytics.confidenceLevel': 1,
      'analytics.isReconstructed': 1,
      'analytics.anonymousId':     1,
      'analytics.eventId':         1,
      'analytics.medium':          1,
    }
  ).lean();

  const total = orders.length;

  if (total === 0) {
    return res.status(200).json({
      success: true,
      period:  `Last ${HEALTH_WINDOW_DAYS} days`,
      total:   0,
      message: 'No orders found in the analysis window',
      metrics: null,
    });
  }

  // ── Compute metrics ────────────────────────────────────────────────────────

  let utmCount         = 0;
  let clickIdCount     = 0;
  let reconstructCount = 0;
  let identityCount    = 0;
  let unattributed     = 0;

  const confidenceCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, null: 0 };

  for (const order of orders) {
    const a = order.analytics || {};

    // UTM captured: source is not "direct" and not null
    if (a.source && a.source !== 'direct') utmCount++;

    // Click ID captured: any click ID present
    if (a.gclid || a.fbclid || a.ttclid || a.msclkid) clickIdCount++;

    // Confidence distribution
    const level = a.confidenceLevel || 'null';
    if (level in confidenceCounts) confidenceCounts[level]++;
    else confidenceCounts.null++;

    // Reconstruction fired
    if (a.isReconstructed) reconstructCount++;

    // Identity stitched: has anonymousId (means identityMiddleware was active)
    if (a.anonymousId) identityCount++;

    // Unattributed: direct source with no click IDs
    if (
      (!a.source || a.source === 'direct') &&
      !a.gclid && !a.fbclid && !a.ttclid && !a.msclkid
    ) unattributed++;
  }

  const pct = (n) => Math.round((n / total) * 100 * 10) / 10;

  const metrics = {
    utm_capture_rate:      pct(utmCount),
    click_id_capture_rate: pct(clickIdCount),
    reconstruction_rate:   pct(reconstructCount),
    identity_match_rate:   pct(identityCount),
    unattributed_rate:     pct(unattributed),
    confidence_distribution: {
      HIGH:    pct(confidenceCounts.HIGH),
      MEDIUM:  pct(confidenceCounts.MEDIUM),
      LOW:     pct(confidenceCounts.LOW),
      unknown: pct(confidenceCounts.null),
    },
  };

  // ── Health flags (actionable warnings) ────────────────────────────────────
  const flags = [];

  if (metrics.utm_capture_rate < 30) {
    flags.push({
      severity: 'WARNING',
      metric:   'utm_capture_rate',
      value:    metrics.utm_capture_rate,
      message:  'Less than 30% of orders have UTM parameters. Check if UTM params are being stripped by redirects or ad platforms.',
    });
  }

  if (metrics.unattributed_rate > 50) {
    flags.push({
      severity: 'WARNING',
      metric:   'unattributed_rate',
      value:    metrics.unattributed_rate,
      message:  'Over 50% of orders show as direct with no click IDs. Attribution accuracy may be low.',
    });
  }

  if (metrics.identity_match_rate < 50) {
    flags.push({
      severity: 'WARNING',
      metric:   'identity_match_rate',
      value:    metrics.identity_match_rate,
      message:  'Less than 50% of orders have anonymousId. Check that identityMiddleware is mounted in app.js.',
    });
  }

  if (metrics.confidence_distribution.HIGH < 20) {
    flags.push({
      severity: 'INFO',
      metric:   'confidence_distribution.HIGH',
      value:    metrics.confidence_distribution.HIGH,
      message:  'Less than 20% of orders have HIGH confidence attribution. Consider improving click ID capture.',
    });
  }

  return res.status(200).json({
    success:           true,
    period:            `Last ${HEALTH_WINDOW_DAYS} days`,
    total,
    windowStart:       windowStart.toISOString(),
    metrics,
    flags,
    reconstructionRules: getReconstructionRules(),
  });
});

// ─── ATTRIBUTION DRIFT ────────────────────────────────────────────────────────

/**
 * getAttributionDrift
 *
 * GET /api/v1/admin/analytics/drift
 *
 * Compares source distribution of last 7 days vs last 30 days.
 * Returns alerts for any source that shifted more than DRIFT_THRESHOLD.
 *
 * The "killer feature" of this observability system — detects tracking
 * bugs before they corrupt weeks of data and campaign decisions.
 */
export const getAttributionDrift = catchAsyncErrors(async (req, res) => {
  const now         = new Date();
  const last7Start  = new Date(now); last7Start.setDate(now.getDate() - 7);
  const last30Start = new Date(now); last30Start.setDate(now.getDate() - 30);

  // Aggregate source counts for both windows
  const [recentOrders, baselineOrders] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: last7Start } } },
      { $group: { _id: '$analytics.source', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: last30Start } } },
      { $group: { _id: '$analytics.source', count: { $sum: 1 } } },
    ]),
  ]);

  // Build source → count maps
  const toMap = (rows) => {
    const map   = {};
    let total   = 0;
    rows.forEach(({ _id, count }) => {
      const source  = _id || 'direct';
      map[source]   = (map[source] || 0) + count;
      total        += count;
    });
    return { map, total };
  };

  const recent   = toMap(recentOrders);
  const baseline = toMap(baselineOrders);

  // Union of all sources across both windows
  const allSources = new Set([
    ...Object.keys(recent.map),
    ...Object.keys(baseline.map),
  ]);

  const sourceAnalysis = [];
  const driftAlerts    = [];

  for (const source of allSources) {
    const recentCount   = recent.map[source]   || 0;
    const baselineCount = baseline.map[source] || 0;

    const recentShare   = recent.total   > 0 ? recentCount   / recent.total   : 0;
    const baselineShare = baseline.total > 0 ? baselineCount / baseline.total : 0;
    const drift         = recentShare - baselineShare;
    const absDrift      = Math.abs(drift);

    const entry = {
      source,
      recent_count:    recentCount,
      baseline_count:  baselineCount,
      recent_pct:      Math.round(recentShare   * 1000) / 10,
      baseline_pct:    Math.round(baselineShare * 1000) / 10,
      drift_pct:       Math.round(drift         * 1000) / 10,
      drift_direction: drift > 0 ? 'spike' : drift < 0 ? 'drop' : 'stable',
      alert:           absDrift >= DRIFT_THRESHOLD,
    };

    sourceAnalysis.push(entry);

    if (absDrift >= DRIFT_THRESHOLD) {
      driftAlerts.push({
        source,
        direction:    entry.drift_direction,
        drift_pct:    entry.drift_pct,
        recent_pct:   entry.recent_pct,
        baseline_pct: entry.baseline_pct,
        severity:     absDrift >= 0.35 ? 'CRITICAL' : 'WARNING',
        message: entry.drift_direction === 'drop'
          ? `${source} traffic dropped ${Math.abs(entry.drift_pct)}pp vs baseline. Check pixel/CAPI configuration for this channel.`
          : `${source} traffic spiked ${entry.drift_pct}pp vs baseline. Verify this reflects real traffic, not tracking duplication.`,
      });
    }
  }

  // Sort by absolute drift descending
  sourceAnalysis.sort((a, b) => Math.abs(b.drift_pct) - Math.abs(a.drift_pct));

  return res.status(200).json({
    success: true,
    periods: {
      recent:   { start: last7Start.toISOString(),  end: now.toISOString(), days: 7  },
      baseline: { start: last30Start.toISOString(), end: now.toISOString(), days: 30 },
    },
    totals: {
      recent:   recent.total,
      baseline: baseline.total,
    },
    driftThreshold:  DRIFT_THRESHOLD * 100, // as percentage points
    alertCount:      driftAlerts.length,
    hasAlerts:       driftAlerts.length > 0,
    driftAlerts,
    sourceAnalysis,
  });
});

// ─── QUEUE HEALTH ─────────────────────────────────────────────────────────────

/**
 * getQueueHealth
 *
 * GET /api/v1/admin/analytics/queue-health
 *
 * Returns the current state of the analytics event queue.
 * High pending/failed/dead_letter counts indicate dispatch problems.
 */
export const getQueueHealth = catchAsyncErrors(async (req, res) => {
  const [queueSummary, recentDeadLetters, recentFailed] = await Promise.all([
    AnalyticsEvent.getQueueHealth(),

    // Most recent dead-letter events for investigation
    AnalyticsEvent.find({ status: 'dead_letter' })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('eventId eventType attempts lastError updatedAt')
      .lean(),

    // Failed events due for retry
    AnalyticsEvent.find({
      status:      'failed',
      nextRetryAt: { $lte: new Date() },
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('eventId eventType attempts nextRetryAt platforms updatedAt')
      .lean(),
  ]);

  // Platform-level failure breakdown from recent failed events
  const platformFailures = { ga4: 0, meta: 0, bigquery: 0 };
  recentFailed.forEach(event => {
    if (event.platforms?.ga4?.success      === false) platformFailures.ga4++;
    if (event.platforms?.meta?.success     === false) platformFailures.meta++;
    if (event.platforms?.bigquery?.success === false) platformFailures.bigquery++;
  });

  const flags = [];

  if (queueSummary.dead_letter > 0) {
    flags.push({
      severity: 'CRITICAL',
      message:  `${queueSummary.dead_letter} event(s) in dead_letter — require manual investigation`,
    });
  }

  if (queueSummary.failed > 10) {
    flags.push({
      severity: 'WARNING',
      message:  `${queueSummary.failed} events in failed state — check platform connectivity`,
    });
  }

  if (queueSummary.pending > 50) {
    flags.push({
      severity: 'WARNING',
      message:  `${queueSummary.pending} events pending — queue may be backed up`,
    });
  }

  return res.status(200).json({
    success:  true,
    summary:  queueSummary,
    platformFailures,
    recentDeadLetters,
    recentFailed,
    flags,
  });
});

// ─── USER EVENT TRACE ─────────────────────────────────────────────────────────

/**
 * getUserEventTrace
 *
 * GET /api/v1/admin/analytics/trace/:userId
 *
 * Returns the full analytics event trace for a specific user.
 * Useful for debugging attribution issues on specific accounts.
 *
 * Shows:
 *   - All orders with their attribution data and confidence scores
 *   - Queue events associated with this user
 *   - Anonymous IDs linked to this user (identity stitching history)
 */
export const getUserEventTrace = catchAsyncErrors(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return next(new HandleError('userId parameter is required', 400));
  }

  const [orders, queueEvents] = await Promise.all([
    Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('createdAt totalPrice analytics paymentInfo')
      .lean(),

    AnalyticsEvent.find({
      'payload.user_id': userId,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('eventId eventType status attempts platforms createdAt updatedAt')
      .lean(),
  ]);

  // Extract all anonymous IDs seen for this user across their orders
  const anonymousIds = [
    ...new Set(
      orders
        .map(o => o.analytics?.anonymousId)
        .filter(Boolean)
    ),
  ];

  return res.status(200).json({
    success: true,
    userId,
    summary: {
      totalOrders:     orders.length,
      totalQueueEvents: queueEvents.length,
      anonymousIds,
      sources: [...new Set(orders.map(o => o.analytics?.source).filter(Boolean))],
      confidenceLevels: {
        HIGH:   orders.filter(o => o.analytics?.confidenceLevel === 'HIGH').length,
        MEDIUM: orders.filter(o => o.analytics?.confidenceLevel === 'MEDIUM').length,
        LOW:    orders.filter(o => o.analytics?.confidenceLevel === 'LOW').length,
      },
    },
    orders: orders.map(o => ({
      orderId:          o._id,
      createdAt:        o.createdAt,
      revenue:          o.totalPrice,
      paymentReference: o.paymentInfo?.reference,
      attribution: {
        source:           o.analytics?.source,
        medium:           o.analytics?.medium,
        campaign:         o.analytics?.campaign,
        gclid:            o.analytics?.gclid,
        fbclid:           o.analytics?.fbclid,
        confidenceScore:  o.analytics?.confidenceScore,
        confidenceLevel:  o.analytics?.confidenceLevel,
        isReconstructed:  o.analytics?.isReconstructed,
        reconstructionRule: o.analytics?.reconstructionRule,
        anonymousId:      o.analytics?.anonymousId,
        eventId:          o.analytics?.eventId,
      },
    })),
    queueEvents,
  });
});