import mongoose from "mongoose";
import DiscountAnalytics from "../models/discount-analytics-model.js";
import Discount from "../models/discount-model.js";
import Order from "../models/order-model.js";
import CustomerAnalytics from "../models/customer-analytics-model.js";

// ============================================
// DISCOUNT ANALYTICS SERVICE
//
// Mirrors the structure of customer-analytics-service.js:
//
//   syncDiscountAnalytics(discountId)     — single code, full re-compute
//   syncDiscountAfterRedemption(code)     — fire-and-forget hook for the
//                                           discount controller post-validate
//   syncAllDiscountAnalytics()            — bulk, 50-item batches, CRON / admin
//   getDiscountAnalyticsSummary()         — single-pass $facet summary for
//                                           the overview KPI panel
//
// Revenue source contract:
//   All revenue figures come from:
//     Order.find({ discountCode: code, "paymentInfo.status": "success" })
//   NOT from Discount.usageHistory[].order refs, which are null at
//   /validate time and only populated once the order document is created.
//   This means the two counts can diverge temporarily for a redemption
//   that happened at checkout but whose order hasn't been persisted yet —
//   acceptable given the fire-and-forget sync model.
//
// Baseline contract:
//   Store-wide AOV and avg discount amount are computed once per sync from
//   a lightweight Order aggregate and stored in DiscountAnalytics.baseline.
//   They are used to compute aovLiftPercent without a second DB round trip
//   at read time.
// ============================================

// ============================================
// CONSTANTS
// ============================================

const BATCH_SIZE = 50;

// Minimum redemptions required before conversion/retention metrics are
// computed. Below this threshold the sample is too small to be meaningful
// and the fields are left null.
const MIN_REDEMPTIONS_FOR_CONVERSION = 10;

// Rolling window for dailyRedemptions time-series (days).
// Entries older than this are pruned during sync.
const DAILY_SERIES_WINDOW_DAYS = 365;

// Days after redemption within which we look for a second purchase
// (no discount) to count as a retained customer.
const RETENTION_WINDOW_DAYS = 90;

// ============================================
// SYNC SINGLE DISCOUNT
// ============================================

/**
 * Full re-compute of analytics for one discount code.
 * Safe to call repeatedly — always overwrites the previous snapshot.
 *
 * @param {string|ObjectId} discountId
 * @returns {Promise<Document>}   the upserted DiscountAnalytics document
 */
export const syncDiscountAnalytics = async (discountId) => {
  const discount = await Discount.findById(discountId).lean();
  if (!discount) {
    throw new Error(`Discount ${discountId} not found`);
  }

  // ── Step 1: Pull all matched orders ───────────────────────────────────────
  // Revenue source: Order collection, not usageHistory refs (see contract above).
  const matchedOrders = await Order.find({
    discountCode: discount.code,
    "paymentInfo.status": "success",
    orderStatus: { $ne: "Cancelled" },
  })
    .select("user totalPrice discountAmount createdAt")
    .lean();

  // ── Step 2: Pull usageHistory for redemption-level data ───────────────────
  // usageHistory carries discountAmount, usedAt, and userId per redemption.
  // We use it for cost / timing data; we never use .order refs for revenue.
  const usageHistory = discount.usageHistory ?? [];

  // ── Step 3: Compute each analytics block in isolation ─────────────────────
  const meta              = buildMeta(discount);
  const redemptionMetrics = buildRedemptionMetrics(usageHistory);
  const financials        = buildFinancials(usageHistory, matchedOrders);
  const conversion        = await buildConversion(discount, usageHistory, matchedOrders);
  const categoryBreakdown = buildCategoryBreakdown(
    usageHistory,
    discount.conditions?.eligibleProductCategories ?? []
  );
  const segmentBreakdown  = await buildSegmentBreakdown(usageHistory);
  const valueTierBreakdown = await buildValueTierBreakdown(usageHistory);
  const dailyRedemptions  = buildDailyRedemptions(usageHistory, matchedOrders);
  const peakUsage         = derivePeakUsage(dailyRedemptions);
  const baseline          = await buildBaseline(financials.avgOrderValue);

  // ── Step 4: Upsert ────────────────────────────────────────────────────────
  const payload = {
    discountId:      discount._id,
    discountCode:    discount.code,
    meta,
    redemptions:     redemptionMetrics,
    financials,
    conversion,
    categoryBreakdown,
    segmentBreakdown,
    valueTierBreakdown,
    dailyRedemptions,
    peakUsage,
    baseline,
    lastSyncedAt:    new Date(),
    syncError:       false,
    syncErrorMessage: null,
    $inc: { syncCount: 1 },
  };

  // $inc cannot coexist with $set in findOneAndUpdate — split it out.
  const { $inc, ...setFields } = payload;

  return DiscountAnalytics.findOneAndUpdate(
    { discountId: discount._id },
    { $set: setFields, $inc },
    { upsert: true, new: true, runValidators: true }
  );
};

// ============================================
// SYNC AFTER REDEMPTION (fire-and-forget hook)
// ============================================

/**
 * Called by discount-controller.js inside validateDiscountCode after a
 * successful recordUsage() call. Errors are swallowed so a Redis or DB
 * hiccup never surfaces to the customer at checkout.
 *
 * Usage in controller:
 *   syncDiscountAfterRedemption(discount.code).catch(() => {});
 *
 * @param {string} discountCode   — the uppercased code string
 */
export const syncDiscountAfterRedemption = async (discountCode) => {
  try {
    const discount = await Discount.findOne({
      code: discountCode.toUpperCase(),
    })
      .select("_id")
      .lean();

    if (!discount) return;

    await syncDiscountAnalytics(discount._id);
  } catch {
    // Intentionally swallowed — analytics must never block checkout.
  }
};

// ============================================
// BULK SYNC ALL DISCOUNTS
// ============================================

/**
 * Re-syncs every discount that has ever been used (currentUses > 0).
 * Unused codes are skipped — there is nothing to compute yet.
 * Batches of BATCH_SIZE run concurrently; batches are sequential so the
 * event loop stays responsive during long runs.
 *
 * Mirrors syncAllCustomerAnalytics() exactly.
 *
 * @returns {Promise<{ total, successful, errors }>}
 */
export const syncAllDiscountAnalytics = async () => {
  const discountIds = await Discount.find(
    { "usageLimit.currentUses": { $gt: 0 } },
    { _id: 1 }
  ).lean();

  const ids = discountIds.map((d) => d._id);

  let successCount = 0;
  let errorCount   = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (discountId) => {
        try {
          await syncDiscountAnalytics(discountId);
          successCount++;
        } catch (err) {
          errorCount++;
          // Mark the document as errored so findStale() picks it up next time.
          await DiscountAnalytics.findOneAndUpdate(
            { discountId },
            {
              $set: {
                syncError:        true,
                syncErrorMessage: err?.message ?? "Unknown error",
              },
            },
            { upsert: false }
          ).catch(() => {});
        }
      })
    );
  }

  return {
    total:      ids.length,
    successful: successCount,
    errors:     errorCount,
  };
};

// ============================================
// SUMMARY (for controller overview endpoint)
// ============================================

/**
 * Delegates to the model static — keeps the controller thin.
 * The result is cached by the controller, not here, so this function
 * always returns a fresh aggregation.
 *
 * @returns {Promise<Object>}
 */
export const getDiscountAnalyticsSummary = async () => {
  return DiscountAnalytics.getSummary();
};

// ============================================
// HELPERS
// ============================================

// ── buildMeta ─────────────────────────────────────────────────────────────

/**
 * Denormalises the fields from the Discount document that we want to
 * surface in analytics list views without joining back to Discount.
 *
 * @param {Object} discount   — lean Discount document
 * @returns {Object}
 */
const buildMeta = (discount) => ({
  type:                       discount.type,
  value:                      discount.value,
  category:                   discount.category,
  audience:                   discount.audience,
  isCategoryRestricted:
    (discount.conditions?.eligibleProductCategories ?? []).length > 0,
  eligibleProductCategories:
    discount.conditions?.eligibleProductCategories ?? [],
  validFrom:    discount.validFrom,
  validUntil:   discount.validUntil,
  status:       discount.status,
  isCompensation:
    discount.category === "return" || discount.category === "refund",
});

// ── buildRedemptionMetrics ─────────────────────────────────────────────────

/**
 * Counts total, unique, first-time, returning, and guest redemptions
 * from the usageHistory array.
 *
 * First-time detection: a redemption is "first-time" when the user's
 * entry in usageHistory is the first time we see that userId in the array
 * (i.e., userId appears exactly once up to and including this entry).
 * Guest redemptions are entries where user is null.
 *
 * @param {Array} usageHistory   — discount.usageHistory
 * @returns {Object}
 */
const buildRedemptionMetrics = (usageHistory) => {
  if (usageHistory.length === 0) {
    return {
      total:          0,
      uniqueUsers:    0,
      firstTimeUsers: 0,
      returningUsers: 0,
      guestRedemptions: 0,
    };
  }

  const seenUserIds    = new Set();
  let guestRedemptions = 0;
  let firstTimeUsers   = 0;

  usageHistory.forEach((entry) => {
    const uid = entry.user?.toString();
    if (!uid) {
      guestRedemptions++;
      return;
    }

    if (!seenUserIds.has(uid)) {
      seenUserIds.add(uid);
      firstTimeUsers++;
    }
  });

  const loggedInRedemptions = usageHistory.length - guestRedemptions;
  const returningUsers      = loggedInRedemptions - firstTimeUsers;

  return {
    total:            usageHistory.length,
    uniqueUsers:      seenUserIds.size,
    firstTimeUsers,
    returningUsers:   Math.max(0, returningUsers),
    guestRedemptions,
  };
};

// ── buildFinancials ────────────────────────────────────────────────────────

/**
 * Computes all financial KPIs.
 *
 * totalDiscountCost    — sum of usageHistory[].discountAmount
 * totalRevenueInfluenced — sum of matchedOrders[].totalPrice
 * avgOrderValue        — totalRevenueInfluenced / matchedOrders.length
 * roi                  — (revenue - cost) / cost * 100
 * totalEligibleSubtotal — only meaningful for category-restricted codes;
 *                         derived from the discount amount and the discount
 *                         value percentage when the discount type is
 *                         "percentage". For fixed codes this is null.
 *
 * @param {Array}  usageHistory
 * @param {Array}  matchedOrders   — lean Order documents
 * @returns {Object}
 */
const buildFinancials = (usageHistory, matchedOrders) => {
  // Discount cost — sum across all redemptions
  const totalDiscountCost = roundCents(
    usageHistory.reduce((sum, e) => sum + (Number(e.discountAmount) || 0), 0)
  );

  const avgDiscountAmount =
    usageHistory.length > 0
      ? roundCents(totalDiscountCost / usageHistory.length)
      : 0;

  // Revenue influenced — from matched orders only
  const totalRevenueInfluenced = roundCents(
    matchedOrders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0)
  );

  const avgOrderValue =
    matchedOrders.length > 0
      ? roundCents(totalRevenueInfluenced / matchedOrders.length)
      : 0;

  // ROI — null when cost is zero (nothing spent yet)
  const roi =
    totalDiscountCost > 0
      ? roundCents(
          ((totalRevenueInfluenced - totalDiscountCost) / totalDiscountCost) * 100
        )
      : null;

  return {
    totalDiscountCost,
    avgDiscountAmount,
    totalRevenueInfluenced,
    avgOrderValue,
    roi,
    // incrementalRevenue and totalEligibleSubtotal require external baseline /
    // category data that is not available here — set in post-processing if needed.
    incrementalRevenue:    null,
    totalEligibleSubtotal: null,
  };
};

// ── buildConversion ────────────────────────────────────────────────────────

/**
 * Computes post-redemption retention rate and avg days to next purchase.
 * Also computes targeted vs broadcast redemption rates depending on audience.
 *
 * Post-redemption retention:
 *   For each unique redeemer, check whether they placed another order
 *   (no discount) within RETENTION_WINDOW_DAYS of their redemption.
 *   Skipped when uniqueUsers < MIN_REDEMPTIONS_FOR_CONVERSION.
 *
 * Targeted redemption rate:
 *   redemptions / eligibleUsers.length  (audience: specific)
 *
 * Broadcast redemption rate:
 *   Not computable here without knowing the exposed audience size at
 *   campaign launch. Set to null — the controller can supply it if
 *   the store tracks email send counts / push notification reach.
 *
 * @param {Object} discount
 * @param {Array}  usageHistory
 * @param {Array}  matchedOrders
 * @returns {Promise<Object>}
 */
const buildConversion = async (discount, usageHistory, matchedOrders) => {
  const base = {
    postRedemptionRetentionRate: null,
    avgDaysToNextPurchase:       null,
    broadcastRedemptionRate:     null,
    targetedRedemptionRate:      null,
  };

  // ── Targeted redemption rate ───────────────────────────────────────────
  if (
    discount.audience === "specific" &&
    (discount.conditions?.eligibleUsers ?? []).length > 0
  ) {
    const eligibleCount = discount.conditions.eligibleUsers.length;
    const uniqueRedeemers = new Set(
      usageHistory
        .filter((e) => e.user)
        .map((e) => e.user.toString())
    ).size;

    base.targetedRedemptionRate = roundCents(
      Math.min((uniqueRedeemers / eligibleCount) * 100, 100)
    );
  }

  // ── Post-redemption retention ──────────────────────────────────────────
  const uniqueRedeemers = [
    ...new Set(
      usageHistory.filter((e) => e.user).map((e) => e.user.toString())
    ),
  ];

  if (uniqueRedeemers.length < MIN_REDEMPTIONS_FOR_CONVERSION) {
    return base;
  }

  // Build a map of userId → earliest redemption date for this code
  const firstRedemptionDate = new Map();
  usageHistory.forEach((entry) => {
    const uid = entry.user?.toString();
    if (!uid) return;
    const usedAt = new Date(entry.usedAt);
    if (
      !firstRedemptionDate.has(uid) ||
      usedAt < firstRedemptionDate.get(uid)
    ) {
      firstRedemptionDate.set(uid, usedAt);
    }
  });

  // For each redeemer, look for a subsequent non-discounted order within
  // the retention window. We query Order in one batch to avoid N queries.
  const retentionCutoffs = uniqueRedeemers.map((uid) => {
    const redeemDate   = firstRedemptionDate.get(uid);
    const windowEnd    = new Date(
      redeemDate.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    return { userId: uid, redeemDate, windowEnd };
  });

  // Single aggregate: find orders placed by these users after their
  // redemption date that did NOT use a discount code.
  const userObjectIds = uniqueRedeemers.map(
    (uid) => new mongoose.Types.ObjectId(uid)
  );

  const subsequentOrders = await Order.find({
    user: { $in: userObjectIds },
    "paymentInfo.status": "success",
    orderStatus: { $ne: "Cancelled" },
    // Exclude orders that themselves used a discount code so we're measuring
    // organic return behaviour, not just discount-chasing.
    $or: [
      { discountCode: { $exists: false } },
      { discountCode: null },
      { discountCode: "" },
    ],
  })
    .select("user createdAt")
    .lean();

  // Group subsequent orders by userId for O(1) lookup
  const subsequentOrderMap = new Map();
  subsequentOrders.forEach((order) => {
    const uid = order.user.toString();
    if (!subsequentOrderMap.has(uid)) {
      subsequentOrderMap.set(uid, []);
    }
    subsequentOrderMap.get(uid).push(new Date(order.createdAt));
  });

  let retainedCount      = 0;
  let totalDaysToNext    = 0;
  let daysToNextCount    = 0;

  retentionCutoffs.forEach(({ userId, redeemDate, windowEnd }) => {
    const orders = subsequentOrderMap.get(userId) ?? [];

    // Find the earliest order after redeemDate and before windowEnd
    const nextOrder = orders
      .filter((d) => d > redeemDate && d <= windowEnd)
      .sort((a, b) => a - b)[0];

    if (nextOrder) {
      retainedCount++;
      const daysToNext = Math.floor(
        (nextOrder.getTime() - redeemDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      totalDaysToNext += daysToNext;
      daysToNextCount++;
    }
  });

  base.postRedemptionRetentionRate =
    uniqueRedeemers.length > 0
      ? roundCents((retainedCount / uniqueRedeemers.length) * 100)
      : null;

  base.avgDaysToNextPurchase =
    daysToNextCount > 0
      ? Math.round(totalDaysToNext / daysToNextCount)
      : null;

  return base;
};

// ── buildCategoryBreakdown ─────────────────────────────────────────────────

/**
 * Aggregates redemption counts and discount cost per PRODUCT_CATEGORIES
 * value, using the itemCategories array stored in DiscountAuditLog meta
 * OR the eligibleProductCategories from the discount's conditions.
 *
 * Since itemCategories is stored in the audit log (not on the Discount
 * document itself), and pulling 50k audit log entries per sync would be
 * expensive, we derive category attribution from usageHistory as follows:
 *
 *   - For category-restricted codes (eligibleProductCategories.length > 0):
 *     every redemption was by definition against an eligible category.
 *     Attribute the full discountAmount equally across the eligible cats.
 *
 *   - For unrestricted codes: we cannot attribute categories without item
 *     data on the usage entry. Return an empty array — the controller can
 *     supplement from the audit log if needed.
 *
 * This is a deliberate trade-off: accuracy vs. sync performance.
 * If per-redemption item data is required, add a `categories` field to
 * Discount.usageHistory and populate it in recordUsage().
 *
 * @param {Array}  usageHistory
 * @param {Array}  eligibleCats   — discount.conditions.eligibleProductCategories
 * @returns {Array}
 */
const buildCategoryBreakdown = (usageHistory, eligibleCats = []) => {
  if (eligibleCats.length === 0) return [];

  const map = new Map();
  eligibleCats.forEach((cat) => {
    map.set(cat, { category: cat, redemptions: 0, discountCost: 0, revenueInfluenced: 0 });
  });

  usageHistory.forEach((entry) => {
    const costPerCat = (Number(entry.discountAmount) || 0) / eligibleCats.length;
    eligibleCats.forEach((cat) => {
      const rec = map.get(cat);
      rec.redemptions++;
      rec.discountCost = roundCents(rec.discountCost + costPerCat);
    });
  });

  return Array.from(map.values());
};

// ── buildSegmentBreakdown ──────────────────────────────────────────────────

/**
 * Joins each redeemer's userId to CustomerAnalytics to get their RFM segment
 * at the time of sync. Aggregates redemption counts and savings per segment.
 *
 * Uses a single aggregate rather than N findOne calls.
 * Users with no CustomerAnalytics document are bucketed as "Unknown".
 *
 * @param {Array} usageHistory
 * @returns {Promise<Array>}
 */
const buildSegmentBreakdown = async (usageHistory) => {
  const loggedInEntries = usageHistory.filter((e) => e.user);
  if (loggedInEntries.length === 0) return [];

  const userIds = [
    ...new Set(loggedInEntries.map((e) => e.user.toString())),
  ].map((id) => new mongoose.Types.ObjectId(id));

  // Fetch segment for each user in one query
  const analyticsResults = await CustomerAnalytics.find(
    { user: { $in: userIds } },
    { user: 1, "rfm.segment": 1 }
  ).lean();

  const segmentMap = new Map(
    analyticsResults.map((a) => [a.user.toString(), a.rfm?.segment ?? "Unknown"])
  );

  // Accumulate per-segment totals
  const breakdown = new Map();

  loggedInEntries.forEach((entry) => {
    const uid     = entry.user.toString();
    const segment = segmentMap.get(uid) ?? "Unknown";
    const savings = Number(entry.discountAmount) || 0;

    if (!breakdown.has(segment)) {
      breakdown.set(segment, {
        segment,
        redemptions:       0,
        totalSavings:      0,
        revenueInfluenced: 0, // populated later if revenue data is available
      });
    }

    const rec = breakdown.get(segment);
    rec.redemptions++;
    rec.totalSavings = roundCents(rec.totalSavings + savings);
  });

  return Array.from(breakdown.values()).sort(
    (a, b) => b.redemptions - a.redemptions
  );
};

// ── buildValueTierBreakdown ────────────────────────────────────────────────

/**
 * Same pattern as buildSegmentBreakdown but groups by CustomerAnalytics.valueTier.
 *
 * @param {Array} usageHistory
 * @returns {Promise<Array>}
 */
const buildValueTierBreakdown = async (usageHistory) => {
  const loggedInEntries = usageHistory.filter((e) => e.user);
  if (loggedInEntries.length === 0) return [];

  const userIds = [
    ...new Set(loggedInEntries.map((e) => e.user.toString())),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const analyticsResults = await CustomerAnalytics.find(
    { user: { $in: userIds } },
    { user: 1, valueTier: 1 }
  ).lean();

  const tierMap = new Map(
    analyticsResults.map((a) => [a.user.toString(), a.valueTier ?? "Unknown"])
  );

  const breakdown = new Map();

  loggedInEntries.forEach((entry) => {
    const uid     = entry.user.toString();
    const tier    = tierMap.get(uid) ?? "Unknown";
    const savings = Number(entry.discountAmount) || 0;

    if (!breakdown.has(tier)) {
      breakdown.set(tier, {
        tier,
        redemptions:       0,
        totalSavings:      0,
        revenueInfluenced: 0,
      });
    }

    const rec = breakdown.get(tier);
    rec.redemptions++;
    rec.totalSavings = roundCents(rec.totalSavings + savings);
  });

  return Array.from(breakdown.values()).sort(
    (a, b) => b.redemptions - a.redemptions
  );
};

// ── buildDailyRedemptions ──────────────────────────────────────────────────

/**
 * Builds the rolling 365-day time-series array.
 *
 * Each entry represents one calendar day (midnight UTC).
 * Revenue for a given day is derived from matchedOrders whose createdAt
 * falls on that day — not from usageHistory, since an order may be created
 * hours or days after the /validate call depending on the checkout flow.
 *
 * Entries older than DAILY_SERIES_WINDOW_DAYS are pruned so the array
 * stays bounded regardless of how long the code has been active.
 *
 * @param {Array} usageHistory
 * @param {Array} matchedOrders
 * @returns {Array}
 */
const buildDailyRedemptions = (usageHistory, matchedOrders) => {
  const cutoff = new Date(
    Date.now() - DAILY_SERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  // Map of "YYYY-MM-DD" → { redemptions, discountCost, revenueInfluenced }
  const dayMap = new Map();

  const toDay = (date) => {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };

  usageHistory.forEach((entry) => {
    const usedAt = new Date(entry.usedAt);
    if (usedAt < cutoff) return;

    const day  = toDay(usedAt);
    const cost = Number(entry.discountAmount) || 0;

    if (!dayMap.has(day)) {
      dayMap.set(day, { date: new Date(`${day}T00:00:00.000Z`), redemptions: 0, discountCost: 0, revenueInfluenced: 0 });
    }
    const rec = dayMap.get(day);
    rec.redemptions++;
    rec.discountCost = roundCents(rec.discountCost + cost);
  });

  // Add matched order revenue to the corresponding day
  matchedOrders.forEach((order) => {
    const createdAt = new Date(order.createdAt);
    if (createdAt < cutoff) return;

    const day     = toDay(createdAt);
    const revenue = Number(order.totalPrice) || 0;

    // Revenue can arrive even on days with no direct redemptions in
    // the window (e.g. the redemption was before the cutoff but the order
    // is within it). Still worth recording revenue.
    if (!dayMap.has(day)) {
      dayMap.set(day, { date: new Date(`${day}T00:00:00.000Z`), redemptions: 0, discountCost: 0, revenueInfluenced: 0 });
    }
    const rec = dayMap.get(day);
    rec.revenueInfluenced = roundCents(rec.revenueInfluenced + revenue);
  });

  // Sort ascending (oldest → newest) for chart rendering
  return Array.from(dayMap.values()).sort((a, b) => a.date - b.date);
};

// ── derivePeakUsage ────────────────────────────────────────────────────────

/**
 * Finds the calendar day with the highest redemption count from the
 * pre-built dailyRedemptions array. O(n) scan, cheap.
 *
 * @param {Array} dailyRedemptions
 * @returns {Object}  { date, redemptions, dayOfWeek }
 */
const derivePeakUsage = (dailyRedemptions) => {
  if (dailyRedemptions.length === 0) {
    return { date: null, redemptions: 0, dayOfWeek: null };
  }

  const peak = dailyRedemptions.reduce((best, entry) =>
    entry.redemptions > best.redemptions ? entry : best
  );

  return {
    date:        peak.date,
    redemptions: peak.redemptions,
    dayOfWeek:   peak.redemptions > 0 ? new Date(peak.date).getUTCDay() : null,
  };
};

// ── buildBaseline ──────────────────────────────────────────────────────────

/**
 * Computes the store-wide comparison baseline in a single lightweight
 * aggregate. Intentionally excludes orders that used a discount so the
 * baseline reflects organic order values only.
 *
 * aovLiftPercent = ((thisCodeAOV - baselineAOV) / baselineAOV) * 100
 * Null when baselineAOV is 0 or when this code has no matched orders yet.
 *
 * @param {number} thisCodeAvgOrderValue   — from buildFinancials()
 * @returns {Promise<Object>}
 */
const buildBaseline = async (thisCodeAvgOrderValue) => {
  const result = await Order.aggregate([
    {
      $match: {
        "paymentInfo.status": "success",
        orderStatus: { $ne: "Cancelled" },
        $or: [
          { discountCode: { $exists: false } },
          { discountCode: null },
          { discountCode: "" },
        ],
      },
    },
    {
      $group: {
        _id: null,
        storeAvgOrderValue:    { $avg: "$totalPrice" },
        storeAvgDiscountAmount: { $avg: "$discountAmount" },
      },
    },
  ]);

  const storeAvgOrderValue    = roundCents(result[0]?.storeAvgOrderValue    ?? 0);
  const storeAvgDiscountAmount = roundCents(result[0]?.storeAvgDiscountAmount ?? 0);

  const aovLiftPercent =
    storeAvgOrderValue > 0 && thisCodeAvgOrderValue > 0
      ? roundCents(
          ((thisCodeAvgOrderValue - storeAvgOrderValue) / storeAvgOrderValue) * 100
        )
      : null;

  return { storeAvgOrderValue, storeAvgDiscountAmount, aovLiftPercent };
};

// ============================================
// UTILITY
// ============================================

/**
 * Round a number to 2 decimal places.
 * Used consistently throughout so floating-point drift doesn't
 * accumulate across reduce() calls.
 *
 * @param {number} n
 * @returns {number}
 */
const roundCents = (n) => Math.round((n ?? 0) * 100) / 100;

// ============================================
// EXPORTS
// ============================================

export default {
  syncDiscountAnalytics,
  syncDiscountAfterRedemption,
  syncAllDiscountAnalytics,
  getDiscountAnalyticsSummary,
};